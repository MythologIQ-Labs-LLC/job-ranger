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
- `auth-helper/_headers`: standalone hosting example for **helper only**, including strict CSP, Trusted Types and `frame-ancestors 'none'`; COOP is `unsafe-none` for this helper origin. **This file does not modify the PWA's COOP or deployed hosting settings.** On `main` the PWA uses `same-origin` COOP; this spike branch now has a build-gated `same-origin-allow-popups` candidate, which still requires security review and live two-origin browser acceptance.
- Three new test files in `tests/pwa-isolated-google-auth-{popup,helper,handshake}.test.mjs` cover parent popup, helper GIS mock, exact origin safety (including insecure remote HTTP refusal), and combined two-origin protocol. They are not yet added to full `npm test` and were tested with local Node fixtures.
- `tests/research/isolated-google-auth.browser.mjs` is a separate, **manual opt-in** Playwright script that serves temporary 127.0.0.1 origins, the helper's actual `_headers` CSP and a popup-compatible main COOP, injects a **mock** Google client, and checks the popup+token journey. It is **not** in GitHub Actions, not a real Google authorization test, and could not be run in the current container because Chromium returns `ERR_BLOCKED_BY_ADMINISTRATOR` for browser navigation. Its JS syntax was checked locally. Run it only from a trusted local checkout with the existing `playwright` dev dependency and a functional Chromium binary:
```sh
node tests/research/isolated-google-auth.browser.mjs
```
If the browser is installed at a nonstandard location, supply `JOB_RANGER_PW_CHROMIUM` as the executable path. No provider credentials are needed.

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

All **23 offline tests passed locally** on Node v22.16.0; the strict standalone TypeScript check and helper JS syntax checks also passed. These are mock/VM tests, **not a real Google sign-in, Drive provider round trip, integrated PWA build or live-browser proof**. Existing initial receiver module+tests were previously verified against GitHub blobs; the new helper script and initial popup test have matching GitHub blob hashes. The new popup manager and helper/handshake tests were authored in the repository separately from the local fixture, so they **must still be run against the exact repository head** before this slice is accepted.

