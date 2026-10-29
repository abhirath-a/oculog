"""Reviewed topic aliases and bounded general-care question forms, not medical interpretation."""
import re
from backend.advice import normalize

TOPICS = [
    {'id': 'cleaning', 'title': 'Cleaning and storage', 'question': 'How are contact lenses cleaned and stored?',
     'es': '¿Cómo se limpian y guardan los lentes de contacto?', 'query_en': 'cleaning disinfecting storing saline wash hands', 'query_es': 'limpiar guardar manos agua jabón',
     'aliases': ['cleaning', 'cleaning and storage', 'how do i clean my contact lenses', 'limpieza', 'limpiar lentes', 'limpieza y almacenamiento']},
    {'id': 'water', 'title': 'Water and contact lenses', 'question': 'Why should contact lenses be kept away from water?',
     'es': '¿Por qué se deben mantener los lentes de contacto lejos del agua?', 'query_en': 'water swimming shower', 'query_es': 'agua nadar ducharse',
     'aliases': ['water', 'water and contact lenses', 'can i swim or shower in contact lenses', 'agua', 'agua y lentes de contacto']},
    {'id': 'sleeping', 'title': 'Sleep and contact lenses', 'question': 'What do public sources say about sleeping in contact lenses?',
     'es': '¿Qué dicen las fuentes sobre dormir con lentes de contacto?', 'query_en': 'sleep sleeping', 'query_es': 'dormir duerma',
     'aliases': ['sleeping', 'sleep in contacts', 'can i sleep in contacts', 'dormir', 'dormir con lentes de contacto']},
    {'id': 'daily_disposal', 'title': 'Single-use lenses', 'question': 'What are single-use contact lenses?',
     'es': '¿Qué son los lentes de contacto de un solo uso?', 'query_en': 'single use disposable throw', 'query_es': 'desechables solo uso deséchelos',
     'aliases': ['daily disposal', 'single use lenses', 'what are daily disposable lenses', 'lentes desechables']},
    {'id': 'replacement', 'title': 'Lens replacement concepts', 'question': 'What do public sources say about lens replacement instructions?',
     'es': '¿Qué dicen las fuentes sobre las instrucciones de reemplazo de lentes?', 'query_en': 'replacement replace schedule instructions', 'query_es': 'reemplazo reemplazar instrucciones',
     'aliases': ['replacement schedule', 'lens replacement', 'reemplazo de lentes']},
    {'id': 'case_care', 'title': 'Lens cases', 'question': 'What do public sources say about contact lens cases?',
     'es': '¿Qué dicen las fuentes sobre los estuches de lentes de contacto?', 'query_en': 'case clean dry', 'query_es': 'estuche limpiar seco',
     'aliases': ['case care', 'lens cases', 'contact lens case care', 'estuche', 'cuidado del estuche']},
    {'id': 'general', 'title': 'About contact lenses', 'question': 'What are contact lenses?',
     'es': '¿Qué son los lentes de contacto?', 'query_en': 'medical devices vision prescription', 'query_es': 'dispositivos médicos visión receta',
     'aliases': ['contact lenses', 'what are contact lenses', 'lentes de contacto', 'qué son los lentes de contacto']},
    {'id': 'hand_hygiene', 'title': 'Hand hygiene', 'question': 'What do public sources say about washing hands before handling contact lenses?',
     'es': '¿Qué dicen las fuentes sobre lavarse las manos antes de manipular lentes de contacto?', 'query_en': 'wash hands soap water dry', 'query_es': 'lávese manos jabón séqueselas',
     'aliases': ['hand hygiene', 'washing hands', 'higiene de manos', 'lavarse las manos']},
    {'id': 'peroxide', 'title': 'Hydrogen peroxide solutions', 'question': 'What do public sources say about hydrogen peroxide solution labeling?',
     'es': '¿Qué dicen las fuentes sobre el etiquetado de las soluciones de peróxido de hidrógeno?', 'query_en': 'hydrogen peroxide neutralize neutralization', 'query_es': 'peróxido hidrógeno neutralización',
     'aliases': ['hydrogen peroxide', 'peroxide labeling', 'peróxido de hidrógeno']},
    {'id': 'expiration', 'title': 'Solution expiration and discard dates', 'question': 'What do public sources say about solution expiration and discard dates?',
     'es': '¿Qué dicen las fuentes sobre las fechas de vencimiento y descarte de las soluciones?', 'query_en': 'expiration discard date expired', 'query_es': 'vencimiento caducidad descarte',
     'aliases': ['solution expiration', 'expiration dates', 'discard dates', 'fecha de vencimiento']},
    {'id': 'saline', 'title': 'Saline and disinfection', 'question': 'What do public sources say about saline and contact lens disinfection?',
     'es': '¿Qué dicen las fuentes sobre la solución salina y la desinfección de lentes de contacto?', 'query_en': 'saline disinfect disinfection', 'query_es': 'salina desinfectar desinfección',
     'aliases': ['saline', 'saline disinfection', 'solución salina']},
    {'id': 'exams', 'title': 'Eye examinations', 'question': 'What is a dilated eye examination?',
     'es': '¿Qué es un examen de los ojos con dilatación?', 'query_en': 'dilated exam tests', 'query_es': 'examen dilatación',
     'aliases': ['eye exams', 'dilated eye exam', 'what is a dilated eye exam', 'examen de los ojos']},
]
BY_ID = {topic['id']: topic for topic in TOPICS}
QUESTION_BRIDGE = {**BY_ID, 'follow_up': BY_ID['exams']}

