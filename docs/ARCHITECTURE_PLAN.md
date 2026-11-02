# Architecture and Evolution Plan

> **Authority routing:** [Canonical Architecture Index](./ARCHITECTURE_INDEX.md) is the single source for active architecture decisions, canonical document selection and explicit supersession. In case of conflict, the index prevails. This document remains canonical for product authority and trust boundaries only within that index.


This document describes Job Ranger's current architecture and the boundaries that future work must preserve.

Older phase plans are historical implementation records. They do not override this document, current source, tests, or published-release evidence.

## Product architecture principle

Job Ranger is a focused job-search companion, not an agent platform.

> **Job Ranger owns career truth, job-search state, and the user's application lifecycle. External capabilities are narrow replaceable adapters, never authorities.**

Consequences:

- a parser may extract evidence but cannot establish truth;
- a discovery provider may find opportunities but cannot silently create trusted monitored sources;
- an inference provider may propose bounded, schema-validated language or mappings but cannot establish truth; the normative boundary is [design/INFERENCE_CONTRACT.md](./design/INFERENCE_CONTRACT.md);
- a renderer formats an artifact but does not own canonical state;
- a browser retrieves pages but does not silently submit consequential actions;
- a calendar or notification integration may mirror lifecycle state but does not own it;
- JSON Resume is an interoperability format, not Job Ranger's canonical career model.

An accepted extension to this authority model is [ADR-0001: Personal-brand publishing and analytics authority](./adr/0001-personal-brand-publishing-and-analytics.md), implemented through the design contract in [Personal Brand Publishing and Analytics](./design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md). It keeps personal professional presence inside Career Ops while explicitly rejecting a general product-marketing role and any runtime dependency on Viable. The decision is authoritative for new implementation; the feature remains unimplemented until source and tests prove otherwise.

## Current runtime architecture

```text
┌──────────────────────────────────────────────────────────┐
│ React renderer                                           │
│                                                          │
│ Home / onboarding / Find Jobs / Applications             │
│ Search Insights                                           │
│ Career Profile / Career Evidence / Career Stories        │
│ Target Tracks / Resume                                   │
│ Companies / Filters / Settings                           │
└──────────────────────────┬───────────────────────────────┘
                           │ typed preload / IPC
                           ▼
┌──────────────────────────────────────────────────────────┐
│ Electron main process                                    │
├──────────────────────────────────────────────────────────┤
│ JobScoutBackend                                          │
│   companies / jobs / filters / settings                  │
│   scrape history / scheduling / notifications            │
│                                                          │
│ CareerBackend                                            │
│   Career Profile / Applications                          │
│   source artifacts / extraction snapshots               │
│   Career Evidence / provenance                           │
│                                                          │
│ Target Track services                                    │
│   search directions / required-preferred-target semantics│
│                                                          │
│ RequirementBackend + mapper                              │
│   job requirements                                       │
│   requirement ↔ Career Evidence mappings                 │
│   explainable opportunity assessment                     │
│                                                          │
│ SourceDiscoveryProvider                                  │
│   discovered opportunities / candidate employer sources │
│   explicit approval before monitoring                    │
│                                                          │
│ ResumeService + tailoring                                │
│   projections / statements / Truth Gate                  │
│   isolated PDF render / Parseability Gate                │
│   versioned artifacts / application links                │
│                                                          │
│ ApplicationLifecycleBackend                              │
│   contacts / events / reminders / submitted artifacts    │
│                                                          │
│ InterviewPrepBackend                                     │
│ CareerStoryBackend                                       │
│ ApplicationMaterialsBackend                              │
│ ApplicationInsightsBackend                               │
│ BackupService                                            │
│ JsonResumeAdapter                                        │
└──────────────────────────┬───────────────────────────────┘
                           ▼
                         SQLite
                           │
                           └── managed local artifacts
```

The renderer owns presentation and ordinary interaction. It does not receive direct Node.js, SQLite, parser, arbitrary filesystem, or general browser authority.

