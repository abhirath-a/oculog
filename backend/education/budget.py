"""Shared usage ledger, grouped by UTC month; no spending limit is enforced.

Unknown delivery retains its conservative estimate rather than appearing free.
The legacy table/class names are retained for existing databases and callers.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
import sqlite3

UNITS = 1_000_000_000  # nanodollars: no binary floating-point money
SCHEMA = """
CREATE TABLE IF NOT EXISTS education_budget_operations (
 operation_id TEXT PRIMARY KEY, month TEXT NOT NULL, purpose TEXT NOT NULL,
 reserved INTEGER NOT NULL CHECK(reserved>0), charged INTEGER NOT NULL CHECK(charged>=0),
 state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','settled','released')));
CREATE INDEX IF NOT EXISTS education_budget_month ON education_budget_operations(month);
CREATE TABLE IF NOT EXISTS education_provider_disabled (
 configuration TEXT PRIMARY KEY, reason TEXT NOT NULL);
"""


class BudgetError(ValueError):
    pass


def money_units(value):
    return int((Decimal(str(value)) * UNITS).to_integral_value(rounding=ROUND_CEILING))


class Budget:
    def __init__(self, db_path, clock=None):
        self.path = str(db_path)
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        with self.db() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA busy_timeout=10000')
            yield db
        finally:
            db.close()

    def month(self):
        return self.clock().astimezone(timezone.utc).strftime('%Y-%m')

    def reserve(self, operation_id, amount, purpose):
        if type(amount) is not int or amount <= 0:
            raise BudgetError('invalid_reservation')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                # Repeated operation IDs never create another dispatch opportunity.
                if db.execute('SELECT 1 FROM education_budget_operations WHERE operation_id=?', (operation_id,)).fetchone():
                    raise BudgetError('duplicate_operation')
                month = self.month()
                db.execute('INSERT INTO education_budget_operations VALUES (?,?,?,?,?,?)',
                           (operation_id, month, purpose, amount, amount, 'reserved'))
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def dispatched(self, operation_id, authorize=None):
        """Linearize authorization and dispatch against consent writers.

        authorize(db) reads this exact writer connection, including current
        consent/session state. Commit before HTTP; in-flight calls cannot be recalled.
        """
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                if authorize is not None:
                    authorize(db)
                cursor = db.execute("UPDATE education_budget_operations SET state='dispatched' WHERE operation_id=? AND state='reserved'", (operation_id,))
                if cursor.rowcount != 1:
                    raise BudgetError('invalid_operation_state')
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def release_undispatched(self, operation_id):
        with self.db() as db:
            db.execute("UPDATE education_budget_operations SET state='released',charged=0 WHERE operation_id=? AND state='reserved'", (operation_id,))

    def settle(self, operation_id, actual):
        if type(actual) is not int or actual < 0:
            raise BudgetError('invalid_settlement')
        with self.db() as db:
            cursor = db.execute("UPDATE education_budget_operations SET state='settled',charged=? WHERE operation_id=? AND state='dispatched' AND reserved>=?",
                                (actual, operation_id, actual))
            if type(actual) is not int or actual < 0 or cursor.rowcount != 1:
                raise BudgetError('invalid_settlement')

    def disabled(self, configuration):
        with self.db() as db:
            return db.execute('SELECT reason FROM education_provider_disabled WHERE configuration=?', (configuration,)).fetchone() is not None

    def disable(self, configuration):
        with self.db() as db:
            db.execute('INSERT OR IGNORE INTO education_provider_disabled VALUES (?,?)', (configuration, 'usage_contract_invalid'))
