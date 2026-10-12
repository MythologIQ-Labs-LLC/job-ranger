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

## Plan claims gate

Governed plans from `docs/plan-qor-phase17-*` onward carry exactly one fenced `json qor-plan-claims` manifest (version 2). The manifest sits outside the canonical sections. It is a structured inventory of read-only claims against full 40-character commit SHAs. Supported claim kinds:

- exact line;
- text present or absent;
- file and function size;
- string-union enum values;
- import edge.

Binding rules, enforced by `scripts/plan_claims_check.py`:

- **Restricted Markdown.** Governed plans use a small Markdown subset that a renderer and the checker read the same way. Anything else fails closed:
  - ATX headings start at column 0. Canonical section names may appear only as level-2 headings, and there is at most one leading level-1 title.
  - A fence is exactly three backticks at column 0 and is closed by exactly three backticks. Tilde, longer and indented fences are rejected.
  - Setext underlines are rejected.
  - Raw HTML outside code spans is rejected. Autolinks are allowed.
  - Line endings must be LF or CRLF. Form feeds and Unicode line separators are rejected.
- **Scope.** Canonical sections are Locked Decisions, each Phase, Definition of Done and CI Commands. They are scanned in full, fenced blocks included. An unclosed fence fails.
- **Detected forms.** These assertions are detected:
  - file:line and `#L` citations;
  - `git show` grep evidence;
  - line references and `L93-L120` ranges;
  - sizes;
  - enum literals;
  - imports;
  - text presence;
  - test classifications;
  - exhaustiveness wording ("only", "sole", "nothing else");
  - every other number outside code-span test vectors under an exact `### Unit Tests` heading.
- **Typed claims.** Each detected assertion must reference exactly one unused, type-compatible claim on its own line. Matching works like this:
  - **Subject.** It comes from the assertion itself:
    - citations and grep evidence carry their own path;
    - a line reference needs exactly one file named on the line;
    - a size, enum, import or text assertion needs a backticked subject directly before it, with no other identifier in between.
  - **Revision.** A SHA prefix of the claim's commit must appear on the line.
  - **Property.**
    - An exact size ("is N lines") binds only to `equals`.
    - "at most N" and "under N" bind to `max`.
    - Lines, text, enum values and import polarity must all match.
- **One use per ID.** A claim or judgment ID may be referenced exactly once.
- **Scoped judgments.** A judgment exception (`[judgment:id]`) covers exactly one non-mechanical number or exhaustiveness phrase. Its statement must be quoted verbatim from its own line, and its rationale must be specific. The independent auditor challenges every judgment.
- **Test classifications.** Red-first and regression-lock classifications need trusted harness evidence (dependency D3). Until that exists, the gate rejects them.
- **No execution.** Nothing in a manifest is executed. The checker reads git objects only, through fixed `git cat-file` and `git ls-tree` calls in a scrubbed environment. It rejects HEAD, branch, tag, short and expression references.
- **Function sizes.** Sizes come from a JS/TS tokenizer that fails closed on ambiguous syntax. That includes generic parameter lists containing `(`, `{` or `=>`, and non-literal module specifiers.

Detection is lexical. Numbers written as words, for example, are not detected, so the auditor remains responsible for undeclared assertions.

### Local commands

Run at the plan commit before recording or auditing a plan:

```bash
python -m unittest discover -s tests -p "test_plan_claims_*.py"
python scripts/plan_claims_check.py --repo .
```

### Required check architecture

**`plan-claims-gate`** (`.github/workflows/plan-claims-gate.yml`, `pull_request_target`) is the required-check candidate:

- It runs on every pull request, with no path filter, and always completes. When no governed file changed it succeeds with an explicit "not applicable".
- It runs the gate script from the protected base revision and fetches the PR head as git objects only. It never checks out or executes PR content, so a PR that weakens the checker cannot certify itself.
- The token is read-only, no secrets are used, credentials are not persisted, and SHAs reach the shell only through environment variables.

**`plan-claims-selftest`** (`.github/workflows/plan-claims.yml`) runs the PR head's own suites. It is informational only and must not be required.

`plan-claims-gate` also fails any PR that adds or changes another workflow publishing a check named `plan-claims-gate`, to prevent check-name spoofing. `.github/CODEOWNERS` assigns every governed path, including all workflows. That protection only takes effect once the ruleset requires code-owner review.

### Dependencies (not yet satisfied)

**D1 (operator; prepared, not applied).** Apply it only after `plan-claims-gate` has been observed on `main` reporting a completed success on an unrelated PR and a failure on an invalid governed PR. Then update ruleset `Default Main` with:

```json
{"rules": [{"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false,
  "required_status_checks": [{"context": "plan-claims-gate", "integration_id": 15368}]}},
 {"type": "pull_request", "parameters": {"require_code_owner_review": true}}]}
```

Merge these with the existing rules; do not replace them.

Code-owner review protects anything only if the automation that authors governed changes is not the code owner it would need approval from. With a single owner identity this is a documented residual risk.

**D2 (separately governed Qor-logic-plus phase).** Wire this preflight into the `/qor-plan` submission path and the binding `/qor-audit` Step 0.3 ABORT. Step 0.6 stays WARN-only.

**D3.** A separately controlled trusted test harness, before any plan may assert red-first or regression-lock status.

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
