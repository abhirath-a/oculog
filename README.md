<p align="center"><img src="assets/logo.svg" width="240" alt="Oculog" /></p>
<h1 align="center">Oculog</h1>
<p align="center"><strong>Less guesswork in your contact lens routine.</strong></p>
<p align="center">An iOS app for lens schedules, wear history, spare stock, and eye-care education.</p>
<p align="center"><a href="docs/development.md">Get started</a> · <a href="docs/architecture.md">Architecture</a> · <a href="CONTRIBUTING.md">Contribute</a> · <a href="LICENSE">MIT</a></p>

> **Early development; CI is not yet fully green.** See [known blockers](docs/release.md#current-blockers). iOS is the only supported client. The Python API is retained. No Android app or browser app is maintained. Oculog is not a medical device and does not diagnose, prescribe, or replace an eye-care professional.

<video src="https://github.com/abhirath-a/oculog/raw/refs/heads/main/.github/assets/oculog-demo.mp4" width="100%" controls></video>

## Features

- Per-eye lens replacement schedules and spare inventory.
- Wear history with confirmed, assumed, and unknown days kept distinct, plus PDF export.
- English/Spanish public-source education and hygiene practice without an AI key.
- Device-local prescriptions, optional on-device OCR, and local reminders.
- Optional consent-based AI education. AI replies are not clinically verified advice.

Products currently uses **mock data**, not verified offers. Native functionality requires an appropriate iOS build and device permissions; source code and unit tests are not evidence of release-device acceptance.

## Start developing

Use Node **24**, pnpm **12.3.4**, and Python **3.14** with SQLite FTS5. Native builds require **macOS with Xcode** and the SDK required by Expo 58; a real iPhone is needed for camera and notification acceptance.

```sh
git clone https://github.com/abhirath-a/oculog.git
cd oculog
pnpm install --frozen-lockfile
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

On a fresh checkout, copy `.env.example` to `.env` and `mobile/.env.example` to `mobile/.env`. Do not overwrite existing private configuration. Set the client API URL to an origin reachable from your iPhone.

```sh
pnpm api                 # API, first terminal
pnpm start               # Metro, second terminal
pnpm ios                 # build/run iOS locally; macOS + Xcode only
```

See [development](docs/development.md) for simulator/device networking, Nix/Linux workflows, and build requirements. No paid provider is needed for source-only development.

## Repository

```text
mobile/
  src/app/               Expo Router routes and navigation
  src/components/        Feature screens and shared iOS presentation
  src/lib/               API, controllers, local persistence, native adapters
  shared/                TypeScript domain contracts
  modules/prescription-ocr/  Local Swift OCR module
  tests/mobile/          Node-based domain and iOS component tests
backend/                 FastAPI, SQLite, education and backend tests
evaluation/              Optional education evaluation tooling
scripts/                 Development and corpus utilities
docs/                    Current developer and operator guides
```

Source modules have one canonical implementation: no platform-suffixed fallback trees. App dependencies and Expo/EAS configuration live in `mobile/`; the root is workspace tooling only.

## Checks

```sh
. .venv/bin/activate
pnpm typecheck
pnpm test
pnpm export:ios          # JS/assets only, not a signed app
python -m unittest discover -s scripts/tests -v
```

`pnpm check` runs Biome; `pnpm format` rewrites files. See [testing](docs/testing.md) for coverage boundaries and [release](docs/release.md) for outstanding acceptance requirements. Linux can run static checks, backend tests, and iOS JS export, but cannot build or visually test an iOS app.

## Privacy and contributions

The backend stores account and lens data in SQLite. Sessions and device-local records use iOS storage adapters. Optional V3 AI can send the current question and public passages to a provider under explicit consent; identifier filters are imperfect and there is **no application-side monthly spending cap**. Read [data and privacy](docs/privacy.md) before enabling it.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

Code is [MIT licensed](LICENSE). Third-party educational content retains its own attribution and terms; the code license does not relicense it. Citations are not clinical validation or regulatory approval.
