"""Explicit manual wear history and opt-in, completed-day assumptions.

No sensor claims, jobs, inventory changes, or materialized automatic day rows.
The injected API owns authentication, account-calendar semantics and transactions.
"""
import calendar as month_calendar
from datetime import date
import hashlib
import json
import re

PREFIX = '/api/oculog/v2/wear/'
SCHEMA = """
CREATE TABLE IF NOT EXISTS wear_preferences (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), weekdays_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wear_periods (
 id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 starts_on TEXT NOT NULL, ends_on TEXT, weekdays_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS wear_periods_owner ON wear_periods(account_id,starts_on);
CREATE UNIQUE INDEX IF NOT EXISTS wear_periods_active ON wear_periods(account_id) WHERE ends_on IS NULL;
CREATE TABLE IF NOT EXISTS wear_clears (
 account_id TEXT NOT NULL REFERENCES accounts(id), local_date TEXT NOT NULL,
 PRIMARY KEY(account_id,local_date));
CREATE TABLE IF NOT EXISTS wear_calendar_watermarks (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 effective_on TEXT NOT NULL, time_zone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wear_receipts (
 account_id TEXT NOT NULL REFERENCES accounts(id), key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response_json TEXT NOT NULL,
 PRIMARY KEY(account_id,key));
"""


def advance_calendar(db, account, today, instant, api):
    """Operational metadata only; never create manual or assumed day records.

    Remember the previous zone too: travel can roll back today's date even when
    no history request occurred immediately before the account-zone change.
    """
    owner, zone = account['id'], account['time_zone']
    row = db.execute('SELECT * FROM wear_calendar_watermarks WHERE account_id=?', (owner,)).fetchone()
    if row:
        effective = max(row['effective_on'], today.isoformat(),
                        instant.astimezone(api.zone(row['time_zone'])).date().isoformat())
    else:
        # Upgrade existing opt-ins, but default-off reads must not seed a fence.
        periods = db.execute('SELECT starts_on,ends_on FROM wear_periods WHERE account_id=?', (owner,)).fetchall()
        if not periods:
            return today.isoformat()
        effective = max([today.isoformat()] + [r['ends_on'] or r['starts_on'] for r in periods])
    db.execute('INSERT INTO wear_calendar_watermarks VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE '
               'SET effective_on=excluded.effective_on,time_zone=excluded.time_zone', (owner, effective, zone))
    return effective


def preferences(db, owner):
    row = db.execute('SELECT * FROM wear_preferences WHERE account_id=?', (owner,)).fetchone()
    active = db.execute('SELECT starts_on FROM wear_periods WHERE account_id=? AND ends_on IS NULL',
                        (owner,)).fetchone()
    return {'version': 1, 'enabled': bool(row['enabled']) if row else False,
            'weekdays': json.loads(row['weekdays_json']) if row else [],
            'startsOn': active['starts_on'] if active else None}


def history(db, account, today, query, api):
    if len(query) != 1 or query[0][0] != 'month':
        api.fail('month', 'Expected exactly one month query parameter')
    month = query[0][1]
    if not isinstance(month, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}', month):
        api.fail('month')
    try:
        first = date.fromisoformat(month + '-01')
    except ValueError:
        api.fail('month')
    count = month_calendar.monthrange(first.year, first.month)[1]
    last = f'{month}-{count:02d}'
    owner = account['id']
    manual = {r['local_date']: bool(r['worn']) for r in db.execute(
        'SELECT local_date,worn FROM days WHERE account_id=? AND local_date BETWEEN ? AND ?',
        (owner, first.isoformat(), last))}
    clears = {r['local_date'] for r in db.execute(
        'SELECT local_date FROM wear_clears WHERE account_id=? AND local_date BETWEEN ? AND ?',
        (owner, first.isoformat(), last))}
    periods = [(r['starts_on'], r['ends_on'], json.loads(r['weekdays_json'])) for r in db.execute(
        'SELECT * FROM wear_periods WHERE account_id=? AND starts_on<=? AND (ends_on IS NULL OR ends_on>?)',
        (owner, last, first.isoformat()))]
    days = []
    for number in range(1, count + 1):
        day = date(first.year, first.month, number)
        literal = day.isoformat()
        worn, source = None, 'unknown'
        # Stored manual future dates (e.g. timezone travel) remain untouched but hidden.
        if day <= today:
            if literal in manual:
                worn, source = manual[literal], 'manual'
            elif literal not in clears and day < today and any(
                    start <= literal and (end is None or literal < end) and day.weekday() in weekdays
                    for start, end, weekdays in periods):
                worn, source = True, 'assumed'
        days.append({'localDate': literal, 'worn': worn, 'source': source})
    return {'version': 1, 'month': month, 'today': today.isoformat(), 'timeZone': account['time_zone'],
            'days': days, 'automation': preferences(db, owner)}


