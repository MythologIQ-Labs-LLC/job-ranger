# Plan: Phase 18 - Plan evidence gate v3 (typed inventory, CommonMark structure) (#267)

**change_class**: feature

**doc_tier**: standard

**terms**:
- term: evidence inventory
  home: docs/design/PLAN_EVIDENCE_GATE_V3_SPEC.md

**boundaries**:
- limitations: mechanically verifies declared typed records and document structure only; free-form prose completeness is not asserted
- non_goals: function, import or enum measurement; test-outcome receipts (D3); ruleset changes (D1); Qor-logic-plus changes (D2); remediation re-emit or event closure; Phase 17 iteration 5; provider work
- exclusions: no change to PR #232, #233 or #238; no application source or `package.json` change; no merge

**pr_target**: feature/136-provider-tranche-governed-plan

**risk_grade**: L2 (untrusted PR data on a privileged-trigger workflow; one new governance-tooling dependency)

Specification: `docs/design/PLAN_EVIDENCE_GATE_V3_SPEC.md`. The original proposal, `docs/design/PLAN_EVIDENCE_GATE_V3_PROPOSAL.md`, is kept unchanged. Operator decision: Option A (#267). The phase-17 remediation (VETO #108) stands, and this plan is not an amendment to it.

## Open Questions

None. Dependency admission is decided at the design audit (spec section 9).

## Locked Decisions

- The v2 base-revision gate already runs on `pull_request_target` [claim:v2-gate-trigger]. v3 keeps that trust model and replaces the checker.
- The v2 binding module being replaced is large and lexical [claim:v2-prose-size]. v3 deletes it rather than extending it.
- The remediation gate's enforcer still names the v2 suite [claim:v2-enforcer]. This plan leaves the artifact untouched, and a separately authorized re-emit must change it.
- Runtime kinds are a closed union in source [claim:runtime-kind]. v3 does not claim such facts through enum parsing; a `line-equals` record is the supported form.
- Hash-pinned wheel admission versus vendoring is a design choice, not an observation [judgment:dependency-choice].

## Phase 1: Red-first adversarial suites

### Affected Files

- `tests/plan_evidence_fixture.py` (new) - temporary git repository plus helpers to build a plan and inventory
- `tests/test_plan_evidence_schema.py` (new) - closed schema, bounds, held and removed kinds, v2 rejection
- `tests/test_plan_evidence_structure.py` (new) - Amendment 3 Markdown probes, decided by parser tokens
- `tests/test_plan_evidence_claims.py` (new) - claim evaluation, binding failures, honest-limitation report
- `tests/test_plan_evidence_security.py` (new) - R3/R4: no execution, no writes, path and ref rejection, env scrub
- `tests/test_plan_evidence_gate.py` (new) - not-applicable, governed pass and fail, tamper, spoof, workflow architecture, razor

### Unit Tests

- The suites above, enumerated in spec section 11. They are committed before any implementation module and run red.

## Phase 2: Implementation

### Affected Files

- `governance/requirements-plan-evidence.txt` (new) - hash-pinned `markdown-it-py` 4.2.0 and `mdurl` 0.1.2
- `scripts/plan_evidence_schema.py` (new) - closed v3 schema and bounds
- `scripts/plan_evidence_structure.py` (new) - CommonMark structure and citation collection
- `scripts/plan_evidence_check.py` (new) - read-only git access, claim evaluation, report, CLI
- `scripts/plan_evidence_gate.py` (new) - base-revision PR gate
- `.github/workflows/plan-evidence-gate.yml` (new), `.github/workflows/plan-evidence.yml` (new) - required-check candidate and unprivileged self-test
- `.github/CODEOWNERS` - governed paths for v3
- `GOVERNANCE.md` - "Plan claims gate" section rewritten for v3
- `scripts/plan_claims_*.py`, `tests/plan_claims_fixture.py`, `tests/test_plan_claims_*.py`, `.github/workflows/plan-claims*.yml` - removed (superseded; preserved in history)
- `docs/plan-qor-phase18-plan-evidence-gate-v3.evidence.json` (new) - this plan's own inventory

### Unit Tests

- All Phase 1 suites go green, twice. This plan passes `python scripts/plan_evidence_check.py --repo . docs/plan-qor-phase18-plan-evidence-gate-v3.md`.

## Definition of Done

- D1: v3 verifies declared typed records and CommonMark structure, rejects unsupported kinds, and reports prose completeness as not asserted.
- D2: modules and tests named in Phase 2 exist within razor limits; the dependency is installed hash-locked and wheel-only.
- D3: META_LEDGER PLAN, GATE, IMPLEMENT and SEAL entries in a new session; the remediation gate and Phase 16 events are unchanged.
- D4: the suites pass twice locally, the self-application check passes, and an independent implementation and security review returns a verdict.

## CI Commands

- `python -m pip install --require-hashes --no-deps --only-binary=:all: -r governance/requirements-plan-evidence.txt` - pinned parser
- `python -m unittest discover -s tests -p "test_plan_evidence_*.py"` - v3 suites (run twice)
- `python scripts/plan_evidence_check.py --repo . docs/plan-qor-phase18-plan-evidence-gate-v3.md` - self-application
