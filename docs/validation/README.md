# Validation Evidence

This directory contains durable evidence for product, cross-career, documentation, and release-readiness claims.

Validation records answer **what was checked, against which state, in which environment, and with what limitations**. They do not automatically make a capability shipped; published GitHub Releases remain the authority for downloadable product state.

## Universal product validation

Job Ranger's universal-product claims are validated through maintained synthetic career fixtures rather than occupation-specific product modes.

- `UNIVERSAL_USER_STORY_MATRIX.md` maps US-0 through US-30 to required career contexts and validation state.
- `UNIVERSAL_FIXTURE_SCHEMA.md` governs fixture structure and change rules.
- `UNIVERSAL_FIXTURE_FINDINGS.md` records cross-context findings and product-model gaps exposed by the current fixture version.
- `UNIVERSAL_FIXTURE_EXECUTION.md` records the governed fixture execution contract.
- `UNIVERSAL_FIXTURE_VERSION.md` records fixture versioning.
- `../../tests/fixtures/universal-careers.v1.json` is the canonical synthetic fixture data used by deterministic domain tests.
- `../../tests/fixtures/military-transition.v1.json` extends validation for military-to-civilian evidence translation.

The governing rule is simple: schema acceptance alone is not universality. A workflow must remain coherent, truthful, and useful across materially different career contexts without adding occupation-specific forks or silently changing evidence authority.

## Capability-specific validation

- `credential-evidence-v1.md` records structured credential validation.
- `evidence-references-lineage-v1.md` records evidence reference and supersede-lineage validation.
- `source-discovery-tranche-1.md` records the first governed source-discovery tranche.

## Documentation and release-readiness validation

- `RELEASE_CANDIDATE_V1.3.0.md` records the v1.3.0 scope decision, pre-tag validation, upgrade evidence from v1.2.0, remaining gates, and packaged-candidate history.
- `DISTRIBUTION_IMPLEMENTATION_2026-10-05.md` records the distribution-architecture implementation (#142): hosted CI runs, Windows Store in-package evidence, and what was not performed (certification, PWA deployment, cross-browser validation).
- `DOCUMENTATION_REMEDIATION_2026-10-03.md` records the platinum documentation/product-gap audit, manual validation strategy, reused unchanged-code evidence, and explicit limitations.
- `DOCUMENTATION_RECONCILIATION_2026-10-10.md` records the main-branch status/code/documentation alignment review, discovered drift, corrected authority boundaries and checks **not** performed, with a dated 2026-10-15 refresh against a newer `main`.

Release candidates should follow [`../RELEASE_READINESS.md`](../RELEASE_READINESS.md) and retain additional platform/package evidence when it materially improves reproducibility.

## Evidence rules

A validation record should state:

- exact branch/tag/commit where practical;
- environment or service used;
- checks/commands performed;
- observed results;
- reused prior evidence and why reuse is valid;
- checks that were not performed;
- blockers/limitations;
- whether the result proves implemented behavior or shipped behavior.

The repository deliberately preserves GitHub Actions budget. Manual maintainer validation is valid when it is explicit and reproducible. An unexplained absence of evidence is not.
