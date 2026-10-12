# QOR Harden: Career Story deletion safety

**Date:** 2026-10-09. **Mode:** focused component repair. **Parent:** #194. **Issue:** #210.

## Existing defect (source-confirmed)

`src/components/CareerStoriesPanel.tsx` used a single Trash click to call `void stories.remove(story.id)` with no user confirmation. `useCareerStories` routes the mutation to the existing local-first canonical `careerStories.delete` service. Its mutation handler rejects on backend failures, but a `void` click did not handle that rejection or give a dialog to retry. Each story holds a reusable narrative and evidence links, so mistaken removal is costly and irreversible.

## Bounded repair

- The exact story title is shown in a modal review before any delete.
- A clear consequence note explains that the narrative and story-to-evidence links disappear, while underlying canonical Career Evidence is **not** deleted.
- The shared `ConfirmDialog` blocks double submission and Escape while the backend operation is pending; failure leaves the exact selected story visible with error and retry. Cancel and Escape while idle never delete.
- Existing `useCareerStories.remove` and canonical SQLite remain the only write authority. Unlike the generic create/update mutation helper, a successful deletion now prunes only the acknowledged story ID from local UI state rather than performing a fallible post-delete list call. A list-refresh outage cannot misrepresent a successful irreversible delete. No inference source, Truth Gate, schema, or new store changes.
- No editor-save, half-finished-story form, or navigation change is included; that interruption issue remains tracked by #209.

## Behavioral proof

`tests/pwa/career-story-deletion-safety.spec.ts` uses production PWA persistent storage with two distinct user-authored Career Evidence items and two linked Career Stories. It checks Cancel; blocks a real renderer API boundary with a controlled rejection; proves pending lock, visible failed deletion and zero mutations; restores canonical API and retries while independently refusing the subsequent list API call; verifies that the confirmed irreversible delete still closes truthfully and only one story was removed, the second remains, both Career Evidence items are intact, and persistence survives reload.

Exact-head Linux/Windows PWA, repository health, Electron E2E, CodeQL and release-upgrade suites are required before merge. Passing CI is not a substitute for independent hands-on and assistive-technology usability validation.

**Overall product release verdict: INCONCLUSIVE**, as navigation-interruption safeguards, B1/B2/B3/B4 UX/a11y coverage and remaining G4 actions have not been comprehensively qualified.
