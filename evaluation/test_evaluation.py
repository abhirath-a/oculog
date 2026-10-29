"""Offline tests. Fake-gateway tests are adapter units, NOT actual RAGAS runs."""
import asyncio
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from evaluation.adapters import (GatewayEmbeddingLogic, GatewayLLMLogic, MeteredRun,
                                 RunBudgetExceeded, validate_shared_ledger)
from evaluation.offline import (DATASET, citation_check, frozen_matcher, load_dataset,
                                no_network, rank_metrics, resolve_evidence, run)


class DatasetTests(unittest.TestCase):
    def test_balanced_public_synthetic_labels_and_exact_spans(self):
        data = load_dataset()
        self.assertEqual(len(data['cases']), 32)
        self.assertEqual(sum(c['split'] == 'heldout' for c in data['cases']), 16)
        from backend.education.corpus import load_corpus
        corpus = load_corpus()
        for case in data['cases']:
            resolved, errors = resolve_evidence(case, corpus)
            self.assertEqual(errors, [], case['id'])
            self.assertEqual(len(resolved), len(case['evidence']))
            for evidence in resolved:
                self.assertTrue(evidence['chunk_ids'], case['id'])
                self.assertEqual(evidence['document_id'], evidence['label_document_id'])

    def test_frozen_matcher_hashes_and_no_fake_context(self):
        module, catalogue, manifest = frozen_matcher()
        self.assertEqual(len(manifest['files']), 2)
        self.assertFalse(module.answer_message(catalogue, 'zxqvabsolutelyunsupported')['matched'])

    def test_rank_metrics_include_misses_and_unique_docs(self):
        results = [{'id': 'a1', 'document_id': 'a'}, {'id': 'a2', 'document_id': 'a'}, {'id': 'b1', 'document_id': 'b'}]
        hit = rank_metrics(results, {'b', 'missing'})
        self.assertEqual(hit['doc_recall_at_k'], 0.5)
        self.assertEqual(hit['mrr'], 0.5)
        self.assertEqual(rank_metrics([], {'missing'})['mrr'], 0)
        self.assertIsNone(rank_metrics([], set())['doc_recall_at_k'])

    def test_real_fts5_determinism_and_misses(self):
        from backend.education.corpus import load_corpus
        from backend.education.retrieval import retrieve
        corpus = load_corpus()
        first = retrieve('saline disinfect', corpus=corpus)
        second = retrieve('saline disinfect', corpus=corpus)
        self.assertTrue(first)
        self.assertEqual(first, second)
        self.assertEqual(retrieve('zxqvunsupportedtoken', corpus=corpus), [])

    def test_missing_reference_not_silently_scored(self):
        from backend.education.corpus import load_corpus
        case = {'evidence': [{'url': 'https://www.cdc.gov/contact-lenses/prevention/index.html', 'document_id': 'cdc-prevent', 'quote': 'This is not public evidence.'}]}
        resolved, errors = resolve_evidence(case, load_corpus())
        self.assertEqual(resolved, [])
        self.assertTrue(errors)

    def test_no_network_guard(self):
        with no_network(), self.assertRaises(RuntimeError):
            socket.create_connection(('example.com', 443))

    def test_citation_checks_reject_unknown_and_duplicate_ids(self):
        c = {'id': 'real', 'text': 'public', 'document_id': 'doc', 'url': 'https://example.invalid'}
        response = {'mode': 'local_retrieval', 'sources': [{'id': 'real', 'excerpt': 'public', 'document_id': 'doc', 'url': 'https://example.invalid'}],
                    'paragraphs': [{'text': 'public', 'citations': ['real']}]}
        self.assertTrue(citation_check(response, {'chunks': [c]}))
        response['paragraphs'][0]['citations'] = ['invented']
        self.assertFalse(citation_check(response, {'chunks': [c]}))
        response['paragraphs'][0]['citations'] = ['real', 'real']
        self.assertFalse(citation_check(response, {'chunks': [c]}))

    def test_offline_hash_and_rank_reproducibility_with_nonperfect_results(self):
        a = run(service_checks=False)
        b = run(service_checks=False)
        self.assertEqual(a['ranking_sha256'], b['ranking_sha256'])
        self.assertEqual(a['config']['dataset_sha256'], b['config']['dataset_sha256'])
        self.assertEqual(a['corpus'], b['corpus'])
        self.assertEqual(a['corpus']['document_count'], 11)
        self.assertEqual(a['corpus']['chunk_count'], 53)
        self.assertEqual(a['coverage']['service']['all']['status'], 'NOT_RUN')
        self.assertIsNone(a['coverage']['service']['all']['education_coverage'])
        self.assertEqual(a['retrieval']['raw_lexical']['denominator'], 20)
        self.assertTrue(a['retrieval']['canonical_topic']['failures'])
        self.assertLess(a['retrieval']['raw_lexical']['doc_recall_at_k'], 1)
        for value in a['ragas'].values():
            self.assertIsNone(value['value'])
            self.assertEqual(value['status'], 'NOT_RUN')
        self.assertEqual(a['baseline_faithfulness']['status'], 'NOT_COMPARABLE')
        self.assertEqual(a['baseline_retrieval']['status'], 'NOT_APPLICABLE')

    def test_no_optional_metric_or_provider_import_on_offline_module_import(self):
        script = "import evaluation.offline,sys; assert not any(k.startswith(('ragas','pandas','datasets','google.genai','backend.education.provider')) for k in sys.modules)"
        subprocess.run([sys.executable, '-c', script], check=True)

    @unittest.skipUnless(importlib.util.find_spec('fastapi'), 'Optional actual-main runtime dependencies not installed')
    def test_actual_service_uses_synthetic_auth_db_provider_disabled(self):
        with patch.dict('os.environ', {'OCULOG_DB_PATH': '/definitely/not/used/real.sqlite3', 'OCULOG_GEMINI_API_KEY': 'must-not-use', 'OCULOG_GEMINI_ENABLED': 'true'}):
            report = run()
        self.assertEqual(report['service_checks']['status'], 'RUN')
        self.assertEqual(report['service_checks']['provider_operations'], 0)
        self.assertEqual(report['policy']['service']['denominator'], 12)
        self.assertEqual(report['policy']['service']['education_failures'], [])
        self.assertEqual(report['policy']['service']['education_coverage'], 1)
        self.assertEqual(report['policy']['service']['pass_count'], 12)
        from backend.education.service import PROMPT_REVISION
        self.assertEqual(report['config']['prompt_revision'], PROMPT_REVISION)
        for language in ('en', 'es'):
            self.assertEqual(report['coverage']['service'][language]['status'], 'RUN')
        for row in report['cases']:
            response = row.get('service', {}).get('response', {})
            if response.get('mode') == 'local_retrieval':
                chunks = {s['id']: s['excerpt'] for s in response['sources']}
                self.assertTrue(all(p['text'] == chunks[cid] for p in response['paragraphs'] for cid in p['citations']))

    def test_cli_offline_writes_real_results_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'report.json'
            command = [sys.executable, '-m', 'evaluation', 'offline', '--no-service-checks', '--output', str(output)]
            first = subprocess.run(command, check=True, capture_output=True, text=True)
            report = json.loads(output.read_text())
            self.assertEqual(json.loads(first.stdout)['status'], 'RUN')
            self.assertEqual(report['retrieval']['raw_lexical']['denominator'], 20)
            original = output.read_bytes()
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 2)
            self.assertIn('Refusing to overwrite', second.stderr)
            self.assertEqual(output.read_bytes(), original)

    def test_whole_chunk_extractive_generation_contract_offline(self):
        from backend.education.service import validate_generation
        from backend.education.provider import GatewayError
        chunks = [{'id': 'public', 'text': 'Never use water to clean or store contact lenses.'}]
        answer = {'paragraphs': [{'text': chunks[0]['text'], 'citations': ['public']}]}
        self.assertEqual(validate_generation(json.dumps(answer), chunks), answer['paragraphs'])
        for text in ('use water to clean or store contact lenses.', 'Keep lenses away from water.'):
            answer['paragraphs'][0]['text'] = text
            with self.assertRaises(GatewayError):
                validate_generation(json.dumps(answer), chunks)


