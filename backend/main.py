"""Small, synchronous SQLite domain behind a bounded HTTP adapter."""
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool

MAX_INT = 9007199254740991
MAX_BODY = 16384
PREFIX = "/api/oculog/v1/simple/"
DEFAULT_DB = Path(__file__).resolve().parent / "data" / "oculog.sqlite3"
TOKEN_SECONDS = 30 * 24 * 3600
SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
 display_name TEXT NOT NULL, time_zone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS eyes (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 eye TEXT NOT NULL CHECK(eye IN ('left','right')), replacement_days INTEGER,
 opened_on TEXT, spare_count INTEGER NOT NULL DEFAULT 0 CHECK(spare_count >= 0),
 UNIQUE(account_id,eye));
CREATE TABLE IF NOT EXISTS days (
 account_id TEXT NOT NULL REFERENCES accounts(id), local_date TEXT NOT NULL,
 worn INTEGER NOT NULL CHECK(worn IN (0,1)), PRIMARY KEY(account_id,local_date));
CREATE TABLE IF NOT EXISTS receipts (
 account_id TEXT NOT NULL REFERENCES accounts(id), key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(account_id,key));
"""


class Problem(Exception):
    def __init__(self, status=400, code="validation", message="Invalid request", fields=None):
        self.status, self.code, self.message, self.fields = status, code, message, fields


def fail(field, message="Invalid value"):
    raise Problem(fields={field: message})


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False)


def reply(value, status=200):
    return Response(encode(value), status_code=status, media_type="application/json")


def error_response(exc):
    body = {"code": exc.code, "message": exc.message}
    if exc.fields:
        body["fields"] = exc.fields
    return reply({"error": body}, exc.status)


def utc_stamp(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def now():
    return datetime.now(timezone.utc)


def zone(value):
    if not isinstance(value, str) or len(value) > 100 or not value:
        fail("timeZone")
    try:
        return ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        fail("timeZone", "Expected an IANA time zone")


def calendar(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        fail(field)
    try:
        return date.fromisoformat(value)
    except ValueError:
        fail(field)


def due(opened, interval):
    try:
        return date.fromisoformat(opened) + timedelta(days=interval)
    except (ValueError, OverflowError):
        fail("openedOn", "Schedule exceeds supported calendar range")


def strict(body, fields):
    if not isinstance(body, dict) or set(body) != set(fields):
        raise Problem(message="Expected exactly: " + ", ".join(fields))


def integer(value, field, maximum=MAX_INT):
    if type(value) is not int or not 1 <= value <= maximum:
        fail(field)


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return "scrypt-v1$16384$8$1$" + salt.hex() + "$" + digest.hex()


DUMMY_HASH = password_hash("unusable dummy password")


def password_matches(password, encoded):
    try:
        version, n, r, p, salt, digest = encoded.split("$")
        if (version, n, r, p) != ("scrypt-v1", "16384", "8", "1"):
            return False
        return hmac.compare_digest(password_hash(password, bytes.fromhex(salt)), encoded)
    except (ValueError, TypeError):
        return False


@contextmanager
def connection():
    path = Path(os.environ.get("OCULOG_DB_PATH", str(DEFAULT_DB))).expanduser()
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=10000")
    try:
        yield db
    finally:
        db.close()


@contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def initialize():
    path = Path(os.environ.get("OCULOG_DB_PATH", str(DEFAULT_DB))).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Create restrictively before SQLite can create journals containing account data.
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    path.chmod(0o600)
    with connection() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)


class AttemptLimit:
    """Bounded, process-local IP limiter. Do not trust forwarded headers."""
    def __init__(self):
        self.lock = threading.Lock()
        self.entries = {}

    def check(self, ip):
        current = time.monotonic()
        with self.lock:
            self.entries = {k: v for k, v in self.entries.items() if v[0] > current - 60}
            start, count = self.entries.get(ip, (current, 0))
            if count >= 20 or (ip not in self.entries and len(self.entries) >= 10000):
                raise Problem(429, "throttled", "Too many authentication attempts; try later")
            self.entries[ip] = (start, count + 1)


attempts = AttemptLimit()


def authenticate(db, authorization):
    if not isinstance(authorization, str) or not re.fullmatch(r"Bearer [A-Za-z0-9_-]{43}", authorization):
        raise Problem(401, "unauthorized", "Authentication required")
    token = authorization[7:]
    digest = hashlib.sha256(token.encode()).hexdigest()
    row = db.execute("SELECT a.*, s.expires FROM sessions s JOIN accounts a ON a.id=s.account_id "
                     "WHERE s.token_hash=? AND s.revoked=0 AND s.expires>?", (digest, int(time.time()))).fetchone()
    if row is None:
        raise Problem(401, "unauthorized", "Authentication required")
    return row, token


def session(account, token, expiry):
    return {"token": token, "expiresAt": utc_stamp(expiry), "account": {
        "id": account["id"], "email": account["email"], "displayName": account["display_name"],
        "timeZone": account["time_zone"]}}


def credentials(body, register):
    strict(body, ["email", "password", "displayName", "timeZone"] if register else ["email", "password"])
    email, password = body["email"], body["password"]
    if not isinstance(email, str) or len(email) > 254:
        fail("email")
    email = email.strip().casefold()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        fail("email")
    if not isinstance(password, str) or not 8 <= len(password) <= 1024 or len(password.encode()) > 4096:
        fail("password", "Use 8 to 1024 characters (at most 4096 UTF-8 bytes)")
    if register:
        if not isinstance(body["displayName"], str) or not 1 <= len(body["displayName"].strip()) <= 100:
            fail("displayName")
        zone(body["timeZone"])
    return email, password


def auth_action(route, body, authorization, ip):
    if route in ("register", "login"):
        attempts.check(ip)
        email, password = credentials(body, route == "register")
        with connection() as db:
            if route == "register":
                hashed = password_hash(password)
                with transaction(db):
                    if db.execute("SELECT 1 FROM accounts WHERE email=?", (email,)).fetchone():
                        raise Problem(400, "validation", "Account cannot be registered", {"email": "Unavailable"})
                    account_id = secrets.token_hex(16)
                    db.execute("INSERT INTO accounts VALUES (?,?,?,?,?)", (account_id, email, hashed,
                               body["displayName"].strip(), body["timeZone"]))
                    account = db.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
                    return new_session(db, account, 201)
            account = db.execute("SELECT * FROM accounts WHERE email=?", (email,)).fetchone()
            valid = password_matches(password, account["password"] if account else DUMMY_HASH)
            if not valid or account is None:
                raise Problem(401, "unauthorized", "Invalid email or password")
            with transaction(db):
                return new_session(db, account, 200)
    with connection() as db:
        if route == "logout":
            with transaction(db):
                _, token = authenticate(db, authorization)
                db.execute("UPDATE sessions SET revoked=1 WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
            return Response(status_code=204)
        account, token = authenticate(db, authorization)
        return reply(session(account, token, account["expires"]))


def new_session(db, account, status):
    token = secrets.token_urlsafe(32)
    expiry = int(time.time()) + TOKEN_SECONDS
    db.execute("INSERT INTO sessions(token_hash,account_id,expires) VALUES (?,?,?)",
               (hashlib.sha256(token.encode()).hexdigest(), account["id"], expiry))
    return reply(session(account, token, expiry), status)


def state(db, account):
    today = now().astimezone(zone(account["time_zone"])).date()
    rows = {r["eye"]: r for r in db.execute("SELECT * FROM eyes WHERE account_id=?", (account["id"],))}
    eyes = []
    for eye in ("left", "right"):
        row = rows.get(eye)
        opened = row["opened_on"] if row else None
        interval = row["replacement_days"] if row else None
        deadline = due(opened, interval) if opened else None
        eyes.append({"id": row["id"] if row else None, "eye": eye, "replacementDays": interval,
                     "openedOn": opened, "dueOn": deadline.isoformat() if deadline else None,
                     "spareCount": row["spare_count"] if row else 0,
                     "daysRemaining": (deadline - today).days if deadline else None})
    log = db.execute("SELECT worn FROM days WHERE account_id=? AND local_date=?", (account["id"], today.isoformat())).fetchone()
    return {"today": today.isoformat(), "timeZone": account["time_zone"], "eyes": eyes,
            "daily": {"localDate": today.isoformat(), "worn": bool(log[0]) if log else None}}


def mutate(db, account, route, body):
    fields = {"settings": ["eye", "replacementDays", "openedOn", "timeZone"],
              "add": ["eye", "quantity"], "replace": ["eye"], "day": ["localDate", "worn"]}
    strict(body, fields[route])
    owner = account["id"]
    today = now().astimezone(zone(account["time_zone"])).date()
    if route == "day":
        day = calendar(body["localDate"], "localDate")
        if day > today:
            fail("localDate", "Future days are not allowed")
        if type(body["worn"]) is not bool:
            fail("worn")
        db.execute("INSERT INTO days VALUES (?,?,?) ON CONFLICT(account_id,local_date) DO UPDATE SET worn=excluded.worn",
                   (owner, day.isoformat(), int(body["worn"])))
        return
    eye = body["eye"]
    if eye not in ("left", "right"):
        fail("eye")
    row = db.execute("SELECT * FROM eyes WHERE account_id=? AND eye=?", (owner, eye)).fetchone()
    if route == "settings":
        z = zone(body["timeZone"])
        integer(body["replacementDays"], "replacementDays", 365)
        opened = body["openedOn"]
        if opened is not None:
            day = calendar(opened, "openedOn")
            if day > now().astimezone(z).date():
                fail("openedOn", "Future dates are not allowed")
            due(opened, body["replacementDays"])
        db.execute("UPDATE accounts SET time_zone=? WHERE id=?", (body["timeZone"], owner))
        if row:
            db.execute("UPDATE eyes SET replacement_days=?,opened_on=? WHERE id=?",
                       (body["replacementDays"], opened, row["id"]))
        else:
            db.execute("INSERT INTO eyes VALUES (?,?,?,?,?,0)",
                       (secrets.token_hex(16), owner, eye, body["replacementDays"], opened))
    elif route == "add":
        integer(body["quantity"], "quantity")
        count = (row["spare_count"] if row else 0) + body["quantity"]
        integer(count, "quantity")
        if row:
            db.execute("UPDATE eyes SET spare_count=? WHERE id=?", (count, row["id"]))
        else:
            db.execute("INSERT INTO eyes VALUES (?,?,?,NULL,NULL,?)", (secrets.token_hex(16), owner, eye, count))
    else:
        if row is None or row["replacement_days"] is None:
            raise Problem(409, "schedule_required", "Configure a replacement schedule first")
        if row["spare_count"] < 1:
            raise Problem(409, "insufficient_stock", "No spare lenses available")
        due(today.isoformat(), row["replacement_days"])
        db.execute("UPDATE eyes SET spare_count=spare_count-1,opened_on=? WHERE id=?", (today.isoformat(), row["id"]))


def data_action(route, body, authorization, key):
    with connection() as db:
        if route == "state":
            # A read transaction keeps account timezone and lens/log rows one snapshot.
            db.execute("BEGIN")
            account, _ = authenticate(db, authorization)
            return reply(state(db, account))
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", key):
            fail("Idempotency-Key")
        fingerprint = hashlib.sha256(("POST " + PREFIX + route + "\n" +
                                     json.dumps(body, sort_keys=True, separators=(",", ":"), allow_nan=False)).encode()).hexdigest()
        with transaction(db):
            account, _ = authenticate(db, authorization)
            receipt = db.execute("SELECT * FROM receipts WHERE account_id=? AND key=?", (account["id"], key)).fetchone()
            if receipt:
                if receipt["fingerprint"] != fingerprint:
                    raise Problem(409, "idempotency_mismatch", "Key already used for a different request")
                return Response(receipt["response"], media_type="application/json")
            mutate(db, account, route, body)
            account = db.execute("SELECT * FROM accounts WHERE id=?", (account["id"],)).fetchone()
            serialized = encode(state(db, account))
            db.execute("INSERT INTO receipts VALUES (?,?,?,?)", (account["id"], key, fingerprint, serialized))
            return Response(serialized, media_type="application/json")


@asynccontextmanager
async def lifespan(app):
    await run_in_threadpool(initialize)
    yield


app = FastAPI(lifespan=lifespan)
origins = os.environ.get("OCULOG_CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081").split(",")
origins = [origin.strip() for origin in origins if origin.strip()]
if any("*" in origin for origin in origins):
    raise RuntimeError("OCULOG_CORS_ORIGINS must contain explicit origins")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])


@app.exception_handler(Problem)
async def problem_handler(request, exc):
    return error_response(exc)


@app.exception_handler(RequestValidationError)
async def validation_handler(request, exc):
    return error_response(Problem())


@app.exception_handler(HTTPException)
async def http_handler(request, exc):
    return error_response(Problem(exc.status_code, "not_found" if exc.status_code == 404 else "http_error", "Request not supported"))


@app.exception_handler(Exception)
async def unexpected_handler(request, exc):
    return sanitized_failure(exc)


def sanitized_failure(exc):
    # Never log request bodies, credentials, tokens, SQL parameters or raw exceptions.
    logging.getLogger("oculog").error("Request failed (%s)", type(exc).__name__)
    return error_response(Problem(500, "internal_error", "An internal error occurred"))


def dispatch(operation, *args):
    # Handle database/runtime failures inside CORS and avoid uvicorn logging raw SQL errors.
    try:
        return operation(*args)
    except Problem:
        raise
    except Exception as exc:
        return sanitized_failure(exc)


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


async def read_body(request):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise Problem(message="Expected application/json")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BODY:
            raise Problem(message="Request body too large")
        data.extend(chunk)
    try:
        result = json.loads(data.decode("utf-8"), object_pairs_hook=object_pairs,
                            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(result, dict):
            raise ValueError()
        # Also reject lone surrogates, even in unused fields, before SQLite/UTF-8 encoding.
        encode(result).encode("utf-8")
        def valid_strings(value):
            if isinstance(value, str):
                value.encode("utf-8")
            elif isinstance(value, dict):
                for k, v in value.items():
                    valid_strings(k)
                    valid_strings(v)
            elif isinstance(value, list):
                for v in value:
                    valid_strings(v)
        valid_strings(result)
        return result
    except (ValueError, UnicodeError, RecursionError):
        raise Problem(message="Invalid JSON object") from None


@app.get("/api/health")
async def health():
    return reply({"ok": True})


@app.post("/api/auth/register", status_code=201)
@app.post("/api/auth/login")
@app.get("/api/auth/session")
@app.post("/api/auth/logout", status_code=204)
async def auth_route(request: Request):
    action = request.url.path.rsplit("/", 1)[1]
    if (action, request.method) not in {("register", "POST"), ("login", "POST"), ("session", "GET"), ("logout", "POST")}:
        raise Problem(404, "not_found", "Request not supported")
    body = await read_body(request) if action in ("register", "login") else None
    if action == "logout":
        async for chunk in request.stream():
            if chunk:
                raise Problem(message="Logout does not accept a request body")
    return await run_in_threadpool(dispatch, auth_action, action, body, request.headers.get("authorization"),
                                  request.client.host if request.client else "unknown")


@app.get(PREFIX + "state")
@app.post(PREFIX + "settings")
@app.post(PREFIX + "add")
@app.post(PREFIX + "replace")
@app.post(PREFIX + "day")
async def data_route(request: Request):
    action = request.url.path.rsplit("/", 1)[1]
    if (action, request.method) not in {("state", "GET"), ("settings", "POST"), ("add", "POST"), ("replace", "POST"), ("day", "POST")}:
        raise Problem(404, "not_found", "Request not supported")
    body = await read_body(request) if request.method == "POST" else None
    return await run_in_threadpool(dispatch, data_action, action, body, request.headers.get("authorization"),
                                  request.headers.get("idempotency-key"))
