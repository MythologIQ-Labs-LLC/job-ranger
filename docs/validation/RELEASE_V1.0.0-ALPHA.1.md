# Release evidence: Sojourner v1.0.0-alpha.1

The evidence record for the first Sojourner release, following [`RELEASE_READINESS.md`](../RELEASE_READINESS.md), "Current Windows release acceptance" and "Evidence record". It states what was checked, against which state, and what was not performed.

## Identity

| Item | Value |
| --- | --- |
| Tag | `v1.0.0-alpha.1` (annotated) |
| Commit | `58bff07020dac6653b92b4b70796be597cb465d2` on `main` (#372 on top of the release commit `2c4867a`, #371) |
| GitHub Release | [Sojourner v1.0.0-alpha.1](https://github.com/MythologIQ-Labs-LLC/sojourner/releases/tag/v1.0.0-alpha.1), **pre-release**, published 2026-11-03T14:40:09Z |
| Release run | [`release-build.yml` run 41654275535](https://github.com/MythologIQ-Labs-LLC/sojourner/actions/runs/41654275535): `build-windows` succeeded after owner approval of the `release` environment; macOS, Store and web jobs were skipped as designed |
| Version identity | `package.json` and `package-lock.json`: `1.0.0-alpha.1`. `electron-builder.json`: appId `com.mythologiq.sojourner`, product `Sojourner`, `Copyright © 2026 MythologIQ Labs, LLC`, `nsis.deleteAppDataOnUninstall: false`, `nsis.include` `build/installer.nsh` |

## Published assets

| Asset | Bytes | SHA-256 |
| --- | --- | --- |
| `Sojourner-v1.0.0-alpha.1-windows-x64.exe` | 130,055,368 | `d33758d3fe32e3a033e5daf3d2b3d65deca5fd000d5cd9780d50843641aa0cc1` |
| `Sojourner-v1.0.0-alpha.1-windows-x64.exe.blockmap` | 136,533 | (differential-download map) |
| `windows-SHA256SUMS.txt`, `windows-release-manifest.json` (`publicRelease: true`, `testerOnly: false`), `windows-signing.json` (`requireSigned: true`), `windows-package-smoke.json` | | |

No `latest.yml` is published, so no existing installation updates itself to this pre-release.

## Signing (ARCH-006)

From `windows-signing.json` (CI, Windows Server 2025 runner): `Sojourner.exe`, `resources/elevate.exe`, `resources/sqlite3.exe` and the installer each have Authenticode status `Valid`, signer `CN="MythologIQ Labs, LLC"` issued by `Microsoft ID Verified CS AOC CA 04`, an RFC 3161 timestamp from the Microsoft Public RSA Time Stamping Authority, and `signtool verify /pa` passing.

Independent check after publication (owner's Windows 11 workstation, 2026-11-03), on the installer downloaded from the GitHub Release:

- its SHA-256 matches `windows-SHA256SUMS.txt` and the release manifest;
- `Get-AuthenticodeSignature`: `Valid`, signer `CN="MythologIQ Labs, LLC"`, timestamp present;
- `signtool verify /pa /tw`: "Successfully verified" (sha256, RFC 3161);
- `gh attestation verify Sojourner-v1.0.0-alpha.1-windows-x64.exe --repo MythologIQ-Labs-LLC/sojourner`: passed.

## Build, package and smoke (section 7)

All `build-windows` steps passed in the release run, including: signing the pinned SQLite CLI, the build, **Verify packaged SQLite runtime** (the bundled `sqlite3.exe` is selected with `SQLITE3_PATH` removed), **Run packaged Windows consumer smoke** (`windows-package-smoke.json`: `passed`, healthcare scenario, app version `1.0.0-alpha.1`, backup validated), **Verify Windows distribution trust** (`-RequireSigned`), checksums and manifest, and the build-provenance attestation.

## Local gates before tagging

On the release source (`90ea4ff`, the same tree as `main` at `2c4867a`), Windows 11 workstation, 2026-11-02 to 2026-11-03:

- `npm run typecheck` and `npm test`: passed (including the storage, Drive desktop, legacy-migration and NSIS legacy-uninstall suites);
- `npm run test:e2e` (Electron): 46 of 46 passed;
- `npm run test:pwa:e2e`: 186 passed, 1 skipped, with a real legacy PWA build for the storage migration;
- `npm run test:release-upgrade` from `job-ranger-v1.2.0`: passed;
- `npm audit`: no high-severity findings.

#372 (workflow and its test only) was validated at its branch head `5935788`: `npm run typecheck`, `npm test`, and the distribution-trust and release-manifest tests passed.

## Not performed or waived

- **Manual upgrade from an installed Job Ranger v1.2.0** (the installed-machine checks under "Upgrade from Job Ranger v1.2.0 data"): **waived by the owner on 2026-11-03** for this alpha. The automated upgrade path (`npm run test:release-upgrade`, `tests/legacy-migration.test.cjs`, `tests/nsis-legacy-uninstall.test.cjs`) passed. An attempt in Windows Sandbox was invalid because Smart App Control blocks the unsigned v1.2.0 installer there; no result from it is claimed.
- **Uninstall/reinstall data retention and a clean-machine install** of the published installer, including SmartScreen and Smart App Control observations (section 10): not yet performed.
- **Microsoft Store, macOS and web/PWA publication:** not part of this release.

## Known limitations

- The certificate subject's locality reads `L=Stevenvsille` (a misspelling of Stevensville). It comes from the identity validated for the Artifact Signing account and appears in every signature; signature validity is unaffected. Correcting it is an owner action in the Azure portal.
- This is a pre-release. Earlier Job Ranger installers remain unsigned and are no longer offered.
