# Distribution Trust

**Status:** forward distribution trust contract for post-v1.2 releases  
**Tracked by:** #125, #130  
**Last reviewed:** 2026-10-05

Sojourner separates **artifact provenance**, **platform installation trust**, and **runtime security**. A certificate is one possible trust mechanism, not the product's foundational security model.

The accepted distribution architecture is defined in [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md).

> **Superseded in part (2026-11-02).** ARCH-001 in [`ARCHITECTURE_INDEX.md`](./ARCHITECTURE_INDEX.md) makes the **signed Windows installer** the primary channel, with the PWA continuing alongside it; the Microsoft Store is not a shipping channel. Where this document says the Store and PWA are the supported targets, or treats the direct installer as advanced/test only, ARCH-001 wins. The first Sojourner release is `v1.0.0-alpha.1` (`Sojourner-v1.0.0-alpha.1-windows-x64.exe`, a GitHub pre-release signed by `MythologIQ Labs, LLC`).

## Historical v1.2.0 boundary

Stable Job Ranger **v1.2.0** was published on 2026-10-05 from commit:

`71f9b790a1f456321aee2c783f39f4a6784b83a9`

It was promoted byte-for-byte from validated `v1.2.0-rc.5` artifacts and intentionally published unsigned/unnotarized under an explicit owner-approved exception.

On 2026-11-02 the owner removed all 12 Job Ranger GitHub Releases and renamed their tags to `job-ranger-v*` on the same commits (`job-ranger-v1.2.0` is the commit above). The artifacts are no longer offered for download; the tags keep the source history, and `npm run test:release-upgrade` uses `job-ranger-v1.2.0` as its upgrade baseline until Sojourner has a stable tag.

## Forward release policy

The normal-user distribution strategy after v1.2.0 has two supported targets:

1. **Cross-platform PWA/web runtime** delivered from a controlled HTTPS production origin.
2. **Windows-native Microsoft Store package** certified and signed through the Store distribution path.

Public code-signing certificates owned directly by Sojourner are no longer a prerequisite for those supported paths.

Direct native binaries published through GitHub may remain useful for development, testing, archival, or informed advanced users, but they are not the preferred mainstream installation path unless they independently satisfy applicable public OS trust requirements.

Sojourner documentation must never instruct users to disable SmartScreen, Smart App Control, Defender, Gatekeeper, browser security, or equivalent platform security globally.

## Trust layers

### 1. Source and build provenance

Regardless of distribution channel, releases should preserve verifiable relationships between source, build, and artifact.

Current or accepted evidence includes:

- immutable release/tag relationships;
- SHA-256 artifact hashes;
- machine-readable release manifests;
- packaged-runtime smoke evidence;
- exact release commit identity;
- dependency and repository validation;
- artifact/build attestations where they materially improve provenance.

A checksum proves byte identity against a published digest. It does not, by itself, create OS trust.

### 2. Distribution-channel trust

The supported channel determines how an ordinary user's platform establishes installation trust.

- **Microsoft Store:** Store certification and Microsoft-managed package signing establish the normal Windows installation trust path.
- **PWA:** HTTPS origin identity, browser security boundaries, controlled deployment, and service-worker/update integrity establish the normal web-app trust path.

### 3. Runtime security

Trusting the installer or origin does not grant the application unlimited authority.

Existing Sojourner invariants remain in force, including:

- local-first personal career data;
- explicit user authority for consequential actions;
- acquisition network protections;
- strict renderer/browser security boundaries;
- validated imports;
- evidence-grounded factual claims;
- deterministic backup/export integrity.

## Microsoft Store Windows path

### Selected native Windows path

The Microsoft Store is the primary supported native Windows distribution channel going forward.

The first implementation should prefer the already-evaluated electron-builder v26 `appx` target unless implementation evidence justifies another target.

The Store proof-of-concept must validate:

- Partner Center publisher/package identity;
- AppX manifest/capability generation;
- Store certification;
- packaged Electron sandbox behavior;
- bundled SQLite behavior;
- local data and managed artifact paths;
- source discovery/acquisition;
- resume import/export and PDF generation;
- backup/restore;
- upgrade/update behavior;
- coexistence or migration from the historical NSIS installer where relevant.

Once certified, the Store package should become the recommended Windows-native install path.

### Azure Artifact Signing disposition

Azure Artifact Signing is no longer required to unblock Sojourner's supported Windows distribution strategy.

Existing Azure signing integration may remain as optional/dormant infrastructure if its maintenance cost is low, but inability to obtain or maintain a Public Trust certificate profile must not block Store or PWA releases.

If Sojourner later chooses to make a direct-download native Windows installer a normal mainstream channel again, that decision must establish an appropriate public trust path before the installer is promoted as equivalent to the Store channel.

## PWA / web distribution path

The PWA is the primary cross-platform distribution target.

Its trust contract is different from native installer signing and must explicitly cover:

- HTTPS-only production delivery;
- strict CSP/security headers appropriate to the runtime;
- controlled production deployment authority;
- immutable/versioned build identity;
- auditable source-to-deployment provenance;
- service-worker lifecycle, update, and rollback behavior;
- safe local storage migration;
- no silent transmission of Career Evidence or other personal career data merely because the runtime is delivered over the web.

The PWA must remain local-first. A hosted origin is a delivery mechanism, not automatic permission to make the server the authority for user data.

Before the PWA is described as mainstream, validation must cover storage durability/eviction behavior, backup/restore, browser support, update safety, installability where supported, and any environment-specific capability limitations.

## Implementation on the post-v1.2.0 line

Implemented in PR #142. Nothing here is shipped until a release, a Store listing, or a production origin actually exists.

### Provenance (all channels, independent of any certificate)

