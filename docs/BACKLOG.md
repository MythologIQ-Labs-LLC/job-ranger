# Project Backlog

Governed engineering work for Job Ranger. Product capability candidates, deferrals, and non-goals
live in [`PRODUCT_GAP_REVIEW.md`](./PRODUCT_GAP_REVIEW.md); this file tracks work that has been
identified concretely enough to plan. Items close only through a sealed governance cycle.

## Blockers (Must Fix Before Progress)

### Development Blockers

- [x] [D1] (Phase 6 - Complete) PWA build on Windows registers IPC handlers into a duplicate adapter module. `vite.pwa.config.ts` `runtimeAdapterPlugin.resolveId` returns backslash paths, so the worker bundle contains two copies of `src/pwa/adapters/electron-worker.ts`; every web-runtime call fails with `No handler registered for '<channel>'` and all `tests/pwa` specs fail on Windows hosts (CI runs Ubuntu and does not see it).
- [x] [D2] (Phase 6 - Complete) `npm run test:release-upgrade` fails on Windows. `scripts/upgrade-check/check-current-release.cjs` splits `sqlite3` output on `\n`; Windows `sqlite3.exe` emits `\r\n`, leaving `\r` on every table name.
- [x] [D3] (Phase 7 - Complete) Every web build shipped without Tailwind layout utilities: the web build's Vite root is `web/` while components live in `src/`, and Tailwind scanned from the Vite root. The built app showed colors and fonts but no layout; no web test asserted layout.
- [x] [D4] (Phase 8 - Complete) `tests/pwa/update-and-storage.spec.ts` reloaded after step 1 while the test server still served the broken deployment; the browser's navigation-triggered service-worker update check could then install the broken build from a mix of its shell and the next root's original manifest, and "Reload to update" activated it (local failure 1 in 15; trace-confirmed). The test now withdraws the broken root before reloading and waits for a settled registration before step 2.

## Backlog (Planned Work)

- [ ] [B1] User-story-driven end-to-end coverage. Extend `docs/design/UNIVERSAL_USER_STORIES.md` and `docs/validation/UNIVERSAL_USER_STORY_MATRIX.md` with per-story steps and expected end state, then add UI-driven specs for journeys with no UI test today: track a job, change application status and notes, save the Career Profile, save a filter, run a source, save settings, Electron backup/restore, resume statement edit under the Truth Gate, imported-evidence edit/reject/merge, skip onboarding, destructive deletes other than removing a source (filter, application, story, contact, event, cover letter, target track), Jobs search, JSON Resume import, and the Career Profile resume import in the desktop runtime (only `tests/pwa/career-ops.spec.ts` drives it today).
- [ ] [B2] Control-behavior sweep: a spec that visits every route and asserts each button/link navigates or acts as specified.
- [ ] [B3] Accessible names: add names to controls that have none (resume statement textareas, Settings runtime inputs whose labels are not associated, toast dismiss button) and to the Jobs search inputs and company select, whose wrapping labels contain only an icon so their names fall back to placeholder or option text; make repeated per-row names unique (Career Profile Confirm/Edit/Reject, Companies Run/Remove, Filters Delete).
- [ ] [B4] PWA career-ops spec drives the UI instead of `window.electronAPI` for its workflow steps.

## Product Gaps Found (Not Yet Planned)

