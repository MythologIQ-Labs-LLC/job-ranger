# Windows storage locations (#249)

**Normative contract for the Windows (Electron) app's Storage location setting. Owner decision 2026-11-02; [ARCH-005](../ARCHITECTURE_INDEX.md) as amended that day. Implemented on `feat/249-storage-locations` (on top of draft PR #369); not released and not live-provider qualified.** The PWA keeps its own local backup and restore UI and has none of this.

## What it is

A **Storage location** section in Settings with exactly three choices:

| Choice | Where files go | Access |
| --- | --- | --- |
| **This computer** | A local folder, default `%USERPROFILE%\Documents\Sojourner`, changeable with a folder picker; never inside (or containing) Sojourner's user-data folder, checked on both the typed path and the native real path, so a junction, symbolic link or 8.3 short name cannot place it there | Local file system only |
| **Google Drive** | A `Sojourner` folder the app creates in My Drive, with `Backups/` and `Documents/` | Google Desktop OAuth (#369), scope `https://www.googleapis.com/auth/drive.file` only |
| **OneDrive** | Microsoft Graph's app folder (`/me/drive/special/approot`, shown as *Apps > Sojourner*), with `Backups/` and `Documents/` | Microsoft identity platform, public client, scopes `Files.ReadWrite.AppFolder` and `offline_access` only |

Two kinds of files go to the selected location:

1. **Workspace backups.** A full `.jobranger` archive made by the existing streaming export (`BackupService.createArchive`, #344): automatic backups, and manual ones from **Back up now**.
2. **Exported documents.** A verified resume PDF (`resume:export-pdf`) and a JSON Resume file (`json-resume:export`) are copied to `Documents/` when exported. Cover letters have no file export today (they are copied to the clipboard), so none are copied.

**The working database always stays local.** The live SQLite database and managed files never move to, or are edited in, a location. This is backup and document copying, not live multi-PC editing. Another computer can restore a backup it finds at the same location, after the same validation as any backup.

## Data flow

```
workspace write ──> SQLite file change counter (header bytes 24-27, polled every 5 s)
                      │ quiet 10 min after the last change, at most 60 min after the first, or on quit
                      v
BackupService.createArchive (VACUUM INTO snapshot, streaming pack) -> private work file in the user-data root
                      │ name = Sojourner-backup-<automatic|manual>-<UTC timestamp>-<sha256[0..8]>.jobranger
                      v
record pending (migration 1011) -> journal remote reference -> upload -> record uploaded
                      │ byte readback, SHA-256 and size equal
                      v
record verified -> retention (automatic only) -> status "Last successful backup"
```

Restore: **Restore from this location** lists the files at the selected location. A chosen backup is downloaded (cloud) or copied (local) to a private temporary file in the user-data root, its SHA-256 is compared with the record when Sojourner recorded it, and then `BackupService.validateRestoreSource` runs the existing archive and bundle validation. **Open** (This computer) and **Download** (cloud) work only for PDF and JSON documents that Sojourner itself copied there and verified, after their size and SHA-256 still match the record; other files at the location (including anything executable or a shortcut) are listed but never launched or downloaded by Sojourner. The person sees the backup's date and contents and confirms that it replaces the current workspace after a restart; staging and the restart use the existing `backups:stage-restore` path, which validates again. Integrity checks are never skipped.

## Scheduling

- One operation at a time: backups, document copies, retention and recovery share one queue, so two backups never run concurrently. **Back up now** waits for a running backup.
- Change detection reads SQLite's file change counter, which every committed write increments (rollback-journal mode). Sojourner's own record writes are wrapped so they do not count as workspace changes; an ambiguous case counts as a change (at worst one extra backup, never a missed one).
- Automatic backup: 10 minutes after the last change, or 60 minutes after the first unbacked change, whichever is first. Selecting a location starts with a backup of the current workspace.
- Quit: if changes are unbacked and the location is usable, quitting waits for one automatic backup (bounded at 2 minutes).
- Failures are shown in the status (message and time) and retried after 1, 2, 5, 15, 30 and then every 60 minutes while changes remain unbacked. Document copies retry up to five times; the last failure stays visible.
- A clean point (the change counter after a fully successful backup) is stored in `storage-location.json`, so a crash or restart before a backup leaves the workspace marked as changed.

## Records and crash safety (migration 1011)

`storage_location_records` (`electron/src/storage/storage-records.cts`): id, provider, location key (folder path or verified account id), location label, remote id, remote path, name, size, SHA-256, kind (`automatic`, `manual`, `document`), status, error, created and updated times. No token, e-mail address or file content: the table is in the workspace database and so inside every backup archive. Cloud records store a provider-only label (`Google Drive > Sojourner`, `OneDrive > Apps > Sojourner`) and the opaque account id; the account's e-mail or display label is added only at display time from the live sign-in.

- States: `pending -> uploaded -> verified`, `pending | uploaded -> failed`, `verified -> deleted` (retention only). Every update is a compare-and-swap on the expected status; `failed` never becomes `verified`.
- The record is written `pending` before any byte is sent, and the remote reference (Google's reserved file id, or the path) is journaled before the request that can create a file.
- Recovery before every operation at a location: a `pending` or `uploaded` record whose file verifies becomes `verified`; one that is provably absent, or present but not matching, becomes `failed`; an unknown answer leaves it for later. Leftover local `.sojourner-partial-*` files are removed, and at every start Sojourner deletes the temporary archives and downloads (`.job-ranger-storage-work-*` in the user-data root) an interrupted run, a crash or a quit-flush timeout left behind. A crash mid-upload therefore never shows a backup as good, and an unverified backup is never offered for restore.
- The records describe files at locations, not the workspace, so a restore carries the live records into the staged database before it is verified (`BackupService.addRestoreCarryOver`). When this device has no records table yet, the staged table is emptied instead: records that arrived inside an archive describe another device's copies and never drive retention or verification here.
- A file at the location counts as Sojourner's copy only when it is the exact item recorded (Google and OneDrive item id, locally the path) with the recorded size. A file that now carries the name of one of Sojourner's copies but is a different item or size is listed as *replaced*, is never shown as verified, and is not offered for restore.
- Device settings (selected provider, local folder, retention, cached Google folder ids, clean point, last success) are in `storage-location.json` in the user-data root, outside `data/`, so restoring another computer's backup never changes where this computer backs up.

## Retention

Default: keep the newest **20** automatic backups at each location (configurable 1-200). After each verified automatic backup, older **verified automatic** backups that Sojourner itself recorded **at that location** are deleted, and only after the stored file still matches the record (same id and size; locally also the same SHA-256). Manual backups, documents and files Sojourner did not create are never deleted. A file changed outside Sojourner is kept and reported as a warning.

## Verification per provider

- **This computer:** copy to `.sojourner-partial-<uuid>` while hashing, `fsync`, refuse if the name exists, rename, then re-read and compare size and SHA-256.
- **Google Drive:** reserve a file id (`files.generateIds`), journal it, create with that id (multipart up to 5 MiB, resumable session in 8 MiB chunks above; a 409 means an earlier attempt landed), then check metadata (id, name, parent folder, size, `sojournerStorageRecord` marker) and a full `alt=media` readback SHA-256, as #369 does.
- **OneDrive:** unique names with `@microsoft.graph.conflictBehavior=fail` (a retried upload can never replace another file); simple `PUT .../content` up to 4 MiB, an upload session in 5 MiB chunks (multiples of 320 KiB) above; then compare the item id and size and the SHA-256 of a readback download. Graph's own hashes are not used (personal and business drives offer different ones, neither SHA-256).

## Sign-in and credential custody

- **Google:** #369's `GoogleDesktopAuth` and `safeStorage` credential, shared with Drive resume export. Disconnecting Google in Storage location also disconnects resume export (one Google grant), revokes at Google best effort and deletes the stored sign-in.
- **Microsoft:** `electron/src/storage/microsoft-auth.cts`. System browser, authorization code with PKCE (S256), independent 256-bit state compared in constant time, tenant `common`, `prompt=select_account`, redirect `http://localhost:<ephemeral port>` (the registration's `http://localhost`; Microsoft accepts any port for loopback). The one-shot receiver listens on `127.0.0.1` and `[::1]` on the same port; if another program already holds `[::1]` on the chosen port, both are retried on a fresh port (up to five pairs), and it continues on `127.0.0.1` alone only on a machine without an IPv6 loopback. It accepts only `GET /` with the exact state and closes after the first decisive callback, a cancel or 5 minutes. No client secret exists. A grant without `Files.ReadWrite.AppFolder` or without a refresh token is refused. The account is identified by the app folder's `parentReference.driveId`, so no identity or profile scope is requested. Refresh tokens rotate; the newest is kept.
- **Custody (both):** access tokens only in main-process memory; refresh tokens only encrypted with Electron `safeStorage` (DPAPI) in the user-data root (`google-drive-credential.bin`, `microsoft-onedrive-credential.bin`), outside `data/`, so never in SQLite, logs, URLs, backups, archives or IPC. Without encryption the sign-in lasts for the session only, nothing is written, and Settings says so.
- **Disconnect:** stops syncing to that provider (it stops being the selected location), deletes the stored token, and revokes best effort. The Microsoft identity platform has no endpoint with which a public client can revoke its own refresh token, so Sojourner deletes it and tells the person where to remove the app's access (`account.live.com/consent/Manage` or `myapps.microsoft.com`). Earlier copies stay where they are.

## Network egress

`electron/src/storage/storage-egress.cts` is the only path for storage requests. It refuses everything except:

- `www.googleapis.com`: `GET|POST|DELETE /drive/v3/files[/<id>]` and `POST|PUT /upload/drive/v3/files` (token refresh stays on #369's Drive egress);
- `login.microsoftonline.com`: `POST /common/oauth2/v2.0/token` (no revocation endpoint exists; `authorize` is opened only in the system browser, never fetched);
- `graph.microsoft.com`: `/v1.0/me/drive/special/approot`, `.../approot/children`, and `.../approot:/Backups|Documents[/<name>][:/children|:/content|:/createUploadSession]` with the method each needs;
- an upload-session or download URL that Graph itself just returned, only over https on a Microsoft content domain (`*.1drv.com`, `*.onedrive.com`, `*.sharepoint.com`, `*.microsoftpersonalcontent.com`, `*.livefilestore.com`, `*.storage.live.com`), only for the granted method and number of requests, and never with an `Authorization` header. An upload-session grant lasts until Graph's `expirationDateTime` (bounded to 15 minutes .. 24 hours) and is renewed after every accepted chunk, so a large archive on a slow link does not fail; a download grant is single use.
- OneDrive listings follow `@odata.nextLink` pages only while they stay on the same app-folder children path (at most 1000 files per folder) and are sorted newest first in Sojourner; a next page anywhere else stops the listing and it is marked truncated.

No redirects are followed (Google's resumable `308 Resume Incomplete` is passed through for upload PUTs only), timeouts apply (30 s; transfers 30 min), JSON answers are capped at 1 MiB and downloads at 2 GiB - 1, streamed to disk. No telemetry. Nothing else leaves the device.

## Build configuration

- Google: #369's `JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID` / `_SECRET`.
- Microsoft: repository variable `JOB_RANGER_MICROSOFT_CLIENT_ID` (an application id; no secret) passed by `release-build.yml` to the Windows build; `scripts/write-microsoft-oauth-client.mjs` validates it and writes `build/microsoft-oauth/microsoft-client.json`, which `electron-builder.json` copies into resources. A packaged app reads only that file; a development run may use the environment variable.
- A provider without a configured client is shown disabled with the reason; no request is made to it. Packaged builds enable storage locations on Windows only; non-packaged runs (development, E2E) enable them on every platform.

## Failure states shown to the person

Not connected; finish signing in in the browser; sign-in could not be unlocked on this device (disconnect and reconnect); session-only sign-in; last backup failed (with reason and time) and when the next attempt is due; changes not yet backed up; a document was not copied; retention kept a changed file; a backup was never verified (not offered for restore); a backup changed since it was verified (not restored); the location holds more files than listed.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Token theft from disk, backups or logs | Refresh tokens only `safeStorage`-encrypted outside `data/`; access tokens in memory; nothing logged; nothing on IPC |
| Broad cloud access | `drive.file` (only files Sojourner created) and `Files.ReadWrite.AppFolder` (only the app folder); scope checked on every grant |
| Authorization code interception by local software | PKCE S256, single-use 256-bit state, loopback-only receiver on both loopback addresses, one-shot, 5-minute limit |
| Request smuggling to other hosts or paths | Exact egress allowlist; content URLs only when Graph returned them, on Microsoft content domains, without tokens; no redirects |
| A malicious or corrupted backup at the location | Full existing archive and bundle validation before staging, again at staging; recorded SHA-256 compared first |
| A crash or outage mid-upload counted as a good backup | pending/uploaded/verified states, compare-and-swap, readback verification, recovery before every operation |
| Retention deleting someone's files | Deletes only verified automatic records Sojourner made at that location, after re-checking id, size (and locally the hash) |
| Duplicates or overwrites on retry | Google reserved ids (409), OneDrive `conflictBehavior=fail`, local no-overwrite rename |
| Live database corruption through a sync client | The live database never leaves the user-data folder; only archives are copied; the local folder may not be inside the user-data folder |
| Oversized responses / disk exhaustion | Response caps, streamed downloads capped at the archive limit, temporary files removed |

## Tests

`tests/storage-locations-providers.test.cjs` (egress allowlist and grants, retry/401 refresh, This computer, Google through `tests/support/fake-google-storage.cjs` over #369's fake, OneDrive through `tests/support/fake-onedrive.cjs`), `tests/storage-locations-service.test.cjs` (Microsoft sign-in, migration 1011, crash states, carry-over, change monitor, scheduler debounce, no concurrency, retry, quit flush, retention, documents, recovery, restore, switching), `tests/storage-locations-boundary.test.mjs` (build configuration, channel parity, PWA isolation, no logging, scopes) and `tests/e2e/storage-location.spec.ts` (Electron: local backup and restore round trip, quit flush, document copy, Google and OneDrive fakes, unconfigured and disconnected states). Lanes: `npm run test:storage-locations`, `npm run test:e2e:storage`.

**Qualification outstanding:** live consent, upload, readback, restore, refresh after restart and disconnect with the real Google Desktop client and the real Microsoft registration on the signed, installed NSIS build; personal and work-or-school Microsoft accounts; independent security review.
