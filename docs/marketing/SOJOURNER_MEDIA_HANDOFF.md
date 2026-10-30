# Sojourner: Employment Toolkit — first-party media capture and website handoff

Status: **CAPTURED AND INDEPENDENTLY REVIEWED (media READY) / NOT APPROVED FOR PUBLICATION**. Owner request: 2026-10-29; capture 2026-10-30. Tracking: #354 (site assets), #295 (recording), #339 (name/launch), #315 (Google Drive export).

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
| S1 | `career-direction.png` | Target tracks: distinguish a future path from current work. Alt: "Sojourner Target Tracks with a selected career direction and separate current track." | Product page, capability carousel | Captured 2026-10-30 (d31e95e), reviewed: READY |
| S2 | `opportunity-assessment.png` | Opportunity assessment: eligibility, evidence coverage, alignment and unknowns rather than one opaque score. Alt: "Sojourner opportunity assessment drawer showing evidence and eligibility categories." | Product page hero or feature detail | Captured 2026-10-30 (d31e95e), reviewed: READY |
| S3 | `career-evidence.png` | Career Evidence: review facts and their provenance. Alt: "Sojourner Career Evidence review showing editable work history facts." | Product page, evidence section | Captured 2026-10-30 (d31e95e), new curated capture; reviewed: READY (framing note) |
| S4 | `resume-truth-gate.png` | Resume preparation: confirmed facts and Truth Gate, not an invented qualification. Alt: "Sojourner resume builder showing verification of a truthful draft." | Product page, resume section | Captured 2026-10-30 (d31e95e), new curated capture; reviewed: READY |
| S5 | `deliberate-application.png` | Application tracking: a fictional listing, status and recorded materials. Alt: "Sojourner Applications view tracking a fictional job opportunity and supporting materials." | Product page, workflow section | Captured 2026-10-30 (d31e95e), linked resume row in frame; reviewed: READY |
| V1 | `sojourner-walkthrough.webm` | Actual 60–90 second PWA walkthrough: career direction → Find Jobs/assessment → evidence → truthful resume → tracked application. | Product page hero video / media gallery | Captured 2026-10-30 (d31e95e), 81.88 s, reviewed: READY |
| V2 | `sojourner-walkthrough.mp4` | H.264 version of V1 when transcoding is available; same frames/timing. | Broader playback compatibility | Encoded (H.264 High, faststart), reviewed: READY |
| P1 | `sojourner-walkthrough-poster.png` | Representative sharp video frame, not a graphic mock UI. | Video poster/thumbnail | Frame 0:24.00 of V1, reviewed: READY |
| C1 | `sojourner-walkthrough.vtt` | Timed captions based on exact resulting clip, accurately describing fictional/demo-only behavior. | Video accessibility | 14 cues timed from final video, reviewed: READY |
| T1 | `sojourner-walkthrough-transcript.md` | Transcript and concise text alternative matched to edited video. | Product page accessible alternative | Matched to final video, reviewed: READY |
| B1 | Approved Sojourner icon/wordmark source and transparent PNG | Use existing approved icon; do not generate a new emblem as a substitute. | Product page identity | `public/ICON.png` copied unchanged; verified RGBA with transparent background |

## Recorded-media manifest: populate with actual evidence, never guesses

For **each** delivered file record: source SHA, build ID, fixture hash, capture timestamp/time zone, browser and version, OS, viewport, theme, data classification ("fictional seeded data"), relative and durable handoff paths, exact SHA-256, width/height (image/video), duration (video), alt text or caption, rights/license, reviewer, approval date and any excluded/unproven capability.

No checksum, storage URL, playback verdict or approval may be written before the real asset exists and has been inspected.

## Capture record (2026-10-30)

- **Source:** commit `d31e95e38d0de614f8a0a03af5988616a97214f8` on this branch.
  - The app source (`src`, `public`, `index.html`, Vite configs, `electron`) is identical to `main` at `bc3a473`.
  - Only demo scripts and one test changed on this branch: `2d1d90c` and `d31e95e`.
- **Build and capture:** clean tree, then:
  - `npm run typecheck`, `build:pwa`, `build:pwa:demo`;
  - both `verify-studio-handoff` checks;
  - `npm run demo:record` (frame self-test and story; 108 sampled frames, 0 near-blank, 0 console or page errors);
  - `npm run demo:screenshots`.
- **Environment:**
  - Windows 11 Pro 10.0.26300, Node 24.19.0, Playwright 1.64.0;
  - Chromium 156.0.8078.4 (Playwright v1248, headless);
  - viewport 1600×900, Canopy theme;
  - fixture `scripts/demo/fixture.ts` (blob `b6d24ea`), fictional seeded data;
  - encodes made with ffmpeg 9.0.1.