| Artifact | Built by | Evidence published with the release |
| --- | --- | --- |
| Microsoft Store package `Sojourner-v<version>-windows-store-x64.appx` (not a shipping channel) | `windows-store-package.yml` (called by `release-build.yml` only on a manual run with platform `windows-store`, never on a tag push) | `windows-store-package.json`, `windows-store-AppxManifest.xml`, `windows-store-package-smoke.json`, `windows-store-install.json`, `windows-store-SHA256SUMS.txt`, `windows-store-release-manifest.json`, GitHub artifact attestation |
| Web build `sojourner-web-v<version>.zip` | `pwa.yml` (called by `release-build.yml`) | `web-build-info.json` (build ID, commit, CSP, per-asset SHA-256), `web-pwa-e2e.json`, `web-SHA256SUMS.txt`, `web-release-manifest.json`, GitHub artifact attestation |
| Signed NSIS installer `Sojourner-v<version>-windows-x64.exe` (primary channel, ARCH-001) | `release-build.yml` | `windows-signing.json`, `windows-package-smoke.json`, `windows-SHA256SUMS.txt`, `windows-release-manifest.json` (`testerOnly: true` unless signed), GitHub artifact attestation |

Verify any artifact:

```bash
sha256sum --check <platform>-SHA256SUMS.txt
gh attestation verify <artifact> --repo MythologIQ-Labs-LLC/sojourner
```

Attestations are SLSA build-provenance statements signed through GitHub's OIDC identity for the exact workflow run, commit, and tag. They do not depend on Azure Artifact Signing or any purchased certificate.

### Azure Artifact Signing (required for Windows releases)

Every publishing run of the release workflow signs the NSIS installer, following the [Windows code signing standard](https://github.com/MythologIQ-Labs-LLC/Myth-Tech-Forge/blob/main/docs/WINDOWS_CODE_SIGNING_STANDARD.md). The Windows job enters the `release` environment (owner approval), signs in to Azure with GitHub OIDC, and signs through SignTool and the Artifact Signing client (`scripts/windows-sign.cjs`). It fails closed if signing is not configured, and `scripts/verify-windows-distribution.ps1 -RequireSigned` fails it unless every executable is validly signed by `MythologIQ Labs, LLC` and timestamped. Build-only runs are never signed. Web releases do not depend on it.

### Microsoft Store channel

- The `.appx` submitted to Partner Center is **unsigned**; Microsoft signs it after certification.
- CI signs only a temporary copy, with an ephemeral self-signed certificate, so it can be installed for validation. That certificate is removed afterwards and never published.
- Package identity comes from repository variables, never from source.
- Store-specific evidence, coexistence and migration behavior, and remaining external steps: [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md).

### Web channel

- **Deployment authority:** `deploy-pwa.yml`, run in the protected `production-web` environment (owner-configured reviewers).
- **No rebuild:** it deploys only an already-released archive whose checksum and attestation verify, then checks that the live origin serves that build ID with the required security headers.
- **Update integrity:** the service worker refuses any deployment whose shell assets do not match the build's SHA-256 manifest. Updates activate only after the user confirms.
- **Rollback:** redeploy an earlier tag. The runtime refuses to open data upgraded by a newer schema instead of corrupting it.
- **Local-first:** browser delivery never makes the server authoritative for user data. CSP `connect-src` limits outbound requests to public job-feed APIs, and nothing else leaves the device unless the user downloads a file.
- Details: [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md).

## macOS

Native macOS distribution is not currently planned.

Sojourner will not make Apple Developer Program membership, Developer ID Application signing, notarization, or native macOS packaging a required dependency under the accepted architecture.

macOS users are served through the PWA/web runtime once that runtime meets its validation and capability-parity boundary.

Historical macOS v1.2.0 artifacts remain historical release evidence.

## Linux

Native Linux packaging is not currently planned.

Linux users are served through the PWA/web runtime where supported and validated.

A future native Linux package requires evidence that user value justifies its packaging, update, QA, and support burden.

## SignPath

SignPath is explicitly **not part of the Sojourner distribution strategy**.

Do not add it as a signing dependency without a future explicit architecture decision reversing this disposition.

## Direct GitHub native artifacts

Direct GitHub binaries may continue to be produced when useful for:

- development;
- package validation;
- troubleshooting;
- archival/reproducibility;
- informed advanced-user testing.

For such artifacts:

- publish exact hashes and provenance evidence;
- label unsigned/untrusted state clearly;
- do not imply Store-equivalent installation trust;
- do not recommend weakening OS security globally;
- keep historical release assets immutable.

## Evidence required before mainstream promotion

### Microsoft Store

Record at minimum:

- exact source commit/tag used for the package;
- package identity/version;
- successful Store certification;
- Store-delivered package identity/signing state;
- clean supported Windows install;
- first launch;
- local persistence behavior;
- upgrade behavior;
- backup/restore behavior;
- packaged smoke result;
- known Store-specific limitations.

### PWA

Record at minimum:

- exact source/build/deployment identity;
- HTTPS origin and production deployment boundary;
- browser/platform matrix exercised;
- local persistence implementation and migration behavior;
- backup/export/restore behavior;
- install/standalone behavior where supported;
- service-worker update and recovery behavior;
- offline/limited-connectivity behavior where claimed;
- known browser/runtime limitations;
- confirmation that personal career data remains local-first by default.

## Relationship to previous signing work

The repository's existing Windows Authenticode verification, macOS verification scripts, checksum generation, package smoke, and release manifests remain valid historical engineering work.

They should not be deleted solely because the distribution strategy changed. They may continue to support direct-artifact verification and historical releases.

What changed is the **forward dependency**: normal Sojourner distribution no longer requires Sojourner to obtain and maintain both a Windows public-trust signing profile and Apple Developer ID credentials.
