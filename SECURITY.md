# Security Policy

## Supported scope

Job Ranger is a local-first personal career application. It runs as a desktop (Electron) app and, on the post-v1.2 development line, as a local-first web/PWA app built on the same shared core.

The latest stable published release is **v1.2.0** (`71f9b790a1f456321aee2c783f39f4a6784b83a9`). It is a desktop release. The web/PWA runtime and the Microsoft Store package exist on `main` but are not yet published channels. See [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md) for the shipped and unreleased boundary.

Job Ranger should not be represented as a hardened enterprise endpoint, centrally managed security product, or sandbox for arbitrary web content.

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

Managed source/resume artifacts live under Job Ranger's local data/artifact directory.

Backup/restore is local and versioned. Cloud sync is not part of the current product.

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

Job Ranger does not silently upload resumes to hosted OCR or inference services.

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

The fact that a URL is acceptable for `shell.openExternal` does not imply that Job Ranger should automatically retrieve it through privileged acquisition code.

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

Windows Smart App Control can make unsigned software non-runnable without a supported per-app exception. Job Ranger does not instruct users to disable Smart App Control, SmartScreen, or Defender.

macOS testers may use Apple's bounded Privacy & Security → Open Anyway flow when the operating system offers it after the artifact has been independently verified. Job Ranger does not recommend disabling Gatekeeper globally or recursively stripping quarantine metadata.

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
