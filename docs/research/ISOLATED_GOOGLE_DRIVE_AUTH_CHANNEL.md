# Isolated Google OAuth channel: security spike for #264

**Status: candidate only, not wired.** This branch intentionally has no pull request while the CI budget safeguard in #263 is being reviewed. No Google client, Drive API, hosted site, popup, authentication, archive transfer or end-to-end test was set up. This is not a feature that users can enable.

## Why this spike exists

The OAuth candidate in PR #261 conditionally loads Google's hosted Identity Services (GIS) script directly into the main PWA origin. That script shares the origin and page privileges of the local Career Ops workspace. Merely allowing a specific script URL in CSP does not isolate a permitted third-party script from application data. The sensitive local OPFS boundary is worth protecting independently.

The research candidate here uses **a distinct, static, narrowly privileged authorization origin**, and moves only a short-lived OAuth result across a verified window messaging channel. The main PWA origin would never execute Google's hosted script.

The baseline `main` PWA and Electron builds are unchanged by this branch. No new network or browser permissions are introduced.

## Proposed message sequence

1. In the primary Job Ranger PWA, the user selects **Connect Google Drive**. The application generates a fresh cryptographically random 192-bit nonce, records the exact intended helper origin, current application origin, and exact child WindowProxy, then synchronously opens the isolated origin. No Google script runs in the main page.
2. The opened helper is hosted at a **separate origin**, e.g. `https://auth.example.invalid`, with no application storage, data, account API, workspace service worker or unnecessary script imports. It receives a short-lived correlation nonce, but never an access token in a URL.
3. The helper displays an explicit **Authorize Drive** action. Its own user click calls Google GIS `requestAccessToken()` and requests only `https://www.googleapis.com/auth/drive.file` with `include_granted_scopes: false`. It validates Google's grant scope/lifetime and handles the provider's cancellation/failure callbacks.
4. The helper sends the resulting token, scope and expiration (or a controlled error) to **only** its configured opener origin using `window.opener.postMessage(message, exactOrigin)`. No wildcard `*`, broadcast, local storage or persistent token.
5. The parent handles `message` only while the pending attempt is active, and verifies exact `MessageEvent.origin`, exact `MessageEvent.source` identity, nonce, requesting origin, protocol, version, message kind, scope and bounded token expiration. Wrong source/origin is ignored. Malformed data from the expected helper **consumes** the attempt and fails closed. Replay and late callbacks are rejected.
6. The parent copies the token only into a private, short-lived memory-only authorization session and displays **authorized_unverified**. This does not prove a real Drive API operation or give permission to upload or delete a user's career data.
7. A separate and later user operation may create, validate and explicitly approve a snapshot for its exact destination under #257. That operation must revalidate token scope, archive digest, user consent and provider results; no login callback may be an upload trigger.

### Threat/mitigation matrix

| Threat | Proposed mitigation | Remaining gate |
| --- | --- | --- |
| Hosted GIS script can read Career Ops origin data | Run GIS only on **distinct static auth origin**, never import script into main page | Prove helper origin and local OPFS isolation in real browser |
| Arbitrary site sends a fake OAuth success | Exact `event.origin`, `event.source`, 192-bit nonce, protocol/version, requesting origin | Test actual WindowProxy and navigation/close behavior |
| Replayed result or callback after cancellation | One-shot receiver, short deadline, explicit cancellation | Prove events after closing browser/route reload do nothing |
| Token appears in page URL, logs or persistent state | `postMessage` only to exact origin, parent volatile memory only | Network/console/browser-storage inspection |
| Prior grants widen API permissions | GIS `include_granted_scopes: false` and exact `drive.file` verification | Real consent/account-switch testing |
| OAuth grants upload permission without knowing archive contents | Only authorization state is returned; *no command channel* | Separate explicit archive-specific approval (#256/#257) |
| Cross-origin popup fails due browser COOP or blocker | Plan `same-origin-allow-popups` where strictly required and authenticated helper user gesture | Real Chrome/Firefox/Safari/Edge tests and static host header proof |
| Authorized token cannot actually write/read provider file | Label as `authorized_unverified` until provider-backed proof | Actual app-created folder/file upload and round trip |

## Implemented in this branch

- `src/pwa/drive/isolated-auth-channel.ts`: **pure receiver only** for exact origin/window/nonce/scope/time validation, with cryptographically generated nonce function. No browser popup is opened by this module.
- `tests/pwa-isolated-google-auth-channel.test.mjs`: adversarial success, scope expansion, origin spoofing, source identity, nonce/protocol mismatch, wrong commands, token expiration, one-shot replay, and timeout cases. **11/11 locally passed** on 2026-10-11 under Node v22.16.0 with `--experimental-strip-types`.
- **Exact-blob validation:** The locally executed module's Git blob SHA was `f070a05e70bd866b55c78d0a23c17779d62b1a6d`, and the test file was `9672e6ef0de86092b3ee981a305f574d5961cc1a`; both matched the fetched GitHub branch blobs. The standalone strict `tsc --noEmit --strict --target ES2022 --lib ES2022,DOM` check passed with local TypeScript 5.8.3. The repository's pinned TypeScript 7 and integrated `npm run typecheck` were **not** executed.
- No `package.json` or workflow changes, so this suite is **not included** in ordinary CI. Only add to regular tests after the spike and #263 governance are approved. Local unit passes do not establish real browser, OAuth or product readiness.

## Design decisions and tests still blocked

The code here **cannot** prove a viable production dual-origin OAuth UX. Next research/implementation tasks:

1. Decide a host strategy for separate HTTPS helper origin and build artifact; keep self-host on localhost/ports accessible without a remote backend.
2. Implement/helper-page protocol with a user-click GIS popup and a strict CSP/Trusted Types policy on **helper only**. The application must not fall back to loading Google's script on its own origin.
3. Implement main-window popup manager: synchronous user-gesture `window.open`, random nonce/correlation handoff, listener cleanup, timeout, popup closure, origin/source validation and private token receiver.
4. Consider popup races, COOP, service worker origin control, iframe embed restrictions, browser compatibility, allowlisted Google authorized JS origins, tests with a **real** Google Web client and Google Cloud consent screen. Browsers may handle cross-origin popup WindowProxy differently; do not assume the design works from unit fixtures.
5. Decide whether the extra hosting/setup complexity is justified versus a transparently reviewed same-origin GIS alternative. This spike does not supersede PR #261 or adopt a product decision.

Security review should explicitly prevent an unauthenticated origin or malicious extension from inventing `validated: true`, issuing an upload consent record, or circumventing the deterministic Truth Gate.

## Cost discipline

The `spike/isolated-google-auth-channel-264` branch was opened **without a pull request**, so the repository's existing PR validation workflows should not start for these commits. Do not open a PR or manually dispatch a full Actions run just to test a design hypothesis. Use targeted local tests first when a trusted checkout is available, and gate a single bundled review-candidate run later, under #263's policy. Preserve no-CI as `not validated`, never as `passing`.

Official documentation:
- https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
