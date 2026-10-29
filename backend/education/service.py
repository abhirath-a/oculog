"""V2 application boundary: raw user text never reaches a provider."""
import json
import re

from backend import advice
from . import topics
from .budget import BudgetError
from .corpus import load_corpus
from .provider import GeminiGateway, GatewayError
from .retrieval import retrieve, RetrievalUnavailable

PROMPT_REVISION = 'whole-public-chunk-selection-v2'
ANSWER_SCHEMA_REVISION = 'whole-public-chunk-paragraphs-v1'

DISCLOSURE_VERSION = 'adult-education-2026-10-23.v1'
DISCLOSURE = {
    'version': DISCLOSURE_VERSION,
    'text': 'Adults only. Optional Gemini processing receives only a reviewed general topic and public source passages, not your message, history, profile or photos. This is general education, not medical advice, diagnosis, treatment, product selection or AI triage. Paid provider processing can include limited safety logging. Consent can be withdrawn; already transmitted requests cannot be recalled. Age acknowledgment is not age verification.',
    'terms_url': 'https://ai.google.dev/gemini-api/terms',
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS education_consent (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id), disclosure_version TEXT NOT NULL,
 granted INTEGER NOT NULL, adult_ack INTEGER NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>=1));
"""
ANSWER_SCHEMA = {'type': 'object', 'properties': {'paragraphs': {'type': 'array', 'items': {
    'type': 'object', 'properties': {'text': {'type': 'string'}, 'citations': {'type': 'array', 'items': {'type': 'string'}}},
    'required': ['text', 'citations'], 'additionalProperties': False}}}, 'required': ['paragraphs'], 'additionalProperties': False}



# The reviewed topic catalogue controls what may be sent to Gemini. A broader,
# conservative fallback permits *local-only* retrieval for general questions.
_GENERAL_TERMS = {
    'en': re.compile(
        r'\b(?:contact\s+lenses?|contacts|eye\s+care|eyes?|vision|'
        r'optometr(?:y|ist)|ophthalmolog(?:y|ist)|'
        r'lens(?:es)?|saline|disinfect(?:ion|ing)?|hygiene|'
        r'wear(?:ing)?|clean(?:ing)?|stor(?:e|age|ing)|'
        r'replac(?:e|ement|ing)|solution|case|cases|'
        r'daily|monthly|overnight|sleep(?:ing)?|water)\b', re.I),
    'es': re.compile(
        r'\b(?:lentes?\s+de\s+contacto|lentillas?|ojos?|ocular|'
        r'visión|vista|optometría|oftalmología|higiene|'
        r'limpieza|limpiar|desinfectar|solución|estuche|'
        r'agua|dormir|reemplazo|almacenamiento)\b', re.I),
}
_PERSONAL_MEDICAL = re.compile(
    r"\b(?:i|i'm|i've|me|my|mine|we|our|myself|you|your|"
    r"tengo|tienes|tienen|mi|mis|me\s+duele|"
    r"diagnos\w*|symptom\w*|treat(?:ment)?|cure|"
    r"prescri\w*|medicat\w*|infect\w*|pain|hurt\w*|"
    r"redness|red\s+eye|blurry|blurred|discharge|swollen|"
    r"diagnóstic\w*|síntoma\w*|tratamiento|dolor|"
    r"infecci\w*|rojo\w*|hinchad\w*)\b", re.I)


def general_education_query_allowed(message, language):
    """Allow unreviewed queries for local retrieval only, never cloud generation.

    This is a conservative routing heuristic, not a symptom triage classifier.
    Personal/clinical queries stay out of this path; higher-level safety routing
    must separately handle urgent concerns.
    """
    if _PERSONAL_MEDICAL.search(message):
        return False
    return topics.local_query_allowed(message) or bool(
        _GENERAL_TERMS[language].search(message))


# A symptom report is different from a general educational question. Respond
# with reviewed, non-diagnostic safety guidance rather than treating it as an
# unsupported topic or forwarding personal health text to the AI provider.
_SYMPTOM_SIGNALS = {
    'en': re.compile(r"\b(?:hurt\w*|pain(?:ful)?|red(?:ness)?|irritat\w*|"
                     r"burn(?:ing)?|swoll(?:en)?|swelling|discharge|"
                     r"blurr\w*|vision\s+(?:loss|change\w*)|"
                     r"light\s+sensitiv\w*|photophobia|infect\w*)\b", re.I),
    'es': re.compile(r"\b(?:duel\w*|dolor|roj\w*|irritaci[oó]n|ardor|"
                     r"hinchad\w*|secreci[oó]n|visi[oó]n\s+borrosa|"
                     r"sensibilidad\s+a\s+la\s+luz|infecci[oó]n)\b", re.I),
}
_EYE_CONTEXT = {
    'en': re.compile(r"\b(?:eyes?|vision|contacts?|contact\s+lenses?|lenses?)\b", re.I),
    'es': re.compile(r"\b(?:ojos?|ocular|visi[oó]n|lentillas?|lentes?)\b", re.I),
}


def symptom_safety_paragraphs(message, language):
    """Return conservative non-diagnostic guidance, or None.

    Not a medical triage engine: do not assign severity or diagnose. A symptom
    report must not flow to unreviewed local retrieval or external generation.
    """
    if not (_EYE_CONTEXT[language].search(message) and
            _SYMPTOM_SIGNALS[language].search(message)):
        return None
    if language == 'es':
        return [
            'El dolor, enrojecimiento u otros síntomas oculares pueden tener varias causas. '
            'No puedo determinar la causa por este chat. Busca una evaluación médica u ocular lo antes posible.',
            'Si usas lentes de contacto, quítatelos y no vuelvas a ponértelos hasta que '
            'un profesional te indique que es seguro. No uses lentes de contacto mientras tengas síntomas.',
            'Si tienes dolor intenso, cambios de visión o sensibilidad importante a la luz, '
            'busca atención urgente de inmediato.'
        ]
    return [
        'Eye pain, redness, or other eye symptoms can have different causes. '
        'I cannot determine the cause in chat. Please arrange prompt evaluation by an eye-care or medical professional.',
        'If you wear contact lenses, remove them and do not wear them again until '
        'an eye-care professional says it is safe.',
        'Seek urgent medical care right away if you have severe pain, changes in vision, '
        'or significant light sensitivity.'
    ]


def consent(db, account_id, expectedDisclosureVersion=DISCLOSURE_VERSION):
    row = db.execute('SELECT * FROM education_consent WHERE account_id=?', (account_id,)).fetchone()
    if row is None:
        return {'granted': False, 'adult_ack': False, 'epoch': 0}
    current = row['disclosure_version'] == expectedDisclosureVersion
    return {'granted': bool(row['granted']) and current, 'adult_ack': bool(row['adult_ack']) and current, 'epoch': row['epoch']}


def action(route, body, authorization, api):
    """Use existing auth/connection/transactions; never hold one during HTTP."""
    with api.connection() as db:
        account, _ = api.authenticate(db, authorization)
        owner = account['id']
        current = consent(db, owner)
        db_path = db.execute('PRAGMA database_list').fetchone()[2]
    if route == 'consent':
        api.strict(body, ['disclosure_version', 'granted', 'adult_ack'])
        if type(body['granted']) is not bool or type(body['adult_ack']) is not bool:
            api.fail('granted', 'Expected booleans')
        if not isinstance(body['disclosure_version'], str):
            api.fail('disclosure_version')
        if body['granted'] and (not body['adult_ack'] or body['disclosure_version'] != DISCLOSURE_VERSION):
            api.fail('disclosure_version', 'Current disclosure and adult acknowledgment required')
        with api.connection() as db, api.transaction(db):
            account, _ = api.authenticate(db, authorization)
            if account['id'] != owner:
                raise api.Problem(401, 'unauthorized', 'Authentication required')
            db.execute('INSERT INTO education_consent VALUES (?,?,?,?,1) ON CONFLICT(account_id) DO UPDATE SET disclosure_version=excluded.disclosure_version,granted=excluded.granted,adult_ack=excluded.adult_ack,epoch=education_consent.epoch+1',
                       (owner, DISCLOSURE_VERSION, int(body['granted']), int(body['adult_ack']) if body['granted'] else 0))
            return api.reply(consent(db, owner))
    corpus = load_corpus()
    try:
        gateway = GeminiGateway(db_path)
        provider = gateway.status()
        # Legacy response object now describes ledger readiness, not a spend gate.
        budget = {'monthly_limit_usd': None, 'available': True}
    except (BudgetError, ValueError, KeyError, OSError):
        gateway = None
        provider = {'name': 'Gemini', 'configured': False, 'available': False, 'reason': 'invalid_provider_configuration'}
        budget = {'monthly_limit_usd': None, 'available': False}
    if route == 'status':
        return api.reply({'version': 2, 'corpus': {'revision': corpus['revision'], 'document_count': len(corpus['documents']), 'chunk_count': len(corpus['chunks'])},
                          'provider': provider, 'languages': ['en', 'es'], 'topics': topics.catalogue(),
                          'disclosure': DISCLOSURE, 'consent': current, 'budget': budget})
    if not isinstance(body, dict) or not set(body) <= {'message', 'topic_id', 'question_id', 'language', 'use_ai', 'consent_epoch'} or len(set(body) & {'message', 'topic_id', 'question_id'}) != 1:
        raise api.Problem(message='Expected exactly one of message, topic_id, question_id and optional language, use_ai, consent_epoch')
    language = body.get('language', 'en')
    use_ai = body.get('use_ai', False)
    if language not in ('en', 'es') or type(use_ai) is not bool:
        api.fail('language', 'Use en/es and a boolean use_ai')
    epoch = body.get('consent_epoch')
    if ('consent_epoch' in body and (type(epoch) is not int or epoch < 0)) or (use_ai and epoch is None):
        api.fail('consent_epoch', 'Current consent epoch required for AI')
    topic, fixed, local_query, symptom_paragraphs = None, None, None, None
    if 'message' in body:
        message = body['message']
        if not isinstance(message, str) or not 1 <= len(message.strip()) <= 1000:
            api.fail('message', 'Use 1 to 1000 characters')
        # Normalize whitespace before FTS (which rejects control characters).
        # Free messages never invoke symptom triage or forward raw text to AI.
        message = ' '.join(message.split())
        symptom_paragraphs = symptom_safety_paragraphs(message, language)
        topic = topics.resolve(message, language) if symptom_paragraphs is None else None
        if symptom_paragraphs is None and topic is None and general_education_query_allowed(message, language):
            local_query = message
    elif 'question_id' in body:
        if not isinstance(body['question_id'], str):
            api.fail('question_id')
        try:
            matched = advice.answer_id(api.ADVICE, body['question_id'])
        except KeyError:
            api.fail('question_id', 'Unknown question')
        if matched['urgency'] in ('urgent', 'emergency'):
            fixed = matched
        else:
            topic = topics.QUESTION_BRIDGE.get(body['question_id'])
    else:
        if not isinstance(body['topic_id'], str) or body['topic_id'] not in topics.BY_ID:
            api.fail('topic_id', 'Unknown topic')
        topic = topics.BY_ID[body['topic_id']]

    result = {'version': 2, 'mode': 'abstained', 'reason': 'unsupported_general_topic', 'language': language,
              'title': 'General eye-care education' if language == 'en' else 'Educación general sobre el cuidado ocular',
              'paragraphs': [], 'sources': [], 'provenance': {'corpus_revision': corpus['revision'], 'retriever_revision': 'fts5-bm25-v1',
              'prompt_revision': PROMPT_REVISION, 'model': None}, 'safety_level': None}
    if symptom_paragraphs is not None:
        result.update(mode='safety', reason='symptom_safety_guidance',
                      title='Eye symptom safety' if language == 'en' else 'Seguridad ante síntomas oculares',
                      safety_level='undetermined',
                      paragraphs=[{'text': paragraph, 'citations': []} for paragraph in symptom_paragraphs])
        return api.reply(result)
    if fixed is not None:
        # Safety is the frozen catalogue, not an ordinary generated/source answer.
        result.update(mode='safety', reason='fixed_safety_catalogue_en', title=fixed['title'], language='en', safety_level=fixed['urgency'],
                      paragraphs=[{'text': text, 'citations': []} for text in fixed['paragraphs']])
        return api.reply(result)
    if topic is None and local_query is None:
        return api.reply(result)
    query = topic['query_' + language] if topic else local_query
    try:
        passages = [chunk for chunk in retrieve(query, language=language, limit=10, corpus=corpus)
                    if chunk['language'] == language and
                    (topic is None or topics.supports_passage(topic['id'], language, chunk['text']))][:4]
    except (RetrievalUnavailable, ValueError):
        result['reason'] = 'local_retrieval_unavailable'
        return api.reply(result)
    if not passages:
        result['reason'] = 'no_supported_source_passages'
        return api.reply(result)
    result.update(mode='local_retrieval', reason='ai_not_requested' if topic else 'unreviewed_query_local_only')
    if topic:
        result['title'] = topic['title'] if language == 'en' else topic['es']
    result['sources'] = [{key: chunk[key] for key in ('id', 'document_id', 'title', 'url', 'authority', 'language', 'content_sha256', 'fetched_at', 'source_modified_at')} | {'excerpt': chunk['text']} for chunk in passages]
    result['paragraphs'] = [{'text': chunk['text'], 'citations': [chunk['id']]} for chunk in passages]
    if not use_ai or topic is None:
        return api.reply(result)

    def authorize(db):
        account, _ = api.authenticate(db, authorization)
        latest = consent(db, owner)
        if account['id'] != owner or not latest['granted'] or not latest['adult_ack'] or latest['epoch'] != epoch:
            raise api.Problem(409, 'consent_required', 'Current adult education consent required')
    with api.connection() as db:
        authorize(db)
    if gateway is None or not provider['available']:
        result['reason'] = provider['reason']
        return api.reply(result)
    # Only the canonical topic + public passages cross the trust boundary.
    prompt = build_generation_prompt(topic, language, passages)
    try:
        generated = gateway.complete(prompt, schema=ANSWER_SCHEMA, authorize=authorize)
        paragraphs = validate_generation(generated['text'], passages)
    except GatewayError as exc:
        result['reason'] = exc.reason
        # Contract/schema/advice/citation failures abstain; availability keeps honest excerpts.
        if exc.reason in ('generation_rejected', 'provider_response_invalid', 'usage_contract_invalid'):
            result.update(mode='abstained', paragraphs=[], sources=[])
        return api.reply(result)
    with api.connection() as db:
        authorize(db)  # Recheck original session, disclosure and epoch after HTTP.
    result.update(mode='generated', reason=None, paragraphs=paragraphs,
                  title='AI-selected source excerpts' if language == 'en' else 'Extractos de fuentes seleccionados por IA')
    result['provenance']['model'] = generated['model']
    return api.reply(result)


def build_generation_prompt(topic, language, passages):
    """Canonical reviewed topic and public chunks only; shared with evaluation."""
    return json.dumps({'language': language, 'reviewed_general_topic': topic['question'] if language == 'en' else topic['es'],
                       'passages': [{'id': c['id'], 'text': c['text']} for c in passages]}, ensure_ascii=True)


def validate_generation(text, passages):
    """Citation validation is NOT an entailment or clinical safety guarantee.

    Conservative extractive-only acceptance also rejects invented advice: each
    paragraph must equal the WHOLE text of every cited public chunk. Substrings
    can drop negation or safety context and must never be accepted.
    """
    try:
        def pairs(items):
            obj = {}
            for key, value in items:
                if key in obj:
                    raise ValueError()
                obj[key] = value
            return obj
        data = json.loads(text, object_pairs_hook=pairs)
        if not isinstance(data, dict) or set(data) != {'paragraphs'} or not isinstance(data['paragraphs'], list) or not 1 <= len(data['paragraphs']) <= 4:
            raise ValueError()
        source = {c['id']: c['text'] for c in passages}
        seen = set()
        for paragraph in data['paragraphs']:
            if not isinstance(paragraph, dict) or set(paragraph) != {'text', 'citations'}:
                raise ValueError()
            value, citations = paragraph['text'], paragraph['citations']
            if not isinstance(value, str) or not 1 <= len(value) <= 3000 or value in seen or not isinstance(citations, list) or not citations:
                raise ValueError()
            if any(not isinstance(cid, str) or cid not in source for cid in citations) or len(set(citations)) != len(citations):
                raise ValueError()
            if any(value != source[cid] for cid in citations):
                raise ValueError()
            # Even verbatim passages must not become diagnostic/product selection output.
            if re.search(r'\b(diagnos\w*|prescrib\w*|you have|your symptoms|you should take|recommend.*brand|diagnóstico|tienes|debes tomar)\b', value, re.I):
                raise ValueError()
            seen.add(value)
        return data['paragraphs']
    except (ValueError, TypeError, KeyError, RecursionError):
        raise GatewayError('generation_rejected') from None

