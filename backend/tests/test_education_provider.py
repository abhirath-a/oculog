"""Fake HTTP only; verifies wire and strict usage reconciliation."""
from contextlib import closing
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from backend.education.provider import GeminiGateway, GatewayError, NoRedirect
from backend.education.budget import money_units

NOW = datetime(2026, 10, 23, 5, tzinfo=timezone.utc)
ENV = {'OCULOG_GEMINI_API_KEY': 'synthetic-test-only', 'OCULOG_GEMINI_ENABLED': 'true',
       'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
       'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}


def response():
    return {'status': 'completed', 'steps': [{'type': 'model_output', 'content': [{'type': 'text', 'text': '{"paragraphs":[]}'}]}],
            'usage': {'total_input_tokens': 100, 'total_output_tokens': 20, 'total_thought_tokens': 22,
                      'total_tokens': 142, 'total_tool_use_tokens': 0, 'total_cached_tokens': 0}}


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'ledger.sqlite3'
        self.calls = []
        self.result = response()

    def transport(self, url, headers, body, timeout):
        self.calls.append((url, headers, json.loads(body), timeout))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def gateway(self, env=None, clock=None):
        return GeminiGateway(self.path, environ=ENV if env is None else env, transport=self.transport, clock=clock or (lambda: NOW))

    def charged(self):
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute('SELECT SUM(charged) FROM education_budget_operations').fetchone()[0]

    def test_interactions_wire_and_usage_no_double_count(self):
        gateway = self.gateway()
        self.assertEqual(gateway.reservation(), money_units('0.3158528'))
        output = gateway.complete('public synthetic prompt', schema={'type': 'object'})
        self.assertEqual(self.charged(), money_units('0.000135'))
        self.assertEqual(output['cost'], '0.000135000')
        url, headers, body, _ = self.calls[0]
        self.assertEqual(url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
        self.assertNotIn('?', url)
        self.assertEqual(headers['x-goog-api-key'], 'synthetic-test-only')
        self.assertEqual(set(body), {'model', 'service_tier', 'input', 'system_instruction', 'store', 'stream', 'background', 'tools', 'generation_config', 'response_format'})
        self.assertFalse(body['store'])
        self.assertFalse(body['background'])
        self.assertEqual(body['tools'], [])
        self.assertEqual(body['generation_config']['max_output_tokens'], 512)
        self.assertEqual(body['generation_config']['thinking_level'], 'minimal')
        self.assertEqual(len(self.calls), 1)

    def test_ack_key_expiry_and_future_date(self):
        for key in ENV:
            env = dict(ENV)
            del env[key]
            with self.subTest(key=key):
                gateway = self.gateway(env)
                self.assertFalse(gateway.status()['available'])
                with self.assertRaises(GatewayError):
                    gateway.complete('public')
        self.assertFalse(self.gateway(clock=lambda: NOW + timedelta(days=31)).status()['available'])
        self.assertFalse(self.gateway(clock=lambda: NOW - timedelta(days=1)).status()['available'])
        self.assertEqual(self.calls, [])

    def test_unknown_usage_retained_and_configuration_disabled_across_restart(self):
        del self.result['usage']['total_thought_tokens']
        gateway = self.gateway()
        with self.assertRaisesRegex(GatewayError, 'usage_contract_invalid'):
            gateway.complete('public')
        self.assertEqual(self.charged(), gateway.reservation())
        self.assertEqual(self.gateway().status()['reason'], 'usage_contract_invalid')

    def test_timeout_no_retry_keeps_reservation(self):
        self.result = TimeoutError('private body MUST NOT escape')
        gateway = self.gateway()
        with self.assertRaisesRegex(GatewayError, '^provider_unavailable$'):
            gateway.complete('public')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.charged(), gateway.reservation())

    def test_output_thinking_bound_and_tools_fail_closed(self):
        for usage in ({'total_output_tokens': 500, 'total_thought_tokens': 22, 'total_tokens': 622},
                      {'total_tool_use_tokens': 1}, {'total_input_tokens': True},
                      {'total_input_tokens': 0, 'total_tokens': 42},
                      {'total_output_tokens': 0, 'total_tokens': 122}):
            with self.subTest(usage=usage):
                path = Path(self.tmp.name) / ('case' + str(len(list(Path(self.tmp.name).iterdir()))) + '.sqlite3')
                self.result = response()
                self.result['usage'].update(usage)
                gateway = GeminiGateway(path, environ=ENV, transport=self.transport, clock=lambda: NOW)
                with self.assertRaisesRegex(GatewayError, 'usage_contract_invalid'):
                    gateway.complete('public')

    def test_incomplete_or_legacy_shape_rejected(self):
        for result in ({**response(), 'status': 'incomplete'}, {**response(), 'steps': [], 'outputs': [{'text': 'legacy'}]}):
            self.result = result
            with self.assertRaisesRegex(GatewayError, 'provider_response_invalid'):
                self.gateway().complete('public')

    def test_pre_dispatch_auth_refund_and_redirect_handler(self):
        gateway = self.gateway()
        def reject(db):
            raise PermissionError('consent withdrawn')
        with self.assertRaises(PermissionError):
            gateway.complete('public', authorize=reject)
        self.assertEqual(self.charged(), 0)
        self.assertEqual(self.calls, [])
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid'))

    def test_evaluation_judge_schema_not_education_paragraphs_shared_ledger(self):
        schema = {'type': 'object', 'properties': {'verdict': {'type': 'integer'}, 'reason': {'type': 'string'}},
                  'required': ['verdict', 'reason']}
        self.result['steps'][0]['content'][0]['text'] = '{"verdict":1,"reason":"supported"}'
        gateway = self.gateway()
        output = gateway.complete('PUBLIC SYNTHETIC judge task', purpose='evaluation', schema=schema)
        self.assertEqual(json.loads(output['text'])['verdict'], 1)
        body = self.calls[0][2]
        self.assertEqual(body['response_format']['schema'], schema)
        self.assertIn('metric schema', body['system_instruction'])
        self.assertNotIn('paragraphs', body['system_instruction'])
        self.assertNotIn('FULL cited chunk', body['system_instruction'])
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT purpose,state FROM education_budget_operations').fetchone(), ('evaluation', 'settled'))
        gateway.budget.reserve('education-spend', money_units('20'), 'education')
        gateway.complete('PUBLIC SYNTHETIC', purpose='evaluation', schema=schema)
        self.assertEqual(len(self.calls), 2)

    def test_obsolete_monthly_environment_setting_is_ignored(self):
        for value in ('0', '0.01', '5.00', 'invalid'):
            with self.subTest(value=value):
                env = dict(ENV, OCULOG_AI_MONTHLY_LIMIT_USD=value)
                gateway = self.gateway(env)
                self.assertTrue(gateway.status()['available'])
                gateway.complete('public synthetic prompt')
        self.assertEqual(len(self.calls), 4)

    def test_authorize_uses_writer_connection_and_http_is_outside_transaction(self):
        gateway = self.gateway()
        seen = []
        def authorize(db):
            self.assertTrue(db.in_transaction)
            seen.append(db.execute('SELECT state FROM education_budget_operations').fetchone()['state'])
            # A second writer must be excluded by BEGIN IMMEDIATE.
            with closing(sqlite3.connect(self.path, timeout=0)) as other:
                with self.assertRaises(sqlite3.OperationalError):
                    other.execute('BEGIN IMMEDIATE')
        original = gateway.transport
        def transport(*args):
            # No writer lock survives dispatch commit, so a consent writer can run.
            with closing(sqlite3.connect(self.path, timeout=0)) as other:
                other.execute('BEGIN IMMEDIATE')
                self.assertEqual(other.execute('SELECT state FROM education_budget_operations').fetchone()[0], 'dispatched')
                other.commit()
            return original(*args)
        gateway.transport = transport
        gateway.complete('public', authorize=authorize)
        self.assertEqual(seen, ['reserved'])

    def test_education_instruction_requires_whole_chunks(self):
        self.gateway().complete('public')
        instruction = self.calls[0][2]['system_instruction']
        self.assertIn('FULL cited chunk verbatim', instruction)
        self.assertIn('omit negation', instruction)

    def test_embedding_metered_and_evaluation_only(self):
        self.result = {'embedding': {'values': [0.1] * 768}}
        gateway = self.gateway()
        self.assertEqual(len(gateway.embedding('public test')), 768)
        self.assertEqual(self.charged(), money_units('0.0016384'))
        with self.assertRaises(GatewayError):
            gateway.embedding('query', purpose='education')
