# Release checklist

GitHub publication, an installable iOS build, and a production service are separate milestones. Oculog is early-development software; this list is not a completed sign-off.

## Current blockers

- TypeScript and the iOS JavaScript export have passed local checks. Neither proves native compilation or device behavior.
- The mobile test migration and lint baseline are not yet fully green. Some harnesses still need alignment with canonical iOS modules; do not advertise passing CI.
- Backend tests retain three existing education safety/abstention expectation failures. Optional evaluation also retains a policy-count failure. Resolve these through reviewed contract decisions, not weaker safety checks.
- Automation preferences need a usable retry path after save failure and native-compatible feedback inside the SwiftUI form. These were identified by source review, not device testing.
- Native signing, physical-device acceptance, a comprehensive secret/history scan, and GitHub protection settings remain owner actions.

These are disclosed development limitations, not completed release gates. A public early-development repository is distinct from a production-ready application.

## Repository publication

- [ ] Review the full staged diff, including existing untracked files. Do not blindly stage private data or unrelated ongoing work.
- [ ] Run a dedicated secret scanner over the working tree and all Git history. Rotate any previously exposed key; removing it from an example is not revocation.
- [ ] Verify license/attribution rights for code, assets, and externally sourced educational content.
- [ ] Confirm canonical GitHub links, owner contact, private vulnerability reporting, dependency alerts, and available secret scanning/push protection.
- [ ] Establish a reviewed green baseline for CI, then require successful checks and review on the default branch.
- [ ] Add owner-approved screenshots/demo with synthetic records. Do not fabricate device acceptance or advertise mock shopping data as live.

## API operations

- [ ] HTTPS, supervised unprivileged service, durable private SQLite disk, explicit environment settings, trusted proxies and ingress limits.
- [ ] Shared abuse quotas/concurrency controls appropriate for public auth and optional AI traffic. A process-local auth limiter is not sufficient provider-cost protection.
- [ ] Tested account recovery/deletion/session lifecycle and published support, privacy, retention, and deletion information.
- [ ] Versioned migration/upgrade plan, consistent encrypted backups, off-host retention, and a successful restoration drill.
- [ ] Database/corpus readiness checks, sanitized operational metrics, and actionable failure/capacity alerts. `/api/health` alone is not readiness.
- [ ] Optional paid provider left disabled, or separately reviewed for model/wire compatibility, terms, pricing, consent, quotas and abuse controls. No application monthly spending cap exists.

## iOS build and distribution

Expo configuration and EAS profiles live only in `mobile/`. Use a reviewed EAS CLI compatible with `mobile/eas.json`; owner-controlled Expo/Apple accounts and signing credentials are required.

From `mobile/`, after ownership, secrets, and public API origin are configured:

```sh
# Explicit remote Apple build; may incur cost. Run only when authorized.
eas build --platform ios --profile preview
# Release artifact, after preview acceptance:
eas build --platform ios --profile production
```

These are instructions, not builds already performed. `pnpm export:ios` does not create a signed IPA. Do not check generated projects, credentials, provisioning profiles, or build artifacts into source by accident.

- [ ] Confirm `app.oculog.mobile` is the intended owned bundle identifier, the EAS project ID belongs to the release owner, and app icon/splash/version metadata is final.
- [ ] Set `EXPO_PUBLIC_API_URL` to the production HTTPS origin **at build time**; no localhost, private key, or QA account in the artifact.
- [ ] Compile and verify the local Swift OCR module with the actual Apple toolchain. JS export does not establish native compilation.
- [ ] Complete [iOS device acceptance](testing.md#ios-acceptance-checklist), including real camera and notification behavior and accessibility.
- [ ] Verify current Apple SDK/App Store requirements, privacy declarations, permission descriptions, age/audience rules, and any applicable health-app declarations.
- [ ] Exercise an installed release build through the appropriate internal/TestFlight workflow before a public release.

There is no Android release or web hosting target. Keep the backend deployment separate from the iOS binary and verify client/server compatibility before upgrades.
