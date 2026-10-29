# Contributing to Oculog

Small, focused changes that improve the iOS app and Python API are welcome.

## Start

1. Follow [development setup](docs/development.md).
2. Read [architecture](docs/architecture.md) and the relevant [docs](docs/README.md).
3. Open an issue before major architecture, dependencies, data migrations, or medical/privacy-scope changes.
4. Work on a branch using synthetic accounts and records.

## Conventions

- iOS is the only supported client. Use canonical unsuffixed TypeScript modules, not platform fallback trees.
- Keep routes thin; put screens in feature directories, reusable iOS primitives in `components/presentation`, and device adapters/controllers in `lib`.
- Preserve account/session fences, serialized Keychain writes, idempotent stock operations, independent safety handling, and literal calendar dates.
- Keep Swift OCR local and optional-module failure recoverable. Do not add remote image or private-record processing without separate review.
- Follow Biome and existing code style. Avoid unrelated refactoring and repository-wide formatting churn.
- Add regression tests for changed behavior. Do not drop functional/security assertions to hide a failure.

## Verify

```sh
. .venv/bin/activate
pnpm typecheck
pnpm test
python -m unittest discover -s scripts/tests -v
pnpm export:ios
```

Run `pnpm check` or target changed files with `bash scripts/biome.sh check path/to/file`. On NixOS, use `nix develop` for the native binary loader. See [testing](docs/testing.md) for optional evaluation tests and native acceptance.

For UI changes, include screenshots and exact iOS device/build details. Review VoiceOver, Dynamic Type, keyboard behavior, and reduced-motion behavior where relevant. Linux checks and mocked component tests do not establish iOS visual correctness.

## Pull requests and conduct

Describe what changed, why, verification results, and remaining risks. Separate pre-existing failures from regressions and update the relevant current guide, not a new historical status file. No paid provider calls, signing operations, or cloud builds without authorization.

Never upload credentials, prescriptions, personal health information, databases, or private logs. 

Be kind, specific, and constructive. Harassment and disclosure of private information are not welcome; maintainers may remove harmful content or restrict participation.

Contributions use the [MIT code license](LICENSE). Ensure you have permission to contribute code/assets; externally sourced educational content retains its own terms.
