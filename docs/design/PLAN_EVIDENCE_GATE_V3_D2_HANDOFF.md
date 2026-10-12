# D2 handoff: binding plan-evidence preflight in Qor-logic-plus (separately governed)

**Status:** handoff design only. Nothing in this document modifies Qor-logic-plus. Implementation needs Qor-logic-plus's own plan, independent audit, implement and seal cycle, run in that repository. Job Ranger cannot satisfy D2 through any workflow of its own.

## Verified runtime facts (installed `qor-logic-plus 3.8.0`, 2026-10-12)

- `/qor-audit` Step 0.3 runs `qor-logic-plus scripts plan_iteration_status_lint --plan "$PLAN_PATH" || ABORT`. It is the existing **hard** pre-audit short-circuit: no audit artifact is emitted and no cycle is consumed. Step 0.6 is a WARN-only (`|| true`) lint ladder and must stay WARN-only.
- `/qor-plan` Step Z persists `.qor/gates/<sid>/plan.json` through `gate_chain.write_gate_artifact`. This is the submission point.
- Qor-logic-plus #173 (`findings_signature` rejects `feature-test-undeclared`) is **CLOSED as NOT_PLANNED**. Fix PRs #176 and #179 are **closed and unmerged**, so the defect is still live in 3.8.0 and `cycle_count_escalator.check_session_total` raises.

## Smallest integration point

1. **New module `qor/scripts/plan_evidence_preflight.py`.** Its contract:
   - It reads the consuming repository's `.qorlogic/config.json` key `plan_evidence_preflight`, for example `{"argv": ["python", "scripts/plan_evidence_check.py", "--repo", ".", "--head", "{head}", "{plan}"]}`. The value is an operator-configured, fixed argv list. It is never taken from plan content. Only the `{head}` and `{plan}` placeholders are substituted, `{head}` comes from `git rev-parse HEAD` as a full SHA, and no shell is used.
   - With no key configured, it reports `NOT CONFIGURED` and exits 0, so other repositories are unaffected. This is opt-in per repository.
   - A non-zero exit from the configured command means the preflight fails.
2. **`/qor-audit` Step 0.3:** add `qor-logic-plus scripts plan_evidence_preflight --plan "$PLAN_PATH" || ABORT` next to `plan_iteration_status_lint`. A plan with failing evidence is then not audit-ready, and no cycle is consumed.
3. **`/qor-plan` Step Z:** call the same preflight before `write_gate_artifact`. On failure, refuse to write `plan.json` and report it. A plan whose declared evidence fails is never recorded as submitted.
4. **Doctrine:** a reference file stating the following:
   - the preflight verifies declared evidence and structure only;
   - prose completeness remains an auditor Step 3 duty;
   - the trust model is that a local governor runs its own repository's checker, so this is not untrusted PR execution. CI enforcement stays with the repository's base-revision gate (D1).

## Tests required in Qor-logic-plus (its own red-first)

- With no config, the result is NOT CONFIGURED and the exit code is 0.
- When the configured command exits 1, Step 0.3 ABORTs and no audit artifact is written.
- When the configured command exits 1, the plan Step Z writes no `plan.json`.
- Placeholder substitution is list-form only. An injection attempt through the plan path is rejected, for example a path starting with `-` or containing NUL.
- Step 0.6 stays WARN-only (`|| true`). This is a regression lock.

## Order and dependencies

1. Job Ranger: the v3 gate is implemented, independently reviewed, and delivered to its base branch through an operator-approved route.
2. Qor-logic-plus: open an issue and run its own governed phase for the module, the skill steps and the doctrine, then release.
3. Job Ranger: the operator adds the `plan_evidence_preflight` key to `.qorlogic/config.json`. This is a governed change.
4. D2 is satisfied only after a Qor-logic-plus release containing the change is installed and observed to ABORT on a failing plan.