**Real-browser blocker in this environment:** an attempt to run Chromium via Python Playwright against the two local `localhost:4174`/`localhost:4175` origins returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`, and even a `data:` URL was blocked. Thus no actual browser-window interaction or header compatibility is claimed.

## Security-sensitive next gates

1. Independently check the new static helper build/host setup and remote CSP. The `_headers` format assumes a compatible static host; an operator must inspect **actual response headers** and prevent caching credentials or arbitrary service workers on the helper origin.
2. Explicitly approve and test an opt-in main-PWA COOP relaxation to `same-origin-allow-popups`; keep current default `same-origin` when Google Drive is unavailable. The separate helper can use `unsafe-none`, per COOP interoperability guidance. Do not mistake a mocked popup for this browser test.
3. Verify both distinct origins and the real `WindowProxy` messaging flow in Chrome and Edge, then Firefox/Safari if claimed supported. Test popup blocked, navigation to a malicious origin, helper closed, session timeout, replay, and cancel. Confirm the workspace origin never imports any Google script.
4. Run the targeted two-origin browser harness on a machine that permits navigation, with actual CSP/COOP response headers, **before** attempting real Google authorization. Record whether browser popup/WindowProxy continuity succeeds and fail closed on any unexpected network requests.
5. Configure a **real Google Web OAuth client for the helper origin**, not the Career Ops origin. Verify Google consent, `drive.file` scope, account switch and revocation, GIS CSP/Trusted Types, helper nonce handshake and user-gesture popup behavior. Keep receipts sanitized.
6. Only then consider an **opt-in Settings integration**, with deliberate per-archive user approval and provider verification governed by #255/#256/#257. An OAuth grant is not permission to upload the career database or share with a third-party agent.
7. Independently review whether a second deployed origin is justified versus accepting a documented same-origin GIS script risk. Neither design is adopted on `main`.

The standalone helper is intentionally **unconfigured**. For a future controlled test build, replace the empty `GOOGLE_WEB_CLIENT_ID` and `JOB_RANGER_APP_ORIGIN` *locally in a separate served artifact*, never commit live tokens/secrets; register the helper origin in Google's Authorized JavaScript origins. Do not deploy `auth-helper/` under the same origin as the PWA or use a path-only partition.

Security review must explicitly prevent a malicious actor from inventing a snapshot `validated: true`, manufacturing user approval, or bypassing the deterministic Career Evidence/Truth Gate authority.

## Research-only PWA Settings integration and local proof server

The experimental branch now includes an explicitly **build-gated** Settings panel; it is not on `main`, deployed or shipped:

- `src/components/IsolatedGoogleDrivePanel.tsx` is rendered only for the PWA runtime with a nonempty public `JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN` at PWA build time. An ordinary PWA build does **not** show this panel, poll the auth state, or request Google content. The React component holds only safe phase/message state; the bearer token stays private in the popup controller.
- `src/pwa/security/policy.ts` preserves the **same original PWA CSP** and the default `Cross-Origin-Opener-Policy: same-origin`. An explicitly configured helper origin enables only `same-origin-allow-popups`; it does **not** grant the main Career Ops origin permission to execute Google's script or connect directly to Google. This relaxation has an XS-Leak/opener-risk tradeoff and requires independent security approval, real-browser verification and main-origin regression review.
- `vite.pwa.config.ts` validates the configured exact helper origin (HTTPS, or HTTP loopback only), substitutes a **public** build-time constant, sets the corresponding `_headers`/preview COOP, and includes `crossOriginOpenerPolicy` and `experimentalIsolatedDriveAuth` in the generated `build-info.json` so the effective build can be inspected. The helper must use a **separate** origin; the controller refuses same-origin configurations.
- `scripts/research/serve-isolated-google-auth.mjs` provides a localhost-only helper server. It serves a strict allowlist of static assets and dynamic **public** client/app-origin configuration, applies the helper-specific `_headers` CSP and `no-store` to every response, and refuses POST/query requests. This research server is **not** a hosted backend or production deployment candidate.
- `tests/pwa-isolated-drive-policy.test.mjs` and `tests/pwa-isolated-auth-helper-server.test.mjs` assert default/opt-in security policy and HTTP server boundaries. They are deliberately not added to standard hosted CI while this remains an experimental branch.

### Run the two-origin prototype locally (not production)

Use an isolated browser profile and a **Google-issued Web application OAuth client ID**. The client ID is public; a client secret/refresh token must **never** be put into a PWA build, repository or browser environment.

Terminal A, build and serve the PWA with the separate auth origin explicitly configured:

```sh
JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN=http://localhost:4175 npm run build:pwa
JOB_RANGER_ISOLATED_DRIVE_AUTH_ORIGIN=http://localhost:4175 npm run preview:pwa
```

Terminal B, serve the auth helper on localhost with its actual security headers:

```sh
JOB_RANGER_GOOGLE_WEB_CLIENT_ID="YOUR_PUBLIC_WEB_OAUTH_CLIENT_ID.apps.googleusercontent.com" \
JOB_RANGER_PWA_ORIGIN="http://localhost:4174" \
node scripts/research/serve-isolated-google-auth.mjs
```

In Google Cloud, register the **helper** JavaScript origin `http://localhost:4175` under this Web OAuth client. This is a different origin from the main Job Ranger page `http://localhost:4174`. Open the PWA Settings page at `http://localhost:4174`. First verify the main page emits only the standard same-origin app/network policy except for its **explicitly configured** opener policy, then click the authorization test panel; the helper separately asks the user to load Google and authorizes only after another direct click. This sequence does not back up, upload, list, recover, or share anything.

The manual Playwright simulated harness can be run without a Google account:

```sh
node tests/research/isolated-google-auth.browser.mjs
```

Both browser flows are **unverified** in this environment because browser navigation is blocked here. Capture actual response headers, console violations, popup/COOP continuity, and sanitized consent outcomes when using a machine with working Chromium. Do not paste access tokens in evidence.

### Current validation evidence (2026-10-11)

- Previous **23 offline unit/VM cases** passed against the local prototype files. The parent/controller/channel TypeScript modules and the newly updated `src/pwa/security/policy.ts` passed a standalone strict `tsc` check using TypeScript 5.8.3. The local security-policy copy was byte-for-byte verified by Git blob SHA `0d540f92b516520e77f358fab42ba7181316beaa`.
- The **exact GitHub blob** of the new localhost server (`9933dfd0493b768ad032d04384c45d3acd67827e`) passed `node --check` and local Node HTTP tests for index, config, helper JS, CSS, 404, query denial, POST denial, `no-store`, and CSP headers. No provider credentials were used.
- Standalone assertions passed for unchanged default CSP/COOP, opt-in-only opener policy, and helper-origin restrictions. The full new policy/server test files were **committed but have not both been executed as exact repository test files**; a complete `npm run typecheck`, `npm run build:pwa` and real browser/provider validation also remain outstanding.
- These branch updates do **not** trigger hosted GitHub Actions while the branch has no open PR. CI budget is preserved at the cost of postponing full integrated validation. None of this evidence authorizes merging, publishing or calling cloud recovery reliable.

## Cost discipline

The `spike/isolated-google-auth-channel-264` branch was opened **without a pull request**, so the repository's existing PR validation workflows should not start for these commits. Do not open a PR or manually dispatch a full Actions run just to test a design hypothesis. Use targeted local tests first when a trusted checkout is available, and gate a single bundled review-candidate run later, under #263's policy. Preserve no-CI as `not validated`, never as `passing`.

Official documentation:
- https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy
