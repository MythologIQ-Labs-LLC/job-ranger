# Sojourner: The Right Next Step — Narrative production script v0.2

**Status: FILMED AND APPROVED (2026-11-03).** Filmed word for word in the installed Windows Alpha and approved by the owner for the website product page; see [`review-v1/`](./review-v1/README.md). The status that follows is historical: ~~OWNER REVIEW / script authored, NOT capture qualified.~~  
**Recording source:** signed Windows release `v1.0.0-alpha.1` where possible, after confirming current release and exercising exact actions in an isolated fixture. Do not show the old browser walkthrough as Windows proof.  
**Voice:** warm, focused, human, reassuring rather than overly cheerful. All narration and original music created **in Sonic Rift**, not via Claude's own synthesis or an outside TTS.  
**Film length:** aim 100–115 seconds, not a stopwatch quota. A satisfying decision is more important than an extra screen.  
**Hero story:** *Jordan Ellis* wants to move from patient services into practice operations. A fictional Harbor Health opportunity looks promising, but isn't a perfect match. Jordan investigates, builds an honest resume, and deliberately keeps track of the next step.

## Narrative promise

**Problem → Direction → Honest assessment → Evidence → Truthful preparation → Deliberate action → Payoff.**  
This is **one person's journey**, not seven disjointed feature announcements. Each scene should logically answer a question raised by the previous one.

### Full spoken script and visual evidence

| Beat / approximate screen time | What we show, in the REAL application | Narration — exact draft for Sonic Rift | Editing and emotion |
| --- | --- | --- | --- |
| S00 · 0–3 s · Shared identity | Exact approved silver MythologIQ Labs logo if master verified; otherwise temporary private review card, never unapproved illustration | *(No speech)* | Short restrained original signature. No long silent opener. |
| S01 · 3–12 s · A person, not a spreadsheet | Real Sojourner Windows app, career directions; Jordan's current **Patient services** and future **Practice operations** tracks | **“Jordan has experience helping patients. But the next move isn't just another front-desk job.”** | Start gently. Avoid a fake office stock-image opener; the identity and true UI establish the story. |
| S02 · 12–23 s · Direction | Open **Practice operations**, show relevant title and preferences. Contrast current versus target without over-scrolling | **“Jordan wants to help run a practice. So the search starts with a clear direction, and the kind of work that would actually fit.”** | One action, then readable result. Transition on a consistent musical phrase. |
| S03 · 23–40 s · A promising but imperfect role | Find Jobs → fictional Harbor Health **Practice Operations Coordinator** → actual Opportunity assessment: **Career Aligned**, **Evidence Partial**, **Eligibility Unclear**. Show the required Epic EHR gap | **“This role looks promising. The pay and direction make sense. But there's a catch: Jordan hasn't confirmed the Epic experience the employer requires.”** | Let the gap and uncertainty stay readable. Do **not** present the result as a recommendation or eligibility approval. |
| S04 · 40–56 s · Evidence, not optimism | Open **Career Evidence**. Show real seeded scheduling, referral coordination, insurance verification, backlog improvement and BLS records | **“Instead of guessing, Jordan checks the record: scheduling, referrals, insurance work, and a problem solved at the clinic. Real experience, with limits worth knowing.”** | Use only fixture-backed claims; do not imply a confirmed Epic skill. |
| S05 · 56–75 s · Honest materials | Return to role → **Prepare resume** → Create truthful draft → show **Truth Gate passed** and **Export verified PDF** | **“With those facts, Sojourner prepares a resume for this opportunity. Its truth check helps keep unverified experience out. Jordan can put a stronger application together without making things up.”** | Show the gate visibly, then PDF result. Truth Gate verifies supported claims, not hiring eligibility or external truth. |
| S06 · 75–91 s · User agency | Open Applications; show the tracked fictional job and linked resume. If recording status as **Applied**, establish that it represents **Jordan's own action outside the app**, never an app submission. Consider keeping Interested if real user submission is not represented | **“The decision stays Jordan's. Sojourner keeps the opportunity, the resume, and the next step in one place. It doesn't apply to employers on Jordan's behalf.”** | Do not show an Applied change in isolation as if clicking submitted anything. Add on-screen “Status recorded by user · demo data”. |
| S07 · 91–103 s · Payoff | Hold on clear organized Applications view with role, tracked status and linked PDF, or a quick honest recap of career → gap → resume → next step | **“A clearer direction. An honest assessment. And one next step that Jordan chose deliberately.”** | This is the emotional payoff. Let music resolve instead of restarting a cue. |
| S08 · 103–109 s · Identity | Approved Sojourner icon/wordmark + accurate **Windows Alpha** download reference; PWA as ongoing secondary option if included | **“Sojourner. Make the next move count.”** | Prompt tagline directly after the end card appears; no 3-second dead air. |

