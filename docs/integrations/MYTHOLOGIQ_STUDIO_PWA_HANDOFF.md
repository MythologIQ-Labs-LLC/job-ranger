# MythologIQ Studio: Job Ranger PWA handoff

**Status:** implementation candidate; NOT deployed, released, approved for public access, or linked from Studio.  
**Implementation authority:** `MythologIQ-Labs-LLC/job-ranger` owns the entire PWA.  
**Website consumer:** `Knapp-Kevin/MythologIQ`, specifically `/side-projects/job-ranger`.  
**Related:** Job Ranger #299 (closed prior proposal; new owner authorization is **repository-side preparation only**), Studio #128 (closed planning proposal), distribution architecture, PWA runtime, and existing protected `deploy-pwa.yml`.

## Design decision

Studio is the **front door**, not the application host. The full Job Ranger PWA is built and released from this repository and eventually served from a **dedicated, stable HTTPS origin**, subject to release acceptance. Studio supplies a product description, authentic screenshots, optional aggregate CTA analytics, and a normal external link to that origin. There is **no iframe, module federation, shared database, embedded copy of the app, or Studio-side implementation of Career Ops**.

Do not put early users on a throwaway temporary origin with plans to move them later. The PWA stores Career Evidence, application records, resumes and managed artifacts in origin-private browser storage. A new origin is a different installation and needs explicit portable `.jobranger` backup/import. A new *marketing* site can point to the original app origin without migrating data.

## The plug-and-play contract

Every `npm run build:pwa` now produces:

- `dist-pwa/build-info.json`: existing build ID, version, **build flavor**, commit, CSP, SHA-256 shell asset inventory, and **exact service-worker byte digest**.
- `dist-pwa/studio-handoff.json`: strictly build-derived schema version 1 describing the build flavor, external-link entry, local-data boundary, real PWA limitations, and human approval gates.
- The existing `index.html`, `sw.js`, `_headers`, PWA manifest and verified runtime assets.

The **standard** flavor (above) is the real workspace. A separate **demo** flavor (`npm run build:pwa:demo`, see *Demo flavor* below) produces the same files in `dist-pwa-demo/`. `npm run package:pwa` includes these exact files in the attested web archive and rejects tampering, mismatched build identity, missing security policy and wrong or unsafe asset hashes before packaging. The handoff file is **not** a billing entitlement, feature permission, marketing authorization or proof of a published release.

Example **candidate** handoff shape (values are from the actual artifact, never hard-code this example as a release):

```json
{
  "schemaVersion": 1,
  "kind": "job-ranger-studio-handoff",
  "product": "job-ranger",
  "flavor": "standard",
  "build": { "version": "1.3.0", "buildId": "1.3.0+SOURCE_SHA", "commit": "SOURCE_SHA" },
  "entry": { "path": "/", "mode": "external-navigation", "iframeAllowed": false, "preserveOrigin": true },
  "studio": {
    "pagePath": "/side-projects/job-ranger",
    "ctaLabel": "Try Job Ranger in your browser",
    "autoEnableCta": false,
    "requiresOwnerApproval": true,
    "requiresVerifiedHttpsOrigin": true,
    "requiresMatchingLiveBuildId": true
  }
}
```

Studio must treat the pinned `buildId` and final owner-approved HTTPS origin as **release inputs**, not runtime discovery or an invitation to fetch private application data. The app intentionally serves `Cross-Origin-Resource-Policy: same-origin` and no third-party CORS permission for Studio. Studio should **not fetch `studio-handoff.json` client-side**. The release owner can inspect the file from the release artifact and provide Studio the approved origin and exact build ID during a website change review.

## Local verification (no hosted Actions required)

```sh
npm run build:pwa
npm run test:studio-handoff
node scripts/verify-studio-handoff.mjs --site dist-pwa --flavor standard
npm run package:pwa

# Demo flavor (separate output directory, build ID and archive)
npm run build:pwa:demo            # same as JOB_RANGER_PWA_FLAVOR=demo npm run build:pwa
node scripts/verify-studio-handoff.mjs --site dist-pwa-demo --flavor demo
npm run package:pwa:demo          # same as JOB_RANGER_PWA_FLAVOR=demo npm run package:pwa
```

