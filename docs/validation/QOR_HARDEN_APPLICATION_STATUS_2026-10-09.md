# QOR Harden: application status and notes write integrity

**Date:** 2026-10-09  
**Finding:** [#204](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/204); **parent:** [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194)  
**Mode:** QOR Harden component-level repair; deterministic local-first persistence retained.

## Verified before the repair

Existing `CareerRepository.updateApplication(id, patch)` made a separate `SELECT`, then wrote **both** `status` and `notes` using the selected snapshot as the fallback for fields not present in `patch`. This is a lost-update defect: an independent write between the SELECT and UPDATE could be overwritten even if the editor changed a different field.

In the deliberately red baseline-only [PR #205](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/205) (main `04c932f5579481cdc880882e8414a03928f7fbc0`, baseline head `0f6bebad44fbb6da9d55f10095d2996edf69e319`), the deterministic **real SQLite** test staged a notes write after a status update had read the previous notes, before its UPDATE. CI repository-health [job 113983881365](https://github.com/MythologIQ-Labs-LLC/job-ranger/actions/runs/37978837456/job/113983881365) failed: expected `Latest interview notes`, actual empty string. No production source was changed on the baseline branch.

The status selector also used `void update(id, { status })` directly. A rejected update had no handled failure or user-visible retry, and whole-record responses could cause reactive view inconsistencies. These are IQ-CORRECT, IQ-TRUST, and IQ-OBSERVE defects with direct data integrity implications.

## Bounded repairs

- Change the canonical repository's `UPDATE applications` to use `COALESCE` with the **current database column value** for an omitted field, not a stale application snapshot. `RETURNING *` remains the success authority. Missing IDs still throw.
- Isolate the status selector in an `ApplicationStatusEditor`: show current user intent immediately; serialize status writes for the particular application; show Saving/Saved only when acknowledged; preserve unsaved selection and display an actionable retry when a write fails.
- Keep existing `ApplicationNotesEditor` from #202 untouched, and continue using the existing `applications.update` API and SQLite local database. No new store, inferred application decisions, provider, schema migration or permissions.
- Include both `tests/application-status-interleaving-smoke-test.cjs` in `npm test` (real SQLite forced interleavings in both directions), and `tests/pwa/application-status-persistence.spec.ts` for two distinct applications, rejected status update, retry, keyboard focus, notes/status overlap, and persistence after reload.

## Acceptance and residual limits

Qualify the exact PR head using Linux/Windows PWA, repository health, Electron E2E, CodeQL and Linux/Windows release upgrade. The baseline reproduction branch must remain **unmerged** and be closed after documenting failures.

This is scoped to the existing application edit controls; it does not resolve every G4 destructive action or full cross-session concurrent editing. Sudden process termination can still lose edits without acknowledged writes. A whole-product readiness verdict remains **INCONCLUSIVE** pending complete QOR Harden qualification.
