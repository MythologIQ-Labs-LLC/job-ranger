# Job Ranger Brand Guide

This directory contains Job Ranger's public-facing brand assets. The goal is consistency, not an expanding collection of almost-the-same PNGs wandering around the repository unsupervised.

## Canonical Assets

### Runtime icon

`public/ICON.png`

This is the canonical application icon and is part of the packaging/runtime path. Windows packaging uses it directly, and the macOS release workflow derives `build/icon.icns` from it.

Do not replace this file casually. A runtime icon change should be visually reviewed at small sizes and validated through packaging before release.

### Favicon

`public/favicon.png`

The current favicon uses the same visual source as the runtime icon.

### Brand lockup

`docs/assets/branding/job-ranger-logo.png`

Use for documentation or presentation contexts that need the Job Ranger name and brand mark together.

### README banner

`docs/assets/branding/job-ranger-banner.png`

This is the canonical wide repository banner and should remain at the top of the root `README.md`.

### Social preview

`docs/assets/branding/job-ranger-social-preview.png`

Use as the repository's GitHub social-preview image and for link-sharing contexts where a wide preview card is appropriate.

GitHub's repository social preview is configured separately in repository settings; committing this file does not automatically set that UI-level property.

## Brand Direction

Job Ranger's visual language is built around navigation, exploration, trails, mountains, and forward movement. The product should feel capable and approachable rather than technical for its own sake.

The current visual palette uses dark navy, teal/green, warm orange, cream, and natural landscape tones. New assets should remain compatible with that family rather than introducing unrelated AI-neon or enterprise-dashboard aesthetics.

## Default-theme relationship to the approved logo

**The brand mark is authoritative; the Atelier theme is its supporting visual system.** The Studio Side Projects page currently references the approved artwork in `Knapp-Kevin/MythologIQ/public/assets/side-projects/job-ranger.png`. Copy that first-party image to `public/ICON.png` and propagate it to the favicon and generated PWA/Store icons through the separate, validated branding task. The live runtime must not fetch Studio assets over the network.

Atelier is the default and currently applies a **60/30/10 visual hierarchy**: approximately 60% warm ivory (`#F6F3EB`) in the canvas and panels, 30% slate-blue (`#1F3144`) for the navigation/structural frame, and 10% deep teal (`#086B70`) for primary interactions. Brighter teal (`#22A79D`) is for sparing accent details. This is a design *proportion*, not an assertion that those exact percentages of rendered pixels have been measured.

**Acceptance still pending:** Compare the approved Studio PNG itself against this palette visually and, where practical, sample its prominent colors from the unmodified original image. Confirm the slate and teal correspond to the mark's actual hues and contrast in the app at icon sizes (16, 32, 44 and 192 pixels). The current colors were selected to *harmonize* with the stated navy/teal/cream brand family, **not yet verified as exact pixels extracted from the image**. If the inspected original differs, refine Atelier's token values in both `src/theme/ThemeProvider.tsx` and the `:root` fallback in `src/index.css`, then rerun palette/contrast and browser checks. Never repaint, stretch, or regenerate the established logo to make it fit a temporary theme.

Midnight and Canopy remain independent optional themes. Semantic success/warning/danger/info colors must retain their meaning and pass contrast checks even when they depart from the 60/30/10 accents.

## Naming

Use lowercase kebab-case for documentation assets:

```text
job-ranger-logo.png
job-ranger-banner.png
job-ranger-social-preview.png
```

Platform/runtime assets may keep the naming required by packaging tools, including `public/ICON.png` and generated `build/icon.icns`.

## Usage Rules

- Preserve the mark's aspect ratio.
- Do not stretch the icon or wordmark.
- Keep text legible against the background at repository and social-preview sizes.
- Prefer the banner for README presentation and the social-preview file for link cards.
- Do not use generated mock UI as evidence that a feature is already shipped.
- Do not replace the runtime icon merely to match a temporary campaign graphic.

## Source of Truth

The brand asset hierarchy is:

1. `public/ICON.png` for the application icon.
2. `docs/assets/branding/job-ranger-logo.png` for the public lockup.
3. `docs/assets/branding/job-ranger-banner.png` for repository presentation.
4. `docs/assets/branding/job-ranger-social-preview.png` for social/link previews.

If another copy appears elsewhere in the repository, consolidate it back into this structure rather than creating another canonical candidate.


## Trademark and Distribution Identity

The repository's license, AGPL-3.0-only for development after v1.2.0, governs the licensed software and documentation (see [`LICENSE_HISTORY.md`](../LICENSE_HISTORY.md); v1.2.0 and earlier keep their MIT grants). It does not grant trademark rights or make third-party builds official Job Ranger distributions.

For naming, fork branding, and official-distribution identity, see [`TRADEMARKS.md`](../TRADEMARKS.md).
