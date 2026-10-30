# Sojourner product page: media handoff

**Package:** `sojourner-2026-10-30-d31e95e`
- **Source:** captured 2026-10-30 from source commit `d31e95e38d0de614f8a0a03af5988616a97214f8`. Its app source is identical to `main` at `bc3a473`.
- **Status:** captured and independently reviewed. **Do not publish until the owner approves.**
- **Details:** checksums, provenance and alt text for every file are in `media-manifest.json`.

All content shows the real Sojourner web app with **fictional demo data**. The video is silent; always ship it with its captions and transcript.

## Placement

| Page slot | File | Notes |
| --- | --- | --- |
| Identity / header | `brand/sojourner-icon.png` | Existing approved icon (550×550, transparent PNG). Do not redraw or substitute it. |
| Hero still | `screenshots/opportunity-assessment.png` | Clean screenshot with no overlay. |
| Video poster | `video/sojourner-walkthrough-poster.png` | The 0:24 frame of the video. It includes the recording caption and cursor ring, so use it only as the video poster. |
| Feature: choose a direction | `screenshots/career-direction.png` | |
| Feature: assess opportunities | `screenshots/opportunity-assessment.png` | |
| Feature: Career Evidence | `screenshots/career-evidence.png` | |
| Feature: truthful resume / Truth Gate | `screenshots/resume-truth-gate.png` | |
| Feature: application tracking | `screenshots/deliberate-application.png` | "Applied" and "Submitted files" are records the user keeps. Page copy must say Sojourner records, not submits, applications. |
| Walkthrough video | `video/sojourner-walkthrough.webm` (VP9) with `video/sojourner-walkthrough.mp4` (H.264, faststart) as a fallback; `poster`; `track` = `video/sojourner-walkthrough.vtt` | 82 s, 1600×900, no audio. Provide controls and a captions toggle. |
| Accessible alternative | `video/sojourner-walkthrough-transcript.md` | Link next to the video, or render as text. |

Alt text for each image is in `media-manifest.json` (`files[].altText`).

```html
<video controls preload="metadata" width="1600" height="900"
       poster="sojourner-walkthrough-poster.png">
  <source src="sojourner-walkthrough.webm" type="video/webm">
  <source src="sojourner-walkthrough.mp4" type="video/mp4">
  <track kind="captions" srclang="en" label="English" src="sojourner-walkthrough.vtt" default>
</video>
<p><a href="sojourner-walkthrough-transcript.html">Read the walkthrough transcript</a></p>
```

## Product copy (owner-proposed, 39 words)

> Sojourner: Employment Toolkit helps you choose a career direction, assess opportunities against real evidence, prepare truthful application materials, and track your search. Its local-first workflow puts informed decisions ahead of sending more applications.

## Claims the page must not make

- **No submission:** Sojourner does not submit applications to employers.
- **No live services:** no live job feed, background monitoring or cloud sync was used in the demo.
- **No Google Drive export:** it is in separate, unaccepted beta qualification (#315).
- **No outcomes:** the page must not imply hiring outcomes or success rates.
- **Not a desktop product:** Sojourner is a web/PWA app. Electron exists only for development and testing.
- **Fictional data:** label it as demo data wherever the page might be read as a real user's story.

## Known product-copy items visible in this media (not capture defects)

Recorded for the owner and UX backlog (#248). They do not block the media's accuracy.

- **`career-direction.png` / video 0:04–0:14:** "This promoted bridge remains reserved during the Career Profile transition and cannot be deleted yet." reads as internal migration text.
- **`opportunity-assessment.png` / video 0:18–0:35:**
  - Stray punctuation: "experience; (no confirmed support)."
  - The employment-arrangement line appears both as a blocker and as an unknown.
  - The "3 DIRECT" badge sits over rows labelled "Supported".
- **`resume-truth-gate.png`:** the Template select truncates to "ATS-safe stanc".
- **`deliberate-application.png` / video 1:13–1:17:** "Submitted files" and "PDF v1 · submitted" next to "Applied" could be read as Sojourner submitting the application.
- **`career-evidence.png`:** the facts section is at the bottom of the page, so the top edge shows the end of the entry form. "Civilization survives." may read as flippant.

## Historical media

`docs/assets/demo/job-ranger-demo.webm` and `docs/assets/screenshots/*.png` (Job Ranger era) stay until the owner approves replacement.
