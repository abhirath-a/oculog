"""Additive V3 question-aware chat; V2 remains a whole-chunk selector."""
import json
import unicodedata

from . import chat_safety as guard
from .budget import BudgetError
from .corpus import load_corpus
from .provider import CHAT_PROFILE_REVISION, GeminiGateway, GatewayError
from .retrieval import RetrievalUnavailable, retrieve
from .service import ANSWER_SCHEMA, consent

CHAT_DISCLOSURE_VERSION = 'adult-advice-current-question-v3.1'
CHAT_DISCLOSURE = {
    'version': CHAT_DISCLOSURE_VERSION,
    'text': 'Adults only. With your explicit consent, Gemini receives your current question and bounded public source passages, not earlier chat, account/profile details, lens records or photos. Your question itself may contain sensitive information: do not include identifiers or personal clinical details. Recognized identifiers are blocked, but this is not perfect anonymization. This is general contact-lens education, not diagnosis, prescriptions, personal treatment or product suitability advice. AI replies may go beyond the public passages and can be wrong or uncertain; citations do not prove correctness. Paid provider processing may include limited safety logging. You may withdraw consent, but already transmitted requests cannot be recalled. Adult acknowledgment is not age verification.',
    'terms_url': 'https://ai.google.dev/gemini-api/terms',
}
RETRIEVER_REVISION = 'fts5-bm25-language-first-v3'
SOURCE_KEYS = ('id', 'document_id', 'title', 'url', 'authority', 'language',
               'content_sha256', 'fetched_at', 'source_modified_at')


def current_consent(db, owner):
    return consent(db, owner, expectedDisclosureVersion=CHAT_DISCLOSURE_VERSION)


def validate_request(body, api):
    if not isinstance(body, dict) or 'message' not in body or not set(body) <= {'message', 'language', 'use_ai', 'consent_epoch'}:
        raise api.Problem(message='Expected message and optional language, use_ai, consent_epoch only')
    message = body['message']
    if not isinstance(message, str) or not 1 <= len(message.strip()) <= 1000:
        api.fail('message', 'Use 1 to 1000 trimmed characters')
    if any(unicodedata.category(c).startswith('C') and c not in '\n\r\t' for c in message):
        api.fail('message', 'Unsupported control characters')
    language, use_ai, epoch = body.get('language', 'en'), body.get('use_ai', False), body.get('consent_epoch')
    if language not in ('en', 'es') or type(use_ai) is not bool:
        api.fail('language', 'Use en/es and a boolean use_ai')
    if ('consent_epoch' in body and (type(epoch) is not int or epoch < 0)) or (use_ai and epoch is None):
        api.fail('consent_epoch', 'Current consent epoch required for AI')
    return ' '.join(message.split()), language, use_ai, epoch


def build_prompt(message, language, passages):
    return json.dumps({'language': language, 'current_question': message,
                       'passages': [{'id': c['id'], 'text': c['text']} for c in passages]}, ensure_ascii=True)


