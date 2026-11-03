# Plan: Phase 12 - Commit the accepted public demo video

**change_class**: hotfix

**doc_tier**: minimal

**pr_target**: phase/10-public-demo-harness (PR #155, branch `docs/public-review-readme`)

**iteration**: 1

Commits the accepted public demo recording to the repository at the maintainer's explicit request (2026-10-07) and links it from the README "See it in action" section.

## Open Questions

None.

## Evidence

- The maintainer chose to commit the video under `docs/assets/`, on the PR #155 branch, as a plain Git file rather than through Git LFS or as a release asset, and to run it through a governed phase (2026-10-07).
- The accepted recording is Phase 10 take 11. It was reviewed frame by frame, and META_LEDGER Entry #56 records that review.
  - It is stored at `.scratch/demo-final/video.webm` (8,930,679 bytes, SHA-256 `00202f983e48453d04d900c1de4c14d59484da2d723aed883ea9be7b1c32571f`).
  - Its metadata is in `.scratch/demo-final/demo-report.json`: Canopy, 1600x900.
- Phase 10 LD7 says "No media are committed", and `.gitignore` ignores only `/build/demo/` (`grep -nE "^/build/demo/" .gitignore`). `docs/assets/` is not ignored, so a file there is tracked normally.
- The repository has no `.gitattributes` and no LFS configuration. 8.9 MB is under GitHub's 50 MB warning and 100 MB block limits.
- Since Phase 10 the only product change is the `sourceRepository` fallback string in `build-info.json` (Phase 11). That string is not shown anywhere in the recorded story, so take 11 still shows the current product.
- GitHub does not play a repository-hosted `.webm` inline in a rendered README. A relative link opens the file's page on GitHub, where it can be viewed or downloaded.

## Locked Decisions

- LD1: Take 11 is committed unchanged as `docs/assets/demo/historical/legacy-walkthrough.webm`. It is copied byte for byte, and the committed file's SHA-256 must equal the Evidence hash. It is not re-recorded or re-encoded, because the frame-by-frame review applies only to that exact file.
- LD2: The README "See it in action" section links to it with a relative link, `./docs/assets/demo/historical/legacy-walkthrough.webm`. The link text gives the length (85 seconds) and says the walkthrough uses the same fictional data. The section's closing sentence still gives `npm run demo:record` for recording locally. It makes no hosted-demo claim.
- LD3: This supersedes Phase 10 LD7's "No media are committed" for this one accepted take. `build/demo/` stays ignored, and new recordings are still not committed automatically. A refreshed video is committed only by a later deliberate change.
- LD4: The CHANGELOG Unreleased entry for the README section records that the walkthrough video is now committed.

## Phase 1: Commit the video and link it

### Unit Tests

- No code changes. Acceptance is checked directly:
  - `sha256sum docs/assets/demo/historical/legacy-walkthrough.webm` equals the Evidence hash;
  - the README link target resolves to that file;
  - Playwright Chromium loads the committed file and reports a 1600x900 frame size and a duration between 60 and 90 s, using the measurement `scripts/demo/frames.mjs` uses: `node scripts/demo/frames.mjs docs/assets/demo/historical/legacy-walkthrough.webm <tmp> 10`, read from `frames.json`.

### Affected Files

- `docs/assets/demo/historical/legacy-walkthrough.webm` (new)
- `README.md` - link in "See it in action"
- `CHANGELOG.md` - Unreleased entry wording
- `docs/GOVERNANCE_INDEX.md` - Phase 12 plan row

## Feature Inventory Touches

None.

## Definition of Done

### Deliverable: Committed demo video

- **D1**: The accepted, reviewed walkthrough is in the repository and linked from the README, with no hosted-service claim.
- **D2**: The files above exist. The committed video is byte-identical to take 11.
- **D3**: Ledger plan, audit, implement and seal entries; governance index and CHANGELOG updated.
- **D4**: The hash matches; `frames.mjs` reports 1600x900 and a duration of 60-90 s for the committed file; the README link resolves; `npm test` passes.

## CI Commands

- `node scripts/demo/frames.mjs docs/assets/demo/historical/legacy-walkthrough.webm <tmp> 10` - committed file decodes at 1600x900 with a duration of 60-90 s.
- `npm test` - unit suite, unchanged.
