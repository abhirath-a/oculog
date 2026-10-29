# Architecture

## Boundaries

```text
iOS routes → feature screens → controllers / validated transports → FastAPI → SQLite
                    ↓
          device adapters → Keychain / notifications / OCR / temporary files
```

- `mobile/src/app/`: thin Expo Router entries, auth routing, root providers, native tabs.
- `mobile/src/components/<feature>/`: screens, interaction state, and feature-specific UI. Home and settings screens live with their feature rather than at the component root.
- `mobile/src/components/presentation/`: shared iOS fields, dates, typography, sheets, and layout. `ui.tsx` provides shared controls, feedback, and action coordination.
- `mobile/src/lib/`: session/API infrastructure, validated API clients, domain controllers, and device adapters.
- `mobile/shared/`: TypeScript domain contracts. These are separate from React views.
- `mobile/modules/prescription-ocr/`: local Expo module implemented in Swift, using Apple's on-device APIs.
- `backend/`: HTTP/auth/data operations, wear history, learning, education retrieval/provider logic, and SQLite persistence.
- `evaluation/`: separate optional evaluation tooling, not a client runtime dependency.

## One client implementation

Modules use canonical unsuffixed names. There are no maintained `.ios`, `.native`, `.android`, or `.web` variant trees. The canonical implementation is the former iOS implementation where one existed; shared modules retain their iOS behavior. Runtime iOS-version checks remain valid, for example when choosing supported SwiftUI modifiers.

Expo's `platforms: ["ios"]`, iOS-only export scripts, and structural regression tests enforce the target. React Native and Expo dependencies may contain their own platform code; that is not an application-level Android or browser implementation.

Keep native adapters separate from testable models/controllers. Do not replace missing optional-native-module handling with unconditional crashes: prescription manual entry must remain possible in builds without OCR.

## State and identity

`lib/api.ts` owns the bearer session and serialized Keychain persistence. Epoch checks and stale-write repair protect sign-in/sign-out races. `lib/store.tsx` coordinates account state and refreshes; feature controllers fence asynchronous results against the current owner/token and lifecycle.

Do not weaken these boundaries during refactoring:

- Recheck account/session identity after asynchronous work.
- Preserve idempotency keys for an uncertain-delivery retry of the same intent, not a contradictory intent.
- Keep confirmed, assumed, and unknown wear days semantically distinct.
- Treat calendar dates as literal dates; do not let UTC/local conversion silently shift a day.
- A failed action must not appear acknowledged or saved.

## API and local data

Account/lens/wear/learning records use the API. Prescription storage, OCR, and reminder scheduling have explicit device adapters. Wear-report generation fetches history and writes a temporary PDF for the iOS share sheet; private temporary artifacts need cleanup on completion and account changes.

Models and parsers validate untrusted responses before controllers use them. Swift-module results and imported file paths are also untrusted inputs; local processing does not remove the need for bounds and validation.

## Education versions

- V1: prepared advice catalogue.
- V2: source retrieval and optional whole-source excerpt selection for reviewed topics.
- V3: current-question-aware general education with a distinct consent revision and AI reply labeling.

Do not apply V2's no-question-forwarding guarantee to V3. See [privacy](privacy.md) and the implementation in `backend/education/chat.py` / `provider.py`.

## Change discipline

Keep routes thin, feature UI close to its feature, and infrastructure independent of view rendering. Avoid a wholesale backend rewrite during a client cleanup. Add a new abstraction only when it removes real duplication or makes a boundary testable. Tests and docs should refer to canonical modules, not deleted platform fallbacks.
