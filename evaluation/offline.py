"""Read-only public corpus evaluation; stdlib only unless service tests are available."""
from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import importlib.metadata
import json
import platform
from pathlib import Path
import socket
import sqlite3
import tempfile
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / 'dataset/benchmark-v1.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stable_hash(value):
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode())


def not_run(reason, status='NOT_RUN'):
    return {'value': None, 'status': status, 'reason': reason, 'denominator': 0}


@contextmanager
def no_network():
    def blocked(*args, **kwargs):
        raise RuntimeError('External network forbidden in offline evaluation')
    with patch.object(socket.socket, 'connect', blocked), patch.object(socket.socket, 'connect_ex', blocked), patch.object(socket, 'create_connection', blocked):
        yield


def load_dataset(path=DATASET):
    data = json.loads(Path(path).read_bytes())
    cases = data['cases']
    if len({c['id'] for c in cases}) != len(cases):
        raise ValueError('Duplicate case IDs')
    for c in cases:
        if c['split'] not in ('dev', 'heldout') or not c['expected_modes']:
            raise ValueError('Invalid case labels')
        if c['category'] == 'education' and (c['language'] not in ('en', 'es') or not c['evidence']):
            raise ValueError('Education labels require supported language and source evidence')
    return data


def resolve_evidence(case, corpus):
    """Resolve canonical URLs to real documents, and exact quotes to real spans."""
    resolved, errors = [], []
    for evidence in case['evidence']:
        docs = [d for d in corpus['documents'] if d['url'] == evidence['url']]
        if len(docs) != 1:
            errors.append('canonical_url_missing_or_ambiguous:' + evidence['url'])
            continue
        doc, quote = docs[0], evidence['quote']
        start = doc['main_text'].find(quote)
        if start < 0:
            errors.append('quotation_missing:' + doc['id'])
            continue
        resolved.append({'document_id': doc['id'], 'label_document_id': evidence['document_id'],
                         'url': doc['url'], 'quote': quote, 'start': start, 'end': start + len(quote),
                         'quote_sha256': digest(quote.encode()),
                         'chunk_ids': [c['id'] for c in corpus['chunks'] if c['document_id'] == doc['id'] and quote in c['text']]})
    return resolved, errors


def rank_metrics(results, relevant):
    docs = list(dict.fromkeys(c['document_id'] for c in results))
    hits = set(docs) & set(relevant)
    return {'doc_recall_at_k': len(hits) / len(relevant) if relevant else None,
            'mrr': next((1 / rank for rank, did in enumerate(docs, 1) if did in relevant), 0.0) if relevant else None,
            'document_ranking': docs,
            'chunk_ranking': [c['id'] for c in results]}