def save_day(db, owner, today, body, api):
    api.strict(body, ['localDate', 'worn'])
    day = api.calendar(body['localDate'], 'localDate')
    if day > today:
        api.fail('localDate', 'Future days are not allowed')
    worn = body['worn']
    if worn is not None and type(worn) is not bool:
        api.fail('worn')
    literal = day.isoformat()
    if worn is None:
        db.execute('DELETE FROM days WHERE account_id=? AND local_date=?', (owner, literal))
        db.execute('INSERT OR IGNORE INTO wear_clears VALUES (?,?)', (owner, literal))
    else:
        db.execute('INSERT INTO days VALUES (?,?,?) ON CONFLICT(account_id,local_date) DO UPDATE SET worn=excluded.worn',
                   (owner, literal, int(worn)))
        db.execute('DELETE FROM wear_clears WHERE account_id=? AND local_date=?', (owner, literal))
    return {'version': 1, 'day': {'localDate': literal, 'worn': worn,
                                'source': 'unknown' if worn is None else 'manual'}}


def save_automation(db, owner, today, body, api, watermark):
    api.strict(body, ['enabled', 'weekdays'])
    enabled, weekdays = body['enabled'], body['weekdays']
    if type(enabled) is not bool:
        api.fail('enabled')
    if (not isinstance(weekdays, list) or len(weekdays) > 7 or
            any(type(n) is not int or not 0 <= n <= 6 for n in weekdays) or
            len(set(weekdays)) != len(weekdays) or (enabled and not weekdays)):
        api.fail('weekdays')
    weekdays = sorted(weekdays)
    prior = preferences(db, owner)
    if prior['enabled'] == enabled and prior['weekdays'] == weekdays:
        return prior
    literal = today.isoformat()
    if enabled and literal < watermark:
        raise api.Problem(409, 'calendar_catch_up',
                          f'Your account calendar moved backward. Wait until {watermark} '
                          'in your account time zone before enabling or changing automatic logging. '
                          'You can still disable automatic logging or edit individual days.')
    # Opt-out is always safe: retain all completed days, even during rollback.
    boundary = max(literal, watermark)
    db.execute('UPDATE wear_periods SET ends_on=MAX(starts_on,?) WHERE account_id=? AND ends_on IS NULL',
               (boundary, owner))
    encoded = json.dumps(weekdays)
    if enabled:
        db.execute('INSERT INTO wear_periods(account_id,starts_on,weekdays_json) VALUES (?,?,?)',
                   (owner, literal, encoded))
    db.execute('INSERT INTO wear_preferences VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE '
               'SET enabled=excluded.enabled,weekdays_json=excluded.weekdays_json', (owner, int(enabled), encoded))
    return preferences(db, owner)


def action(route, body, authorization, key, query, api):
    if route not in ('history', 'day', 'automation'):
        raise api.Problem(404, 'not_found', 'Unknown wear route')
    with api.connection() as db:
        # Authenticate even invalid operations; writes recheck under the write lock.
        api.authenticate(db, authorization)
        if route == 'history':
            with api.transaction(db):
                account, _ = api.authenticate(db, authorization)
                instant = api.now()
                today = instant.astimezone(api.zone(account['time_zone'])).date()
                advance_calendar(db, account, today, instant, api)
                return api.reply(history(db, account, today, query, api))
        if query:
            raise api.Problem(message='Unexpected query parameters')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', key):
            api.fail('Idempotency-Key')
        fingerprint = hashlib.sha256(('POST ' + PREFIX + route + '\n' +
                                     json.dumps(body, sort_keys=True, separators=(',', ':'), allow_nan=False)).encode()).hexdigest()
        with api.transaction(db):
            account, _ = api.authenticate(db, authorization)
            owner = account['id']
            instant = api.now()
            today = instant.astimezone(api.zone(account['time_zone'])).date()
            watermark = advance_calendar(db, account, today, instant, api)
            receipt = db.execute('SELECT * FROM wear_receipts WHERE account_id=? AND key=?', (owner, key)).fetchone()
            if receipt:
                if receipt['fingerprint'] != fingerprint:
                    raise api.Problem(409, 'idempotency_mismatch', 'Key already used for a different request')
                return api.reply(json.loads(receipt['response_json']))
            try:
                result = (save_day(db, owner, today, body, api) if route == 'day' else
                          save_automation(db, owner, today, body, api, watermark))
            except api.Problem as error:
                if error.code != 'calendar_catch_up':
                    raise
                # Commit the operational fence even when this change is rejected.
                conflict = error
            else:
                if route == 'automation' and result['enabled']:
                    advance_calendar(db, account, today, instant, api)
                db.execute('INSERT INTO wear_receipts VALUES (?,?,?,?)',
                           (owner, key, fingerprint, api.encode(result)))
                return api.reply(result)
        raise conflict
