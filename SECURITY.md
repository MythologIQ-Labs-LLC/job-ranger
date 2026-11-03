# Security Policy

## Supported scope

Sojourner is a local-first personal career application. It runs as a desktop (Electron) app and, on the post-v1.2 development line, as a local-first web/PWA app built on the same shared core.

The latest stable published release is **v1.2.0** (`71f9b790a1f456321aee2c783f39f4a6784b83a9`). It is a desktop release. The web/PWA runtime and the Microsoft Store package exist on `main` but are not yet published channels. See [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md) for the shipped and unreleased boundary.

Sojourner should not be represented as a hardened enterprise endpoint, centrally managed security product, or sandbox for arbitrary web content.

## Security model

The desktop app uses the following boundaries:

- Electron renderer `nodeIntegration: false`;
- `contextIsolation: true`;
- `webSecurity: true`;
- primary renderer sandboxing;
- typed preload/IPC rather than direct Node access from React;
- renderer Content Security Policy;
- validated external navigation before `shell.openExternal`;
- constrained hidden browser surfaces for recognized browser-required acquisition;
- isolated Chromium resume rendering;
- local persistence rather than a hosted account backend.

The web/PWA runtime (post-v1.2, unreleased) uses the browser's equivalents, documented in [`docs/design/PWA_RUNTIME.md`](./docs/design/PWA_RUNTIME.md):

- a strict Content Security Policy with Trusted Types and an explicit allowlist of job-feed origins for `connect-src`;
- career data kept in origin-private browser storage (SQLite WASM on OPFS), never uploaded;
- a single-writer tab lock;
- a service worker that serves an integrity-verified app shell and activates updates only after the user confirms them;
- a refusal to open data written by a newer schema.

The Microsoft Store package (post-v1.2, unreleased) declares only the `runFullTrust` and `internetClient` capabilities. It keeps its data in package-isolated storage and reads an earlier desktop installation's data only through an explicit, read-only import. See [`docs/design/MICROSOFT_STORE_PACKAGING.md`](./docs/design/MICROSOFT_STORE_PACKAGING.md).

These controls reduce risk but do not make third-party content trustworthy. Career pages, resumes, and imported documents remain untrusted input.

## Data handling

Structured state is stored locally behind the Electron/SQLite boundary, including:

- companies and job sources;
- jobs, canonical source snapshots, and scrape history;
- filters and settings;
- Career Profile and Target Tracks;
- Applications;
- Career Evidence and provenance;
- job requirements and evidence mappings;
- resume projections/artifacts;
- lifecycle contacts/events/offers;
- Career Stories;
- application materials and related local state.

Managed source/resume artifacts live under Sojourner's local data/artifact directory.

Backup/restore is local and versioned. Cloud sync of the live workspace is not part of the product: the working database never leaves the local data directory.