class AdapterUnitTests(unittest.TestCase):
    """Synthetic adapter plumbing only; these never import or score with RAGAS."""
    def test_multiplicity_async_and_finished_contract(self):
        calls = []
        class FakeLLM(GatewayLLMLogic):
            gateway = SimpleNamespace(complete=lambda text, **kw: calls.append((text, kw)) or {'text': 'synthetic'})
            max_output_tokens = 512
            @staticmethod
            def make_result(texts):
                return SimpleNamespace(generations=[[SimpleNamespace(text=t, generation_info={'finish_reason': 'completed'}) for t in texts]])
        model = FakeLLM()
        result = asyncio.run(model.agenerate_text(SimpleNamespace(to_string=lambda: 'public synthetic prompt'), n=3))
        self.assertEqual(len(calls), 3)
        self.assertTrue(model.is_finished(result))
        result.generations[0][0].generation_info['finish_reason'] = 'incomplete'
        self.assertFalse(model.is_finished(result))
        with self.assertRaises(ValueError):
            model.generate_text(SimpleNamespace(), stop=['stop'])

    def test_query_documents_sync_async_use_same_gateway(self):
        calls = []
        class FakeEmbeddings(GatewayEmbeddingLogic):
            gateway = SimpleNamespace(embedding=lambda text: calls.append(text) or [0.0] * 768)
        embedding = FakeEmbeddings()
        self.assertEqual(len(embedding.embed_query('synthetic')), 768)
        self.assertEqual(len(asyncio.run(embedding.aembed_documents(['a', 'b']))), 2)
        self.assertEqual(calls, ['task: search result | query: synthetic', 'title: evaluation | text: a', 'title: evaluation | text: b'])

    def test_run_cap_independent_of_shared_usage_unknowns_retained(self):
        from backend.education.provider import GeminiGateway
        env = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-a-real-key', 'OCULOG_GEMINI_ENABLED': 'true',
               'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
               'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}
        from datetime import datetime, timezone
        from backend.education.provider import GatewayError
        with tempfile.TemporaryDirectory() as temp:
            calls = []
            def unavailable(*args):
                calls.append(args)
                raise TimeoutError('Synthetic unknown delivery')
            gateway = GeminiGateway(Path(temp) / 'synthetic.sqlite3', environ=env, transport=unavailable,
                                    clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
            metered = MeteredRun(gateway, '1.00')
            for _ in range(3):
                with self.assertRaises(GatewayError):
                    metered.complete('synthetic public judge prompt')
            with self.assertRaises(RunBudgetExceeded):
                metered.complete('synthetic public judge prompt')
            self.assertEqual(len(calls), 3)
            report = metered.ledger_report()
            self.assertEqual(len(report['operations']), 3)
            self.assertGreater(float(report['unknown_reservations_usd']), 0.9)
            self.assertTrue(all(o['purpose'] == 'evaluation' for o in report['operations']))
            from decimal import Decimal
            self.assertEqual(MeteredRun(gateway, '25').limit, Decimal('25'))
            for invalid in ('0', '-1', 'NaN', 'Infinity', '-Infinity'):
                with self.assertRaises(ValueError):
                    MeteredRun(gateway, invalid)
            # Heavy prior application usage remains recorded, not a monthly gate.
            from backend.education.budget import Budget
            shared = Budget(gateway.budget.path, clock=gateway.clock)
            shared.reserve('synthetic-other-app-operation', 20_000_000_000, 'education')
            another_run = MeteredRun(gateway, '1.00')
            with self.assertRaises(GatewayError) as caught:
                another_run.complete('synthetic public judge prompt')
            self.assertEqual(caught.exception.reason, 'provider_unavailable')
            self.assertEqual(len(calls), 4)

    def test_actual_embedding_gateway_768_full_reservation_and_run_ceiling(self):
        from backend.education.provider import GeminiGateway
        from backend.education.budget import money_units
        from datetime import datetime, timezone
        from decimal import Decimal
        env = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-a-real-key', 'OCULOG_GEMINI_ENABLED': 'true',
               'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
               'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}
        requests = []
        def transport(url, headers, body, timeout):
            requests.append(json.loads(body))
            return {'embedding': {'values': [0.125] * 768}}
        with tempfile.TemporaryDirectory() as temp:
            gateway = GeminiGateway(Path(temp) / 'synthetic.sqlite3', environ=env, transport=transport,
                                    clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
            metered = MeteredRun(gateway, '0.002')
            self.assertEqual(metered.embedding('synthetic public excerpt'), [0.125] * 768)
            self.assertEqual(requests[0]['outputDimensionality'], 768)
            operation = metered.ledger_report()['operations'][0]
            full = money_units(Decimal(gateway.price['embedding_input_limit']) * Decimal(gateway.price['embedding_usd_per_million']) / 1_000_000)
            self.assertEqual(operation['reserved_nano_usd'], full)
            self.assertEqual(operation['charged_nano_usd'], full)
            self.assertEqual(operation['purpose'], 'evaluation')
            with self.assertRaises(RunBudgetExceeded):
                metered.embedding('another public excerpt')
            self.assertEqual(len(requests), 1)

    def test_actual_gateway_evaluation_instruction_does_not_force_education_shape(self):
        from backend.education.provider import GeminiGateway
        from datetime import datetime, timezone
        env = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-a-real-key', 'OCULOG_GEMINI_ENABLED': 'true',
               'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
               'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}
        requests = []
        def transport(url, headers, body, timeout):
            requests.append(json.loads(body))
            return {'status': 'completed', 'steps': [{'type': 'model_output', 'content': [{'type': 'text', 'text': '{"statements": []}'}]}],
                    'usage': {'total_input_tokens': 10, 'total_output_tokens': 5, 'total_thought_tokens': 2,
                              'total_tokens': 17, 'total_tool_use_tokens': 0}}
        with tempfile.TemporaryDirectory() as temp:
            gateway = GeminiGateway(Path(temp) / 'synthetic.sqlite3', environ=env, transport=transport,
                                    clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
            metered = MeteredRun(gateway)
            result = metered.complete('Synthetic public metric task; return statements JSON')
            self.assertEqual(result['text'], '{"statements": []}')
            instruction = requests[0]['system_instruction']
            self.assertIn('metric', instruction.lower())
            self.assertNotIn('Return JSON paragraphs', instruction)
            self.assertFalse(requests[0]['store'])
            self.assertEqual(metered.ledger_report()['operations'][0]['purpose'], 'evaluation')

    def test_settlement_releases_slack_and_invalid_cost_keeps_full_quote(self):
        from backend.education.provider import GeminiGateway
        from datetime import datetime, timezone
        from decimal import Decimal
        env = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-a-real-key', 'OCULOG_GEMINI_ENABLED': 'true',
               'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
               'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}
        def transport(*args):
            return {'status': 'completed', 'steps': [{'type': 'model_output', 'content': [{'type': 'text', 'text': '{}'}]}],
                    'usage': {'total_input_tokens': 10, 'total_output_tokens': 5, 'total_thought_tokens': 2,
                              'total_tokens': 17, 'total_tool_use_tokens': 0}}
        with tempfile.TemporaryDirectory() as temp:
            gateway = GeminiGateway(Path(temp) / 'synthetic.sqlite3', environ=env, transport=transport,
                                    clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
            metered = MeteredRun(gateway)
            for _ in range(8):
                metered.complete('public synthetic prompt')
            report = metered.ledger_report()
            self.assertEqual(len(report['operations']), 8)
            self.assertGreater(Decimal(report['cumulative_authorized_reservation_usd']), 2)
            self.assertEqual(Decimal(report['run_liability_usd']), Decimal(report['settled_cost_usd']))
            complete = gateway.complete
            before = metered.reserved
            with self.assertRaises(ValueError):
                metered.complete('public synthetic prompt', max_output_tokens=-1_000_000)
            self.assertEqual(metered.reserved, before)
            for cost in ('NaN', 'not-decimal', '-1', '0.4', '0', 0):
                # Even a settled real operation cannot justify an untrusted return cost.
                def tampered(*args, **kwargs):
                    return dict(complete(*args, **kwargs), cost=cost)
                other = MeteredRun(gateway, '0.32')
                with patch.object(gateway, 'complete', side_effect=tampered), self.assertRaises((ValueError, ArithmeticError)):
                    other.complete('public synthetic prompt')
                self.assertEqual(Decimal(other.ledger_report()['run_unknown_holds_usd']), Decimal('0.3158528'))
                with self.assertRaises(RunBudgetExceeded):
                    other.complete('public synthetic prompt')

    def test_concurrent_quotes_and_timeout_never_overrun_run_limit(self):
        from backend.education.provider import GeminiGateway, GatewayError
        from datetime import datetime, timezone
        from concurrent.futures import ThreadPoolExecutor
        import threading
        env = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-a-real-key', 'OCULOG_GEMINI_ENABLED': 'true',
               'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
               'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}
        barrier = threading.Barrier(3)
        def transport(*args):
            barrier.wait(timeout=10)
            raise TimeoutError('synthetic delivery unknown')
        with tempfile.TemporaryDirectory() as temp:
            gateway = GeminiGateway(Path(temp) / 'synthetic.sqlite3', environ=env, transport=transport,
                                    clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
            metered = MeteredRun(gateway)
            def attempt(_):
                try:
                    metered.complete('public synthetic prompt')
                except (RunBudgetExceeded, GatewayError) as exc:
                    return type(exc).__name__
            with ThreadPoolExecutor(max_workers=8) as pool:
                outcomes = list(pool.map(attempt, range(8)))
            self.assertEqual(outcomes.count('GatewayError'), 3)
            self.assertEqual(outcomes.count('RunBudgetExceeded'), 5)
            report = metered.ledger_report()
            self.assertEqual(len(report['operations']), 3)
            self.assertLess(float(report['run_liability_usd']), 1)
            self.assertEqual(report['run_outstanding_quotes_usd'], '0E-7')

    def test_shared_ledger_validation_requires_existing_app_path_and_schema(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'app.sqlite3'
            with closing(sqlite3.connect(path)) as db:
                db.executescript('CREATE TABLE accounts(id); CREATE TABLE sessions(id);')
            with self.assertRaises(ValueError):
                validate_shared_ledger(path, {})
            with self.assertRaises(ValueError):
                validate_shared_ledger(path, {'OCULOG_DB_PATH': str(path)})
            from backend.education.budget import Budget
            Budget(path)
            resolved, check = validate_shared_ledger(path, {'OCULOG_DB_PATH': str(path)})
            self.assertEqual(resolved, path)
            check()
            different = Path(temp) / 'different.sqlite3'
            different.touch()
            with self.assertRaises(ValueError):
                validate_shared_ledger(different, {'OCULOG_DB_PATH': str(path)})

    def test_live_custom_dataset_rejected_before_gateway_or_environment(self):
        from evaluation.live import live
        with patch('backend.education.provider.GeminiGateway', side_effect=AssertionError('Must not construct')):
            report = live(SimpleNamespace(allow_paid=True, dataset=Path('/tmp/arbitrary-private.json')))
        self.assertEqual(report['status'], 'NOT_RUN')
        self.assertIn('fixed synthetic dataset', report['errors'][0]['reason'])

    def test_live_without_consent_does_not_construct_gateway(self):
        from evaluation.live import live
        with patch('backend.education.provider.GeminiGateway', side_effect=AssertionError('Must not construct')):
            report = live(SimpleNamespace(allow_paid=False))
        self.assertEqual(report['status'], 'NOT_RUN')
        self.assertTrue(all(m['value'] is None for m in report['metrics'].values()))


if __name__ == '__main__':
    unittest.main()