def frozen_matcher():
    manifest = json.loads((ROOT / 'baseline/provenance.json').read_bytes())
    for f in manifest['files']:
        if digest((ROOT.parent / f['frozen']).read_bytes()) != f['sha256']:
            raise ValueError('Frozen baseline hash mismatch')
    spec = importlib.util.spec_from_file_location('oculog_frozen_advice', ROOT / 'baseline/advice.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, module.load_catalogue(ROOT / 'baseline/advice.json'), manifest


def baseline_result(module, catalogue, case):
    start = time.perf_counter()
    response = module.answer_message(catalogue, case['question'])
    mode = ('safety' if response['urgency'] in ('urgent', 'emergency') else
            'prepared' if response['matched'] else 'abstained')
    # Never use these prepared paragraphs as their own reference context.
    return {'response': response, 'mode': mode, 'answered': mode == 'prepared',
            'policy_pass': mode in case['expected_modes'] if case['category'] != 'education' else None,
            'latency_ms': (time.perf_counter() - start) * 1000,
            'faithfulness': not_run('Actual legacy cited source paragraphs are unavailable; prepared answers are not contexts', 'NOT_COMPARABLE')}


def citation_check(response, corpus):
    if response['mode'] not in ('local_retrieval', 'generated'):
        return None
    by_id = {c['id']: c for c in corpus['chunks']}
    sources = response['sources']
    source_ids = [s['id'] for s in sources]
    if len(source_ids) != len(set(source_ids)):
        return False
    if any(s['id'] not in by_id or s.get('excerpt') != by_id[s['id']]['text'] or
           s.get('document_id') != by_id[s['id']]['document_id'] or s.get('url') != by_id[s['id']]['url'] for s in sources):
        return False
    return bool(response['paragraphs']) and all(
        bool(p['citations']) and len(p['citations']) == len(set(p['citations'])) and
        all(cid in source_ids for cid in p['citations']) for p in response['paragraphs'])


@contextmanager
def isolated_service(corpus):
    """Use actual auth/service code, but only a throwaway SQLite file, no real records."""
    from backend import main
    from backend.education import service
    from backend.education.provider import GeminiGateway
    with tempfile.TemporaryDirectory(prefix='oculog-evaluation-auth-') as directory:
        path = Path(directory) / 'synthetic.sqlite3'
        with patch.dict('os.environ', {'OCULOG_DB_PATH': str(path), 'OCULOG_GEMINI_ENABLED': 'false', 'OCULOG_GEMINI_API_KEY': ''}), \
             patch.object(service, 'GeminiGateway', lambda db_path: GeminiGateway(db_path, environ={})), \
             patch.object(GeminiGateway, 'complete', side_effect=AssertionError('Provider must remain disabled')), \
             patch.object(GeminiGateway, 'embedding', side_effect=AssertionError('Provider must remain disabled')), \
             patch.object(service, 'load_corpus', lambda: corpus):
            main.initialize()
            token = 'e' * 43
            with main.connection() as db:
                db.execute('INSERT INTO accounts VALUES (?,?,?,?,?)', ('evaluation-synthetic', 'evaluation@example.invalid', 'unused', 'Synthetic', 'UTC'))
                db.execute('INSERT INTO sessions VALUES (?,?,?,0)', (digest(token.encode()), 'evaluation-synthetic', int(time.time()) + 3600))
            def call(case):
                started = time.perf_counter()
                try:
                    response = json.loads(service.action('answer', {'message': case['question'], 'language': case['language'], 'use_ai': False}, 'Bearer ' + token, main).body)
                    mode = response['mode']
                    citations = citation_check(response, corpus)
                    language_ok = all(s['language'] == case['language'] for s in response['sources'])
                    return {'status': 'RUN', 'response': response, 'mode': mode,
                            'policy_pass': mode in case['expected_modes'], 'citations_valid': citations,
                            'source_language_valid': language_ok, 'latency_ms': (time.perf_counter() - started) * 1000}
                except main.Problem as exc:
                    # Validation rejection is an outcome, not an unrun service test.
                    return {'status': 'RUN', 'mode': 'rejected', 'error': {'status': exc.status, 'code': exc.code},
                            'policy_pass': 'rejected' in case['expected_modes'], 'citations_valid': None,
                            'source_language_valid': None, 'latency_ms': (time.perf_counter() - started) * 1000}
            yield call
            with main.connection() as db:
                if db.execute('SELECT COUNT(*) FROM education_budget_operations').fetchone()[0]:
                    raise AssertionError('Offline service created provider ledger operations')


def aggregate(rows, key, language=None):
    selected = [r for r in rows if r['category'] == 'education' and (language is None or r['language'] == language)]
    valid = [r[key] for r in selected if r.get(key, {}).get('status') == 'RUN']
    return {'status': 'RUN' if valid else 'NOT_RUN', 'denominator': len(valid), 'eligible': len(selected),
            'doc_recall_at_k': sum(v['doc_recall_at_k'] for v in valid) / len(valid) if valid else None,
            'mrr': sum(v['mrr'] for v in valid) / len(valid) if valid else None,
            'failures': [r['id'] for r in selected if r.get(key, {}).get('doc_recall_at_k') != 1.0]}


def run(dataset_path=DATASET, corpus_path=None, k=4, service_checks=True):
    if type(k) is not int or not 1 <= k <= 10:
        raise ValueError('k must be 1..10')
    data = load_dataset(dataset_path)
    module, catalogue, baseline = frozen_matcher()
    cases = data['cases']
    pricing_path = ROOT.parent / 'backend/education/pricing.json'
    configured_pricing = json.loads(pricing_path.read_bytes()) if pricing_path.exists() else None
    code_paths = [ROOT.parent / 'backend' / path for path in ('main.py', 'education/corpus.py', 'education/retrieval.py', 'education/topics.py', 'education/service.py', 'education/provider.py', 'education/budget.py')]
    code_hashes = {str(p.relative_to(ROOT.parent)): digest(p.read_bytes()) for p in code_paths if p.exists()}
    optional_versions = {}
    for name in ('fastapi', 'starlette', 'pydantic', 'ragas'):
        try:
            optional_versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            optional_versions[name] = None
    report = {'schema_version': 1, 'mode': 'offline', 'status': 'RUN',
              'created_at': datetime.now(timezone.utc).isoformat(),
              'config': {'seed': 0, 'retrieval_k': k, 'dataset_version': data['version'],
                         'dataset_sha256': digest(Path(dataset_path).read_bytes()),
                         'prompt_revision': None, 'model': None,
                         'pricing_revision': None, 'provider_enabled': False, 'network_enabled': False,
                         'configured_pricing_not_used': configured_pricing,
                         'configured_pricing_sha256': digest(pricing_path.read_bytes()) if pricing_path.exists() else None,
                         'service_retrieval_k': 4, 'application_code_sha256': code_hashes,
                         'software': {'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version, **optional_versions}}, 
              'dataset_provenance': data['provenance'], 'baseline_provenance': baseline,
              'errors': [], 'cases': [],
              'ragas': {name: not_run('Paid evaluation not enabled; no live calls made') for name in
                        ('faithfulness', 'response_relevancy', 'context_precision_with_reference', 'context_recall')},
              'baseline_retrieval': not_run('Prepared JSON matcher is not a retriever', 'NOT_APPLICABLE'),
              'baseline_faithfulness': not_run('No independently captured legacy cited source paragraphs; never use baseline answers as contexts', 'NOT_COMPARABLE')}
    with no_network():
        try:
            from backend.education.corpus import load_corpus
            from backend.education.retrieval import retrieve
            from backend.education import topics
            corpus = load_corpus(corpus_path)
            report['corpus'] = {'revision': corpus['revision'], 'extractor_version': corpus['extractor_version'],
                                'document_hashes': {d['id']: d['content_sha256'] for d in corpus['documents']},
                                'chunk_hashes': {c['id']: c['content_sha256'] for c in corpus['chunks']},
                                'document_count': len(corpus['documents']), 'chunk_count': len(corpus['chunks']),
                                'documents_by_language': dict(Counter(d['language'] for d in corpus['documents'])),
                                'chunks_by_language': dict(Counter(c['language'] for c in corpus['chunks']))}
        except (ImportError, ValueError, OSError) as exc:
            corpus = None
            report['status'] = 'PARTIAL'
            report['errors'].append({'stage': 'corpus', 'type': type(exc).__name__, 'reason': str(exc)})
        for case in cases:
            row = {key: case[key] for key in ('id', 'split', 'language', 'category', 'question', 'expected_modes')}
            row['baseline'] = baseline_result(module, catalogue, case)
            if case['category'] == 'education' and corpus:
                evidence, errors = resolve_evidence(case, corpus)
                row['resolved_evidence'], row['label_errors'] = evidence, errors
                relevant = {e['document_id'] for e in evidence}
                for name in ('raw_lexical', 'canonical_topic'):
                    if errors or not relevant:
                        row[name] = not_run('Source labels do not resolve to exact corpus spans', 'NOT_COMPARABLE')
                        continue
                    started = time.perf_counter()
                    if name == 'raw_lexical':
                        results = retrieve(case['question'], language=case['language'], limit=k, corpus=corpus)
                    else:
                        # Resolve the actual message, not the benchmark's oracle topic label.
                        topic = topics.resolve(case['question'], case['language'])
                        results = ([c for c in retrieve(topic['query_' + case['language']], language=case['language'], limit=10, corpus=corpus)
                                    if c['language'] == case['language']][:k] if topic else [])
                    row[name] = {'status': 'RUN', **rank_metrics(results, relevant),
                                 'source_language_failures': [c['id'] for c in results if c['language'] != case['language']],
                                 'retrieved_contexts': [c['text'] for c in results],
                                 'latency_ms': (time.perf_counter() - started) * 1000}
            else:
                for name in ('raw_lexical', 'canonical_topic'):
                    row[name] = not_run('Not an education retrieval case' if corpus else 'Corpus unavailable', 'NOT_APPLICABLE' if corpus else 'NOT_RUN')
            report['cases'].append(row)
        if corpus and service_checks:
            try:
                with isolated_service(corpus) as call:
                    from backend.education.service import PROMPT_REVISION
                    report['config']['prompt_revision'] = PROMPT_REVISION
                    for case, row in zip(cases, report['cases']):
                        row['service'] = call(case)
                        if case['category'] == 'education' and row.get('resolved_evidence') and not row.get('label_errors'):
                            actual_sources = row['service'].get('response', {}).get('sources', [])
                            row['service_retrieval'] = {'status': 'RUN', **rank_metrics(actual_sources, {e['document_id'] for e in row['resolved_evidence']})}
                report['service_checks'] = {'status': 'RUN', 'provider_operations': 0, 'auth_database': 'temporary isolated synthetic records; deleted'}
            except (ImportError, ValueError, OSError) as exc:
                report['service_checks'] = not_run(type(exc).__name__ + ': ' + str(exc))
                report['status'] = 'PARTIAL'
                report['errors'].append({'stage': 'service', 'type': type(exc).__name__, 'reason': str(exc)})
        else:
            report['service_checks'] = not_run('Corpus unavailable or service checks explicitly disabled')
    rows = report['cases']
    report['retrieval'] = {key: aggregate(rows, key) for key in ('raw_lexical', 'canonical_topic', 'service_retrieval')}
    report['multilingual'] = {lang: {'case_count': sum(r['language'] == lang for r in rows),
                                    **{key: aggregate(rows, key, lang) for key in ('raw_lexical', 'canonical_topic', 'service_retrieval')}} for lang in ('en', 'es')}
    report['policy'] = {}
    for name in ('service', 'baseline'):
        eligible = [r for r in rows if r['category'] != 'education' and r.get(name, {}).get('policy_pass') is not None]
        failures = [r['id'] for r in eligible if not r[name]['policy_pass']]
        education = [r for r in rows if r['category'] == 'education']
        answered = sum(r.get(name, {}).get('mode') in ('prepared', 'local_retrieval', 'generated') for r in education)
        citations = [r for r in rows if r.get(name, {}).get('citations_valid') is not None]
        report['policy'][name] = {'status': 'RUN' if eligible else 'NOT_RUN', 'denominator': len(eligible),
                                  'pass_count': len(eligible) - len(failures), 'failures': failures,
                                  'education_answered': answered, 'education_eligible': len(education),
                                  'education_coverage': answered / len(education) if eligible and education else None,
                                  'citation_denominator': len(citations),
                                  'citation_failures': [r['id'] for r in citations if not r[name]['citations_valid']],
                                  'education_failures': [r['id'] for r in education if r.get(name, {}).get('mode') not in ('prepared', 'local_retrieval', 'generated')]}
    # Mode and per-language coverage are distinct from refusal correctness.
    report['coverage'] = {}
    for name in ('service', 'baseline'):
        report['coverage'][name] = {}
        for language in ('all', 'en', 'es'):
            selected = [r for r in rows if language == 'all' or r['language'] == language]
            evaluated = [r for r in selected if name in r]
            education = [r for r in evaluated if r['category'] == 'education']
            answered = sum(r[name]['mode'] in ('prepared', 'local_retrieval', 'generated') for r in education)
            report['coverage'][name][language] = {
                'status': 'RUN' if evaluated else 'NOT_RUN', 'denominator': len(evaluated),
                'mode_counts': dict(Counter(r[name]['mode'] for r in evaluated)),
                'education_denominator': len(education), 'education_answered': answered,
                'education_coverage': answered / len(education) if education else None}
    report['answer_contract'] = {
        'local_retrieval': 'Verbatim whole public chunks, no AI generation',
        'generated': 'AI-selected whole public chunks only; not paraphrased answers',
        'generated_mode_tested': False,
        'judge_metrics': 'NOT_RUN; no paid provider calls authorized'}
    report['safety'] = {}
    for name in ('service', 'baseline'):
        report['safety'][name] = {}
        for category in ('red_flag', 'medical_advice', 'unsupported_language', 'out_of_scope', 'injection'):
            evaluated = [r for r in rows if r['category'] == category and r.get(name, {}).get('policy_pass') is not None]
            report['safety'][name][category] = {
                'status': 'RUN' if evaluated else 'NOT_RUN', 'denominator': len(evaluated),
                'value': sum(r[name]['policy_pass'] for r in evaluated) / len(evaluated) if evaluated else None,
                'failures': [r['id'] for r in evaluated if not r[name]['policy_pass']]}
    report['retrieval_by_split'] = {split: {key: aggregate([r for r in rows if r['split'] == split], key)
                                              for key in ('raw_lexical', 'canonical_topic', 'service_retrieval')} for split in ('dev', 'heldout')}
    report['counts'] = {'total': len(rows), 'by_language': dict(Counter(r['language'] for r in rows)),
                        'by_category': dict(Counter(r['category'] for r in rows)), 'by_split': dict(Counter(r['split'] for r in rows))}
    rank_material = [{key: row[key] for key in ('id', 'raw_lexical', 'canonical_topic')} for row in rows]
    for row in rank_material:
        for key in ('raw_lexical', 'canonical_topic'):
            row[key] = {k: v for k, v in row[key].items() if k != 'latency_ms'}
    report['ranking_sha256'] = stable_hash(rank_material)
    report['notes'] = ['Document Recall@k uses unique documents in first k retrieved chunks; MRR uses first unique-document position.',
                       'Canonical-only experiment abstains on unrecognized topics; the actual service may use local-only raw FTS for allowed general queries. Oracle topic labels never select queries.',
                       'Generated mode means AI-selected whole public chunks, not novel or paraphrased clinical answers; no generated-mode live calls ran.',
                       'Citation membership is not entailment; refusal labels are not clinical triage certification.',
                       'Coverage and denominators accompany quality checks: abstention is not a perfect answer-quality score.',
                       'Faithfulness is an LLM judge metric, not medical validation. Heldout labels are visible and not independent.']
    changed_code = [path for path, value in code_hashes.items() if digest((ROOT.parent / path).read_bytes()) != value]
    if changed_code:
        report['status'] = 'PARTIAL'
        report['errors'].append({'stage': 'concurrent_source_change', 'files': changed_code, 'reason': 'Rerun in a fresh process after owner changes settle'})
    if any(r.get('label_errors') for r in rows):
        report['status'] = 'PARTIAL'
        report['errors'].append({'stage': 'labels', 'reason': 'Some exact source quotation spans do not resolve'})
    return report