# Require topical evidence, not merely any OR-token FTS hit. Missing original
# Spanish evidence abstains rather than borrowing unrelated disinfection text.
EVIDENCE_TERMS = {
    'hand_hygiene': {'en': ('hands',), 'es': ('manos',)},
    'peroxide': {'en': ('peroxide',), 'es': ('peróxido',)},
    'expiration': {'en': ('expiration', 'discard date', 'expired'), 'es': ('vencimiento', 'caducidad', 'fecha de descarte')},
    'saline': {'en': ('saline',), 'es': ('salina',)},
}


def supports_passage(topic_id, language, text):
    terms = EVIDENCE_TERMS.get(topic_id, {}).get(language)
    return terms is None or any(term in text.casefold() for term in terms)


# Match COMPLETE general-care questions, not keywords inside arbitrary personal
# messages. Harmless first-person phrasing ("How do I clean contact lenses?")
# must not be confused with a symptom report. No free-text suffix, medical
# context, history or injection can be appended to these bounded forms.
_LENSES = r'(?:my |our |the |a )?(?:soft |reusable )?(?:contact lenses|contact lens|contacts|lenses|lens)'
_CASE = r'(?:my |our |the |a )?(?:contact lens |lens |storage )?(?:case|cases)'
_HOW = r'(?:how (?:do|can|should) (?:i|we|you|people)|how to)'
_MANNER = r'(?: properly| safely| daily| every day| each day)?'
GENERAL_QUESTION_FORMS = [
    ('cleaning', rf'{_HOW} (?:properly |safely )?(?:clean|wash|disinfect|store|care for|look after) {_LENSES}{_MANNER}'),
    ('cleaning', rf'how (?:are|should|can) {_LENSES} (?:be )?(?:cleaned|disinfected|stored|cared for){_MANNER}'),
    ('cleaning', rf'what (?:is|s) the (?:proper|correct|safe) way to (?:clean|disinfect|store) {_LENSES}'),
    ('cleaning', r'cómo (?:debo limpiar|puedo limpiar|limpiar|limpio|guardar|guardo|desinfectar|desinfecto) (?:mis |los |unos )?lentes(?: de contacto)?'),
    ('case_care', rf'{_HOW} (?:properly |safely )?(?:clean|wash|disinfect|store|dry|care for) {_CASE}{_MANNER}'),
    ('hand_hygiene', rf'{_HOW} (?:properly |safely )?(?:wash|clean|dry) (?:my |our |the )?hands(?: before (?:handling|touching|putting in) {_LENSES})?{_MANNER}'),
    ('hand_hygiene', r'cómo (?:me lavo|lavar|debo lavar) las manos(?: antes de (?:tocar|manipular) (?:los |mis )?lentes(?: de contacto)?)?'),
    ('water', rf'(?:can|should|may) (?:i|we|you) (?:swim|shower)(?: (?:and|or) (?:swim|shower))? (?:in|with|while wearing) {_LENSES}(?: in)?'),
    ('sleeping', rf'(?:can|should|may) (?:i|we|you) (?:sleep|nap) (?:in|with|while wearing) {_LENSES}(?: in)?'),
]


