"""Conservative EN/ES guardrails, not clinical classification or anonymization.

Scope uses the lens domain, not an approved-topic catalogue. Pattern matching
cannot detect every identifier, symptom or instruction attack.
"""
import re
import unicodedata


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold())
                   if not unicodedata.combining(c))


def has(pattern, text):
    return re.search(pattern, text, re.I) is not None


def private(text):
    text = normalized(text)
    return (has(r'[^\s@]+@[^\s@]+\.[^\s@]+|https?://|www\.|\b(?:\d[\s()+.-]*){7,}\b', text)
            or has(r'\b(my name is|i am named|me llamo|mi nombre es|my address|mi direccion|'
                   r'patient id|medical record|numero de historia|passport|pasaporte|social security)\b', text))


def injection(text):
    text = normalized(text)
    return has(r'\b(ignore|disregard|override|forget|ignora\w*|olvida\w*|omite\w*)\b.{0,80}'
               r'\b(instruction\w*|rule\w*|prompt|system|reglas?|instrucciones|sistema)\b|'
               r'\b(act as|pretend to be|actua como|finge ser|system prompt|system_instruction|'
               r'developer message|output json|reveal.*prompt)\b', text)


def clinical(text):
    text = normalized(text)
    return has(r'\b(diagnos\w*|diagnost\w*|prescrib\w*|recet\w*|dosage|doses?|dosis|'
               r'what (?:medicine|medication|drug)|que medicamento|treat my|tratar mi|'
               r'cure my|curar mi|do i have|tengo una infeccion|'
               r'(?:suitable|right|best|recommended) for me|aptos? para mi|adecuad[oa]s? para mi|'
               r'(?:my|mi) (?:prescription|receta|graduacion|diagnosis|diagnostico)|'
               r'(?:which|what).{0,35}(?:lens|lenses).{0,40}(?:for me|for my|should i (?:buy|choose|use))|'
               r'(?:que|cuales).{0,30}(?:lentes|lentillas).{0,30}(?:para mi|debo (?:comprar|elegir|usar))|'
               r'(?:which|what).{0,35}(?:brand|product|solution).{0,40}(?:for me|should i|suitable)|'
               r'(?:recommend|choose|pick).{0,30}(?:brand|product|solution)|'
               r'(?:recomienda|elige).{0,35}(?:marca|producto|solucion)|'
               r'(?:marca|producto|solucion).{0,30}(?:para mi|debo usar))\b', text)


def safety(text):
    text = normalized(text)
    red = has(r'\b(red(?:ness)?|bloodshot|ojos?.{0,16}rojos?|enrojecimiento)\b', text)
    changed = has(r'\b(blurred|blurry|changed vision|light sensitivity|photophobia|'
                  r'sensitive to light|hurts to look at light|vision borrosa|'
                  r'cambio de vision|sensibilidad a la luz|fotofobia)\b', text)
    if (red and changed) or has(r'\b(vision loss|loss of vision|lost (?:my )?vision|cannot see|can.t see|'
           r'severe (?:eye )?pain|unbearable pain|extreme (?:eye )?pain|worst eye pain|'
           r'dolor (?:ocular )?(?:intenso|severo|insoportable)|'
           r'sudden blindness|chemical (?:splash|burn)|perdida de vision|no puedo ver|'
           r'quemadura quimica|producto quimico en (?:el |los )?ojos?)\b', text):
        return 'emergency'
    if has(r'\b(eye pain|eyes? hurts?|pain.{0,25}eyes?|red eyes?|redness|blurry vision|'
           r'eyes?.{0,16}red|vision.{0,16}(?:blurry|blurred|borrosa)|'
           r'blurred vision|light sensitivity|sensitive to light|photophobia|discharge|swollen eyes?|'
           r'dolor.{0,25}ojos?|ojos?.{0,25}dolor|ojos?.{0,16}rojos?|enrojecimiento|'
           r'vision borrosa|sensibilidad a la luz|secrecion|ojos? hinchados?)\b', text):
        return 'urgent'
    return None


