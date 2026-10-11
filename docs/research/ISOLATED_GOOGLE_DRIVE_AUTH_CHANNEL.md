# Isolated Google OAuth channel: security spike for #264

**Status: candidate implementation, not wired into the main PWA.** This branch intentionally has no PR while the CI budget safeguard in #263 is reviewed. A standalone helper webpage and a main-window popup controller are now implemented, but neither is deployed or connected to Job Ranger Settings. No real Google OAuth client, live authorization, Drive API, archive transfer, real Chromium two-origin pass, or user-facing feature exists.

## Why this spike exists

The OAuth candidate in PR #261 conditionally loads Google's hosted Identity Services (GIS) script directly into the main PWA origin. That script shares the origin and page privileges of the local Career Ops workspace. Merely allowing a specific script URL in CSP does not isolate a permitted third-party script from application data. The sensitive local OPFS boundary is worth protecting independently.

The research candidate here uses **a distinct, static, narrowly privileged authorization origin**, and moves only a short-lived OAuth result across a verified window messaging channel. The main PWA origin would never execute Google's hosted script.

The baseline `main` PWA and Electron builds are unchanged by this branch. No new network or browser permissions are introduced.

## Proposed message sequence

1. In the primary Job Ranger PWA, the user selects **Connect Google Drive**. The application generates a fresh cryptographically random 192-bit nonce, records the exact intended helper origin, current application origin, and exact child WindowProxy, then synchronously opens the isolated origin. No Google script runs in the main page.
2. The opened helper is hosted at a **separate origin**, e.g. `https://auth.example.invalid`, with no application storage, data, account API, workspace service worker or unnecessary script imports. The helper first sends a `ready` message to the exact configured main-app origin, then the parent sends a 192-bit correlation nonce via `postMessage`. **Neither the nonce nor the OAuth token enters a URL.** The helper replies `initialized` once it verifies source and origin.
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

## Implemented and locally validated

- `src/pwa/drive/isolated-auth-channel.ts`: existing pure receiver for exact origin/source/nonce/scope/time checks, fail-closed reply handling, internally minted nonce.
- `src/pwa/drive/isolated-auth-popup.ts`: new parent/window manager that opens a **configured separate origin synchronously on a click**, receives ready/init/initialized/result messages, binds to the exact child WindowProxy, and keeps tokens in private volatile memory. On cancel, close, timeout and dispose it invalidates the session and listener. **It is not yet imported by Job Ranger's UI.**
- `auth-helper/index.html`, `helper.mjs`, `config.mjs`, `style.css`: separate minimal static page with two-stage user-present GIS loading/consent. Public client ID/app origin default to empty; there is no real credential or client secret. An opt-in local or HTTPS hosting process must configure these values explicitly and serve the helper at a **different origin** from Job Ranger. No bundled Google script or third-party JavaScript on the PWA origin.
- `auth-helper/_headers`: standalone hosting example for **helper only**, including strict CSP, Trusted Types and `frame-ancestors 'none'`; COOP is `unsafe-none` for this helper origin. **This file does not modify the PWA's COOP or deployed hosting settings.** The main PWA currently uses `same-origin` COOP; a separately reviewed, build-gated `same-origin-allow-popups` change is needed before a live two-origin browser flow can work.
- Three new test files in `tests/pwa-isolated-google-auth-{popup,helper,handshake}.test.mjs` cover parent popup, helper GIS mock, and combined two-origin protocol. They are not yet added to full `npm test` and were tested with local Node fixtures.

**Local test evidence (2026-10-11):**

```sh
node --experimental-strip-types --experimental-vm-modules --test \
  tests/pwa-isolated-google-auth-channel.test.mjs \
  tests/pwa-isolated-google-auth-popup.test.mjs \
  tests/pwa-isolated-google-auth-helper.test.mjs \
  tests/pwa-isolated-google-auth-handshake.test.mjs

tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions --lib ES2022,DOM \
  src/pwa/drive/isolated-auth-channel.ts src/pwa/drive/isolated-auth-popup.ts

node --check auth-helper/helper.mjs
node --check auth-helper/config.mjs
```

All **22 offline tests passed locally** on Node v22.16.0; the strict standalone TypeScript check and helper JS syntax checks also passed. These are mock/VM tests, **not a real Google sign-in, Drive provider round trip, integrated PWA build or live-browser proof**. Existing initial receiver module+tests were previously verified against GitHub blobs; the new helper script and initial popup test have matching GitHub blob hashes. The new popup manager and helper/handshake tests were authored in the repository separately from the local fixture, so they **must still be run against the exact repository head** before this slice is accepted.

**Real-browser blocker in this environment:** an attempt to run Chromium via Python Playwright against the two local `localhost:4174`/`localhost:4175` origins returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`, and even a `data:` URL was blocked. Thus no actual browser-window interaction or header compatibility is claimed.

## Security-sensitive next gates

1. Independently check the new static helper build/host setup and remote CSP. The `_headers` format assumes a compatible static host; an operator must inspect **actual response headers** and prevent caching credentials or arbitrary service workers on the helper origin.
2. Explicitly approve and test an opt-in main-PWA COOP relaxation to `same-origin-allow-popups`; keep current default `same-origin` when Google Drive is unavailable. The separate helper can use `unsafe-none`, per COOP interoperability guidance. Do not mistake a mocked popup for this browser test.
3. Verify both distinct origins and the real `WindowProxy` messaging flow in Chrome and Edge, then Firefox/Safari if claimed supported. Test popup blocked, navigation to a malicious origin, helper closed, session timeout, replay, and cancel. Confirm the workspace origin never imports any Google script.
4. Configure a **real Google Web OAuth client for the helper origin**, not the Career Ops origin. Verify Google consent, `drive.file` scope, account switch and revocation, GIS CSP/Trusted Types, helper nonce handshake and user-gesture popup behavior. Keep receipts sanitized.
5. Only then consider an **opt-in Settings integration**, with deliberate per-archive user approval and provider verification governed by #255/#256/#257. An OAuth grant is not permission to upload the career database or share with a third-party agent.
6. Independently review whether a second deployed origin is justified versus accepting a documented same-origin GIS script risk. Neither design is adopted on `main`.

The standalone helper is intentionally **unconfigured**. For a future controlled test build, replace the empty `GOOGLE_WEB_CLIENT_ID` and `JOB_RANGER_APP_ORIGIN` *locally in a separate served artifact*, never commit live tokens/secrets; register the helper origin in Google's Authorized JavaScript origins. Do not deploy `auth-helper/` under the same origin as the PWA or use a path-only partition.

Security review must explicitly prevent a malicious actor from inventing a snapshot `validated: true`, manufacturing user approval, or bypassing the deterministic Career Evidence/Truth Gate authority.

## Cost discipline

The `spike/isolated-google-auth-channel-264` branch was opened **without a pull request**, so the repository's existing PR validation workflows should not start for these commits. Do not open a PR or manually dispatch a full Actions run just to test a design hypothesis. Use targeted local tests first when a trusted checkout is available, and gate a single bundled review-candidate run later, under #263's policy. Preserve no-CI as `not validated`, never as `passing`.

Official documentation:
- https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