## Multi-runtime architecture (post-v1.2.0 development line)

The diagram above is the Electron runtime. The post-v1.2.0 line adds a second, first-class runtime: the local-first web/PWA runtime. Both run the **same shared application core**. Decision record: [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md).

```text
                    React renderer (src/) + shared preload bridge
                                   │
             ┌─────────────────────┴─────────────────────┐
             ▼                                           ▼
   Electron main process                      Web runtime worker (src/pwa/runtime)
   (Windows native: Microsoft Store /         (exclusive Web Lock, same IPC channel
    direct download)                           table and boundary validators)
             │                                           │
             └──────────── shared application core ──────┘
               electron/src: core-ipc, *-ipc registration, backends,
               repositories, migrations + feature-migration registry,
               Truth Gate, Parseability Gate, BackupService, portable archive
                                   │
             ┌─────────────────────┴─────────────────────┐
             ▼                                           ▼
   Electron adapters                          Web adapters (src/pwa/adapters)
   sqlite3 CLI · node:fs · Anydoc ·           SQLite WASM + OPFS · OPFS fs · pdf.js/DOCX ·
   Chromium printToPDF · DNS-pinned fetch     pdf-lib · allowlisted CORS fetch
```

Rules:

- `src/pwa/adapter-map.ts` lists every runtime-specific module and Node built-in the web runtime replaces. `tests/runtime-adapter-contract.test.mjs` requires each adapter to export the full contract and confines Electron imports to IPC/infrastructure modules. The web build fails on any unadapted `node:*` import.
- Adapters implement mechanics only (persistence, files, parsing, rendering, transport). Domain rules (evidence authority, provenance, lineage, Truth Gate, explicit source approval) are never re-implemented per runtime.
- Cross-runtime data movement uses the versioned `.jobranger` archive, never another runtime's live database.
- Runtime identity and capabilities (`src/shared/runtime.ts`) are environment facts surfaced honestly in the UI. They are not product-truth switches.

Details: [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md) and [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md).

## Build and runtime authority

`electron/src/**` is the only checked-in privileged implementation authority.

```text
electron/src
    ↓ TypeScript compile
 electron-runtime/
    ↓
 development / smoke tests / Electron E2E / packaging / runtime
```

`electron-runtime/**` is generated and ignored by Git.

Compatibility shims under `electron/*.cjs` may be created during runtime preparation for older test or release verification entry points. They forward into the generated runtime and contain no independent implementation logic.

See [`BUILD_RUNTIME.md`](./BUILD_RUNTIME.md).

## Domain authority model

### Career Profile

Career Profile owns broad personal/search context and preferences. It is not factual career history.

Examples:

- home area;
- broad work preferences;
- legacy intent migrated from earlier releases.

### Target Tracks

Target Tracks own per-search-direction intent.

A user may pursue multiple directions without duplicating factual career history.

A track can represent:

- target role families;
- work mode;
- employment arrangement;
- geography;
- schedule availability;
- compensation floor/target/basis;
- required, preferred, or target strength where represented by the contract.

The legacy Career Profile intent is bridged into a reserved migration-owned track until the user promotes it to user-owned track state.

### Career Evidence

Career Evidence owns factual career history and provenance.

Supported evidence shapes include:

- employment;
- skills;
- education;
- projects;
- achievements;
- credentials/licenses;
- publications and other nontraditional evidence;
- user-authored evidence;
- imported evidence proposals;
- work-sample/portfolio references.

Authority states matter. Only user-confirmed or user-authored evidence may support factual application claims.

Imported evidence remains proposed until reviewed.

Evidence may be:

- edited;
- confirmed;
- rejected;
- merged;
- superseded.

Supersede lineage preserves historical truth instead of mutating the past into whatever is currently correct.

### Applications

Applications own the user's job-search lifecycle.

Current durable application state includes:

- tracked opportunity;
- status;
- notes;
- selected Target Track;
- exact submitted resume artifacts;
- contacts;
- interviews and milestones;
- follow-up events and reminders;
- offer/negotiation state;
- application-material history.

