# Data, privacy, and safety boundaries

This is an engineering description, not a published privacy policy, legal determination, or clinical validation. A release owner must review the real deployment and intended audience.

## Where data goes

| Data | Current boundary |
| --- | --- |
| Accounts, lens settings, stock, wear history, learning progress | Authenticated API and server SQLite |
| Bearer session | App memory and iOS Keychain via SecureStore |
| Saved prescriptions | Account-scoped device repository via SecureStore |
| Prescription image/OCR | Local Swift module; on-device image processing, not provider upload |
| Local reminders | Device preferences/storage and iOS notification scheduler |
| Wear PDF | Temporary app cache file and user-selected iOS sharing destination |
| Optional V3 AI question | Server, then provider only under enabled configuration and current explicit consent |

Device-local does not mean account-independent: preserve ownership checks, session fencing, notification context checks, and cleanup. Sharing a PDF intentionally sends data outside the app according to the user's chosen destination. Use synthetic records for development and screenshots.

## Prescription OCR

The local module bounds inputs/results, restricts image URIs, sanitizes errors, and cleans app-owned temporary images. Manual entry remains available if the module or scanner is unavailable. OCR values are suggestions for review, not a prescription or an automatic clinical decision. Permissions and scanner behavior need real-device testing.

Do not add image upload, remote OCR, telemetry of recognized text, or broader file access without a separate privacy/security design and consent review.

## Local notifications

Reminder preferences and scheduling belong to the current device and account. iOS permission may be denied or changed outside the app. A saved time does not guarantee notification delivery: Focus settings, permission state, scheduling limits, and device conditions matter. Check grant/denial, reconciliation, account changes, sign-out, and notification routing on a real device.

## Optional AI

Source retrieval and hygiene practice work without a provider key. Paid generation is disabled by default. Enabling the server requires `OCULOG_GEMINI_API_KEY`, the explicit enabled/paid-project/adult-audience acknowledgments, and a reviewed pricing acknowledgment matching `backend/education/pricing.json`. Stale or unsupported pricing must not be bypassed by changing dates blindly.

V3 consent revision is defined by `CHAT_DISCLOSURE_VERSION` in `backend/education/chat.py`. Its payload can include the **current normalized question and bounded public passages**, not prior conversation, account/profile records, lens history, or photos. Questions themselves may contain sensitive information; identifier filters are imperfect. V2 uses a separate disclosure/selection contract. A grant for one revision does not silently authorize another.

Consent epochs and session/owner checks are revalidated around dispatch and completion. Withdrawal prevents future authorized processing and stale response release; it cannot recall a request already sent to the provider. Adult acknowledgment is not age verification. Review provider terms, paid-tier processing, and possible safety logging before enabling it.

**There is no application-side monthly spending cap.** Usage estimates are accounting, not a spending guarantee. Cloud budget alerts are notifications, not hard caps. Configure appropriate provider quotas, shared abuse controls, monitoring, and revocation procedures. Evaluation's per-run budget is a separate safeguard.

## Medical limitations

Fixed safety responses and guard patterns are conservative software rules, not clinical classification, perfect anonymization, or injection-proof defenses. AI replies can go beyond public passages and be wrong. Citation membership is not factual entailment, medical validation, or regulatory approval. Do not advertise diagnosis, personal prescribing, treatment, or product suitability.

## Publication and operation

Never commit private environment files, credentials, signing files, databases, photos, prescriptions, or real-user logs. `EXPO_PUBLIC_*` variables are public bundle contents. Keep provider keys on the server only.
