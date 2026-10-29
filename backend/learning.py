"""Local, source-grounded practice. Deterministic rules, not ML or clinical validation."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import time

from backend.education.corpus import load_corpus, CorpusError

POLICY_REVISION = 'mistakes-new-due-v1'
REVIEW_SECONDS = 7 * 24 * 3600  # Practice review only; never a lens-care interval.
MAX_ATTEMPTS = 2000  # Per account/generation; explicit reset frees this storage.
SCHEMA = """
CREATE TABLE IF NOT EXISTS learning_progress (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
 questions_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS learning_attempts (
 account_id TEXT NOT NULL REFERENCES accounts(id), client_attempt_id TEXT NOT NULL,
 generation INTEGER NOT NULL, fingerprint TEXT NOT NULL, question_id TEXT NOT NULL,
 option_id TEXT NOT NULL, correct INTEGER NOT NULL CHECK(correct IN (0,1)),
 answered_at INTEGER NOT NULL, response_json TEXT NOT NULL,
 PRIMARY KEY(account_id,client_attempt_id));
"""


def load_bank(path=None, corpus=None):
    """Resolve every authored quote to current approved corpus; no silent fallback."""
    corpus = load_corpus() if corpus is None else corpus
    def require(condition):
        if not condition:
            raise ValueError('Invalid learning bank')
    try:
        bank = json.loads(Path(path or Path(__file__).with_name('learning_data.json')).read_text())
        require(bank['review_status'] == 'source-grounded-not-clinician-validated')
        require(isinstance(bank['revision'], str) and bank['revision'])
        require(6 <= len(bank['lessons']) <= 8 and 8 <= len(bank['questions']) <= 12)
        chunks = {c['id']: c for c in corpus['chunks']}
        lessons = {}
        for lesson in bank['lessons']:
            require(re.fullmatch(r'[a-z0-9-]{1,64}', lesson['id']) and lesson['id'] not in lessons)
            require(all(isinstance(lesson[k], str) and 0 < len(lesson[k]) <= 1000 for k in ('title', 'text')))
            ref = lesson['reference']
            chunk = chunks[ref['chunk_id']]
            require(chunk['language'] == 'en')
            require(ref['content_sha256'] == chunk['content_sha256'])
            require(ref['url'] == chunk['url'] and ref['quote'] and ref['quote'] in chunk['text'])
            lessons[lesson['id']] = lesson
        ids, covered = set(), set()
        for q in bank['questions']:
            require(re.fullmatch(r'[a-z0-9-]{1,64}', q['id']) and q['id'] not in ids)
            require(q['lesson_id'] in lessons and 2 <= len(q['options']) <= 5)
            opts = [o['id'] for o in q['options']]
            require(len(set(opts)) == len(opts) and all(re.fullmatch('[a-z]', o) for o in opts))
            require(q['correct_option_id'] in opts)
            require(all(isinstance(o['text'], str) and 0 < len(o['text']) <= 500 for o in q['options']))
            require(all(isinstance(q[k], str) and 0 < len(q[k]) <= 1000 for k in ('prompt', 'explanation')))
            ids.add(q['id'])
            covered.add(q['lesson_id'])
        require(covered == set(lessons))
        bank['corpus_revision'] = corpus['revision']
        return bank
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CorpusError('Learning bank evidence or structure is invalid') from exc


def public_question(q):
    return {k: deepcopy(q[k]) for k in ('id', 'lesson_id', 'prompt', 'options')}


def recommend(bank, progress, now):
    """Mistakes first, unanswered next, then earliest due. Stable bank order breaks ties."""
    questions = bank['questions']
    for reason, candidates in (
        ('previous_mistake', [q for q in questions if q['id'] in progress and not progress[q['id']]['last_correct']]),
        ('unanswered', [q for q in questions if q['id'] not in progress]),
        ('due_review', sorted([q for q in questions if q['id'] in progress and progress[q['id']]['review_due'] <= now],
                              key=lambda q: progress[q['id']]['review_due'])),
    ):
        if candidates:
            return {**public_question(candidates[0]), 'reason': reason}
    return None


def snapshot(bank, generation, progress, now):
    lessons = [{**deepcopy(lesson), 'questions': [public_question(q) for q in bank['questions'] if q['lesson_id'] == lesson['id']]}
               for lesson in bank['lessons']]
    return {'version': 1, 'generation': generation, 'policy_revision': POLICY_REVISION,
            'source_bank_revision': bank['revision'], 'corpus_revision': bank['corpus_revision'],
            'review_status': bank['review_status'], 'lessons': lessons,
            'progress': deepcopy(progress), 'recommended_question': recommend(bank, progress, now)}


def action(route, body, authorization, api):
    if route not in ('status', 'answer', 'reset'):
        raise api.Problem(404, 'not_found', 'Unknown learning route')
    # Authenticate before loading public content. Every mutation rechecks the session in its transaction.
    with api.connection() as db:
        api.authenticate(db, authorization)
    try:
        bank = load_bank()
    except CorpusError:
        raise api.Problem(503, 'learning_unavailable', 'Learning sources could not be verified') from None
    fields = {'status': [], 'reset': ['generation'],
              'answer': ['generation', 'source_bank_revision', 'question_id', 'option_id', 'client_attempt_id']}
    api.strict({} if route == 'status' and body is None else body, fields[route])
    if route != 'status' and (type(body['generation']) is not int or not 0 <= body['generation'] <= 2**53 - 1):
        api.fail('generation')
    if route == 'answer':
        if body['source_bank_revision'] != bank['revision']:
            raise api.Problem(409, 'bank_changed', 'Reload the current learning bank')
        for key in ('question_id', 'option_id', 'client_attempt_id'):
            if not isinstance(body[key], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', body[key]):
                api.fail(key)
        if len(body['client_attempt_id']) < 16:
            api.fail('client_attempt_id', 'Use a unique random attempt ID')
        question = next((q for q in bank['questions'] if q['id'] == body['question_id']), None)
        if not question or body['option_id'] not in [o['id'] for o in question['options']]:
            api.fail('option_id', 'Unknown question or option')
    now = int(time.time())
    with api.connection() as db, api.transaction(db):
        account, _ = api.authenticate(db, authorization)
        owner = account['id']
        db.execute('INSERT OR IGNORE INTO learning_progress(account_id) VALUES (?)', (owner,))
        row = db.execute('SELECT * FROM learning_progress WHERE account_id=?', (owner,)).fetchone()
        generation, progress = row['generation'], json.loads(row['questions_json'])
        if route == 'status':
            return api.reply(snapshot(bank, generation, progress, now))
        if body['generation'] != generation:
            raise api.Problem(409, 'stale_generation', 'Progress was reset. Reload before answering.')
        if route == 'reset':
            db.execute('DELETE FROM learning_attempts WHERE account_id=?', (owner,))
            db.execute("UPDATE learning_progress SET generation=generation+1,questions_json='{}' WHERE account_id=?", (owner,))
            return api.reply(snapshot(bank, generation + 1, {}, now))
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        previous = db.execute('SELECT * FROM learning_attempts WHERE account_id=? AND client_attempt_id=?',
                              (owner, body['client_attempt_id'])).fetchone()
        if previous:
            if previous['fingerprint'] != fingerprint:
                raise api.Problem(409, 'attempt_conflict', 'Attempt ID was already used with another answer')
            return api.reply(json.loads(previous['response_json']))
        count = db.execute('SELECT COUNT(*) FROM learning_attempts WHERE account_id=?', (owner,)).fetchone()[0]
        if count >= MAX_ATTEMPTS:
            raise api.Problem(429, 'learning_limit', 'Practice storage limit reached. Reset progress to continue.')
        correct = body['option_id'] == question['correct_option_id']
        prior = progress.get(question['id'], {'attempts': 0, 'correct': 0})
        progress[question['id']] = {'attempts': prior['attempts'] + 1, 'correct': prior['correct'] + int(correct),
                                    'last_correct': correct, 'last_time': now,
                                    'review_due': now + REVIEW_SECONDS if correct else now}
        result = snapshot(bank, generation, progress, now)
        lesson = next(l for l in bank['lessons'] if l['id'] == question['lesson_id'])
        result['feedback'] = {'question_id': question['id'], 'selected_option_id': body['option_id'],
                              'correct': correct, 'explanation': question['explanation'],
                              'reference': deepcopy(lesson['reference'])}
        encoded = json.dumps(result, separators=(',', ':'))
        db.execute('INSERT INTO learning_attempts VALUES (?,?,?,?,?,?,?,?,?)',
                   (owner, body['client_attempt_id'], generation, fingerprint, question['id'], body['option_id'], int(correct), now, encoded))
        db.execute('UPDATE learning_progress SET questions_json=? WHERE account_id=?', (json.dumps(progress), owner))
        return api.reply(result)
