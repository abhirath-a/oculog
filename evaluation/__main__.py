"""python -m evaluation [offline|live]; offline by default."""
import argparse
import json
from pathlib import Path

from .offline import DATASET, run


def main(argv=None):
    parser = argparse.ArgumentParser(description='Synthetic public-source education development benchmark; default offline, no network')
    parser.add_argument('mode', choices=('offline', 'live'), nargs='?', default='offline')
    parser.add_argument('--dataset', type=Path, default=DATASET)
    parser.add_argument('--corpus', type=Path)
    parser.add_argument('-k', type=int, default=4)
    parser.add_argument('--output', type=Path, required=True, help='New report file; existing reports are never overwritten')
    parser.add_argument('--no-service-checks', action='store_true')
    parser.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--shared-ledger', type=Path)
    parser.add_argument('--max-run-usd', default='1.00')
    parser.add_argument('--case-id', default='en-clean')
    parser.add_argument('--answer-mode', choices=('local', 'generated'), default='generated',
                        help='Live candidate: actual generated selection (default) or local excerpt baseline; offline unchanged')
    args = parser.parse_args(argv)
    if args.output.exists():
        parser.error('Refusing to overwrite an existing report')
    if args.mode == 'offline':
        if args.allow_paid:
            parser.error('--allow-paid is only valid in explicit live mode')
        report = run(args.dataset, args.corpus, args.k, not args.no_service_checks)
    else:
        # Never accept arbitrary custom dataset input for paid requests.
        if args.dataset.resolve() != DATASET.resolve():
            parser.error('Paid mode only accepts the versioned fixed synthetic dataset')
        from .live import live
        report = live(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        f.write('\n')
    print(json.dumps({'status': report['status'], 'report': str(args.output),
                      'counts': report.get('counts'), 'retrieval': report.get('retrieval'),
                      'policy': report.get('policy'), 'errors': report['errors']}, ensure_ascii=False))
    return 0 if report['status'] == 'RUN' else 2


if __name__ == '__main__':
    raise SystemExit(main())