**Approximate spoken words:** ~180. Do a voice-generation pacing test; reduce rather than speed-read if scenes need time. Timing will be confirmed in actual frame review. Narration is intended to fit the shot, not describe controls a viewer can already read.

## Narration and music cue specification for Sonic Rift

Create **one consistent narrator identity** and save it under the production profile, with all scene lines separately exported as lossless WAV files: `VO_S01.wav` through `VO_S08.wav`, and an optional shared brand sting. Aim for warm, quietly assured North American English at natural conversational speed; do not imitate any specific real person's voice. Stable tone and identical voice across scenes matter more than dramatic acting.

Music: one restrained original instrumental cue, not unrelated tracks each page. A gentle pulse that becomes more hopeful when Jordan has a defensible plan, with quiet piano / soft strings / airy texture and no vocals. Use Sonic Rift's real Music tool; keep the exact selected WAV and full model/license/seed/provenance. **Do not assume seed determinism.** Mix beneath narration, with dialogue intelligibility and no arbitrary fade/restart at scene boundaries. Soft opening, restrained tension at the Epic evidence gap, slight lift at Truth Gate, satisfying ending. Generate SFX only if they improve a transition; default to none.

Mandatory production checks: listen to narration and music in context, watch fully from start to finish, measure loudness and peak, use smooth music transitions, make no live-autosubmit/hiring promises, maintain real UI legibility. Keep WAV narration/music/effects stems separately. Captions derive from the final mixed cut, not from estimated scene timings.

## Source assets, screenshots and fixture

- Existing fictional fixture: `scripts/demo/fixture.ts` (Jordan Ellis, target Practice operations, Harbor Health listing). **The listing is locally routed demo data, not a live opening.**
- Existing capture scaffolding: `scripts/demo/story.spec.ts`, `scripts/demo/ready.ts`, `scripts/demo/screenshots.spec.ts`. These capture the **PWA** and are reference-only when the new film claims **Windows Alpha**. Adapt/port the capture carefully to the actual signed Windows installer; avoid fake Electron screenshots or browser app presented as installed Windows.
- Approved old reference visuals and manifest: `docs/marketing/SOJOURNER_MEDIA_HANDOFF.md`; the existing historical film is silent.
- Sojourner product icon: `public/ICON.png` and approved brand source; use unchanged. The MythologIQ shared silver mark is referenced from `Knapp-Kevin/MythologIQ`, exact source must match user-approved reference before publishing.
- If the release-bundled UI differs, inspect app, update selectors and scene language **before** final capture. No unseen feature claims.

## Important story truth gates

1. **Epic EHR remains a missing requirement** in the fictional listing; Truth Gate passing the draft never means Jordan meets every employer requirement. Tell the truth. The narrative does not say Jordan is guaranteed eligible.
2. **Applied is a user-maintained status, not application submission.** If recording the transition, explain the fictional off-app action or show an Interested stage and planned next step instead. Do not portray submitting or tracking a real employer response.
3. Fictional listing is not sourced live. No job feed, background monitoring, automatic applications or hiring guarantees.
4. Career evidence is demo fixture data, not employment verification by a third party.
5. Do not advertise Windows-native capabilities based only on PWA capture. Use release-aligned package evidence. PWA development can be named as an alternative but need not be demonstrated.
6. Any footage, logos, images, captures or audio clips must be real / approved and rights documented. Claude records and edits; Sonic Rift produces audio; neither is tasked to fabricate artwork.

## Before Claude begins final recording

- [ ] Owner approves the **full spoken script**, storyboard and tone.
- [ ] Current signed Windows release build and exact installer SHA/branch are documented; real app rehearsal proves all scenes in disposable demo data.
- [ ] Fixture is safe and reproducible on **the installed Windows app**; no private user records, credentials or real accounts.
- [ ] Actual brand-logo master and wordmark approved; otherwise film remains **private** with visible temporary label.
- [ ] Sonic Rift voice sample and music cue approved before public publication. Internal first cut may be produced for owner review without publishing.
- [ ] No obsolete “PWA only” or “distribution pending” language.

## Output contract

Owner-review MP4, silent-captioned version, original voice/music WAVs, stems, WebVTT, transcript, real screenshots/poster, FFmpeg/edit decision list, SHA-256 manifest and QA report. Preserve approved older assets. Use an isolated branch with `[skip ci]` and provide the owner a **tested clickable link** to the actual review video or explicitly say if it is local-only. No release, merge, Netlify deployment or website publishing without separate authorization.
