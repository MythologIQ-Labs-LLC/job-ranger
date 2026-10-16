# Google Drive export (desktop) — #314, partial

Status: **development line, desktop app only, not live-verified.** This slice lets a person save a verified resume PDF into their own Google Drive after reviewing and approving that exact file. It is a partial delivery of [#314](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/314). It does not implement the web app (PWA) path, cover letters or other artifact types, or the workspace snapshot/backup project #249, and it must not be used to close #249.

Nothing here claims that Google's consent-screen configuration, publishing status, brand verification or any other Google review has been completed. Those are owner tasks listed below.

## What the person sees

1. **Settings → Google Drive → Connect Google Drive.** Job Ranger opens Google sign-in in the system browser. The page in Job Ranger shows *Waiting for you to finish signing in…* with **Cancel sign-in**. Google asks only for access to files Job Ranger creates.
2. After consent the browser shows *You can close this tab and return to Job Ranger*, and Settings shows the connected account and how the sign-in is stored (encrypted on this device, or for this session only).
3. **Resume → Exported versions → Save to Google Drive** on a verified PDF opens a review dialog: exact file name, format (PDF) and version, size, page count, what the PDF was generated for (target job or general draft), SHA-256, destination **My Drive › Job Ranger**, and the connected account. Nothing is sent until **Approve and upload**.
4. The receipt shows the file name, Drive file ID, verification time, SHA-256, destination and **Open in Google Drive**. Errors explain what to do: **Retry**, **Reconnect Google Drive**, or **Review again**.
5. A PDF already saved to the connected account shows *Already saved to Drive on …* with **Open in Google Drive** and an explicit **Save another copy**. A copy that failed verification is shown with a link and needs an explicit **Upload a new copy**. An upload whose outcome is unknown must be resolved first: **Retry upload**, or **Abandon this attempt** (the record is kept, and the dialog warns that a copy may already be in Drive).
6. Exports are bound to the Google account they were approved for. After switching accounts, earlier exports are listed as *Saved to <other account>*; they do not block an upload to the new account, and an unfinished attempt from the other account can only be retried with that account (or abandoned).
7. **Settings → Disconnect Google Drive** revokes Job Ranger's grant at Google and deletes the stored sign-in.

If the build has no Google client configured, Settings says *This build has no Google Drive client configured…* and the Resume button is disabled with the same explanation. Manual PDF download always works.

## Owner setup

You need a Google Cloud project you control. Use a dedicated project for Job Ranger.

1. **Create or select a project** in the Google Cloud console.
2. **Enable the Google Drive API** (APIs & Services → Library → Google Drive API → Enable).
3. **Configure the OAuth consent screen** (Google Auth Platform → Branding, Audience, Data access):
   - App name, user support email and developer contact email. Add a logo, home page, privacy policy and terms links only if you are prepared for Google's brand verification of them.
   - Audience: **External**.
   - Data access: add exactly `https://www.googleapis.com/auth/drive.file` and no other scope. Google documents `drive.file` as its recommended, non-sensitive Drive scope ("see, edit, create and delete only the specific Google Drive files you use with this app"). Do not add `drive`, `drive.readonly`, `drive.metadata` or any other scope; the app would not request them, and they trigger restricted-scope review.
4. **Publishing status.** Decide and verify yourself; this document does not assert either is approved:
   - **Testing:** only the test users you list (up to 100) can sign in, and Google expires their refresh tokens after **7 days**. Job Ranger then reports *Google access … expired or was revoked. Reconnect Google Drive*, which is expected in this mode.
   - **In production:** anyone with a Google account can sign in. Check Google's current requirements for an app requesting only non-sensitive scopes (typically brand verification when you display a name/logo, and an unverified-app screen otherwise). Confirm the actual status in the console before advertising the feature.
5. **Create the OAuth client:** Clients → Create client → Application type **Desktop app**. Name it (for example "Job Ranger desktop"). Copy the **client ID** (`<digits>-<id>.apps.googleusercontent.com`) and the client **secret**.
   - Desktop clients use the loopback redirect `http://127.0.0.1:<random port>`; there is no redirect URI to register.

### The Desktop client secret is not confidential

Google issues a "client secret" for Desktop-app clients, but it is shipped inside every copy of the application and anyone can extract it. Job Ranger treats it as **public application configuration**, not as a credential. Security comes from:

- PKCE (S256) binding each authorization code to a verifier that never leaves the device,
- a random `state` checked in constant time,
- the one-shot loopback receiver on 127.0.0.1, and
- the person's own consent on Google's page.

Keep the value out of the repository (it is generated at build time) to avoid unreviewed client swaps, not because it is secret.

### Local development runs

```powershell
$env:JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID = "<client id>"
$env:JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET = "<client secret>"
npm run electron:dev
```

Environment values are read only by non-packaged runs. Without them the feature reports "not configured".

### Packaged builds (Windows NSIS, macOS, Store package)

Packaging hook: `scripts/write-google-oauth-client.mjs` runs immediately before electron-builder in `npm run electron:build`, `electron:build:win` (NSIS), `electron:build:mac`, `electron:pack` and `electron:build:store`. It writes `build/google-oauth/google-desktop-client.json` (git-ignored), and `electron-builder.json` copies it to `resources/google-oauth/google-desktop-client.json` for Windows and macOS. A packaged app reads only that file; it ignores the environment and the test override.

Environment inputs for the packaging job:

| Variable | Purpose |
| --- | --- |
| `JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID` | Desktop-app OAuth client ID |
| `JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET` | Desktop-app client "secret" (not confidential; see above) |
| `JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT` | `1` makes a missing client fail the build (use for builds that advertise Drive export) |

Both values absent: the build succeeds and shows Drive as not configured. Only one present, or a malformed ID: the build fails. The release workflow should pass the two variables (for example from repository variables or secrets) to the steps that run `npm run electron:build:win` and `npm run electron:build:mac`.

## Data handling

- **What Google receives:** the OAuth requests, then for each approved export the PDF bytes, the file name, and app properties `jobRangerOperationId`, `jobRangerArtifactId` and `jobRangerSha256` (used to find the file again on retry). Job Ranger also asks Drive who the account is (`about.get` with `user(emailAddress,displayName,permissionId)`) to show it and to bind exports to it, and reserves file ids with `files.generateIds`. "Local first" here means Job Ranger has no cloud proxy or account system; it does not mean zero communication with Google.
- **Egress:** every Google request goes through one main-process transport that refuses any origin except `https://accounts.google.com`, `https://oauth2.googleapis.com` and `https://www.googleapis.com`, does not follow redirects, and times out. The renderer never contacts Google.
- **Tokens:** the access token lives only in main-process memory. The refresh token is encrypted with Electron `safeStorage` (OS keychain/DPAPI) in `google-drive-credential.bin` (mode 0600) at the root of the user-data folder. If the OS cannot encrypt (including Linux without a keyring), it is kept in memory for the session only and Settings says so. If a stored credential cannot be decrypted at the moment (for example a locked keychain), it is kept and Settings says so; only a file that decrypts to something that is not a credential is deleted. A refresh token rotated by Google is saved in place of the old one. Tokens are never written to SQLite, logs, backups or sent to the renderer.
- **Backups:** `.jobranger` backups contain the database and managed artifacts under `data/`; the credential file sits outside `data/` and is never included. The export journal (below) is in the database and is included; it holds no tokens.
- **Journal:** table `drive_exports` (feature migration 1010) records operation ID, artifact ID, SHA-256, file name, size, state (`approved`, `uploading`, `verified`, `failed`, `unknown_remote_outcome`, `abandoned`), the reserved Drive file ID, Drive file ID, Drive link, error code/message, the Google account (Drive `permissionId` and email) and timestamps. Drive links are re-validated when read, because a restored backup is untrusted. A development database that applied the first, unreleased shape of migration 1010 is rebuilt in place (rows kept) to gain the new columns and the `abandoned` state.
- **Scope:** `drive.file` only. Job Ranger cannot list or read anything in Drive except the files and the "Job Ranger" folder it created.

## Upload, verification and retry semantics

Approve → re-read the managed PDF (path must be inside Job Ranger's artifacts folder) → recompute SHA-256 → compare with the stored verified hash and with the hash the person reviewed. Any difference is **file changed**; nothing is sent.

The journal row is written (state `approved`) with a new operation ID **before any network call**. Job Ranger then reserves a Drive file ID with `files.generateIds` and saves it in the row **before the upload**. Then: `uploading` → find or create the app-owned "Job Ranger" folder (serialized and cached per account) → one multipart upload that creates the file **with the reserved ID** → read the file back by that ID and compare size and SHA-256 (MD5 when Drive omits SHA-256) → `verified`.

Why this cannot duplicate: `files.get` on a known ID is strongly consistent, whereas a `files.list` search can miss a file that was just created. Recovery therefore reads the reserved ID: found means the earlier attempt landed and is verified without uploading; 404 means uploading again with the same ID is safe. If an earlier request commits late, Drive refuses the second create with 409 ("already exists"), which is treated as "exists" and verified. The `appProperties` operation-ID search remains only as a fallback for rows that have no reservation.

| Outcome | Journal state | What Retry does |
| --- | --- | --- |
| Verified | `verified` | Returns the receipt; no network |
| Rejected before or by Drive (401 after refresh, 403 scope/quota/rate limit, 429, other 4xx), or offline before the upload started | `failed` | Reads the reserved ID, then uploads with that same ID |
| Timeout, connection lost, 5xx, or unreadable response after the upload started | `unknown_remote_outcome` | Reads the reserved ID; if present, verifies it (no second upload); otherwise uploads with the same ID (a late original is refused with 409 and verified) |
| App closed or crashed after the ID was reserved, before or during upload | `approved` or `uploading` | Same as unknown outcome |
| Drive's copy differs from the local PDF | `failed` (`verification_failed`), Drive file ID and link kept | Not retryable; the review offers **Upload a new copy** and a link to the non-matching copy |
| The uploaded file is in Drive's trash | `failed` (`remote_trashed`), file ID and link kept; blocks a new upload | Restore it in Drive, then Retry verifies the same file; or abandon |
| Drive refuses the reserved ID (`fileIdNotUsable`) | `failed` (`reserved_id_rejected`); blocks a new upload | Not retried (never re-POSTs a refused ID); abandon, then upload a new copy |
| Person gives up on an unresolved attempt | `abandoned` | Nothing; the record is kept and a new upload is allowed |
| Attempt approved for another Google account | unchanged | Refused (`account_mismatch`) until that account is connected; can be abandoned |

Within one Google account, an artifact with an unresolved upload (`approved`, `uploading`, `unknown_remote_outcome`) cannot start a new one until it is retried or abandoned. A second copy of an artifact already verified (or left as a non-matching copy) in that account needs an explicit choice. Concurrent approvals of one artifact are refused while one is running. A new upload always needs a new explicit approval; Retry only continues the same approved operation with the same reserved file ID.

Stale requests from the window are refused, not executed: an approval carries the account ID (Drive `permissionId`) and SHA-256 from the reviewed proposal and is refused if the connected account or the file changed since the review; a retry of an operation approved for another account is refused (`account_mismatch`); a sign-in is started with an ID chosen by the window, and a cancel must name that ID, so it cannot cancel a later sign-in or one started elsewhere. Accounts are identified only by `permissionId`; the email is a display label. Disconnect deletes only the credential and session; journal rows are kept.

Error codes surfaced to the UI: `not_configured`, `not_connected`, `auth_cancelled`, `auth_failed`, `auth_in_progress`, `auth_expired` (reconnect), `insufficient_scope` (reconnect and keep the permission), `rate_limited`, `storage_quota`, `server`, `network`, `timeout`, `verification_failed`, `file_changed`, `export_in_progress`, `already_exported`, `account_mismatch`, `remote_trashed`, `reserved_id_rejected`, `remote_rejected`, `invalid_response`, `invalid_request`.

## Sign-in details

Authorization code flow with PKCE S256 and random `state`; loopback receiver bound to `127.0.0.1` on an ephemeral port; redirect URI `http://127.0.0.1:<port>`; parameters `client_id`, `redirect_uri`, `response_type=code`, `scope=drive.file`, `code_challenge`, `code_challenge_method=S256`, `state`, `access_type=offline`, and always `prompt=consent`. The receiver accepts only `GET /`; a request without the exact `state`, or with it but without `code` or `error`, is answered 400 and the sign-in keeps waiting, so stray or forged requests cannot end it. `error=access_denied` is a cancellation. It answers with a static page that reflects nothing, and closes after the first decisive callback, an explicit cancel, or 5 minutes. One sign-in runs at a time (claimed before any asynchronous step). The token response must have `token_type` Bearer, a refresh token, and a granted `scope` that includes `drive.file` (otherwise it is refused and revoked). The account is identified with `about.get` (`permissionId`). Connecting a different account revokes the previous account's grant before the new credential is saved (if that revoke fails, Settings shows how to remove it at myaccount.google.com/permissions); reconnecting the same account replaces the token without revoking (Google revokes a whole grant at once). Cancel and Disconnect invalidate an in-flight sign-in; this is re-checked after every step and again after the credential is written, so a late sign-in cannot undo a disconnect. The in-memory access token is bound to its account and is never used for another, and a refresh that finishes after an account switch neither becomes the access token nor overwrites the new credential. `invalid_grant` on refresh deletes the stored credential and asks the person to reconnect.

## Tests

- `tests/google-drive-auth.test.cjs` — PKCE vector, loopback receiver (state mismatch, replay, unrelated requests, cancel, timeout), token-exchange failures (PKCE verifier rejection, redirect mismatch, 400/500, malformed JSON), scope enforcement, credential custody (encrypted, session-only, encryption failure), refresh `invalid_grant`, egress allowlist, error classification, client configuration.
- `tests/google-drive-export-smoke-test.cjs` — journal migration, review, upload, verification, error classification, concurrency and token hygiene against SQLite.
- `tests/google-drive-export-recovery.test.cjs` — duplicate safety with an eventually consistent fake `files.list` (timeouts after Drive stored the file, late commits answered with 409, resets, 5xx before and after commit, malformed responses, crashes between reservation and upload and after upload), non-matching copies, abandon, account binding across a reconnect, folder serialization and replacement, and untrusted journal links. Both run on the SQLite WASM engine as well.
- `tests/google-drive-packaging.test.mjs` — packaging hook and electron-builder wiring.
- `tests/e2e/drive-export.spec.ts` — Electron UI against a loopback fake Google: connect, review, approve, byte-exact upload, Open in Drive, timeout + retry without duplicate while searches lag, disconnect with revocation, relaunch after a crash during upload, cancelling a reconnect started from the review dialog (button and closing the dialog), and switching to a second Google account.

Test-only hooks, honoured only when `app.isPackaged` is false: `JOB_RANGER_GOOGLE_TEST_BASE_URL` (must be an `http://127.0.0.1:<port>` or `http://localhost:<port>` origin; it replaces all three Google origins) and `JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS`. No test uses the real Google network.

## Live verification checklist (owner, at an exact commit)

Record sanitized evidence only: no tokens, authorization codes, client secret or personal documents.

1. Build a packaged Windows NSIS installer with the two client variables set and `JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT=1`; confirm `resources/google-oauth/google-desktop-client.json` exists in the install folder.
2. On a clean Windows account, connect a test Google account listed as a test user. Confirm the consent screen lists only "see, edit, create and delete only the specific Google Drive files you use with this app".
3. Open **Help → Open Job Ranger Data Folder** and confirm `google-drive-credential.bin` exists there and does not contain readable text, and that a new `.jobranger` backup does not contain it.
4. Export a verified resume PDF, approve, and confirm the receipt. In Drive, confirm the file is in **My Drive › Job Ranger**, opens, and its SHA-256 (download and hash) matches the receipt.
5. Disconnect Wi-Fi mid-upload or before approval; confirm the error, then Retry after reconnecting creates exactly one file.
6. Deny consent once (Cancel on Google's page) and confirm *not connected*.
7. Revoke Job Ranger at myaccount.google.com/permissions, try another export, and confirm *Reconnect* is requested and the credential file is deleted.
8. Disconnect in Settings and confirm the grant disappears from myaccount.google.com/permissions.
9. Repeat 2–4 on macOS if a macOS build will advertise the feature.
10. If the consent screen is in Testing, note the 7-day refresh-token expiry in the evidence.

## Known limits

- Desktop only. The web app reports *available in the desktop app only*; a separate web OAuth client and Google Identity Services path is still open in #314.
- Only verified resume PDFs, up to 5 MB (Drive multipart upload).
- New file per approval; no replace/version behavior.
- If the person trashes or deletes the "Job Ranger" folder, the next export creates a new one.
- Abandoning an unresolved attempt can leave a copy in Drive if that attempt did land; the dialog says so.
- A file that fails verification stays in Drive (Job Ranger does not delete remote files) and is reported, never shown as saved.
