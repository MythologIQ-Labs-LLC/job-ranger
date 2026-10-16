# Google Drive export (desktop) — #314, partial

Status: **development line, desktop app only, not live-verified.** This slice lets a person save a verified resume PDF into their own Google Drive after reviewing and approving that exact file. It is a partial delivery of [#314](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/314). It does not implement the web app (PWA) path, cover letters or other artifact types, or the workspace snapshot/backup project #249, and it must not be used to close #249.

Nothing here claims that Google's consent-screen configuration, publishing status, brand verification or any other Google review has been completed. Those are owner tasks listed below.

## What the person sees

1. **Settings → Google Drive → Connect Google Drive.** Job Ranger opens Google sign-in in the system browser. The page in Job Ranger shows *Waiting for you to finish signing in…* with **Cancel sign-in**. Google asks only for access to files Job Ranger creates.
2. After consent the browser shows *You can close this tab and return to Job Ranger*, and Settings shows the connected account and how the sign-in is stored (encrypted on this device, or for this session only).
3. **Resume → Exported versions → Save to Google Drive** on a verified PDF opens a review dialog: exact file name, format (PDF) and version, size, page count, what the PDF was generated for (target job or general draft), SHA-256, destination **My Drive › Job Ranger**, and the connected account. Nothing is sent until **Approve and upload**.
4. The receipt shows the file name, Drive file ID, verification time, SHA-256, destination and **Open in Google Drive**. Errors explain what to do: **Retry**, **Reconnect Google Drive**, or **Review again**.
5. A PDF already saved shows *Already saved to Drive on …* with **Open in Google Drive** and an explicit **Save another copy**. An upload whose outcome is unknown can only be retried.
6. **Settings → Disconnect Google Drive** revokes Job Ranger's grant at Google and deletes the stored sign-in.

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

- **What Google receives:** the OAuth requests, then for each approved export the PDF bytes, the file name, and app properties `jobRangerOperationId`, `jobRangerArtifactId` and `jobRangerSha256` (used to find the file again on retry). Job Ranger also asks Drive for the account email (`about.get` with `user(emailAddress,displayName)`) to show which account is connected. "Local first" here means Job Ranger has no cloud proxy or account system; it does not mean zero communication with Google.
- **Egress:** every Google request goes through one main-process transport that refuses any origin except `https://accounts.google.com`, `https://oauth2.googleapis.com` and `https://www.googleapis.com`, does not follow redirects, and times out. The renderer never contacts Google.
- **Tokens:** the access token lives only in main-process memory. The refresh token is encrypted with Electron `safeStorage` (OS keychain/DPAPI) in `google-drive-credential.bin` (mode 0600) at the root of the user-data folder. If the OS cannot encrypt (including Linux without a keyring), it is kept in memory for the session only and Settings says so. Tokens are never written to SQLite, logs, backups or sent to the renderer.
- **Backups:** `.jobranger` backups contain the database and managed artifacts under `data/`; the credential file sits outside `data/` and is never included. The export journal (below) is in the database and is included; it holds no tokens.
- **Journal:** table `drive_exports` (feature migration 1010) records operation ID, artifact ID, SHA-256, file name, size, state, Drive file ID, Drive link, error code/message and timestamps.
- **Scope:** `drive.file` only. Job Ranger cannot list or read anything in Drive except the files and the "Job Ranger" folder it created.

## Upload, verification and retry semantics

Approve → re-read the managed PDF (path must be inside Job Ranger's artifacts folder) → recompute SHA-256 → compare with the stored verified hash and with the hash the person reviewed. Any difference is **file changed**; nothing is sent.

The journal row is written (state `approved`) with a new operation ID **before any network call**. Then: `uploading` → find or create the app-owned "Job Ranger" folder → one multipart upload → read the file back and compare size and SHA-256 (MD5 when Drive omits SHA-256) → `verified`.

| Outcome | Journal state | What Retry does |
| --- | --- | --- |
| Verified | `verified` | Returns the receipt; no network |
| Rejected before or by Drive (401 after refresh, 403 scope/quota/rate limit, 429, other 4xx), or offline before the upload started | `failed` | Looks up the operation ID, then uploads with the same ID |
| Timeout, connection lost, 5xx, or unreadable response after the upload started | `unknown_remote_outcome` | Looks up the operation ID; if found, verifies it (no second upload); otherwise uploads with the same ID |
| App closed or crashed during upload | `uploading` | Same as unknown outcome |
| Drive's copy differs from the local PDF | `failed` (`verification_failed`) | Re-checks the same file; never reported as saved |

An artifact with an unresolved upload (`approved`, `uploading`, `unknown_remote_outcome`) cannot start a new one until Retry resolves it. A second copy of an already verified artifact needs **Save another copy**. Concurrent approvals of one artifact are refused while one is running.

Error codes surfaced to the UI: `not_configured`, `not_connected`, `auth_cancelled`, `auth_failed`, `auth_in_progress`, `auth_expired` (reconnect), `insufficient_scope` (reconnect and keep the permission), `rate_limited`, `storage_quota`, `server`, `network`, `timeout`, `verification_failed`, `file_changed`, `export_in_progress`, `already_exported`, `remote_rejected`, `invalid_response`, `invalid_request`.

## Sign-in details

Authorization code flow with PKCE S256 and random `state`; loopback receiver bound to `127.0.0.1` on an ephemeral port; redirect URI `http://127.0.0.1:<port>`; parameters `client_id`, `redirect_uri`, `response_type=code`, `scope=drive.file`, `code_challenge`, `code_challenge_method=S256`, `state`, `access_type=offline`, and `prompt=consent` only when no refresh token is stored. The receiver accepts only `GET /`, ignores requests without `state`, rejects a mismatched `state`, treats `error=access_denied` as cancellation, answers with a static page that reflects nothing, and closes after the first decisive callback, an explicit cancel, or 5 minutes. One sign-in runs at a time. A token response whose granted `scope` lacks `drive.file` is refused and revoked. `invalid_grant` on refresh deletes the stored credential and asks the person to reconnect.

## Tests

- `tests/google-drive-auth.test.cjs` — PKCE vector, loopback receiver (state mismatch, replay, unrelated requests, cancel, timeout), token-exchange failures (PKCE verifier rejection, redirect mismatch, 400/500, malformed JSON), scope enforcement, credential custody (encrypted, session-only, encryption failure), refresh `invalid_grant`, egress allowlist, error classification, client configuration.
- `tests/google-drive-export-smoke-test.cjs` — journal migration and every upload/verify/retry path above against SQLite (also run on the SQLite WASM engine).
- `tests/google-drive-packaging.test.mjs` — packaging hook and electron-builder wiring.
- `tests/e2e/drive-export.spec.ts` — Electron UI against a loopback fake Google: connect, review, approve, byte-exact upload, Open in Drive, timeout + retry without duplicate, disconnect with revocation, and relaunch after a crash during upload.

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
- If the person trashes the "Job Ranger" folder, the next export creates a new one.
- A file that fails verification stays in Drive (Job Ranger does not delete remote files) and is reported, never shown as saved.
