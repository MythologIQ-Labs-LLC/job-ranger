# QOR Harden: unsaved application navigation safeguard

**Date:** 2026-10-09. **Finding:** #209. **Parent:** #194. **Disposition:** repair only existing unsaved-edit behavior; do not add another storage authority.

## Risk and baseline test

The merged #202/#206 correctly preserve unacknowledged notes and status drafts in mounted React component state and never falsely report Saved. But navigating away from Applications unmounts these editors. When a canonical SQLite write is rejected or still pending, the unsaved local draft can disappear without informed consent. This is a loss-of-work risk independent of backend write atomicity. Test-only #212 captures this failing behavior while clean navigation remains unrestricted.

Current `HashRouter` is React Router 7.18.4's declarative router. The official first-class `useBlocker` hook blocks SPA navigation (including history back/forward), and `useBeforeUnload` provides a native hard-exit advisory. To make the blocker available with the required guarantees, switch to `createHashRouter` and `RouterProvider`, **preserving all existing route paths and URL fragments**. This is not intended as a navigation redesign.

## Repair

- Expose **dirty while any write is in flight OR last user intent differs from canonical acknowledged value** from the existing Notes and Status editors. This matters when the user edits a field and reverts it while the earlier write is still pending: that earlier write may still commit, requiring a compensating write. Dirty state must clear only after the complete write sequence settles, without persisting draft copies in localStorage or a parallel database.
- A single parent Applications coordinator tracks dirty status/notes for each application. Use one `useBlocker` for all in-app route navigation and browser back/forward. A warning dialog provides **Stay on this page** vs **Leave without saving**; clean navigation remains unrestricted.
- Register `useBeforeUnload` only to cancel browser reload/close when there are unacknowledged edits. It cannot prevent browser crashes, forced termination, or power loss and makes **no crash-safe data recovery claim**.
- Clear dirty state on canonical acknowledgment, explicit record deletion, or restoring the previously saved value. Do not mark a failed storage write as saved. `ConfirmDialog` now permits an explicit cancel-button label without changing default behavior elsewhere.

## Tests and mandatory qualification

`tests/pwa/unsaved-application-navigation.spec.ts`: fixture-backed saved job; rejected notes API; attempt sidebar navigation; confirm navigation blocked, Stay preserves draft, Leave permits explicit discard; clean navigation must still work; pending status save must block leaving until canceled or acknowledged, and normal navigation resumes after save; regression test also reverts notes and status to their original values during an earlier delayed write and proves navigation remains blocked until both writes settle. It also tests browser-history Back between genuine same-document hash-router entries (built using in-app links) and the registered unload handler via a synthetic cancelable event. A Back action from an in-app hash URL to an earlier non-hash page is a full-document navigation: this uses the browser-owned unload policy, not `useBlocker`; it cannot be reliably represented by the in-app dialog. The synthetic event does not claim to test the browser's native tab-close prompt policy.

Any router migration has an unusually wide regression surface. Require full exact-head Linux + Windows PWA browser, Electron E2E, repository-health/typecheck, CodeQL, release-upgrade, and packaged Store smoke where applicable. Existing route inventory including onboarding, evidence, stories, resume, companies, filters, settings, Insights and Personal Brand must remain reachable. Do not weaken unrelated tests to accommodate a navigation migration.

## Explicit limitations and follow-ups

- This is a **warning**, not a guarantee of persistence through abrupt termination. The UI must not claim drafts are already saved.
- Cross-session draft recovery and durable transaction journals require a separate privacy-reviewed canonical local-database architecture, including backup/restore and retention governance. Do not introduce ungoverned shadow copies of sensitive career data.
- Complete B1–B4 exploratory, keyboard, screen-reader, package QA and residual G4 deletion review are still required. Runtime QOR governance command not executed in this GitHub-only session.

**Whole-product ship verdict: INCONCLUSIVE.**
