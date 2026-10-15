# Job Ranger Roadmap

**Current as of:** 2026-10-10 (source checkpoint `4721e7fa782099c69019494d6f823c2cc372b98d`)

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

## Active priority 0: distribution architecture — external validation and launch

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

## Active priority 1: source discovery and quality

### Post-v1.2 provider tranche / #136

**Status: planning/remediation blocked, not authorized on main.** The candidate implementations are confined to draft PRs #233 (Himalayas) and #238 (We Work Remotely); the governance plan and repeated-VETO remediation are on draft PR #232. A plan branch's ledger entries are not main-line seals.

- **Himalayas:** source evidence suggests worthwhile additional remote/technical role coverage, but the candidate has real date, time-zone, country-list and response-size defects. Correcting them requires a valid independently audited plan and intent lock.
- **We Work Remotely:** **HOLD** on unresolved publisher terms restricting job-search uses of WWR data, even though its RSS page permits attributed reuse. Do not ship or enable until written publisher clarification or authorized legal clearance and a separate qualified plan.
- **Coverage:** live single-day measurements are exploratory, concentrated in remote/technology careers; no validated general-market or local/trades improvement claim follows from them.

Requirements remain first-party terms/attribution verification, deterministic normalization, provenance, explicit eligibility limitations, unique useful coverage rather than listing-count inflation, and governed acceptance or rejection.

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

**Status: manual-first implementation exists on `main`, not published in v1.2.0.** The previous roadmap incorrectly said implementation had not started. Source authority: `src/pages/PersonalBrand.tsx`, `electron/src/personal-brand-backend.cts`, and the linked tests. ADR: [ADR-0001](../adr/0001-personal-brand-publishing-and-analytics.md). Design: [Personal Brand Publishing and Analytics](../design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md).

Implemented development slices, not a claim of full ADR completion:

- [x] user-authored LinkedIn-focused drafts and deterministic readiness findings with content/hook/objective metadata;
- [x] human-reviewed exact-copy package, user-confirmed manual publication receipts and local metrics snapshots;
- [x] local LinkedIn XLSX export preview and explicit confirmed persistence; saved-import deduplication, reconciliation, historical post text attestation and observed dashboard;
- [x] user-attested post topic classification and conservative approved-content cohort comparisons, without causal claims;
- [x] deterministic learning and comparison rules with explicit missing/conflicted/partial data states.

Outstanding or separately qualified:

- [ ] a distinct canonical Presence Brief and end-to-end claim/evidence linking, to the extent specified by the accepted design, must be validated independently rather than inferred from draft metadata;
- [ ] connected LinkedIn posting or data access requires its own provider permissions, terms, exact-content approval, and security qualification;
- [ ] prove cross-runtime user journeys and representative UX acceptance at the exact implementation head before release admission;
- [ ] ensure the v1.3.0 release boundary explicitly admits or defers each new Personal Brand slice; work on `main` is not automatically packaged/released.

Job Ranger supports a person's professional presence, not a generic marketing platform, and does not borrow Viable's product-marketing responsibilities.

### Economic transition pathways / #217 and #221

**Status: bounded local scenario comparison on `main`; wider source-backed review is still open.** The Target Tracks page mounts `EconomicPathwayExplorer`, which evaluates user-entered options with deterministic arithmetic (`src/shared/economic-pathways.ts`, `tests/economic-pathways.test.mjs`). This is not a sourced labor-market forecast, a verified income outcome, or an automatic career recommendation. Issue #221 retains the separate requirement for human market-source review and competing-scenario UX before live ingestion.

### Read-only local MCP prototype / #173 and #181

**Status: optional development adapter on `main`, not a shipped ChatGPT plugin.** The local stdio service and documented Secure MCP Tunnel trial remain read-only, permission-limited and human-authorized. A documented tunnel pathway does not establish a verified live ChatGPT connection; issue #181 remains open for that integration gate. See [local MCP prototype](../integrations/JOB_RANGER_MCP_READONLY.md).

## Deferred

Do not schedule these without new evidence:

- remote inference provider;
- OCR for scanned/image-only resumes;
- DOCX resume export;
- federal-resume/academic-CV specialized projections;
- universal travel/relocation/sponsorship fields;
- cloud sync / hosted account;
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