Applications are not outsourced to a generic task/project system.

## Career Evidence pipeline

```text
Source Artifact
      ↓
Extraction Snapshot
      ↓
Candidate Evidence
      ↓ human authority
Confirmed / User-authored Career Evidence
      ↓
Job Requirements ↔ Evidence Mapping
      ↓
Opportunity Assessment
      ↓
Resume / Application-Material / Story Projection
      ↓
Truth / Parseability / Staleness Review
      ↓
Versioned Artifact or Material
      ↓
Application Lifecycle / Interview Prep / Search Insights
```

The canonical product asset is Career Evidence, not a resume file, JSON Resume record, parser output, generated paragraph, or model response.

## Optional inference architecture

Optional inference is a proposal layer around the deterministic core, not a replacement for it.

The normative contract is [design/INFERENCE_CONTRACT.md](./design/INFERENCE_CONTRACT.md) (#162).

Core rules:

- Job Ranger remains fully useful without inference.
- The inference-disabled product is the reference baseline. Inference-specific governance is additive and may not replace or weaken existing deterministic gates or make those gates provider-dependent.
- Inference tasks are explicit and schema-bounded; there is no generic autonomous-agent capability.
- The shared core constructs the minimum task payload, computes the transmission manifest from everything it transmits, and validates every response.
- Remote providers require explicit disclosure/consent for the data classes leaving the device.
- Provider output cannot directly write Career Evidence, Target Tracks, applications, sources, resumes, or settings.
- Career Evidence authority, deterministic requirement/evidence state, Truth Gate, Parseability Gate, source approval, and consequential user actions remain authoritative.
- Generated factual language must remain evidence-linked. Inference-generated resume wording is evaluated by the unchanged Truth Gate as edited text, bound to the source statement's own evidence, and then requires explicit user review. Truth Gate success is not semantic proof. Factual drafting for application materials, Career Stories, and interview answers cannot be enabled in contract v1, because those surfaces have no deterministic factual token gate. Every v1 task schema is closed and structured-only.
- Inference failures fall back to deterministic behavior rather than turning into empty evidence, negative assessment, or partial state mutation.
- Provider adapters are replaceable and runtime-gated. Job Ranger classifies provider location itself (`in-process`, `loopback`, or `remote`), and loopback endpoints need the same consent as remote ones for private data. A PWA must not claim remote-provider support until its credential/transport boundary is independently approved.
- Deterministic modules never import inference modules; the inference layer receives deterministic gates by injection and never modifies them.
- The first implementation slice (#164) is contract types + broker + adjudication hooks + a test-only synthetic fake provider + conformance tests, with no network, credentials, IPC, UI, or persistence. It lives in `electron/src/inference/`. The modules ship inert in desktop builds: no entry point loads them, the production registry is empty, and both runtimes report inference as `not-configured`. `tests/inference-baseline.test.cjs` enforces the one-way import boundary.

The contract received its adversarial architecture/security review in Phase 13 (Draft 0.2). Remote provider implementation remains deferred until a separate provider/security decision is made.

Job Ranger does not currently require a general agent framework, workflow engine, vector database, or agent-memory runtime.

## Resume import architecture

The default document parser is pinned to `@firecrawl/anydoc@0.2.4`.

Supported import paths:

- DOCX through Anydoc;
- text-bearing PDF through Anydoc;
- plain text natively;
- pasted text natively.

Import rules:

1. preserve the original source artifact before interpretation;
2. compute SHA-256 before extraction;
3. detect/validate format and enforce resource limits;
4. extract locally;
5. persist parser identity/version, extraction snapshot, warnings, and failure state;
6. normalize only into proposed Career Evidence;
7. require user authority before factual use.

Image-only/scanned documents surface an explicit OCR-required state. Job Ranger does not silently upload them to a hosted OCR or inference service.

## Credential architecture

Credentials are not generic skills.

Credential evidence may carry bounded structured facts such as:

- status;
- issuer;
- jurisdiction;
- expiration date;
- identifier where appropriate.

Requirement mapping checks credential standing as well as textual similarity. Expired, inactive, or pending credentials do not qualify merely because their labels match a posting.

## Requirement mapping architecture

Explicit requirements extracted from collected job text are stored as durable `JobRequirement` records classified as:

- must-have;
- preferred;
- responsibility;
- credential;
- logistics.

Mappings are:

- direct;
- transferable;
- ambiguous;
- gap.

Confirmed/user-authored evidence is required for direct or transferable factual support. Imported/unconfirmed evidence remains ambiguous.

### Source-text limitation

Job Ranger still does not preserve a canonical complete job-description artifact for every source.

Requirement reasoning therefore applies only to text Job Ranger actually collected. The absence of a requirement from stored text is not proof that the employer did not state it elsewhere on the posting.

Canonical source/job-description preservation is a current needed gap, not a reason to weaken the mapping model.

## Explainable opportunity assessment

Opportunity assessment is a pure deterministic composition over current Target Track intent plus requirement/evidence coverage.

It separates:

- eligibility;
- evidence coverage;
- career alignment;
- preference alignment;
- blockers;
- unknowns.

A single numeric score may be used only as a UI summary if its inputs remain transparent. It may not become product truth or a hiring-probability claim.

Unknown remains a first-class state. No extracted requirements means eligibility is unclear, not automatically likely.

## Source discovery architecture

`SourceDiscoveryProvider` is a real runtime seam.

Discovery can return:

- opportunities;
- employer/source candidates;
- provider identity;
- provenance/support metadata;
- warnings/coverage limitations.

Discovery cannot:

- silently create trusted monitored sources;
- bypass source-support classification;
- bypass acquisition-network policy;
- convert an aggregator job URL into a trusted employer board without a reusable-source boundary.

The user explicitly approves monitoring.

Current provider coverage is partial. Additional providers must earn inclusion through coverage value, terms/licensing, stability, and maintenance cost.

## Source acquisition architecture

Job Ranger intentionally avoids a universal scraper.

Structured adapters:

- Greenhouse;
- Lever;
- SmartRecruiters;
- Ashby.

Best-effort HTML/browser paths include:

- Workday;
- iCIMS;
- BambooHR;
- Taleo;
- Oracle Careers;
- generic career pages;
- browser-required families such as Microsoft Careers where applicable.

Unknown or unsupported sources fail honestly.

### Automated acquisition network policy

Automated acquisition is more privileged than a normal external-link click and therefore has a stricter network boundary.

Before direct fetch or browser requests, Job Ranger rejects unsafe destinations including:

- localhost/loopback;
- link-local addresses;
- private network literals;
- hostnames that resolve to unsafe addresses;
- redirects into unsafe destinations.

This policy prevents public career pages from becoming an SSRF path into the user's local network.

## Deterministic resume architecture

Resume creation is a projection of confirmed Career Evidence.

### ResumeProjection

A projection captures:

- optional target job;
- context;
- page format;
- template ID;
- immutable contact snapshot;
- selected evidence IDs;
- section ordering;
- lineage/status metadata.

`ResumeStatement` records remain linked to supporting evidence IDs.

### Template strategy

Current Job Ranger-owned templates:

- `ats-standard-v1`;
- `ats-compact-v1`.

Template variety is intentionally bounded. Parseability and truthful structure take precedence over visual marketplace breadth.

### Truth Gate

Export is blocked when a factual statement:

- lacks supporting evidence;
- depends on unconfirmed evidence;
- introduces unsupported factual terms through editing/tailoring.

### Target-specific tailoring

Deterministic tailoring may:

- select more relevant confirmed evidence;
- reorder evidence for target relevance;
- translate vocabulary where the same factual meaning is supported;
- preserve source-to-statement links;
- preserve unsupported requirements as visible gaps.

It may not fabricate missing qualifications.

### PDF rendering and Parseability Gate

The hidden Chromium render surface uses:

- sandboxing;
- `nodeIntegration: false`;
- `contextIsolation: true`;
- `webSecurity: true`;
- JavaScript disabled;
- window opening/navigation denied;
- document CSP denying remote resources;
- HTML-escaped user content.

After PDF generation, Job Ranger reparses the artifact (through Anydoc on desktop, pdf.js in the web runtime) and runs critical/advisory checks for extractable text, content retention, contact/section presence, reading order, and parser success. Comparison is Unicode-aware; right-to-left and Indic content, which parsers extract inconsistently, produces an advisory `unverified-script` issue instead of a critical failure (`electron/src/parseability-text.cts`).

Critical failures prevent artifact finalization.

### Artifact lifecycle

Finalized artifacts preserve:

- projection ID/version;
- managed path;
- SHA-256;
- page count;
- gate reports;
- immutable projection/statement snapshot;
- creation timestamp.

Application linkage records exactly which artifact was submitted.

## Application lifecycle architecture

`ApplicationLifecycleBackend` owns application-scoped operational state rather than inflating the base application record.

Current lifecycle records include:

- contacts;
- events/interviews/deadlines;
- reminders;
- completion state;
- exact submitted resume history.

Reminders belong to lifecycle events rather than a generic task engine.

## Interview preparation architecture

Interview prep is recalculated from canonical state rather than stored as a new truth domain.

Inputs:

- tracked job;
- requirement/evidence mapping;
- current confirmed Career Evidence;
- latest exact submitted resume snapshot;
- evidence lineage.

Output distinguishes submission relationships:

- `exact` — current evidence was on the submitted resume;
- `superseded` — an earlier evidence record in the lineage was submitted;
- `none` — current evidence was not submitted.

This lets prep preserve both the employer's historical view and the user's current corrected record.

## Career Stories architecture

Career Stories are durable narrative preparation artifacts linked to Career Evidence.

They do not become a parallel factual store. If linked evidence becomes invalid or is superseded, the story can be identified as requiring review.

## Application materials architecture

Application materials are versioned projections, not Career Evidence.

Current deterministic material creation:

- uses the tracked application/job context;
- uses confirmed Career Evidence only;
- records supporting evidence IDs;
- snapshots relevant evidence update timestamps;
- preserves historical wording;
- marks old material stale after edit/reject/merge/supersede of supporting evidence.

The material itself never becomes factual authority.

## Search Insights architecture

Application Insights derives observations from canonical saved state rather than writing learned facts back into Career Profile/Evidence.

Inputs may include:

- application status;
- Target Track;
- source;
- lifecycle events;
- offer state;
- requirement/evidence gaps.

Outputs may include:

- grouped counts;
- recurring gaps;
- observed interview/offer patterns;
- strategy signals above minimum sample thresholds.

Search learning may propose reconsideration. It may not silently mutate profile/evidence intent or imply causation from correlation.

## Backup and restore architecture

Backups are portable local bundles, not cloud sync.

The backup contract includes:

- a SQLite snapshot;
- managed artifacts;
- manifest/version metadata;
- integrity hashes;
- managed-path mappings.

Restore is staged and validated before activation.

Managed artifact paths stored as absolute paths are rebased inside the staged database to the new data root before activation.

The old live data remains a rollback candidate until restored state successfully initializes.

A backup bundle can be packed into a single-file `.jobranger` portable archive: ZIP STORE entries, CRC-32 per entry, and an archive manifest pinning the SHA-256 of the backup manifest. This is the interchange format between the Electron and web runtimes. Restore validation compares migrations against those the build knows and rejects newer formats or schemas explicitly.

## JSON Resume adapter

JSON Resume import/export is an interoperability boundary.

Import:

- preserves the source file;
- maps compatible standard fields to imported/proposed Career Evidence;
- does not grant factual authority automatically.

Export:

- projects current confirmed/user-authored evidence into compatible standard fields;
- may be intentionally lossy where Job Ranger has richer provenance/semantics;
- does not mutate canonical state.

## Security boundaries

The desktop shell and privileged services retain:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- `webSecurity: true`;
- main renderer sandboxing;
- typed preload APIs;
- renderer CSP;
- validated external navigation;
- acquisition network policy;
- constrained browser surfaces;
- isolated resume renderer;
- managed artifact storage;
- import content/size validation.

The web runtime keeps an equivalent boundary:
- the page has no direct storage or parser authority; everything goes through the runtime worker's validated IPC table;
- strict CSP with Trusted Types; no remote code;
- `connect-src` limited to an explicit allowlist of public job-feed APIs, credential-less;
- external navigation validated twice;
- a SHA-256-verified service-worker shell that never touches career data;
- user-gesture-only file pickers with size limits.

Any weakening of these boundaries is a material governance change.

## Persistence strategy

SQLite owns durable structured metadata and relationships. Managed files live under the Job Ranger data/artifact directory rather than being stored as database blobs.

Durable domains include:

- companies/jobs/filters/settings/scrape history;
- Career Profile;
- Target Tracks;
- Applications;
- source artifacts/extraction snapshots;
- Career Evidence/provenance/extensions/lineage;
- normalized job requirements/mappings;
- resume projections/statements/artifacts/snapshots;
- application-artifact links;
- contacts/events/reminders/offers;
- Career Stories;
- application materials;
- application insights support state;
- backup metadata where applicable.

The web runtime uses the same SQLite schema and migrations through SQLite WASM. The database image is persisted to the origin-private file system with atomic writes; managed files live under the OPFS data root. A shared downgrade guard refuses data written by a newer schema in either runtime.

Cloud sync is not foundational. Verified backup/restore exists first.

## Quality architecture

Repository validation includes deterministic tests for the principal domain boundaries plus Electron Playwright for material desktop workflows.

The project intentionally preserves GitHub Actions budget. Hosted Actions are not mandatory for every documentation/remediation or release-preparation iteration. Manual maintainer validation is acceptable when it records:

- environment;
- exact commands;
- results;
- checks that could not be executed.

Release candidates must additionally satisfy the platform/package contract in [`RELEASE_READINESS.md`](./RELEASE_READINESS.md).

## Program status

### Career Evidence and Resume Intelligence

R0 through R5 are complete on `main`.

Optional remote inference was not required to close R4 because deterministic tailoring and downstream workflows already satisfy the accepted product contract.

### Universal User Stories

US-0 through US-30 are reconciled as complete against the current model and validation evidence.

The completion of those programs does not mean product evolution stops. It means future work starts from explicit current truth rather than stale phase plans.

## Accepted next evolution

### Needed quality work

1. preserve fuller/canonical job-description/source snapshots where source capabilities permit it;
2. improve failure diagnostics and measured reliability for dynamic/best-effort source families;
3. publish the accumulated `main` product through a fully validated release.

### Candidate product work

Candidates are tracked in [`PRODUCT_GAP_REVIEW.md`](./PRODUCT_GAP_REVIEW.md) and include broader discovery, faster arbitrary-job capture, reusable application-question answers, bounded application-form assistance, networking, calendar mirroring, and mock-interview practice.

Candidates are not commitments until they pass governance/product validation.

## External capability policy

Open-source projects may be implementation ancestry, benchmarks, or bounded code donors only when the exact boundary is license-compatible.

Preferred adoption classes:

- MIT;
- Apache-2.0 with required notices;
- other clearly compatible permissive licenses after explicit review.

Reference-only by default:

- AGPL/GPL/copyleft where obligations conflict with product goals;
- SSPL;
- source-available licenses;
- noncommercial/share-alike assets/templates;
- custom commercial-threshold licenses;
- proprietary services;
- repositories without a clear license.

The repository license does not automatically relicense bundled templates, fonts, models, datasets, plugins, or hosted services.

Every adopted component must be reviewed at the exact code/asset/dependency boundary and attributed in `THIRD_PARTY_NOTICES.md` where required.
