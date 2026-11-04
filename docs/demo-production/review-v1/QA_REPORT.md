# QA report: "The Right Next Step", first review cut (2026-11-03)

**Status: approved by the owner for the website product page, 2026-11-03 (published on `media/sojourner-the-right-next-step-2026-11-03`).** It was delivered as a private first review cut. Built on branch `demo/right-next-step-v1-20261103` (from `docs/demo-production-packs-20261103-no-ci` at `b1590587`). Narrative: `docs/demo-production/NARRATIVE_SCRIPT_V02.md`, words unchanged.

## What the film is

95.8 s, 1600×900, 25 fps, H.264 High, `yuv420p`. AAC 48 kHz stereo. One fictional person, Jordan Ellis, goes from patient services toward practice operations:

1. career direction;
2. a promising but imperfect fictional opportunity (Harbor Health) with an unmet Epic EHR requirement;
3. Jordan's actual Career Evidence and its limits;
4. a truthful resume with Truth Gate passed and a verified PDF export;
5. the job tracked as **Interested** with a deliberate next step, a follow-up "Ask Harbor Health about Epic training";
6. the payoff and the branded close.

## Application qualification (Phase 1)

| Item | Evidence |
|---|---|
| Release | GitHub pre-release `v1.0.0-alpha.1`, tag on `58bff07` |
| Installer | `Sojourner-v1.0.0-alpha.1-windows-x64.exe`, SHA-256 `d33758d3fe32e3a033e5daf3d2b3d65deca5fd000d5cd9780d50843641aa0cc1`. Downloaded from the release; matches `windows-SHA256SUMS.txt` |
| Installed app | Per-user install, silent `/S`, exit 0. `%LOCALAPPDATA%\Programs\Sojourner\Sojourner.exe`: FileVersion `1.0.0-alpha.1`, Authenticode **Valid**, signer `CN="MythologIQ Labs, LLC"`. SHA-256 `4b9d3889…ef79`, identical to the release's `windows-signing.json` |
| Running process (logged in `source-capture/capture-log.json`) | name `sojourner`, version `1.0.0-alpha.1`, `isPackaged: true`, execPath the installed exe, `resources\app.asar`, Electron 44.9.1 |
| Isolation | Every launch used a new disposable `--user-data-dir` in `%TEMP%`. No real workspace was read or written. `%APPDATA%\Sojourner` was never created |
| Branding | Sojourner sidebar lockup (MythologIQ Labs / Sojourner / Employment Toolkit), Canopy theme. No Job Ranger text seen in any reviewed frame |
| Scenes on the real build | Rehearsal (`scripts/demo/windows/rehearse.spec.ts`) passed on the installed app, with screenshots in `source-capture/rehearsal/`: Target Tracks; Opportunity assessment (Eligibility · Unclear, Evidence · Partial, Career · Aligned, Preferences · Mixed; blocker "hands-on Epic EHR experience (no confirmed support)"; coverage 3 supported / 1 transferable / 2 gaps); Career Evidence (4 facts); Create truthful draft → **Truth Gate passed** → Export verified PDF → "Show file"; Applications (status `interested` before and after) → Resume versions → follow-up saved. No console errors or page errors |
| Fictional listing | The Harbor Health listing (`scripts/demo/fixture.ts`) reaches the app's real Greenhouse adapter through a local test transport: an undici `MockAgent` with `disableNetConnect`, installed in the main process through Playwright's Electron seam. The filmed session made **no** main-process network requests (`filmedRequests: []`). Seeding made one, which the mock answered |
| Network incident (rehearsal only) | Before the mock was in place, one rehearsal attempt let the app send one real `GET https://boards-api.greenhouse.io/v1/boards/harbor-health/jobs?content=true` (public API, fictional board name). It failed. No data was used, and nothing from it appears in the film |
| Personal data | None. Name, email (`jordan.ellis@example.org`), employer, facts and listing are all fictional fixture data. No credentials or accounts were used |

## Capture (Phase 4)