- [x] [G1] (Verified on `main` 2026-10-30) Sources cannot be edited, paused, or rescheduled after creation (`updateCompany` is not wired to any UI). Companies now pauses, resumes and reschedules sources; covered by `tests/pwa/source-schedule.spec.ts`.
- [x] [G2] (Verified on `main` 2026-10-30) Filters cannot be edited or toggled (`updateFilter` is not wired); "Title excludes" is not shown on the filter card. Filters are editable and can be disabled/re-enabled, and the card shows exclusion rules; covered by `tests/pwa/filter-editing.spec.ts`.
- [ ] [G3] Cover letters cannot be exported, copied, or downloaded. **Partly done (2026-10-30):** a current version can be copied exactly, with stale-evidence blocking (`tests/pwa/cover-letter-copy.spec.ts`); file export/download is still missing.
- [x] [G4] (Verified on `main` 2026-10-30) Destructive actions run without confirmation (company, filter, application, story, contact, event, cover letter, target track, offer details); `ConfirmDialog` is unused. `ConfirmDialog` now guards these deletes; covered by `tests/pwa/destructive-actions.spec.ts`, `application-deletion-safety`, `career-story-deletion-safety` and `materials-offer-deletion-safety`.
- [x] [G5] (Verified on `main` 2026-10-30) Notification checkboxes save only through "Save runtime settings" in a different section, with no on-screen cue. Each Settings section saves on its own and shows unsaved state; covered by `tests/pwa/settings-save-feedback.spec.ts`.
- [x] [G6] (Verified on `main` 2026-10-30) No in-app Help entry point in the renderer; the web runtime has no help link. Help is in the sidebar and works offline; covered by `tests/pwa/help.spec.ts`.
- [ ] [G7] Flaky Electron specs on Windows: `tests/e2e/resume-tailoring.spec.ts` "user previews, discards, and accepts a deterministic tailoring plan" fails intermittently ("Requirements Job Ranger will not claim" not visible; 1 of 2 runs on 2026-10-06, 3 of 4 on 2026-10-07); `tests/e2e/app.spec.ts:68` "career profile is occupation agnostic and supports annual pay" failed once on 2026-10-07 and passed 3 reruns. `tests/e2e/onboarding.spec.ts:219` \"resume-first uses the native file dialog and persists imported evidence after restart\" failed once in a full run on 2026-10-07 and passed 3/3 on rerun. **2026-10-15 progress (#316, #318):** the `resume-tailoring.spec.ts` failure was concurrent coverage rewrites plus slow sqlite3 launches (fixed; 20/20 repeated runs) and `app.spec.ts` annual pay was the Career Profile first-seed race (fixed; 15/15 repeated runs). The `onboarding.spec.ts:219` single failure is not yet diagnosed, so G7 stays open.
- [x] [G8] (Phase 9 - Complete) Icons overlap placeholder text in the Find Jobs filter bar (desktop and web): unlayered `.input-shell`/`.select-shell` padding in `src/index.css` overrides Tailwind's layered `pl-11` utility on those inputs.
- [ ] [G9] `pwa-windows` on PR #158 (run 37572804981) timed out after 120 s waiting for `load` after "Repair app shell" (`tests/pwa/update-and-storage.spec.ts`). Not reproduced locally; the local reproduction of this spec was a different race (D4). Both PWA CI jobs now upload `test-results/` on failure so a recurrence carries a trace.
- [ ] [G10] `tests/pwa/runtime.spec.ts` "only one tab can write the local workspace at a time" failed once in a full `test:pwa:e2e` run on the Windows dev host (2026-10-07; second tab's lock message not visible) and then passed 12/12 on repeat.
- [x] [G12] (Phase 15 - Complete, #167) The deterministic requirement mapper ignores negation. In the Phase 14 adversarial fixtures, evidence "Never approved the vendor budget; reviewed vendor budget drafts." maps as `direct` to the requirement "Approved vendor budgets." (`tests/inference-adversarial.test.cjs`, category `negation-and-exclusion`). Any fix is a deterministic product improvement, justified on its own and regression-tested without inference.
- [x] [G13] (Phase 16 - Complete, #168) The deterministic requirement mapper is fooled by high lexical overlap with a different meaning. Evidence "Was paid through payroll as part of a large workforce." maps as `direct` to "Managed payroll for a large workforce." (`tests/inference-adversarial.test.cjs`, category `high-lexical-overlap-different-meaning`). This is the same class of independent deterministic improvement as G12.
- [ ] [G11] Requirement matching keeps trailing sentence punctuation on the last token (`electron/src/requirement-mapper.cts:22` keeps `.`), so a requirement written "... is required." carries an unmatched `required.` token and scores lower (for example "Experience with insurance verification is required." maps as transferable against identical evidence).

## Housekeeping

- [ ] [H1] Archive historical plan files from `docs/` and `docs/planning/` into the Tier 6 archive (see `GOVERNANCE_INDEX.md` Tier 4).