`--flavor` is required and pins the expected flavor, so a demo artifact is rejected where the standard workspace is expected, and the reverse. A build made before flavors existed (no `flavor` in `build-info.json`, legacy handoff without a `flavor` field) verifies only as `standard`, and only if its build ID has no `.demo` suffix. The production web deploy (`deploy-pwa.yml`) refuses any build whose flavor is not `standard`.

The offline verifier checks manifest identity, hashed assets, **service-worker byte digest**, and required static security headers. This is a **candidate** check, not proof of correct provider deployment or end-to-end browser behavior.

After a separate owner-authorized staged deployment, verify the real HTTPS origin:

```sh
node scripts/verify-studio-handoff.mjs --origin https://APP-ORIGIN-APPROVED-BY-OWNER.example --build-id 'PINNED_VERSION+COMMIT' --build-info-sha256 'SHA256_FROM_VERIFIED_LOCAL_ARTIFACT' --flavor standard
```

This checks the root HTTPS security headers against the approved CSP, requires the pinned release build-info SHA-256, verifies **every live shell asset against that release's SHA-256 manifest (plus the service-worker digest)**, and verifies the live `studio-handoff.json`. Downloads are streamed with bounded concurrency and size limits; a substituted hosted JS file or altered worker cannot pass by retaining the same build ID. It reports **artifact verified, owner approval still required**, not "public launch approved". A staged deployment must additionally pass real-browser testing, persistence/quota and backup/restore, first-load/offline/update, runtime CSP and provider CORS testing, responsiveness/accessibility, and honest feature-status review. The PWA must never be served as an arbitrary source checkout or unreviewed CI branch.

## Website hookup, only after launch acceptance

Make the smallest possible change in `Knapp-Kevin/MythologIQ`:

1. Keep the existing product page and its accurate real-application screenshots, descriptions and demo.
2. Supply the approved permanent **HTTPS origin** and **exact pinned build ID** in a small website config. The config defaults **disabled**; never auto-derive enabled from this JSON.
3. When the released artifact, live hosted origin, real browser journey and owner approval agree, show `Try Job Ranger in your browser` as a normal accessible external link. Use `target="_blank" rel="noopener noreferrer"` if opening a new tab. Do **not** iframe the PWA or proxy its app shell through the Studio web server.
4. Describe data accurately: the Job Ranger workspace lives in this browser/profile at the application origin. It is not synchronized to the Studio website; user backups remain necessary.
5. Count optional **aggregate** Studio page visits and outbound CTA clicks only, using existing site analytics. Do not send a user's resume, career goals, opportunity URLs, job queries, employer names, account tokens, imported files or application state to analytics.
6. Keep the CTA feature-gated so marketing can remove its link during an incident **without deleting, disabling or silently moving existing users' origin-local data**.

There should be **no Job Ranger feature implementation in Studio**. Future Studio redesigns or a dedicated Job Ranger marketing domain only change the outbound link, not the PWA origin.

## Demo flavor (#311)

The Studio page's "try it" experience is a **demo flavor** of the same PWA: the actual application and deterministic core, built with `JOB_RANGER_PWA_FLAVOR=demo` (`npm run build:pwa:demo`), running a fictional, session-scoped workspace. It is the separately designed, resettable demonstration mode this document previously required before any fictional data could appear in a live workspace.

**Build identity.** `build-info.json` and `studio-handoff.json` carry `"flavor": "demo"`; the build ID is `VERSION+SHA12.demo`; the document title and install manifest say *Job Ranger Demo*. The handoff states `runtime.canonicalCareerData: "none-session-scoped-demo"`, adds a `demo` block (`fictionalSampleData`, `sessionScopedWorkspace`, `resetsAtNextSessionStart`, `idleResetHours: 8`, `visitorResettable`, `refusesToEraseNonDemoWorkspace`, `requiresDedicatedOrigin`, `sharesOriginWithRealWorkspace: false`) and uses the CTA label *Try the Job Ranger demo in your browser* (still `autoEnableCta: false`, owner approval required). `npm run package:pwa:demo` writes `release/job-ranger-web-demo-vVERSION.zip` and `build/trust/web-demo-build-info.json`; the release manifest, `release-build.yml` (publishes `job-ranger-web-v*.zip` and the explicit standard trust files) and `deploy-pwa.yml` (downloads `job-ranger-web-v*.zip`, asserts `flavor === "standard"`, verifies with `--flavor standard`) never pick up demo artifacts. The security policy (CSP and headers) is identical to the standard flavor: the demo adds no network destinations and no analytics.

