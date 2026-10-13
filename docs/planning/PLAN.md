# Job Ranger Roadmap

**Current as of:** 2026-10-13 (priority-order update; historical implementation notes below need separate reconciliation)

This is the active roadmap. Historical phase/remediation plans remain implementation provenance only.

## North Star

Job Ranger should help a job seeker:

1. find useful opportunities;
2. understand which deserve attention;
3. prepare truthful application materials;
4. track applications and what happened;
5. prepare for the next step;
6. learn from the search without turning the search itself into another job.

Core functionality must remain useful without remote inference.

The universal product contract remains:

> **US-0:** As a job seeker, I want Job Ranger to adapt to the way my career works without requiring me to understand how Job Ranger works.

See [`../design/UNIVERSAL_USER_STORIES.md`](../design/UNIVERSAL_USER_STORIES.md).

## Current implementation sequence: Drive interoperability first, release hardening in parallel (2026-10-13)

**Owner priority:** finish a genuinely useful, permissioned, provider-neutral **Google Drive agent workspace** before investing in v1.3.0 release tagging and general distribution promotion. This is a **durable, governed agent-primary workspace and snapshot/document interchange** project, not cloud-authoritative Career Ops state or a requirement to build an MCP for every agent. The user may spend months primarily using an agent, and Job Ranger must recover useful agent-authored work with deterministic reconciliation when reopened. A local-only application remains fully functional with Drive disconnected. The roadmap below supersedes the older numbered headings in this document for **scheduling**; it does not silently alter already accepted distribution or data contracts.

| Track | Order and status | Deliverable / merge discipline |
| --- | --- | --- |
| **A. Drive agent interchange** | **Primary product track: now** | #249 + #255 decide agent-readable projections versus private backups; #285 governs typed export/proposal schemas; **#286 is a primary dependency** for durable agent-authored JSON operations, 60-day activity history and safe return-to-UI reconciliation. Prove local export, two-agent 60-day continuity, idempotent deterministic import, then real Drive upload/write/read. |
| **B. Release security and data integrity** | **Active concurrently, never paused** | #194 QOR Harden, #278 with fix PR #282 as a high-severity data-loss regression, #275 source pause/reschedule, #276 settings persistence/accessibility, portable backup/restore, Truth Gate, source-network/CSP/credential checks, actual platform tests. |
| **C. Drive authorization and availability** | **Follows proof of data contract; security work can run in parallel** | #258 OAuth behavior per PWA/native runtime, #264 isolated browser OAuth boundary, draft #261/262 (do not merge just because they exist), #252 actual Google client, #251 retention/prune, #256 explicit upload trigger, #254 trust/help copy. Require provider-backed, per-user authorized end-to-end receipts; do not promise unattended PWA token refresh. |
| **D. UX/demo and release freeze** | **After material Drive and hardening evidence** | Preserve merged grouped sidebar, accessibility and responsive work; one restrained consistency/empty-state pass under #248 if validated. Freeze code, QOR Harden residual review, record a fresh truthful end-to-end synthetic demo, refresh exact-head evidence and docs. Tag `v1.3.0-rc.N` only with separate owner approval and release/Store/PWA package gates. |
| **E. New capability candidates** | **Queued, not interrupting A or B** | #283 Wellfound provider: independently verify whether a suitable public job-listing API, usable license/auth/CORS and stable schema actually exist before proposing an implementation. #284 Built In: first examine ToS/robots, access stability and actual unique coverage; scraping is **not** approved. Both follow the existing #136 provider tranche and its governance VETOs. #277 `resume:read` is a later MCP adapter option; the selective Drive export should cover agent resume-reading needs first without claiming to provide live API queries. |

