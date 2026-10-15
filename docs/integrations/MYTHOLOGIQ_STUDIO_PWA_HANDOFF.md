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

- `dist-pwa/build-info.json`: existing build ID, version, commit, CSP and SHA-256 shell asset inventory.
- `dist-pwa/studio-handoff.json`: strictly build-derived schema version 1 describing the external-link entry, local-data boundary, real PWA limitations, and human approval gates.
- The existing `index.html`, `sw.js`, `_headers`, PWA manifest and verified runtime assets.

`npm run package:pwa` includes these exact files in the attested web archive and rejects tampering, mismatched build identity, missing security policy and wrong or unsafe asset hashes before packaging. The handoff file is **not** a billing entitlement, feature permission, marketing authorization or proof of a published release.

Example **candidate** handoff shape (values are from the actual artifact, never hard-code this example as a release):

```json
{
  "schemaVersion": 1,
  "kind": "job-ranger-studio-handoff",
  "product": "job-ranger",
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
node scripts/verify-studio-handoff.mjs --site dist-pwa
npm run package:pwa
```

The offline verifier checks manifest identity, hashed assets, service worker identity and required static security headers. This is a **candidate** check, not proof of correct provider deployment or end-to-end browser behavior.

After a separate owner-authorized staged deployment, verify the real HTTPS origin:

```sh
node scripts/verify-studio-handoff.mjs --origin https://APP-ORIGIN-APPROVED-BY-OWNER.example --build-id 'PINNED_VERSION+COMMIT' --build-info-sha256 'SHA256_FROM_VERIFIED_LOCAL_ARTIFACT'
```

This checks the root HTTPS security headers against the approved CSP, requires the pinned release build-info SHA-256, and verifies the live `studio-handoff.json`. It reports **artifact verified, owner approval still required**, not "public launch approved". A staged deployment must additionally pass real-browser testing, persistence/quota and backup/restore, first-load/offline/update, runtime CSP and provider CORS testing, responsiveness/accessibility, and honest feature-status review. The PWA must never be served as an arbitrary source checkout or unreviewed CI branch.

## Website hookup, only after launch acceptance

Make the smallest possible change in `Knapp-Kevin/MythologIQ`:

1. Keep the existing product page and its accurate real-application screenshots, descriptions and demo.
2. Supply the approved permanent **HTTPS origin** and **exact pinned build ID** in a small website config. The config defaults **disabled**; never auto-derive enabled from this JSON.
3. When the released artifact, live hosted origin, real browser journey and owner approval agree, show `Try Job Ranger in your browser` as a normal accessible external link. Use `target="_blank" rel="noopener noreferrer"` if opening a new tab. Do **not** iframe the PWA or proxy its app shell through the Studio web server.
4. Describe data accurately: the Job Ranger workspace lives in this browser/profile at the application origin. It is not synchronized to the Studio website; user backups remain necessary.
5. Count optional **aggregate** Studio page visits and outbound CTA clicks only, using existing site analytics. Do not send a user's resume, career goals, opportunity URLs, job queries, employer names, account tokens, imported files or application state to analytics.
6. Keep the CTA feature-gated so marketing can remove its link during an incident **without deleting, disabling or silently moving existing users' origin-local data**.

There should be **no Job Ranger feature implementation in Studio**. Future Studio redesigns or a dedicated Job Ranger marketing domain only change the outbound link, not the PWA origin.

## Trial and paid-service boundaries

The initial hosted browser experience is the **actual deterministic free Job Ranger core**, not a fabricated UI mock, ungoverned shadow product, or fake interactive fixture. The original demo video uses fictional sample data; using fictional fixture data in a *live* user workspace requires a separately designed opt-in/resettable demonstration mode so it cannot be mistaken for canonical user history. No fixture seeding on existing user profiles is approved here.

The PWA's existing job-source integration remains provider/CORS-dependent; it cannot perform reliable closed-browser monitoring. Future paid value may include user-authorized **hosted acquisition and scheduled monitoring**, but those require separate contracts for source legality/terms, quotas, secret isolation, consent, user isolation, retention, server cost, notifications, authentication and AGPL compliance. None is shipped or unlocked by the Studio handoff.

### Exit criteria for this repository slice

- [x] Machine-readable build-derived Studio integration contract.
- [x] Local and live verification functions with fail-closed identity/security checks.
- [x] Contract tests for tampering, fake CTA approval, non-HTTPS origin and wrong build ID.
- [x] PWA build, package and browser-validation wiring.
- [ ] Execute full PWA production build and browser suite against the exact candidate in a supported runtime, record proof.
- [ ] Run staged hosted acceptance after separate owner authorization.
- [ ] Confirm final origin, pricing non-claims, privacy copy and owner approval.
- [ ] Only then wire the Studio CTA (in the Studio repo) and publish by its separate release process.
