# Documentation Index

Job Ranger documentation is intentionally divided into **current product truth**, **active design/roadmap**, **validation evidence**, **research**, **release evidence**, and **historical provenance**.

This hierarchy exists because the repository has accumulated multiple generations of planning documents. A reader should never have to guess whether an old phase plan still describes the product.

## Authority hierarchy

When documents disagree, use this order:

1. **Published GitHub Release** for what ordinary users can download and run.
2. **Current source and tests on `main`** for what is actually implemented in the repository.
3. **`SYSTEM_STATE.md`** for the reconciled factual snapshot of `main` versus the published release.
4. **Root `README.md` and `HELP.md`** for public/user-facing product behavior.
5. **`ARCHITECTURE_PLAN.md`** for current architecture and accepted trust boundaries.
6. **`planning/PLAN.md`** for genuine next work.
7. **Current design documents** for normative contracts and accepted architectural decisions.
8. **Validation/research documents** for evidence and alternatives.
9. **Historical plans / internal provenance** for how the project got here, not what it is now.

A stale plan does not outrank merged code merely because it contains more checkboxes.

## Current sources of truth

| Document | Purpose |
| --- | --- |
| [`../README.md`](../README.md) | Public overview, published-release boundary, current `main` capability map, development/release entry points. |
| [`../HELP.md`](../HELP.md) | User workflows, troubleshooting, and published-vs-main behavior. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Published release history plus the current `Unreleased` delta. |
| [`CONCEPT.md`](./CONCEPT.md) | Product purpose, Career Ops quality-over-quantity principles, boundaries, and success standard. |
| [`SYSTEM_STATE.md`](./SYSTEM_STATE.md) | Factual current repository/product snapshot. |
| [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md) | Current architecture, authority model, trust boundaries, and accepted evolution. |
| [`adr/README.md`](./adr/README.md) | Architecture decision log and accepted durable product/technical boundaries. |
| [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md) | Accepted post-v1.2 dual-channel distribution architecture: cross-platform PWA plus Microsoft Store Windows native app. |
| [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md) | Web/PWA runtime implementation: shared core and adapters, persistence, security, service worker, capability parity, deployment. |
| [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md) | Microsoft Store (AppX) packaging, Store runtime behavior, NSIS coexistence/migration, validation, external steps. |
| [`planning/PLAN.md`](./planning/PLAN.md) | Actual prioritized next work. |
| [`RELEASE_READINESS.md`](./RELEASE_READINESS.md) | Release-blocking validation and publication contract. |
| [`PRODUCT_GAP_REVIEW.md`](./PRODUCT_GAP_REVIEW.md) | Evaluated missing capabilities with needed/candidate/deferred/rejected dispositions. |
| [`design/UNIVERSAL_USER_STORIES.md`](./design/UNIVERSAL_USER_STORIES.md) | Normative US-0 through US-30 product contract and cross-career acceptance model. |
| [`BRANDING.md`](./BRANDING.md) | Canonical visual assets and usage. |
| [`../GOVERNANCE.md`](../GOVERNANCE.md) | Decision authority, truth/status language, merge/release expectations. |
| [`../SECURITY.md`](../SECURITY.md) | Current security model, boundaries, reporting, and dependency expectations. |
| [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | Required attribution and third-party provenance. |
| [`../LICENSE_HISTORY.md`](../LICENSE_HISTORY.md) | License history: AGPL-3.0-only for development after v1.2.0; MIT grants for v1.2.0 and earlier. |
| [`../TRADEMARKS.md`](../TRADEMARKS.md) | Job Ranger name/brand use and official-distribution identity. |
| [`DISTRIBUTION_TRUST.md`](./DISTRIBUTION_TRUST.md) | Forward distribution trust contract: provenance, channel trust, runtime security. |
| [`TESTER_INSTALLATION.md`](./TESTER_INSTALLATION.md) | Bounded guidance for informed testers of unsigned/prerelease artifacts. |
| [`CLEAN_MACHINE_TRUST_VALIDATION.md`](./CLEAN_MACHINE_TRUST_VALIDATION.md) | Clean-machine install/first-launch evidence procedure for promoted direct-download binaries. |
| [`BUILD_RUNTIME.md`](./BUILD_RUNTIME.md) | Electron build and runtime authority (`electron/src/` as the only checked-in implementation). |

## Current product/design contracts

These describe implemented architecture or accepted long-lived contracts and should remain aligned with `SYSTEM_STATE.md`:

- [`design/UNIVERSAL_USER_STORIES.md`](./design/UNIVERSAL_USER_STORIES.md)
- [`design/CAREER_EVIDENCE_PERSISTENCE_CONTRACT.md`](./design/CAREER_EVIDENCE_PERSISTENCE_CONTRACT.md)
- [`design/CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md`](./design/CAREER_EVIDENCE_RESUME_FUNCTIONAL_DESIGN.md)
- [`design/APPLICATION_LIFECYCLE_FOUNDATION.md`](./design/APPLICATION_LIFECYCLE_FOUNDATION.md)
- [`design/INTERVIEW_PREP.md`](./design/INTERVIEW_PREP.md)
- [`design/CAREER_STORIES.md`](./design/CAREER_STORIES.md)
- [`design/APPLICATION_MATERIALS.md`](./design/APPLICATION_MATERIALS.md)
- [`design/SEARCH_LEARNING.md`](./design/SEARCH_LEARNING.md)
- [`design/BACKUP_RESTORE.md`](./design/BACKUP_RESTORE.md)
- [`design/R5_PORTABILITY_SCOPE_DECISIONS.md`](./design/R5_PORTABILITY_SCOPE_DECISIONS.md)
- [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md)
- [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md)
- [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md)
- [`design/INFERENCE_CONTRACT.md`](./design/INFERENCE_CONTRACT.md) — provider-neutral optional-inference boundary; proposal-only authority, transmission disclosure, schema validation, deterministic adjudication, fallback, provenance, and provider conformance.
- [`design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md`](./design/PERSONAL_BRAND_PUBLISHING_ANALYTICS.md) — deterministic personal-brand composition guidance, exact approval, publishing, analytics snapshots, comparison cohorts, and career-outcome learning.
- [`adr/0001-personal-brand-publishing-and-analytics.md`](./adr/0001-personal-brand-publishing-and-analytics.md) — accepted boundary for personal-brand publishing, analytics, and career-outcome learning.

A design document may preserve detailed implementation rationale even after its issue closes. Its status must not be used to infer whether a feature is shipped; use `SYSTEM_STATE.md` and the release record for that.

## Active proposals and bounded interoperability research (not shipped)

- [`design/DRIVE_AGENT_INTERCHANGE_CONTRACT.md`](./design/DRIVE_AGENT_INTERCHANGE_CONTRACT.md) — **draft** agent-neutral Google Drive export/proposal authority and formatting rules (#249/#255/#285); no OAuth, import, sync or connected agent is implemented by this document.
- [`design/schemas/jr-agent-export-v1.schema.json`](./design/schemas/jr-agent-export-v1.schema.json) and [`design/schemas/jr-agent-proposal-v1.schema.json`](./design/schemas/jr-agent-proposal-v1.schema.json) — **draft** closed JSON envelope schemas. They do not replace a deterministic validator, immutable source receipt, semantic provenance checks, existing Truth Gate or human approval.
- [`planning/PLAN.md`](./planning/PLAN.md) — current implementation order: Drive interoperability first, release hardening concurrently, new provider candidates queued.

## Validation evidence

Version-controlled validation evidence lives under [`validation/`](./validation/).

Current areas include:

- universal career fixture schema/version/execution/findings;
- US-0 through US-30 validation matrix;
- structured credential evidence validation;
- evidence references/lineage validation;
- source discovery tranche validation;
- Windows package/runtime evidence where retained.

Validation documents answer **what was proven and under what assumptions**. They do not automatically upgrade a feature from implemented to shipped.

## Research evidence

Research documents are inputs to product and architecture decisions, not a feature adoption queue.

Key current research:

- [`research/AUTO_APPLY_MARKET_RESEARCH_2026-10-04.md`](./research/AUTO_APPLY_MARKET_RESEARCH_2026-10-04.md) — delegated/automated submission market evidence and the rationale for Job Ranger's quality-over-quantity Career Ops direction;
- [`research/RESUME_INTELLIGENCE_QOR.md`](./research/RESUME_INTELLIGENCE_QOR.md)
- [`research/RESUME_INTELLIGENCE_CATALOG_HARVEST.md`](./research/RESUME_INTELLIGENCE_CATALOG_HARVEST.md)
- [`research/JOB_RANGER_CAPABILITY_CATALOG_RECONCILIATION.md`](./research/JOB_RANGER_CAPABILITY_CATALOG_RECONCILIATION.md)
- [`research/RESUME_PARSER_ADOPTION_2026-09-25.md`](./research/RESUME_PARSER_ADOPTION_2026-09-25.md)
- [`research/ANYDOC_PARSER_BENCHMARK_PROTOCOL.md`](./research/ANYDOC_PARSER_BENCHMARK_PROTOCOL.md)
- [`research/LOCAL_EVIDENCE_CLI_267.md`](./research/LOCAL_EVIDENCE_CLI_267.md) — **unmerged developer-tool candidate**, local-only typed Git-object evidence verifier; independent component review PASS, no PR enforcement or Qor acceptance. [Runnable sample](./examples/local-evidence-sample.evidence.json).

Research can recommend or reject a capability. It does not make that capability product truth until accepted and implemented.

## Release documentation

Release truth is deliberately strict:

- GitHub Releases define what users can download;
- [`CHANGELOG.md`](../CHANGELOG.md) records release history and the next unreleased delta;
- [`RELEASE_READINESS.md`](./RELEASE_READINESS.md) defines the pre-publication evidence required;
- package/build configuration defines what can theoretically be built, not what was actually published;
- platform validation records what was actually exercised.

The latest published stable release is **v1.2.0**, published 2026-10-05 from commit `71f9b790a1f456321aee2c783f39f4a6784b83a9`.

The accepted post-v1.2 distribution direction does not retroactively change v1.2.0. The historical release remains immutable; Store/PWA work is implemented on the post-v1.2.0 line (PR #142) and remains forward-looking until certified or deployed.

## Current documentation baseline

As of the October 2026 reconciliation, current docs must reflect that the v1.2 line includes:

- progressive onboarding;
- Target Tracks and explicit constraint semantics;
- durable Career Profile and Applications;
- Career Evidence import/direct authoring/provenance/lineage;
- structured credentials and evidence references;
- source discovery with explicit approval;
- explainable opportunity assessment;
- deterministic resume creation and tailoring;
- exact submitted-artifact history;
- lifecycle contacts/events/reminders/offers;
- evidence-grounded interview preparation;
- Career Stories;
- evidence-grounded application materials;
- Search Insights and recurring-gap analysis;
- verified backup/restore;
- JSON Resume interoperability;
- cross-career validation fixtures.

Current product documentation must also preserve the accepted strategic distinction that Job Ranger is a **quality-over-quantity Career Ops product**. It may automate discovery, analysis, preparation, and organization aggressively while keeping consequential external actions intentional. Candidate relationship-path features tracked in #121 remain historical design context unless separately implemented.

Current architecture documentation must preserve the accepted post-v1.2 distribution direction:

- cross-platform mainstream through a local-first PWA/web runtime;
- Windows-native mainstream through Microsoft Store packaging/certification;
- no required Azure Artifact Signing dependency;
- no planned native macOS distribution or Apple Developer Program dependency;
- no SignPath dependency;
- direct unsigned GitHub native binaries are not the preferred ordinary-user path.

A current source-of-truth document that describes completed capabilities as "planned" is stale and should be corrected. A current source-of-truth document that describes accepted future distribution work as already implemented is equally stale.

## Historical planning records

The following files are retained for implementation provenance and must not be used as current product status:

- `plan-remediation.md`
- `plan-v1-remediation.md`
- `plan-final-remediation.md`
- `plan-phase2-api-adapters.md`
- `plan-phase3-salary-extraction.md`
- `plan-phase4-caching-circuit-breaker.md`
- `planning/plan-phase5-notifications-tray.md`
- `planning/plan-phase5-notifications-tray-v2.md`
- `windows-package-validation.md` (Windows packaging validation for #38, 2026-09-24)

These documents are not rewritten merely to make history look tidy. Where they conflict with current source, tests, or current source-of-truth documents, the newer evidence wins.

## Internal provenance artifacts

`META_LEDGER.md` and `SHADOW_GENOME.md` are internal project/provenance artifacts.

They are not end-user product documentation and must not override current product, governance, security, architecture, or release truth.

## Documentation maintenance rule

Material product changes should update the smallest set of current source-of-truth documents needed to prevent contradiction.

Before a release:

- run the documentation/release-readiness reconciliation;
- verify HELP/navigation language against the actual candidate UI;
- move completed work out of roadmap "planned" sections;
- ensure `Unreleased` changelog content covers the actual candidate;
- verify shipped vs main labels;
- record any validation that could not be performed.

The repository intentionally preserves GitHub Actions budget. Documentation-only or release-readiness remediation may be validated manually by the maintainer instead of through hosted Actions, provided the evidence states exactly what was and was not run.
