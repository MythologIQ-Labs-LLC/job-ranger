# Sojourner Google Drive career artifact export (#314)

**Implementation candidate updated 2026-10-28. Not released or live-provider qualified.** This branch now includes a real, behind-configuration **PWA** path for exported truth-gated resume PDFs: `resume:read-verified-artifact-for-export` reads only previously verified managed PDFs and checks the stored SHA-256; browser-only GIS authorization requests `drive.file`; Drive `about.get` verifies account binding; the user reviews file, digest, Google account and My Drive root destination before one-click approval; IndexedDB journals operation and approval IDs before POST; Drive v3 multipart upload uses app-private operation metadata; `files.get` metadata and binary readback must match before the UI claims verified. A failed/ambiguous upload never silently retries. Default unconfigured and fictional-demo PWA builds do not enable this capability or the Google network CSP. Individual PDF multipart uploads are intentionally capped at **5 MB**; larger/resumable documents are outside this candidate.

Existing `src/shared/artifact-export-approval.ts` and `artifact-export-journal.ts` remain the authority and state-machine boundary, not merely comments or an isolated document design. Credential tokens remain private in the browser authorization controller. Root-folder alias resolution is performed before upload for exact parent readback.

**Qualification outstanding:** exact-branch automated tests, adversarial review of IPC/artifact authentication and journal recovery, real Google Web OAuth client configuration (#252), actual PWA browser OAuth+Drive file creation/readback on an approved HTTPS origin, and post-merge main acceptance. No public deployment or Studio publication is authorized here. Do not mark #314 closed without a real account and file proof.

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
