"""Optional real RAGAS metrics. Never imported by the default offline command."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import importlib.metadata
import math
import os
from pathlib import Path
import time

from .adapters import MeteredRun, ragas_adapters, validate_shared_ledger
from .offline import DATASET, digest, not_run, run

METRICS = ('faithfulness', 'response_relevancy', 'context_precision_with_reference', 'context_recall')


def disable_telemetry():
    """Do not inherit optional tracing services or analytics from the host shell."""
    os.environ['RAGAS_DO_NOT_TRACK'] = 'true'
    for key in ('LANGSMITH_TRACING', 'LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2'):
        os.environ[key] = 'false'


async def score_sample(gateway, case, max_output_tokens=512):
    """Actual single_turn_ascore, not canned values or mock evaluate()."""
    disable_telemetry()
    from ragas import SingleTurnSample
    from ragas.metrics import (Faithfulness, ResponseRelevancy,
                               LLMContextPrecisionWithReference, LLMContextRecall)
    llm, embeddings, config = ragas_adapters(gateway, max_output_tokens)
    response = case['service']['response']
    sample = SingleTurnSample(user_input=case['question'],
                              response='\n\n'.join(p['text'] for p in response['paragraphs']),
                              retrieved_contexts=[s['excerpt'] for s in response['sources']],
                              reference='\n'.join(e['quote'] for e in case['resolved_evidence']))
    metrics = [Faithfulness(llm=llm), ResponseRelevancy(llm=llm, embeddings=embeddings),
               LLMContextPrecisionWithReference(llm=llm), LLMContextRecall(llm=llm)]
    result = {name: not_run('Not yet executed') for name in METRICS}
    for name, metric in zip(METRICS, metrics):
        started = time.perf_counter()
        try:
            metric.init(config)
            value = float(await metric.single_turn_ascore(sample))
            if not math.isfinite(value):
                raise ValueError('Judge returned a non-finite metric')
            result[name] = {'value': value, 'status': 'RUN', 'denominator': 1,
                            'latency_ms': (time.perf_counter() - started) * 1000}
        except Exception as exc:
            # Abort rather than spending additional money after any failure.
            result[name] = {'value': None, 'status': 'ERROR', 'denominator': 0,
                            'reason': type(exc).__name__, 'latency_ms': (time.perf_counter() - started) * 1000}
            for pending in METRICS[METRICS.index(name) + 1:]:
                result[pending] = not_run('Aborted after prior metric failure; no fallback judge')
            break
    return result


def prepare_answer(metered, case, answer_mode, report):
    """Build the actual candidate; never fall back to local text after failure."""
    from backend.education import service, topics
    from backend.education.provider import EDUCATION_PROFILE_REVISION
    if answer_mode not in ('local', 'generated'):
        raise ValueError('Unknown answer mode')
    report.update(answer_mode=answer_mode, prompt_revision=service.PROMPT_REVISION,
                  schema_revision=service.ANSWER_SCHEMA_REVISION,
                  profile_revision=EDUCATION_PROFILE_REVISION)
    if answer_mode == 'local':
        return case
    response = case['service']['response']
    language = response['language']
    topic = topics.resolve(case['question'], language)
    if topic is None:
        raise ValueError('Generated mode requires the actual resolver to select a reviewed topic')
    passages = [dict(s, text=s['excerpt']) for s in response['sources']]
    generated = metered.complete_answer(service.build_generation_prompt(topic, language, passages),
                                       schema=service.ANSWER_SCHEMA, max_output_tokens=512)
    # Record charged usage even when the runtime whole-chunk validator rejects it.
    report['candidate'] = {k: generated[k] for k in ('model', 'usage', 'operation_id', 'cost')}
    report['candidate']['status'] = 'ERROR'
    paragraphs = service.validate_generation(generated['text'], passages)
    candidate = deepcopy(case)
    answer = candidate['service']['response']
    answer.update(mode='generated', reason=None, paragraphs=paragraphs,
                  title='AI-selected source excerpts' if language == 'en' else 'Extractos de fuentes seleccionados por IA')
    answer['provenance']['model'] = generated['model']
    candidate['service']['mode'] = 'generated'
    report['candidate']['status'] = 'RUN'
    return candidate


def live(args):
    """Preflight first. Synthetic auth isolation must never replace the paid ledger."""
    report = {'schema_version': 1, 'mode': 'paid-ragas', 'status': 'NOT_RUN',
              'created_at': datetime.now(timezone.utc).isoformat(),
              'metrics': {name: not_run('Paid preflight not passed') for name in METRICS},
              'answer_mode': getattr(args, 'answer_mode', 'generated'), 'errors': []}
    metered = None
    try:
        if not args.allow_paid:
            raise ValueError('Explicit --allow-paid required')
        if Path(args.dataset).resolve() != DATASET.resolve():
            raise ValueError('Paid mode only accepts the versioned fixed synthetic dataset')
        for key in ('OCULOG_GEMINI_ENABLED', 'OCULOG_GEMINI_PAID_PROJECT_ACK', 'OCULOG_GEMINI_ADULT_AUDIENCE_ACK'):
            if os.environ.get(key) != 'true':
                raise ValueError('Operator acknowledgment missing: ' + key)
        if not os.environ.get('OCULOG_GEMINI_API_KEY') or os.environ.get('OCULOG_GEMINI_PRICE_ACK') != '2026-10-23.standard.usd':
            raise ValueError('Dedicated server key and supported price acknowledgment required')
        if not args.shared_ledger:
            raise ValueError('Explicit --shared-ledger matching existing application OCULOG_DB_PATH required')
        if digest(DATASET.read_bytes()) != '4a19bd86607d3cb96d2b557351d3416fd8838ed927dd625445a500a244c6ed26':
            raise ValueError('Synthetic dataset changed; review and version the paid allowlist before sending')
        if args.corpus is not None:
            raise ValueError('Paid mode accepts only the application approved public corpus, not custom corpus input')
        ledger, check = validate_shared_ledger(args.shared_ledger, os.environ)
        from backend.education.provider import GeminiGateway
        gateway = GeminiGateway(ledger)
        status = gateway.status()
        if not status['available']:
            raise ValueError('Gateway unavailable: ' + status['reason'])
        # Provider purpose=evaluation has its own public-synthetic judge system
        # instruction; transport unit tests verify it does not force education JSON.
        # Disable optional RAGAS analytics before importing any RAGAS module.
        disable_telemetry()
        if importlib.metadata.version('ragas') != '0.4.3':
            raise ValueError('Optional pinned ragas==0.4.3 required')
        offline = run(args.dataset, args.corpus, args.k)
        if offline['status'] != 'RUN':
            raise ValueError('Offline evidence/service checks must pass before any paid call')
        case = next((r for r in offline['cases'] if r['id'] == args.case_id), None)
        if not case or case['category'] != 'education' or case.get('label_errors') or case.get('service', {}).get('mode') != 'local_retrieval':
            raise ValueError('Selected fixed synthetic case needs exact evidence and an actual source-backed local service response')
        metered = MeteredRun(gateway, args.max_run_usd, check)
        report.update({'case_id': args.case_id, 'dataset_sha256': offline['config']['dataset_sha256'],
                       'corpus': offline['corpus'], 'retrieval_k': args.k, 'seed': 0,
                       'prompt_revision': offline['config']['prompt_revision'],
                       'model': gateway.price['model'], 'embedding_model': gateway.price['embedding_model'],
                       'pricing': gateway.price, 'local_service_sample': case,
                       'software': offline['config']['software'],
                       'installed_package_versions': sorted(f"{d.metadata['Name']}=={d.version}" for d in importlib.metadata.distributions()),
                       'shared_ledger': str(ledger),
                       'generation_mode': 'AI whole-public-chunk selection' if report['answer_mode'] == 'generated' else 'local verbatim source baseline; no AI generation',
                       'notes': ['Generated mode judges the actual validated gateway candidate; local mode judges local service excerpts.',
                                 'Source quotations are narrow reference spans, not exhaustive human gold answers.',
                                 'The $1 default run limit counts settled actual costs plus outstanding and unknown full reservations; verified completions release unused slack.',
                                 'There is no application monthly spend cap; all purposes share the SQLite usage ledger. Failures and embedding usage without verified costs retain full per-run quotes.',
                                 'Faithfulness is not medical validation; baseline has no comparable captured source contexts.']})
        started = time.perf_counter()
        report['metrics'] = {name: not_run('Candidate not yet validated; no judge called') for name in METRICS}
        case = prepare_answer(metered, case, report['answer_mode'], report)
        report['sample'] = case
        report['metrics'] = asyncio.run(score_sample(metered, case))
        report['latency_ms'] = (time.perf_counter() - started) * 1000
        report['status'] = 'RUN' if all(m['status'] == 'RUN' for m in report['metrics'].values()) else 'PARTIAL'
    except Exception as exc:
        # Never serialize provider prompts, raw HTTP errors, keys, or user data.
        safe = str(exc) if isinstance(exc, (ValueError, FileNotFoundError, importlib.metadata.PackageNotFoundError)) else type(exc).__name__
        report['errors'].append({'type': type(exc).__name__, 'reason': safe})
        if metered:
            report['status'] = 'ERROR'
    finally:
        if metered:
            report['ledger'] = metered.ledger_report()
    return report
