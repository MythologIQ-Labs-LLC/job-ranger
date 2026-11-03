# Plan: Phase 10 - Reproducible public demo recording

**change_class**: feature

**doc_tier**: minimal

**pr_target**: phase/9-input-shell-layer

**iteration**: 2 (amended after the plan audit VETO recorded at META_LEDGER Entry #54)

Adds a repeatable `npm run demo:record` workflow. It produces the public demo video and curated screenshots from the production web build, using deterministic fictional data and capture-safety checks. Generated media stay out of the repository, and the workflow is not part of CI.

## Open Questions

None.

## Evidence

- The earlier ad-hoc demo (2026-10-06/07) toured every screen, recorded the boot screen and partially rendered states, and was captured before the layout fixes in #159 and #160.
- A dry run of the story on 2026-10-07 (Phase 7 build, Canopy) established the following:
  - The document, not `main`, is the scroll container (`main` is 1,218 px tall in a 900 px window).
  - A bottom-centre caption covers assessment content.
  - Playwright's WebM has no seek cues and reports an infinite duration until seeked to the end, so frame review must decode by playback, and duration must be read after a seek to the end.
  - Wording a listing as sentences ending "... is required." lowers lexical match scores, because the requirement tokenizer keeps the trailing period on the last word.
    - `git show HEAD:electron/src/requirement-mapper.cts | grep -nE 'replace\(/\[\^a-z0-9\+#\./-\]\+/g'` -> `22:    .replace(/[^a-z0-9+#./-]+/g, " ")`
    - `git show HEAD:electron/src/requirement-mapper.cts | grep -nF '.split(/\n+|(?<=[.!?;])\s+/)'` -> `105:    .split(/\n+|(?<=[.!?;])\s+/)`
- In the web runtime, "Export verified PDF" stores a managed artifact without a download. Downloads happen only for save-dialog targets (`src/pwa/runtime/worker-main.ts:157-163`), that is, the "Download file" control. When the resume page carries `?job=`, the export is linked to the tracked application as `submitted` (`src/pages/Resume.tsx:199-203`), and Applications lists it under "Submitted files" (`src/components/ApplicationLifecyclePanel.tsx:128-150`).
- No CI lane installs a browser for the unit scripts. `ci.yml` runs `npm run repo:health`, which includes `npm test`, and the release lane runs `test:unit`, both without `npx playwright install`. Only `pwa.yml` installs Chromium.

## Locked Decisions

- LD1: Story, not tour. The demo has six beats:
  1. **Career direction:** Target Tracks shows a current track and a target track.
  2. **Find Jobs:** one seeded listing.
  3. **Opportunity assessment:** the centerpiece, with the longest hold. It shows:
     - eligibility "unclear" (Epic EHR is a required gap);
     - evidence "partial";
     - career "aligned";
     - preferences "mixed" (on-site against a hybrid preference);
     - blockers, matches, misses and unknowns.
  4. **Career Evidence:** the "Review and correct confirmed evidence" list.
  5. **Deliberate application:** "Prepare resume" from the assessment (tracks the job), then "Create truthful draft" (Truth Gate passed), then "Export verified PDF" (stored and linked to the application as submitted).
  6. **End state:** Applications with status set to Applied and the submitted file listed under Application details, plus a closing caption.

  It uses only implemented capabilities. No employer submission is shown.
- LD2: Deterministic fictional fixture: Morgan Rivera, Harbor Health, Harbor Family Clinic, Chesapeake Family Dental, and an `example.org` email. It contains no real person's data.
  - The listing is served through a routed `boards-api.greenhouse.io` response, so no live network is needed.
  - Listing items use the "Required: ...;" / "Preferred: ...;" style. That style is common in real postings, splits on `;`, and avoids the trailing-period scoring artifact.
  - The recorder asserts the expected assessment (the four status badges, the Epic EHR gap, and the CPR/BLS direct match), so a change in product behavior fails the run instead of filming a different story.
- LD3: Canopy theme. `localStorage.theme = "canopy"` is set by an init script, and the recorder asserts `html[data-theme="canopy"]` on the first and third beats and before every screenshot.
- LD4: Capture safety.
  - Seeding runs in an unrecorded persistent Chromium context. The story then runs in a second, recorded persistent context on the same profile directory and the same `startPwaServer` instance. The origin includes the port, so the stored data carries over. Both contexts live inside one test.
  - The recording opens on a full-screen title card injected by an init script before the app's first paint, and the card is removed only after the first beat is ready.
  - `waitForDemoReady(page, { route, heading, content })` checks, in order:
    - the hash route;
    - the page-specific `h1`;
    - visible seeded content;
    - no boot screen;
    - no loading text;
    - a populated main region;
    - stable layout (document size and scroll unchanged for 600 ms).
  - Each check is a deterministic assertion. Fixed delays are used only for pacing after readiness.
  - Page errors and console errors fail the run.
- LD5: Presentation.
  - 1600x900 Chromium video of the production web build.
  - A visible cursor overlay with eased motion.
  - Restrained captions placed over the sidebar footer (`src/components/Sidebar.tsx:69-74`), so they never cover product content.
  - Five caption lines, following the user-provided guidance.
  - Smooth scrolling of `document.scrollingElement`.
- LD6: Duration. After the story, the recorded context is closed and the video is saved with `video.saveAs("build/demo/video.webm")`. `scripts/demo/frames.mjs` then loads it in Chromium, seeks to the end to resolve the true duration, and writes it with the width and height to `frames/frames.json`. The recorder reads that file and asserts:
  - duration between 60 and 90 s;
  - 1600x900;
  - no near-blank frame.
- LD7: Outputs go to `build/demo/`, newly gitignored as `/build/demo/` next to the existing `/build/trust/` rule:
  - `video.webm`
  - `screenshots/01-career-direction.png`, `02-opportunity-assessment.png`, `03-deliberate-application.png`
  - `frames/`: per-second frames, frames at and 1.5 s after every beat start, `contact-sheet.png` and `frames.json`
  - `demo-report.json`: theme, viewport, beat start times and the measured video metadata

  No media are committed.
  - `grep -nE "^/build/trust/" .gitignore` -> `78:/build/trust/`
- LD8: The demo is a local tool, not a CI check.
  - New scripts:
    - `demo:record`: `npm run build:pwa`, then `npm run test:demo`, then `playwright test --config scripts/demo/playwright.demo.config.ts`.
    - `demo:frames`: `node scripts/demo/frames.mjs build/demo/video.webm build/demo/frames 1`.
    - `test:demo`: `node tests/demo-frames.test.mjs`.
  - `test` and `test:unit` are unchanged, so CI and release lanes do not need a browser.
  - The demo config honours `SOJOURNER_PW_CHROMIUM` the same way `playwright.pwa.config.ts:6` does.
- LD9: `scripts/demo/*.ts`, like `tests/**/*.spec.ts`, sits outside `tsconfig.json`'s `include` and is transpiled by Playwright at run time. `npm run typecheck` is not claimed to cover it.
- LD10: BACKLOG records the tokenizer's trailing-punctuation scoring artifact as G11, a product defect left for a separate fix.

## Phase 1: Demo harness

### Unit Tests

- `scripts/demo/story.spec.ts` is itself the acceptance test. It fails when:
  - any readiness check fails;
  - the theme is not Canopy;
  - the assessment statuses, the Epic EHR gap or the CPR/BLS match differ from LD2;
  - the Truth Gate does not pass;
  - Applications does not list the exported PDF under "Submitted files";
  - any page or console error occurs;
  - LD6's duration, resolution or near-blank check fails.
- `tests/demo-frames.test.mjs` (new, run by `npm run test:demo` and by `demo:record` before recording):
  - Creates a 3-second WebM in Chromium with `MediaRecorder` from a canvas that is redrawn on every animation frame and changes colour each second.
  - Runs `scripts/demo/frames.mjs` on it.
  - Asserts three distinct mean luminances for the frames at 0.5, 1.5 and 2.5 s, a measured duration of 3 ± 0.5 s, and a written contact sheet.
  - It fails if the extractor returns the same frame for every timestamp, which was the seek-based failure mode.

### Affected Files

- `scripts/demo/playwright.demo.config.ts` (new) - Chromium, `testDir` `scripts/demo`, `testMatch` `story.spec.ts`, one worker, 300 s timeout, `SOJOURNER_PW_CHROMIUM` override.
- `scripts/demo/fixture.ts` (new) - fixture data and `seedDemo(page)`.
- `scripts/demo/ready.ts` (new) - `waitForDemoReady`, `waitForLayoutStable`, `scrollToElement`, `caption`, `installTitleCard`, `removeTitleCard`, `installCursor`, `glideClick`.
- `scripts/demo/story.spec.ts` (new) - seeding context, recorded story context, assertions, screenshots, `video.saveAs`, frame review, `demo-report.json`.
- `scripts/demo/frames.mjs` (new) - playback-based frame review, duration by seek-to-end, contact sheet.
- `tests/demo-frames.test.mjs` (new) - extractor test.
- `package.json` - `demo:record`, `demo:frames` and `test:demo` scripts. `test` and `test:unit` unchanged.
- `.gitignore` - `/build/demo/`.
- `docs/BACKLOG.md` - G11.
- `CHANGELOG.md` - Unreleased entry.
- `docs/GOVERNANCE_INDEX.md` - Phase 10 plan row.

## Feature Inventory Touches

None. This adds a recording tool, not a user-touchable product feature.

## Definition of Done

### Deliverable: Reproducible public demo

- **D1**: `npm run demo:record` produces, from the production web build:
  - a six-beat story demo that is Canopy-themed, 1600x900, and 60-90 s long by LD6's measurement;
  - three curated screenshots.

  It uses deterministic fictional data and no live network.
- **D2**: The files above exist. `demo:record`, `demo:frames` and `test:demo` work. `/build/demo/` is ignored. `test` and `test:unit` are unchanged.
- **D3**: Ledger plan/audit/implement/seal entries; BACKLOG G11; CHANGELOG and governance index updated.
- **D4**:
  - `npm run test:demo` passes.
  - Two consecutive `npm run demo:record` runs pass every story assertion with the same beats.
  - The accepted run's exported video is reviewed frame by frame (per second, plus at and after every beat start), with findings recorded. Any bad frame rejects the run and triggers another recording.

## CI Commands

- `npm run test:demo` - extractor test (needs Playwright Chromium; local only).
- `npm run demo:record` - build, extractor test, and recorded story with all assertions.
- `npm run demo:frames` - frame review of the exported video.
- `npm test` - unchanged unit suite, run to confirm nothing else changed.