def validate_generation(text, passages):
    """Strict structure and ID membership, NOT entailment or clinical validation."""
    try:
        def pairs(items):
            obj = {}
            for key, value in items:
                if key in obj:
                    raise ValueError()
                obj[key] = value
            return obj
        if not isinstance(text, str) or len(text) > 16000:
            raise ValueError()
        data = json.loads(text, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(data, dict) or set(data) != {'paragraphs'}:
            raise ValueError()
        paragraphs = data['paragraphs']
        if not isinstance(paragraphs, list) or not 1 <= len(paragraphs) <= 4:
            raise ValueError()
        ids, seen, total = {c['id'] for c in passages}, set(), 0
        for paragraph in paragraphs:
            if not isinstance(paragraph, dict) or set(paragraph) != {'text', 'citations'}:
                raise ValueError()
            value, citations = paragraph['text'], paragraph['citations']
            if not isinstance(value, str) or not 1 <= len(value.strip()) <= 2000 or value != value.strip() or value in seen:
                raise ValueError()
            value.encode('utf-8')
            if any(unicodedata.category(c).startswith('C') and c != '\n' for c in value) or guard.unsafe_output(value):
                raise ValueError()
            if not isinstance(citations, list) or len(citations) > len(ids):
                raise ValueError()
            if any(not isinstance(cid, str) or cid not in ids for cid in citations) or len(set(citations)) != len(citations):
                raise ValueError()
            seen.add(value)
            total += len(value)
        if total > 6000:
            raise ValueError()
        return paragraphs
    except (ValueError, TypeError, KeyError, RecursionError, UnicodeError):
        raise GatewayError('generation_rejected') from None


def provider_state(db_path):
    try:
        gateway = GeminiGateway(db_path)
        return gateway, gateway.status(), {'monthly_limit_usd': None, 'available': True}
    except (BudgetError, ValueError, KeyError, OSError):
        return None, {'name': 'Gemini', 'configured': False, 'available': False,
                      'reason': 'invalid_provider_configuration'}, {'monthly_limit_usd': None, 'available': False}


def action(route, body, authorization, api):
    with api.connection() as db:
        account, _ = api.authenticate(db, authorization)
        owner = account['id']
        current = current_consent(db, owner)
        db_path = db.execute('PRAGMA database_list').fetchone()[2]
    if route == 'consent':
        api.strict(body, ['disclosure_version', 'granted', 'adult_ack'])
        if type(body['granted']) is not bool or type(body['adult_ack']) is not bool:
            api.fail('granted', 'Expected booleans')
        if not isinstance(body['disclosure_version'], str):
            api.fail('disclosure_version')
        if body['granted'] and (not body['adult_ack'] or body['disclosure_version'] != CHAT_DISCLOSURE_VERSION):
            api.fail('disclosure_version', 'Current disclosure and adult acknowledgment required')
        with api.connection() as db, api.transaction(db):
            account, _ = api.authenticate(db, authorization)
            if account['id'] != owner:
                raise api.Problem(401, 'unauthorized', 'Authentication required')
            db.execute('INSERT INTO education_consent VALUES (?,?,?,?,1) ON CONFLICT(account_id) DO UPDATE SET disclosure_version=excluded.disclosure_version,granted=excluded.granted,adult_ack=excluded.adult_ack,epoch=education_consent.epoch+1',
                       (owner, CHAT_DISCLOSURE_VERSION, int(body['granted']), int(body['adult_ack']) if body['granted'] else 0))
            return api.reply(current_consent(db, owner))
    if route == 'status':
        corpus = load_corpus()
        _, provider, budget = provider_state(db_path)
        return api.reply({'version': 3, 'corpus': {'revision': corpus['revision'], 'document_count': len(corpus['documents']), 'chunk_count': len(corpus['chunks'])},
                          'provider': provider, 'languages': ['en', 'es'], 'disclosure': CHAT_DISCLOSURE,
                          'consent': current, 'budget': budget})
    message, language, use_ai, epoch = validate_request(body, api)
    corpus = load_corpus()
    result = {'version': 3, 'mode': 'unavailable', 'reason': None, 'language': language,
              'title': 'Local public sources' if language == 'en' else 'Fuentes públicas locales',
              'paragraphs': [], 'sources': [], 'provenance': {'corpus_revision': corpus['revision'],
              'retriever_revision': RETRIEVER_REVISION, 'prompt_revision': CHAT_PROFILE_REVISION, 'model': None}, 'safety_level': None}
    level = guard.safety(message)
    handling = level or ('private' if guard.private(message) else 'injection' if guard.injection(message)
                         else 'clinical' if guard.clinical(message) else 'off_domain' if not guard.in_domain(message) else None)
    if handling:
        title, text = guard.FIXED[language][handling]
        result.update(mode='safety' if level else 'off_domain' if handling == 'off_domain' else 'clarification',
                      reason='fixed_' + handling, title=title, paragraphs=[{'text': text, 'citations': []}], safety_level=level)
        return api.reply(result)
    retrieval_reason = None
    try:
        passages = retrieve(message, language=language, limit=4, corpus=corpus, language_before_limit=True)
    except (RetrievalUnavailable, ValueError):
        passages, retrieval_reason = [], 'local_retrieval_unavailable'
    # Public metadata is always server-owned, never accepted from the model.
    result['sources'] = [{key: c[key] for key in SOURCE_KEYS} | {'excerpt': c['text']} for c in passages]
    result['paragraphs'] = [{'text': c['text'], 'citations': [c['id']]} for c in passages]
    result.update(mode='local_sources' if passages else 'unavailable',
                  reason=retrieval_reason or ('ai_not_requested' if passages else 'no_local_sources'))
    if not use_ai:
        return api.reply(result)

    def authorize(db):
        account, _ = api.authenticate(db, authorization)
        latest = current_consent(db, owner)
        if account['id'] != owner or not latest['granted'] or not latest['adult_ack'] or latest['epoch'] != epoch:
            raise api.Problem(409, 'consent_required', 'Current adult advice consent required')
    with api.connection() as db:
        authorize(db)
    gateway, provider, _ = provider_state(db_path)
    if gateway is None or not provider['available']:
        result['reason'] = provider['reason']
        return api.reply(result)
    generated, error = None, None
    try:
        generated = gateway.complete(build_prompt(message, language, passages), schema=ANSWER_SCHEMA,
                                     purpose='advice_chat', max_output_tokens=1024, authorize=authorize)
        paragraphs = validate_generation(generated['text'], passages)
    except GatewayError as exc:
        error = exc.reason
    with api.connection() as db:
        authorize(db)  # Also fence invalid output and failed/unknown delivery.
    if error:
        result['reason'] = error
        return api.reply(result)
    result.update(mode='ai_answer', reason=None, paragraphs=paragraphs,
                  title='AI reply' if language == 'en' else 'Respuesta de IA')
    result['provenance']['model'] = generated['model']
    return api.reply(result)
