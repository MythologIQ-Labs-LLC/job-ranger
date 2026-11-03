# Changelog

All notable user-facing, architecture, governance, and maintenance changes should be recorded here.

**Product lines.** Sojourner (from `1.0.0-alpha.1`) is a new product line. The Job Ranger releases below (v1.0.0 to v1.2.0) are kept as history: their GitHub Releases were removed on 2026-11-02 and their git tags renamed to `job-ranger-v*` (same commits, for example `job-ranger-v1.2.0`). The v1.3.0 Job Ranger candidate was never published; its content ships in Sojourner `1.0.0-alpha.1`.

## Unreleased

Nothing yet beyond `1.0.0-alpha.1`.

## 1.0.0-alpha.1 - Sojourner (prepared, not yet tagged)

The first Sojourner release: a signed Windows installer published as a GitHub **pre-release** (#363, #339). It contains everything on `main` since Job Ranger v1.2.0, detailed in the sections below and under v1.3.0. Release acceptance: [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md), "Current Windows release acceptance".

### Highlights

- **Sojourner: Employment Toolkit** (#351): the application formerly called Job Ranger, with Sojourner copy and artwork. It remains local-first: no account, no telemetry, and nothing leaves the device unless the person starts it.
- **Signed Windows app** (#364): `Sojourner-v1.0.0-alpha.1-windows-x64.exe` installs `Sojourner.exe`, with "Sojourner" shortcuts and uninstall entry. Every executable is Authenticode-signed by **MythologIQ Labs, LLC** (Azure Artifact Signing through GitHub OIDC, owner-approved `release` environment), and the release run fails unless `signtool verify /pa` passes with that signer and a timestamp. Release assets carry SHA-256 checksums, a release manifest and a GitHub artifact attestation.
- **Upgrade from Job Ranger v1.2.0 that keeps every record:** the installer removes an existing Job Ranger installation silently (keeping its data), and at first start Sojourner copies `%APPDATA%\job-ranger` to `%APPDATA%\Sojourner`, verifies the copy and uses it. The old folder is never changed or deleted. See **Everything is named Sojourner** below.
- **Web app (PWA)** continues alongside Windows on the same application core, with portable `.sojourner` backups that move a workspace between the two (older `.jobranger` backups still restore).
- **Workspace recovery** (#358): when a web workspace cannot open, the startup error screen offers to restore a backup.
- **Storage location in the Windows app** (#370, #369): Settings > **Storage location** offers **This computer**, **Google Drive** or **OneDrive**. Sojourner backs up the whole workspace there automatically after changes, copies exported resumes there, and can restore from it, for example on a new PC. The working database stays on the PC. Google and OneDrive use in-app sign-in with app-only access (`drive.file`; the OneDrive app folder). The Windows app can also send a verified resume PDF to Google Drive after explicit approval. A cloud provider appears only when its OAuth client is configured in the build; both are qualified against fakes, not yet against live Google and Microsoft accounts.
- **Google Drive export in the web app, off by default** (#315): the same approve-each-export flow for the PWA, with Google sign-in isolated on a separate helper origin. A hosted helper is not planned, so it stays off.
- Also on `main`: Himalayas remote-job discovery with local role matching (#233), the opt-in career exploration brief (#191), the cover-letter copy readiness gate (#230), honest empty Find Jobs results with one-click filter recovery (#248), and the offline Career Ops guide (#186).

### Everything is named Sojourner (owner decision 2026-11-02, #339, #363)

Every remaining Job Ranger / jobscout name in code, configuration, build output, storage and documentation is now Sojourner. Existing users keep all of their data:

- **Windows app identity:** appId `com.mythologiq.sojourner` (was `com.jobranger.app`), package name `sojourner`. Because the uninstall registry key follows the appId, the installer (`build/installer.nsh`, `customInstall`) finds a legacy Job Ranger install under HKCU, then HKLM, once Sojourner's own files are installed, and runs its uninstaller silently with `--updated` (retried while the old app closes), so there is exactly one app afterwards and its data is kept (`deleteAppDataOnUninstall: false`). Cancelling the installer leaves Job Ranger as it was.
- **Data folder migration:** at first start, before anything opens the database, Sojourner copies the whole legacy folder (`%APPDATA%\job-ranger`; Store: `Job Ranger Store`) into `%APPDATA%\Sojourner` (Store: `Sojourner Store`), renames `jobscout.sqlite3` to `sojourner.sqlite3`, points managed-artifact paths at the copy, and uses it only after every file has the same size and SQLite `PRAGMA integrity_check` passes. It then leaves `MIGRATED-TO-SOJOURNER.txt` in the old folder and never changes or deletes anything else there. If any step fails, the partial copy is removed and that run uses the old folder, retrying at the next start (`electron/src/legacy-migration.cts`). The Store app's import of direct-download data reads `%APPDATA%\Sojourner` first, then `%APPDATA%\job-ranger`.
- **Backups:** new backups are `.sojourner` files (`sojourner-archive.json`, `sojourner-portable-archive` / `sojourner-backup` formats, `sojourner.sqlite3` inside). `.jobranger` archives, older backup folders and restores staged before the upgrade still restore. Automatic backups in a storage location are named `*.sojourner`; `.jobranger` files there stay restorable.
- **Configuration and build names:** environment variables and repository variables `JOB_RANGER_*` are now `SOJOURNER_*` (for example `SOJOURNER_GOOGLE_DESKTOP_CLIENT_ID`, `SOJOURNER_MICROSOFT_CLIENT_ID`, `SOJOURNER_REQUIRE_WINDOWS_SIGNING`, `SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR`, `SOJOURNER_STORE_*`, `SOJOURNER_PWA_*`); the packaged smoke switch is `--sojourner-package-smoke-report`; workflow artifacts and the web archives are `sojourner-*`; temporary and work folders use `sojourner-` prefixes (old work folders are still cleaned up). Documentation files `JOB_RANGER_*.md` are now `SOJOURNER_*.md`.
- **Verification:** `tests/legacy-migration.test.cjs` (every migration branch, including fallbacks, against real folders and sqlite3), `tests/nsis-legacy-uninstall.test.cjs` (recomputes the legacy uninstall GUID from electron-builder's derivation), and `npm run test:release-upgrade`, which now migrates every `job-ranger-v1.2.0` data folder into a Sojourner folder and checks that it holds every record before opening it.
- Kept on purpose: history (this changelog's Job Ranger entries, `docs/validation/`, `docs/META_LEDGER.md`, the archived `job-ranger-v*` tags) and the `LEGACY_*` names the migration and restore code must recognise.

### Release engineering

- Version `1.0.0-alpha.1`. The release workflow titles releases "Sojourner `<tag>`" and marks `-alpha`, `-beta` and `-rc.` tags as pre-releases. A pushed `v*` tag no longer builds the Microsoft Store package; it stays available through a manual run with platform `windows-store`.
- `npm run test:release-upgrade` defaults to the newest stable Sojourner tag and, until one exists, to `job-ranger-v1.2.0`. It no longer runs `node` through a shell, which broke when Node is installed under a path with spaces.
- The Microsoft Store package is named Sojourner too (`Sojourner.exe`, `Sojourner Store` data folder, migrated from `Job Ranger Store` at first start); the Store is not a shipping channel.

### Changes on main since Job Ranger v1.2.0

These capabilities exist on the development line and were **not** part of the published Job Ranger v1.2.0 release.

- **Manual-first Personal Brand:** user-authored post drafts, deterministic readiness findings, exact-copy review packages, human-confirmed publishing receipts, saved observation snapshots, conservative learning, and a dedicated page. No connected publishing or LinkedIn account access.
- **LinkedIn analytics evidence:** local XLSX preview, explicitly confirmed import/persistence and deduplication, reconciliation of observed snapshots, manually attested historical post text and topic labels, observed performance dashboards, and cautious approved-content cohort comparisons. Missing data remains missing; correlations are not employment outcomes.
- **Economic pathway exploration:** Target Tracks includes user-authored hypothetical employment, fractional/contract, retraining and self-employment scenario arithmetic, without treating projections as verified market data.
- **Google Drive export in the Windows app** (#314; off by default, not live-provider qualified): a build configured with a Google Desktop OAuth client (`SOJOURNER_GOOGLE_DESKTOP_CLIENT_ID`/`_SECRET` repository variables, written into resources at package time) shows the same **Save PDF to Google Drive** review-and-approve panel as the PWA. Sign-in uses the system browser with PKCE (S256) and a single-use state on a `127.0.0.1` loopback redirect, scope `drive.file` only; the refresh token is kept encrypted with Windows `safeStorage` (session-only when unavailable) and never in SQLite, logs, archives or the renderer; **Disconnect Google Drive** deletes it and revokes access. Uploads reuse the shared reserved-ID, 409/404 reconciliation and byte-readback rules through one runtime-neutral flow, with a SQLite journal (migration 1010) enforcing the shared state machine. Builds without the client show no Drive UI and make no Google request. ARCH-005 now covers both runtimes.
- **Storage location in the Windows app** (#249, on top of #314/#369; not live-provider qualified): Settings > **Storage location** with three choices, **This computer** (default `Documents\Sojourner`, folder picker), **Google Drive** (a `Sojourner` folder, `drive.file`, the #369 Desktop sign-in) and **OneDrive** (Microsoft identity platform public client, PKCE on a `localhost` loopback, `Files.ReadWrite.AppFolder` and `offline_access` only, Graph app folder). Full `.sojourner` backups run automatically about 10 minutes after changes and on quit, never concurrently, with backoff retries and a visible status; **Back up now** adds a manual one; exported resume PDFs and JSON Resume files are copied to `Documents/`. Every copy is verified by readback SHA-256 and recorded in SQLite (migration 1011) as pending, uploaded, verified or failed; retention (default 20) removes only older automatic backups Sojourner recorded. **Restore from this location** downloads to a temporary file and uses the existing validate, stage and restart path. The working database stays local. The Microsoft client id comes from the `SOJOURNER_MICROSOFT_CLIENT_ID` repository variable at package time; an unconfigured provider is shown disabled. The PWA is unchanged. Contract: [`docs/design/STORAGE_LOCATIONS.md`](./docs/design/STORAGE_LOCATIONS.md).
- **Local read-only MCP prototype:** development-only permission-filtered stdio adapter and separately documented outbound Secure MCP Tunnel experiment, without asserting a live ChatGPT plugin integration.
- **Web demo flavor** (Refs #311): `npm run build:pwa:demo` (or `SOJOURNER_PWA_FLAVOR=demo npm run build:pwa`) builds the real web app as a demonstration for the MythologIQ Studio site, to be hosted on its own origin. Each demo session (per tab, bound to the workspace by a sentinel) starts from a fresh workspace with fictional sample data (Morgan Rivera, Harbor Health, three listings, a Target Track, Career Evidence and a tracked application), seeded through the shared application core; reloads keep the session's changes, a workspace idle for 8 hours is replaced, and **Reset demo** starts over. The demo refuses to erase any workspace that lacks its demo sentinel (for example a real workspace on the same origin), and refuses to run on the standard local ports. A banner on every page, a *Demo listing — fictional, not a real opening* label, and links that explain instead of navigating keep sample data unmistakable; Settings and Help describe what the demo leaves out. The build flavor is recorded in `build-info.json`, `studio-handoff.json` (new `flavor` field; `verify-studio-handoff.mjs` now requires `--flavor`, and the production web deploy accepts only the standard flavor), the build ID (`VERSION+SHA.demo`) and the archive name (`sojourner-web-demo-vVERSION.zip`). The standard web app is unchanged apart from the `flavor` field and contains none of the demo code. A separate manual workflow, `deploy-pwa-demo.yml` (not yet run), builds the demo from the dispatched tip of `main`, runs its browser journeys, attests it in a separate job and deploys it in the `demo-web` environment only to its own Pages project and origin; it refuses to deploy unless the real web app's project and origin are configured and differ from the demo's. Not deployed or linked from Studio.

### Changed

- **Windows first:** the signed Windows installer is now the primary product channel, and the PWA continues alongside it ([`docs/ARCHITECTURE_INDEX.md`](./docs/ARCHITECTURE_INDEX.md) ARCH-001 and ARCH-002, owner direction 2026-11-02). Every published Windows release is signed with MythologIQ Labs Azure Artifact Signing through GitHub OIDC from an owner-approved `release` environment, with no client secret. The run fails unless `signtool verify /pa` passes, the signer is `MythologIQ Labs, LLC` and a timestamp is present. This replaces the opt-in, client-secret signing path (the `JOB_RANGER_REQUIRE_WINDOWS_SIGNING` repository variable and `win.azureSignOptions`).

### Fixed

- **Slow database work on Windows** (#316): every desktop database call launched `sqlite3.exe` with the SQL on its command line. Windows inspects each never-seen command line (Defender, Smart App Control), which cost 0.5-2 s per statement, so Career Profile imports took 2-4 s and startup migrations about 36 s. Statements now go to `sqlite3` on stdin with an unchanged command line: imports take about 175 ms and startup migrations about 3 s on the affected machine. Raw NUL or 0x1A in SQL text is refused, because Windows text-mode stdin would silently end the script there. No security software settings are involved.
- **Sidebar group closed itself on Home** (#318): Home swaps its loading layout for the dashboard layout, which remounted the sidebar and closed a group the person had just opened. The sidebar now remembers the person's choice for the page.
- **Resume tailoring preview failures** (#318): rebuilding a job's requirement coverage from two places at once could fail with constraint errors, and a preview that finished after the draft or job changed showed the old plan. Coverage is rewritten in one transaction, failed previews stay visible, and late previews are ignored.
- **Career Profile choice lost while loading** (#318, #278 follow-up): a choice made the moment the form became editable could be replaced by the stored profile. The form is now filled from the stored profile before it accepts input.
- **Recipient roles counted as direct support** (#168): Find Jobs could show a requirement as directly supported when the evidence described receiving or attending rather than doing the work. For example, "Was paid through payroll" counted as direct support for "Managed payroll", and "Was trained on safety procedures" for "Train new hires on safety procedures". The deterministic mapper now caps such results at transferable, and prefers another record that shows the action. A cap needs a recipient marker in a clause about the requirement (a passive, a recipient or attendee verb, or a completed course) and no active verb from the requirement's action family. Synonyms such as "Led" for "Managed", agent nouns and job titles, and evidence with no recipient marker keep direct support. The explanation says why support was capped. Behavior is pinned by a versioned phrasing corpus (`tests/fixtures/action-corpus.v1.json`) that includes its documented limitations. No model is involved.
- **Negated evidence counted as support** (#167): Find Jobs could show a requirement as directly supported by evidence that denies it. For example, "Never approved the vendor budget" counted as direct support for "Approved vendor budgets." The deterministic requirement mapper now scores only affirmed evidence prose, with clause-scoped negation and exclusion cues, while affirmed adjacent experience still counts. When negation reduces support, the mapping explanation says so. Behavior is pinned by a versioned phrasing corpus (`tests/fixtures/negation-corpus.v1.json`) that includes its documented limitations. No model is involved.
- **Web app built on Windows**: every action failed with `No handler registered for '<channel>'`. The build plugin handed the bundler backslash module ids, so the web runtime worker contained two copies of its IPC handler registry. Adapter imports now resolve through the bundler's own resolver, and a check on the built bundle guards against a second copy. Builds made on Linux, including the production web build, were not affected.
- **Web app layout**: the web app shipped without Tailwind layout styles on every platform (colors and fonts loaded, but the sidebar, cards, and grids were unstyled). Tailwind scanned only the web build's `web/` folder, not the components in `src/`. The shared stylesheet now names the repository root as Tailwind's source, and a check on the built stylesheet guards the app shell's layout classes. The desktop app was not affected.
- **Form-control icons overlapped text** (desktop and web): the search and filter icons on Find Jobs, and the icon, `$` prefix and `miles` suffix on three Career Profile fields, sat on top of placeholder and typed text. The controls' shared padding rule was outside Tailwind's cascade layers and silently overrode the per-control padding utilities. The padding now sits in the components layer, and layout checks guard it in both runtimes.
- **Release upgrade verification on Windows**: `npm run test:release-upgrade` failed with `no such table` because Windows `sqlite3.exe` output ends lines with CRLF.

### Changed

- Branded shell (#317, #248): the owner-supplied Job Ranger mountain emblem is the app, favicon, web-app and Store icon; the sidebar has task icons and a branded header; Home shows decision cards; the Atelier theme uses a 60/30/10 ivory, navy and trail-green teal palette with an automated contrast check and a palette preview in the theme picker. On desktop windows 700 px tall or less the sidebar drops its decorative labels so every entry stays visible.
- Inference Slice A (#164): a provider-free optional-inference seam under `electron/src/inference/`. It covers contract types, closed validators, the transmission manifest, a broker with timeout and cancellation, an adjudicator that wraps the unchanged Truth Gate, and acceptance re-checks. It is proven by a test-only synthetic fake provider, a conformance suite, adversarial fixtures, and baseline regression tests. No inference is available to users, no provider exists, and nothing leaves the device.
- CI runs the web browser suite and the release upgrade verification on Windows as well as Ubuntu.
- `npm run demo:record` records the public demo from the production web build: a six-beat, Canopy-themed, deterministic story with fictional data, capture-safety checks, and frame review (`npm run demo:frames`). Outputs go to the ignored `build/demo/`.
- The README has a "See it in action" section with three screenshots of the web build using fictional data, regenerated by `npm run demo:screenshots`, and the accepted 85-second walkthrough video (`docs/assets/demo/job-ranger-demo.webm`), and links to a new self-hosting guide (`docs/SELF_HOSTING.md`). Repository links and the attestation verification commands now name `MythologIQ-Labs-LLC/job-ranger`, as does the `build-info.json` source repository for builds made outside GitHub Actions.
- Both web browser-suite CI jobs upload Playwright traces and screenshots when a test fails. The service-worker update test no longer races the browser's own update check.

## v1.3.0 - Job Ranger release candidate (never published)

Never published as Job Ranger; superseded by Sojourner `1.0.0-alpha.1`, which includes this content. Candidate evidence: [`docs/validation/RELEASE_CANDIDATE_V1.3.0.md`](./docs/validation/RELEASE_CANDIDATE_V1.3.0.md).

Implements the accepted distribution architecture (Microsoft Store + local-first web/PWA runtime; #125, #130). Nothing below is shipped yet. The Store channel awaits Partner Center certification. The web app runs today as a local self-hosted install at `http://localhost:4174`; a public production deployment is deliberately deferred until there is demand for external distribution (#145). Validation evidence: [`docs/validation/DISTRIBUTION_IMPLEMENTATION_2026-10-05.md`](./docs/validation/DISTRIBUTION_IMPLEMENTATION_2026-10-05.md).

### Added

- **Web/PWA runtime** (#130): Job Ranger runs in modern desktop browsers on the same shared application core as the desktop app.
  - SQLite WASM persisted to the origin-private file system with atomic writes; a single-writer tab lock.
  - Browser DOCX/PDF resume import.
  - Deterministic ATS PDF generation through the same Truth Gate and Parseability Gate as the desktop app.
  - Resume PDFs in Latin extended, Vietnamese, Greek, Cyrillic, Thai, Chinese, Japanese, and Korean, set in embedded Noto fonts. The fonts are downloaded only when a resume needs them, verified, and then cached for offline use. Right-to-left and Indic scripts fail export with an explanation and remain served by the Windows app.
  - Strict Content Security Policy with Trusted Types and an explicit job-feed origin allowlist.
  - An installable manifest and an integrity-verified offline app shell with user-confirmed updates and repair.
  - Visible storage-quota and persistence handling.
- **Portable `.jobranger` backups**: a single file moves data between the Windows app and the web app in either direction. It is validated (CRC-32, SHA-256, safe paths, version and schema checks) before anything is replaced. v1.2.0 backup folders remain restorable in the desktop app via their `manifest.json`.
- **Microsoft Store packaging** (#125): AppX package of the existing Electron app (electron-builder v26).
  - Partner Center identity comes from repository configuration.
  - Narrow capabilities (`runFullTrust`, `internetClient`).
  - Canonical Store tile assets.
  - An isolated Store data root with correct Explorer paths.
  - An explicit, read-only import of data from an earlier desktop installation.
  - No app-managed updater (the Store services updates).
- **Local self-hosting of the web app** (#145, #147, #149): `npm run selfhost:pwa` builds and serves the production web app at the fixed origin `http://localhost:4174`. A busy port fails with an explanation instead of silently moving to another port, because browser storage is tied to the exact origin. README documents the persistent dogfood path and the `.jobranger` backup-before-upgrade rule.
- Settings → **This installation**: channel, version/build, data location, persistent-storage status and request, web limitations, app-shell repair, and Store desktop-data import.
- CI and release workflows:
  - `windows-store-package`: builds the AppX, verifies the manifest, installs it, and runs the non-software Career Ops smoke inside the package context;
  - `pwa`: build, web-parser benchmark, and browser suite;
  - `deploy-pwa`: verified, attested, environment-gated deployment of a released web build;
  - GitHub artifact attestations for released artifacts.
  - `release-upgrade` CI job (`npm run test:release-upgrade`): builds the latest published release, writes data with its own smoke tests, and verifies that the current build opens that data without changing it, applies every migration, and backs it up and restores it.

### Changed

- **License:** development after v1.2.0 is licensed under **AGPL-3.0-only**. v1.2.0 and earlier releases keep their MIT grants. See [`LICENSE_HISTORY.md`](./LICENSE_HISTORY.md) and the new [`TRADEMARKS.md`](./TRADEMARKS.md).
- Azure Artifact Signing is opt-in for direct-download Windows builds (`JOB_RANGER_REQUIRE_WINDOWS_SIGNING`). Unsigned direct installers are labelled tester-only in their release manifest instead of blocking a release.
- Native macOS packages are built only on manual dispatch. macOS users are served by the web app going forward.
- Job Ranger refuses to open data upgraded by a newer database schema instead of running older code against it.
- Backup validation checks migrations against everything the current build knows, not only those the live database has applied.
- The UI no longer requests remote Google Fonts (the desktop CSP already blocked them).
- The IPC handler table and SQL literal encoding moved into shared modules used by both runtimes.

### Fixed

- The Parseability Gate compared only ASCII letters and digits, so a PDF that lost Chinese, Cyrillic, Greek, or accented text could still pass. It now verifies Unicode text in both runtimes. Right-to-left and Indic content, which PDF parsers extract inconsistently, is reported as an advisory to check manually instead of being silently ignored.
- The Truth Gate's unsupported-edit check compared only ASCII letters and digits, and it ignored one-character tokens (#143). Edited resume statements could therefore add unsupported claims in Chinese, Japanese, Korean, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, or accented Latin text, or change a single-digit number ("5 engineers" → "9 engineers"), and still pass. These edits are now flagged, and English checking is otherwise unchanged. See the trade-offs in [`CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md` §12.1.1](./docs/design/CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md).
- After a scrape finished, the idle scrape queue could still read the database. That read raced shutdown and produced an unhandled "unable to open database" error.
- Greenhouse job descriptions (entity-escaped HTML from the Greenhouse API) are now unescaped before requirement extraction, so requirements are detected individually instead of as one block.

## v1.2.0 - 2026-10-05 (Job Ranger, tag `job-ranger-v1.2.0`)

v1.2.0 is the stable public release, promoted from immutable `v1.2.0-rc.5` at `71f9b790a1f456321aee2c783f39f4a6784b83a9`. The Windows/macOS artifacts are byte-identical to the rc.5 packages that passed packaged-runtime smoke, native trust-verifier execution, SHA-256 verification, and schema-v2 release-manifest generation. The release is intentionally unsigned/unnotarized under an explicit owner-approved exception.

### Added

- Progressive first-run onboarding with resume-first, no-resume, and goal-first entry paths.
- Multiple Target Tracks with required/preferred/target semantics for supported search constraints.
- Durable SQLite-backed Career Profile and Applications state.
- Canonical Career Evidence with provenance, authority state, correction, merge/reject/supersede lineage, structured credentials, references, and direct user authoring.
- Resume import for DOCX, text-bearing PDF, plain text, and pasted text with source preservation, hashing, extraction snapshots, duplicate detection, and explicit OCR-required/failure states.
- Canonical job-source snapshots with source URL, retrieval time, hashes, completeness state, extraction/version metadata, dedupe, and changed-content history.
- Source reliability diagnostics that distinguish success-empty, cooldown/circuit, unsupported/browser-unavailable, network-policy, access-denied, rate-limit, timeout/retrieval, extraction, parser, and unclassified failures.
- Deterministic job requirement normalization and requirement-to-evidence mapping with direct, transferable, ambiguous, and gap states tied to the preserved source text used for analysis.
- Multi-dimensional opportunity assessment covering eligibility, evidence coverage, career alignment, preference alignment, blockers, and unknowns.
- Consumer source discovery behind a provider-neutral seam with explicit user approval before monitoring discovered sources.
- Deterministic resume creation with ATS-oriented templates, Truth Gate, isolated Chromium PDF rendering, Parseability Gate, versioned artifacts, diffs, and exact application linkage.
- Deterministic target-specific resume tailoring with preserved evidence provenance.
- Application lifecycle contacts, milestones, follow-up events, reminders, and exact submitted-resume history.
- Evidence-linked Career Stories.
- Evidence-grounded interview preparation that distinguishes exact submitted evidence, later-corrected/superseded evidence, additional confirmed evidence, and real gaps.
- Versioned evidence-grounded application materials that become visibly stale when supporting Career Evidence changes.
- Structured target-track attribution, offer/negotiation state, recurring-gap analysis, observed outcome summaries, and Search Insights.
- Verified portable backup and staged restore with artifact integrity checks and cross-data-root path rebasing.
- JSON Resume import/export as a bounded interoperability adapter without making JSON Resume canonical product state.
- Universal cross-career validation fixtures, including hourly/local, healthcare, trades, executive, recent graduate, federal/government, contractor/freelance, career-change, return-to-work, and military-transition contexts.
- Connection-pinned HTTP/HTTPS acquisition transport with per-hop redirect approval and deterministic DNS-rebinding regression coverage.
- Stable-release platform-trust gates for Windows Azure Artifact Signing and macOS Developer ID signing/notarization/stapling.
- Per-platform release trust reports, SHA-256 checksum files, and machine-readable release manifests.
- Bounded tester-installation guidance for unsigned prereleases that does not require disabling platform security globally.

### Changed

- Replaced the old universal fit-percentage surface with explainable assessment dimensions rather than presenting one opaque number as product truth.
- Career Profile now owns intent/preferences while Career Evidence owns factual career history.
- Application and resume workflows now preserve exact evidence/artifact history rather than relying on mutable filenames or free-form notes.
- Requirement analysis now uses preserved canonical source text instead of being constrained to the legacy short description snippet.
- Electron privileged implementation authority moved to TypeScript under `electron/src/**`; `electron-runtime/**` is generated for execution and packaging instead of maintaining checked-in compiled copies.
- Repository documentation uses explicit stable / packaged-candidate / implemented / candidate / deferred / historical status language.
- Job Ranger's product direction is explicitly framed as quality-over-quantity Career Ops: understand the person, career direction, companies, people, opportunities, and then applications rather than optimizing raw application throughput.
- Optional remote inference remains deferred because the deterministic product covers core assessment, tailoring, application materials, interview preparation, stories, and insights without requiring it.
- OCR for image-only resumes and DOCX resume export remain explicit deferrals rather than silent fallbacks.
- Arbitrary generic career-site hostnames remain manual-review/non-runnable rather than being automatically promoted into privileged generic acquisition.
- Linux packaging was evaluated and deferred until real demand justifies the support surface.
- Microsoft Store AppX/MSIX distribution was evaluated as a valid post-v1.2.0 candidate but not admitted to the current release scope.

### Security and reliability

- Sandboxed the primary renderer and retained context isolation, disabled Node integration, and web security boundaries.
- Added acquisition-network policy that rejects unsafe loopback, link-local, private-network, and other disallowed destinations.
- Replaced preflight-only DNS approval with connection-level address pinning: sockets connect only to policy-approved public addresses while Host/SNI/TLS verification remains bound to the original hostname.
- Redirects are independently resolved, approved, and pinned per hop.
- Source discovery uses the same pinned transport.
- Isolated Electron scraper HTTP/HTTPS document and subresource traffic is routed through the governed pinned transport.
- Added deterministic regression coverage proving a hostile later DNS answer cannot redirect the direct transport to a private/local destination.
- Hardened privileged IPC numeric ranges, source-vendor hostname classification, managed artifact reveal paths, and record-shape validation.
- Removed duplicate/generated privileged validator implementations and tracked build/test residue so `electron/src/**` remains the checked-in privileged authority.
- Expanded repository-health coverage to exercise salary, scrape-guard, tray-policy, source-truth, DNS-rebinding, distribution-trust, and QOR regressions.
- Hardened SQLite-backed persistence, migration, and E2E locking behavior.
- Made high-severity dependency audit findings fail closed except for narrowly documented upstream-blocked tooling exceptions.
- Added backup integrity validation and staged restore safeguards.
- Stable exact-semver release builds normally fail closed when required Windows signing or macOS signing/notarization configuration/verification is absent. v1.2.0 is the documented owner-approved exception, promoted byte-for-byte from validated rc.5 artifacts with explicit unsigned-distribution warnings.

### Release engineering

- Added generated Electron-runtime build authority and package configuration for `electron-runtime/electron/src/main.cjs`.
- Expanded repository-health and Electron E2E coverage across Career Evidence, targeting, discovery, assessment, source truth, resume lifecycle/tailoring, credentials, application lifecycle, Career Stories, materials, interview prep, insights, backup/restore, interoperability, and hardening regressions.
- Added `docs/RELEASE_READINESS.md` as the release-blocking contract.
- Added `docs/PRODUCT_GAP_REVIEW.md` for candidate/deferred/rejected dispositions.
- Synchronized `package.json` and root `package-lock.json` metadata at v1.2.0.
- Added candidate-specific evidence under `docs/validation/RELEASE_CANDIDATE_V1.2.0.md`.
- Added `docs/DISTRIBUTION_TRUST.md` and `docs/TESTER_INSTALLATION.md`.
- Added Windows and macOS trust-verification scripts.
- Added post-package SHA-256/release-manifest generation that requires the corresponding trust-evidence file to exist.
- Fixed unsigned macOS prerelease packaging so blank/incomplete signing environment variables are removed before electron-builder rather than being misinterpreted as a certificate source.
- `v1.2.0-rc.3` hosted release run `37239803933` completed successfully for Windows x64 and macOS x64/arm64 with expected package/trust/checksum/manifest assets uploaded.

### Post-release distribution trust follow-up

Stable v1.2.0 is published. Real Windows signing and macOS Developer ID/notarization evidence remain tracked under #125/#130 for a signed follow-up release. v1.2.0 artifacts are immutable and must not be replaced in place.

## v1.1.2 - 2026-09-24

### Fixed

- Restored readable inactive sidebar navigation in the Midnight theme.
- Replaced inert dashboard text styled like links with real contextual navigation to Find Jobs, Companies, and Filters.
- Removed stale Alpha-facing workspace language from the released dashboard.

### Changed

- Removed the HVAC-specific starter and occupation-specific placeholders from primary Career Profile onboarding.
- Reframed role targeting around current, adjacent, and reasonable stretch opportunities across careers.
- Generalized minimum compensation from an hourly-only field to an hourly-or-annual preference.
- Simplified the sidebar brand area by removing the theme description and redundant `Local desktop` pill.

### Compatibility and validation

- Existing v1 Career Profiles preserve their saved hourly minimum through the v2 profile migration.
- Deterministic fit scoring compares listed compensation against the user's selected hourly or annual basis.
- Repository-health validation and Electron E2E cover the updated navigation and Career Profile behavior.
- Dependency audit remains at zero known npm vulnerabilities.

## v1.1.1 - 2026-09-24

### Fixed

- Made the Windows release self-contained by bundling the official SQLite 3.53.4 x64 command-line runtime used by the desktop backend.
- Updated Windows runtime resolution so packaged builds prefer `resources/sqlite3.exe` before host `PATH` while development still supports `SQLITE3_PATH` or a host install.
- Standardized the published Windows artifact on the NSIS installer target instead of generating two same-named `.exe` targets.

### Release engineering

- Pinned the official SQLite Windows tools archive used by the release workflow.
- Added SHA3-256 verification against SQLite's published digest before extraction.
- Added Windows packaging validation that executes the bundled SQLite binary and proves the runtime resolver selects it with `SQLITE3_PATH` removed.
- Added durable Windows packaging evidence under `docs/windows-package-validation.md`.
- Added SQLite runtime provenance to `THIRD_PARTY_NOTICES.md`.

### Release note

- v1.1.0 successfully produced the macOS x64/arm64 artifacts but its Windows builder exposed the missing-host-SQLite defect before a Windows asset was uploaded.
- v1.1.1 supersedes v1.1.0 as the first complete Windows + macOS release of the v1.1 feature line.

## v1.1.0 - 2026-09-24

### Added

- Career Profile onboarding for target roles, location, pay floor, skills, credentials, and work preferences.
- Career Profile role targeting for jobs the user would consider. The first iteration included one occupation-specific starter; v1.1.2 removed that product-level specialization and generalized onboarding across careers.
- Deterministic job-fit scoring with plain-language reasons and concerns derived only from saved profile data and collected listing evidence.
- Applications workspace with Interested, Applied, Interview, Offer, Rejected, and Withdrawn states plus local notes.
- Career-Ops lineage and MIT attribution in `THIRD_PARTY_NOTICES.md`.
- Pull-request CI running clean dependency installation, audit reporting, and the repository-health gate.
- Grouped Dependabot policy for routine non-major production and development dependency updates.
- Canonical Job Ranger brand assets for the repository banner, logo lockup, and social preview.
- Repository governance, contribution, security, code-of-conduct, branding, and documentation-index guidance.

### Changed

- Reorganized primary navigation around the job-seeker workflow: Home, Find Jobs, Applications, Career Profile, then source/filter/settings tools.
- Upgraded Electron from the unsupported 28.x line to supported Electron 44.4.5.
- Raised the development and release Node.js baseline to 22.12.0 or newer.
- Upgraded the build stack to Vite 8 and TypeScript 7.
- Upgraded `@electron/notarize`, `@electron/fuses`, and `concurrently` to Node 22-compatible current lines.
- Migrated the macOS notarization hook across the CommonJS/ESM boundary using dynamic import and removed the obsolete notarization `tool` option.
- Updated TypeScript configuration for TypeScript 7 and Vite side-effect module declarations.
- Reworked public documentation around verified shipped, implemented, planned, and historical states.
- Updated Electron Playwright tests for the current accessible UI and Career Intelligence navigation.
- Consolidated branding assets under `docs/assets/branding/` while preserving `public/ICON.png` as the canonical runtime icon.

### Fixed

- Added a bounded SQLite client timeout to prevent transient concurrent access from failing immediately with `database is locked`.
- Corrected SQLite CLI timeout configuration so timeout setup does not contaminate JSON query output.
- Restored accessible modal semantics and filter-form label/control associations discovered by Electron E2E validation.

### Security

- Completed the accumulated non-major dependency-security remediation without `npm audit fix --force`.
- Eliminated the remaining Electron / `extract-zip` high-severity findings by moving to the supported Electron runtime.
- The v1.1.0 release-prep dependency audit reports zero known npm vulnerabilities.
- Removed obsolete duplicate packaging/notarization scripts and temporary write-capable validation workflows after use.

### Persistence note

- Existing companies, jobs, filters, settings, and scrape history remain SQLite-backed.
- Career Profile and Applications are local in v1.1.0 but currently use renderer-local storage. Moving them behind the SQLite/backend boundary remains planned durability work.

## v1.0.2 - 2026-03-20

- Fixed Electron startup on macOS by resolving `sqlite3` with platform-aware lookup instead of a Windows-only command.
- Hardened tray initialization so a missing or invalid tray icon does not prevent the app from launching.
- Added the Electron runtime and source files required for packaged/runtime consistency in the repository.
- Published Windows x64 and macOS x64/arm64 release artifacts.
