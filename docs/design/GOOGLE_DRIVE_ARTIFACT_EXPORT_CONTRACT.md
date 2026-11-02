# Sojourner Google Drive career artifact export (#314)

**Normative Drive export contract for the PWA (PRs #315 + #356, merged as one unit) and the Windows app (ARCH-005, amended 2026-11-02). Updated 2026-11-02. Off by default in both runtimes; not released or live-provider qualified.** PWA authorization is specified in [the isolated OAuth helper document](../security/SOJOURNER_DRIVE_OAUTH_ISOLATION.md); Windows authorization in the *Windows app contract* below. Live Google acceptance remains pending (#252 for the PWA; a real Desktop OAuth client for Windows). The sections after the divider are the original proposal, retained for history.

Both runtimes run one implementation of review, approval, journaling, idempotent upload and reconciliation, `src/shared/drive/drive-export-flow.ts`, over the shared state machine (`src/shared/artifact-export-approval.ts`, `src/shared/artifact-export-journal.ts`) and the shared Drive v3 transport (`src/shared/drive/google-drive-transport.ts`, `google-drive-account.ts`). `src/components/GoogleDriveResumeExport.tsx` depends only on a small port (`src/services/drive-export-port.ts`): `PwaDriveExportPort` in the browser, `ElectronDriveExportPort` over IPC in the Windows app. Everything in the PWA contract below about the review, the approval, the journal sequence, the recovery rules and the states applies to both runtimes unchanged.

## PWA contract

**Scope and default.** The PWA can save one exported, truth-gated resume PDF at a time to the top level of the user's My Drive. The capability exists only in a standard-flavor build configured with `VITE_SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN` (`src/pwa/build/drive-build-config.ts`). An unconfigured build, and the demo flavor whatever its configuration, renders no Drive UI, adds no Google endpoint to its CSP and makes no Google request (`tests/pwa/drive-default.spec.ts`). There is no automatic or background syncing. Individual PDF multipart uploads are capped at **5 MB**.

**Authorization.** Authorization happens only on the separately hosted OAuth helper origin (#264), requesting `https://www.googleapis.com/auth/drive.file` only. Google's sign-in script never runs on the Career Ops origin: there is no main-origin GIS loader, and no CSP option allows `accounts.google.com` there (`tests/pwa-drive-csp.test.mjs`). The access token is held only in volatile memory by `IsolatedDriveAuthorization`.

**Consent and data.** `resume:read-verified-artifact-for-export` reads only a previously verified managed PDF and checks its stored SHA-256. Drive `about.get` binds the Google account (`permissionId`). The user reviews file, size, digest, Google account and destination, then approves exactly that PDF with one click (`src/shared/artifact-export-approval.ts`). The account is verified again at confirmation; a change refuses the upload. Nothing other than the approved PDF bytes and their Drive metadata (name, MIME type, parent, the app-private operation marker, the reserved file ID) leaves the device.

**Durable journal and idempotent upload.** `src/shared/artifact-export-journal.ts` (record schema **v2**) and its IndexedDB store `src/pwa/drive/drive-journal-idb.ts` are the state-machine authority. The sequence for one approval is:

1. Reserve one Drive file ID with `files.generateIds?count=1&space=drive&type=files`. This is read-only; nothing is created.
2. Journal the operation as `prepared`, with approval ID, account, artifact, digest and the `reservedFileId`. A prepared row may be cancelled by the user.
3. Resolve the `root` alias to its opaque folder ID (read-only), then durably commit `uploading`. The journal refuses `prepared -> uploading` for a row without a reserved ID.
4. Send one multipart `files.create` with `id = reservedFileId`. A **409** means a file with that ID already exists (an earlier attempt of this operation landed): it is verified, never re-created.
5. Read back metadata (name, MIME type, parent, operation marker, size) and bytes. Only a SHA-256 match with the approved digest is shown as verified, with a validated Drive link.

**Recovery.** Every unresolved operation (`prepared`, `uploading`, `accepted_unverified`, `unknown_remote_outcome`, `verification_failed`) blocks a new upload of the same artifact to the same Google account, across reloads and tabs. A failed or ambiguous upload is never retried automatically. "Check prior Drive exports" reconciles read-only, using the verified account that journaled the row:

- With a reserved ID, a strongly consistent `files.get(reservedFileId)` decides. A 200 response leads to metadata and byte verification, then `verified`. Only an explicit **404** allows `uploading | unknown_remote_outcome -> failed` with resolution `reserved_id_absent`. This clears a crash before POST, or a request that failed before sending bytes. Any other answer (network, 401, 403, 5xx) leaves the row blocked.
- Schema-v1 rows, written before reserved IDs existed, fall back to the eventually consistent `appProperties` search. An empty result never clears anything.
- A row that cannot be resolved can be moved to the terminal `abandoned` state only by an explicit user action, after a warning that Drive may already hold a copy and a new export may create a second one. The receipt is kept and nothing in Drive is deleted.

States: `prepared -> uploading -> accepted_unverified -> verified`, plus `cancelled` (prepared only), `unknown_remote_outcome`, `verification_failed`, `failed` and `abandoned`. `failed` requires a recorded resolution: `provider_rejected` (a definitive 4xx other than 408/409 on create) or `reserved_id_absent` (a confirmed 404 of the reserved ID). `abandoned` requires `user_abandoned`. `validateJournalRecord`, `advanceExportReceipt` and `checkJournalTransition` enforce these rules, and the IndexedDB `compareAndSwap` re-checks them inside its transaction. The reserved ID is immutable, and any remote ID must equal it.

**Compatibility.** The IndexedDB database name and version (`job-ranger.drive-artifact-export-journal.v1`, version 1) are unchanged. Every read goes through `upgradeJournalRecord`, which upgrades v1 rows to v2 with `reservedFileId: null`. A v1 `failed` row, which only a provider rejection could produce, becomes `provider_rejected`. A v1 row is rewritten as v2 on its next legal transition. A v1 `prepared` row can be cancelled but never uploaded.

**Residual risk.** A 404 for the reserved ID proves the create had not landed at the time of the read. A request that is still in flight elsewhere (for example from a tab that has not unloaded yet) could land later. A new export uses a new reserved ID, so the worst outcome is a second, unverified copy in Drive, never an overwritten file or a false "verified".

**Tests.** `tests/artifact-export-approval.test.mjs`, `tests/artifact-export-journal.test.mjs`, `tests/google-drive-transport.test.mjs`, `tests/pwa/drive-journal-concurrency.spec.ts` (real IndexedDB, including v1 rows) and `tests/pwa/drive-export-component.spec.ts` (the real component in a configured build against a routed helper and Drive).

**Qualification outstanding:** real Google Web OAuth client and helper deployment (#252), actual browser OAuth and Drive file creation and readback on an approved HTTPS origin pair, independent adversarial review, and post-merge main acceptance. No public deployment or Studio publication is authorized here. Do not close #314 without a real account and file proof.

## Windows app contract

**Owner decision, 2026-11-02 (ARCH-005).** The signed Windows (Electron) app saves the same one verified resume PDF to the top level of My Drive, with the same review, single-click approval, journal states, recovery and abandonment rules as the PWA. Only authorization, credential custody, the journal store and the network path differ.

**Scope and default.** Drive export exists only in a build that has a Google **Desktop** OAuth client. `release-build.yml` passes the repository variables `JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID` and `JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET` to `npm run electron:build:win`; `scripts/write-google-oauth-client.mjs` validates them (a partial or malformed pair fails the build) and writes `build/google-oauth/google-desktop-client.json`, which electron-builder copies into the installed app's resources. A packaged app reads only that file (`electron/src/drive/google-config.cts`); a development run may use the same two environment variables. Without a valid pair, `drive:status` reports `available: false`, the renderer shows no Drive UI, and no Google request is ever made (`tests/e2e/drive-export.spec.ts`). The renderer receives only that flag; the client ID and secret stay in the main process. An installed app's Desktop client secret ships in every copy and is distributed configuration, not a confidential credential (RFC 8252 section 8.5); security rests on PKCE, the loopback redirect, the state check and the person's consent.

**Authorization (RFC 8252).** "Connect Google Drive" starts a one-shot HTTP receiver bound to `127.0.0.1` on an ephemeral port (`electron/src/drive/google-loopback.cts`) and opens Google's consent page in the system browser with `shell.openExternal`; the app never renders or fetches `accounts.google.com`. The request carries scope `https://www.googleapis.com/auth/drive.file` only, PKCE `S256` with a fresh 256-bit verifier, and an independent 256-bit `state` that the receiver compares in constant time. A callback without the exact state is refused without ending the sign-in; the first decisive callback, a cancel or the 5-minute timeout closes the receiver. The code is exchanged at `oauth2.googleapis.com/token`; a grant without `drive.file`, without a refresh token, or whose Drive account (`about.get`, `permissionId`) cannot be verified is refused and revoked (`electron/src/drive/google-desktop-auth.cts`). Connecting never uploads anything, and the app makes no Google request at startup.

**Credential custody.** The access token lives only in main-process memory and is refreshed 60 seconds before expiry. The refresh token, the account `permissionId` and its e-mail label are encrypted with Electron `safeStorage` (DPAPI on Windows) into `google-drive-credential.bin` in the user-data root, outside `data/`, so backups and `.jobranger` archives never contain it (`electron/src/drive/drive-credential-store.cts`). When `safeStorage` encryption is unavailable (or encryption fails), the sign-in is kept for this session only, nothing is written, and the panel says so. No token, authorization code, PKCE verifier or client secret is written to SQLite, logs or URLs, or sent over IPC (`src/shared/google-drive-desktop.ts`). A refresh rejected with `invalid_grant` deletes the stored sign-in and asks to reconnect. **Disconnect Google Drive** revokes the grant at `oauth2.googleapis.com/revoke` (best effort, reported) and always deletes the stored sign-in.

**Network.** Every main-process Google request goes through `electron/src/drive/drive-egress.cts`, which allows only `POST oauth2.googleapis.com/token`, `POST oauth2.googleapis.com/revoke`, `GET www.googleapis.com/drive/v3/…` and `POST www.googleapis.com/upload/drive/v3/…`, refuses redirects, applies timeouts (30 s, uploads 120 s) and caps response bodies (256 KiB for JSON, 5 MB for the `alt=media` readback). Nothing but the approved PDF bytes, their Drive metadata (name, MIME type, parent, operation marker, reserved file ID) and these authorization calls leaves the device. The renderer CSP is unchanged: the renderer makes no Google request.

**Journal.** SQLite migration **1010** (`google_drive_export_journal`, `electron/src/drive/drive-export-journal.cts`) stores each schema-v2 `ExportJournalRecord` (no tokens, no e-mail address, no document bytes). Every read goes through `upgradeJournalRecord`; every write is validated with `validateJournalRecord`; every update is a compare-and-swap that runs `checkJournalTransition` and then updates only if the stored row is still byte-identical to the one checked. The operation and approval IDs are unique. Upgrading from an earlier release applies 1010 without changing any existing table (`npm run test:release-upgrade`).

**IPC.** `drive:status`, `drive:connect`, `drive:cancel-connect`, `drive:disconnect`, `drive:prepare-export`, `drive:discard-export`, `drive:confirm-export`, `drive:reconcile-exports`, `drive:cancel-prepared-export`, `drive:abandon-export` (`electron/src/drive-ipc.cts`, `electron/src/preload.cts`). Inputs are validated (UUIDs, artifact IDs, PDF versions); results are `{ ok, value }` or `{ ok: false, message }`. The approval is minted in the main process when the user confirms the reviewed proposal; the bytes are read and re-verified there (`resume:read-verified-artifact-for-export`). The PWA worker registers none of these channels; in the browser the panel uses the helper flow, and the Electron port reports "available only in the Windows app" if it is ever reached without the desktop bridge.

**Tests.** `tests/drive-desktop-auth.test.cjs` (PKCE vectors, state mismatch, loopback binding, timeout, consent denial, PKCE replay, scope refusal, encrypted-only and session-only custody, disconnect, egress allowlist, redirects, size caps, timeouts, build configuration), `tests/drive-desktop-export.test.cjs` (migration 1010, journal transitions and races, reserved ID, 409, 404, SHA mismatch, oversized readback, the flow's recovery paths), `tests/drive-desktop-boundary.test.mjs` (build hook, packaging, channel parity, PWA worker isolation, no logging) and `tests/e2e/drive-export.spec.ts` (Electron E2E against a local fake Google: hidden when unconfigured; connect, review, confirm and verify; disconnect deletes the sign-in; a lost response reconciled through `files.get`; a crash with a prepared reservation, relaunch and cancel). Lane: `npm run test:drive-desktop`, `npm run test:e2e:drive`.

**Qualification outstanding (Windows):** a real Google Cloud project with the Drive API and an owner-registered Desktop OAuth client set as the two repository variables; live consent, upload, readback, refresh after restart, revoke and disconnect on the signed, installed NSIS build; independent adversarial review. Do not close #314 for Windows without that evidence.

---

## Original proposed contract (retained for architectural history)

# Google Drive career artifact export contract (#314)

**Status:** Proposed design, not an accepted ADR, implemented export, or release claim. Owner approval, implementation, adversarial review and live Google test-account evidence remain outstanding. This document lives separately from the Drive snapshot prototype (#262/#257) and must not bypass existing governance.

## Purpose and boundaries

Job Ranger is authoritative for local Career Ops content. Google Drive is an explicitly selected, user-owned **export destination**, not an authoritative workspace, background sync database, assistant-access gateway, or entitlement store. Preserve the offline/manual-export path and non-inference Truth Gate. No Job Ranger-hosted user accounts, token broker, or server-side credential custody.

A document export is not a workspace snapshot. Archive export/restore/retention belong to #249 and #255–#257. Share a future *credential/Drive API transport* only after that transport has a reviewed neutral contract; do **not** graft generic documents onto `SyncProvider.uploadArchive`, its archive-specific approval, or snapshot prune behavior.

## Security and privacy invariants

1. User action authorizes exactly one immutable artifact/version, destination, filename, MIME type and payload digest. Render a plain-language preview, sensitivity notice and requested destination before the approval. Approval expires and is single-use. No inference, MCP tool, model output, background task, or imported data may synthesize that approval.
2. Use Google's `https://www.googleapis.com/auth/drive.file` scope only. Create application-controlled files/folders or use an explicitly user-selected item granted to the application, subject to scope limitations. Never widen to full `drive`, enumerate arbitrary files, or write into a folder based solely on a user-supplied URL.
3. OAuth access/refresh tokens, authorization codes, PKCE verifier and state are device-local runtime custody. No app backend, analytics, support logs, agent prompt, Drive export receipt, GitHub artifact, service worker cache or repository secrets may receive them. Google's servers necessarily receive OAuth exchanges and the uploaded user-approved document.
4. OAuth application identification is **not** a user credential. Distinguish registered public client IDs and provider-required native client request parameters from refresh/access tokens. Do not assume distributable native application client secrets are confidential security controls.
5. Render/export only already-authorized local content using the real generator. Upload does not bypass claim validation, provenance, user corrections or the existing Truth Gate.
6. An HTTP 2xx upload acknowledgement does not prove content integrity/readability; status must accurately distinguish accepted-unverified, verified, interrupted/unknown, and failed. Absence of a locally recorded receipt never establishes that Drive did not create the file.

## Runtime-specific authorization

| Native Electron / packaged Windows | Browser PWA |
| --- | --- |
| Desktop OAuth client, system browser, loopback on a random local-only port, fresh PKCE S256 + independent CSRF state, short-lived single-use listener/callback. | Separate Web OAuth client and exact authorized HTTPS/preview origin; GIS popup initiated by explicit user gesture. |
| Exchange code locally; store approved durable refresh token in OS-protected credential store; clear on disconnect, report remote revoke separately. | Short-lived access token in private memory only; no browser-persisted refresh token, silent unattended renewals or host token broker. Reauthorization after expiry/reload is normal. |
| Prove packaged installer/Store context, restart/refresh/revoke, callback hijack/timeouts and denied permissions with real Google accounts. | Prove CSP/COOP/Trusted Types, popup blockers, cross-origin restrictions, cancel/expiry and offline manual-export fallback in actual target browsers. |

Use Bicameral's local authorization patterns as architectural reference, not as a copy-paste dependency or acceptance evidence. Draft #261 is an auth-only browser research proof, not Drive connectivity.

## Transport and application boundaries

Proposed responsibilities, **not yet runtime APIs**:

- `DriveAuthorization`: `beginUserAuthorization()`, `getVerifiedCapability()`, `forgetLocalCredentials()`, `revokeIfPossible()`; platform-specific implementation. A successful token exchange yields authorized-unverified until an appropriate provider probe.
- `DriveTransport`: scoped `createFile`, `getCreatedFileMetadata`, `readBackCreatedFile`, and optional explicit destination selection. Sanitizes errors, handles provider timeouts and rate limits; never owns business permission to upload.
- `ArtifactExport`: creates frozen bytes from an existing eligible artifact, hashes bytes locally, issues a short-lived human-review proposal, checks one-shot user approval, performs upload, verifies remotely, and records a local receipt.

The transport's file ID and parent ID are opaque identifiers, not safe filesystem paths. The application chooses supported MIME/extension pairs based on the **actual** document renderer and refuses unknown file types. Avoid claiming DOCX or Google Docs conversion until supported and tested.

### Required export proposal

```ts
type ArtifactExportProposal = {
  proposalId: string;             // random and short-lived, local only
  artifactId: string;
  artifactRevision: string;
  fileName: string;
  mimeType: string;
  bytesSha256: string;
  byteLength: number;
  providerId: "google-drive";
  approvedDestinationId: string;  // provider-verified or app-created
  destinationLabel: string;       // shown to human
  expiresAt: string;
};
```

Do not rely on the proposal's string fields alone as proof of a click. A separate, trustworthy UI controller must bind a real user interaction to the exact proposal, account, destination and frozen byte payload. Reject changes to any of these before upload.

### Durable local receipt and recovery states

Persist a local operation ID **before** initiating upload, together with the frozen hash, intended parent/name and consent binding (but no OAuth tokens or raw document bytes beyond existing approved storage). Suggested states:

`prepared -> uploading -> accepted_unverified -> verified`

and `cancelled`, `failed`, `unknown_remote_outcome`, `verification_failed`.

After a timeout/connection loss, **do not blindly POST again**. The file may already exist. Inspect provider metadata when a remote ID is known; otherwise require a bounded reconciliation against application-created files, using a unique operation marker only if the provider supports a safe app-owned metadata field. If reconciliation cannot prove absence or identity, present an explicit ambiguity to the user before a fresh upload. No automatic overwrite/deletion. Maintain a local receipt showing provider file ID, approval ID, local SHA-256, remote observed metadata/hash and verification level. Never present a Google Drive link constructed from an unvalidated arbitrary URL.

## User-facing workflow

1. User generates/opens an actual supported document, with eligible export controls.
2. User selects **Save to Google Drive**. If not authorized, show runtime-appropriate on-device account connection. No OAuth prompt on normal app launch.
3. Show immutable content/version, filename and format, Google account identity when verified, destination and sensitive-data disclosure.
4. Explicit user confirmation initiates a single bounded operation. Disable duplicate submission while pending.
5. Show `Uploaded, verifying` only after provider acknowledgement; show `Saved to Drive` only after the declared verification level is actually met. Provide a validated **Open in Drive** action.
6. On failure, leave local data intact and offer manual download. Clearly distinguish lost authorization, offline, provider errors, quota and unknown remote state.

## Test and release requirements

- Pure contract tests: consent binding, expiry, duplicate click, stale artifact revision, changed bytes/digest, unsafe filenames, MIME mismatch, wrong account/folder, disallowed external path/URL, unexpected permission scope, token-free receipts, and receipt state machine transitions.
- Transport tests: malformed responses, offline/network interrupts, provider 401/403/404/409/429/5xx, quota, partial transfer, retry-after policy and unknown remote completion without duplicate uploads.
- Platform tests: native PKCE/state CSRF and callback replay, packaged restart/keychain/refresh/revoke; browser popup denial, expired token, CSP/COOP and service worker non-persistence.
- Acceptance: real user-approved Google auth, exactly one real file upload, Drive readback matching frozen bytes/digest, reopen/restart and recovery, negative-path evidence, user-visible destination and receipt; test each runtime that will advertise the capability.
- An **independent adversarial review** evaluates authority escalation, exfiltration, consent spoofing, token lifetime, cross-runtime mismatches and recovery claims. Exact-head local validation comes before any narrowly justified hosted CI; skipped checks are not passes.
- Release/documentation only advertise the demonstrated capability. A real Google project, Drive API enabled, registered client, consent configuration, scopes, authorized web origins and any required verification are external prerequisites.

## Implementation order and issue closeout

1. Align #258 native/PWA auth findings with #261 research and the existing #249 snapshot contract, resolving any mutually inconsistent design.
2. Implement test-first common artifact-export proposal, approval and receipt invariants; **no Google calls in this step**.
3. Implement scoped Drive transport and platform-specific authorized adapters behind feature gates, with manual export still working.
4. Integrate one existing document renderer and real human export UI. Validate actual frozen bytes and idempotency/recovery.
5. Qualify native and PWA independently, run adversarial review, merge and confirm in main, then close #314 with evidence. Keep snapshot backup #249 separate.

**Not in scope:** automatic filing of all generated documents, unattended background sync, arbitrary Drive browsing, Drive-to-local merge/restore, third-party agent writes, mass job application, or hosted Job Ranger account infrastructure.
