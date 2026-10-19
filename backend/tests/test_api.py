"""Real loopback HTTP tests. Only stdlib unittest/urllib; each test gets fresh SQLite."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import patch
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SIMPLE = "/api/oculog/v1/simple/"


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="oculog-http-")
        self.db_path = Path(self.tmp.name) / "fresh.sqlite3"
        self.log = open(Path(self.tmp.name) / "server.log", "w+")
        self.server = None
        self.counter = 0
        self.addCleanup(self.cleanup)
        self.start()
        result = self.register("one@example.com")
        self.token = result["token"]
        self.account = result["account"]

    def cleanup(self):
        self.stop()
        self.log.close()
        self.tmp.cleanup()

    def start(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        env = dict(os.environ, OCULOG_DB_PATH=str(self.db_path),
                   OCULOG_CORS_ORIGINS="http://localhost:8081,http://127.0.0.1:8081")
        self.server = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
                                        "--port", str(port), "--no-access-log", "--no-proxy-headers"],
                                       cwd=ROOT, env=env, stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.server.poll() is not None:
                break
            try:
                if self.call("GET", "/api/health")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.03)
        self.stop()
        self.log.seek(0)
        self.fail("Server did not start: " + self.log.read())

    def stop(self):
        if self.server and self.server.poll() is None:
            self.server.terminate()
            try:
                self.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait(timeout=5)

    def call(self, method, path, body=None, token=None, key=None, headers=None, raw=None):
        h = dict(headers or {})
        if token:
            h["Authorization"] = "Bearer " + token
        if key is not None:
            h["Idempotency-Key"] = key
        payload = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        if payload is not None:
            h.setdefault("Content-Type", "application/json")
        req = Request(self.base + path, data=payload, method=method, headers=h)
        try:
            response = urlopen(req, timeout=15)
        except HTTPError as exc:
            response = exc
        with response:
            data = response.read()
            parsed = json.loads(data) if data and response.headers.get_content_type() == "application/json" else None
            return response.status, parsed, response.headers, data

    def register(self, email, zone="UTC"):
        status, body, _, _ = self.call("POST", "/api/auth/register", {
            "email": email, "password": "correct horse", "displayName": "Tester", "timeZone": zone})
        self.assertEqual(status, 201, body)
        self.assertEqual(set(body), {"token", "expiresAt", "account"})
        self.assertTrue(body["expiresAt"].endswith("Z"))
        return body

    def mutation(self, route, body, key=None, expected=200, token=None):
        if key is None:
            self.counter += 1
            key = "test_" + str(self.counter)
        result = self.call("POST", SIMPLE + route, body, token or self.token, key)
        self.assertEqual(result[0], expected, result[1])
        return result

    def state(self, token=None):
        result = self.call("GET", SIMPLE + "state", token=token or self.token)
        self.assertEqual(result[0], 200, result[1])
        return result[1]

    def settings(self, **overrides):
        value = dict(eye="left", replacementDays=14, openedOn=None, timeZone="UTC")
        value.update(overrides)
        return value

    def sql(self, sql, params=()):
        with closing(sqlite3.connect(self.db_path, timeout=10)) as db:
            with db:
                return db.execute(sql, params).fetchall()

    def test_docs_and_openapi_over_http(self):
        docs = self.call("GET", "/docs")
        self.assertEqual(docs[0], 200)
        self.assertEqual(docs[2].get_content_type(), "text/html")
        self.assertIn(b"swagger-ui", docs[3])
        self.assertIn(b"SwaggerUIBundle", docs[3])
        self.assertIn(b"/openapi.json", docs[3])
        response = self.call("GET", "/openapi.json")
        self.assertEqual(response[0], 200)
        self.assertTrue(response[1]["openapi"].startswith("3."))
        paths = response[1]["paths"]
        expected = {"/api/health": "get", "/api/auth/register": "post",
                    "/api/auth/login": "post", "/api/auth/session": "get", "/api/auth/logout": "post",
                    **{SIMPLE + action: "get" if action == "state" else "post"
                       for action in ("state", "settings", "add", "replace", "day")}}
        self.assertEqual(set(paths), set(expected))
        for path, method in expected.items():
            self.assertEqual(set(paths[path]), {method})
            self.assertNotIn("parameters", paths[path][method])
        self.assertIn("201", paths["/api/auth/register"]["post"]["responses"])
        self.assertIn("204", paths["/api/auth/logout"]["post"]["responses"])
        for document in (docs[3], response[3]):
            for private in (self.token, self.account["id"], self.account["email"], "correct horse"):
                self.assertNotIn(private.encode(), document)

    def test_auth_lifecycle_hashes_isolation_and_normalization(self):
        session = self.call("GET", "/api/auth/session", token=self.token)
        self.assertEqual(session[0], 200)
        self.assertEqual(session[1]["token"], self.token)
        self.assertEqual(set(session[1]["account"]), {"id", "email", "displayName", "timeZone"})
        row = self.sql("SELECT email,password FROM accounts")[0]
        self.assertEqual(row[0], "one@example.com")
        self.assertTrue(row[1].startswith("scrypt-v1$16384$8$1$"))
        self.assertNotIn("correct horse", row[1])
        stored = self.sql("SELECT token_hash FROM sessions")[0][0]
        self.assertEqual(stored, hashlib.sha256(self.token.encode()).hexdigest())
        self.assertNotEqual(stored, self.token)
        login = self.call("POST", "/api/auth/login", {"email": " ONE@EXAMPLE.COM ", "password": "correct horse"})
        self.assertEqual(login[0], 200)
        self.assertNotEqual(login[1]["token"], self.token)
        for email, password in [("one@example.com", "wrong password"), ("unknown@example.com", "wrong password")]:
            r = self.call("POST", "/api/auth/login", {"email": email, "password": password})
            self.assertEqual(r[0], 401)
            self.assertEqual(r[1]["error"]["message"], "Invalid email or password")
        duplicate = self.call("POST", "/api/auth/register", dict(email=" ONE@EXAMPLE.COM ", password="correct horse",
                                                               displayName="Another", timeZone="UTC"))
        self.assertEqual(duplicate[0], 400)
        second = self.register("two@example.com")
        hashes = self.sql("SELECT password FROM accounts")
        self.assertNotEqual(hashes[0][0], hashes[1][0])
        self.mutation("add", {"eye": "left", "quantity": 3})
        self.assertEqual(self.state(second["token"])["eyes"][0]["spareCount"], 0)
        for header in [None, "wrong", self.token[:-1], "A" * 43]:
            self.assertEqual(self.call("GET", SIMPLE + "state", token=header)[0], 401)
        self.assertEqual(self.call("POST", "/api/auth/logout", {"extra": True}, token=self.token)[0], 400)
        self.assertEqual(self.call("POST", "/api/auth/logout", token=self.token)[0], 204)
        self.assertEqual(self.call("GET", "/api/auth/session", token=self.token)[0], 401)
        self.assertEqual(self.call("POST", SIMPLE + "add", {"eye": "left", "quantity": 1}, self.token, "after_logout")[0], 401)
        self.assertEqual(self.call("GET", "/api/auth/session", token=login[1]["token"])[0], 200)
        self.sql("UPDATE sessions SET expires=?", (int(time.time()) - 1,))
        self.assertEqual(self.call("GET", "/api/auth/session", token=login[1]["token"])[0], 401)

    def test_exact_state_stock_and_calendar(self):
        initial = self.state()
        self.assertEqual(set(initial), {"today", "timeZone", "eyes", "daily"})
        self.assertEqual(initial["daily"], {"localDate": initial["today"], "worn": None})
        self.assertEqual(initial["eyes"], [{"id": None, "eye": eye, "replacementDays": None,
                                           "openedOn": None, "dueOn": None, "spareCount": 0, "daysRemaining": None}
                                          for eye in ("left", "right")])
        added = self.mutation("add", {"eye": "left", "quantity": 5})[1]
        self.assertIsInstance(added["eyes"][0]["id"], str)
        self.assertIsNone(added["eyes"][0]["replacementDays"])
        self.assertEqual(self.mutation("replace", {"eye": "left"}, expected=409)[1]["error"]["code"], "schedule_required")
        s = self.mutation("settings", self.settings(openedOn="2024-02-28", replacementDays=2))[1]
        self.assertEqual(s["eyes"][0]["dueOn"], "2024-03-01")
        self.assertEqual(s["eyes"][0]["spareCount"], 5)
        self.assertEqual(s["eyes"][0]["id"], added["eyes"][0]["id"])
        self.assertEqual(s["eyes"][0]["daysRemaining"], (date(2024, 3, 1) - date.fromisoformat(s["today"])).days)
        replaced = self.mutation("replace", {"eye": "left"})[1]
        self.assertEqual(replaced["eyes"][0]["spareCount"], 4)
        self.assertEqual(replaced["eyes"][0]["openedOn"], replaced["today"])
        self.assertEqual(replaced["eyes"][0]["dueOn"], (date.fromisoformat(replaced["today"]) + timedelta(days=2)).isoformat())
        self.mutation("settings", self.settings(eye="right"))
        self.assertEqual(self.mutation("replace", {"eye": "right"}, expected=409)[1]["error"]["code"], "insufficient_stock")
        self.mutation("day", {"localDate": replaced["today"], "worn": False})
        current = self.state()
        self.assertIs(current["daily"]["worn"], False)
        self.assertEqual(current["eyes"], replaced["eyes"][:1] + current["eyes"][1:])
        self.mutation("day", {"localDate": replaced["today"], "worn": True})
        self.assertIs(self.state()["daily"]["worn"], True)
        self.mutation("day", {"localDate": "2024-02-29", "worn": False})
        self.assertEqual(self.state()["eyes"][0]["dueOn"], replaced["eyes"][0]["dueOn"])

    def test_timezone_and_dst_calendar_dates(self):
        for zone in ["America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"]:
            result = self.mutation("settings", self.settings(timeZone=zone, openedOn="2024-03-09", replacementDays=2))[1]
            self.assertEqual(result["timeZone"], zone)
            self.assertEqual(result["today"], datetime.now(timezone.utc).astimezone(ZoneInfo(zone)).date().isoformat())
            self.assertEqual(result["eyes"][0]["dueOn"], "2024-03-11")
            self.assertEqual(self.call("GET", "/api/auth/session", token=self.token)[1]["account"]["timeZone"], zone)
        result = self.mutation("settings", self.settings(timeZone="America/New_York", openedOn="2024-11-02", replacementDays=2))[1]
        self.assertEqual(result["eyes"][0]["dueOn"], "2024-11-04")
        self.mutation("settings", self.settings(openedOn=None))
        self.assertIsNone(self.state()["eyes"][0]["dueOn"])

    def test_validation_is_strict_and_errors_are_sanitized(self):
        tomorrow = (date.fromisoformat(self.state()["today"]) + timedelta(days=1)).isoformat()
        invalid = [
            ("add", {"eye": "left", "quantity": True}), ("add", {"eye": "left", "quantity": 1.0}),
            ("add", {"eye": "left", "quantity": 0}), ("add", {"eye": "left", "quantity": 9007199254740992}),
            ("add", {"eye": "left", "quantity": "1"}), ("add", {"eye": ["left"], "quantity": 1}),
            ("add", {"eye": "left", "quantity": 1, "extra": 0}), ("add", {"eye": "left"}),
            ("settings", self.settings(replacementDays=True)), ("settings", self.settings(replacementDays=366)),
            ("settings", self.settings(openedOn="2023-02-29")), ("settings", self.settings(openedOn="2024-2-01")),
            ("settings", self.settings(openedOn="0000-01-01")), ("settings", self.settings(timeZone="../UTC")),
            ("settings", self.settings(timeZone="Nonsense/Zone")), ("settings", self.settings(openedOn=tomorrow)),
            ("day", {"localDate": tomorrow, "worn": True}), ("day", {"localDate": "2024-02-29", "worn": 0}),
        ]
        for route, body in invalid:
            with self.subTest(body=body):
                result = self.mutation(route, body, expected=400)
                self.assertEqual(result[1]["error"]["code"], "validation")
                self.assertNotIn(b"Traceback", result[3])
        for raw in [b"[]", b"null", b"{", b'{"eye":"left","quantity":NaN}',
                    b'{"eye":"left","quantity":1e999}', b'{"eye":"left","quantity":1,"quantity":2}',
                    b'{"eye":"\\ud800","quantity":1}', b"{" + b" " * 17000 + b"}", b'{"x":' + b'[' * 1100]:
            self.assertEqual(self.call("POST", SIMPLE + "add", token=self.token, key="raw", raw=raw)[0], 400)
        for key in [None, "", "bad key", "x" * 129, "!"]:
            self.assertEqual(self.call("POST", SIMPLE + "add", {"eye": "left", "quantity": 1}, self.token, key)[0], 400)
        for payload in [dict(email="bad", password="correct horse"), dict(email="one@example.com", password="short"),
                        dict(email="one@example.com", password="x" * 1025),
                        dict(email="one@example.com", password="correct horse", extra=True)]:
            self.assertEqual(self.call("POST", "/api/auth/login", payload)[0], 400)
        for name, zone in [("", "UTC"), ("x" * 101, "UTC"), ("X", "invalid")]:
            self.assertEqual(self.call("POST", "/api/auth/register", dict(email="new@example.com", password="correct horse",
                                                                          displayName=name, timeZone=zone))[0], 400)
        self.assertEqual(self.call("GET", "/api/collections/users/records")[0], 404)
        self.assertEqual(self.call("POST", SIMPLE + "add", {"eye": "left", "quantity": 1}, self.token, "type",
                                   headers={"Content-Type": "text/plain"})[0], 400)

    def test_safe_integer_accumulation_rollback_and_no_failure_receipt(self):
        self.mutation("add", {"eye": "left", "quantity": 9007199254740991})
        before = self.state()
        self.mutation("add", {"eye": "left", "quantity": 1}, key="overflow", expected=400)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM receipts WHERE key='overflow'")[0][0], 0)
        # A failed key can be reused, with a different body/route.
        self.mutation("settings", self.settings(), key="overflow")
        self.assertEqual(self.state()["eyes"][0]["spareCount"], 9007199254740991)
        self.mutation("replace", {"eye": "right"}, key="recover", expected=409)
        self.mutation("settings", self.settings(eye="right"))
        self.mutation("add", {"eye": "right", "quantity": 1})
        self.mutation("replace", {"eye": "right"}, key="recover")
        # Inject a transactional write failure after the eye was updated: all must roll back.
        self.sql("CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts WHEN NEW.key='forced' BEGIN SELECT RAISE(ABORT,'secret-marker'); END")
        before = self.state()
        result = self.mutation("add", {"eye": "left", "quantity": 1}, key="forced", expected=400)
        # Left is at the safe integer bound; use right to reach the trigger.
        result = self.mutation("add", {"eye": "right", "quantity": 1}, key="forced", expected=500)
        self.assertEqual(result[1], {"error": {"code": "internal_error", "message": "An internal error occurred"}})
        self.assertNotIn(b"secret-marker", result[3])
        self.assertEqual(self.state(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM receipts WHERE key='forced'")[0][0], 0)
        cors_error = self.call("POST", SIMPLE + "add", {"eye": "right", "quantity": 1}, self.token, "forced",
                               headers={"Origin": "http://localhost:8081"})
        self.assertEqual(cors_error[0], 500)
        self.assertEqual(cors_error[2]["Access-Control-Allow-Origin"], "http://localhost:8081")

    def test_idempotent_exact_snapshot_restart_and_conflicts(self):
        original = self.mutation("add", {"eye": "left", "quantity": 2}, key="stable")
        self.mutation("add", {"eye": "left", "quantity": 3})
        self.mutation("settings", self.settings(timeZone="Pacific/Kiritimati"))
        repeated = self.mutation("add", {"quantity": 2, "eye": "left"}, key="stable")
        self.assertEqual(repeated[3], original[3])
        for route, body in [("add", {"eye": "left", "quantity": 3}), ("replace", {"eye": "left"})]:
            r = self.mutation(route, body, key="stable", expected=409)
            self.assertEqual(r[1]["error"]["code"], "idempotency_mismatch")
        self.stop()
        self.start()
        self.assertEqual(self.mutation("add", {"eye": "left", "quantity": 2}, key="stable")[3], original[3])
        self.assertEqual(self.state()["eyes"][0]["spareCount"], 5)
        other = self.register("other@example.com")
        self.assertEqual(self.mutation("add", {"eye": "left", "quantity": 7}, key="stable", token=other["token"])[1]["eyes"][0]["spareCount"], 7)

    def test_concurrent_retries_distinct_writes_and_stock(self):
        def add(key):
            return self.call("POST", SIMPLE + "add", {"eye": "left", "quantity": 1}, self.token, key)
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(add, ["same"] * 20))
        self.assertTrue(all(r[0] == 200 for r in results))
        self.assertTrue(all(r[3] == results[0][3] for r in results))
        self.assertEqual(self.state()["eyes"][0]["spareCount"], 1)
        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(add, [f"distinct_{i}" for i in range(20)]))
        self.assertTrue(all(r[0] == 200 for r in results))
        self.assertEqual(self.state()["eyes"][0]["spareCount"], 21)
        self.mutation("settings", self.settings(eye="right"))
        self.mutation("add", {"eye": "right", "quantity": 1})
        def replace(i):
            return self.call("POST", SIMPLE + "replace", {"eye": "right"}, self.token, f"replace_{i}")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(replace, range(8)))
        self.assertEqual(sum(r[0] == 200 for r in results), 1)
        self.assertEqual(sum(r[0] == 409 for r in results), 7)
        self.assertEqual(self.state()["eyes"][1]["spareCount"], 0)

    def test_cors_health_and_auth_attempt_limit(self):
        response = self.call("GET", "/api/health", headers={"Origin": "http://localhost:8081"})
        self.assertEqual(response[0], 200)
        self.assertEqual(response[2]["Access-Control-Allow-Origin"], "http://localhost:8081")
        self.assertIsNone(response[2].get("Access-Control-Allow-Credentials"))
        preflight = self.call("OPTIONS", SIMPLE + "add", headers={"Origin": "http://localhost:8081",
                           "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,idempotency-key"})
        self.assertEqual(preflight[0], 200)
        for origin in ["https://evil.example", "null"]:
            self.assertIsNone(self.call("GET", "/api/health", headers={"Origin": origin})[2].get("Access-Control-Allow-Origin"))
        unauthorized = self.call("GET", SIMPLE + "state", headers={"Origin": "http://localhost:8081"})
        self.assertEqual(unauthorized[0], 401)
        self.assertEqual(unauthorized[2]["Access-Control-Allow-Origin"], "http://localhost:8081")
        results = [self.call("POST", "/api/auth/login", {"email": "bad@example.com", "password": "incorrect password"}) for _ in range(21)]
        self.assertEqual(results[-1][0], 429)
        self.assertEqual(results[-1][1]["error"]["code"], "throttled")
        # Throttle is auth-only; an existing user's data/session requests still work.
        self.assertEqual(self.call("GET", "/api/auth/session", token=self.token)[0], 200)


class DomainTests(unittest.TestCase):
    def test_date_overflow_and_scrypt_dummy(self):
        from backend.main import due, Problem, DUMMY_HASH, password_matches, password_hash, DEFAULT_DB
        with self.assertRaises(Problem):
            due("9999-12-31", 1)
        self.assertEqual(due("2024-02-28", 1), date(2024, 2, 29))
        self.assertFalse(password_matches("correct horse", DUMMY_HASH))
        self.assertTrue(password_matches("correct horse", password_hash("correct horse")))
        self.assertEqual(DEFAULT_DB, ROOT / "backend" / "data" / "oculog.sqlite3")

    def test_session_rechecked_after_waiting_for_write_lock(self):
        # Check the actual write path with a session which expires while BEGIN IMMEDIATE waits.
        from backend import main
        with tempfile.TemporaryDirectory() as directory:
            old = os.environ.get("OCULOG_DB_PATH")
            os.environ["OCULOG_DB_PATH"] = str(Path(directory) / "test.sqlite3")
            try:
                main.initialize()
                with main.connection() as db:
                    db.execute("INSERT INTO accounts VALUES ('a','a@example.com','x','A','UTC')")
                    token = "a" * 43
                    digest = hashlib.sha256(token.encode()).hexdigest()
                    db.execute("INSERT INTO sessions VALUES (?,?,?,0)", (digest, "a", int(time.time()) + 1))
                    db.execute("BEGIN IMMEDIATE")
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(main.data_action, "add", {"eye": "left", "quantity": 1}, "Bearer " + token, "waited")
                        time.sleep(1.2)
                        db.commit()
                        with self.assertRaises(main.Problem) as error:
                            future.result(timeout=10)
                        self.assertEqual(error.exception.status, 401)
                    self.assertEqual(db.execute("SELECT count(*) FROM eyes").fetchone()[0], 0)
                    self.assertEqual(db.execute("SELECT count(*) FROM receipts").fetchone()[0], 0)
                    # Revocation committed by another writer must also be rechecked.
                    db.execute("UPDATE sessions SET expires=?,revoked=0", (int(time.time()) + 3600,))
                    db.execute("BEGIN IMMEDIATE")
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(main.data_action, "add", {"eye": "left", "quantity": 1}, "Bearer " + token, "revoked")
                        db.execute("UPDATE sessions SET revoked=1")
                        db.commit()
                        with self.assertRaises(main.Problem) as error:
                            future.result(timeout=10)
                        self.assertEqual(error.exception.status, 401)
                    db.execute("UPDATE sessions SET revoked=0")
                    # A year-9999 calendar overflow is validation, never an uncaught 500.
                    with patch.object(main, "now", return_value=datetime(9999, 12, 31, tzinfo=timezone.utc)):
                        with self.assertRaises(main.Problem) as error:
                            main.data_action("settings", dict(eye="left", replacementDays=1,
                                             openedOn="9999-12-31", timeZone="UTC"), "Bearer " + token, "calendar")
                        self.assertEqual(error.exception.status, 400)
                    self.assertEqual(db.execute("SELECT count(*) FROM eyes").fetchone()[0], 0)
                    self.assertEqual(db.execute("SELECT count(*) FROM receipts").fetchone()[0], 0)
            finally:
                if old is None:
                    del os.environ["OCULOG_DB_PATH"]
                else:
                    os.environ["OCULOG_DB_PATH"] = old


if __name__ == "__main__":
    unittest.main()
