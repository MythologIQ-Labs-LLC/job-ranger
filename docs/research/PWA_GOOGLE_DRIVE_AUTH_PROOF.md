# PWA Google Drive authorization proof (research build)

**Status:** Auth-only candidate on feature branch for [#258](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/258). **No live Google sign-in or Drive operation has been verified. No snapshot upload/download/list/delete is implemented.**

This deliberately does not replace the current local-first storage, manual `.jobranger` export, desktop authentication, or native distribution policy. It must not be represented as shipped Google Drive sync.

## Security model

- Ordinary builds without `VITE_JOB_RANGER_GOOGLE_WEB_CLIENT_ID` keep the existing no-Google CSP, COOP, and no remote Google library requests. Settings does not display the unshipped cloud authorization panel.
- A separately configured proof build allows the Google Identity Services (GIS) JavaScript **token model** only, requesting exactly `https://www.googleapis.com/auth/drive.file`. This uses a **Web application** OAuth client (not a Desktop client). The publicly visible client ID is **not a secret**.
- The user first chooses **Load Google authorization** (the only point at which the browser loads Google's hosted JavaScript), then explicitly clicks **Authorize Drive access** to open Google's popup. Nothing launches the authorization prompt without a user gesture.
- Access token lives only in a private browser runtime object for its short valid lifetime, not React state, IndexedDB, OPFS, `localStorage`, the service worker, logs, or a backend. It is never included in UI status.
- An OAuth success is labeled `authorized_unverified`. It does **not** validate the Drive REST API and does **not** authorize any archive upload. Upload, archive shape, retention and separate third-party-agent access remain owned by #249, #255, #256 and #257.
- A missing or unexpected scope, denied consent, blocked/closed popup, expired token or cancelled attempt cannot report authorization success. The user must deliberately authorize again. No background refresh-token storage or silent renewal exists.
- **Forget browser session** only discards the local token. It **does not** claim to revoke Google's remembered grant; user instructions link to Google's account permissions page. Implement provider-side revoke and truthful result as a separate reviewed slice, before changing wording to **Disconnect**.
- The web-only proof opts into an additional exact GIS script origin, narrow GIS frame/connect/style permissions, a second exact Trusted Types script URL policy, and `same-origin-allow-popups` COOP. These are **security-sensitive candidate changes** requiring manual live-browser verification and independent review before acceptance. They are not enabled in default builds.

The browser token model has a known security tradeoff: access tokens are present in browser JavaScript. The recommended Google authorization-code model protects tokens with a backend, but introducing hosted per-user credentials would require a separate architecture decision. The opt-in token model supports explicitly user-present snapshot publishing without a new server.

## Maintainer proof setup (requires real Google Cloud Console ownership)

1. Create/choose a dedicated Google Cloud project under approved maintainer control; enable **Google Drive API**. Configure an OAuth consent screen with legitimate product branding, support contact, privacy policy/publication settings as required by Google. Keep the scope limited to `drive.file`.
2. Create a **Web application** OAuth client and register the *exact* origin where the proof is served. For local preview, the example is `http://localhost:4174`; do not confuse it with `http://127.0.0.1:4174` or with Vite development's `localhost:5174`. Add each tested origin only if explicitly approved. Production must use a controlled HTTPS origin.
3. Supply the **public client ID** only through your build environment. Example (Bash):
   ```sh
   VITE_JOB_RANGER_GOOGLE_WEB_CLIENT_ID="REPLACE_WITH_ISSUED_WEB_CLIENT_ID.apps.googleusercontent.com" npm run build:pwa
   npm run preview:pwa
   ```
   Do not put the client ID in `.env` committed to source. **Never** include a client secret or OAuth token in a repository variable, build argument, issue, PR comment, client log or screenshot.
4. Open `http://localhost:4174/#/settings` in a browser profile you control, load Google's SDK explicitly, and click Authorize. Expect the requested `drive.file` scope, accurate denied/cancel/retry messages, and no Drive file created or private data transmitted by this auth-only candidate.
5. Independently test popup blockers, account choice, already-granted consent, app permissions revocation, token expiration, reload, browser offline, privacy browsers and Settings navigation/unmount. Observe the network/security console for CSP, COOP and Trusted Types violations without recording credential-bearing responses. The real OAuth popup must not be called from an embedded browser.
6. **Do not mark the provider gate complete from this alone.** Subsequent slices must independently demonstrate an explicit user-approved archive upload, app-controlled file scope, provider-backed success check, policy-compliant pruning, and recovery/restore.

## Deterministic validation

Run:
```sh
node --experimental-strip-types tests/pwa-drive-web-auth.test.mjs
node --experimental-strip-types tests/pwa-drive-csp.test.mjs
npm run typecheck
npm run build:pwa
npm run test:pwa:e2e
```

Tests use local injected GIS driver callbacks and assert no access token appears in status projections. The default-browser test exercises Settings with no Google client configured, and expects zero Google network requests. These tests **cannot** prove Google granted a real token or that an upload works.

**Important:** `tests/pwa/support/server.ts` currently always uses the default CSP headers. The official local opt-in proof uses `npm run preview:pwa` so build-time Google CSP and delivered headers agree; a dedicated opt-in Playwright harness must be separately implemented before claiming automated live-popup E2E.

## Outstanding decisions and release gates

- #258: Validate official GIS token flow, popup/COOP/Trusted Types compatibility, separate Web app OAuth client and exact production hostname; complete live authorization/denial tests.
- #252/#253: Real project provisioning, branding, consent screen and applicable Google verification.
- #255/#256/#257: Portable archive shape, explicit upload trigger and provider interface.
- #254: Explain the new privacy boundary, file contents, revocation, and user-visible cloud operations only after those behaviors exist.
- #259: Independently assess PWA-only customer capability and Electron retirement. This proof does not justify decommissioning Electron.

Google documentation:
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model
- https://developers.google.com/identity/oauth2/web/guides/error
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
