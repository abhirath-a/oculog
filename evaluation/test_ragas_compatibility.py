"""Optional ENGINE fixtures, not judge-performance results. No live transport."""
import asyncio
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from evaluation.adapters import MeteredRun
from evaluation.offline import no_network


@unittest.skipUnless(importlib.util.find_spec('ragas'), 'Optional ragas==0.4.3 not installed')
class RagasEngineCompatibilityTests(unittest.TestCase):
    def test_all_four_real_metric_engines_with_scripted_gateway(self):
        os.environ['RAGAS_DO_NOT_TRACK'] = 'true'
        from evaluation.live import score_sample, METRICS
        from backend.education.provider import GeminiGateway
        # Actual 0.4.3 class imports are also exercised inside score_sample.
        from ragas.metrics import (Faithfulness, ResponseRelevancy,
                                   LLMContextPrecisionWithReference, LLMContextRecall)
        self.assertEqual(len((Faithfulness, ResponseRelevancy,
                              LLMContextPrecisionWithReference, LLMContextRecall)), 4)
        question, statement = 'What color is the synthetic cube?', 'The synthetic cube is blue.'
        scripts = [
            ('Given a question and an answer, analyze', {'statements': [statement]}),
            ('Your task is to judge the faithfulness', {'statements': [{'statement': statement, 'reason': 'Fixture entailment', 'verdict': 1}]}),
            *[('Generate a question for the given answer', {'question': question, 'noncommittal': 0}) for _ in range(3)],
            ('Given question, answer and context verify', {'reason': 'Fixture relevance', 'verdict': 1}),
            ('Given a context, and an answer, analyze', {'classifications': [{'statement': statement, 'reason': 'Fixture attribution', 'attributed': 1}]}),
        ]
        calls, embeddings = [], []
        def transport(url, headers, body, timeout):
            body = json.loads(body)
            if url.endswith(':embedContent'):
                embeddings.append(body)
                return {'embedding': {'values': [0.125] * 768}}
            prefix, response = scripts[len(calls)]
            self.assertTrue(body['input'].startswith(prefix), body['input'][:150])
            self.assertIn('metric', body['system_instruction'])
            self.assertFalse(body['store'])
            calls.append(body)
            return {'status': 'completed', 'steps': [{'type': 'model_output', 'content': [{'type': 'text', 'text': json.dumps(response)}]}],
                    'usage': {'total_input_tokens': 10, 'total_output_tokens': 5, 'total_thought_tokens': 2,
                              'total_tokens': 17, 'total_tool_use_tokens': 0}}
        env = {'OCULOG_GEMINI_API_KEY': 'synthetic-not-a-real-key', 'OCULOG_GEMINI_ENABLED': 'true',
               'OCULOG_GEMINI_PAID_PROJECT_ACK': 'true', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK': 'true',
               'OCULOG_GEMINI_PRICE_ACK': '2026-10-23.standard.usd'}
        case = {'question': question, 'service': {'response': {'paragraphs': [{'text': statement}],
                'sources': [{'excerpt': statement}]}}, 'resolved_evidence': [{'quote': statement}]}
        with tempfile.TemporaryDirectory() as temp, no_network(), \
                patch('ragas.llms.base.llm_factory', side_effect=AssertionError('Unmetered LLM factory')), \
                patch('ragas.embeddings.base.embedding_factory', side_effect=AssertionError('Unmetered embedding factory')):
            gateway = GeminiGateway(Path(temp) / 'synthetic.sqlite3', environ=env, transport=transport,
                                    clock=lambda: datetime(2026, 10, 23, 12, tzinfo=timezone.utc))
            metered = MeteredRun(gateway)
            results = asyncio.run(score_sample(metered, case))
            self.assertEqual(set(results), set(METRICS))
            for result in results.values():
                self.assertEqual(result['status'], 'RUN', results)
                self.assertAlmostEqual(result['value'], 1.0)  # ENGINE FIXTURE ONLY; never exported.
            self.assertEqual(len(calls), 7)
            self.assertEqual(len(embeddings), 4)
            ledger = metered.ledger_report()
            self.assertEqual(len(ledger['operations']), 11)
            self.assertTrue(all(o['purpose'] == 'evaluation' for o in ledger['operations']))
            self.assertEqual(sum(o['state'] == 'settled' for o in ledger['operations']), 7)
            self.assertLess(float(ledger['run_liability_usd']), 0.01)


if __name__ == '__main__':
    unittest.main()