`scripts/demo/windows/record.spec.ts` uses Playwright 1.64 `_electron.launch` against the installed exe, with `recordVideo` at 1600×900. That is the app window's rendered content; the Windows title bar is not part of the screencast.

- **Seeding:** Jordan's workspace is seeded in an unfilmed first launch; the filmed second launch reuses the same disposable folder.
- **Cursor:** the visible cursor ring is an overlay, as in the earlier PWA film.
- **Hold timing:** each scene holds for its measured narration length.
- **Sync:** a 1 s black flash marks the timeline zero, found again by `blackdetect` (1.88 s into the raw file).
- **Raw capture:** `source-capture/installed-app-capture.webm` (98.9 s).

## Narration (Phase 2): Sonic Rift 0.9.1, installed app, off-screen

Scripts: `scripts/demo/film/sonic_rift_narration.py` (with the harness from the Sonic Rift review film).

- **Voice:** Voices › New voice › Design with **Qwen3 voice design** (`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`, Apache-2.0). It made 4 designs from one written description: warm, thoughtful, calm storyteller, North American English, not an announcer. No real person was imitated.
- **Narrator:** design 1 was cloned and saved as "Sojourner narrator".
- **Lines:** Speech with **Qwen3 voice cloning** (`Qwen/Qwen3-TTS-12Hz-1.7B-Base`, Apache-2.0) produced 4 takes per line, 32 takes in all. S02 was then redone with a paragraph break after its first sentence, so Sonic Rift's 0.6 s paragraph pause slows it from about 215 to about 160 wpm; the words are unchanged and there are 4 more takes. Every take is kept in `audio/narration-takes*/`.
- **Selection:** in `audio/narration-selected/selection.csv`, made by **measurement**. Checks: complete wording heard by Sonic Rift's transcriber; sentence pauses where the script has sentences (S06 takes 2 and 4 rejected for running "Jordan's" into "Sojourner"); pace; no clipping; voice similarity to the chosen design (Chatterbox voice encoder: 0.885–0.954). Scores are in `scores*.json`. **I did not listen to the audio. A human listen is required** (see the owner decisions).

## Music (Phase 3): Sonic Rift Music, installed app

