# QOR Harden: application notes autosave ordering and failure visibility

**Date:** 2026-10-09  
**Scope:** existing tracked-application Notes field in `Applications.tsx`; focused-component repair.  
**Parent:** [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194); **finding:** [#201](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/201).  
**Proposed repair:** [#202](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/202).  
**Independent baseline reproduction:** [#203](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/203) (deliberately red test-only branch).

## Evidence and impact

Previously `Applications.tsx` directly used an application's *last persisted* `notes` as its controlled textarea `value`. Every keystroke immediately called `void update(id, { notes: text })`. In `src/career/storage.ts`, each call independently awaited the canonical API, then replaced the entire application in React state with whatever response arrived. Neither input responsiveness nor write ordering was protected against delayed/failed API responses; errors propagated through unhandled `void` calls.

This is a confirmed source-level and **runtime-reproduced** concurrency/failure-boundary defect (IQ-CORRECT / IQ-OBSERVE). The independent test-only baseline at `16177c3ed185ca12743c3031ae2a395f24ce1728` ran on Linux PWA in [CI job 113975855320](https://github.com/MythologIQ-Labs-LLC/job-ranger/actions/runs/37976448601/job/113975855320): **24 of 26 tests passed, and both new regression tests failed as expected.** Under controlled out-of-order writes the final note was `First draft`, not `Final draft that must survive`; on simulated storage rejection the original input reset to the empty string instead of retaining `My unsaved interview notes`. This is explicit evidence of data loss and concealed failure in the original application; it does not establish a production incidence rate.

## Smallest sufficient repair

The new `ApplicationNotesEditor` keeps the user's current draft in component state, distinct from the last acknowledged persistent value, without introducing any new durable store or network flow. For **this application's notes**, it serializes save operations: wait for the previous canonical write to complete, then submit the latest user intent only if changed. After a failed write, preserve the entered text, display a concrete error, and provide a real retry button. A success status requires the canonical response to confirm exactly the submitted text.

The parent Applications page retains the existing canonical `update` service for status and notes. No schema, inference provider, Truth Gate, permission, or new data authority changed.

## Behavioral qualification

`tests/pwa/application-notes-autosave.spec.ts` covers:

- Normal tracked application obtained via fixture-backed Greenhouse job.
- A controlled first-note write held behind a promise and a newer user edit typed before it completes.
- Final textarea text equals the last user intent; canonical persistent notes also equal it; reload preserves it.
- An API rejection displays a user-visible error, keeps the draft editable, and allows retry to persist the exact text.

Run complete Linux + Windows PWA tests, Electron E2E, repository health, security analysis, and Linux/Windows release-upgrade against exact PR head. The test-only baseline reproduction is deliberately unmergeable as product work and must be closed after recording evidence.

## Explicit residual limits

- This repair does **not** guarantee that text typed just before abrupt browser/process termination is durable. The UI must never claim Saved until acknowledged. Reliable recovery from hard shutdown merits a separate drill.
- Cross-control status/notes overlap, simultaneous distinct app sessions, and newer external edits require separate targeted verification if applicable. Do not invent a shared synchronization layer.
- No screen-reader or cross-platform manual user study performed by this PR.
- Published QOR Harden doctrine guided the component audit; the standalone QOR runtime governance-health command was not executed from this GitHub-only context.

**Ship verdict: INCONCLUSIVE until exact-head CI and independent review.** Whole-application ship verdict remains INCONCLUSIVE.
