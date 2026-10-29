"""Synthetic account data only; real SQLite/session fences, no external services."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend import main, wear


class WearTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'synthetic.sqlite3')
        @contextmanager
        def connection():
            db = sqlite3.connect(self.path, isolation_level=None)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            try:
                yield db
            finally:
                db.close()
        self.api = SimpleNamespace(**{name: getattr(main, name) for name in (
            'authenticate', 'transaction', 'strict', 'fail', 'reply', 'Problem', 'calendar', 'zone', 'encode')},
            connection=connection, now=lambda: self.clock)
        self.clock = datetime(2024, 3, 4, 12, tzinfo=timezone.utc)  # Monday
        self.tokens = ['a' * 43, 'b' * 43]
        self.counter = 0
        with connection() as db:
            db.executescript(main.SCHEMA + wear.SCHEMA)
            for owner, token in zip(('one', 'two'), self.tokens):
                db.execute('INSERT INTO accounts VALUES (?,?,?,?,?)', (owner, owner + '@example.org', 'unused', owner, 'UTC'))
                db.execute('INSERT INTO sessions VALUES (?,?,?,0)',
                           (hashlib.sha256(token.encode()).hexdigest(), owner, int(time.time()) + 3600))
                db.execute('INSERT INTO eyes VALUES (?,?,?,?,?,?)', (owner + '-eye', owner, 'left', 30, '2024-02-01', 4))

    def call(self, route='history', body=None, key=None, owner=0, query=None):
        self.counter += 1
        query = ([('month', '2024-03')] if route == 'history' else []) if query is None else query
        return json.loads(wear.action(route, body, 'Bearer ' + self.tokens[owner], key or str(self.counter), query, self.api).body)

    def automation(self, enabled=True, weekdays=None, **kw):
        return self.call('automation', {'enabled': enabled, 'weekdays': [0, 2] if weekdays is None else weekdays}, **kw)

    def day(self, day='2024-03-04', worn=True, **kw):
        return self.call('day', {'localDate': day, 'worn': worn}, **kw)

    def at(self, day):
        self.clock = datetime.fromisoformat(day + 'T12:00:00+00:00')

    def days(self, **kw):
        return {d['localDate']: (d['worn'], d['source']) for d in self.call(**kw)['days']}

    def set_zone(self, zone):
        with self.api.connection() as db:
            db.execute('UPDATE accounts SET time_zone=? WHERE id=?', (zone, 'one'))

    def rows(self, table):
        with self.api.connection() as db:
            return [tuple(r) for r in db.execute('SELECT * FROM ' + table)]

    def invalid(self, fn, status=400):
        with self.assertRaises(main.Problem) as error:
            fn()
        self.assertEqual(error.exception.status, status)

    def test_defaults_and_no_read_writes(self):
        before = {t: self.rows(t) for t in ('days', 'eyes', 'accounts', 'wear_preferences', 'wear_periods', 'wear_clears', 'wear_receipts', 'wear_calendar_watermarks')}
        result = self.call()
        self.assertEqual(set(result), {'version', 'month', 'today', 'timeZone', 'days', 'automation'})
        self.assertEqual(result['automation'], {'version': 1, 'enabled': False, 'weekdays': [], 'startsOn': None})
        self.assertEqual(len(result['days']), 31)
        self.assertTrue(all(d['source'] == 'unknown' and d['worn'] is None for d in result['days']))
        for table, rows in before.items():
            self.assertEqual(self.rows(table), rows)

    def test_manual_upsert_clear_and_new_manual_removes_exception(self):
        self.assertEqual(self.day('2024-02-29', False), {'version': 1, 'day': {'localDate': '2024-02-29', 'worn': False, 'source': 'manual'}})
        self.day('2024-02-29', True)
        self.assertEqual(self.rows('days'), [('one', '2024-02-29', 1)])
        self.assertEqual(self.day('2024-02-29', None)['day']['source'], 'unknown')
        self.assertEqual(self.rows('days'), [])
        self.assertEqual(self.rows('wear_clears'), [('one', '2024-02-29')])
        self.day('2024-02-29', False)
        self.assertEqual(self.rows('wear_clears'), [])

    def test_completed_days_only_optin_catchup_manual_and_clear(self):
        self.automation(weekdays=[2, 0])
        self.assertEqual(self.days()['2024-03-04'], (None, 'unknown'))
        self.at('2024-03-11')
        days = self.days()
        for day in ('2024-03-04', '2024-03-06'):
            self.assertEqual(days[day], (True, 'assumed'))
        for day in ('2024-03-01', '2024-03-05', '2024-03-11', '2024-03-13'):
            self.assertEqual(days[day], (None, 'unknown'))
        self.assertEqual(self.rows('days'), [])
        self.day('2024-03-04', False)
        self.day('2024-03-06', None)
        self.assertEqual(self.days()['2024-03-04'], (False, 'manual'))
        self.assertEqual(self.days()['2024-03-06'], (None, 'unknown'))
        self.at('2024-04-01')
        self.assertEqual(self.days()['2024-03-06'], (None, 'unknown'))
        self.day('2024-03-06', True)
        self.assertEqual(self.days()['2024-03-06'], (True, 'manual'))

    def test_periods_immutable_weekday_change_disabled_gap_reenable(self):
        first = self.automation(weekdays=[2, 0])
        self.at('2024-03-07')
        self.assertEqual(self.automation(weekdays=[0, 2]), first)
        self.assertEqual(len(self.rows('wear_periods')), 1)
        changed = self.automation(weekdays=[4])
        self.assertEqual(changed['startsOn'], '2024-03-07')
        self.at('2024-03-09')
        self.assertIsNone(self.automation(False, [4])['startsOn'])
        self.at('2024-03-16')
        self.automation(weekdays=[4])
        self.at('2024-03-24')
        days = self.days()
        for day in ('2024-03-04', '2024-03-06', '2024-03-08', '2024-03-22'):
            self.assertEqual(days[day], (True, 'assumed'))
        for day in ('2024-03-11', '2024-03-13', '2024-03-15'):
            self.assertEqual(days[day], (None, 'unknown'))
        periods = self.rows('wear_periods')
        self.assertEqual([(r[2], r[3]) for r in periods], [('2024-03-04', '2024-03-07'), ('2024-03-07', '2024-03-09'), ('2024-03-16', None)])

    def test_same_day_changes_do_not_backfill(self):
        self.automation(weekdays=[0])
        self.automation(False, [])
        self.automation(weekdays=[1])
        self.at('2024-03-06')
        self.assertEqual(self.days()['2024-03-04'], (None, 'unknown'))
        self.assertEqual(self.days()['2024-03-05'], (True, 'assumed'))

    def test_disabled_gap_cannot_be_filled_after_travel_with_or_without_read(self):
        for intervening_read in (False, True):
            with self.subTest(intervening_read=intervening_read):
                # Independent synthetic account/database for each travel path.
                self.setUp()
                self.set_zone('Pacific/Kiritimati')
                self.at('2024-03-02')  # March 3 locally: opt in to Mondays.
                self.automation(weekdays=[0])
                self.at('2024-03-03')  # March 4: disabled, so Monday is a gap.
                disabled = self.automation(False, [0], key='disable')
                self.at('2024-03-04')  # March 5 in the previous zone.
                if intervening_read:
                    self.assertEqual(self.days()['2024-03-04'], (None, 'unknown'))
                self.set_zone('Pacific/Honolulu')  # March 4 again.
                with self.assertRaises(main.Problem) as error:
                    self.automation(weekdays=[0], key='reenable')
                self.assertEqual(error.exception.status, 409)
                self.assertIn('2024-03-05', error.exception.message)
                self.assertIn('Wait', error.exception.message)
                self.assertEqual(self.rows('wear_calendar_watermarks'),
                                 [('one', '2024-03-05', 'Pacific/Honolulu')])
                # Acknowledged receipt replays don't reapply old preferences.
                self.assertEqual(self.automation(False, [0], key='disable'), disabled)
                self.assertEqual(len(self.rows('wear_receipts')), 2)
                self.day('2024-03-03', False)
                self.day('2024-03-03', None)
                self.invalid(lambda: self.day('2024-03-05'))
                self.at('2024-03-05')  # Catch up: same rejected key can succeed.
                self.assertEqual(self.automation(weekdays=[0], key='reenable')['startsOn'], '2024-03-05')
                self.at('2024-03-12')
                self.assertEqual(self.days()['2024-03-04'], (None, 'unknown'))
                self.assertEqual(self.days()['2024-03-11'], (True, 'assumed'))
                self.assertEqual(self.rows('days'), [])

    def test_rollback_noop_change_rejected_and_optout_preserves_completed_days(self):
        self.set_zone('Pacific/Kiritimati')
        self.at('2024-03-02')
        original = self.automation(weekdays=[0], key='enabled')  # March 3.
        self.at('2024-03-04')  # March 5: Monday is completed.
        self.set_zone('Pacific/Honolulu')  # March 4.
        self.assertEqual(self.automation(weekdays=[0]), original)
        self.invalid(lambda: self.automation(weekdays=[1]), 409)
        self.assertEqual(self.automation(weekdays=[0], key='enabled'), original)
        self.assertFalse(self.automation(False, [])['enabled'])
        self.assertEqual(self.rows('wear_periods')[0][2:4], ('2024-03-03', '2024-03-05'))
        self.at('2024-03-05')
        self.assertEqual(self.days()['2024-03-04'], (True, 'assumed'))
        self.assertEqual(self.rows('days'), [])

    def test_optout_when_active_start_is_future_after_travel(self):
        self.set_zone('Pacific/Kiritimati')
        original = self.automation(weekdays=[1])  # March 5 locally.
        self.set_zone('Pacific/Honolulu')
        result = self.call()
        self.assertEqual(result['today'], '2024-03-04')
        self.assertEqual(result['automation'], original)
        self.assertTrue(all(d['source'] == 'unknown' for d in result['days']))
        self.assertFalse(self.automation(False, [1])['enabled'])
        self.assertEqual(self.rows('wear_periods')[0][2:4], ('2024-03-05', '2024-03-05'))

    def test_default_off_reads_and_edits_do_not_block_first_optin_after_travel(self):
        self.set_zone('Pacific/Kiritimati')
        self.call()
        self.day('2024-03-04', None)
        self.automation(False, [0])
        self.assertEqual(self.rows('wear_calendar_watermarks'), [])
        self.set_zone('Pacific/Honolulu')
        self.assertEqual(self.automation(weekdays=[0])['startsOn'], '2024-03-04')
        self.assertEqual(self.rows('wear_calendar_watermarks'),
                         [('one', '2024-03-04', 'Pacific/Honolulu')])
        self.call(owner=1)
        self.assertEqual(len(self.rows('wear_calendar_watermarks')), 1)

    def test_history_watermark_uses_write_transaction_and_no_materialization(self):
        self.automation(weekdays=[0])
        self.at('2024-03-06')
        transactions = []
        @contextmanager
        def tracked(db):
            with main.transaction(db):
                transactions.append(db.in_transaction)
                yield
        self.api.transaction = tracked
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.call(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(transactions, [True, True])
        self.assertEqual(self.rows('wear_calendar_watermarks'), [('one', '2024-03-06', 'UTC')])
        self.assertEqual(self.rows('days'), [])
        self.assertEqual(len(self.rows('wear_periods')), 1)

    def test_existing_optin_is_seeded_additively_on_read(self):
        self.automation(weekdays=[0])
        with self.api.connection() as db:
            db.execute('DELETE FROM wear_calendar_watermarks')
        self.at('2024-03-06')
        self.call()
        self.assertEqual(self.rows('wear_calendar_watermarks'), [('one', '2024-03-06', 'UTC')])

    def test_month_bounds_leap_century_extreme_years(self):
        for month, count in [('2024-02', 29), ('2023-02', 28), ('2000-02', 29), ('1900-02', 28), ('0001-01', 31), ('9999-12', 31), ('2024-04', 30)]:
            result = self.call(query=[('month', month)])
            self.assertEqual(len(result['days']), count)
            self.assertEqual([d['localDate'] for d in result['days']], [f'{month}-{i:02d}' for i in range(1, count + 1)])
        for month in ('0000-01', '10000-01', '2024-00', '2024-13', '2024-2', '2024-02-01', '２０２４-02', '', None):
            self.invalid(lambda: self.call(query=[('month', month)]))
        for query in ([], [('month', '2024-02'), ('month', '2024-02')], [('other', '2024-02')], [('month', '2024-02'), ('other', '')]):
            self.invalid(lambda: self.call(query=query))

    def test_strict_dates_and_day_contract(self):
        for day in ('2024-02-30', '2023-02-29', '0000-01-01', '2024-3-01', '2024-03-04T00:00:00Z', '2024-03-05', '', None, True):
            self.invalid(lambda: self.day(day))
        for worn in (0, 1, 1.0, 'true', [], {}):
            self.invalid(lambda: self.day(worn=worn))
        for body in ({}, {'localDate': '2024-03-04'}, {'localDate': '2024-03-04', 'worn': True, 'owner': 'two'}, []):
            self.invalid(lambda: self.call('day', body))
        self.day('0001-01-01')
        self.assertEqual(self.rows('days'), [('one', '0001-01-01', 1)])

    def test_weekdays_bool_int_aliases_and_exact_contract(self):
        for enabled in (0, 1, None, 'true'):
            self.invalid(lambda: self.automation(enabled))
        for weekdays in ([], [True], [False, 0], [0, 0], [1.0], [-1], [7], list(range(8)), None, '012', [None], [{}]):
            self.invalid(lambda: self.call('automation', {'enabled': True, 'weekdays': weekdays}))
        for body in ({}, {'enabled': True}, {'enabled': False, 'weekdays': [], 'startsOn': '2024-03-01'}):
            self.invalid(lambda: self.call('automation', body))
        self.assertEqual(self.automation(False, [])['weekdays'], [])
        self.assertEqual(self.automation(weekdays=[6, 0, 5])['weekdays'], [0, 5, 6])

    def test_receipts_exact_replay_path_body_conflicts_and_bounded_keys(self):
        result = self.day(worn=False, key='same')
        self.day(worn=True)
        self.assertEqual(self.day(worn=False, key='same'), result)
        self.assertEqual(self.days()['2024-03-04'], (True, 'manual'))
        self.invalid(lambda: self.day(worn=True, key='same'), 409)
        self.invalid(lambda: self.automation(key='same'), 409)
        result = self.automation(key='auto')
        self.at('2024-03-07')
        self.automation(False, [])
        self.assertEqual(self.automation(key='auto'), result)
        self.assertFalse(self.call()['automation']['enabled'])
        self.day(key='new')
        self.assertEqual(self.day(worn=False, key='same')['day']['worn'], False)
        for key in ('', 'a' * 129, 'bad key', 'é', None):
            self.invalid(lambda: wear.action('day', {'localDate': '2024-03-04', 'worn': True}, 'Bearer ' + self.tokens[0], key, [], self.api))
        self.day(key='a' * 128)

    def test_receipts_remain_permanent_and_replay_advances_only_metadata(self):
        original = self.automation(weekdays=[0], key='original')
        with self.api.connection() as db:
            db.executemany('INSERT INTO wear_receipts VALUES (?,?,?,?)',
                           [('one', f'old-{i}', 'synthetic', '{}') for i in range(1100)])
        self.at('2024-03-11')
        self.assertEqual(self.automation(weekdays=[0], key='original'), original)
        self.assertEqual(self.rows('wear_calendar_watermarks'), [('one', '2024-03-11', 'UTC')])
        self.assertEqual(len(self.rows('wear_receipts')), 1101)
        self.assertEqual(len(self.rows('wear_periods')), 1)
        self.day('2024-03-04', False)
        self.assertEqual(len(self.rows('wear_receipts')), 1102)
        self.assertEqual(self.automation(weekdays=[0], key='original'), original)

    def test_concurrent_receipt_single_mutation(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.automation(key='concurrent'), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(self.rows('wear_periods')), 1)
        self.assertEqual(len(self.rows('wear_receipts')), 1)

    def test_auth_owner_and_revoked_receipt(self):
        for route in ('history', 'day', 'automation'):
            self.invalid(lambda: wear.action(route, {}, None, 'key', [], self.api), 401)
        self.day(worn=False, key='shared')
        self.day(worn=True, key='shared', owner=1)
        self.automation()
        self.at('2024-03-07')
        self.assertEqual(self.days(owner=1)['2024-03-06'], (None, 'unknown'))
        self.assertEqual(self.days(owner=0)['2024-03-06'], (True, 'assumed'))
        self.day(worn=None, owner=1)
        self.assertEqual(self.days()['2024-03-04'], (False, 'manual'))
        with self.api.connection() as db:
            db.execute('UPDATE sessions SET revoked=1 WHERE account_id=?', ('one',))
        self.invalid(lambda: self.day(worn=False, key='shared'), 401)
        self.assertFalse(self.day(worn=False, owner=1)['day']['worn'])

    def test_session_recheck_in_write_transaction(self):
        @contextmanager
        def revoke_then_transaction(db):
            db.execute('UPDATE sessions SET revoked=1')
            with main.transaction(db):
                yield
        self.api.transaction = revoke_then_transaction
        self.invalid(lambda: self.day(), 401)
        self.assertEqual(self.rows('days'), [])
        self.assertEqual(self.rows('wear_receipts'), [])

    def test_timezone_today_dst_and_future_manual_preserved(self):
        with self.api.connection() as db:
            db.execute("UPDATE accounts SET time_zone='America/New_York' WHERE id='one'")
        self.clock = datetime(2024, 3, 10, 4, 30, tzinfo=timezone.utc)
        self.assertEqual(self.call()['today'], '2024-03-09')
        self.automation(weekdays=[5, 6])
        self.day('2024-03-09')
        self.invalid(lambda: self.day('2024-03-10'))
        self.clock = datetime(2024, 3, 11, 3, 30, tzinfo=timezone.utc)  # 23-hour DST Sunday not complete
        self.assertEqual(self.days()['2024-03-10'], (None, 'unknown'))
        self.clock = datetime(2024, 3, 11, 4, 0, tzinfo=timezone.utc)
        self.assertEqual(self.days()['2024-03-10'], (True, 'assumed'))
        self.day('2024-03-11', False)
        with self.api.connection() as db:
            db.execute("UPDATE accounts SET time_zone='Pacific/Honolulu' WHERE id='one'")
        self.assertEqual(self.call()['today'], '2024-03-10')
        self.assertEqual(self.days()['2024-03-11'], (None, 'unknown'))
        self.assertIn(('one', '2024-03-11', 0), self.rows('days'))
        self.invalid(lambda: self.day('2024-03-11', None))
        with self.api.connection() as db:
            db.execute("UPDATE accounts SET time_zone='Pacific/Kiritimati' WHERE id='one'")
        self.assertEqual(self.days()['2024-03-11'], (False, 'manual'))

    def test_fall_dst_literal_weekdays(self):
        with self.api.connection() as db:
            db.execute("UPDATE accounts SET time_zone='America/New_York'")
        self.at('2024-11-02')
        self.automation(weekdays=[6])
        self.clock = datetime(2024, 11, 4, 4, 59, tzinfo=timezone.utc)
        self.assertEqual(self.days(query=[('month', '2024-11')])['2024-11-03'], (None, 'unknown'))
        self.clock = datetime(2024, 11, 4, 5, tzinfo=timezone.utc)
        self.assertEqual(self.days(query=[('month', '2024-11')])['2024-11-03'], (True, 'assumed'))

    def test_legacy_today_precedence_state_and_no_inventory_or_account_changes(self):
        before_eyes, before_accounts = self.rows('eyes'), self.rows('accounts')
        self.automation(weekdays=[0])
        self.day(worn=None)
        with self.api.connection() as db:
            account, _ = main.authenticate(db, 'Bearer ' + self.tokens[0])
            with patch.object(main, 'now', return_value=self.clock):
                main.mutate(db, account, 'day', {'localDate': '2024-03-04', 'worn': False})
                self.assertFalse(main.state(db, account)['daily']['worn'])
            self.assertEqual([r['name'] for r in db.execute('PRAGMA table_info(days)')], ['account_id', 'local_date', 'worn'])
        self.assertEqual(self.days()['2024-03-04'], (False, 'manual'))
        self.assertEqual(len(self.rows('wear_clears')), 1)  # Old writer need not know exceptions exist.
        self.day(worn=None)
        self.at('2024-03-12')
        self.assertEqual(self.days()['2024-03-11'], (True, 'assumed'))
        with self.api.connection() as db:
            account, _ = main.authenticate(db, 'Bearer ' + self.tokens[0])
            with patch.object(main, 'now', return_value=self.clock):
                self.assertIsNone(main.state(db, account)['daily']['worn'])
        self.assertEqual(self.rows('eyes'), before_eyes)
        self.assertEqual(self.rows('accounts'), before_accounts)
        self.assertEqual(self.rows('receipts'), [])


# Reuse only the synthetic loopback lifecycle, not the legacy test suite itself.
from backend.tests import test_api as http_harness


class WearHTTPTests(unittest.TestCase):
    setUp = http_harness.HTTPTests.setUp
    cleanup = http_harness.HTTPTests.cleanup
    start = http_harness.HTTPTests.start
    stop = http_harness.HTTPTests.stop
    call = http_harness.HTTPTests.call
    register = http_harness.HTTPTests.register
    sql = http_harness.HTTPTests.sql

    def test_routes_validation_auth_and_receipt_replay(self):
        prefix = '/api/oculog/v2/wear/'
        for route, method, body in [('history?month=2024-02', 'GET', None), ('day', 'POST', {'localDate': '2024-02-01', 'worn': True}), ('automation', 'POST', {'enabled': True, 'weekdays': [0]})]:
            self.assertEqual(self.call(method, prefix + route, body, key='unauth')[0], 401)
        result = self.call('GET', prefix + 'history?month=2024-02', token=self.token)
        self.assertEqual(result[0], 200)
        self.assertEqual(len(result[1]['days']), 29)
        for query in ('', '?month=2024-02&month=2024-02', '?month=2024-02&extra=1', '?month=0000-01'):
            self.assertEqual(self.call('GET', prefix + 'history' + query, token=self.token)[0], 400)
        body = {'localDate': '2024-02-01', 'worn': False}
        result = self.call('POST', prefix + 'day', body, self.token, 'day-key')
        self.assertEqual(result[0], 200)
        self.assertEqual(set(result[1]), {'version', 'day'})
        self.assertEqual(self.call('POST', prefix + 'day', body, self.token, 'day-key')[3], result[3])
        self.assertEqual(self.call('POST', prefix + 'automation', {'enabled': False, 'weekdays': []}, self.token, 'day-key')[0], 409)
        self.assertEqual(self.call('POST', prefix + 'day', body, self.token)[0], 400)
        for raw in (b'{"localDate":"2024-02-01","worn":true,"worn":false}', b'{"localDate":"2024-02-01","worn":NaN}', b'[]'):
            self.assertEqual(self.call('POST', prefix + 'day', token=self.token, key='invalid', raw=raw)[0], 400)
        self.assertEqual(self.call('POST', prefix + 'automation', {'enabled': True, 'weekdays': [True]}, self.token, 'bool')[0], 400)
        auto = self.call('POST', prefix + 'automation', {'enabled': True, 'weekdays': [6, 0]}, self.token, 'auto')
        self.assertEqual(auto[0], 200)
        self.assertEqual(auto[1]['weekdays'], [0, 6])
        self.assertEqual(self.call('GET', prefix + 'history?month=' + auto[1]['startsOn'][:7], token=self.token)[1]['automation'], auto[1])
        self.assertEqual(self.sql('SELECT COUNT(*) FROM eyes')[0][0], 0)
        self.assertEqual(len(self.sql('PRAGMA table_info(days)')), 3)
        self.assertEqual(self.sql('SELECT COUNT(*) FROM receipts')[0][0], 0)

    def test_additive_initialize_survives_restart_and_legacy_receipt_is_separate(self):
        prefix = '/api/oculog/v2/wear/'
        body = {'localDate': '2024-02-01', 'worn': True}
        legacy = self.call('POST', '/api/oculog/v1/simple/day', body, self.token, 'shared-key')
        self.assertEqual(legacy[0], 200)
        modern = self.call('POST', prefix + 'day', body, self.token, 'shared-key')
        self.assertEqual(modern[0], 200)
        self.assertIn('daily', legacy[1])
        self.assertNotIn('daily', modern[1])
        self.call('POST', prefix + 'day', {**body, 'worn': None}, self.token, 'clear')
        self.stop()
        self.start()
        self.assertEqual(self.call('POST', prefix + 'day', body, self.token, 'shared-key')[3], modern[3])
        history = self.call('GET', prefix + 'history?month=2024-02', token=self.token)
        self.assertEqual(history[1]['days'][0], {'localDate': '2024-02-01', 'worn': None, 'source': 'unknown'})
        self.assertEqual(self.sql('SELECT COUNT(*) FROM wear_clears')[0][0], 1)


if __name__ == '__main__':
    unittest.main()
