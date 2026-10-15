# Job Ranger Brand Guide

This directory contains Job Ranger's public-facing brand assets. The goal is consistency, not an expanding collection of almost-the-same PNGs wandering around the repository unsupervised.

## Canonical Assets

### Approved mark and runtime icon

The approved Job Ranger mark shown on the MythologIQ Studio Side Projects page is the exact first-party PNG at:

`Knapp-Kevin/MythologIQ/public/assets/side-projects/job-ranger.png`

It is the **design reference** for the icon. `public/ICON.png` is the local **runtime source** and must be an exact copy of that reviewed Studio mark, not a separately redrawn or AI-generated variant. `tests/branding-runtime-assets.test.mjs` pins the accepted Studio blob until a deliberate brand revision. Do not pull the artwork remotely at runtime: Job Ranger must remain usable offline.

The sidebar now displays `public/ICON.png` in place of the generic briefcase. The favicon is the same source image, at `public/favicon.png`.

After updating `public/ICON.png`, regenerate and commit `public/pwa/*` and `build/appx/*` using `scripts/generate-distribution-icons.sh` or equivalent dimension-identical local tooling. The Microsoft Store icon and historical macOS packaging derive from the runtime image. Validate appearance at 16–44 px, maskable safe area, dark/light navigation surfaces, and installed-PWA and Store launch icons. Do not silently relabel a wordmark/banner as a square app mark.

### Favicon

`public/favicon.png`

This must be byte-identical to `public/ICON.png`. The web and Electron HTML entrypoints already point at it. A mere HTML link change does not update the pixels or the installed PWA icon. Browser caches may retain the old favicon until the updated shell/assets are installed.

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

1. Approved Studio Side Projects mark for design identity; local `public/ICON.png` for the app runtime, PWA and distribution icon generation.
2. `docs/assets/branding/job-ranger-logo.png` for the public lockup.
3. `docs/assets/branding/job-ranger-banner.png` for repository presentation.
4. `docs/assets/branding/job-ranger-social-preview.png` for social/link previews.

If another copy appears elsewhere in the repository, consolidate it back into this structure rather than creating another canonical candidate.


## Trademark and Distribution Identity

The repository's license, AGPL-3.0-only for development after v1.2.0, governs the licensed software and documentation (see [`LICENSE_HISTORY.md`](../LICENSE_HISTORY.md); v1.2.0 and earlier keep their MIT grants). It does not grant trademark rights or make third-party builds official Job Ranger distributions.

For naming, fork branding, and official-distribution identity, see [`TRADEMARKS.md`](../TRADEMARKS.md).