- **Files:** the full per-file evidence is in [`media/sojourner-2026-10-30-d31e95e/media-manifest.json`](./media/sojourner-2026-10-30-d31e95e/media-manifest.json). It records SHA-256, bytes, dimensions, duration, capture time, provenance and alt text. The [captions](./media/sojourner-2026-10-30-d31e95e/sojourner-walkthrough.vtt), [transcript](./media/sojourner-2026-10-30-d31e95e/sojourner-walkthrough-transcript.md) and [website handoff](./media/sojourner-2026-10-30-d31e95e/WEBSITE_HANDOFF.md) are committed alongside it.
- **Storage:** image and video binaries are **not** committed, because this repository is public and publication is not yet approved.
  - Durable owner-held copy: `C:\dev\mythologiq\sojourner\media-handoff\sojourner-2026-10-30-d31e95e\` on the owner's workstation (outside Git; listed in `.git/info/exclude`).
  - Its SHA-256 values match the manifest.
  - Where the binaries are published (this repository, a release, or the website's own storage) is an owner decision.

| File | SHA-256 | Size | Media |
| --- | --- | --- | --- |
| `video/sojourner-walkthrough.webm` | `0b32196b89db0c97440e00daf97d774fa8b37864b217c6d54614b39cad3489f1` | 3,894,659 B | 1600×900, 81.88 s |
| `video/sojourner-walkthrough.mp4` | `060615bef63d5baf5b6d49a5c06df0c4d6993acf369fa9d18600eb6aff6a8852` | 5,747,491 B | 1600×900, 81.88 s |
| `video/sojourner-walkthrough-poster.png` | `bbe9429689b84da8fe5f4867c522978b096d0dce38ffca74eb62b17ac5711766` | 445,640 B | 1600×900 |
| `video/sojourner-walkthrough.vtt` | `4cb059a882af81d262400a5473c5826c8fdcb23c6df0048539e25b4e75059d79` | 2,944 B |  |
| `video/sojourner-walkthrough-transcript.md` | `198d432d4e190ecd6a5a999f7d870b2107104e3e1544bab8a47627de859bbc47` | 4,546 B |  |
| `screenshots/career-direction.png` | `b0f8e1908f5654920a27cbf7d8d7ee06d03683bc1d68a631318b0136d340edf7` | 429,843 B | 1600×900 |
| `screenshots/opportunity-assessment.png` | `a33524207f158fc55721f4eadc5a5c73c958f1e2f717ee2d4a40892a7ce1c485` | 195,233 B | 1600×900 |
| `screenshots/career-evidence.png` | `13df14a165485be2c7725b998efd5c61bcaa9527974661c135f63c23b21dcb93` | 374,824 B | 1600×900 |
| `screenshots/resume-truth-gate.png` | `f4bbc557e1fe1ec552976da83869ebe57ce0db0adbd4b3f420c37ae74001d62e` | 345,879 B | 1600×900 |
| `screenshots/deliberate-application.png` | `18f8919527a7edca0b4b0cd851dc28a10dde445d273a5e81e48a8a4378886463` | 297,138 B | 1600×900 |
| `brand/sojourner-icon.png` | `3c557f2dbe8273d97ce05e9aacf49ec51df68bdbd66d466feb1a11d664a28e4c` | 282,170 B | 550×550 |
| `source/raw-playwright-recording.webm` | `dcec7f019c2a1e49079cdefd3b2388903fbe91c8698bc82c8b6b50a0dfaef397` | 17,883,225 B | 1600×900, 81.88 s |
| `source/demo-report.json` | `11232dc6a62328723d0af47a380453bd6df091c514fe874577eb4e9240b9e259` | 547 B |  |

**Independent review** was by a separate review agent, not a human approval.
- **Round 1 (first capture `2d1d90c`): CONDITIONAL.**
  - Four caption cues started 2–3 s before the visible page change.
  - The linked resume file was claimed but sat below the frame.
  - Both were fixed by re-capturing from `d31e95e` and retiming the cues from the footage.
- **Round 2 (`d31e95e`): READY.**
  - All 14 cue starts are within 0.5 s.
  - All checksums, durations and frame counts were re-verified.
  - The WebM and MP4 have the same 2047 frames.
  - There are no blank frames, no legacy Job Ranger branding, no real personal data, and no claim of submission, live feeds, Google Drive export or outcomes.
- **Remaining nits:**
  - The cursor ring rests on some labels and on one poster line.
  - `career-evidence.png` is framed at the bottom of the page.
  - The product-copy items listed in the website handoff are for #248.
- **Mobile:** checked at 390px on the same build. There is no horizontal overflow on Target Tracks, Find Jobs, Career Evidence, Resume or Applications, and the assessment drawer fills the width.

Still open and independent of media quality:
- owner approval and the storage decision;
- Google Drive OAuth acceptance (#315, not shown);
- commercial name clearance (#339);
- product beta release approval.

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
