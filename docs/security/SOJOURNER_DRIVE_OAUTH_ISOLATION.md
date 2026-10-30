# Sojourner isolated Google OAuth helper — candidate integration (#264 / PR #356)

**Status: IMPLEMENTED BEHIND CONFIGURATION; UNQUALIFIED. NOT APPROVED FOR PUBLIC DEPLOYMENT OR MERGE.**

Sojourner's browser-only Career Ops workspace stores sensitive career information. An allowed third-party Google Identity Services (GIS) script has page-origin privileges even if CSP limits the external script URL. This candidate moves the GIS library into a separate, dedicated HTTPS origin, without placing Career Ops OPFS, IndexedDB, or its service worker under that origin.

## Source boundaries

| Surface | Bundle | Trust and authority |
| --- | --- | --- |
| Career Ops main PWA | `vite.pwa.config.ts`, `src/components/GoogleDriveResumeExport.tsx`, `src/pwa/drive/isolated-drive-auth.ts` | Opens helper on explicit click, generates 256-bit nonce, validates exact helper origin and WindowProxy, single-use grant, holds token only in volatile memory; independently approves and journals each PDF export |
| OAuth helper | `tools/drive-oauth-helper/index.html`, `helper.mjs` | Standalone page with GIS script and separate **second** explicit user click. It does not import app code or handle documents; posts only token grant data to configured exact app origin |
| OAuth gate | `src/pwa/drive/oauth-helper-response-contract.ts` | Validates protocol, exact message type, nonce, helper source and origin, `drive.file` scope, token shape, lifetime and replay prevention |
| Static helper build | `scripts/build-drive-oauth-helper.mjs` | Rejects missing/malformed/matching origins or client-secret input and emits only HTML, JS, public config and static security headers |

## Building

The approved deployment operator must configure **two different HTTPS origins**. The Google Web OAuth client must authorize the **helper origin**, not merely the PWA origin.

```sh
SOJOURNER_DRIVE_APP_ORIGIN=https://career.example.com \
SOJOURNER_DRIVE_HELPER_ORIGIN=https://auth.example.com \
SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_ID=YOUR_PUBLIC_WEB_CLIENT_ID.apps.googleusercontent.com \
npm run build:drive-oauth-helper
```

The output is `build/drive-oauth-helper/`. Deploy this output only to the configured helper origin, not within `dist-pwa/`, not as a subpath of the Career Ops origin, and not to the public marketing/demo site. The generated `_headers` file is meaningful only when the selected host actually honors that format. Independently inspect the **live response headers** (especially CSP, COOP, no-referrer, no-store, frame-ancestors) before any OAuth acceptance. **COOP compatibility is deliberately asymmetric:** the parent PWA uses `same-origin-allow-popups` and the separate-origin helper must use `unsafe-none` to preserve `window.opener` and the exact popup `WindowProxy`; making both origins `same-origin-allow-popups` severs the cross-origin messaging channel. The helper's `unsafe-none` policy permits an opener relationship and is a reviewed tradeoff, not cross-origin isolation by COOP. The helper must remain its own origin with a restricted CSP and no Career Ops data. Confirm the pair in real browsers; see MDN Cross-Origin-Opener-Policy compatibility tables.

For the main PWA build, set:

```sh
VITE_SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN=https://auth.example.com npm run build:pwa
```

When the helper origin is set, main PWA CSP removes Google's GIS script, stylesheet, and iframe allowances; it retains the Google Drive API endpoints needed for approved upload/readback. The demo flavor suppresses OAuth regardless of configuration. **If only `VITE_JOB_RANGER_GOOGLE_WEB_CLIENT_ID` is set and the helper origin is absent, the old same-origin GIS path remains active. Do not interpret this backwards-compatible fallback as an approved security architecture.**

The main PWA opens the helper after the user's first click. The helper initializes GIS only on its own separate origin and calls `requestAccessToken()` synchronously from the user's **second** click. An authorization response is not upload consent; existing verified-account, exact-artifact approval, durable journal and upload-readback controls still apply.

## Nonce custody and third-party script ordering

The helper must **not** include a parser-loaded Google GIS script in its HTML. The module `helper.mjs` first obtains the `nonce` from the fragment and calls `history.replaceState` to clear it. Only after validating the exact configured application origin, expected client-ID format, one-time nonce and live opener does it create a GIS script element. The script URL comes from the narrow `sojourner-google-gis` Trusted Types policy, under CSP `require-trusted-types-for 'script'; trusted-types sojourner-google-gis`.

This reduces the nonce exposure of a third-party script executing on the helper origin. It does **not** make GIS a trusted execution environment, eliminate the opener-navigation trust tradeoff or substitute for HTTPS-origin isolation and browser qualification.

The `tests/drive-oauth-helper-runtime.test.mjs` suite imports the **built helper module** with mocked browser objects and verifies actual nonce removal precedes GIS insertion, token requests require the helper's second user click, single-use handoff targets the configured application origin, and invalid/unpaired popups never load GIS. This is a Node simulation, **not** a real-browser or real-Google receipt. Test scripts must be executed on the exact PR head before any merge claim.

## Local verification

```sh
npm ci
npm run typecheck
npm run test:drive-oauth-isolation
npm run test:drive-artifact-export
npm run build:pwa
npm run build:pwa:demo
```

Then run complete PWA Playwright tests using the repository-pinned browser, and exercise the helper across **two real browser HTTPS origins** using a real Google Web OAuth client. Unit mocks are not equivalent to real popup, CSP, COOP, and authorized consent behavior.

### Required adversarial browser acceptance

1. Confirm GIS's JS executes only in the helper origin, while OPFS/IndexedDB workspace remains inaccessible to it. Confirm main response CSP has no GIS `script-src` entry.
2. Confirm the helper origin's live CSP/COOP headers and authorized Google Web OAuth JavaScript origin; do not assume the generated `_headers` file is deployed by every host.
3. Check helper-open popup and Google's nested account popup on Chromium/Firefox/Safari where supported, including popup blocking, closed windows, privacy protections and browser restarts.
4. Forge wrong origin, wrong popup source, wrong/random/stale nonce, replay, wrong scope, malformed/expired token, changed opener navigation, reload, timeout, helper origin misconfiguration and cross-origin policy separation. Token must never be logged, placed in a URL, or persisted to storage.
5. Complete a real Google consent with an owner-controlled Web OAuth client and `drive.file` grant. Verify Drive account binding, explicit PDF digest approval, upload, metadata/bytes readback, and recovery from ambiguous requests.
6. Inspect main demo build to ensure no working Google UI, no Google network calls, and no misleading OAuth/Drive marketing claims.
7. Run independent security review and record exact SHA, origin pair, response headers, browser, test receipts, threat model and owner decision.

**No source changes in this branch provide a Google Cloud OAuth client, live HTTPS origin pair, or actual provider acceptance.** Keep PR #315 and PR #356 NO-GO for final beta release until those dependencies are qualified. Do not trigger hosted CI, merge or deploy from this document.

References: [Google's GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Google's JS authorization API](https://developers.google.com/identity/oauth2/web/reference/js-reference), and repository issue #264.
