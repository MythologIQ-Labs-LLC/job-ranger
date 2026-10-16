# Release Readiness Contract

This document defines the minimum evidence required before Job Ranger publishes a new user-installable release.

A merged `main` branch is **not** a release. A passing unit test is **not** a release. Electron Builder being configured for a platform is **not** a release. A release exists only when an immutable version/tag has been validated and published with the artifacts users are actually expected to run.

## Status authority

- **Published GitHub Release**: authority for what users can download.
- **Immutable release tag**: authority for the source used to build a release.
- **`main`**: authority for current merged development, which may be ahead of the published product.
- **Documentation on `main`**: must describe both boundaries honestly.

The current published stable release is **v1.2.0** (`71f9b790a1f456321aee2c783f39f4a6784b83a9`, promoted byte-for-byte from rc.5). It is immutable historical release truth.

Forward releases follow the accepted distribution architecture ([`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md)):

- **Supported channels:** the Microsoft Store package (Windows native) and the web/PWA runtime (cross-platform).
- **Advanced/test artifacts:** the direct-download NSIS installer, unless it is independently signed. Azure Artifact Signing is optional and never blocks a release.
- **Not part of the forward architecture:** native macOS and Linux packages.

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

### 7. Windows direct-download (NSIS) package validation — advanced/test channel

- [ ] Build from the immutable release tag on the supported Windows builder.
- [ ] NSIS x64 installer is produced with the expected versioned filename.
- [ ] Official pinned SQLite CLI archive is downloaded and its published SHA3-256 verified.
- [ ] Packaged `resources/sqlite3.exe` exists and executes.
- [ ] With `SQLITE3_PATH` removed, runtime resolution selects the packaged SQLite binary.
- [ ] Generated `electron-runtime` entry point exists in the packaged application.
- [ ] The packaged `Job Ranger.exe` executes the headless package-smoke harness from its own `app.asar` using an isolated data root.
- [ ] `windows-package-smoke.json` reports `passed` for the required non-software scenario and is included in release evidence.
- [ ] The Windows trust verifier executes successfully in the native release runner.
- [ ] Installer launch/upgrade is exercised on a clean supported Windows system before stable publication.
- [ ] Existing user data survives installer upgrade.
- [ ] If (and only if) the direct installer is promoted as an ordinary-user channel, it carries valid Authenticode signatures and observed SmartScreen / Smart App Control behavior is recorded on a clean supported machine. Otherwise its release manifest marks it `testerOnly` and release notes label it an advanced/test artifact.
- [ ] A GitHub artifact attestation exists for the installer.

### 7a. Microsoft Store package validation (supported Windows channel)

Design and procedure: [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md).

- [ ] `windows-store-package` workflow passed for the release commit:
  - `windows-store-package.json`: identity, version, capabilities exactly `runFullTrust` + `internetClient`, no extensions, canonical assets, bundled `sqlite3.exe`;
  - `windows-store-package-smoke.json`: in-package healthcare Career Ops smoke, `windowsStore: true`, isolated data root, native DOCX resume import, Chromium PDF and native parseability, archive round trip;
  - `windows-store-install.json`: data in package storage, no leak into `%APPDATA%`, historical NSIS data unchanged, uninstall behavior.
- [ ] Partner Center identity variables are configured and the submission package was built with `JOB_RANGER_REQUIRE_STORE_IDENTITY=1`.
- [ ] The `.appx`, its checksums, `windows-store-release-manifest.json`, and its artifact attestation are attached to the release.
- [ ] Partner Center certification passed (record the submission ID).
- [ ] A clean supported Windows 11 install from the Store listing, first launch, an upgrade from an earlier Store version, and backup/restore are recorded.
- [ ] README/HELP direct Windows users to the Store **only after** the listing is live.

### 7b. Web/PWA validation (supported cross-platform channel)

Design and procedure: [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md).

- [ ] The `pwa` workflow passed for the release commit: production build, web-parser benchmark, and the browser suite (Career Ops end to end, Electron↔PWA portability, rejected backups, offline shell, verified/rejected updates, quota failure, tab lock).
- [ ] `job-ranger-web-v<version>.zip`, `web-build-info.json` (build ID, commit, CSP, asset hashes), the browser-suite report, checksums, the release manifest, and the artifact attestation are attached to the release.
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
- [ ] Every released artifact has a GitHub artifact attestation (`gh attestation verify <file> --repo MythologIQ-Labs-LLC/job-ranger`).
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

## Current v1.2.0 release-readiness status

**Published:** `v1.2.0` → `71f9b790a1f456321aee2c783f39f4a6784b83a9` on 2026-10-05.

The release is non-prerelease and GitHub's current latest release. Its Windows/macOS assets are byte-identical to the validated rc.5 packages and include packaged smoke, trust-state, checksum, and release-manifest evidence. v1.2.0 was published under an explicit owner-approved unsigned/unnotarized exception. Forward distribution moved to the Microsoft Store (#125) and the web/PWA runtime (#130). Any change ships as a new release; v1.2.0 is never mutated.

## Current v1.3.0 release-readiness status

**Candidate preparation.** v1.3.0 is the selected next version (`package.json`). No `v1.3.0-rc.N` tag exists yet. The scope, the pre-tag validation, the automated upgrade evidence from v1.2.0, and the remaining gates are recorded in [`validation/RELEASE_CANDIDATE_V1.3.0.md`](./validation/RELEASE_CANDIDATE_V1.3.0.md).
