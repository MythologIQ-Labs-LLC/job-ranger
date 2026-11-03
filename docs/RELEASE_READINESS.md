# Release Readiness Contract

> **CURRENT ARCHITECTURE (2026-11-02):** [Canonical Architecture Index](./ARCHITECTURE_INDEX.md) governs product distribution. **ARCH-001: the signed Windows installer is the primary deliverable, and the PWA continues as the cross-environment channel.** Windows releases follow [Current Windows release acceptance](#current-windows-release-acceptance-v100-alpha1) and section 7; PWA releases follow [Current PWA release acceptance](#current-pwa-release-acceptance-pwa-publication-only). Microsoft Store and native macOS checklists remain historical or engineering-test procedures, never release blockers, and no Windows signing or installer check may be demanded for a PWA-only publication.


This document defines the minimum evidence required before Sojourner (historically Job Ranger) publishes a new user-installable release.

A merged `main` branch is **not** a release. A passing unit test is **not** a release. Electron Builder being configured for a platform is **not** a release. A release exists only when an immutable version/tag has been validated and published with the artifacts users are actually expected to run.

## Status authority

- **Published GitHub Release**: authority for what users can download.
- **Immutable release tag**: authority for the source used to build a release.
- **`main`**: authority for current merged development, which may be ahead of the published product.
- **Documentation on `main`**: must describe both boundaries honestly.

**No Sojourner release is published yet.** The first is `v1.0.0-alpha.1` (a GitHub pre-release). The last published Job Ranger release was **v1.2.0** (`71f9b790a1f456321aee2c783f39f4a6784b83a9`, promoted byte-for-byte from rc.5). On 2026-11-02 the owner removed all 12 Job Ranger GitHub Releases and renamed their tags to `job-ranger-v*` on the same commits (`job-ranger-v1.2.0`); Sojourner is a separate product line whose tags are `v*`.

Channels under [ARCH-001–003](./ARCHITECTURE_INDEX.md):

- **Primary:** the signed Windows NSIS installer `Sojourner-v<version>-windows-x64.exe`. Every published Windows installer is Authenticode-signed by `MythologIQ Labs, LLC`.
- **Continuing:** the web/PWA. For PWA releases, qualify the actual HTTPS origin, browser workflows, data isolation, persistence, build identity, CSP/headers, and service-worker safety.
- **Not shipping channels:** the Microsoft Store package (manual engineering builds only) and native macOS and Linux packages.

## Current Windows release acceptance (v1.0.0-alpha.1)

The gate for tagging and publishing `v1.0.0-alpha.1` (#363, #339). It applies section 7 to this release. Record the evidence in the release's validation record (see [Evidence record](#evidence-record)).

### Candidate identification
- [ ] `package.json` and the top-level `package-lock.json` entries are `1.0.0-alpha.1`; the tag is `v1.0.0-alpha.1` on the reviewed `main` commit, and that commit is recorded.
- [ ] `electron-builder.json` uses `appId` `com.mythologiq.sojourner`, `nsis.deleteAppDataOnUninstall: false` and `nsis.include` `build/installer.nsh` (removes a legacy Job Ranger install, appId `com.jobranger.app`, keeping its data; `tests/nsis-legacy-uninstall.test.cjs`), names the product `Sojourner`, and carries `Copyright © 2026 MythologIQ Labs, LLC`.
- [ ] The CHANGELOG `1.0.0-alpha.1` section describes only what is on the tagged commit (Windows Drive export #369 and storage locations #370 are on `main` since 2026-11-02).
- [ ] Local gates pass on the tagged commit: `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:pwa:e2e`, `npm run test:release-upgrade` (baseline `job-ranger-v1.2.0`).

### Build, package and smoke (section 7)
- [ ] The tag push runs `release-build.yml`; the owner approves the `release` environment. No Microsoft Store job runs on the tag push.
- [ ] The installer is `release/Sojourner-v1.0.0-alpha.1-windows-x64.exe`, and the unpacked app is `release/win-unpacked/Sojourner.exe` with `resources/sqlite3.exe`.
- [ ] Packaged SQLite resolution selects the bundled `sqlite3.exe` with `SQLITE3_PATH` removed.
- [ ] `scripts/run-packaged-smoke-windows.ps1` passes: `windows-package-smoke.json` reports `passed` for the healthcare scenario with app version `1.0.0-alpha.1`.

### Signing verification (ARCH-006)
- [ ] `scripts/verify-windows-distribution.ps1 -RequireSigned` passes for `Sojourner.exe`, `resources/elevate.exe`, `resources/sqlite3.exe` and the installer: every one passes `signtool verify /pa`, has a `Valid` Authenticode status, signer subject `CN="MythologIQ Labs, LLC"`, and a timestamp.
- [ ] `windows-signing.json` (with `requireSigned: true`), `windows-SHA256SUMS.txt` and `windows-release-manifest.json` (`publicRelease: true`) are attached, and `gh attestation verify Sojourner-v1.0.0-alpha.1-windows-x64.exe --repo MythologIQ-Labs-LLC/sojourner` passes.
- [ ] The installer is only called "signed" in release notes or docs after the above evidence exists.

### Upgrade from Job Ranger v1.2.0 data
- [ ] Automated: `npm run test:release-upgrade` passes from `job-ranger-v1.2.0` (every baseline data folder is migrated by the start-up migration into a `Sojourner` folder with all records and the legacy folder unchanged, then opens, migrations apply, backups restore). `tests/legacy-migration.test.cjs` covers every migration branch, including fallback to the legacy folder.
- [ ] On a Windows machine with Job Ranger v1.2.0 installed and real-looking data in `%APPDATA%\job-ranger`: create a `.jobranger` backup, run the Sojourner installer, and confirm the installer removed Job Ranger (one entry, "Sojourner", in Installed apps; no "Job Ranger" shortcuts or executable remain).
- [ ] First launch of Sojourner shows the existing Career Profile, Career Evidence, Target Tracks, applications and resumes; Settings → This installation reports the data location `%APPDATA%\Sojourner`; `%APPDATA%\job-ranger` is unchanged and holds `MIGRATED-TO-SOJOURNER.txt`.
- [ ] Uninstalling Sojourner leaves `%APPDATA%\Sojourner` in place; reinstalling opens the same data.
- [ ] A clean-machine install (no Sojourner) launches normally, and SmartScreen / Smart App Control behavior is recorded (section 10).

### Publication (section 11)
- [ ] The GitHub Release is titled "Sojourner v1.0.0-alpha.1" and is marked **pre-release** (the workflow does this for `-alpha`, `-beta` and `-rc.` tags).
- [ ] README "Get Sojourner" and `docs/SYSTEM_STATE.md` say the release exists only after the assets are uploaded and verified.

## Current PWA release acceptance (PWA publication only)

This section governs publication of the **web app (PWA)** and the Studio-linked demo; it was first adopted on 2026-10-16 and its scope was narrowed on 2026-11-02 when [ARCH-001](./ARCHITECTURE_INDEX.md) made the signed Windows installer the primary release. It does **not** replace or relax the Windows release gates: a Windows release must pass [Current Windows release acceptance](#current-windows-release-acceptance-v100-alpha1) and section 7, including signing verification. In the other direction, Windows installer, signing, Store and notarization checks MUST NOT be required for a PWA-only or Studio demo publication.

### PWA candidate identification
- [ ] State exactly whether the candidate is a **bounded Studio-linked demonstration**, a fuller PWA public release, or an internal staging preview; distinguish deliberately excluded capabilities in public copy and UI.
- [ ] Pin a source commit, production build ID, generated asset manifest, tested HTTPS origin, and rollback build.
- [ ] Keep the production Studio site unchanged unless separately approved; a GitHub merge is never implicit hosting or link-publication authorization.

### Browser and real-user behavior
- [ ] Production PWA build, integrity verification, and browser E2E run against **that exact candidate**, not only against development mode or a synthetic fixture.
- [ ] Prove real onboarding, Career Evidence, Target Tracks, Find Jobs assessments, document generation, and applicable application lifecycle workflows for the advertised scope.
- [ ] Verify fresh browser profile, reload, close/reopen, service-worker upgrade, stale cache, offline behavior (where advertised), data export/restore and failure recovery.
- [ ] Verify supported desktop/mobile viewports and browsers or explicitly document unsupported combinations.

### Privacy and demo boundaries
- [ ] Demo workspace starts from clearly fictional data, isolates separate visitor sessions and browser profiles, marks sample job openings as non-live, and prevents sample links from initiating real applications.
- [ ] Demo reset does not accidentally erase non-demo records, and no demo identity, history, or cached workspace crosses visitors.
- [ ] Hosting does not collect or forward sensitive career information without deliberate user authorization and accurate notices.
- [ ] Native-only code paths and features (including Electron Google Drive OAuth, background closed-browser monitoring, accounts/sync) are absent, disabled, or honestly explained in the hosted demo; do not substitute a fake success path.

### Deployment and governance
- [ ] Check exact build identity, cryptographic asset hashes, CSP and security headers, HTTPS origin, service-worker identity, navigation policy and staging/production separation.
- [ ] Validate browser storage scope, same-origin isolation and update compatibility at the **real hosted preview URL**.
- [ ] Obtain an independent adversarial review of the candidate trust boundaries, resolve blocker/major findings and record precise evidence.
- [ ] Record deployment permissions and GitHub Actions budget; do not auto-publish from PR checks or development branches.
- [ ] Obtain distinct owner authorization for (a) staged hosting, (b) public PWA availability, and (c) changing the MythologIQ Studio link, as applicable.
- [ ] Record the live origin, deployed build identity, timestamp, acceptance outcome and rollback procedure only **after** the site has actually been verified.

**Do not treat an Electron installer build, Store package test, native trust verifier, or historical GitHub Release as evidence that any of the preceding PWA acceptance gates passed.**

## Historical native release verification and detailed release checklists

The numbered checklist below predates the 2026-11-02 decision. **Section 7 (Windows NSIS) is the current Windows release gate**, applied through [Current Windows release acceptance](#current-windows-release-acceptance-v100-alpha1); sections 7a (Microsoft Store) and 8 (macOS) are historical or engineering-test procedures and are never release blockers; none of it is a PWA publication gate.

## Release-blocking checklist

### 1. Scope and version

- [ ] The intended release scope is frozen.
- [ ] Every included pull request is merged to the candidate commit.
- [ ] No known release-blocking issue remains open.
- [ ] The target version has been deliberately selected.
- [ ] `package.json`, release notes, badges/download links, and generated artifact names agree on the selected version where applicable.
- [ ] The immutable candidate tag points to the exact validated commit.

Do not bump versions early merely to create the appearance of release progress.

### 2. Product truth and documentation

- [ ] `README.md` distinguishes shipped behavior from newer candidate/`main` behavior correctly.
- [ ] `HELP.md` matches the actual user interface and workflows in the candidate.
- [ ] `CHANGELOG.md` has a complete candidate entry derived from the `Unreleased` section.
- [ ] `docs/SYSTEM_STATE.md` matches the candidate architecture and capabilities.
- [ ] `docs/ARCHITECTURE_PLAN.md` matches the candidate service and trust boundaries.
- [ ] `docs/planning/PLAN.md` contains only genuine next/deferred work.
- [ ] `docs/README.md` correctly classifies current, design, validation, research, and historical documents.
- [ ] `SECURITY.md`, `GOVERNANCE.md`, and `THIRD_PARTY_NOTICES.md` remain accurate.
- [ ] User-visible limitations and deferrals are stated rather than hidden.

Documentation drift is a release blocker because users and contributors otherwise cannot tell what software they are evaluating.

### 3. Data and migration safety

- [ ] Upgrade from the latest published release is exercised against a representative existing data directory.
- [ ] All SQLite migrations apply successfully and idempotently.
- [ ] Career Profile, Career Evidence, Applications, source state, resume artifacts, lifecycle state, Career Stories, insights, and settings remain readable after upgrade.
- [ ] Managed artifact paths resolve after upgrade.
- [ ] Backup creation succeeds before destructive/manual migration testing.
- [ ] Backup validation detects tampering/corruption.
- [ ] Restore into a different data root is exercised and managed paths rebase correctly.
- [ ] A staged restore is not allowed to destroy the only known-good live copy before the restored database initializes successfully.

`npm run test:release-upgrade` automates the first five items against real data written by the latest published release. It runs in CI as the `release-upgrade` job; its report is `build/trust/release-upgrade-report.json`. The script checks the newest stable `vX.Y.Z` tag out into a temporary worktree, builds it, and runs that release's own package smoke and feature smokes to write data directories. It then opens each directory with the current build and verifies three things. First, no existing table changes; settings are compared by key and value, because startup re-saves timestamps. Second, every migration applies and the read paths work. Third, backup, staged restore into a different data root, and reopening succeed wherever the baseline release itself could back the directory up. Pass `--baseline <tag>` to check a different release. Representative data from real users or testers is still worth exercising by hand before stable publication.

### 4. Security and dependency review

- [ ] Current dependency audit is reviewed.
- [ ] Any vulnerability exception is narrow, documented, and limited to the exact dependency/path/risk that cannot yet be remediated.
- [ ] Renderer/main-process boundaries remain `nodeIntegration: false`, `contextIsolation: true`, and `webSecurity: true` where required.
- [ ] Main renderer sandboxing remains enabled.
- [ ] Specialized hidden browser/render surfaces retain their restricted settings.
- [ ] External navigation remains validated.
- [ ] Automated acquisition rejects loopback, link-local, and private-network destinations and binds approved hostname resolution to the actual connection so DNS rebinding cannot silently change the destination.
- [ ] Imported career documents remain untrusted input and do not silently trigger hosted OCR/inference.
- [ ] No new telemetry, sync, inference, credential, or cloud transmission exists without explicit governance and user disclosure.

### 5. Repository validation

An immutable release candidate needs explicit repository validation evidence.

Minimum repository validation:

```bash
npm ci
npm run typecheck
npm run build
npm run test
npm run test:unit
npm run test:e2e
npm run test:release-upgrade
```

`npm run repo:health` may be used as the combined type/build/backend gate. Do not claim a command passed if the environment could not execute it.

For documentation-only remediation, code tests may reuse fresh evidence from the unchanged executable candidate commit, but documentation-specific validation must still be performed.

### 6. Documentation validation

- [ ] Markdown links among current source-of-truth documents resolve.
- [ ] No current document describes completed work as planned.
- [ ] No current document claims unreleased candidate/`main` functionality is shipped.
- [ ] References to issues/PRs use the correct completion state.
- [ ] No current document points users to removed runtime files or obsolete commands.
- [ ] Historical plans are unmistakably historical from the documentation index.
- [ ] Screens/workspace names in HELP match current navigation.

### 7. Windows direct-download (NSIS) package validation — primary channel (ARCH-001)

- [ ] Build from the immutable release tag on the supported Windows builder.
- [ ] NSIS x64 installer is produced with the expected versioned filename.
- [ ] Official pinned SQLite CLI archive is downloaded and its published SHA3-256 verified.
- [ ] Packaged `resources/sqlite3.exe` exists and executes.
- [ ] With `SQLITE3_PATH` removed, runtime resolution selects the packaged SQLite binary.
- [ ] Generated `electron-runtime` entry point exists in the packaged application.
- [ ] The packaged `Sojourner.exe` (Job Ranger releases: `Job Ranger.exe`) executes the headless package-smoke harness from its own `app.asar` using an isolated data root.
- [ ] `windows-package-smoke.json` reports `passed` for the required non-software scenario and is included in release evidence.
- [ ] The Windows trust verifier executes successfully in the native release runner.
- [ ] Installer launch/upgrade is exercised on a clean supported Windows system before stable publication.
- [ ] Existing user data survives installer upgrade, including an upgrade from Job Ranger v1.2.0 (legacy data folder `%APPDATA%\job-ranger`, migrated to `%APPDATA%\Sojourner` by `electron/src/legacy-migration.cts`).
- [ ] Every published installer carries valid, timestamped Authenticode signatures by `MythologIQ Labs, LLC` (`verify-windows-distribution.ps1 -RequireSigned`), and observed SmartScreen / Smart App Control behavior is recorded on a clean supported machine. Only build-only candidates are unsigned; their release manifest marks them `testerOnly`.
- [ ] A GitHub artifact attestation exists for the installer.

### 7a. Microsoft Store package validation (supported Windows channel)

Design and procedure: [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md).

- [ ] `windows-store-package` workflow passed for the release commit:
  - `windows-store-package.json`: identity, version, capabilities exactly `runFullTrust` + `internetClient`, no extensions, canonical assets, bundled `sqlite3.exe`;
  - `windows-store-package-smoke.json`: in-package healthcare Career Ops smoke, `windowsStore: true`, isolated data root, native DOCX resume import, Chromium PDF and native parseability, archive round trip;
  - `windows-store-install.json`: data in package storage, no leak into `%APPDATA%`, historical NSIS data unchanged, uninstall behavior.
- [ ] Partner Center identity variables are configured and the submission package was built with `SOJOURNER_REQUIRE_STORE_IDENTITY=1`.
- [ ] The `.appx`, its checksums, `windows-store-release-manifest.json`, and its artifact attestation are attached to the release.
- [ ] Partner Center certification passed (record the submission ID).
- [ ] A clean supported Windows 11 install from the Store listing, first launch, an upgrade from an earlier Store version, and backup/restore are recorded.
- [ ] README/HELP direct Windows users to the Store **only after** the listing is live.

### 7b. Web/PWA validation (supported cross-platform channel)

Design and procedure: [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md).

- [ ] The `pwa` workflow passed for the release commit: production build, web-parser benchmark, and the browser suite (Career Ops end to end, Electron↔PWA portability, rejected backups, offline shell, verified/rejected updates, quota failure, tab lock).
- [ ] `sojourner-web-v<version>.zip`, `web-build-info.json` (build ID, commit, CSP, asset hashes), the browser-suite report, checksums, the release manifest, and the artifact attestation are attached to the release.
- [ ] Deployment uses `deploy-pwa.yml` from the attested archive (no rebuild), behind the protected `production-web` environment, to an HTTPS origin that serves the shipped `_headers`.
- [ ] The post-deploy check confirms the live build ID and security headers.
- [ ] The browser/platform matrix is recorded from real validation: Chromium-based browsers on Windows, macOS, and Linux; Firefox; Safari, including install/standalone behavior where supported.
- [ ] Storage persistence and eviction guidance, and known web limitations, are visible in the app and HELP.
- [ ] README/HELP link the production origin **only after** it is live.

### 8. macOS package validation (historical/manual only)

Native macOS distribution is not part of the forward architecture. The release workflow builds macOS packages only on explicit manual dispatch. The checklist below applies only if such a build is published:

For both x64 and arm64:

- [ ] Build from the immutable release tag.
- [ ] Expected DMG/ZIP artifacts are produced.
- [ ] Generated Electron runtime entry point is present.
- [ ] Both packaged executable architectures are verified from the unpacked build output.
- [ ] The native hosted-runner packaged executable executes the headless package-smoke harness from its own `app.asar` using an isolated data root.
- [ ] `macos-package-smoke.json` reports `passed` for the required non-software scenario and is included in release evidence.
- [ ] SQLite resolution works in the packaged application.
- [ ] The macOS trust verifier executes successfully in the native release runner.
- [ ] A stable public release is Developer ID signed, notarized, stapled, and passes `codesign`, `spctl`, and stapler verification.
- [ ] The signed/notarized application launches on a clean supported macOS system under Gatekeeper before stable publication.

### 9. Product smoke validation

Release automation must exercise a deterministic packaged consumer spine using a materially non-software scenario. The package-smoke harness validates:

1. fresh isolated local data initialization;
2. Career Profile creation;
3. Target Track creation;
4. user-authored Career Evidence;
5. pasted evidence/source-artifact persistence;
6. employer and filter persistence;
7. preserved full job-source snapshot;
8. requirement extraction/evidence coverage;
9. application tracking/status persistence;
10. JSON Resume export;
11. backup creation and validation;
12. persistence counts after the workflow completes.

This hosted packaged smoke is release-blocking and its machine-readable report must exist before the release manifest can be generated.

It does **not** replace final clean-machine acceptance for behavior that depends on the operating system's trust/user-interaction layer. Before stable publication, record real installation/launch behavior for the signed Windows build and the signed/notarized macOS build. Human UI acceptance may reuse current Electron E2E evidence where the candidate UI code is unchanged, but any candidate-specific UI defect or installer interaction must be exercised directly.

### 10. Clean-machine public trust validation

The supported channels must be tested as ordinary users receive them:
- **Microsoft Store:** a Store-delivered install on a clean supported Windows 11 system (see 7a).
- **Web app:** the production origin in real browsers (see 7b).

The evidence below applies to directly downloaded native binaries that are promoted as ordinary-user channels.

Windows evidence must include:

- artifact SHA-256 and valid Authenticode result;
- signer subject/issuer;
- Windows version/architecture;
- SmartScreen / Smart App Control state and observed behavior;
- normal install result;
- normal first-launch result.

macOS evidence must include:

- artifact SHA-256;
- `codesign --verify --deep --strict` result;
- Gatekeeper `spctl` assessment;
- stapler validation;
- macOS version/build/architecture;
- normal install and first-launch result under Gatekeeper.

Use `docs/CLEAN_MACHINE_TRUST_VALIDATION.md` and the platform verifier scripts. Do not globally weaken platform security to force a passing result.

### Build-only candidates (unpublished, before publication)

A candidate can be built and smoke-tested on the release runner without creating or changing a GitHub release:

```bash
gh workflow run release-build.yml -f tag=<branch, tag or commit SHA> -f platform=windows -f publish=false
```

With `publish=false` (the default for manual runs) the workflow runs the same build, packaged SQLite check, packaged smoke, trust verification and manifest steps, but skips release creation, asset upload, provenance attestation and the Store/web publish jobs. Signing and notarization credentials are withheld, so a build-only candidate is always unsigned and its manifest is always `testerOnly`; checkout does not persist the job token. The installer and its evidence are kept as a workflow artifact for 7 days and stay `testerOnly`. This is not private in an absolute sense: in this public repository any signed-in GitHub user can download a run's artifacts. It is not announced, listed as a release or attested; for a strictly local candidate, build on a Windows machine with `npm run electron:build:win` and run the same smoke and trust scripts. Do not push a `v*` tag for a build-only candidate: a tag push always publishes.

### 11. Release publication

- [ ] Release title and notes describe only behavior present in the tag.
- [ ] Windows and macOS assets have completed upload before the release is presented as complete.
- [ ] Each platform release manifest references both trust evidence and packaged-smoke evidence.
- [ ] Every released artifact has a GitHub artifact attestation (`gh attestation verify <file> --repo MythologIQ-Labs-LLC/sojourner`).
- [ ] Download links in the root README are updated only after assets exist.
- [ ] Changelog release date/version is finalized.
- [ ] `docs/SYSTEM_STATE.md` moves candidate features from implemented/candidate to shipped only after publication.
- [ ] Post-release install/download is spot-checked from the actual GitHub Release page.

## Evidence record

Each release should record:

- tag and commit SHA;
- validation date;
- validator/environment;
- commands executed;
- package/artifact names;
- platform results;
- packaged-smoke report for each supported platform;
- signing/notarization trust evidence;
- clean-machine trust/launch observations;
- migrations tested from which prior version;
- known limitations or waived checks and rationale;
- links to retained validation evidence.

## Current v1.0.0-alpha.1 release-readiness status

**Prepared, not tagged.** `package.json` is `1.0.0-alpha.1`. The gate is [Current Windows release acceptance](#current-windows-release-acceptance-v100-alpha1). No `v*` tag exists yet.

## Job Ranger v1.2.0 release-readiness status (historical)

**Published:** `v1.2.0` → `71f9b790a1f456321aee2c783f39f4a6784b83a9` on 2026-10-05. Its GitHub Release was removed on 2026-11-02 and the tag renamed `job-ranger-v1.2.0`.

The release was non-prerelease and GitHub's latest release until then. Its Windows/macOS assets are byte-identical to the validated rc.5 packages and include packaged smoke, trust-state, checksum, and release-manifest evidence. v1.2.0 was published under an explicit owner-approved unsigned/unnotarized exception. Forward distribution moved to the Microsoft Store (#125) and the web/PWA runtime (#130). Any change ships as a new release; v1.2.0 is never mutated.

## Job Ranger v1.3.0 release-readiness status (superseded)

**Never tagged.** The v1.3.0 Job Ranger candidate was superseded by Sojourner `1.0.0-alpha.1`, which ships its content. The scope, the pre-tag validation, the automated upgrade evidence from v1.2.0, and the remaining gates are recorded in [`validation/RELEASE_CANDIDATE_V1.3.0.md`](./validation/RELEASE_CANDIDATE_V1.3.0.md).
