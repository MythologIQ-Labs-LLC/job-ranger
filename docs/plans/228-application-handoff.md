# Plan: Application Handoff Readiness Delta (Issue #228)

**Status:** PLAN, revised 2026-11-02. No Qortara plan gate, audit PASS, intent lock or seal is recorded for this plan, and none may be claimed or fabricated.  
**Merge standard:** owner decision 2026-11-02: implementation proceeds under the [`GOVERNANCE.md`](../../GOVERNANCE.md) merge standard (scope match, recorded validation, true claims, current documentation, intact trust boundaries).  
**Change class:** material (application-materials workflow); no new external action authority.  
**Owner:** Sojourner maintainer; scoped by [#228](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/228).  
**Baseline:** `main` at `9dad91ab6a2f3a78433c274e4fa75390aff9ac08` (2026-11-02).  
**Architecture authority:** [`docs/ARCHITECTURE_INDEX.md`](../ARCHITECTURE_INDEX.md). User-facing copy says "Sojourner"; internal `sojourner` identifiers are unchanged.

## Delivered baseline (#270, already on main)

Most of #228 shipped to `main` through [#270](https://github.com/MythologIQ-Labs-LLC/sojourner/pull/270) (`cea39429483a2d60e5346771157e5f72bdf2b26b`). This plan does **not** re-implement it:

- `src/components/ApplicationMaterialsPanel.tsx`: an explicit per-version **Copy text** button. `copy()` re-reads `applicationMaterials.list(applicationId)` at click time, locates the same version by id, refuses stale or missing versions, writes only that text with `navigator.clipboard.writeText`, and reports success only after the promise resolves. Clipboard denial is reported truthfully in the `copyNotice` status region while the text stays selectable.
- `tests/pwa/cover-letter-copy.spec.ts`: real-Chromium exact copy, synthetic clipboard denial, stale-before-open (button disabled) and stale-while-open (copy refused, clipboard unchanged).
- `docs/FEATURE_INDEX.md` row **FX066** "Copy current cover-letter text (#270)" and the `HELP.md` *Application materials* section.

## Remaining delta (this plan's whole scope)

1. **Pure readiness function.** Add `src/shared/application-handoff.ts` exporting `evaluateApplicationHandoff(material | null)`. It returns `{ ready: true, text }` or `{ ready: false, reason }` with `reason` one of `missing-material`, `unsupported-kind`, `stale-evidence`, `empty-material`, `missing-evidence-links`. No IO, storage, clock or network. Text is the same `"\n\n"` join the panel already renders. It additionally fails closed on drafts #270 does not check: blank text, missing or duplicate selected evidence ids, cited ids not in the selection, selected ids never cited, an evidence section with no citation, and missing evidence timestamps. Staleness remains decided by the canonical backend (`staleEvidenceIds`), never inferred from wall-clock time.
2. **Route the existing copy through it.** Main's `copy()` keeps its re-read and its single **Copy text** button and `copyNotice`. It passes the freshly listed projection to `evaluateApplicationHandoff` and copies only `readiness.text`. Each blocked reason gets its own truthful notice. There is no second copy button, no second status region and no stored-format or `ApplicationMaterialsDesktopApi` change.
3. **Unit tests.** `tests/application-handoff.test.mjs` asserts exact results for every reason above plus the ready case. Register it in `package.json` `test` and `test:unit`, using main's current lists.
4. **Electron no-status-change assertion.** Extend `tests/e2e/application-materials.spec.ts`. Copying a current version through **Copy text** writes the exact text, does not mark the application applied, and leaves the application status unchanged (`interested`). Denied copy is reported as a failure. A stale version cannot be copied.
5. **PWA cases.** Fold any new browser cases into `tests/pwa/cover-letter-copy.spec.ts`, for example no application-status change and no external request during copy. Do not add a parallel PWA spec.
6. **Design note.** Add a short section to `docs/design/APPLICATION_MATERIALS.md` describing the readiness contract and its limits. Update FX066 in `docs/FEATURE_INDEX.md`, citing the new tests, and keep it `unverified` until a recorded run against an inventory checkpoint. Do not add a new FX id.

## Authority and trust boundaries

Career Evidence remains factual truth. The Application owns lifecycle state, and saved Application Materials remain derived, versioned projections. Copying is an explicit, user-initiated export to the operating-system clipboard. It never submits an application, marks it applied, changes its status, fills an employer form or sends data anywhere. Opening a saved employer URL stays a separate user click.

## Validation (record actual output; never imply hosted CI ran)

```bash
npm run typecheck
node --experimental-strip-types tests/application-handoff.test.mjs
npm test
npm run build:pwa
npx playwright test --config playwright.pwa.config.ts tests/pwa/cover-letter-copy.spec.ts
npm run build && npm run desktop:compile
npx playwright test tests/e2e/application-materials.spec.ts
```

Run only the targeted Playwright specs. Record environment, commands, pass/fail counts and any skipped checks in the implementation PR.

## Risks and limits

- **Transient user activation:** the awaited re-read precedes `writeText`. Chromium accepts this (the #270 PWA spec copies through the real clipboard). The Electron spec substitutes `navigator.clipboard`, so it proves status and refusal behavior, not Electron's native clipboard. If a runtime rejects it, the failure is shown and the text stays selectable; do not weaken the fresh check.
- **Time-of-check vs. time-of-use:** a re-read proves the version was current when it resolved, not afterward.
- **Privacy:** clipboard contents become visible to other clipboard consumers only after an explicit click. Nothing is uploaded or logged.
- **Claims:** passing tests do not prove an applicant finished an employer application. Implemented on main is not the same as shipped in a release.

## Out of scope

Provider expansion (#136), ATS integrations, automated form fill or submission, accounts and credentials, CAPTCHA handling, background browser operations, outreach, automatic application status updates, bulk profile export, publishing and release.
