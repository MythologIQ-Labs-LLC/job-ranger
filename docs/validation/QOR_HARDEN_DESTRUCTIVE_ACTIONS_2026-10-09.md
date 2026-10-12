# QOR Harden: destructive-action reliability, first bounded repair

**Status:** implementation proposed in PR (not merged, not shipped)  
**Date:** 2026-10-09  
**Owner:** [#192](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/192)  
**Method:** [Qor-logic /qor-harden](https://github.com/MythologIQ-Labs-LLC/Qor-logic/blob/main/qor/skills/sdlc/qor-harden/SKILL.md), its `doctrine-code-quality.md` and `implementation-quality-sweep.md`.

## Scope and authority

- **Scope:** component; shared destructive confirmation dialog and existing Target Tracks, filters, and job-source removal surfaces.
- **Disposition:** repair of confirmed failures, not a feature expansion.
- **Comparison base:** `main` at `b80c7a1faa08099d7a1518c166cc450b1cdf05fa`.
- **Existing governing contract:** `GOVERNANCE.md` prioritizes factual integrity, privacy, usability and tests. `docs/BACKLOG.md` G4 explicitly records unconfirmed destructive actions; B1 includes missing UI delete-lifecycle tests. `ConfirmDialog` and `Modal` were already present, but the dialog was not used.
- **Unavailable verification:** no Qor runtime/CLI governance-health check was executed through the GitHub-only remote interface. The published methodological source was reviewed. This is not a claim of a sealed Qor governance runtime session or a comprehensive whole-repository hardening verdict.

## Confirmed findings and minimal repairs

| ID | Severity | Evidence and consequence | Repair |
| --- | --- | --- | --- |
| IQ-CORRECT-001 | MAJOR | `ConfirmDialog` called `onConfirm()` and immediately called `onClose()`. If a canonical API failed asynchronously, UI would still dismiss; rapid repeat confirmation had no pending lock. | Await the action, show pending state, serialize confirmations with a synchronous lock, remain open with a visible error on rejection, and close only after successful completion. |
| IQ-TRUST-001 | MAJOR | `TargetTracks.tsx`, `Filters.tsx`, `Companies.tsx` wired single-click Delete/Remove directly to canonical destructive services. Source removal also cascades jobs and scrape history. | Require an explicit descriptive confirmation with Cancel/Confirm before calling unchanged canonical services. |
| IQ-OBSERVE-001 | MINOR | Target Track Save was invoked through `void handleSave()`; the save rejected without a local catch. Although the hook displayed an error, the promise remained unhandled. | Catch the rejection at the UI boundary and rely on the existing displayed hook error instead of claiming success. |
| IQ-CONTRACT-001 | MINOR | Repeated filter and source deletion buttons had ambiguous accessible names (generic Delete/Remove). | Include the record name in each delete button's accessible label. |

## Verification contract

`tests/pwa/destructive-actions.spec.ts` exercises real PWA/SQLite workflows:

- Target Track creation, Cancel preserving the saved record, explicit confirmed deletion removing it.
- Filter Cancel preserving state; a deliberately failing API mutation keeping the dialog open and error visible.
- Job-source removal warning, Cancel, confirmed removal and canonical state.
- Targeted accessible controls; no unsupported inference or network permissions introduced.

Run existing CI and static analysis on the **exact PR head**, including Linux/Windows PWA, Electron E2E, repository-health/typecheck/unit, Store packaging and release-upgrade. A passing test proves only its assertions. Do not close the issue before verifying the results and reviewing the diff.

## Residual taxonomy sweep

- **IQ-COMPLETE:** G4 remains open. Applications, stories, contacts, events, letters, offer details and other destructive actions were **not** fixed here. This bounded repair must not masquerade as full-app completion.
- **IQ-CORRECT:** potential domain deletion/refresh partial-success behavior requires a separate atomicity and idempotence audit; no database mechanism was altered.
- **IQ-TRUST:** retained existing domain permissions, schema validators and authority pathways.
- **IQ-CONTEXT:** reused existing `ConfirmDialog` and canonical app APIs; did not introduce a second delete service.
- **IQ-COMPLEX:** local lock and pending state serve a demonstrated concurrency/error requirement, not a generic abstraction layer.
- **IQ-RESOURCE:** no new polling, backend requests or persistent copies; only user-triggered confirmation.
- **IQ-CONTRACT:** component accepts synchronous or asynchronous mutations; success/failure is observable.
- **IQ-MAINTAIN:** existing shared component and route conventions preserved.
- **IQ-OBSERVE:** rejected deletes surface inside the open dialog; unchanged AppContext toast remains supplemental.

**Out-of-scope follow-up:** `Modal` has no proven focus trap, focus restoration or keyboard isolation; investigate with accessibility and screen-reader checks, not speculative broad refactoring. Other priorities are B1/B2/B3 and G1/G2/G3/G4/G5/G7, plus the open, qualified PR stack (#182, #184, #186, #188, #191). Each must be reviewed against its actual head and user-facing journey.

## Ship assessment

**INCONCLUSIVE until exact-head CI and independent behavioral review finish.** Never confuse green CI with a claim that the complete application is easy to use or production-hardened.
