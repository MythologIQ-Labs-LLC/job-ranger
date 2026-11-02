# Tester Installation Guidance

**Audience:** informed testers using Job Ranger prerelease artifacts.  
**Not the normal public-installation path.** Going forward, ordinary users install Job Ranger from the Microsoft Store (Windows) or use the web app; both are pending external certification or deployment (see [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md)). Direct-download installers are advanced/test artifacts unless independently signed.

Unsigned or unnotarized prerelease artifacts can trigger platform security controls. Job Ranger does not instruct testers to disable SmartScreen, Smart App Control, Defender, Gatekeeper, quarantine protections, or other system security globally.

## Verify the download first

Every Job Ranger release build publishes platform-specific SHA-256 evidence next to the installer artifacts:

- `windows-SHA256SUMS.txt` and `windows-release-manifest.json`;
- `macos-SHA256SUMS.txt` and `macos-release-manifest.json`.

The manifest identifies the tag, whether the build is a public release or tester-only prerelease, the artifact filename, byte size, SHA-256 digest, and the corresponding signing-verification evidence file.

Releases after v1.2.0 also publish:
- `windows-store-*` files for the Microsoft Store package candidate;
- `web-*` files for the web build;
- a GitHub artifact attestation for every artifact. Verify it with `gh attestation verify <file> --repo MythologIQ-Labs-LLC/sojourner`.

The Store package attached to a GitHub Release is the unsigned submission artifact. It is not installable as-is and is not a substitute for the Store listing.

### Windows

In PowerShell:

```powershell
Get-FileHash .\Job.Ranger-v1.2.0-windows-x64.exe -Algorithm SHA256
```

Compare the result with the matching entry in `windows-SHA256SUMS.txt` from the same GitHub Release.

### macOS

In Terminal:

```bash
shasum -a 256 ./Job.Ranger-v1.2.0-macos-arm64.dmg
```

Use the x64 filename instead on an Intel Mac. Compare the result with `macos-SHA256SUMS.txt` from the same GitHub Release.

A matching checksum proves that the downloaded file matches the release asset. It does **not** convert an unsigned artifact into a signed one.

## Windows 11 unsigned tester path

1. Verify the SHA-256 checksum before running the installer.
2. Attempt to launch the installer normally.
3. If Windows Defender SmartScreen presents an OS-native option to inspect the warning and explicitly run the app anyway, a tester who independently trusts the GitHub Release may choose that per-file override.
4. If **Smart App Control** blocks the installer or Windows provides no per-app/per-file override, stop. The unsigned tester build is not supported on that configuration.

Do not turn off Smart App Control, SmartScreen, Defender, or other Windows security merely to run Job Ranger.

Microsoft documents Smart App Control as blocking unknown unsigned code by default when its intelligence service cannot establish trust. Signed public Job Ranger releases are the intended solution for those systems.

## macOS unsigned or unnotarized tester path

1. Verify the SHA-256 checksum before opening the DMG or ZIP.
2. Attempt to open Job Ranger normally.
3. If macOS blocks the app because it is unidentified or not notarized, open **System Settings → Privacy & Security**.
4. When macOS offers **Open Anyway** for the blocked Job Ranger app, confirm the exception only if you independently trust the GitHub Release and verified its checksum.
5. macOS stores that decision as an exception for that app.

Do not disable Gatekeeper globally and do not recursively remove quarantine metadata to make Job Ranger run.

Apple explicitly documents the Privacy & Security → Open Anyway flow as the bounded user override for software from an unidentified developer or software that has not been notarized.

## Public releases

A stable `vMAJOR.MINOR.PATCH` Job Ranger release is not allowed to publish through the release workflow unless platform trust verification passes:

- Windows: valid Authenticode signatures through Microsoft Azure Artifact Signing;
- macOS: Developer ID signing, Apple notarization, stapled ticket, `codesign`, Gatekeeper assessment, and stapler verification.

If those credentials or checks are unavailable, the build remains a prerelease/tester artifact rather than being promoted as a normal public release.

See [`DISTRIBUTION_TRUST.md`](./DISTRIBUTION_TRUST.md) for the full release trust contract.
