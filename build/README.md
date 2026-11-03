# Build Assets

This directory contains build-time resources for Sojourner. Public branding assets live under `docs/assets/branding/`; runtime static assets live under `public/`.

## Canonical Application Icon

The canonical source image is:

```text
public/ICON.png
```

Do not maintain independent platform icons by hand unless the packaging workflow requires it. Keeping one canonical source prevents platform assets from quietly becoming different brands.

## Windows

`electron-builder.json` points Windows packaging directly at:

```text
public/ICON.png
```

Current configured Windows targets include NSIS and portable output. The release workflow currently uploads the generated Windows executable, blockmap, and `latest.yml` artifacts.

## macOS

The macOS release workflow derives:

```text
build/icon.icns
```

from `public/ICON.png` using `sips` and `iconutil` on the macOS runner before invoking Electron Builder.

The committed macOS entitlement configuration is:

```text
build/entitlements.mac.plist
```

Signing and notarization behavior depends on the Apple credentials available to the release workflow.

## Consumer Branding

Repository/presentation assets do **not** belong in this directory. Use:

```text
docs/assets/branding/sojourner-banner.png
```

`docs/assets/branding/sojourner-icon-source.png` (the original lockup, still carrying the earlier Job Ranger wordmark) is the source of the app emblem (see `scripts/extract-sojourner-icon.sh`). `docs/assets/branding/historical/` keeps the earlier banner and social preview for provenance only.

See `docs/BRANDING.md` for the canonical asset map.

## Validation

Relevant commands:

```bash
npm run repo:health
npm run electron:build:win
npm run electron:build:mac
npm run electron:pack
```

A successful local or CI build validates that build path under the environment where it ran. It does not prove that signing, notarization, installers, or runtime behavior are correct on every target platform. Release artifacts should be smoke-tested before being represented as production-ready downloads.
