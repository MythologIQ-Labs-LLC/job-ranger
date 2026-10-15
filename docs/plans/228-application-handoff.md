# Governed Plan: Candidate-Controlled Application Handoff (Issue #228)

**Status:** PLAN PREPARED / NOT RECORDED / INDEPENDENT AUDIT PENDING  
**Change class:** material feature (no new external action authority)  
**Owner:** Job Ranger; scoped by [#228](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/228)  
**Baseline:** `main` at `ebfd7c9abb0468bf8aef01442781ecfd60f5477a` (2026-10-09)  
**Qortara lifecycle:** PLAN → AUDIT PASS → IMPLEMENT (test-first) → VERIFY → SUBSTANTIATE / SEAL. No implementation until the prior gates are *actually recorded*.

## Open questions / required preflight

1. **Qortara status and recorded plan:** not established. A writable checkout with the installed Qortara runtime must run `qortara status`, resolve any active conflicting session, validate this plan and record the plan gate. Do not hand-edit `.qortara/`.
2. **Independent audit identity and PASS:** not established. Another reviewer must audit the exact recorded plan version before any feature code changes. An author cannot provide their own independent PASS.
3. **Clipboard behavior across Electron and the PWA:** not established. Browser permission or transient user activation may prevent copying after an asynchronous re-read. A real-browser test must establish behavior; failure must remain visible, and a re-audit is required for any design change.
4. **Application submit confirmation:** deliberately outside this slice. Opening a page or copying a draft never proves submission.

## Goal

Reduce repetitive application work **for one deliberately selected opportunity** by allowing the candidate to copy an existing factual cover-letter draft after a fresh, authoritative staleness check. Keep the action local, explicit, truthful and recoverable. This is an incremental handoff from Job Ranger into the employer's normal application form, not an ATS submission agent.

## Grounded baseline / evidence

- `src/pages/Applications.tsx:92` already opens the saved employer URL only on an explicit click; `src/pages/Applications.tsx:130` renders the existing Application Materials panel.
- `src/components/ApplicationMaterialsPanel.tsx:11` renders text by joining stored sections; `:24-33` loads projections through the existing API; `:44-58` creates drafts; `:158-166` warns on stale supporting evidence; `:167-169` previews the exact material.
- `src/shared/application-materials.ts:12-23` defines saved material identity, version, sections and `staleEvidenceIds`. Do not add a shadow source of truth.
- `electron/src/application-materials-backend.cts:144-152` lists persisted projections and recalculates evidence state; `:299-320` maps current staleness. Reuse this canonical read instead of trusting an old UI cache.
- `tests/e2e/application-materials.spec.ts:90` already exercises the materials workflow in Electron; add a targeted handoff assertion rather than replacing existing tests.
- `docs/research/AUTO_APPLY_MARKET_RESEARCH_2026-10-04.md` explicitly rejects mass automated submissions; `GOVERNANCE.md` treats new workflows as material changes and submission automation as high-impact.

## Authority and trust boundaries

Career Evidence remains factual truth, the Application owns lifecycle state, and saved Application Materials remain derived/versioned projections. No inference result can create a confirmed fact; no new credentials or remote storage. The clipboard is an explicit export boundary: show the precise text, require a user action, validate freshness through the existing API immediately beforehand, and truthfully report copy failure. Do not mark an application applied or confirm a receipt as a side effect of exporting text. Existing employer links must stay user-initiated.

## Scope and phases

### Phase 1: Pure handoff-readiness contract (tests first)

**Failing tests to write first**
- Add `tests/application-handoff.test.mjs`; directly call the exported readiness function with synthetic `ApplicationMaterialProjection` inputs and assert exact result values and exact text for (a) usable cover letter backed by evidence links, (b) absent material, (c) draft containing no meaningful text, (d) stale supporting evidence, (e) unsupported material kind, (f) missing or contradictory evidence references/timestamps. No presence-only or regex-only tests.
- Run `node --experimental-strip-types tests/application-handoff.test.mjs` and capture expected failure before implementation; then run it twice successfully when implemented.

**Implementation**
- Add `src/shared/application-handoff.ts`: a pure function accepting the selected current projection or null, producing an explicit ready/blocked result with deterministic reasons and the exact text already rendered by the panel. No IO, storage, network, clock, generated assertions or hidden normalization. Keep the behavior independent of Electron and PWA.
- Reuse the existing exported `ApplicationMaterialProjection` type; do not change the stored format or `ApplicationMaterialsDesktopApi`. The pure function takes a single current projection or `null` and returns a discriminated result: `{ ready: true, text: string }` or `{ ready: false, reason: 'missing-material' | 'unsupported-kind' | 'empty-material' | 'stale-evidence' | 'missing-evidence-links' }`. Use the same joining behavior as the existing preview; do not silently alter punctuation or spacing.
- Explicitly reject missing supporting evidence links, mismatches between selected ids and cited section ids, and missing evidence timestamps. Staleness remains decided by the canonical backend, not inferred from wall-clock time.
- Add the new direct unit suite to the `test` script in `package.json`, so `npm run repo:health` invokes it rather than leaving the test orphaned.

### Phase 2: Explicit, fail-closed UI handoff

**Failing tests to write first**
- Extend `tests/e2e/application-materials.spec.ts` for a fresh applicable version, a stale version after Career Evidence edit, and no application-status mutation after a copy or opening the saved URL.
- Add `tests/pwa/application-handoff.spec.ts` to exercise a real Chromium user click on a selected draft, validate exact copied text where browser permissions allow, and assert a denied/unavailable clipboard reports failure instead of success. Also verify there is no submission or background employer traffic.
- Run those targeted tests and capture initial expected failure before UI code.

**Implementation**
- Modify only `src/components/ApplicationMaterialsPanel.tsx` for the handoff UI, reusing its existing open/close, creation, deletion and warnings UX. Add an accessible **Copy cover letter** action for each version.
- On explicit user click, re-read `applicationMaterials.list(applicationId)`; locate the same saved material **by id** in that authoritative result; apply readiness there, not against the cached array. Refuse missing, stale or malformed projections, including if a draft changes during the user journey.
- Call `navigator.clipboard.writeText` only for the exact approved text, with no automatic export, and report success only if that promise resolves. If the asynchronous re-read invalidates the browser's transient user activation, keep a two-stage **Refresh and review → Copy** flow only after revising this plan and repeating the audit. Do not quietly weaken the fresh-check guarantee.
- No application status transition, background browser automation, form fill, external API submission or new personal-data persistence.

### Phase 3: Documentation and verification

**Tests / review first**
- Re-run all targeted tests, then `npm run repo:health`, `npm run test:pwa:e2e`, `npm run test:e2e` and `npm run test:release-upgrade` in a development environment with dependencies installed; record exact environment, commands, failures and skips. Re-run meaningful new deterministic tests twice.
- Review network traces, authority boundaries, stale-evidence interleaving, clipboard-denied handling, browser activation, accessibility, and Electron/PWA parity. Review on a real employer listing only with mock data and **no submission**.

**Implementation**
- Register the direct unit test in `package.json` during Phase 1; include this change in the implementation PR's file-by-file scope.
- Update `docs/design/APPLICATION_MATERIALS.md`, `HELP.md` and the feature inventory `docs/FEATURE_INDEX.md` *only after code is implemented*, marking verification state honestly. Do not mark as shipped or published.
- Include the issue, specific test evidence, design limits and gate references in the implementation PR.

## Risks and limits

- **Clipboard permission/user activation:** an awaited IPC/backend call may exhaust transient activation. Do not claim the action works on every runtime until proved.
- **Time-of-check vs. time-of-use:** a re-read proves current material at the time it resolves, not a transactional lock on later user edits. The UI must not promise an atomic employer submission.
- **Untrusted job content:** existing cover letters derive from confirmed Career Evidence. Do not interpret job listing text as instructions.
- **Privacy:** clipboard data becomes visible to OS clipboard consumers only on explicit user action. Do not upload or log the text.
- **Runtime divergence:** PWA permission/cross-origin restrictions do not justify an unapproved browser-control fallback.
- **Status drift:** passing CI does not prove a candidate successfully completed an application. UI functionality, release qualification and hiring outcome are different claims.

## Required verification and Qortara gate evidence

Plan preflight (record actual output, do not invent):
```bash
qortara status
qortara check plan-citations --plan docs/plans/228-application-handoff.md
qortara check plan-tests --plan docs/plans/228-application-handoff.md
qortara check plan-consistency --plan docs/plans/228-application-handoff.md
qortara gate record plan - <plan-fields.json>
```

Only after the exact plan receives a separately recorded independent **audit PASS** and intent lock:
```bash
node --experimental-strip-types tests/application-handoff.test.mjs
node --experimental-strip-types tests/application-handoff.test.mjs
npm run repo:health
npm run test:pwa:e2e
npm run test:e2e
npm run test:release-upgrade
qortara check all --record
qortara gate verify
```

Use Qortara's authorized `implement`, `substantiate` and seal commands only in phase order. Record exact passing and failing checks, reviewer identity and the current commit SHA. A non-PASS gate is a blocker, not a discretionary warning. No automatic merge, deployment or release is authorized by this plan.

## Out of scope

Provider expansion (#136), all ATS integrations, automated form submission, accounts and credentials, CAPTCHA handling, background browser operations, company outreach, automatic application status updates, profile-data clipboard mass export, publishing and release.
