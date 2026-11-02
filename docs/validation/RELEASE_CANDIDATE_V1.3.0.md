# Job Ranger v1.3.0 Release Candidate Evidence (historical native candidate)

> **SUPERSEDED release scope (2026-10-16).** This October 6 candidate and its native Store/installer checklists reflect an obsolete product distribution decision. See [Canonical Architecture Index](../ARCHITECTURE_INDEX.md), ARCH-001–003. Future product distribution is PWA-only; this document is historical validation evidence, **not** an active native v1.3.0 release gate. Do not rename historical findings as completed web acceptance.


**Status:** candidate preparation; no packaged candidate tag yet
**Target version:** v1.3.0
**Published predecessor:** v1.2.0 (`71f9b790a1f456321aee2c783f39f4a6784b83a9`)
**Pre-tag validation commit:** `70e41b49838faeb1d5219a0837f855d957650b1f` (`main` before the version bump)
**Validation date:** 2026-10-06

This record follows [`../RELEASE_READINESS.md`](../RELEASE_READINESS.md). It is updated as packaged candidates (`v1.3.0-rc.N`) are built. Nothing here is shipped until a v1.3.0 GitHub Release is published.

## Scope decision

v1.3.0 is the selected next version: a backward-compatible minor release. No database migration was added after v1.2.0, and data written by v1.2.0 opens unchanged (see *Upgrade evidence*).

Included:

- the accepted distribution architecture (#125, #130, implemented in PR #142):
  - the local-first web/PWA runtime on the shared core;
  - Microsoft Store (AppX) packaging;
  - portable `.jobranger` archives between runtimes;
- non-Latin resume PDFs in the web runtime and a Unicode-aware Parseability Gate (#144);
- a script-aware Truth Gate unsupported-edit check that also counts single digits (#143);
- localhost self-hosting as the pre-demand web path: `npm run selfhost:pwa` at `http://localhost:4174` (#145, #147, #149);
- the schema downgrade guard, backup-validation hardening, Greenhouse content unescaping, and the idle scrape-queue fix;
- the AGPL-3.0-only license for development after v1.2.0 (v1.2.0 and earlier keep their MIT grants);
- dependency and security maintenance (#138, and the `shell-quote` override in #152);
- the automated upgrade check from the latest published release (#153).

The full list is the `v1.3.0` entry in [`../../CHANGELOG.md`](../../CHANGELOG.md).

## Outside v1.3.0

- Additional discovery providers (Himalayas, We Work Remotely; #136). These are post-v1.3 feature work.
- A public production web origin. It is deferred until external distribution is justified; localhost self-hosting is the supported path.
- Firefox and Safari support, and real-device installability for the web app (#130). These are not yet validated.
- Microsoft Store certification and listing (#125). These are external; the candidate builds the Store package with a validation identity until the Partner Center identity is configured.
- Right-to-left and Indic resume PDFs in the web runtime. These are a documented limitation; the Windows app serves them.

## Pre-tag validation (2026-10-06)

The local suite runs were on `main` at `09062fd`, before PRs #152, #138 and #153. The upgrade check ran locally on `1296c1b`, whose tree is identical to `70e41b4`. Hosted CI ran again on every later merge. Environment: Linux container, Node.js 22.22.0, Chromium 1194.

| Check | Result |
| --- | --- |
| `npm ci`, `npm run typecheck`, `npm run build`, `npm run build:pwa` | pass |
| `npm run test`, `npm run test:unit` | pass |
| Dependency audit gate (`scripts/audit-dependencies.mjs`) | pass after #152 (critical `shell-quote` advisory GHSA-pqg4-j6r4-53mv overridden) |
| Electron E2E (`npm run test:e2e`) | 31/31 |
| Web browser suite (`playwright.pwa.config.ts`, Chromium) | 12/12 |
| Web parser benchmark | 9/9 |
| Upgrade from v1.2.0 (`npm run test:release-upgrade`) | pass: 9 v1.2.0-written data directories, 6 backed up and restored |
| Electron `webPreferences` (main, scraper, resume renderer) | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` |
| Documentation drift audit (§2, §6) | defects fixed in #152; current-doc links resolve |

Hosted CI on `main` at `70e41b4` was green: `repository-health` and `release-upgrade`.

## Upgrade evidence

`npm run test:release-upgrade` (CI job `release-upgrade`):

1. Builds `v1.2.0` and writes data with that release's own package smoke and eight feature smokes. Together they cover core migrations 1–9 and feature migrations 1001–1004.
2. Opens every directory with the candidate. No pre-existing table changed (settings compare by key and value; startup re-saves `updated_at`).
3. Confirms every migration is applied and that all read paths work.
4. Backs up and stage-restores into a fresh data root wherever v1.2.0 itself could back the directory up. The three exceptions are v1.2.0 test fixtures with synthetic artifact paths outside the data root, which v1.2.0's own backup also refuses.

A deliberate data-modifying change injected into the current build made the check fail and name the changed table.

## Remaining gates before stable v1.3.0

- [ ] Packaged candidate `v1.3.0-rc.N`: release, Store, and web workflows green, with assets, checksums, release manifests, attestations, and packaged-smoke evidence attached (§5, §7, §7a, §7b, §9).
- [ ] Microsoft Store: Partner Center identity and a submission build; then certification, a clean Windows 11 install, first launch, and a Store upgrade (§7a). This gates promoting the Store channel, not tagging candidates.
- [ ] Web: the browser/platform matrix from real validation (Firefox, Safari, real devices) before promoting the web channel (§7b).
- [ ] Direct-download NSIS installer: either labelled tester-only (unsigned) or signed and clean-machine validated (§7, §10).
- [ ] Release notes, README download links, and SYSTEM_STATE are updated only after publication (§11).

## Packaged candidate history

None yet. Each `v1.3.0-rc.N` tag is immutable once pushed; later fixes go into a new rc tag.