**Separate origin, always.** Origin-private storage is shared by everything served from one origin, and the demo replaces its workspace at the start of every demo session. Host the demo on its **own** HTTPS origin, never on the origin of a real workspace (present or future), and never switch an origin between flavors. Locally, `npm run preview:pwa:demo` serves it at `http://localhost:4175`; the launcher and the Vite config refuse ports 4174 and 5174 (the standard self-host and dev addresses) even when passed with `--port`.

**Never erases a non-demo workspace.** Every demo workspace carries a sentinel, `/job-ranger/.demo-workspace.json` (`schemaVersion`, `kind: "job-ranger-demo-workspace"`, `buildFlavor: "demo"`, `sessionId`, `createdAt`, `lastActiveAt`, `seeded`), written by the demo when it claims an empty workspace and again after seeding. Before erasing anything, the demo worker checks it (`src/pwa/runtime/demo-workspace.ts`): if `/job-ranger` holds any file but no valid demo sentinel (a real workspace, a staged restore, or an unreadable sentinel), the demo **refuses**, shows *"This site holds a Job Ranger workspace that is not a demo; the demo will not erase it."*, and opens, changes and erases nothing. Missing or empty directories are fine. This protects real data if the demo build is deployed to, served on, or updated into an origin that holds a real workspace. The standard flavor contains none of the demo code paths: the bundler removes them, and `tests/pwa-flavor-build.test.mjs` checks the built files.

**Session isolation.** Each tab holds a random demo session id in `sessionStorage` (a new tab or window, or a browser restart without session restore, gets a new one; a reload keeps it). The runtime worker, while holding the existing single-writer Web Lock and *before* it opens the database, compares that id with the sentinel's `sessionId`. It keeps the workspace only if they match, the seed completed, and the workspace was used within the last **8 hours** (`DEMO_IDLE_RESET_HOURS`; activity refreshes `lastActiveAt` at most every 5 minutes). Otherwise it deletes the PWA data roots, `/job-ranger` (database, managed artifacts and any staged restore) and `/job-ranger-io`, claims the empty workspace for this session, and seeds the fictional workspace through the shared core (`electron/src/demo-seed.cts`: the boundary validators and backend services, the listing normalizers the job-board adapters use, the repository write a source scan performs, and real requirement extraction). The page then clears Job Ranger's `localStorage` keys and marks onboarding as done. Because the sentinel names its owning session, a tab never opens a workspace another demo session took over while it waited for the lock, or after it was restored (Ctrl+Shift+T). A copy of a tab (same session id) continues that session. **Reset demo** (banner, with confirmation) forgets the session id and reloads, which replaces the workspace immediately. A second tab waits on the lock and explains that closing the other tab discards that tab's demo changes. Closing a tab does **not** erase anything by itself: the entries stay in the browser until the next demo session starts, 8 idle hours pass, Reset demo is used, or the site's data is cleared.

**Seeded workspace.** Dates (listing publication, evidence and credential dates) are relative to the moment of seeding, so the story and the assessment results are the same whenever it is seeded. Morgan Rivera's profile (Baltimore, MD), one Target Track (*Practice operations*), four confirmed Career Evidence records, the fictional employer *Harbor Health* and three listings (annual and hourly pay, *City, ST* locations) whose requirements are extracted, so Find Jobs and the assessment drawer show supported and unsupported requirements, and one tracked application. The seeded evidence is sufficient for the real resume flow to export a verified PDF. Seeding is deterministic in content and idempotent-safe (`tests/demo-seed-smoke-test.cjs`, on both SQLite engines).

**Labeling.** A persistent, accessible banner on every page: fictional sample data; what you enter stays in this browser on this site until a new demo session starts or the demo sits unused for 8 hours, then it is replaced with fresh sample data; to remove it now, use **Reset demo** or clear the site's data. Boot, error and storage messages are demo-accurate (no persistence or backup advice). Listing URLs use the reserved, never-resolving host `demo-listing.invalid`; `isDemoListing(url)` (`src/shared/demo-listing.ts`) drives a *Demo listing — fictional, not a real opening* badge on Find Jobs cards, the assessment drawer and Applications, and opening or applying shows an explanation instead of navigating (the web runtime client also refuses to open such URLs). The demo employer has no job-board token, so it is never a monitorable source and never causes a network fetch. Public sources a visitor adds themselves are real openings and keep working normally. Settings and Help carry an *About this demo* section.