**Storage location (Windows app, optional, #249).** The person may choose one location for copies of full `.sojourner` workspace backups (automatic after changes and on quit, or **Back up now**) and of exported documents (resume PDFs, JSON Resume files): a local folder, their own Google Drive (scope `drive.file`, a `Sojourner` folder, the same Desktop sign-in and custody as Drive export below) or their own OneDrive (Microsoft identity platform public client, tenant `common`, system browser with PKCE S256 and a single-use state on a `http://localhost` loopback, scopes `Files.ReadWrite.AppFolder` and `offline_access` only, Graph app folder only, no client secret). Refresh tokens are stored only encrypted with Windows `safeStorage` (session-only when unavailable) outside the data directory; access tokens stay in main-process memory; nothing token-related is logged, written to SQLite, put in URLs, backups or archives, or sent to the renderer. Main-process egress for storage (`electron/src/storage/storage-egress.cts`) allows only the Drive v3 file and upload paths, `login.microsoftonline.com/common/oauth2/v2.0/token`, Graph paths under `/v1.0/me/drive/special/approot`, and upload-session or download URLs that Graph itself returned on Microsoft content domains (never with a token); no redirects, timeouts and capped responses. Every copy is verified by readback SHA-256 and recorded (migration 1011) as pending, uploaded, verified or failed; retention deletes only older verified automatic backups Sojourner recorded at that location. Restores from a location go through the existing archive validation and staged restart. Microsoft offers public clients no revocation endpoint: disconnecting deletes the stored sign-in and tells the person where to remove the app's access. No telemetry; nothing else leaves the device. [Contract and threat model](./docs/design/STORAGE_LOCATIONS.md). Not live-provider qualified yet.

**Google Drive export (optional, off by default, #314).** The only data flow to a third party is a user-approved upload of one verified resume PDF to the user's own Google Drive, with scope `drive.file` only and an approval of exactly that file on every export ([ARCH-005](./docs/ARCHITECTURE_INDEX.md), [contract](./docs/design/GOOGLE_DRIVE_ARTIFACT_EXPORT_CONTRACT.md)). There is no automatic sync of resume exports (the optional storage location above copies backups and exported documents automatically) and no Sojourner server in the path. In the **Windows app** it exists only in a build configured with a Google Desktop OAuth client: sign-in uses the system browser with PKCE (S256) and a single-use state on a `127.0.0.1` loopback redirect; the access token stays in main-process memory; the refresh token is stored only encrypted with Windows `safeStorage` (session-only when encryption is unavailable), outside the data directory, so it is never in SQLite, logs, URLs, backups, archives or the renderer; main-process egress is limited to `oauth2.googleapis.com` (token, revoke) and the `www.googleapis.com` Drive v3 API and upload paths, with no redirects and capped responses; disconnecting deletes the stored sign-in and revokes it at Google (best effort). The Desktop client secret ships in every installed copy and is treated as public configuration, not a security control. In the **PWA**, authorization happens only on the separately hosted OAuth helper origin and the access token stays in page memory ([isolation design](./docs/security/SOJOURNER_DRIVE_OAUTH_ISOLATION.md)). Neither runtime is live-provider qualified yet.

Do not add telemetry, hosted account sync, external inference transmission, or other remote personal-data flows without explicit product governance, user disclosure, and security/privacy review. Any future inference implementation must also conform to the provider-neutral [docs/design/INFERENCE_CONTRACT.md](./docs/design/INFERENCE_CONTRACT.md), including data minimization, pre-transmission manifests, schema-bounded proposals, deterministic adjudication, and runtime-specific credential constraints. Provider credentials and hashing salts never enter prompts, logs, provenance, or backup/portable archives, and provider-supplied error text is never logged or persisted verbatim.

## Imported career documents

Resume/document import treats files as untrusted input.

Current controls include:

- format/content validation where applicable;
- size/resource limits;
- source preservation before interpretation;
- SHA-256 hashing;
- parser/version extraction snapshots;
- explicit encrypted/malformed/unsupported/parser-failure states;
- explicit OCR-required state for image-only/scanned documents.

Sojourner does not silently upload resumes to hosted OCR or inference services.

## Acquisition network policy

Automated acquisition has more authority than a normal user click and therefore uses a stricter network boundary.

Current controls reject automated acquisition targeting unsafe destinations such as:

- localhost/loopback;
- private-network addresses;
- link-local addresses;
- reserved/non-public targets disallowed by policy;
- hostnames whose approved resolution includes a disallowed address;
- redirects into disallowed destinations.

### Connection-level DNS-rebinding protection

Issue #123 is complete in the v1.2.0 release line.

The current acquisition boundary does not merely preflight a hostname and then hand it back to an unconstrained resolver. Instead:

- policy resolution produces the exact approved public address set;
- direct HTTP/HTTPS sockets connect only to one of those approved addresses;
- HTTP `Host`, TLS SNI, and certificate verification continue to use the original hostname;
- redirects are manually handled and independently resolved, approved, and pinned per hop;
- source discovery uses the same pinned transport;
- isolated Electron scraper HTTP/HTTPS document and subresource requests are routed through the governed pinned transport;
- deterministic tests simulate a public address during approval and a hostile private address on a hypothetical later lookup, proving the actual direct connection remains pinned to the approved destination.

Arbitrary generic career-site hostnames remain manual-review/non-runnable in v1.2.0. Known provider/vendor paths retain governed acquisition.

Future changes must preserve connection-level pinning. Do not replace this boundary with a simple `http/https` URL check or with preflight-only DNS validation.

## External navigation

User-directed external links are validated separately from automated acquisition.

The fact that a URL is acceptable for `shell.openExternal` does not imply that Sojourner should automatically retrieve it through privileged acquisition code.

## Resume rendering security

The resume renderer uses a dedicated hidden Chromium surface with:

- sandbox enabled;
- `nodeIntegration: false`;
- `contextIsolation: true`;
- `webSecurity: true`;
- JavaScript disabled;
- navigation blocked;
- window opening denied;
- a document CSP denying remote resources;
- HTML-escaped user content.

Resume rendering must not become a general browser or remote-content surface.

## Backup and restore safety

Backup/restore is a destructive-data boundary and must fail closed.

Current design requirements include:

- SQLite snapshot rather than a casual copy of a live database;
- manifest/version validation;
- artifact/hash integrity validation;
- staged restore;
- path rebasing before activation when restoring to a different data root;
- preservation of the old live data as a rollback candidate until restored state is validated.

A restore feature that deletes the only known-good copy before proving the replacement works is a security/reliability defect.

## Distribution trust

Repository-side distribution trust is governed by [`docs/DISTRIBUTION_TRUST.md`](./docs/DISTRIBUTION_TRUST.md).

### Supported channels after v1.2.0

The primary channel is the signed Windows installer; the web/PWA runtime, served from a controlled HTTPS origin, continues alongside it ([`docs/ARCHITECTURE_INDEX.md`](./docs/ARCHITECTURE_INDEX.md) ARCH-001). Installation trust comes from the MythologIQ Labs, LLC Authenticode signature for the installer, and from HTTPS origin identity and browser security for the PWA. The Microsoft Store package is not a shipping channel.

### Direct-download binaries

Every published Windows installer is signed; a build-only candidate never is and is never published. Native macOS packages are built only on manual dispatch.

The Windows path is:

- Microsoft Azure Artifact Signing with the `mythologiq-labs-public-release` profile, signed in through GitHub OIDC from the owner-approved `release` environment (no client secret);
- signing of the application executable, bundled `sqlite3.exe`, helper executables and installer, timestamped;
- `signtool verify /pa`, signer `MythologIQ Labs, LLC` and timestamp checks for each, recorded in `windows-signing.json`.

When a native macOS package is published, its path is:

- Developer ID Application signing;
- hardened runtime;
- Apple notarization and stapling;
- `codesign`, `spctl`, and stapler validation;
- release trust evidence recorded in `macos-signing.txt`.

Clean-machine evidence for promoted direct-download binaries follows [`docs/CLEAN_MACHINE_TRUST_VALIDATION.md`](./docs/CLEAN_MACHINE_TRUST_VALIDATION.md). Store and web channel evidence is tracked by #125 and #130.

### Prerelease/tester builds

Prerelease tags are signed like any published Windows release. Unsigned Windows builds exist only as short-lived build-only workflow artifacts.

The release pipeline emits SHA-256 checksums and machine-readable release manifests from the exact packaged files uploaded to GitHub Releases.

Windows Smart App Control can make unsigned software non-runnable without a supported per-app exception. Sojourner does not instruct users to disable Smart App Control, SmartScreen, or Defender.

macOS testers may use Apple's bounded Privacy & Security → Open Anyway flow when the operating system offers it after the artifact has been independently verified. Sojourner does not recommend disabling Gatekeeper globally or recursively stripping quarantine metadata.

See [`docs/TESTER_INSTALLATION.md`](./docs/TESTER_INSTALLATION.md).

## Reporting a vulnerability

Do **not** publish exploit details in a public issue.

If GitHub presents a private **Report a vulnerability** option for this repository, use that channel.

If no private reporting channel is available, open a public issue containing only a request for a private security contact and omit vulnerability details.

A useful private report includes:

- affected release/commit;
- reproduction steps;
- expected and actual behavior;
- realistic impact;
- whether user interaction is required;
- relevant logs/screenshots without unrelated personal data;
- suggested mitigation, if known.

## Security-relevant contribution rules

Changes touching any of the following require explicit review and risk-appropriate validation:

- Electron `webPreferences`;
- renderer sandboxing;
- preload/IPC exposure;
- external URL handling;
- acquisition-network policy or pinned transport;
- browser-backed extraction;
- local filesystem paths;
- backup/restore;
- SQLite access/migrations;
- Career Evidence authority;
- application lifecycle persistence;
- resume rendering/import;
- updater/install behavior;
- signing/notarization credentials or provider secrets;
- remote inference;
- telemetry or cloud services;
- browser autofill/form interaction.

Fail closed where malformed or deceptive content could cause unsafe navigation, execution, filesystem access, network access, factual-authority escalation, or release-trust downgrade.

## Dependency security

Dependency state must be established from the current lockfile and current audit evidence, not historical claims from an older release.

`scripts/audit-dependencies.mjs` blocks high/critical findings except for one narrowly bounded upstream-blocked **dev-tool-only** advisory path:

- advisory: `GHSA-ch52-4w7c-c8xp`;
- exception is allowed only when the affected nodes are proven development-only and connected to that exact advisory;
- runtime dependencies, unrelated advisories, or disconnected high/critical findings still fail closed.

The exception is not a general audit waiver and should be removed once the supported dependency path is fixed.

Do not use `npm audit fix --force` as a substitute for dependency review.

## Validation policy

Security-relevant validation may run through hosted workflows or through documented manual evidence when appropriate.

Validation evidence must state:

- environment;
- exact commands/checks;
- results;
- anything that could not be exercised.

A lack of a hosted Actions run is not itself a security defect. A lack of validation evidence is.

## Release security

Before any new release is published, the candidate must satisfy [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md), including:

- current dependency review;
- migration/upgrade and backup/restore validation from the latest published release;
- connection-pinned acquisition regression evidence;
- Windows bundled-SQLite validation;
- immutable packaged candidate evidence;
- Microsoft Store package validation and certification for the Store channel;
- web/PWA build, browser-suite, and deployment validation for the web channel;
- signing and clean-machine evidence for any direct-download binary promoted to ordinary users;
- packaged product-smoke validation;
- documentation truthfulness.

Published stable artifacts, not build configuration alone, define the supported public release surface.
