# QOR Harden: application lifecycle deletion safety

**Scope:** existing Applications and ApplicationLifecyclePanel delete controls.  
**Disposition:** repair confirmed implementation defects; no new product features.  
**Base:** main `f498fb16593659bab29ca20b81615b2a2215692d`.  
**Owner:** [#199](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/199), under [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194).

## Evidence before changes

The existing renderer invoked `void remove(application.id)`, `void lifecycle.deleteContact(contact.id)` and `void lifecycle.deleteEvent(event.id)` directly from single-click controls. A tracked application contains statuses, notes and linked career milestones. Event deletion can remove an interview/reminder. The asynchronous operations can fail, but the original buttons did not provide an approval and failure boundary. These are confirmed IQ-TRUST and IQ-OBSERVE contract problems, not style preferences.

## Bounded repairs

- Replace only the three single-click delete entry points with shared `ConfirmDialog` from #193.
- Derive current targets by ID from the active hook state; avoid long-lived duplicate records.
- Provide actionable, named consequences and explicit Cancel vs Delete.
- Await the existing canonical API through existing `useApplications` and `useApplicationLifecycle` hooks. Do not introduce new persistence or provider authority.
- The shared dialog owns single-flight pending, blocked Escape/overlay cancellation, visible failure and retry. No deletion on cancel.

## Verification

`tests/pwa/application-deletion-safety.spec.ts` runs production PWA against a fixture-backed Greenhouse job and local persistent SQLite: seed a tracked application, a contact, and a follow-up reminder; cancel then approve deletion at every level; verify actual canonical API state and no unrelated data loss; use a controlled failing delete promise to prove error visibility, blocked Escape and zero unintended writes. Run full Windows/Linux PWA, Electron E2E, repository-health and packaging/upgrade static checks on exact head.

## Residual scope

- Other destructive actions (career stories, offer details, cover letters, etc.) require separate review; G4 remains open.
- Not equivalent to hands-on screen-reader and exploratory usability acceptance.
- The QOR runtime governance health command is not run in the GitHub-only environment; published skill doctrine and quality sweep guide this component repair.
- Do not consider UI confirmation sufficient for data recovery/backup if deletion is irreversible.

**Ship verdict: INCONCLUSIVE until exact-head checks and independent review; whole-product ship verdict remains INCONCLUSIVE.**
