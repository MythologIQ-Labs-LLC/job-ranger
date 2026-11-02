# Job Ranger agent working agreement

Start with [docs/ARCHITECTURE_INDEX.md](./docs/ARCHITECTURE_INDEX.md), [GOVERNANCE.md](./GOVERNANCE.md), [docs/REPOSITORY_WORKFLOW.md](./docs/REPOSITORY_WORKFLOW.md), and [CONTRIBUTING.md](./CONTRIBUTING.md).

- Read exact current \`main\` and parent issue before modifying code. Reuse
  active delivery branches; do not proliferate duplicate PRs.
- Favor functional correctness, data integrity, local-first privacy, recovery
  and user-owned canonical career truth over visual polish.
- No inference or imported data may silently rewrite verified Career Evidence.
- Do not claim an unmerged branch is in main, or main is published software.
- No mass auto-apply, unsolicited remote synchronization, or third-party
  credential handling without explicit reviewed scope.
- Keep no more than three active feature PRs, excluding explicitly approved
  security/critical-data-loss work. Draft experiments should not masquerade
  as release candidates.
- Before requesting a merge, give exact head and base SHAs, local commands,
  results, known failures, Windows/PWA coverage if applicable, and Actions
  cost. Avoid triggering hosted CI on every iteration.
- After an approved merge, update and close fulfilled issues and superseded
  PRs with evidence, without deleting historical branches.
- Do not make CI green by relaxing the test oracle or modifying the claim.
  Reproduce intermittent defects and address their actual root causes.

## Windows code signing

Windows binaries and installers this repository distributes **must be Authenticode-signed at release time** with the MythologIQ Labs Azure Artifact Signing profile. Signing is available and verified, so don't ship an unsigned public Windows release.

- Endpoint `https://eus.codesigning.azure.net/`, account `MythologIQ-Labs-Signing`, certificate profile `mythologiq-labs-public-release` (Public Trust). Publisher shown to users: `MythologIQ Labs, LLC`. Timestamp server: `http://timestamp.acs.microsoft.com`.
- Canonical procedure, verified tooling and framework integration: `MythologIQ-Labs-LLC/Myth-Tech-Forge` at `docs/WINDOWS_CODE_SIGNING_STANDARD.md`. Follow it; don't invent another signing path.
- Sign release builds only (release tag or manual release), never PR or routine CI builds. Windows runners bill at 2x Actions minutes.
- Signing requires the Artifact Signing Certificate Profile Signer role. Creating a signing identity, federated credential, secret or role assignment needs owner approval. Never commit credentials.
- A release is signed only after `signtool verify /pa` passes, the signer is `MythologIQ Labs, LLC`, and the signature is timestamped. Record that output in the release evidence.

**This repository (Electron, electron-builder). Windows is the primary product channel (ARCH-001):**
- `scripts/windows-sign.cjs` signs through SignTool and the Artifact Signing client with the Azure CLI credential only, the same pattern as `Knapp-Kevin/sonic-rift`. There is no client secret. `electron-builder.windows.cjs` uses it as the `win.signtoolOptions.sign` hook when `JOB_RANGER_WINDOWS_SIGNING_CLIENT_DIR` is set, and fails closed when `JOB_RANGER_REQUIRE_WINDOWS_SIGNING=1` and it is not.
- `release-build.yml` signs **every publishing run** (a `v*` tag, or a manual run with publish on) and never a build-only run. A publishing Windows job enters the `release` environment, waits for owner approval, signs in with `azure/login` (GitHub OIDC, environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`), signs the bundled `sqlite3.exe`, builds and signs the app and installer, and then `scripts/verify-windows-distribution.ps1 -RequireSigned` fails the run unless every executable passes `signtool verify /pa`, is signed by `MythologIQ Labs, LLC` and is timestamped.
- The CI sign-in needs a federated credential with subject `repo:MythologIQ-Labs-LLC/job-ranger:environment:release` on an app that has the Signer role on the profile, plus the `release` environment on this repository. Both are owner-provisioned.
- Locally, the owner can sign after `az login` by setting `JOB_RANGER_WINDOWS_SIGNING_CLIENT_DIR` before `npm run electron:build:win`.
- Microsoft Store packages (`electron-builder.store.cjs`, `windows-store-package.yml`) are not a shipping channel. If they are ever submitted, the Store signs them.
