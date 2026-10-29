# Development

## Supported environment

- Client: iOS only, using Expo SDK 58, React Native, and SwiftUI-backed Expo UI components.
- Tooling: Node 24 and pnpm 12.3.4, pinned in the workspace manifest.
- API: Python 3.14, FastAPI/Uvicorn, SQLite with FTS5 and timezone data.
- Native builds: macOS, Xcode, and the Apple toolchain supported by Expo SDK 58. Match Expo's current Xcode requirements rather than inferring them from the OCR module's minimum deployment target.

Linux/NixOS supports API development, Node tests, typechecking, and iOS JavaScript export. It cannot run an iOS simulator, compile/sign the Swift module, or establish device visual acceptance. `nix develop` supplies Node, pnpm, Python with API dependencies, and the Biome loader; no Android SDK is provisioned.

## Install

From the repository root:

```sh
pnpm install --frozen-lockfile
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

The Nix shell's Python already supplies the API dependencies; using its interpreter instead of a separate pip environment is also supported. Run Python tests with the same interpreter that has FastAPI and Uvicorn installed.

On a new checkout only:

```sh
cp .env.example .env
cp mobile/.env.example mobile/.env
```

Existing private environment files must not be overwritten. Never commit their contents.

## Configure the API connection

| Setting | Location | Meaning |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `mobile/.env` | Reachable API origin including port, without `/api`; public client data |
| `OCULOG_HOST`, `OCULOG_PORT` | Root `.env` | Development listener; defaults to `127.0.0.1:8000` |
| `OCULOG_DB_PATH` | Root `.env` | Optional SQLite path override |
| `OCULOG_GEMINI_*` | Server environment only | Optional paid processing; keep disabled for ordinary development |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Client build environment | Optional override for owner-controlled EAS project ID |

`pnpm api` prefers `.venv/bin/python` and invokes `python -m backend`. That launcher loads root `.env` literally, without shell execution/interpolation; exported variables take precedence. Direct Uvicorn startup does not automatically load the file.

- **iOS simulator:** `http://127.0.0.1:8000` reaches an API on the same Mac.
- **Real iPhone:** use your development computer's trusted LAN address, for example `http://192.168.1.20:8000`, and run `pnpm api --host 0.0.0.0`. Keep both devices on a trusted network and allow the development port through the local firewall. Approve local-network access if prompted.
- **Remote API:** use an HTTPS origin reachable by the device.

Restart Metro after changing public environment settings. iOS network/ATS behavior depends on the build; if plain HTTP is blocked, use trusted HTTPS rather than adding broad production transport-security exceptions. Never expose the development API or Metro publicly.

## Run

First terminal:

```sh
pnpm api
curl http://127.0.0.1:8000/api/health
```

Second terminal:

```sh
pnpm start
```

On macOS, compile/install the local iOS app:

```sh
pnpm ios
# Optional explicit physical-device selection:
pnpm --dir mobile exec expo run:ios --device
```

The local OCR module is under `mobile/modules/prescription-ocr/ios`. Expo Go does not contain that module; its absence must preserve manual prescription entry, not crash startup. Native permissions, local notifications, and sharing require an appropriate installed build and device testing. Metro alone is not a native build.

Expo config and EAS profiles have a single home: `mobile/app.json`, `mobile/app.config.ts`, and `mobile/eas.json`. Run EAS commands from `mobile/`, using a reviewed compatible EAS CLI and your own Apple/Expo credentials. The checked-in project ID is metadata, not permission to use someone else's project. No signing, paid build, or submission is part of setup.

## Export without compiling iOS

```sh
EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=https://api.example.invalid pnpm export:ios
```

This checks Metro's iOS JS/assets graph and writes `mobile/dist`. It does not compile Swift, produce an IPA, verify signing, install an app, or test UI behavior. Generated output is not source.