- **Engine:** **ACE-Step 1.5 (2B turbo)**, `ACE-Step/Ace-Step1.5` @ `19671f406d603126926c1b7e2adc169acbcade22`, engine source `ca1e85fe`, **MIT License**.
- **Request:** instrumental, Plan first, 97 s (the film's length), 76 BPM, D major, 4/4, base seed 20261103. The prompt and style fields are in `audio/music/log_dark.json`.
- **Selected: take C** (seed 20261105). Its loudness arc fits the brief best: a quiet opening, a dip around 25–40 s (under the Epic gap), a build from 45–70 s (Career Evidence to Truth Gate), and a resolution over the final 20 s. All 4 takes are kept.
- **Rejected run:** a first run of 4 takes used the wrong prompt. Windows' own `PROMPT` variable (`$P$G`) overrode the brief. Those takes are kept in `audio/music-rejected-wrong-prompt/` for provenance and not used.
- **Vocals:** the transcriber's "Thank you… Transcription by CastingWords" on every take is Whisper's known hallucination on instrumental audio. The takes were generated with Instrumental on.

## Edit (Phase 5)

`scripts/demo/film/build_film.py` builds the film entirely with ffmpeg. The full decision list is in `edit-decision-list.json`.

- **Opener (0–2.6 s):** the owner-approved MythologIQ Labs opener from the Sonic Rift v0.9.1 final cut. It uses the same `make_opener.py`, silver mark, DM Sans (OFL) and timings; the hashes match that cut's manifest. It is re-rendered only so its dissolve lands on this film's first frame. It is silent, and has no TEMPORARY marking.
- **Capture:** three segments of the one installed-app take, joined by two 0.4 s dissolves. The cuts remove only navigation: (1) Career Evidence → back to Find Jobs and opening the drawer; (2) the scroll and click from the coverage list into Resume. Picture is never retimed, frozen or altered.
- **Narration placement:** each line starts 0.6 s after its scene is on screen. S05 is pinned so "Its truth check…" starts 1.2 s before **Truth Gate passed** appears. The S03 cursor reaches the Epic EHR blocker 0.6 s before "But there's a catch".
- **Edit notes:** two notes are added as edit overlays, at the bottom of the sidebar and never over page content: "Installed Sojourner Windows Alpha v1.0.0-alpha.1. Jordan Ellis is fictional; all data is demo data." (0:03–0:09.6) and "Status and follow-up are recorded by Jordan. Sojourner never submits applications to employers." (1:10.8–1:30.9).
- **Music bed:** one continuous take from 0:04 (the opener stays silent), never restarted. It runs through a gentle bed compressor at base −11 dB, and the take's own ending resolves under the end card and tagline.
- **End card:** typeset from the approved Sojourner icon (`public/ICON.png`, SHA-256 `3c557f2d…`): "Sojourner / Employment Toolkit / Windows Alpha · v1.0.0-alpha.1 / github.com/MythologIQ-Labs-LLC/sojourner/releases", plus a fictional-data line. No artwork was generated.
- **Tagline:** "Sojourner. Make the next move count." starts 0.35 s after the end card is fully up.

## Technical QA (Phase 6): measured on the delivered files

| Check | Result |
|---|---|
| Decode, streams | **Pass**. Main: 95.76 s, H.264 High 1600×900 25 fps `yuv420p` (tv range), 2394 frames, AAC LC 48 kHz stereo, faststart. Silent-captioned: same picture plus burned-in captions, no audio stream |
| Loudness | **Pass**: −17.0 LUFS integrated, true peak −1.2 dBFS, LRA 10.2 LU, 0 clipped samples (target −16 LUFS / −1.5 dBTP, within 1 LU) |
| Narration over music, per line (RMS) | **Pass**: S01 20.4, S02 13.5, S03 13.4, S04 15.2, S05 11.3, S06 11.5, S07 14.4, S08 22.6 dB |
| Overlapping narration | **None** |
| Narration intelligible in the final mix | **Pass**: Sonic Rift's transcriber, run on the mastered mix, heard all 8 lines with **no missing words** (`qa-transcription-final-mix.json`) |
| Silence below −50 dBFS for 0.75 s or more | Only 0–3.6 s (the silent opener, then the first app frame while the bed fades in) and 94.5–95.8 s (after the tagline, on the end card) |
| Music continuity | **Pass**: one take, no restarts and no fades between scenes; fade-in at 0:04, natural resolution at the end |
| Black frames | Only 0–0.56 s, the opener's dark canvas before the mark fades in |
| Static holds (`freezedetect`, n=0.001, ≥4 s) | 3.0–20.0, 24.8–35.2, 40.4–51.4 and 82.8–90.8 s. These are **deliberate reading holds** on a responsive app (only the cursor moves): Target Tracks, the assessment, the Career Evidence facts and the saved follow-up. No loading indicator, spinner or app freeze appears. Judge whether they feel too static |
| Captions | 19 WebVTT cues from the placed takes' own pauses: 0 overlaps, shortest 1.63 s, longest 90 characters. The burned-in version uses the same cues |
| Claims | No auto-apply, live feed, background monitoring or hiring guarantee. Truth Gate is narrated as a check of supported resume claims. The Epic gap is never resolved or implied. Status stays Interested |
| Build identity | Version text in the film (sidebar note and end card) matches the running process (`1.0.0-alpha.1`) |
| Earlier media | Untouched: the 2026-10-30 silent PWA film and the `media/sojourner-website-assets-2026-10-30` branch were not modified |

## Watched and not watched

- **Watched (as frames):** contact sheets every 4 s across the whole cut, plus every cut point, the opener frames, the poster, the burned-in captions and the end card. Audio was checked by measurement and by transcription of the final mix.
- **Not done:** I cannot listen. The narrator's warmth, the delivery, the pronunciation of "Sojourner", the music's feel and the overall mix balance need a human listen before approval.
