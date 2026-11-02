# Governance

Job Ranger is an independently maintained open-source project. This document defines how product, release, documentation, security, and implementation decisions are made so contributors can distinguish discussion, implementation, and actual product commitments.

## Maintainer authority

The repository owner is the final decision authority for:

- product direction;
- releases;
- licensing choices;
- security boundaries;
- architecture commitments;
- merges;
- documentation status claims.

Issues and pull requests are proposals until merged or otherwise explicitly accepted. A branch or open pull request does not define shipped behavior.

## Decision priorities

When priorities conflict, Job Ranger generally favors:

1. user safety and factual integrity;
2. privacy and clear authority boundaries;
3. reliability and evidence-backed product claims;
4. usability for nontechnical job seekers;
5. maintainability and testability;
6. feature breadth.

A feature that is impressive but confusing, unsafe, unverifiable, or impossible for an ordinary job seeker to operate is not automatically progress.

## Product change classes

### Routine

Examples:

- narrow bug fixes;
- documentation corrections;
- compatible dependency patches;
- visual polish that does not alter product behavior.

Routine work may use a lightweight review path when risk is low.

### Material

Examples:

- persistence changes;
- new job-source behavior;
- new user workflows;
- major dependencies;
- packaging changes;
- meaningful architectural refactors;
- changes to Career Evidence authority or application lifecycle semantics.

Material work should have an issue or clearly documented design rationale and must update affected current documentation.

### High impact

Examples:

- authentication;
- cloud sync;
- telemetry;
- credentials;
- external inference;
- browser form automation;
- autonomous application submission;
- security-boundary changes;
- destructive migrations.

High-impact changes require explicit maintainer approval before implementation is treated as accepted direction.

## Truthful status language

Current documentation uses these states:

- **shipped**: available in a published GitHub Release;
- **implemented on main**: merged and present on the default branch but not necessarily in the published installer;
- **candidate / next**: plausible evidence-backed follow-on work, not yet a commitment;
- **deferred**: intentionally not active, with rationale;
- **rejected / non-goal**: conflicts with current product governance unless explicitly reconsidered;
- **historical**: retained for provenance, not current guidance.

Avoid using "planned" as a vague holding pen. If work is genuinely accepted and scheduled, describe it precisely. If it is only plausible, call it a candidate. If it is intentionally not active, call it deferred.

## Documentation standard

Documentation is part of the product boundary, not cleanup after the product is built.

Platinum-grade documentation should let a reader answer, without repository archaeology:

1. What can I download today?
2. What is implemented on `main` but not yet released?
3. What does the product do end to end?
4. Which component owns each kind of truth/state?
5. What are the privacy/security boundaries?
6. What is intentionally not implemented?
7. What is genuinely next?
8. What must be proven before release?

### Documentation authority

The documentation hierarchy is defined in `docs/README.md`.

Current source-of-truth documents must be reconciled after material changes. Historical phase plans remain historical and are not rewritten merely to make old decisions look current.

### Documentation reconciliation at change boundaries

For a material feature, security, architecture, distribution, or governance change, review the **actual merged source and tests** before updating its public claim. Update only the affected authoritative surfaces, but consider the root README and HELP, `docs/SYSTEM_STATE.md`, active roadmap, `docs/FEATURE_INDEX.md`, `docs/GOVERNANCE_INDEX.md`, CHANGELOG, design/ADR, and validation evidence.

- Record a source SHA and the difference between **published**, **implemented on main**, **draft/unqualified**, **held**, and **deferred**. A pull request or passed unit test alone never promotes a capability.
- When a roadmap task moves into main, replace stale “not started” language with bounded implementation facts and leave unfinished acceptance criteria open.
- Keep governance ledger indexes aligned to **the ledger actually merged into that branch**; do not transplant VETO, remediation, or seal records from another draft branch. Never declare approval by editing a status document.
- Record validation methods and limitations honestly. A documentation-only reconciliation does not pass software CI, independent governance audit, or platform release gates.
- During active concurrent development, use an isolated documentation branch rather than editing the same in-flight governance/implementation branch; reconcile again before release admission.

The latest dated reconciliation is indexed under `docs/validation/`. Documentation authority and the precedence of conflicting files are defined in [the documentation index](./docs/README.md).

### Documentation drift

A current document that describes completed work as future work, or unreleased work as shipped, is a defect.

Documentation drift discovered during release preparation is release-blocking until corrected.

## Validation policy

Validation is evidence, not ceremony.

The repository deliberately preserves GitHub Actions budget. Hosted CI/CD is therefore not mandatory for every documentation-only or release-readiness iteration.

The maintainer may run equivalent checks manually in an isolated environment when that is more appropriate.

Manual validation must record:

- the environment used;
- exact commands or checks performed;
- results;
- checks that could not be performed;
- any assumptions or reused evidence.

Do not imply a GitHub Actions gate ran when it did not.

Likewise, a green hosted workflow demonstrates only that its configured assertions passed. It does not prove product fitness, source compatibility, platform packaging, or user success.

## Merge standard

Material changes should not merge unless:

- the change matches its stated scope;
- appropriate validation has passed or limitations are explicitly recorded;
- public/current claims remain true;
- documentation reflects the new reality;
- licensing and attribution are clear;
- security/trust boundaries remain intact or have explicit approval to change;
- known blockers are not hidden inside optimistic wording.

For documentation-only remediation, a direct maintainer merge may be appropriate when opening a pull request would consume unnecessary hosted Actions budget. The same truth/review standard still applies.

## Releases

Published GitHub Releases are the source of truth for downloadable artifacts.

Build configuration may support targets that are not present in a particular release. `main` may contain capabilities that are not yet shipped.

A release must satisfy `docs/RELEASE_READINESS.md` before publication.

Release notes must describe what users can actually obtain and run from the immutable tag, not everything the repository has ever implemented or every target Electron Builder can theoretically emit.

The release process must preserve the distinction between:

- code merged on `main`;
- a validated release candidate;
- an immutable tag;
- published assets.

## Product expansion standard

Competitor features, catalog entries, and interesting libraries are evidence inputs, not an adoption queue.

Before adding a major capability, evaluate:

- real user problem;
- fit with Job Ranger's local-first/evidence-first model;
- privacy/security cost;
- authority implications;
- maintenance burden;
- whether a simpler native workflow solves most of the need;
- whether the capability should be needed, candidate, deferred, or rejected.

Current gap dispositions are recorded in `docs/PRODUCT_GAP_REVIEW.md`.

## Dependencies

Patch/minor updates may be grouped where compatibility permits.

Major upgrades are treated as migrations with explicit runtime, module-system, packaging, and security review.

A dependency-security exception must be:

- narrow;
- documented;
- justified by actual exploitability/path;
- removed when the supported upstream fix becomes available.

Do not use `npm audit fix --force` as a substitute for dependency review.

## Third-party work

Third-party code or design mechanisms may be incorporated only when the exact license boundary permits it.

Required copyright and license notices must be retained. Trademark and branding rights are treated separately from source-code licenses.

The repository license does not automatically relicense bundled templates, fonts, models, datasets, plugins, or hosted services.
