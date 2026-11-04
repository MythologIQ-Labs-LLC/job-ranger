# Sojourner product page: narrated film handoff

**Film:** "The Right Next Step" (narrated, 95.8 s)

**Status:** approved by the owner for the website product page on 2026-11-03 ("promote this into GitHub … accessible for the website to incorporate into the product page"). Checksums, provenance and alt text are in `media-manifest.json`.

## What it shows

The film was recorded in the **installed, signed Sojourner Windows Alpha v1.0.0-alpha.1**. It follows one fictional person, Jordan Ellis, who is moving from patient services toward practice operations. All data is fictional demo data.

- **Career direction:** Jordan sets a target direction.
- **Assessment:** a promising but imperfect fictional opportunity (Harbor Health), with an unmet Epic EHR requirement.
- **Career Evidence:** Jordan's confirmed facts and their limits.
- **Truthful resume:** Truth Gate passed, and a verified PDF exported.
- **Tracking:** the job stays at **Interested**, with one deliberate next step recorded: a follow-up to ask about Epic training.

**Audio:**
- The narration was made in Sonic Rift 0.9.1 with Qwen3 voice design and cloning (Apache-2.0).
- The original music was made in Sonic Rift Music with ACE-Step 1.5 (MIT).
- The opener is the shared MythologIQ Labs opener.

## Placement

| Page slot | File | Notes |
| --- | --- | --- |
| Product video | `video/sojourner-the-right-next-step.mp4` | H.264 High plus AAC, 1600×900, 25 fps, faststart. Ship with controls and the captions track. Do not autoplay with sound. |
| Captions | `video/sojourner-the-right-next-step.vtt` | WebVTT, 19 cues, timed to the narration. |
| Poster | `video/sojourner-the-right-next-step-poster.png` | Frame at 0:29: the opportunity assessment with the Epic EHR blocker. |
| Muted / autoplay loop (optional) | `video/sojourner-the-right-next-step-silent-captioned.mp4` | The same picture with captions burned in and no audio track. Use it only where a muted preview is wanted; link to the narrated film. |
| Accessible alternative | `video/sojourner-the-right-next-step-transcript.md` | Narration plus a description of each scene. Link it next to the video. |
| Identity | `brand/sojourner-icon.png` | The approved icon, unchanged. |

```html
<video controls preload="metadata" width="1600" height="900"
       poster="sojourner-the-right-next-step-poster.png">
  <source src="sojourner-the-right-next-step.mp4" type="video/mp4">
  <track kind="captions" srclang="en" label="English" src="sojourner-the-right-next-step.vtt">
</video>
<p><a href="sojourner-the-right-next-step-transcript.html">Read the transcript</a></p>
```

## Claims the page must not make

- **No submitting:** Sojourner does not submit applications or contact employers. The film says so, and shows the status recorded by Jordan.
- **No live data:** there is no live job feed in the film. The Harbor Health listing is fictional demo data, not a live opening.
- **No hiring promise:** Truth Gate checks that the resume's claims are supported by confirmed Career Evidence. It does not decide eligibility or hiring.
- **Windows Alpha is a pre-release:** describe it as an alpha. Download: https://github.com/MythologIQ-Labs-LLC/sojourner/releases/tag/v1.0.0-alpha.1

## Retrieve

Use the pinned commit given in the repository's `docs/marketing/SOJOURNER_MEDIA_HANDOFF.md`:

```
https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/<commit>/<path>
```
