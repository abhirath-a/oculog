# Python API

The iOS app still requires the FastAPI service. Removing other clients does not make account/lens data device-only.

## Run locally

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
pnpm api
```

The launcher loads root `.env`; `pnpm api --no-env-file` disables that behavior. For direct process supervision, provide the environment explicitly:

```sh
.venv/bin/python -m uvicorn backend.main:app \
  --host 127.0.0.1 --port 8000 --workers 1
```

`GET /api/health` is liveness only. It does not verify SQLite, corpus availability, backups, or provider readiness.

## Routes

| Area | Routes |
| --- | --- |
| Accounts | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout` |
| Lens state | `/api/oculog/v1/simple/`: state, settings, add, replace, day |
| Prepared advice | `/api/oculog/v1/advice` and `/answer` |
| Source education | `/api/oculog/v2/education`, `/consent`, `/answer` |
| Question-aware advice | `/api/oculog/v3/advice`, `/consent`, `/answer` |
| Wear | `/api/oculog/v2/wear/history`, `/day`, `/automation` |
| Learning | `/api/oculog/v2/learning`, `/answer`, `/reset` |

Use the route declarations, strict parsers, and backend tests as the request/response contract. Authenticated operations use opaque bearer sessions. Mutations with receipts require `Idempotency-Key`; reusing a key for a different intent is not a supported retry. Do not paste production bearer tokens into documentation or issue reports.

## Storage and safeguards

`OCULOG_DB_PATH` overrides the database location; the default is under `backend/data/`, resolved from the backend module. SQLite uses WAL, foreign keys, and a busy timeout. Data and runtime files are ignored by Git.

Preserve strict JSON validation, body-size limits, sanitized errors, account isolation, password hashing, session revocation, and idempotent mutations. Server CORS configuration is retained as an API security boundary, not a supported browser client or authentication mechanism. Native iOS requests do not depend on CORS.

## Operations

Use one service worker initially. The current authentication limiter is process-local; multiple workers do not create a shared abuse-control system. Deploy behind HTTPS with an unprivileged supervised process, persistent private storage, trusted-proxy configuration, ingress request limits, and monitoring. Do not use Metro or the development launcher as a production service.

Back up SQLite consistently using its online backup facilities, with encrypted off-host copies and a restoration drill. Copying a live database file while ignoring its WAL is not a reliable backup. Startup table creation is not a versioned migration framework; test upgrades against backed-up existing data before deployment.

Provider processing is optional and disabled by default. It requires deliberate server-only configuration and consent; see [privacy](privacy.md). Do not enable paid processing just to run the test suite.

Account recovery/deletion, shared abuse quotas, migration operations, readiness checks, restoration, privacy policy, and store compliance need release-owner review. See [release](release.md); this document is not a complete production deployment configuration.