def resolve(message, language='en'):
    normalized = normalize(message)
    for topic in TOPICS:
        if normalized in {normalize(alias) for alias in [topic['question'], topic['es'], *topic['aliases']]}:
            return topic
    # Preserve the original punctuation-bearing input for the explicit PII check.
    if '@' not in message:
        for topic_id, pattern in GENERAL_QUESTION_FORMS:
            if re.fullmatch(pattern, normalized):
                return BY_ID[topic_id]
    return None


def local_query_allowed(message):
    """Explicit conservative query policy, NOT a universal medical classifier.

    Unknown questions may search local excerpts only. Reject personal symptoms,
    product suitability, medical instructions and prompt-injection phrases. This
    does not interpret negation, establish urgency or guarantee clinical safety.
    """
    text = normalize(' '.join(message.split()))
    denied = (r'\b(my|mine|me|i|our|we|mi|mis|yo|my eyes?|my symptoms?|my vision|my contacts? feel|i have|i am|i m|i feel|i slept|for me|'
              r'which (product|brand|drops|solution)|recommend\w* (?:a |an |the |some )?(?:product|brand|drops|solution|medicine)|suitable|best (product|brand|drops)|'
              r'diagnos\w*|treat\w*|prescrib\w*|medicine|medication|dosage|'
              r'pain\w*|hurt\w*|red\w*|itch\w*|burn\w*|blurr\w*|symptom\w*|infection\w*|'
              r'dry eyes?|dryness|gritty|swollen|swelling|discharge|vision loss|'
              r'dolor\w*|rojo\w*|picaz[oó]n|ardor|borros\w*|síntoma\w*|infecci[oó]n\w*|'
              r'ojos? secos?|hincha\w*|secreci[oó]n|'
              r'ignor\w*|olvida\w*|reglas anteriores|revela\w*|finge\w*|act[uú]a como|ejecuta\w*|clave (?:de )?api|'
              r'system prompt|prompt|api key|secret|history|photos?|'
              r'disregard|override|developer|pretend|act as|return json|output|execute|'
              r'tengo|mis ojos|mi ojo|mis síntomas|para mí|qué producto|recomienda\w* (?:un |una |el |la )?(?:producto|marca|solución|medicamento)|'
              r'diagnóstico|tratamiento|medicamento\w*)\b')
    if '@' in message or re.search(denied, text):
        return False
    # A query needs an explicit eye-care subject, not only generic FTS words.
    return bool(re.search(r'\b(contact\w*|lens|lenses|eye\w*|case|cases|saline|peroxide|solution\w*|'
                          r'hygiene|hand\w*|lentes?|ojos?|estuche\w*|salina|peróxido|soluci[oó]n\w*|manos)\b', text))


def case_drying_question(message):
    """Narrow disambiguation of storage-case drying, never eye/lens symptoms."""
    text = normalize(message)
    return (local_query_allowed(message) and
            bool(re.search(r'\b(?:dry|drying) (?:the |a |my )?(?:storage |lens |contact lens )?case\b', text)) and
            not re.search(r'\b(eyes?|symptoms?|gritty|pain|red|vision|uncomfortable)\b', text))


def catalogue():
    return [{key: item[key] for key in ('id', 'title', 'question')} for item in TOPICS]