**Not included in the demo:** Google Drive, monitoring and notifications while the browser is closed, inference and MCP connections, desktop-only features (tray, hidden-browser career sites, revealing files), and sync or accounts. Exported backups download to the visitor's device; a restore in the demo lasts only for that session. Exported resume PDFs and JSON Resume files contain the fictional data and carry no demo marker; Settings and Help say so.

**Deploying the demo** (`.github/workflows/deploy-pwa-demo.yml`, manual dispatch from `main` only). `deploy-pwa.yml` deploys only the standard flavor from an attested release; the demo has its own path:

1. **build**: dispatch from `main` (no inputs). It builds both flavors from the dispatched commit, the tip of `main` at that moment, and never checks out a caller-chosen ref (CodeQL cache-poisoning rule; no dependency cache is used either). To roll back, revert on `main` and dispatch again. It checks the demo build identity and handoff (`--flavor demo`), runs the demo browser journeys and packages `job-ranger-web-demo-v*.zip`. This job has no OIDC or attestation permission.
2. **attest**: a separate job that installs nothing attests the archive.
3. **deploy** (environment **`demo-web`**): refuses unless it was dispatched from `main` and all four repository variables are set; refuses a non-HTTPS or invalid demo origin, an origin equal to the real web app's (compared as parsed URL origins, so case, default port, path and whitespace do not matter), or a Pages project equal to the real web app's. It verifies the attestation (pinned to this workflow), re-checks flavor, build ID and commit of the unpacked site, deploys with `wrangler pages deploy`, then byte-verifies the live origin (`--flavor demo`, pinned build-info digest, security headers).

**Owner setup** (nothing exists yet):
- Repository variables (repository-level, not environment variables: the guard must see the real app's values to compare them): `JOB_RANGER_DEMO_PAGES_PROJECT` (a Pages project used for nothing else), `JOB_RANGER_DEMO_ORIGIN`, `JOB_RANGER_PWA_PAGES_PROJECT`, `JOB_RANGER_PWA_ORIGIN`.
- Environment `demo-web`, created before the first run (otherwise GitHub creates it unprotected): required reviewers, deployment branches limited to `main`, and the environment secrets `CLOUDFLARE_API_TOKEN` (preferably scoped so it can deploy only the demo project) and `CLOUDFLARE_ACCOUNT_ID`.
- Never point the demo project or origin at one that serves, or will serve, real workspaces.

**Studio wiring** follows the same rules as above: a normal external link to the approved demo origin and pinned `.demo` build ID, never an iframe, disabled until owner approval.

## Trial and paid-service boundaries

The initial hosted browser experience is the **actual deterministic free Job Ranger core**, not a fabricated UI mock, ungoverned shadow product, or fake interactive fixture. The original demo video uses fictional sample data. Fictional data in a *live* browser workspace exists only in the demo flavor above, on its own origin; no fixture seeding of existing user profiles or of the standard flavor is approved.

The PWA's existing job-source integration remains provider/CORS-dependent; it cannot perform reliable closed-browser monitoring. Future paid value may include user-authorized **hosted acquisition and scheduled monitoring**, but those require separate contracts for source legality/terms, quotas, secret isolation, consent, user isolation, retention, server cost, notifications, authentication and AGPL compliance. None is shipped or unlocked by the Studio handoff.

### Exit criteria for this repository slice

- [x] Machine-readable build-derived Studio integration contract.
- [x] Local and live verification functions with fail-closed identity/security checks.
- [x] Contract tests for tampering, fake CTA approval, non-HTTPS origin and wrong build ID.
- [x] PWA build, package and browser-validation wiring.
- [x] Demo flavor: distinct build identity, handoff and archive; session-scoped seeded workspace; labeling; browser tests (`tests/pwa/demo-flavor.spec.ts`).
- [ ] Execute full PWA production build and browser suite against the exact candidate in a supported runtime, record proof.
- [ ] Run staged hosted acceptance after separate owner authorization.
- [ ] Confirm final origin, pricing non-claims, privacy copy and owner approval.
- [x] Guarded demo deploy path (`deploy-pwa-demo.yml`) implemented and statically tested; **not yet exercised** (needs the owner setup above).
- [ ] Choose and approve the demo's own origin (distinct from any real-workspace origin) and run staged acceptance of the demo build there.
- [ ] Only then wire the Studio CTA (in the Studio repo) and publish by its separate release process.
