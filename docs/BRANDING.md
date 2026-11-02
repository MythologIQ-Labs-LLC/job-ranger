# Sojourner Brand Transition: Legacy Job Ranger Asset Inventory

**Owner-selected identity (2026-10-28): Sojourner: Employment Toolkit.** See [the canonical architecture index](./ARCHITECTURE_INDEX.md) and [brand migration issue #339](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/339). The assets catalogued below still represent the **historical Job Ranger presentation**. They are not automatically approved as Sojourner brand art and must be reviewed or replaced coherently before a public rebrand. Keep legacy names for compatibility, history and accurate reference until migration is qualified.

The goal is one coherent source of brand assets, not competing ad-hoc variants. A visual change must not silently change runtime identifiers, browser storage origin, archive compatibility, application signing or OAuth configuration.

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

## Canonical standalone emblem and default-theme colors

The **approved source of truth is the emblem inside `docs/assets/branding/job-ranger-logo.png`**, specifically the circular mountain, forest and trail illustration to the left of the lettering. The owner supplied both an annotated preview (red circle indicating the selection) and a clean logo. The red circle is **not artwork**, and the wordmark/tagline must not appear in the square icon.

Use `scripts/extract-job-ranger-icon.sh` to crop the native emblem directly from the existing unmarked lockup, copy the resulting `public/ICON.png` to the favicon, and regenerate the PWA and AppX assets. The source image must remain unchanged. The app must load the local packaged icon even when offline.

The committed `public/ICON.png` and `public/favicon.png` are the owner-supplied 550×550 transparent extraction of this emblem, used byte-for-byte (SHA-256 `3c557f2dbe8273d97ce05e9aacf49ec51df68bdbd66d466feb1a11d664a28e4c`, October 2026). The repository lockup is 2172×724, not the 2048×682 reference the script checks, so the script stops by design rather than guess a crop. Re-extract only after reconciling that geometry. The PWA and AppX sizes were regenerated from `public/ICON.png` with the same sizes, padding and `#FDF1DD` backgrounds as `scripts/generate-distribution-icons.sh`, using a high-quality stepwise resampler, and were inspected at 16, 32, 44, 192 and 512px.

**Logo-derived reference colors** sampled from the approved clean 2048×682 lockup:
- Emblem navy (dark outline/mountains): approximately `#00182E`.
- Emblem trail-green (trees): approximately `#01896A`.
- Emblem cream (sky/rim): approximately `#FDF1DD`.
- Sunset orange (illustration only): approximately `#FD8101`.

Atelier remains a 60/30/10 **distribution guideline**, not measured per-pixel coverage: 60% parchment ivory canvas `#F6F3EB`; 30% emblem navy `#00182E` in navigation and structural hierarchy; and 10% teal in controls and restrained ornament. Main actionable teal `#00765F` is intentionally darker than the source-tree teal to give white text and ivory links WCAG AA contrast. The sampled `#01896A` is a decorative accent only, because white text on it does not meet a 4.5:1 contrast ratio. Orange belongs to the emblem/small branding details or semantic warnings, not a dominant button color.

The preexisting MythologIQ Studio Side Projects thumbnail is **not** the master for the emblem; reconcile that thumbnail to this approved extracted illustration instead of overriding the owner's choice. Maintain small-size readability and aspect ratio at 16, 32, 44, 192 and 512px. Validate actual PWA/Store packaging and theme/browser checks before any merge. Midnight and Canopy are intentionally independent alternate themes.


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

## Legacy Job Ranger Asset Source of Truth

Until a complete Sojourner visual identity is reviewed and implemented, the existing app and historic assets use this hierarchy:

1. `docs/assets/branding/job-ranger-logo.png` for the **authoritative emblem and full lockup**; extract only the circular emblem via `scripts/extract-job-ranger-icon.sh`.
2. `public/ICON.png` for the **derived canonical runtime icon**, with `public/favicon.png` and all installed-app/PWA icons generated from that exact image.
3. `docs/assets/branding/job-ranger-banner.png` for repository presentation.
4. `docs/assets/branding/job-ranger-social-preview.png` for social/link previews.

If another copy appears elsewhere in the repository, consolidate it back into this structure rather than creating another canonical candidate.


## Trademark and Distribution Identity

The repository's license, AGPL-3.0-only for development after v1.2.0, governs the licensed software and documentation (see [`LICENSE_HISTORY.md`](../LICENSE_HISTORY.md); v1.2.0 and earlier keep their MIT grants). It does not grant trademark rights or make third-party builds official Job Ranger distributions.

For naming, fork branding, and official-distribution identity, see [`TRADEMARKS.md`](../TRADEMARKS.md).
