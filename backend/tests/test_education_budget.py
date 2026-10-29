"""Real SQLite usage accounting tests; no monthly spending enforcement or provider calls."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sqlite3
import tempfile
import unittest

from backend.education.budget import Budget, BudgetError, money_units


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'test.sqlite3'

    def test_concurrent_accounting_has_no_monthly_ceiling(self):
        Budget(self.path)
        amount = money_units('0.3158528')
        def reserve(i):
            Budget(self.path).reserve(str(i), amount, 'evaluation' if i % 2 else 'education')
            return True
        with ThreadPoolExecutor(max_workers=12) as pool:
            accepted = sum(pool.map(reserve, range(40)))
        self.assertEqual(accepted, 40)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT SUM(charged) FROM education_budget_operations').fetchone()[0], 40 * amount)

    def test_restart_keeps_unknown_estimates_and_only_releases_undispatched(self):
        ledger = Budget(self.path)
        for operation in ('unknown', 'crashed'):
            ledger.reserve(operation, money_units(20), 'education')
        ledger.dispatched('unknown')
        restored = Budget(self.path)
        restored.release_undispatched('unknown')
        restored.release_undispatched('crashed')
        # Unknown delivery is not silently recorded as free; it cannot block new calls.
        restored.reserve('new-call', money_units(20), 'education')
        with closing(sqlite3.connect(self.path)) as db:
            rows = dict((r[0], (r[1], r[2])) for r in db.execute('SELECT operation_id,state,charged FROM education_budget_operations'))
        self.assertEqual(rows['unknown'], ('dispatched', money_units(20)))
        self.assertEqual(rows['crashed'], ('released', 0))
        self.assertEqual(rows['new-call'], ('reserved', money_units(20)))

    def test_utc_month_grouping_and_old_settlement(self):
        stamp = [datetime(2026, 10, 31, 23, 59, tzinfo=timezone.utc)]
        ledger = Budget(self.path, clock=lambda: stamp[0])
        ledger.reserve('october', money_units(20), 'education')
        ledger.dispatched('october')
        stamp[0] += timedelta(minutes=1)
        ledger.reserve('november', money_units(20), 'evaluation')
        ledger.settle('october', money_units(1))
        with closing(sqlite3.connect(self.path)) as db:
            rows = list(db.execute('SELECT operation_id,month,charged FROM education_budget_operations ORDER BY operation_id'))
        self.assertEqual(rows, [('november', '2026-11', money_units(20)), ('october', '2026-10', money_units(1))])

    def test_invalid_reservations_duplicates_and_settlements_still_rejected(self):
        ledger = Budget(self.path)
        for value in (0, -1, True, 1.5):
            with self.assertRaises(BudgetError):
                ledger.reserve('invalid', value, 'indexing')
        ledger.reserve('once', 1, 'indexing')
        with self.assertRaises(BudgetError):
            ledger.reserve('once', 1, 'indexing')
        ledger.dispatched('once')
        for actual in (-1, True, 2):
            with self.assertRaises(BudgetError):
                ledger.settle('once', actual)
        ledger.settle('once', 1)
        with self.assertRaises(BudgetError):
            ledger.dispatched('once')
