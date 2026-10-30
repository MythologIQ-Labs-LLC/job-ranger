# Sojourner: Employment Toolkit: approved website media

This branch holds media assets only and is never merged into `main`.

- **What it contains:** the owner-approved, independently reviewed media for the Sojourner product page, ready for the website build to retrieve.
- **Where it came from:** captured 2026-10-30 from `MythologIQ-Labs-LLC/job-ranger@d31e95e38d0de614f8a0a03af5988616a97214f8`. That commit's app source is identical to `main` at `bc3a473`.
- **Data:** all people, employers and records shown are fictional demo data.

| Path | Content |
| --- | --- |
| `screenshots/career-direction.png` | Target Tracks (1600×900) |
| `screenshots/opportunity-assessment.png` | Opportunity assessment drawer (1600×900); suggested hero still |
| `screenshots/career-evidence.png` | Career Evidence (1600×900) |
| `screenshots/resume-truth-gate.png` | Resume draft with Truth Gate passed (1600×900) |
| `screenshots/deliberate-application.png` | Application tracking with linked resume file (1600×900) |
| `video/sojourner-walkthrough.webm` | Walkthrough, VP9, 81.88 s, 1600×900, no audio |
| `video/sojourner-walkthrough.mp4` | Same walkthrough, H.264 High, faststart |
| `video/sojourner-walkthrough-poster.png` | Video poster (frame at 0:24) |
| `video/sojourner-walkthrough.vtt` | WebVTT captions (14 cues) |
| `video/sojourner-walkthrough-transcript.md` | Transcript and text alternative |
| `brand/sojourner-icon.png` | Approved icon, 550×550, transparent |
| `media-manifest.json` | SHA-256, sizes, dimensions, duration, provenance and alt text for each file |
| `WEBSITE_HANDOFF.md` | Page placement, markup example and claims the page must not make |

Retrieve the files at a pinned commit:

```
https://raw.githubusercontent.com/MythologIQ-Labs-LLC/job-ranger/<commit>/<path>
```

Or fetch them with `git fetch origin media/sojourner-website-assets-2026-10-30`. Verify every file against `media-manifest.json` before use. `.gitattributes` keeps all files byte-exact.

The historical Job Ranger media in `main` (`docs/assets/`) is separate and stays as historical material. Tracking: #354, #295, #355.
