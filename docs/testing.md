# Testing

## Commands

From the repository root, with an interpreter that has the backend dependencies installed:

```sh
. .venv/bin/activate
pnpm typecheck
pnpm test:mobile
pnpm test:backend
python -m unittest discover -s scripts/tests -v
python -m unittest discover -s evaluation -p 'test*.py' -v
pnpm export:ios
pnpm check
```

`pnpm test` runs mobile then backend tests; run them separately when investigating failures so one does not hide the other. Python HTTP tests launch subprocess servers using the test interpreter. A system interpreter missing Uvicorn is an environment failure, not a passing or meaningful API regression run.

CI runs lint, typecheck, mobile tests, and iOS JS export independently on Linux. The backend job installs pinned direct Python requirements and runs backend/scripts tests. No job needs signing credentials, an external provider key, or a paid request. An iOS export is not a native compilation test.

On NixOS, use `nix develop` for Biome's loader. Run targeted formatting first; `pnpm format` rewrites the workspace and can create unrelated changes.

## Coverage layers

1. **Models/parsers:** date handling, validation, OCR parsing, educational content, and record semantics.
2. **Controllers/transports:** account/session changes, uncertain delivery, idempotency, races, failure acknowledgment, and refresh behavior.
3. **Component harnesses:** Node/TypeScript transpilation and mocked native components exercise iOS callbacks and view contracts. Mocks must match current exports; they do not prove SwiftUI rendering or device behavior.
4. **Backend:** disposable synthetic accounts/databases, real local HTTP where applicable, fake external transport for provider tests.
5. **Native acceptance:** an installed iOS build, on simulator and real hardware as appropriate.

Platform removal removes Android/browser-specific expectations, not shared functional coverage. Keep native secure-persistence races, owner/session fences, literal date semantics, safety checks, permission denial, missing OCR-module fallback, and temporary-file cleanup tests. Do not delete or weaken those assertions just to make a migration pass.

Structural tests enforce the iOS-only target and canonical modules. Do not reintroduce platform suffixes, Jetpack/Material imports, browser rendering dependencies, or browser build scripts.

## iOS acceptance checklist

Use synthetic data and record device model, OS, commit, and build type:

- [ ] Cold start, auth restoration, expiry, failed login, offline sign-out, account switching.
- [ ] Lens setup/save, per-eye replacements, stock retries, wear confirmed/assumed/unknown semantics.
- [ ] Calendar boundaries, leap days, timezones, large Dynamic Type, VoiceOver, keyboard/focus.
- [ ] Native tabs, back navigation, sheets, dismissal while busy, and interrupted requests.
- [ ] OCR camera/import/cancel/error, missing module/manual entry, and image cleanup.
- [ ] Notification permission grant/denial/revocation, scheduling/reconciliation, sign-out, and tap routing.
- [ ] PDF share/cancel/failure and temporary-file cleanup.
- [ ] Source-only learning/advice, consent withdrawal, unavailable-provider behavior.

Linux cannot perform this checklist. Source assertions, screenshots from another target, and mocked renderers are not substitutes. Live paid-provider acceptance is separately authorized and must not be triggered by ordinary tests.

## Failure reporting

Record command, interpreter, commit, actual failure, and whether it predates the change. Keep CI honest; do not use type suppressions, blanket skips, or removed security assertions to manufacture a green result. Detailed run-specific results belong in the PR/CI, not a growing folder of historical verification documents.
