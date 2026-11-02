# Snapshot provider contract: user-initiated share and review-before-import

**Deferred design contract — not implemented; no automatic sync.**

**Status:** deferred (see `GOVERNANCE.md` status language). It records design limits for [#257](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/257). No Sojourner code implements, invokes or ships it, and merging this document authorizes no implementation.  
**Owner decision (2026-11-02):** the agent-first Drive/sync family is rescoped to **explicit, user-initiated actions only**: *share snapshot* and *review-before-import*. Both are **off by default**. There is **no automatic, background or scheduled sync** and **no app-side pruning, retention or deletion** of remote files. PR #262 merges as this document only.  
**Architecture authority:** [`docs/ARCHITECTURE_INDEX.md`](../ARCHITECTURE_INDEX.md). Google Drive export is also bound by ARCH-004 and ARCH-005. User-facing copy says "Sojourner"; internal `job-ranger` identifiers (package names, the `.jobranger` archive suffix, storage namespaces) are unchanged.

## Runtime priority

Owner direction since 2026-11-02 makes the signed **Windows application (Electron) the primary deliverable**, and the browser **PWA continues**. Any future provider adapter is specified for both runtimes behind the same contract, with the Windows app first. Browser OAuth stays a separate requirement (ARCH-005): a desktop OAuth client or native credential store does not satisfy PWA acceptance.

`docs/ARCHITECTURE_INDEX.md` ARCH-001 and ARCH-002 still describe the PWA as the sole product runtime and Electron as an internal harness. This document does not amend that index. Reconciling the index with the Windows-first direction is a separate owner change.

## Scope: two explicit actions

| Action | What the user does | What Sojourner does | What it never does |
| --- | --- | --- | --- |
| **Share snapshot** | Turns the feature on, connects a provider, and clicks **Share snapshot** for one snapshot to one shown destination folder. | Builds the snapshot from canonical local data, shows exactly what will be sent and where, uploads only those approved bytes, then verifies a readback before it reports success. | Upload on a timer, on launch, on change or in the background. Overwrite or delete remote files. Expose a token or write API to an agent. |
| **Review before import** | Picks one remote snapshot from the app's folder and clicks **Review**. | Downloads those bytes and runs the existing local restore validation and staging. Nothing changes until the user confirms the restore. | Merge, apply or "sync" remote data automatically. Silently rewrite Career Evidence (ARCH-004). Import from outside the user-selected file. |

Retention is the user's job. Users remove old snapshots in the provider's own interface, and Sojourner has no prune, retention-count or cleanup operation. The earlier prototype's `pruneSnapshots` is withdrawn.

## Status vocabulary: reuse the artifact export states

Share snapshot is an artifact export. It reuses the export-status vocabulary of `src/shared/artifact-export-approval.ts` (Drive artifact export, #314) and adds no parallel snapshot states. That module is on PR #315 (`docs/314-drive-artifact-export-contract`) and **not yet on `main`**. This contract follows the module as it merges.

| `ExportStatus` | Meaning for a shared snapshot |
| --- | --- |
| `prepared` | Snapshot bytes built, SHA-256 and length computed, and the proposal shown; nothing sent. |
| `cancelled` | The user declined the proposal; nothing sent. |
| `uploading` | Upload started after a fresh human approval of those exact bytes, that account and that destination. |
| `accepted_unverified` | The provider acknowledged a file ID. This is **not** success copy. |
| `verified` | A provider readback matches the approved digest and length. Only this state may be shown as "shared". |
| `unknown_remote_outcome` | The outcome is ambiguous (for example a lost connection). Reconcile first; never retry automatically. |
| `verification_failed` | The readback did not match. Never shown as success. |
| `failed` | Proven to hold no remote file, under the evidence rules of that module. |

Approval follows the same module: one short-lived, human-minted approval bound to digest, byte length, account and destination, consumed once. A snapshot would be another approved artifact kind under that module, not a separate `explicit_share_snapshot` approval type. The prototype's `SyncConnection`, `UploadOutcome` and `PruneResult` unions are withdrawn. Connection state belongs to the Drive OAuth work ([#252](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/252)), not to this contract.

Review before import adds **no remote status machine**. Either the download yields bytes or it fails with a recoverable message. The bytes then go through the existing two-phase restore in [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md): validate and stage, then an explicit, confirmed restore.

## Contract limits for any future adapter

These rules carry forward from the withdrawn prototype and bind any later implementation:

1. **User gesture.** Each share or review starts from a human click in a trusted UI control. A stored consent record never authorizes a new upload.
2. **Exact bytes.** Build snapshots from canonical local data through the existing archive validator. Compute SHA-256 from the actual Blob before showing consent, and never trust a declared digest or a third-party filename. Filenames are validated (no traversal, control characters or trailing dots or spaces).
3. **Bounded scope.** List only the app-created or user-authorized folder, bounded per page, with no account-wide listing. Re-check account, scope and folder identity immediately before transfer.
4. **Verified success only.** Report `verified` only after the provider readback matches. Do not auto-repeat a possibly successful upload. On failure, keep offline manual export available.
5. **Recoverable failures.** CORS, an expired token, popup policy, insufficient scope and service errors each map to a specific recoverable message, never to success.
6. **Not a security boundary against first-party code.** Client-side checks are defense in depth; caller-supplied flags are not cryptographic proof of consent.

## Agent sharing is separate authorization

Sojourner's `drive.file` grant belongs to **Sojourner's** OAuth app. It does not give ChatGPT, Claude or any other agent the same access, or guarantee that the agent can see a shared snapshot. An agent needs its own user-approved Drive connection and its own read-only, minimized data contract. Do not use Google `appDataFolder` if users or agents are expected to see the files: that folder is hidden from other apps and needs a different scope. <https://developers.google.com/workspace/drive/api/guides/appdata>

## Decisions and open items

- [#256](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/256) (trigger and UI): **decided**, user-initiated only and off by default. The exact UI and disclosure copy remain open.
- [#251](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/251) (retention and deletion): **decided**, no app-side pruning or retention.
- [#255](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/255) (snapshot format): open. The choice is between the existing `.jobranger` archive and a minimized snapshot. The provider treats the bytes as opaque either way.
- [#254](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/254) (user-facing privacy and help text): open, and required before anything ships.

## Withdrawn prototype

PR #262 first carried a TypeScript prototype, `src/shared/snapshot-sync.ts`, and its test, `tests/sync-provider-contract.test.mjs`. Both were removed before merge and are not on `main`; they remain in the PR #262 history (`d39c74f`…`a94de8c`). Any implementation needs a new, separately reviewed slice that reuses `artifact-export-approval.ts` once it is on `main`. That slice needs fake-provider conformance tests, real-account evidence, a tested manual-export fallback and user-facing documentation. There is no OneDrive work until a need is shown.
