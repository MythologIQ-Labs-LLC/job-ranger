# QOR Harden: resume-first UI journey acceptance

**Date:** 2026-10-09  
**Owning issue:** [#214](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/214)  
**Parent:** [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194)  
**Backlog:** B1 end-to-end stories; B4 browser steps using visible UI  
**Proposed browser proof:** `tests/pwa/resume-first-ui-journey.spec.ts`

## Acceptance rationale

A complete backend workflow does not prove that a first-time user can accomplish it. The existing `tests/pwa/career-ops.spec.ts` runs a materially non-software healthcare scenario and verifies durable local data, requirement/evidence assessment, and a parseability-gated PDF. However, most of its setup and mutations go directly through the runtime API. Its real Career Profile file import is valuable coverage, but does not qualify **resume-first onboarding through application artifact** as a user-facing journey.

This new Playwright test exercises a separate browser workspace and performs all **workflow mutations only through visible controls**, from the first-run Resume First button through the generated and linked PDF. The test uses existing healthcare operations fixtures, a real DOCX file chooser, and fixture-backed public Greenhouse endpoint responses. No employer account, live third-party service or real application submission is involved.

Read-only `window.electronAPI` calls at selected checkpoints are allowed solely to verify canonical persisted authority and immutable artifact linkage, **never** to create, confirm, update, track, approve, run or export on behalf of the UI. This distinction is intentional: it makes UI coverage evidence real while retaining independent persistence checks.

## Concrete acceptance sequence and expected outcomes

| Step | Existing user-facing action | Expected durable or visible outcome | Stories |
| --- | --- | --- | --- |
| 1 | Choose **Import a resume** on first-run onboarding, pick synthetic healthcare DOCX | Arrive at Career Profile; original file listed; parsed evidence awaits human review | US-1, US-9 |
| 2 | Before confirmation, navigate to Resume | New truthful draft button disabled; no imported proposal promoted to factual authority | US-9, US-10, US-19 |
| 3 | Return and press **Confirm** on one imported proposal | Exactly one proposal becomes user-confirmed; remaining proposals stay imported; original source retained | US-9, US-10 |
| 4 | Fill name, area and target titles; save Career Profile | Explicit profile preferences persist independently of Career Evidence | US-0, US-5 |
| 5 | Create named healthcare Target Track | Search direction is user-supplied, not inferred from the resume/job | US-4, US-16 |
| 6 | Manually add and run a paused Greenhouse source through source UI | Explicitly authorized monitored source; public fixture scrape yields a preserved job | US-11, US-13 |
| 7 | Open **Opportunity assessment** on Find Jobs | Evidence coverage and eligibility/blockers shown separately, including gaps/unknowns | US-14, US-15, US-18 |
| 8 | Click **Track this job** and save status/notes in Applications | Existing application persists, controls show truthful save acknowledgments | US-23 |
| 9 | Click **Prepare resume** on the job's assessment; create a truthful draft from confirmed evidence; export PDF | Truth Gate passes on user-authoritative evidence, PDF passes export gate and links to tracked application | US-19, US-21, US-22 |
| 10 | Reload and reopen saved resume draft | Previously verified PDF version and evidence-linked draft remain visible; canonical application remains unchanged | US-22, US-30 |

**Cross-cutting:** no external write, no inferred factual authority, no unsupported claims, and no unapproved monitoring. The deterministic no-inference path is mandatory.

## Boundaries and required checks

- **Browser:** full Linux and Windows PWA suites run against the **exact final PR head**. The separate native Electron onboarding test still owns Windows file-dialog integration; this test owns web file chooser and the uninterrupted UI story.
- **Repository:** typecheck/health, Electron E2E, CodeQL/static analysis, Linux and Windows release-upgrade. Do not weaken production gates for a green test.
- **Sources:** synthetically authored DOCX; fixture Greenhouse API read only. Outbound writes or unexpected third-party traffic fail acceptance.
- **Evidence:** only the user-confirmed selected proposal may become fact. Evidence selection, Truth Gate, parseability and immutable artifact link must agree with the canonical read-only storage snapshot.
- **Recovery:** explicit reload of saved artifacts, not a power-loss or backup/restore drill.
- **Failure disposition:** a failing UI path is a product or test-harness finding requiring separate diagnosis. Do not adjust test expectations to pretend an absent control exists or introduce inference to rescue it.

## What this slice does not certify

This single synthetic healthcare operations journey is **not** universal end-to-end qualification. Goal-first, no-resume, career changer, contractor, federal, graduate, nontraditional history, resume editing, evidence reject/edit/merge, backup/restore, and native Electron full-journey coverage still require dedicated story-level checks. Accessibility B3, button sweep B2, and remaining backlog G-items are independently open.

`docs/validation/UNIVERSAL_USER_STORY_MATRIX.md` retains its previous *production-logic validated* dispositions; UI acceptance is **additional evidence** and never retroactively implies that all ten fixture careers had a complete UI replay.

**QOR Harden whole-product ship verdict: INCONCLUSIVE until broader qualification.**