**Recommended Drive acceptance ladder:** (1) decision on backup versus agent workspace access, closed typed field schemas, permitted agent operation classes and trust boundaries (#255/#285/#286); (2) deterministic local exporter and immutable trusted receipts; (3) at least two agents maintain append-only, strictly validated notes/material drafts and plans for a simulated 60-day period **without Job Ranger running**; (4) deterministic, idempotent re-ingestion safely preserves valid agent-owned drafts, flags stale references/forks and stages consequential changes for existing Truth/Parseability Gates and user approval; (5) minimal-scope real Google Drive OAuth and scoped bidirectional folder reads/writes verified with a live provider and a separately authorized agent; (6) independent privacy/security and cross-platform user-driven demonstration. **Agents may manage their own durable, versioned workspace records, not just isolated draft requests.** The user's local standing permissions may allow safe draft-class imports without approving each individual note; canonical Career Evidence, approvals and consequential application changes still require Job Ranger's deterministic importer, unchanged Truth/Parseability Gates and explicit human authority. Do not parse edited Markdown, PDF or Google Docs prose as authoritative Career Evidence.

**Release freeze rule:** new providers, additional inference/MCP features and speculative UX work do **not** enter the stabilization train. Critical data loss, security, backup recoverability and already approved product repairs do. Keep Drive implementation on independent reviewed branches until it earns explicit scope acceptance. Hardening may complete before Drive and should not wait for OAuth credentials; the owner's present milestone priority puts the **Drive proof ahead of tagging v1.3.0**, subject to a conscious scope decision after end-to-end evidence.

**Authority/status:** This is a roadmap priority change, not proof that #249's format, #256 trigger or OAuth design has been accepted, and not approval to merge draft PRs, publish a Drive integration, retire Electron, alter provider VETOs, or cut a release tag. The full Drive formatting and intake proposals are [`../design/DRIVE_AGENT_INTERCHANGE_CONTRACT.md`](../design/DRIVE_AGENT_INTERCHANGE_CONTRACT.md) (draft, #285) and [`../design/DRIVE_AGENT_FIRST_RECONCILIATION.md`](../design/DRIVE_AGENT_FIRST_RECONCILIATION.md) (draft, #286).

## Current release boundary

Stable **v1.2.0** was published on 2026-10-05 from commit:

`71f9b790a1f456321aee2c783f39f4a6784b83a9`

The release was promoted byte-for-byte from validated `v1.2.0-rc.5` artifacts. Its Windows/macOS packages are intentionally unsigned/unnotarized under the documented owner-approved exception and remain immutable historical release artifacts.

Post-v1.2 work no longer assumes that Job Ranger must purchase/maintain both Windows public-trust signing and Apple Developer credentials. The accepted forward distribution architecture is:

- **cross-platform mainstream:** local-first PWA/web runtime;
- **Windows-native mainstream:** Microsoft Store packaged Electron application;
- direct GitHub native binaries: development/testing/advanced use unless independently publicly trusted;
- no planned native macOS or Linux distribution;
- SignPath excluded;
- Azure Artifact Signing optional rather than release-critical.

See [`../design/DISTRIBUTION_ARCHITECTURE.md`](../design/DISTRIBUTION_ARCHITECTURE.md) and [`../DISTRIBUTION_TRUST.md`](../DISTRIBUTION_TRUST.md).

## Completed programs

### Career Evidence and Resume Intelligence / #59

**Status: complete.**

- [x] R0 durable Career Profile/Application persistence and Career Evidence foundation;
- [x] R1 local resume import, source preservation, extraction snapshots, evidence review, and provenance;
- [x] R2 explicit job requirements and requirement ↔ Career Evidence mapping;
- [x] R3 deterministic resume creation, Truth Gate, Parseability Gate, artifact/version lifecycle;
- [x] R4 deterministic target-specific tailoring with preserved evidence lineage;
- [x] R5 application lifecycle, Career Stories, interview prep, application materials, offers, Search Insights, backup/restore, and JSON Resume interoperability.

Optional remote inference was not required to complete R4/R5 and remains deferred.

### Universal User Stories / #81

**Status: complete.**

- [x] progressive onboarding;
- [x] multiple Target Tracks;
- [x] required/preferred/target semantics;
- [x] broad Career Evidence representation;
- [x] structured credentials and schedule constraints;
- [x] consumer source discovery with explicit source approval;
- [x] explainable opportunity assessment;
- [x] downstream resume/application/interview/lifecycle stories;
- [x] cross-career fixture/validation matrix;
- [x] US-0 through US-30 reconciliation.

Narrower fields/capabilities that did not earn core placement remain deferred rather than being forced into the universal model.

### v1.2.0 release / #119

**Status: complete.**

- [x] immutable release candidate lineage;
- [x] Windows/macOS package smoke;
- [x] checksum and schema-v2 manifest evidence;
- [x] stable v1.2.0 publication;
- [x] post-release documentation reconciliation.

The unsigned/unnotarized v1.2.0 exception does not define the future distribution architecture.

## Parallel distribution/readiness track: external validation and launch

### Windows Microsoft Store / #125

**Status:** repository implementation complete (PR #142); package validation runs in CI; Partner Center work is external and pending. Design: [`../design/MICROSOFT_STORE_PACKAGING.md`](../design/MICROSOFT_STORE_PACKAGING.md).

- [x] AppX packaging with the pinned Electron/electron-builder v26 toolchain (`electron-builder.store.cjs`, `npm run electron:build:store`);
- [x] package identity supplied by repository variables (validation identity otherwise; fail-closed for submission builds);
- [x] manifest/capability generation verified: only `runFullTrust` + `internetClient`, no extensions, canonical assets;
- [x] packaged SQLite, data root, migrations, and managed-artifact paths validated inside the package context (`windows-store-package.yml`);
- [x] resume import/export, Chromium PDF + Parseability Gate, archive backup/restore, and external-navigation validation inside the package context;
- [x] Store servicing owns updates (no app-managed updater; enforced by test);
- [x] coexistence with historical NSIS installs: isolated data root, explicit read-only import, uninstall behavior recorded;
- [ ] reserve the app in Partner Center and set `JOB_RANGER_STORE_*` repository variables (external);
- [ ] build the submission package from a release tag and pass Store certification (external);
- [ ] validate clean Windows 11 install, first launch, and Store upgrade from the Store listing (external);
- [ ] make Microsoft Store the recommended Windows-native installation path (after the listing is live).

Azure Artifact Signing is opt-in only and does not block this work.

### Cross-platform local-first PWA / #130

**Status:** implemented and tested in CI (PR #142); self-hostable on localhost (#145, #147, #149); **no public deployment**. Design and parity matrix: [`../design/PWA_RUNTIME.md`](../design/PWA_RUNTIME.md).

- [x] inventory of Electron-only and Node-only assumptions; shared-core versus runtime-adapter boundary (`src/pwa/adapter-map.ts`, contract test);
- [x] browser persistence: SQLite WASM + OPFS atomic snapshots, Web Lock single writer; proven by running 18 shared-core suites on the WASM engine;
- [x] domain identity, provenance, lineage, migrations, downgrade guard, and backup semantics preserved; `.jobranger` archive for Electron ↔ PWA;
- [x] resume/Career Evidence import (DOCX/PDF/TXT; 9/9 on the shared parser benchmark) and deterministic PDF output through the shared Truth and Parseability Gates;
- [x] end-to-end local-first Career Ops workflow in the browser (healthcare scenario);
- [x] SHA-256-verified service-worker shell, user-confirmed updates, repair/recovery;
- [x] storage quota/eviction handling (visible failures, persistence request, backup guidance);
- [x] native-only limitations documented with their concrete platform causes;
- [x] stable localhost self-host origin (`npm run selfhost:pwa`, `http://localhost:4174`, no silent port fallback) for dogfood and trusted testing;
- [ ] *(deferred until external distribution is justified)* production HTTPS origin with the shipped security headers (`deploy-pwa.yml`; owner configuration required);
- [ ] installability/standalone and storage validation on real Windows, macOS, and Linux browsers (Chromium, Firefox, Safari);
- [ ] promote the PWA to mainstream only after that evidence is recorded.

The PWA is not a reduced "Lite" edition; remaining differences are browser-platform limitations listed in the parity matrix.

## Queued provider expansion and continuously maintained source quality

### Post-v1.2 provider tranche / #136

Implement or evidence-reject the first bounded post-v1.2 provider tranche:

- Himalayas;
- We Work Remotely.

Requirements include first-party terms/attribution verification, deterministic normalization, provenance, explicit coverage limitations, duplicate-rate measurement, and material unique coverage rather than listing-count inflation.

ReliefWeb remains a later niche candidate subject to registration and terms/IP review.

### Source truth and reliability

Continue to preserve and improve:

- canonical source/job-description snapshots;
- full/partial/listing-only completeness semantics;
- dynamic-source diagnostics;
- acquisition failure isolation;
- connection-level DNS rebinding protections;
- honest unsupported/unavailable states.

## Priority 2 candidates: evaluate before implementation

See [`../PRODUCT_GAP_REVIEW.md`](../PRODUCT_GAP_REVIEW.md) for full disposition rationale.

### Faster arbitrary-job capture

First evaluate a native paste/open-URL capture flow. Build a browser extension only if it provides material additional value worth the maintenance/security surface.

### Reusable application-question answers

Candidate model:

- preserve exact question text;
- reuse user-authored approved answers;
- link factual assertions to Career Evidence where applicable;
- require review before reuse;
- never auto-submit.

### User-controlled application form assistance

Potentially valuable, but high-governance. Autofill is not the same as auto-apply. Any implementation must keep the user in control of every submission and use confirmed evidence for factual fields.

### Networking workspace

Current application-scoped contacts may prove sufficient. Promote broader networking CRM only if real use demonstrates cross-application/company relationship management is missing.

### Calendar mirroring

Job Ranger remains authoritative. A future calendar adapter may mirror selected interviews/deadlines/follow-ups but must not silently mutate lifecycle history.

### Mock interview practice

Deterministic grounded prep already exists. Conversational practice/feedback is a candidate enhancement, with remote inference/audio privacy reviewed separately.

## Architecture in progress

### Provider-neutral inference contract / #162

**Status:** Contract Draft 0.2, adversarially reviewed (Phase 13). Slice A (#164) is implemented: provider-free broker, adjudication hooks, test-only fake provider, and conformance (Phase 14). Provider implementation remains deferred.

Current slice:

- [x] open a new inference-specific architecture issue rather than reopening completed R4;
- [x] define a provider-neutral request/response/provenance/failure contract;
- [x] define explicit task capability and data-class/transmission boundaries;
- [x] preserve proposal-only inference authority, deterministic adjudication, Truth Gate, and user review;
- [x] define local-versus-remote and Electron-versus-PWA credential/runtime constraints;
- [x] define provider conformance and benchmark requirements;
- [x] complete adversarial architecture/security review (Phase 13; review record in the contract);
- [x] define blocked implementation Slice A in #164: contract types + broker + synthetic fake provider, with no network or credentials;
- [x] implement #164 (Slice A): `electron/src/inference/`, conformance and baseline regression tests (Phase 14);
- [ ] only after Slice A is proven, evaluate a local provider against measured semantic-lift benchmarks.

Remote provider adoption is **not** implied by this work. It remains deferred until a separate provider/security decision is made.

### Personal Brand / Professional Presence / #171

**Status:** architecture accepted; implementation not started. ADR: [ADR-0001](../adr/0001-personal-brand-publishing-and-analytics.md). Design: [Personal Brand Publishing and Analytics](../design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md).

The capability extends Career Ops into professional presence without turning Job Ranger into a general marketing platform.

Baseline requirements:

- [ ] implement Presence Brief, user-authored drafts, hook/theme/tone metadata, and experiment hypotheses;
- [ ] link factual professional claims to current Career Evidence where applicable;
- [ ] implement deterministic composition findings and separate readiness facets;
- [ ] require exact-content approval before connected publication;
- [ ] support a complete manual PWA path: copy/export, manual publication receipt, manual analytics snapshots, demographic observations, and career outcomes;
- [ ] implement deterministic derived metrics, objective-aware interpretation, comparable-post cohorts, and conservative evidence tiers;
- [ ] add provider-neutral capability contracts without assuming publishing implies analytics access;
- [ ] prove LinkedIn exact-text publishing separately from LinkedIn analytics entitlement;
- [ ] keep recommendations advisory and refuse "best time" or content conclusions when comparable evidence is insufficient;
- [ ] preserve the Viable boundary: Job Ranger optimizes the professional presence of a person, not the market presence of a product.

**Recommended first slice:** Slice A from the design contract. It produces a useful composition/guidance workflow without waiting on OAuth, provider review, background execution, or inference.

## Deferred

Do not schedule these without new evidence:

- remote inference provider;
- OCR for scanned/image-only resumes;
- DOCX resume export;
- federal-resume/academic-CV specialized projections;
- universal travel/relocation/sponsorship fields;
- cloud-authoritative sync / hosted accounts (distinct from the active, explicit Drive export/interchange track #249);
- native macOS distribution;
- native Linux distribution;
- Apple Developer ID/notarization;
- Azure Artifact Signing as a required release dependency.

## Explicitly rejected under current distribution architecture

- SignPath as a Job Ranger signing/distribution dependency.

Changing this disposition requires a new explicit architecture decision.

## Explicit non-goals under current governance

- autonomous mass auto-apply;
- recruiter-facing ATS/team workspace;
- opaque hiring-probability or proprietary ATS score presented as truth;
- generic agent framework/runtime;
- generic workflow engine;
- vector database without measured need;
- agent-memory platform;
- managed browser platform as the default architecture;
- noncommercial/share-alike template assets inside the AGPL-3.0-only product.

These can change only through an explicit evidence-backed governance decision, not through architectural drift.

## Architecture invariants for future work

1. Career Evidence remains factual authority.
2. Goal/intent does not become factual evidence.
3. Preference does not silently become constraint.
4. Inference may propose but may not establish truth.
5. Consequential source/application changes require user authority.
6. No autonomous mass application.
7. Unknown information stays unknown.
8. Core workflows remain useful without remote inference.
9. Application materials trace to confirmed evidence.
10. Search learning proposes strategy changes; it does not silently mutate profile/evidence.
11. Occupation knowledge is bounded data/rules before plugin/runtime complexity.
12. External services remain adapters, not domain authorities.
13. Browser delivery does not make personal career data server-authoritative.
14. Runtime adapters do not become product/domain authorities.
15. Public code-signing certificates are optional tools, not foundational release dependencies.
16. Inference-specific governance is additive: inference-disabled workflows preserve the deterministic baseline, and inference may not replace, weaken, or make deterministic gates provider-dependent.

## Historical plans

Earlier `plan-*.md` files remain for provenance only. They should not be used to infer current status. The current documentation authority hierarchy is in [`../README.md`](../README.md).
