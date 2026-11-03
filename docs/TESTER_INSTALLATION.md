# Tester Installation Guidance

**Audience:** informed testers using Sojourner pre-release artifacts.  
The signed Windows installer is the primary channel (ARCH-001 in [`ARCHITECTURE_INDEX.md`](./ARCHITECTURE_INDEX.md)); the web app continues alongside it. The first Sojourner release is **v1.0.0-alpha.1**, a GitHub **pre-release** whose installer, `Sojourner-v1.0.0-alpha.1-windows-x64.exe`, is Authenticode-signed by **MythologIQ Labs, LLC**.

Earlier releases were published as Job Ranger. Their GitHub Releases were removed on 2026-11-02 and their tags renamed to `job-ranger-v*` (for example `job-ranger-v1.2.0`). Those installers were unsigned. The unsigned tester paths below apply only to such historical or build-only artifacts. Sojourner does not instruct testers to disable SmartScreen, Smart App Control, Defender, Gatekeeper, quarantine protections, or other system security globally.

## Upgrading from Job Ranger v1.2.0

The Sojourner installer installs Sojourner, then finds an existing Job Ranger v1.2.0 installation and removes it silently, keeping its data (cancelling the installer leaves Job Ranger untouched), so you end up with one app, "Sojourner". On first start Sojourner copies your data from `%APPDATA%\job-ranger` to `%APPDATA%\Sojourner`, checks the copy and uses it; the old folder is left unchanged, with a `MIGRATED-TO-SOJOURNER.txt` note, and can be deleted once you have confirmed your data. If the copy cannot be completed, Sojourner keeps using the old folder and tries again next time. Uninstalling never deletes either folder. Create a `.jobranger` backup (Settings) before upgrading.

## Verify the download first

Every release build publishes platform-specific SHA-256 evidence next to the installer artifacts:

- `windows-SHA256SUMS.txt` and `windows-release-manifest.json`;
- `macos-SHA256SUMS.txt` and `macos-release-manifest.json`.

The manifest identifies the tag, whether the build is a public release or tester-only prerelease, the artifact filename, byte size, SHA-256 digest, and the corresponding signing-verification evidence file.

Sojourner releases also publish:
- `windows-signing.json`, the Authenticode verification of every Windows executable (signer `MythologIQ Labs, LLC`, timestamp, `signtool verify /pa`);
- `web-*` files for the web build;
- a GitHub artifact attestation for every artifact. Verify it with `gh attestation verify <file> --repo MythologIQ-Labs-LLC/sojourner`.

A pushed release tag no longer builds the Microsoft Store package. It is built only on a manual run and is not a shipping channel.

### Windows

In PowerShell:

```powershell
Get-FileHash .\Sojourner-v1.0.0-alpha.1-windows-x64.exe -Algorithm SHA256
Get-AuthenticodeSignature .\Sojourner-v1.0.0-alpha.1-windows-x64.exe | Format-List Status, SignerCertificate
```

Compare the hash with the matching entry in `windows-SHA256SUMS.txt` from the same GitHub Release. The signature status must be `Valid`, and the signer subject must start with `CN="MythologIQ Labs, LLC"`.

### macOS

In Terminal:

```bash
shasum -a 256 ./Sojourner-v<version>-macos-arm64.dmg
```

Native macOS packages are built only on manual dispatch; macOS users are served by the web app. Use the x64 filename instead on an Intel Mac. Compare the result with `macos-SHA256SUMS.txt` from the same GitHub Release.

A matching checksum proves that the downloaded file matches the release asset. It does **not** convert an unsigned artifact into a signed one.

## Windows 11 unsigned tester path (historical or build-only artifacts)

1. Verify the SHA-256 checksum before running the installer.
2. Attempt to launch the installer normally.
3. If Windows Defender SmartScreen presents an OS-native option to inspect the warning and explicitly run the app anyway, a tester who independently trusts the GitHub Release may choose that per-file override.
4. If **Smart App Control** blocks the installer or Windows provides no per-app/per-file override, stop. The unsigned tester build is not supported on that configuration.

Do not turn off Smart App Control, SmartScreen, Defender, or other Windows security merely to run Sojourner or Sojourner.

Microsoft documents Smart App Control as blocking unknown unsigned code by default when its intelligence service cannot establish trust. Signed Sojourner releases are the solution for those systems.

## macOS unsigned or unnotarized tester path

1. Verify the SHA-256 checksum before opening the DMG or ZIP.
2. Attempt to open Sojourner normally.
3. If macOS blocks the app because it is unidentified or not notarized, open **System Settings → Privacy & Security**.
4. When macOS offers **Open Anyway** for the blocked Sojourner app, confirm the exception only if you independently trust the GitHub Release and verified its checksum.
5. macOS stores that decision as an exception for that app.

Do not disable Gatekeeper globally and do not recursively remove quarantine metadata to make Sojourner run.

Apple explicitly documents the Privacy & Security → Open Anyway flow as the bounded user override for software from an unidentified developer or software that has not been notarized.

## Public releases

No Sojourner release, stable (`vMAJOR.MINOR.PATCH`) or pre-release (such as `v1.0.0-alpha.1`), publishes through the release workflow unless platform trust verification passes:

- Windows: valid, timestamped Authenticode signatures by `MythologIQ Labs, LLC` through Azure Artifact Signing, with `signtool verify /pa` passing for every executable;
- macOS (manual dispatch only): Developer ID signing, Apple notarization, stapled ticket, `codesign`, Gatekeeper assessment, and stapler verification.

A run with publish off is an unsigned, tester-only workflow artifact and never reaches a GitHub Release. Tags containing `-alpha`, `-beta` or `-rc.` are published as GitHub pre-releases.

See [`DISTRIBUTION_TRUST.md`](./DISTRIBUTION_TRUST.md) for the full release trust contract.
