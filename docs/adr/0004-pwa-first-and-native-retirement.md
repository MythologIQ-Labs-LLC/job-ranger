# ADR-0004 (proposed): PWA-first distribution and an evidence-gated native retirement

**Status:** Proposed for review; **not accepted** and **not a superseding decision**  
**Date:** 2026-10-11  
**Owner decision:** [#259](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/259)  
**Drive authorization research:** [#258](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/258)  
**Related:** [#249](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/249), [#130](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/130), [#125](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/125), [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194), [#173](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/173), [#136](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/136)

## Proposed decision

1. **Favor the PWA as the ordinary-user destination**. A single local-first cross-platform browser runtime is preferable to indefinitely maintaining two mainstream delivery lifecycles *if and only if* it meets customer journeys and data-safety acceptance.
2. **Preserve Electron pending specific evidence**. The accepted 2026-10-05 dual-channel distribution contract remains active. The PWA is implemented but not yet publicly deployed or multi-browser production-qualified. No Electron code, Microsoft Store workflow, native release artifact or migration path is removed by this proposal.
3. **Default to user-initiated Google Drive snapshot upload in the PWA** without requiring a hosted account, backend OAuth-token broker or persistent browser refresh tokens. No background sync, automatic write on close, or agent mutation implied. The no-backend browser authorization decision is *candidate*, contingent on testing and review with #258.
4. **Keep canonical Career Ops data local**. Drive contains optionally uploaded, versioned `.jobranger` snapshots; it never becomes the only database, the Truth Gate authority, or an agent write channel. Explicitly handle archive contents, privacy, access expiry, retention and the restore path.

## Baseline evidence versus open questions

Repository facts at time of review:

- `docs/design/PWA_RUNTIME.md`: shared React UI/domain services in Electron and the browser, SQLite WASM + OPFS with Web Locks and durability rollback, `.jobranger` portability, self-hosted `http://localhost:4174`. No public PWA deployment. Chromium CI tested; Firefox/Safari and real-device install validation pending.
- `docs/design/DISTRIBUTION_ARCHITECTURE.md`: accepted PWA + Windows Store dual-channel direction from 2026-10-05; Store certification pending.
- `src/pwa/security/policy.ts`: CSP currently permits only self-hosted scripts, no framing, and outbound public-feed origins. Google Identity Services integration is **not** currently allowed. Any changes require reviewed minimal host allowances and new security/regression tests, not a blanket CSP relaxation.
- `docs/integrations/JOB_RANGER_MCP_READONLY.md`: the current local MCP adapter reads the **native** SQLite data root, not browser OPFS. A PWA-only decision cannot claim it preserves live local MCP access by magic.
- `docs/design/PWA_RUNTIME.md`: native-only acquisition for certain ATS/HTML sites; no reliable closed-tab scheduled checks, system tray, or browser support for certain complex-script PDF renderings. These are actual customer-function differences.

These are **architecture and repository evidence**, not proof of full PWA customer readiness.

## Google Drive authorization candidate for a PWA-first release

### Browser-only, no-backend path

- Provision a **Google OAuth Web application** client for explicitly approved HTTPS production origin and exact trusted localhost dev/test origin. Do not reuse the Electron Desktop OAuth client or loopback flow.
- Use the supported **Google Identity Services JavaScript token model** (`initTokenClient` / `requestAccessToken`) from a user-triggered **Connect Drive / Share snapshot** action. Request only `https://www.googleapis.com/auth/drive.file`. Inspect granted scopes before enabling uploads. No Google account is required until the user chooses Drive.
- A successful short-lived access token is kept **in memory only**, scoped to the current browser runtime. Do not write an OAuth refresh token, access token, auth code or Google session artifact into OPFS, IndexedDB, localStorage, the service worker, URL parameters, logs or an archive. Do not introduce a token-exchange server solely for silent renewal.
- On expiry, browser reload, account change, explicit disconnect or lack of authorization, surface an honest **Reconnect to Google Drive** / **Authorize upload** action. Obtain a fresh token only on a legitimate user gesture. The archived local data and manual export remain available while the user is offline or unconnected.
- Distinguish: `not_connected`, `authorizing`, `authorized_for_this_session`, `reconnect_required`, `temporary_provider_error`, `upload_in_progress`, `uploaded_and_verified`. An authorization dialog closing is not upload success. Successful Google authorization grants an API capability, **not** permission to transmit data or delete old backups.
- For disconnect, clear the in-memory access token and locally stored non-secret connection hints; invoke Google's revoke API when a valid token is available, explicitly report provider-revoke failure/unknown. Never promise remote revocation after a failed call.
- Create or locate **only** the dedicated app-created/explicitly authorized folder and its app-authorized files under `drive.file`; use Drive REST/CORS for creation, listing, upload and explicit cleanup. Google Picker may be needed to grant access to *pre-existing* user files, but it is not automatically required to create new app-owned archives. Demonstrate list/prune behavior with real granted scopes.
- Implement a narrow, reviewed Google-origin CSP change. Current `script-src 'self'`, `frame-src 'none'`, `connect-src` feed-only, `form-action 'none'`, Trusted Types and COOP may interact with the vendor script/popup. Keep existing no-remote-code posture as much as possible. Document Google's script dependency and its supply-chain implications; do not bypass Trusted Types or introduce wildcards to get a popup working.
- Do not alter the current service-worker policy to cache remote auth pages, OAuth callbacks or token-bearing responses. Test popup closure, popup blockers, denied scope, token expiration, 401, 403, 429, 5xx, offline and reload.

**Tradeoff:** browser token mode has no durable refresh token, so it cannot promise unattended uploads or long-lived Drive access after the user's session ends. That is compatible with the already-chosen user-driven **Share snapshot** concept, but conflicts with hypothetical background/on-close cloud sync unless #256 expressly revisits the product requirement.

**Important privacy gap:** the portable `.jobranger` archive includes local career/application artifacts and is not documented as encrypted. A Google account credential does **not** imply client-side end-to-end encryption or restriction of access for third-party integrations. #255 (archive shape), #254 (trust/help) and future privacy policy work must explain exactly what bytes go to Drive and evaluate optional encryption if required. The user must approve each transfer under the chosen trigger policy.

### Desktop path until retirement

Retain the separately governed Desktop-client loopback+PKCE/OS-protected token model, subject to real packaged-runtime Google verification. Do not implement a second hosted Google authorization broker in either runtime. If native support is later removed, preserve existing users' validated portable export/import and explicit retirement information.

## PWA-only impact matrix

| Capability | Current PWA evidence / limitation | Cutover requirement |
| --- | --- | --- |
| Deterministic Career Ops core and Truth Gate | Shared core, CI tests | End-user journeys on served builds, including without inference |
| SQLite/OPFS | Implemented, Chromium CI | Browser storage persistence, quota/eviction, restart, migration, corruption recovery on supported devices |
| Backup/migration | `.jobranger` bidirectional test | Real users can export, independently retain and restore even without Drive; localhost→HTTPS cross-origin migration |
| Job discovery, ATS sources | Some native hidden-browser sources cannot be read using CORS-only browser API | Concrete replacement, accepted exclusion with transparent user impact, or retain native companion |
| Closed-app scheduling | Browser background execution not equivalent | Foreground-only behavior intentionally accepted or qualified alternative; never promise unattended |
| Multilingual PDF | Complex script limitation of web pdf-lib renderer | Test affected languages; fix, retain native escape hatch, or explicit accessibility/product decision |
| Local ChatGPT/MCP path | Native SQLite read-only adapter; cannot read PWA OPFS | Independently prove user-authorized export-based agent consumption or governed PWA adapter; no invisible shadow DB |
| Google Drive | No current auth or upload provider | Real web-origin OAuth, folder/upload/list/delete permission checks, token-expiry/reconnect and explicit transfer QA |
| Distribution | Localhost Node/npm self-host, no public deployment | If marketed to ordinary users, a supported controlled HTTPS origin, provenance, reliable update and no CLI setup |
| Platform coverage | Chromium CI; other browsers unproven | Accepted support matrix with actual browser+OS testing, accessibility and negative paths |

## Acceptance plan

**Gate A: Research and spec.** Close outstanding scope questions in #258/#249/#255/#256/#257. Approve selected PWA OAuth model only after proof that Google's Web token flow is usable on the target origin with the current security model preserved. No broadened Drive scopes.

**Gate B: Bounded implementation.** Isolated change behind user opt-in: Web client configuration, explicit browser authorization, a provider-neutral `SyncProvider` adapter and readable status, app-controlled archive folder operations. Keep native auth separate until an actual retirement decision. Tests must include deterministic failures and a real Google transaction. Implement in reviewable slices; do not alter canonical data or silent uploader behavior.

**Gate C: Product parity / survivability.** Prove supported-browser core journeys, ATS limitations, multilingual output, meaningful offline/restart behavior, local archive restore and origin migration with realistic/synthetic user data. Record exact browser/OS/build and gaps, independently reviewed.

**Gate D: User distribution.** Ordinary user can launch a real HTTPS PWA with no Node/terminal, save a durable profile and recover an archive. Operational host, web CSP, rollback and release provenance are independently tested.

**Gate E: Retirement vote.** Compare measured maintenance cost and user value of native-only capabilities with PWA alternatives. Only if gates pass and remaining losses are explicitly approved should a separate follow-up ADR supersede the dual-channel contract and a separate PR remove Electron. Never retroactively relabel v1.2.0 artifacts or silently remove compatibility.

## Rejected shortcuts

- Assume a Desktop OAuth client and native loopback will work inside a hosted web origin.
- Add a publicly reachable backend and durable server refresh tokens without a new approved trust model.
- Store refresh tokens in browser localStorage/OPFS and call it OS-keychain equivalence.
- Infer Drive `connected` from a cached label, provider popup, or the user's Google login alone.
- Auto-share full career data, auto-prune historical archives, or allow a model to bypass human consent.
- Use full Drive scope because `drive.file` folder bookkeeping needs better design.
- Declare PWA-only readiness from CI or screenshots while real browser coverage, source acquisition, MCP continuity or storage recovery are unproven.

## References

Internal: [PWA runtime](../design/PWA_RUNTIME.md); [distribution architecture](../design/DISTRIBUTION_ARCHITECTURE.md); [system state](../SYSTEM_STATE.md); [native MCP boundary](../integrations/JOB_RANGER_MCP_READONLY.md); [distribution trust](../DISTRIBUTION_TRUST.md).

Public provider/platform docs:
- [Google: choose a web authorization model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)
- [Google: use the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google: allowed JavaScript origins](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Google: Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google: create folders](https://developers.google.com/workspace/drive/api/guides/folder)
- [MDN: storage eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN: request persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)

**No implementation, real-provider connection, security approval, PWA public deployment, Store retirement, or final product-readiness judgment is asserted by this proposed ADR.**