def in_domain(text):
    # Broad subject detection only: no list of eligible questions or topics.
    return has(r'\b(contacts|contact lenses?|lens(?:es)?|lentes?|lentillas?|contactos?|'
               r'scleral|esclerales?|orthokeratology|ortoqueratologia|hydrogel|rgp)\b', normalized(text))


def unsafe_output(text):
    value = normalized(text)
    return (private(text) or injection(text) or clinical(text)
            or has(r'\b[a-z0-9-]+\.(?:com|org|gov|edu|net|io|invalid)\b|\]\s*\(', value)
            or has(r'\b(you have|your symptoms (?:mean|indicate)|you should take|'
                   r'you (?:must|should) use .{0,30}(?:drops|medicine)|'
                   r'tienes (?:una?|el|la)|tus sintomas|debes tomar|debes usar .{0,30}gotas)\b', value))


FIXED = {
    'en': {
        'emergency': ('Get emergency eye care', 'Seek emergency medical care now for severe eye pain, sudden vision loss, red eyes with changed vision or light sensitivity, or a chemical eye injury. Do not wait for a chat reply. Remove lenses only if easy; do not force a stuck lens or delay care. Do not drive with affected vision. For chemical exposure, immediately rinse the eye with clean running water while arranging emergency help.'),
        'urgent': ('Get urgent eye care', 'Remove contact lenses if you can do so easily, do not put them back in, and contact an eye-care professional urgently today for eye pain, redness, discharge, light sensitivity or blurred vision. If vision suddenly worsens or is lost, seek emergency care now.'),
        'private': ('Keep personal details private', 'Please ask again without names, contact details, identification numbers or links. This guard cannot detect every personal detail; the current question may still contain sensitive information.'),
        'clinical': ('General information only', 'I cannot diagnose, prescribe, choose a product for you or give personal treatment or dosing advice. Please ask an eye-care professional. You can ask a general contact-lens question without personal clinical details.'),
        'injection': ('Ask a contact-lens question', 'Please ask a general contact-lens question without instructions to change the assistant’s rules or role.'),
        'off_domain': ('Contact-lens questions', 'This chat is for general contact-lens information. Please include the lens question and any context needed in this message; earlier messages are not sent.'),
    },
    'es': {
        'emergency': ('Busca atención ocular de emergencia', 'Busca atención médica de emergencia ahora ante dolor ocular intenso, pérdida repentina de visión, ojos rojos con cambios de visión o sensibilidad a la luz, o una lesión química. No esperes una respuesta del chat. Retira los lentes solo si es fácil; no los fuerces ni retrases la atención. No conduzcas con la visión afectada. Ante una exposición química, enjuaga el ojo de inmediato con agua corriente limpia mientras consigues ayuda de emergencia.'),
        'urgent': ('Busca atención ocular urgente', 'Retira los lentes de contacto si puedes hacerlo fácilmente y no vuelvas a colocarlos. Contacta hoy mismo con un profesional de la salud ocular por dolor, enrojecimiento, secreción, sensibilidad a la luz o visión borrosa. Si la visión empeora repentinamente o se pierde, busca atención de emergencia ahora.'),
        'private': ('Protege tus datos personales', 'Pregunta de nuevo sin nombres, datos de contacto, números de identificación ni enlaces. Este filtro no detecta todos los datos personales; la pregunta actual puede contener información sensible.'),
        'clinical': ('Solo información general', 'No puedo diagnosticar, recetar, elegir un producto para ti ni indicar tratamientos o dosis personales. Consulta con un profesional de la salud ocular. Puedes hacer una pregunta general sobre lentes sin detalles clínicos personales.'),
        'injection': ('Pregunta sobre lentes de contacto', 'Haz una pregunta general sobre lentes de contacto sin instrucciones para cambiar las reglas o el papel del asistente.'),
        'off_domain': ('Preguntas sobre lentes de contacto', 'Este chat ofrece información general sobre lentes de contacto. Incluye la pregunta y el contexto necesario en este mensaje; los mensajes anteriores no se envían.'),
    },
}
