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
- Signing requires the Artifact Signing Certificate Profile Signer role. Today only the owner's local `az login` identity has it. A CI signing identity (GitHub OIDC) doesn't exist yet, and creating one, or any secret or role assignment, needs owner approval. Never commit credentials.
- A release is signed only after `signtool verify /pa` passes, the signer is `MythologIQ Labs, LLC`, and the signature is timestamped. Record that output in the release evidence.

**This repository (Electron, electron-builder):**
- Signing is already wired in `electron-builder.windows.cjs` via `win.azureSignOptions` and fails closed when required.
- `release-build.yml` signs only when the repository variable `JOB_RANGER_REQUIRE_WINDOWS_SIGNING=1` is set for a publishing release.
- The variables should be:

  | Variable | Value |
  | --- | --- |
  | `JOB_RANGER_WINDOWS_SIGN_ENDPOINT` | `https://eus.codesigning.azure.net/` |
  | `JOB_RANGER_WINDOWS_SIGN_ACCOUNT` | `MythologIQ-Labs-Signing` |
  | `JOB_RANGER_WINDOWS_SIGN_PROFILE` | `mythologiq-labs-public-release` |
  | `JOB_RANGER_WINDOWS_SIGN_PUBLISHER` | `MythologIQ Labs, LLC` |

- As of 2026-10-30 none of these variables or Azure secrets are set, so CI releases are unsigned.
- electron-builder authenticates with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`. Provisioning that identity is an owner decision.
- Microsoft Store packages (`electron-builder.store.cjs`, `windows-store-package.yml`) are signed by the Store and need no Artifact Signing.
