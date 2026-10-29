"""Scripted actual-gateway plumbing fixtures, NOT model performance scores."""
from contextlib import closing
from copy import deepcopy
from decimal import Decimal
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.education import service, topics
from backend.education.provider import GeminiGateway, GatewayError
from evaluation.adapters import MeteredRun, RunBudgetExceeded, validate_shared_ledger
from evaluation.live import disable_telemetry, live, prepare_answer
from evaluation.offline import DATASET, no_network

ENV = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-real', 'OCULOG_GEMINI_ENABLED': 'true',
       'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
       'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}


class EvaluationPrivacyTests(unittest.TestCase):
    def test_host_shell_cannot_enable_unrequested_tracing(self):
        keys = ('LANGSMITH_TRACING', 'LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2')
        with patch.dict(os.environ, {**dict.fromkeys(keys, 'true'), 'RAGAS_DO_NOT_TRACK': 'false'}):
            disable_telemetry()
            self.assertEqual(os.environ['RAGAS_DO_NOT_TRACK'], 'true')
            for key in keys:
                self.assertEqual(os.environ[key], 'false')


class GeneratedCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'synthetic.sqlite3'
        with closing(sqlite3.connect(self.path)) as db:
            db.executescript('CREATE TABLE accounts(id); CREATE TABLE sessions(id);')
        self.requests = []
        self.chunk = {'id': 'public', 'excerpt': 'Never use water to clean or store contact lenses.'}
        self.answer = {'paragraphs': [{'text': self.chunk['excerpt'], 'citations': ['public']}]}
        question = next(c['question'] for c in json.loads(DATASET.read_text())['cases'] if c['id'] == 'en-clean')
        # Use the real default reviewed alias, never the dataset oracle topic label.
        self.assertIsNotNone(topics.resolve(question, 'en'))
        self.case = {'id': 'en-clean', 'question': question, 'category': 'education',
                     'service': {'mode': 'local_retrieval', 'response': {
                         'mode': 'local_retrieval', 'language': 'en', 'sources': [self.chunk],
                         'paragraphs': deepcopy(self.answer['paragraphs']), 'provenance': {'model': None}}}}
        self.gateway = GeminiGateway(self.path, environ=ENV, transport=self.transport,
                                     clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
        _, self.check = validate_shared_ledger(self.path, {'OCULOG_DB_PATH': str(self.path)})

    def transport(self, url, headers, body, timeout):
        self.requests.append(json.loads(body))
        return {'status': 'completed', 'steps': [{'type': 'model_output', 'content': [
            {'type': 'text', 'text': json.dumps(self.answer)}]}],
            'usage': {'total_input_tokens': 10, 'total_output_tokens': 5,
                      'total_thought_tokens': 2, 'total_tokens': 17, 'total_tool_use_tokens': 0}}

    def test_same_runtime_wire_and_generated_candidate(self):
        metered = MeteredRun(self.gateway, validate_path=self.check)
        report = {}
        with no_network():
            candidate = prepare_answer(metered, self.case, 'generated', report)
        wire = self.requests[0]
        prompt = service.build_generation_prompt(topics.resolve(self.case['question'], 'en'), 'en',
                                                  [dict(self.chunk, text=self.chunk['excerpt'])])
        # Independent normal runtime-purpose call must have exactly identical wire.
        normal = GeminiGateway(self.path, environ=ENV, transport=self.transport, clock=self.gateway.clock)
        normal.complete(prompt, schema=service.ANSWER_SCHEMA)
        self.assertEqual(wire, self.requests[1])
        self.assertEqual(wire['input'], prompt)
        self.assertNotIn(self.case['question'], wire['input'])
        self.assertEqual(candidate['service']['response']['mode'], 'generated')
        self.assertEqual(candidate['service']['response']['sources'], self.case['service']['response']['sources'])
        self.assertEqual(self.case['service']['response']['mode'], 'local_retrieval')
        self.assertEqual(report['candidate']['status'], 'RUN')
        self.assertEqual(report['schema_revision'], service.ANSWER_SCHEMA_REVISION)
        ledger = metered.ledger_report()
        self.assertEqual(ledger['operations'][0]['purpose'], 'evaluation')
        self.assertEqual(Decimal(ledger['run_settled_actual_usd']), Decimal(ledger['settled_cost_usd']))
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual([r[0] for r in db.execute('SELECT purpose FROM education_budget_operations ORDER BY rowid')],
                             ['evaluation', 'education'])

    def test_no_raw_demo_question_and_local_unknown_make_no_calls(self):
        question = self.case['question']
        self.case['question'] = 'synthetic raw demonstration NEVER forward me'
        metered = MeteredRun(self.gateway, validate_path=self.check)
        self.assertIs(prepare_answer(metered, self.case, 'local', {}), self.case)
        with self.assertRaises(ValueError):
            prepare_answer(metered, self.case, 'generated', {})
        self.assertEqual(self.requests, [])
        # Verify the builder uses only the resolved canonical topic, not its alias.
        topic = topics.resolve(question, 'en')
        prompt = service.build_generation_prompt(topic, 'en', [dict(self.chunk, text=self.chunk['excerpt'])])
        self.assertNotIn(self.case['question'], prompt)
        self.assertEqual(set(json.loads(prompt)), {'language', 'reviewed_general_topic', 'passages'})

    def test_generation_run_ceiling_independent_of_prior_application_usage(self):
        metered = MeteredRun(self.gateway, '0.31', self.check)
        with self.assertRaises(RunBudgetExceeded):
            prepare_answer(metered, self.case, 'generated', {})
        self.assertEqual(self.requests, [])
        # Prior application usage is recorded but does not gate a valid run.
        from backend.education.budget import Budget
        Budget(self.path, clock=self.gateway.clock).reserve('other-app', 20_000_000_000, 'education')
        metered = MeteredRun(self.gateway, '1', self.check)
        report = {}
        with no_network():
            candidate = prepare_answer(metered, self.case, 'generated', report)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(candidate['service']['response']['mode'], 'generated')
        self.assertEqual(candidate['service']['response']['paragraphs'], self.answer['paragraphs'])
        self.assertEqual(report['candidate']['status'], 'RUN')
        self.assertEqual(metered.ledger_report()['operations'][0]['state'], 'settled')

    def test_trim_rejection_aborts_live_judges_and_preserves_charged_usage(self):
        self.answer['paragraphs'][0]['text'] = 'use water to clean or store contact lenses.'
        offline = {'status': 'RUN', 'cases': [self.case], 'config': {
            'dataset_sha256': 'fixture', 'prompt_revision': service.PROMPT_REVISION, 'software': {}}, 'corpus': {}}
        args = SimpleNamespace(allow_paid=True, dataset=DATASET, corpus=None, shared_ledger=self.path,
                               k=4, case_id='en-clean', answer_mode='generated', max_run_usd='1')
        with no_network(), patch.dict('os.environ', dict(ENV, OCULOG_DB_PATH=str(self.path))), \
                patch('backend.education.provider.GeminiGateway', return_value=self.gateway), \
                patch('evaluation.live.importlib.metadata.version', return_value='0.4.3'), \
                patch('evaluation.live.run', return_value=offline), \
                patch('evaluation.live.score_sample', side_effect=AssertionError('No judges after rejected candidate')) as score:
            report = live(args)
        score.assert_not_called()
        self.assertEqual(report['status'], 'ERROR')
        self.assertEqual(report['candidate']['status'], 'ERROR')
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(report['ledger']['operations'][0]['state'], 'settled')
        self.assertTrue(all(m['status'] == 'NOT_RUN' for m in report['metrics'].values()))
        self.assertNotIn('sample', report)

    def test_live_scores_generated_candidate_not_local_fallback(self):
        offline = {'status': 'RUN', 'cases': [self.case], 'config': {
            'dataset_sha256': 'fixture', 'prompt_revision': service.PROMPT_REVISION, 'software': {}}, 'corpus': {}}
        args = SimpleNamespace(allow_paid=True, dataset=DATASET, corpus=None, shared_ledger=self.path,
                               k=4, case_id='en-clean', answer_mode='generated', max_run_usd='1')
        seen = []
        async def fixture_engine(metered, case):
            seen.append(case)
            # Fixture returns no measured values; only asserts actual candidate routing.
            return {'fixture': {'status': 'NOT_RUN', 'value': None}}
        with no_network(), patch.dict('os.environ', dict(ENV, OCULOG_DB_PATH=str(self.path))), \
                patch('backend.education.provider.GeminiGateway', return_value=self.gateway), \
                patch('evaluation.live.importlib.metadata.version', return_value='0.4.3'), \
                patch('evaluation.live.run', return_value=offline), \
                patch('evaluation.live.score_sample', side_effect=fixture_engine):
            report = live(args)
        self.assertEqual(report['status'], 'PARTIAL')
        self.assertEqual(seen[0]['service']['response']['mode'], 'generated')
        self.assertEqual(seen[0]['service']['response']['provenance']['model'], self.gateway.price['model'])
        self.assertEqual(report['answer_mode'], 'generated')
        self.assertEqual(report['candidate']['status'], 'RUN')
        self.assertEqual(report['sample'], seen[0])
        self.assertEqual(report['local_service_sample']['service']['response']['mode'], 'local_retrieval')
        self.assertEqual(len(self.requests), 1)

    def test_answer_timeout_retains_full_quote_and_identity_change_rejects_settlement(self):
        def unavailable(*args):
            raise TimeoutError('synthetic only')
        self.gateway.transport = unavailable
        metered = MeteredRun(self.gateway, '0.32', self.check)
        with self.assertRaises(GatewayError):
            prepare_answer(metered, self.case, 'generated', {})
        self.assertEqual(Decimal(metered.ledger_report()['run_unknown_holds_usd']), Decimal('0.3158528'))
        with self.assertRaises(RunBudgetExceeded):
            metered.complete('public synthetic judge')
        # Completion verification itself rechecks the path, not just preflight/dispatch.
        with patch.object(metered, 'validate_path', side_effect=ValueError('synthetic inode changed')):
            with self.assertRaises(ValueError):
                metered._verified_cost({}, Decimal('0.3158528'))

    def test_cli_default_generated_and_explicit_local(self):
        from evaluation.__main__ import main
        for flags, expected in (([], 'generated'), (['--answer-mode', 'local'], 'local')):
            output = Path(self.temp.name) / (expected + '.json')
            with patch('evaluation.live.live', return_value={'status': 'NOT_RUN', 'errors': []}) as call:
                self.assertEqual(main(['live', '--output', str(output)] + flags), 2)
            self.assertEqual(call.call_args.args[0].answer_mode, expected)
        with self.assertRaises(SystemExit):
            main(['live', '--answer-mode', 'both', '--output', str(Path(self.temp.name) / 'invalid.json')])


if __name__ == '__main__':
    unittest.main()
