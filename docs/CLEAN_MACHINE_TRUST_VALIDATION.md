# Clean-Machine Trust Validation

This runbook records the external evidence required before Job Ranger promotes a stable public Windows/macOS release.

It complements hosted package validation. It does **not** replace the release pipeline's package-smoke, checksum, or signing checks.

## Boundary

Use this process only with a stable candidate that has been built with the required signing credentials.

Do not disable SmartScreen, Smart App Control, Defender, Gatekeeper, System Integrity Protection, or other platform security globally to force a result.

If the operating system blocks a build under its normal supported security policy, record that outcome as a failed release gate.

## Windows 11

### 1. Prepare the clean system

Record:

- Windows edition/version/build;
- architecture;
- whether Smart App Control is On, Evaluation, or Off as reported by Windows Security;
- any organization policy that materially changes SmartScreen or application-control behavior.

Do not change those settings merely to make the test pass.

### 2. Download the stable installer

Download the exact Windows installer from the candidate/stable GitHub Release rather than copying a locally built file onto the machine.

Record the filename and published SHA-256.

### 3. Verify identity and Authenticode

From a checkout of the exact release tag or a trusted copy of the verification script:

```powershell
./scripts/verify-windows-distribution.ps1 `
  -RequireSigned `
  -ArtifactPath "C:\Users\<you>\Downloads\Sojourner-v1.0.0-alpha.1-windows-x64.exe" `
  -ReportPath ".\windows-clean-machine-signing.json"
```

The command fails if the file does not carry a valid Authenticode signature. The report records:

- SHA-256;
- byte size;
- signer subject/issuer;
- signature status;
- Windows version/architecture;
- PowerShell version.

Compare the recorded SHA-256 with the stable release checksum file.

### 4. Install normally

Launch the downloaded installer as an ordinary user would.

Record:

- whether SmartScreen appears;
- whether Smart App Control blocks the binary;
- exact warning/prompt text when materially relevant;
- whether Windows provides a normal per-file/per-app continuation path;
- whether installation completes without globally weakening security settings.

A silent `/S` install may be useful as a separate automation check, but it is **not** a substitute for observing the ordinary first-install trust path.

### 5. First launch

Launch Job Ranger from the installed application shortcut/start-menu entry.

Record:

- whether the application launches normally;
- any Windows trust warning shown on first launch;
- application version displayed/reported;
- any startup error.

The hosted release pipeline has already exercised the package's local backend smoke. This clean-machine step is specifically about the installed/signed OS trust path.

## macOS

### 1. Prepare the clean system

Record:

- macOS version/build;
- architecture;
- whether the system is otherwise using normal Gatekeeper defaults/policy.

Do not disable Gatekeeper or remove quarantine metadata merely to make the test pass.

### 2. Download the stable DMG

Download the architecture-appropriate DMG from the stable GitHub Release.

Verify its SHA-256 against the published checksum file:

```bash
shasum -a 256 ~/Downloads/Sojourner-v<version>-macos-arm64.dmg
```

(or the x64 filename on an Intel Mac).

### 3. Mount/install normally

Open the DMG and copy Job Ranger to `/Applications` using the normal user flow.

Do not use `xattr -dr com.apple.quarantine` or globally disable Gatekeeper.

### 4. Verify Developer ID / notarization / stapling

From a checkout of the exact release tag or a trusted copy of the verification script:

```bash
bash scripts/verify-macos-distribution.sh \
  --require-trust \
  --app "/Applications/Sojourner.app" \
  --report ./macos-clean-machine-signing.txt
```

The command records and enforces:

- `codesign --verify --deep --strict`;
- signature details;
- Gatekeeper assessment via `spctl`;
- stapler validation;
- host macOS version/build;
- architecture.

### 5. First launch

Launch `/Applications/Sojourner.app` normally through Finder/Launchpad.

Record:

- whether Gatekeeper accepts the app without an unsigned-app override;
- any warning/prompt shown;
- whether Job Ranger reaches its normal first-run UI;
- any startup error.

A stable Developer ID-signed/notarized build should not depend on the tester-only **Open Anyway** path documented for unsigned prereleases.

## Evidence package

Attach or retain, as appropriate:

### Windows

- `windows-clean-machine-signing.json`;
- installer SHA-256 comparison;
- OS/version/architecture;
- SmartScreen / Smart App Control observation;
- install result;
- first-launch result;
- screenshots only where they materially establish a warning/prompt/outcome.

### macOS

- `macos-clean-machine-signing.txt`;
- DMG SHA-256 comparison;
- OS/version/architecture;
- Gatekeeper first-launch observation;
- install result;
- first-launch result;
- screenshots only where they materially establish a warning/prompt/outcome.

Record the exact release tag and commit SHA with both evidence sets.

## Completion

The clean-machine gate is complete only when the signed stable candidate succeeds on the supported Windows and macOS paths without globally weakening platform security.

After v1.2.0 this procedure applies to direct-download binaries that are promoted to ordinary users. The forward trust contract is [`DISTRIBUTION_TRUST.md`](./DISTRIBUTION_TRUST.md). The supported channels are tracked by #125 (Microsoft Store) and #130 (web/PWA).
