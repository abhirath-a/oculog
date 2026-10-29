"""Real SQLite and existing session authentication; no services or provider calls."""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend import learning, main
from backend.education.corpus import CorpusError, load_corpus


class LearningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'learning.sqlite3')
        @contextmanager
        def connection():
            db = sqlite3.connect(self.path, isolation_level=None)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            try:
                yield db
            finally:
                db.close()
        self.api = SimpleNamespace(connection=connection, authenticate=main.authenticate,
                                   transaction=main.transaction, strict=main.strict, fail=main.fail,
                                   reply=main.reply, Problem=main.Problem)
        self.tokens = ['a' * 43, 'b' * 43]
        with connection() as db:
            db.executescript(main.SCHEMA + learning.SCHEMA)
            for owner, token in zip(('one', 'two'), self.tokens):
                db.execute('INSERT INTO accounts VALUES (?,?,?,?,?)', (owner, owner + '@example.org', 'unused', owner, 'UTC'))
                db.execute('INSERT INTO sessions VALUES (?,?,?,0)', (hashlib.sha256(token.encode()).hexdigest(), owner, int(time.time()) + 3600))
        self.bank = learning.load_bank()

    def call(self, route='status', body=None, owner=0):
        response = learning.action(route, body, 'Bearer ' + self.tokens[owner], self.api)
        return json.loads(response.body)

    def answer(self, q='hands-wash', option='a', attempt='unique-attempt-0001', generation=0):
        return {'question_id': q, 'option_id': option, 'client_attempt_id': attempt,
                'generation': generation, 'source_bank_revision': self.bank['revision']}

    def test_authentication_and_revoked_session(self):
        for authorization in (None, 'Bearer bad', 'Bearer ' + 'c' * 43):
            with self.assertRaises(main.Problem) as error:
                learning.action('status', None, authorization, self.api)
            self.assertEqual(error.exception.status, 401)
        with self.api.connection() as db:
            db.execute('UPDATE sessions SET revoked=1')
        with self.assertRaises(main.Problem):
            self.call('answer', self.answer())

    def test_mutation_rechecks_session_after_initial_authentication(self):
        def revoke_during_bank_load():
            with self.api.connection() as db:
                db.execute('UPDATE sessions SET revoked=1')
            return self.bank
        with patch.object(learning, 'load_bank', side_effect=revoke_during_bank_load):
            with self.assertRaises(main.Problem) as error:
                self.call('answer', self.answer())
            self.assertEqual(error.exception.status, 401)
        with self.api.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM learning_attempts').fetchone()[0], 0)

    def test_concurrent_duplicate_serializes_to_one_grade(self):
        from concurrent.futures import ThreadPoolExecutor
        body = self.answer()
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda _: self.call('answer', body), range(2)))
        self.assertEqual(replies[0], replies[1])
        self.assertEqual(self.call()['progress']['hands-wash']['attempts'], 1)

    def test_public_status_never_contains_answer_keys(self):
        status = self.call()
        self.assertEqual(len(status['lessons']), 8)
        self.assertEqual(sum(len(l['questions']) for l in status['lessons']), 10)
        self.assertNotIn('correct_option_id', json.dumps(status))
        self.assertNotIn('explanation', json.dumps(status))
        self.assertEqual(status['recommended_question']['reason'], 'unanswered')
        self.assertEqual(status['progress'], {})

    def test_server_grade_progress_feedback_and_due(self):
        first = self.call('answer', self.answer(option='b'))
        self.assertFalse(first['feedback']['correct'])
        self.assertEqual(first['recommended_question']['reason'], 'previous_mistake')
        self.assertTrue(first['feedback']['reference']['quote'])
        second = self.call('answer', self.answer(attempt='unique-attempt-0002'))
        row = second['progress']['hands-wash']
        self.assertEqual((row['attempts'], row['correct'], row['last_correct']), (2, 1, True))
        self.assertEqual(row['review_due'] - row['last_time'], learning.REVIEW_SECONDS)
        self.assertEqual(second['recommended_question']['id'], 'water-swim')

    def test_duplicate_exact_response_and_conflicting_reuse(self):
        body = self.answer()
        first = self.call('answer', body)
        self.assertEqual(self.call('answer', body), first)
        with self.assertRaises(main.Problem) as error:
            self.call('answer', {**body, 'option_id': 'b'})
        self.assertEqual(error.exception.code, 'attempt_conflict')
        with self.api.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM learning_attempts').fetchone()[0], 1)
        self.assertEqual(self.call()['progress']['hands-wash']['attempts'], 1)

    def test_reset_epoch_blocks_old_attempt_and_old_reset(self):
        body = self.answer()
        self.call('answer', body)
        reset = self.call('reset', {'generation': 0})
        self.assertEqual(reset['generation'], 1)
        self.assertEqual(reset['progress'], {})
        for route, data in [('answer', body), ('answer', self.answer(attempt='unique-attempt-0003')), ('reset', {'generation': 0})]:
            with self.assertRaises(main.Problem) as error:
                self.call(route, data)
            self.assertEqual(error.exception.code, 'stale_generation')
        with self.api.connection() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM learning_attempts').fetchone()[0], 0)
        self.assertEqual(self.call('answer', self.answer(generation=1))['progress']['hands-wash']['attempts'], 1)

    def test_account_isolation_same_attempt_id_and_reset(self):
        body = self.answer()
        self.call('answer', body, 0)
        self.call('answer', {**body, 'option_id': 'b'}, 1)
        self.call('reset', {'generation': 0}, 0)
        other = self.call(owner=1)
        self.assertEqual(other['generation'], 0)
        self.assertEqual(other['progress']['hands-wash']['correct'], 0)
        with self.api.connection() as db:
            self.assertEqual(db.execute('SELECT account_id FROM learning_attempts').fetchone()[0], 'two')

    def test_input_option_revision_and_client_correct_rejected(self):
        for body in [self.answer(option='unknown'), self.answer(q='unknown'), {**self.answer(), 'correct': True},
                     {**self.answer(), 'generation': True}, {**self.answer(), 'source_bank_revision': 'old'}, self.answer(attempt='tiny')]:
            with self.assertRaises(main.Problem):
                self.call('answer', body)
        self.assertEqual(self.call()['progress'], {})

    def test_selection_synthetic_mistakes_new_due_stable_ties(self):
        questions = self.bank['questions']
        row = {'attempts': 1, 'correct': 1, 'last_correct': True, 'last_time': 10, 'review_due': 50}
        progress = {q['id']: dict(row) for q in questions}
        self.assertIsNone(learning.recommend(self.bank, progress, 49))
        self.assertEqual(learning.recommend(self.bank, progress, 50)['reason'], 'due_review')
        progress[questions[1]['id']]['review_due'] = 40
        self.assertEqual(learning.recommend(self.bank, progress, 50)['id'], questions[1]['id'])
        del progress[questions[2]['id']]
        self.assertEqual(learning.recommend(self.bank, progress, 50)['reason'], 'unanswered')
        progress[questions[1]['id']]['last_correct'] = False
        self.assertEqual(learning.recommend(self.bank, progress, 50)['reason'], 'previous_mistake')

    def test_every_source_resolves_and_corruption_fails_closed(self):
        corpus = load_corpus()
        self.assertEqual((len(corpus['documents']), len(corpus['chunks'])), (11, 53))
        for key, value in [('quote', 'Invented public source'), ('content_sha256', '0' * 64), ('url', 'https://example.org/')]:
            bank = deepcopy(self.bank)
            bank['lessons'][0]['reference'][key] = value
            path = Path(self.tmp.name) / 'bank.json'
            path.write_text(json.dumps(bank))
            with self.assertRaises(CorpusError):
                learning.load_bank(path, corpus)
        with patch.object(learning, 'load_bank', side_effect=CorpusError('corrupt')):
            with self.assertRaises(main.Problem) as error:
                self.call()
            self.assertEqual(error.exception.status, 503)

    def test_quota_does_not_break_idempotent_retry(self):
        first = self.call('answer', self.answer())
        with patch.object(learning, 'MAX_ATTEMPTS', 1):
            self.assertEqual(self.call('answer', self.answer()), first)
            with self.assertRaises(main.Problem) as error:
                self.call('answer', self.answer(attempt='unique-attempt-0002'))
            self.assertEqual(error.exception.status, 429)
        self.assertEqual(self.call()['progress']['hands-wash']['attempts'], 1)


if __name__ == '__main__':
    unittest.main()
