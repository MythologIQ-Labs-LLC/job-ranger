# G4 Google Drive transport plan (#286, #249)

**Status:** Plan only. Nothing here is implemented or authorized. G4 starts only after G3 is independently reviewed and the owner approves. It does not authorize merging #260, #261 or #262, changing OAuth scopes, or a release.

**Built on:** the G3 contract on `impl/286-g3-agent-workspace`. Agents write `jr-agent-operation-batch` v2 files and `jr-agent-batch-commit` v1 markers. The trusted receipts and the v2 ledger live only in Job Ranger's local database. `syncAgentWorkspace(store, canonical, submissions)` is the single import path. `scanWorkspaceFiles([{ path, bytes }])` already turns a folder listing into submissions.

## What G4 adds

G4 adds one new input source: a Drive folder listing turned into the same `{ path, bytes }` list. Everything after that already exists and stays identical:
- reconciliation;
- contest handling;
- review;
- governed decisions.

Drive is transport. It is never a trust anchor and never receives receipts, ledgers or decisions.

## Steps

1. **User-visible folder, chosen by the user.**
   - The Google Picker selects a normal, visible "Job Ranger agent workspace" folder.
   - Job Ranger stores the folder's Drive file ID and the user's account ID in local settings. Never hard-code a path.
2. **`drive.file` only.**
   - Use the narrow scope with Picker-granted access. No `drive` or `drive.readonly`, no hidden appDataFolder for agent exchange.
   - Expanding scope needs a separate owner decision.
3. **Containment by provider IDs, not names.**
   - List with pagination.
   - Accept only files whose parent chain resolves to the stored folder ID through `workspace/agents/<actor>/batches/` and `workspace/attachments/`.
   - Record `fileId`, `parents`, `md5Checksum`/`sha256Checksum` when available, `size`, `mimeType`, `modifiedTime` and `trashed`. Ignore trashed files.
   - Treat names as display only; resolve duplicates by file ID.
   - A shortcut, a file outside the folder or one in a shared drive the user didn't pick is skipped and reported.
4. **Original bytes only.**
   - Download with `alt=media`. Refuse Google-native MIME types (Docs, Sheets), because a converted document is not machine input.
   - Require `application/json` for batches and markers, and the allowlisted media types for attachments.
   - Recompute SHA-256 locally. Drive checksums are hints, not proof.
   - Enforce the existing size limits before and during download.
5. **Completion marker last, then verify.**
   - Agents upload attachments, then the batch, then `<batch_id>.commit.json`.
   - Job Ranger fetches only batches whose marker exists. The reconciler verifies marker, batch and attachment digests and the exact attachment inventory (D01/D02).
   - A partial upload stays `incomplete` and is retried on the next sync.
6. **Exports go up, receipts stay local.**
   - "Export for agents" writes the packet files into `exports/<export_id>/` in the chosen folder.
   - The receipt is recorded locally first, as it is now.
   - Upload with resumable sessions. After upload, re-download and verify every digest against the local receipt before telling the user the export is ready.
7. **Separately authorized agent access.**
   - The user shares the folder with their agent's own Google identity, or gives the agent its own `drive.file` grant.
   - Job Ranger never hands its token to an agent.
   - Agent identity stays a claim (D12). An optional later step can bind an actor namespace to the Drive account that owns the files (`owners[]`/`lastModifyingUser`), reported as provenance, never as authority.
8. **Token custody** (#250, #258, #264):
   - **Electron:** loopback PKCE, refresh token in the OS credential store, never in the database or a backup.
   - **PWA:** short-lived access tokens only, held in memory and isolated from the Career Ops origin per #264. The user re-authorizes when the token expires, and the PWA doesn't claim unattended refresh.
9. **Failure and recovery:**
   - Revoked access, a deleted folder, quota, offline and rate limits are all shown as sync errors that change no local state, because the commit is atomic.
   - Lost permissions surface a "reconnect folder" action.
   - A folder whose ID changed is treated as a new workspace that needs a new export.
10. **New device** (#255, decision E):
    - Trust starts only from a restored `.jobranger` backup, which carries the workspace ID, receipts and ledger. G3 tests prove the backup carries this state.
    - A remote manifest never re-creates a receipt.

## Acceptance tests to write first

- **Listing:** order permutations and pagination splits give an identical commit (reuse the 256-permutation and split-sync harness with a fake Drive client).
- **Refusals:** files moved out of the folder, trashed files, shortcuts and same-name files are refused or ignored by ID.
- **MIME:** a native Google Doc and a MIME/extension mismatch are refused.
- **Interrupted transfers:**
  - interrupted download, marker before batch, and attachment replaced after marker;
  - each must leave nothing imported and quarantine with reasons.
- **Export:** an upload that is re-downloaded with a flipped byte is detected and the export isn't reported ready.
- **Token loss:** token expiry or revocation in the middle of a sync makes no local writes.
- **Electron credentials:** refresh tokens are absent from SQLite, backups and logs.
- **PWA:** no token persistence, and the #264 isolation tests stay green.
- **End to end:** a real-account smoke test (owner-run, never in CI) with a throwaway folder covers export, agent writes and sync.

## Out of scope for G4

- Background or unattended sync (#256).
- OneDrive.
- Automatic promotion of agent drafts or proposals into canonical data. The domain intake paths for evidence proposals and material drafts are separate issues.
