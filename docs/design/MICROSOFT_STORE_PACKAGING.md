# Microsoft Store Packaging (historical engineering reference)

> **SUPERSEDED as a product distribution plan (2026-10-16):** [Canonical Architecture Index](../ARCHITECTURE_INDEX.md), ARCH-001/002. No Microsoft Store product listing, native release, code-signing or certification gate is planned. Keep this document only to explain existing Electron/AppX harness code, package tests and historical behavior. All future-distribution language below is historical.


**Status:** implemented (merged to `main` via #142; post-v1.2.0, not released). Package build, manifest verification, and in-package runtime validation run in CI (`.github/workflows/windows-store-package.yml`). **Partner Center reservation, submission, and certification are external and pending.** No Store listing exists, so the Store channel is not shipped.
**Tracks:** #125 (decision record: #133)
**Architecture:** [`DISTRIBUTION_ARCHITECTURE.md`](./DISTRIBUTION_ARCHITECTURE.md)

## Packaging

- Same Electron application, same pinned toolchain: electron-builder **v26** `appx` target (as evaluated in #133). No MSIX tooling migration.
- Config: `electron-builder.store.cjs`. It extends `electron-builder.json`, so files, `extraResources` (bundled `sqlite3.exe`), and branding are shared with the NSIS build.
- Command: `npm run electron:build:store`, which runs repository health and then builds the AppX. It needs Windows 10+ with the Windows SDK; CI uses `windows-latest`.
- Output: `release/Job Ranger-v<version>-windows-store-x64.appx`, or `…-windows-store-validation-x64.appx` without Partner Center identity.
- Architecture: x64. Windows on ARM runs x64 packages through emulation; a native arm64 package is a possible later addition.

### Package identity (configuration, never source)

| Variable (repository *variables*) | Manifest field |
| --- | --- |
| `JOB_RANGER_STORE_IDENTITY_NAME` | `Identity/@Name` (Partner Center → Product identity → Package/Identity/Name) |
| `JOB_RANGER_STORE_PUBLISHER` | `Identity/@Publisher` (`CN=…` from Partner Center) |
| `JOB_RANGER_STORE_PUBLISHER_DISPLAY_NAME` | `Properties/PublisherDisplayName` |
| `JOB_RANGER_STORE_DISPLAY_NAME` (optional) | Reserved app name (default "Job Ranger") |

- **None set:** the build uses a validation identity (`JobRanger.PackageValidation`, `CN=Job Ranger Package Validation`, display name "Job Ranger (validation)"). These packages are only for runtime validation.
- **Partially set:** the build fails.
- **Submission builds** (`JOB_RANGER_REQUIRE_STORE_IDENTITY=1`; set automatically by the release workflow once the identity variables exist) fail closed if identity is incomplete.
- Rules are in `scripts/store-identity.cjs` and tested by `tests/store-packaging-config.test.cjs`.

### Manifest and capabilities

The rendered manifest is checked by the Node test (any OS) and by `scripts/verify-store-package.ps1` against the real `.appx`:

- `EntryPoint="Windows.FullTrustApplication"`, `Executable="app\Job Ranger.exe"`, `Application Id="JobRanger"`.
- Capabilities are **exactly** `runFullTrust` (mandatory for Electron desktop apps) and `internetClient` (explicit, user-approved job-source requests). There is no broad file-system access, private-network access, device, or startup-task capability.
- No extensions: no startup task, protocol handler, or file association.
- `TargetDeviceFamily Windows.Desktop`, MinVersion `10.0.17763.0`, MaxVersionTested `10.0.26100.0`.
- Tile assets in `build/appx/` are derived from the canonical `public/ICON.png` (`scripts/generate-distribution-icons.sh`). Verification fails if electron-builder's sample assets were packaged instead.
- Signing: the Store signs certified packages, so neither Azure Artifact Signing nor any certificate is involved in the submission artifact. CI signs a **copy** with an ephemeral self-signed certificate solely so it can be installed for validation.

## Store runtime behavior

### Distribution channel detection

`electron/src/distribution.cts` reads Electron's `process.windowsStore`, which only a real package identity sets, to select the `microsoft-store` channel. Packaged direct builds cannot be relabelled. Unpackaged development runs may set `JOB_RANGER_DISTRIBUTION_CHANNEL_OVERRIDE=microsoft-store` to exercise Store behavior locally.

### Updates

The Store owns installation and updates. Job Ranger contains **no app-managed updater** in any channel; a test fails if `electron-updater`, `update-electron-app`, Squirrel, or `autoUpdater` usage is introduced. Runtime info reports `appManagedUpdates: false`. The `latest.yml` file that electron-builder emits for NSIS is release metadata only; the app never reads it. Historical direct-download builds are unchanged and remain available as advanced/test artifacts.

### Data location and isolation

| Installation | Data root seen by the app | Physical location |
| --- | --- | --- |
| Historical direct download (NSIS, ≤ v1.2.0) | `%APPDATA%\Job Ranger\data` | Same |
| Microsoft Store | `%APPDATA%\Job Ranger Store\data` | `%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Roaming\Job Ranger Store\data` (AppX file-system virtualization) |

The Store build deliberately uses a **different folder name**. Under AppX virtualization, writes to files that *already exist* in the real `%APPDATA%` go to the real file, while *new* files go to the package's private location. If the Store app reused `%APPDATA%\Job Ranger`, it would update the NSIS database in place while new resumes and source artifacts landed in private storage. That would leave both installations with database rows pointing at files they cannot see, and uninstalling the Store app would orphan them. A separate folder created by the package is entirely private to the package.

"Show file" and "Open Job Ranger Data Folder" map virtual paths to the physical `LocalCache` path (`storeHostPath`), so Explorer opens the real location.

**Uninstalling the Store app removes its data** (normal for Store apps). Settings → *This installation* says so; create a `.jobranger` backup before uninstalling.

### Coexistence with historical NSIS installations

- The Store package and an NSIS installation **can be installed side by side**. They have different install locations, package identity, and data roots, and they do not share a live database.
- They do **not** share data automatically, and nothing is migrated silently.
- **Moving data from the desktop installation to the Store app** (explicit and reversible):
  1. Open the Store app → Settings → *This installation*. If historical desktop data is found, choose **Import desktop data and restart**.
  2. Job Ranger reads the historical database and managed artifacts **read-only**, builds a validated backup bundle, and stages a normal restore into the Store data root. The Store app's previous data is the rollback candidate until the restore is applied.
  3. The historical installation and its data are not modified (CI verifies the SHA-256 of the historical database before and after) and keep working.
- **Alternative (any machine, any direction):** create a `.jobranger` backup in a desktop build that includes portable archives (the next release after v1.2.0) and restore it in the Store app. Backups made by v1.2.0 are folders; the Store app restores them when you select the `manifest.json` inside the folder. (The web app accepts only `.jobranger` files.)
- **After moving:** the historical NSIS installation can be uninstalled whenever the user is ready. Its uninstaller keeps user data (`deleteAppDataOnUninstall: false`). Uninstalling the Store app never touches the historical data.
- If the historical installation is v1.1.x and never opened v1.2.0, open it once in v1.2.0 first so renderer-local v1.1 profile and application data are migrated into its database.

## Validation

### Repository and CI (implemented)

1. **`tests/store-packaging-config.test.cjs`** (any OS): identity rules; electron-builder schema validation of both configs; the rendered AppxManifest (capabilities, extensions, entry point, version, tiles); asset dimensions; no app-managed updater; Store path mapping; the schema downgrade guard.
2. **`scripts/verify-store-package.ps1`** (Windows): opens the real `.appx` and checks identity, version, capabilities, entry point, absence of extensions, canonical tile hashes, and the presence of `app.asar` and the bundled `sqlite3.exe`. Writes `windows-store-package.json` and the extracted manifest.
3. **`scripts/run-store-package-smoke.ps1`** (Windows):
   - seeds a historical NSIS data root, signs a copy of the package with an ephemeral certificate, and installs it;
   - runs `Job Ranger.exe --job-ranger-package-smoke-report=…` **inside the package context**: the real Electron main process, with package identity and virtualization;
   - the smoke covers the non-software healthcare-operations Career Ops scenario: profile, Target Track, authored and imported evidence, company/filter, preserved job snapshot, requirement coverage, application, JSON Resume, and backup;
   - it also covers the bundled SQLite, native DOCX resume import through Anydoc, Chromium PDF rendering with the native Anydoc Parseability Gate, the Truth Gate, external-navigation validation, a `.jobranger` round trip into a second data root, and legacy-install detection;
   - it records data isolation (data present in package `LocalCache`, no leak into the real `%APPDATA%`), that the historical database is unchanged, and uninstall behavior. Evidence goes to `windows-store-package-smoke.json` and `windows-store-install.json`.
4. First passing run: [37352798825](https://github.com/Knapp-Kevin/job-ranger/actions/runs/37352798825), recorded in [`../validation/DISTRIBUTION_IMPLEMENTATION_2026-10-05.md`](../validation/DISTRIBUTION_IMPLEMENTATION_2026-10-05.md).
5. Checksums, a release manifest (`windows-store-release-manifest.json`), and a GitHub artifact attestation are produced for the package on release tags.

### External (pending, never claimed without evidence)

- Partner Center: reserve the app name; read the package identity values; set the repository variables.
- Build the submission package (release tag, or `windows-store-package` workflow dispatch with *submission*).
- Submit, then pass Store certification.
- Record the Store-delivered package identity and signature, a clean Windows 11 install, first launch and any prompts, an upgrade from an earlier Store candidate, and backup/restore. Use the evidence fields in [`../DISTRIBUTION_TRUST.md`](../DISTRIBUTION_TRUST.md).
- Only then update README/HELP to point ordinary Windows users at the Store listing.

## State language

| State | Meaning for the Store channel |
| --- | --- |
| Implemented | Packaging config, runtime behavior, tests, and workflows are merged |
| Package validation complete | The CI workflow passed for a given commit (package verified, installed, smoked in package context) |
| Packaged candidate | A release tag produced an attested `.appx` with evidence |
| Externally blocked / pending | Partner Center identity, submission, or certification not yet done |
| Certified | Microsoft certification passed (with evidence) |
| Shipped | The Store listing is live and recorded |
