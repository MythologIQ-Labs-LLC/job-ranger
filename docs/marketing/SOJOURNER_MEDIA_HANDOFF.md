# Sojourner: Employment Toolkit — first-party media capture and website handoff

Status: **CAPTURE PENDING / NOT APPROVED FOR PUBLICATION**. Owner request: 2026-10-29. Tracking: #354 (site assets), #295 (recording), #339 (name/launch), #315 (Google Drive export).

This is an editorial and production manifest, **not** a claim that the new media exists. Only media recorded from the running, appropriately qualified Sojourner PWA may replace historical Job Ranger assets. The prior WebM and screenshots remain historical until independently reviewed replacements are approved.

## Product and source-of-truth

- Product: **Sojourner: Employment Toolkit**. Browser/PWA only; Electron tooling exists only for development/test.
- Primary story: a local-first job-search companion for career direction, evidence-backed opportunity assessment, truthful resumes and deliberate application tracking.
- First-party capture scripts: `scripts/demo/story.spec.ts`, `scripts/demo/screenshots.spec.ts`, `scripts/demo/fixture.ts`, `scripts/demo/ready.ts`.
- Commands: `npm run demo:record`; `npm run demo:screenshots`. Both build the PWA and use `scripts/demo/playwright.demo.config.ts`; honor `JOB_RANGER_PW_CHROMIUM` when a compatible supplemental browser is required.
- Output: `build/demo/video.webm`, `build/demo/screenshots/`, `build/demo/curated/`, `build/demo/demo-report.json`, `build/demo/frames/`. Check actual output before signoff.
- Video script targets 1600×900, Canopy theme, 60–90 seconds, fictional fixture, source assertions, a single story and a frame review. Screenshot script targets 1600×900 with no caption/cursor overlays.
- Do not portray a recorded `application status = applied` change as a real job application submission. Do not claim live remote job feeds, automated application submission, Google Drive OAuth/export, background monitoring, or hiring outcomes from the demo fixture.

## Capture and acceptance inventory

| Asset ID | Proposed filename | On-screen content and approved caption | Website placement | State |
| --- | --- | --- | --- | --- |
| S1 | `career-direction.png` | Target tracks: distinguish a future path from current work. Alt: "Sojourner Target Tracks with a selected career direction and separate current track." | Product page, capability carousel | Pending fresh capture |
| S2 | `opportunity-assessment.png` | Opportunity assessment: eligibility, evidence coverage, alignment and unknowns rather than one opaque score. Alt: "Sojourner opportunity assessment drawer showing evidence and eligibility categories." | Product page hero or feature detail | Pending fresh capture |
| S3 | `career-evidence.png` | Career Evidence: review facts and their provenance. Alt: "Sojourner Career Evidence review showing editable work history facts." | Product page, evidence section | Pending additional real UI capture; no existing dedicated curated screenshot asserted |
| S4 | `resume-truth-gate.png` | Resume preparation: confirmed facts and Truth Gate, not an invented qualification. Alt: "Sojourner resume builder showing verification of a truthful draft." | Product page, resume section | Pending additional real UI capture; no existing dedicated curated screenshot asserted |
| S5 | `deliberate-application.png` | Application tracking: a fictional listing, status and recorded materials. Alt: "Sojourner Applications view tracking a fictional job opportunity and supporting materials." | Product page, workflow section | Pending fresh capture |
| V1 | `sojourner-walkthrough.webm` | Actual 60–90 second PWA walkthrough: career direction → Find Jobs/assessment → evidence → truthful resume → tracked application. | Product page hero video / media gallery | Pending Claude recording |
| V2 | `sojourner-walkthrough.mp4` | H.264 version of V1 when transcoding is available; same frames/timing. | Broader playback compatibility | Pending capture/transcode |
| P1 | `sojourner-walkthrough-poster.png` | Representative sharp video frame, not a graphic mock UI. | Video poster/thumbnail | Pending capture |
| C1 | `sojourner-walkthrough.vtt` | Timed captions based on exact resulting clip, accurately describing fictional/demo-only behavior. | Video accessibility | Pending recording |
| T1 | `sojourner-walkthrough-transcript.md` | Transcript and concise text alternative matched to edited video. | Product page accessible alternative | Pending recording |
| B1 | Approved Sojourner icon/wordmark source and transparent PNG | Use existing approved icon; do not generate a new emblem as a substitute. | Product page identity | Existing source `public/ICON.png`; transparent/logo approval not yet checked |

## Recorded-media manifest: populate with actual evidence, never guesses

For **each** delivered file record: source SHA, build ID, fixture hash, capture timestamp/time zone, browser and version, OS, viewport, theme, data classification ("fictional seeded data"), relative and durable handoff paths, exact SHA-256, width/height (image/video), duration (video), alt text or caption, rights/license, reviewer, approval date and any excluded/unproven capability.

No checksum, storage URL, playback verdict or approval may be written before the real asset exists and has been inspected.

## Script execution and review checklist

1. Pin the exact Sojourner source SHA and validate demo fixture stability. Do not quietly reuse a historic Job Ranger build or represent PR #315 unmerged features as shipping.
2. Build the production PWA and isolated demo flavor; run existing handoff checks and the relevant demo tests. Use fictional data only; no personal contacts, Google credentials or Drive uploads.
3. Run both existing Playwright capture commands on the **same pinned candidate**. If a selector fails, correct only the demonstrated demo/test defect; do not invent UI or weaken assertions.
4. Review every shot at native resolution: actual Sojourner branding, legible data, modal drawer geometry, theme consistency, no clipping at 1600×900 and mobile width 390, keyboard focus, reduced motion and console errors.
5. Watch the entire recorded clip with audio off. Review transitions, held frames, poster, accurate narrative and scenes showing the *real* application. Verify 60–90 seconds and check frame extraction/blank-frame results. Do not assume the script's assertions substitute for human playback review.
6. Produce a poster, WebM and (if tools support) H.264 MP4. Generate captions and transcript **from the final clip timeline**, not from the scene plan. Only original/licensed audio; no autoplay requirement.
7. Compute SHA-256 of every final file, store video outside Git if required by repo policy, and provide a durable, owner-accessible asset handoff. Preserve the older historical media until owner approval.
8. Explicitly state whether pinned Chromium qualification, Google OAuth live acceptance, independent security review and commercial name clearance remain open. Media quality approval is independent of product beta release approval.

## Suggested website placement and factual copy

**Hero:** Sojourner emblem, product name, brief value statement, one real PWA image or approved poster. **Features:** S1 through S5. **Walkthrough:** V1/V2 with poster, captions and transcript. **Privacy/limits:** local-first design, manual oversight, fictional demo data; no auto-apply claims.

**Proposed site description (39 words):**

> Sojourner: Employment Toolkit helps you choose a career direction, assess opportunities against real evidence, prepare truthful application materials, and track your search. Its local-first workflow puts informed decisions ahead of sending more applications.

## Approval gates and handoff

- Media/website issue: #354. Recording issue: #295. Product name/compatibility: #339.
- Reviewer must confirm screenshot authenticity, exact provenance, filename correctness, safe fictional data, rights, captions, responsive framing and playback before marking media ready.
- Website team receives accepted files **and** this populated manifest, then performs its own product-page implementation. This document grants no website deployment, release, merge or GitHub Actions execution.
