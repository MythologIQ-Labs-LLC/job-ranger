# Specification: plan evidence gate v3

**Status:** refined specification, iteration 3 and final authorized design iteration, for independent design audit (#267). Iteration 1 was VETOed at ledger #110 (findings V1-V5), and that audit ADMITTED the dependency. Iteration 2 was VETOed at ledger #112 (findings R1-R5, advisories A1-A6). Iteration 3 changes only what those findings require. It refines `PLAN_EVIDENCE_GATE_V3_PROPOSAL.md` and does not replace it. Neither document is a remediation amendment, closes an event, or authorizes D1 or D2.
**Branch:** `impl/267-plan-evidence-gate-v3`. This is a new branch: it starts from PR #232 head `cb9b7b1bc0e27c96085be7c6da423369995d6fac`, with the proposal commit cherry-picked on top. Basing it on that head keeps the remediation session and ledger chain continuous. PR #232's own branch is not modified.
**Delivery (V1):** no pull request is opened under this plan. The branch is pushed for review only. It carries PR #232's governance-record lineage, including the vetoed Phase 17 records and ledger #95-#108. A PR, a target branch or any merge route therefore needs a separate, recorded operator decision.
**Operator decision:** Option A, the structural redesign. No Amendment 4 and no Phase 17 plan iteration 5.

## 1. What v3 claims, and what it does not

v3 mechanically proves exactly two things:

1. **Declared evidence.** Every record in a plan's typed evidence inventory is evaluated against immutable git objects. Each record is reported as `VERIFIED` or `FAILED`.
2. **Document structure and citations.** A pinned CommonMark parser confirms that the plan's canonical sections are real top-level sections. It also confirms that every inventory record is cited exactly once from eligible prose in those sections, and that every citation resolves.

v3 does **not** claim to find empirical assertions in free-form prose, and does not judge whether prose matches its citations. It also does not measure functions, import graphs or type unions, and does not judge test outcomes. The report says this every time: `free-form prose completeness: NOT MECHANICALLY ASSERTED`. The independent `/qor-audit` Step 3 auditor remains responsible for omitted, contradictory or misleading prose and for every judgment record.

## 2. Unchanged invariants (R3/R4)

- **No execution of PR material.** PR content (plan, inventory, code, tests, workflows) is data only. The verifier code, its parser dependency and its workflow come from the protected base revision.
- **Fixed, read-only git calls.** Git is invoked only as `cat-file -t|-s|blob`, `ls-tree -z`, `merge-base` (including `--is-ancestor`) and `diff --name-status -z --no-renames <commit> <commit>`. Arguments are list-form, there is no shell, the environment is scrubbed, `GIT_OPTIONAL_LOCKS=0` is set, and there is no checkout or worktree.
- **Immutable references.** Commits are full 40-character lowercase SHAs that resolve to commit objects. `HEAD`, branches, tags, short SHAs and expressions are rejected before any git call.
- **Validated paths.** A path is repository-relative. Each `/`-separated segment matches `[A-Za-z0-9_.][A-Za-z0-9_.-]*` and is not `.` or `..`. The object must be a blob with mode `100644` or `100755`, so symlinks and gitlinks are rejected.
- **No nominal success.** Anything that cannot be evaluated exits non-zero. There is no "warning and pass".

## 3. Artifact layout and applicability

**File-name grammar (A5).**

| File | Pattern |
| --- | --- |
| Governed plan | `docs/plan-qor-phase<N>-<slug>.md` |
| Its inventory | `docs/plan-qor-phase<N>-<slug>.evidence.json` (always derived from the plan path, never declared inside the plan) |

- `<N>` is `0`, or `[1-9][0-9]{0,2}`, so leading zeros are not allowed.
- `<slug>` is `[a-z0-9]+(-[a-z0-9]+)*`.
- A changed path that matches the glob `docs/plan-qor-phase*` but neither pattern fails with `E_PLAN_NAME`. That includes leading-zero, uppercase and missing-slug names.

**Applicability (R1).** In the PR gate, only trusted data decides which plans are evaluated: the gate code from the protected base revision B, and the immutable change list between the merge base M of B and the head H. M is computed with `git merge-base`, and the change list with `git diff --name-status -z --no-renames M H`. With rename detection off, a rename or copy appears as a deletion plus an addition, so neither can evade the rules below. This is decided before any head-supplied plan text, inventory, `schema_version` or metadata is read. Phase numbers and the presence of an inventory play no part.

| Change (M to H) | Result |
| --- | --- |
| Plan added or modified, any phase (`A`, `M`, or the addition half of a rename or copy) | **Gated.** The plan and its inventory are read at H and fully evaluated. A missing inventory fails with `E_INVENTORY_MISSING`. |
| Inventory added or modified | Its plan is **gated**, even if the plan file itself did not change |
| Plan deleted (`D`, including the deletion half of a rename) | `E_GOVERNED_DELETION` |
| Inventory deleted | `E_INVENTORY_DELETED` |
| Plan and inventory both untouched | Not evaluated in this PR. Their bytes are identical to the reviewed objects at M. The report lists them as `UNCHANGED (not evaluated)`, never as passing. |

- **Phase 17 iteration 4.** The iteration-4 plan is grandfathered only while it stays byte-identical to the merge base and has no related inventory change. Any change that touches it gates it, and with no inventory it fails with `E_INVENTORY_MISSING`.
- **There is no `LEGACY` status.** Nothing a PR adds or changes can be exempted by its name, its phase, or the absence of an inventory.
- **CLI mode.** The command line evaluates exactly the plans named on it, read from git objects at the mandatory `--head`. A named plan is always gated, so it needs a valid name and an inventory.

**Legacy manifests.** A plan that still contains a v2 embedded `json qor-plan-claims` fence is rejected with `E_LEGACY_MANIFEST` and a migration message. An inventory that uses `version` instead of `schema_version`, or a `schema_version` other than 3, is rejected. There is no silent reinterpretation.

## 4. Inventory schema v3 (closed)

```json
{
  "schema_version": 3,
  "plan": "docs/plan-qor-phase18-example.md",
  "claims": [
    {"id": "gate-trigger", "kind": "text-present", "commit": "<40-hex>", "path": ".github/workflows/plan-claims-gate.yml",
     "text": "pull_request_target:", "purpose": "The base-revision gate workflow exists at this commit"},
    {"id": "provider-id", "kind": "line-equals", "commit": "<40-hex>", "path": "src/shared/source-discovery.ts",
     "line": 3, "text": "export type SourceDiscoveryProviderId = \"public-job-feeds\";", "purpose": "Provider contract is unchanged"},
    {"id": "prose-module-size", "kind": "file-lines", "commit": "<40-hex>", "path": "scripts/plan_claims_prose.py",
     "predicate": {"operator": "equals", "value": 232}, "purpose": "Size of the module being replaced"}
  ],
  "judgments": [
    {"id": "provider-value", "statement": "Provider value requires user-story review", "owner": "independent auditor",
     "rationale": "Coverage value cannot be derived from immutable repository objects."}
  ]
}
```

**Top-level object.** The keys are exactly `schema_version`, `plan`, `claims` and `judgments`, with no others.

- `plan` must equal the governed plan's path.
- `claims` must contain at least one record.

**Common claim fields.** Every claim has:

| Field | Rule |
| --- | --- |
| `id` | Matches `[a-z0-9][a-z0-9-]{0,48}`; unique across claims and judgments |
| `kind` | One of the kinds below |
| `commit` | 40-hex SHA |
| `path` | Validated as in §2 |
| `purpose` | String of 8–300 characters |

Each kind adds its own fields. No other keys are allowed.

| Kind | Additional fields | Evaluation |
| --- | --- | --- |
| `line-equals` | `line` (integer ≥ 1), `text` (1–500 chars, no CR/LF) | The source's `line`-th line, defined in §5, equals `text` exactly |
| `text-present` | `text` (1–500 chars, no CR/LF) | `text` is a literal substring of the decoded source |
| `text-absent` | `text` (1–500 chars, no CR/LF) | `text` is not a literal substring of the decoded source |
| `file-lines` | `predicate` = `{"operator": "equals" or "at-most", "value": integer ≥ 0}` | The §5 line count satisfies the predicate |

**Removed or held kinds.** These are rejected as unsupported:

| Kind | Status | Reason |
| --- | --- | --- |
| `function-lines` | Removed | A trustworthy measure needs a real TypeScript AST |
| `import-edge` | Held | Needs a reviewed AST-backed design |
| `enum-values` | Held | Needs a reviewed AST-backed design |
| `test-outcome` | Held until D3 | No trusted test receipt exists |

Because these kinds fail validation outright, no guessed measurement can turn green.

**Judgments.** The keys are exactly `id`, `statement` (8–300 chars, one line), `owner` (2–80 chars) and `rationale` (at least 40 chars). Rationales must be pairwise distinct. A judgment is never `VERIFIED`; the report lists it as awaiting the auditor.

**Bounds.**

| Item | Limit |
| --- | --- |
| Plan file | ≤ 128 KiB |
| Inventory file | ≤ 64 KiB |
| Claims | ≤ 200 |
| Judgments | ≤ 50 |
| Source blob per claim | ≤ 2 MiB (checked with `cat-file -s` before reading) |

JSON is parsed with duplicate-key rejection, and integers are limited to 1–9 digits. Strings must not contain lone surrogates. Any violation fails closed with a coded error.

**Reachability (V5-d).** Each claim `commit` must be an ancestor of, or equal to, the evaluation head. That is the PR head in the gate, and the explicit `--head` SHA in the CLI. It is checked with `git merge-base --is-ancestor`. The plan and the inventory are read from git objects at the head, never from a working tree. Outcomes therefore do not depend on which other refs a runner has fetched.

## 5. Source evaluation semantics

- **Reading the blob.** The blob is obtained with `ls-tree -z <commit> -- <path>`, must be a regular file as defined in §2, and is decoded as strict UTF-8; failure is an error. No BOM or newline normalization is applied.
- **Lines.** The decoded text is split on `\n`. A single trailing `\r` is removed from each element, for CRLF sources.
- **Line count.** The count is `text.count("\n")`, plus 1 when the text is non-empty and does not end in `\n`. An empty file has 0 lines.
- **Per-claim results.** Each claim is `VERIFIED` or `FAILED`, with a reason that never quotes source beyond the claimed text.

## 6. Plan structure via a pinned CommonMark parser

The plan bytes are size-checked and decoded as strict UTF-8, then rejected if they contain any of the following:

- U+FEFF anywhere, including a leading BOM;
- NUL or C0 controls other than tab, LF and CR;
- bare CR;
- U+2028 or U+2029;
- a v2 embedded manifest fence.

The text is then parsed with `MarkdownIt("commonmark")` from `markdown-it-py`, with `maxNesting` left at 20. The parser runs from the trusted base install.

- **Bracket runs (A4).** More than 19 consecutive `[` characters in any inline token's `content` fail closed with `E_NESTING`. At that depth markdown-it's inline nesting limit makes it emit text where CommonMark would produce a link, so the run is rejected rather than accepted as an accepted divergence.
- **Nesting (V3).** Any token with `level >= 10` fails closed (`E_NESTING`). Content nested deeply enough to reach markdown-it's limit of 20 must first pass through levels 10-19, so silently dropped content is always detected before it is lost.
- **Parse budget (V5-a).** The plan is capped at 128 KiB. If parsing takes longer than 10 s of wall time, the result is `E_PARSE_TIME`. The gate job has `timeout-minutes: 5`. A worst-case fixture (pathological `![` repetition at the cap) must parse within the budget on the reference runner, or the test fails.

- **Headings.**
  - Every `heading_open` token must have nesting `level == 0`. A heading inside a list or blockquote fails closed.
  - **Heading name (V5-c).** The name is the heading's `inline.content`, and the inline token must have exactly one `text` child whose content equals `inline.content`. Entities, escapes, emphasis, code or links in a heading therefore fail closed (`E_HEADING_TEXT`). The name must be printable ASCII with no double spaces, so NBSP, zero-width and confusable letters fail.
  - **Near-matches (A3).** A heading name is compared case-sensitively and exactly. A near-match is any heading, at any level, whose name, once case-folded and with whitespace runs collapsed to one space, equals or starts with a canonical name without being an exact canonical `h2`.
    - The exact canonical text at another level is `E_HEADING_LEVEL`, for example `#### Locked Decisions`.
    - Every other near-match is `E_HEADING_TEXT`, for example `Locked decisions` or `Locked Decisions extra`.
  - At most one `h1` is allowed, and only as the first heading.
  - The canonical sections are `h2` headings named exactly `Locked Decisions`, `Definition of Done` and `CI Commands` (each appearing exactly once, otherwise `E_SECTION_MISSING` or `E_SECTION_DUPLICATE`), plus at least one `Phase <digits>: <text>`.
  - A canonical section runs from its heading to the next `h1`/`h2`.
- **Raw HTML.** Any `html_block` or `html_inline` token anywhere fails closed.
- **Citations.** `[claim:id]` and `[judgment:id]` are collected only from `text` children of `inline` tokens inside canonical sections. Text inside links, `code_inline`, `fence`, `code_block` and HTML never counts. A citation-shaped string in an ineligible position therefore cannot satisfy a record.
- **Citation pattern (A2).**
  - In eligible text, a citation is exactly `[claim:<id>]` or `[judgment:<id>]`, lowercase, with `<id>` matching `[a-z0-9][a-z0-9-]{0,48}`.
  - An eligible text fragment that matches `\[(claim|judgment):` case-insensitively but is not a well-formed lowercase citation fails with `E_CITATION_DANGLING`.
- **Citation look-alike links.** Two cases fail closed (`E_LINK_CITATION`):
  - a link whose joined text children, trimmed, match `(claim|judgment):[A-Za-z0-9-]*` case-insensitively;
  - a link reference definition whose label matches `(CLAIM|JUDGMENT):` case-insensitively. markdown-it stores these labels upper-case normalized in `env["references"]`, which is why the match ignores case.
- **Citation rules.**
  - Every claim and judgment is cited exactly once in eligible canonical prose.
  - Every citation resolves to a record.
  - Eligible citations outside canonical sections fail.
- **Error reporting.** Errors name the rule and the source line from the parser token `map`. They never echo hidden content. Ordering, precedence and output bounds are defined in section 7.

## 7. Report and exit status

```text
plan: docs/plan-qor-phase18-example.md
document structure: VALIDATED by markdown-it-py 4.2.0 (CommonMark)
mechanical status: VERIFIED 3 of 3 declared claims
judgments awaiting human auditor: 1
free-form prose completeness: NOT MECHANICALLY ASSERTED (independent /qor-audit Step 3)
governance/remediation closure: NOT DETERMINED BY THIS GATE
```

| Exit | Meaning |
| --- | --- |
| 0 | Every gated plan has valid structure and every claim `VERIFIED`. In the gate, untouched plans are listed as `UNCHANGED (not evaluated)`. With no governed change, the result is `not applicable`. |
| 1 | Any applicability, structural, schema, citation or claim failure, including truncated output |
| 2 | Invalid invocation or an unresolvable revision |

Output is written with `errors="backslashreplace"`.

**Reason codes:**

| Group | Codes |
| --- | --- |
| Input encoding and size | `E_SIZE`, `E_ENCODING`, `E_CONTROL` (BOM, NUL, C0, bare CR, U+2028/2029) |
| Applicability | `E_PLAN_NAME`, `E_INVENTORY_MISSING`, `E_INVENTORY_DELETED`, `E_GOVERNED_DELETION` |
| Legacy and HTML | `E_LEGACY_MANIFEST`, `E_HTML` |
| Headings and sections | `E_NESTED_HEADING`, `E_HEADING_TEXT`, `E_HEADING_LEVEL`, `E_HEADING_ORDER`, `E_SECTION_MISSING`, `E_SECTION_DUPLICATE` |
| Parser limits | `E_NESTING`, `E_PARSE_TIME` |
| Citations | `E_LINK_CITATION`, `E_CITATION_MISSING`, `E_CITATION_DANGLING`, `E_CITATION_DUPLICATE`, `E_CITATION_OUTSIDE` |
| Inventory | `E_SCHEMA`, `E_KIND_UNSUPPORTED`, `E_REF`, `E_PATH`, `E_OBJECT`, `E_ANCESTRY` |
| Evaluation | `E_CLAIM_FAILED`, `E_INVOCATION` |

**Precedence (A3).** Each gated plan is evaluated in fixed stages:

1. applicability and name;
2. bytes: size, UTF-8 and control characters;
3. legacy manifest;
4. parse, including nesting, bracket runs and time;
5. raw HTML;
6. headings, checked in the order nested, text, level, order, then missing or duplicate section;
7. inventory schema and kinds;
8. citations;
9. references, objects and ancestry;
10. claim evaluation.

The first stage that produces errors ends evaluation of that plan. All of that stage's errors are reported, in source order. A fixture's "expected code" is the code of its first reported error. Plans are processed in byte order of their paths.

**Bounded output (R5).**

- A run reports at most 50 errors in total.
- Each message is truncated to 300 characters, with the marker `[...]`.
- Total output is capped at 64 KiB.
- Once a cap is reached, collection stops and the gate prints exactly one line: `TRUNCATED: <n> further errors not shown`.
- Truncation always exits 1. It can never turn a failing run into success.
- With the stage order fixed and errors sorted, the same input always produces byte-identical output.

## 8. Required-check architecture and bootstrap

- **`plan-evidence-gate`** (`pull_request_target`) runs on every PR, with no path filter.
  - It checks out the base SHA with a SHA-pinned `actions/checkout`, `fetch-depth: 0` (full history, A1) and `persist-credentials: false`.
  - It creates an isolated venv (`python3 -m venv "$RUNNER_TEMP/plan-evidence"`; ubuntu-24.04's system Python is PEP 668 externally managed). From the base checkout's requirements file, it installs the hash-pinned parser with `pip install --require-hashes --no-deps --only-binary=:all: -r governance/requirements-plan-evidence.txt`.
  - Any venv, install or network failure exits non-zero for **every** PR, including unrelated ones. There is no nominal success; this availability trade-off is accepted and documented.
  - The job has `timeout-minutes: 5`.
  - It fetches `refs/pull/N/head` with full history, as objects only, and runs the base copy of `scripts/plan_evidence_gate.py`.
  - If the merge base or any cited commit cannot be resolved, the run fails with `E_REF` or `E_ANCESTRY` and exits non-zero. A shallow clone can never cause a skip.
  - It has `contents: read`, no secrets, and SHAs reach the shell only through env vars.
- **Outcomes.**
  - When no governed path changed, the gate exits 0 with an explicit `not applicable`.
  - Governed paths are: `docs/plan-qor-phase*.md`, `docs/plan-qor-phase*.evidence.json`, `scripts/plan_evidence_*.py`, `tests/test_plan_evidence_*.py`, `tests/plan_evidence_fixture.py`, `governance/requirements-plan-evidence.txt`, `.github/workflows/*` and `.github/CODEOWNERS`.
  - When a governed path changed, the section 3 applicability table decides which plans are evaluated.
    - Gated plans are fully evaluated.
    - Deletions fail.
    - Untouched plans are listed as `UNCHANGED (not evaluated)`.
  - A governed change that leaves every plan untouched (for example a gate-code change, which still needs code-owner review) can therefore succeed, and so can a change that adds a conforming plan with its inventory. So "a valid governed PR shows success" is reachable without any exemption controlled by the head.
  - Workflow name spoofing is detected on a best-effort basis only. The real control is code-owner review on `.github/workflows/` (D1).
- **`plan-evidence-selftest`** (`pull_request`, unprivileged, path-filtered) runs the PR head's own suites. It is informational and must never be the required check.
- **Bootstrap.** `pull_request_target` runs only workflows already on the base branch. The PR that introduces the gate therefore cannot be gated by it, and branch-local or self-test runs do not prove enforcement. Enforcement exists only after:
  1. the gate reaches the base branch through an operator-approved route (not decided by this plan);
  2. an unrelated PR shows a completed `not applicable` success;
  3. a valid governed PR shows a completed success;
  4. an invalid governed PR shows a failure;
  5. D1 is configured.

## 9. Dependency admission (proposed for audit)

| Package | Version | Wheel SHA-256 | License | Notes |
| --- | --- | --- | --- | --- |
| markdown-it-py | 4.2.0 | `9f7ebbcd14fe59494226453aed97c1070d83f8d24b6fc3a3bcf9a38092641c4a` | MIT | Pure Python, `requires-python >=3.10`, sole runtime dependency `mdurl`; PyPI lists no known vulnerabilities (checked 2026-10-12) |
| mdurl | 0.1.2 | `84008a41e51615a49fc9966191ff91509e3c40b939176e643fd50a5c2196b8f8` | MIT | Pure Python; no known vulnerabilities |

**Provenance (from audit #110):**

- PyPI publishes no PEP 740 attestations for these releases.
- The installed code is byte-identical to the upstream git tags `v4.2.0` (markdown-it-py) and `0.1.2` (mdurl).
- The wheel RECORD hashes re-verify.
- OSV and PyPI list no vulnerabilities. CVE-2023-26302 and CVE-2023-26303 were fixed in 2.2.0.

**Decision:** ADMITTED by independent audit #110.

**Why it is needed:** CommonMark structure is the defect class behind VETOs #104, #106 and #108. A conformant, maintained parser replaces about 120 lines of homemade state machine.

**Alternatives rejected:**

| Alternative | Reason |
| --- | --- |
| `commonmark.py` | Unmaintained |
| `mistune` | Not CommonMark-strict |
| cmark through ctypes | Native code |
| Vendoring | Repository weight and an upgrade burden, with no provenance gain over hash-pinned wheels |

**Scope of the dependency:**

- It is a governance-tooling dependency only. It is not an application runtime dependency, and `package.json` is untouched.
- Installation is hash-locked, wheel-only and `--no-deps`.
- Each upgrade requires re-review.
- Offline local use: `pip download` the two wheels once, then `pip install --no-index --find-links`.

## 10. Migration and preservation

- The v2 modules `scripts/plan_claims_*.py`, their suites and `plan-claims*.yml` are removed on this branch and replaced by `scripts/plan_evidence_*.py`, `tests/test_plan_evidence_*.py` and `plan-evidence*.yml`. Git history keeps them.
- The canonical gate `.qor/gates/2026-10-10T0443-9d3df3/remediate.json`, Amendments 1–3, ledger entries #95–#108 and all reports are not modified. Its `closure_enforcer` still names the v2 suite. Only a separately authorized re-emit may point it at the v3 suite.
- The two Phase 16 events stay `addressed_pending: true`, `addressed: false`.
- The Phase 17 iteration-4 plan has no v3 inventory.
  - While it is byte-identical to the merge base and has no inventory change, the gate does not evaluate it and lists it as `UNCHANGED (not evaluated)`. It is never listed as passing.
  - Any PR that edits, renames, copies or deletes it is gated or rejected under section 3. With no inventory, that fails.
  - Iteration 5 is not authorized.
- Self-application: this phase's own plan carries a v3 inventory and must pass the v3 checker.
- No pull request or merge route is decided here (V1). The plan's `pr_target` is intentionally absent.

## 11. Test plan (written red-first)

**Converted reviewer corpus (V4).** Every judge-a2 probe (p00-p19, s2, s3) and every judge-a3 probe (n00-n22, b01-b08) is committed as a v3 fixture. Each fixture:

- keeps its Markdown payload;
- moves its v2 manifest content into a v3 inventory against the fixture repository;
- carries an expected outcome and reason code.

**Conversion procedure (R4).**

- **What is removed.** Exactly one region is removed: the v2 fence, from its opening line `json qor-plan-claims` to its closing backticks, together with that closing line's newline.
- **What is kept.** Every other byte stays, including every heading such as `## Plan Claims` and any text that follows the fence.
- **Moving the records.** The fence's claims and judgments become the v3 inventory, with these mappings:
  - `file-lines` with `max`/`equals` becomes `predicate`;
  - `commit` and `path` are rebound to the fixture repository;
  - a removed or held kind is kept as-is, so it yields `E_KIND_UNSUPPORTED`.
- **n19.** n19 tests that a tab-indented `## Locked Decisions` is an indented code block, not a heading. Scanner and renderer must agree, so the run succeeds and the code-block text is inert.
  - Its intent depends on the preceding `## Plan Claims` heading being kept. If that heading were removed, the line would become a list continuation and, in effect, a different probe.
  - Expected: PASS, with prose `NOT MECHANICALLY ASSERTED`.

**Reconciliation.** The corpus is 57 distinct probe files: 26 from judge-a2 and 31 from judge-a3.

- With this procedure and s3 corrected, an independent section 6 harness run on markdown-it-py 4.2.0 reproduces 57 of 57 expectations, with 0 mismatches.
- Audit #112 reported "58/60". Its two mismatches were s3 and n19. Its denominator does not match the number of probe files, so this spec counts files.

No probe may fail on `E_LEGACY_MANIFEST`. Expected outcomes:

| Expected outcome | Probes |
| --- | --- |
| `E_HTML` | n02, p03, p18 |
| `E_SECTION_DUPLICATE` | n03, p14 |
| `E_HEADING_TEXT` | n04, n05, n06, n07, n08, n09, n10, n12 |
| `E_CONTROL` | n11 (BOM), n18 (NUL), p05 (form feed), p05b (U+2028) |
| `E_NESTED_HEADING` | n15, n16 |
| `E_HEADING_LEVEL` | p15 |
| `E_KIND_UNSUPPORTED` | s3 (its only record is `function-lines`) |
| PASS, with `free-form prose completeness: NOT MECHANICALLY ASSERTED` | n00, n01, n13, n14, n17, n19, n20, n21, n22, p00, p01, p02, p04, p06, p06b, p07, p07b, p07c, p08, p09, p10, p11, p12, p13, p16, p17, p19, s2, b01-b08 |

The PASS rows are the honest limitation: prose such as "more than", "over" or "not N lines", or a second subject in a sentence, is not interpreted. Only the typed predicate is evaluated.

**Other fixtures:**

| Area | Fixtures | Expected |
| --- | --- | --- |
| Applicability, end to end through the base-revision gate (R1) | Head adds a phase-17 plan without an inventory | `E_INVENTORY_MISSING`, exit 1 |
| | Head edits the iteration-4-style plan | `E_INVENTORY_MISSING`, exit 1 |
| | Head renames a plan | `E_GOVERNED_DELETION` plus the added path gated, exit 1 |
| | Head copies a plan under a new name | The copy is gated, `E_INVENTORY_MISSING` |
| | Head deletes a plan | `E_GOVERNED_DELETION` |
| | Head deletes an inventory | `E_INVENTORY_DELETED` |
| | Head changes only an inventory | Its plan is gated |
| | Head adds `plan-qor-phase016-x.md`, `plan-qor-phase18.md` or `Plan-qor-phase18-x.md` under `docs/` | `E_PLAN_NAME` |
| | Head adds a low-phase plan with a valid inventory | Exit 0 |
| | Head rewrites the gate scripts and also adds a failing plan | Exit 1; the base code decides |
| | Untouched legacy plan plus an unrelated governed change | Exit 0, listed `UNCHANGED (not evaluated)` |
| | Unrelated change only | `not applicable` |
| CLI (R3) | No `--head`; `--head HEAD`, `--head main`, short SHA, uppercase SHA | Exit 2 |
| | Full SHA | Evaluates the named plans |
| Bounded output (R5) | A plan producing 10,000 citation errors | Exactly 50 errors plus one `TRUNCATED` line, exit 1, output at most 64 KiB, byte-identical across two runs |
| | A 5,000-character message | Truncated to 300 characters |
| | A truncated run | Never exits 0 |
| Advisories | Workflow structure includes `fetch-depth: 0` | (A1) |
| | Reference label `[CLAIM:x]: /u` and link text ` claim:x ` | `E_LINK_CITATION` (A2) |
| | `[Claim:x]` in eligible text | `E_CITATION_DANGLING` (A2) |
| | 21 consecutive `[` before a citation | `E_NESTING` (A4) |
| | Precedence fixture: a plan with both HTML and a duplicate section | First code `E_HTML` (A3) |
| Source probes | `function-lines` or `import-edge` records shaped like `for await (...) /re/`, `o.in / 2`, `declare function`, `satisfies` and `require("x" + y)` | `E_KIND_UNSUPPORTED`; no measurement is attempted |
| Parser limits | Content nested 25 deep, with HTML and text at the bottom | `E_NESTING` |
| | Pathological 128 KiB `![` input | Within the parse budget |
| | Over-cap plan | `E_SIZE` |
| Heading names | Entity in a heading (`Locked&#32;Decisions`); emphasis or code in a heading | `E_HEADING_TEXT` |
| Citation look-alikes | Link reference definition labelled `claim:x`; link text `[claim:x](u)` | `E_LINK_CITATION` |
| Schema | Unknown or held kinds; extra keys; duplicate IDs; duplicate JSON keys; v2 masquerading as v3; wrong `plan`; empty claims; oversize; deep or huge numbers; lone surrogate; judgment without owner; duplicate rationales | `E_SCHEMA` or `E_KIND_UNSUPPORTED` |
| Binding | Uncited record | `E_CITATION_MISSING` |
| | Citation used twice | `E_CITATION_DUPLICATE` |
| | Dangling citation | `E_CITATION_DANGLING` |
| | Citation in code, link or HTML | Not counted, so `E_CITATION_MISSING` |
| | Citation outside canonical sections | `E_CITATION_OUTSIDE` |
| | Record whose `commit`, `path`, `line`, `text` or `predicate` does not match the source | `E_CLAIM_FAILED` |
| CRLF | CRLF source with `line-equals`; `text-absent` containing LF | Correct result; LF is rejected by the schema |
| Reachability | Claim commit not an ancestor of the head | `E_ANCESTRY` |
| R3/R4 | Executable payload fields; hostile blob contents | Rejected; no execution |
| | Traversal, option-like, absolute and symlink paths | `E_PATH` or `E_OBJECT` |
| | HEAD, branch, tag, short and uppercase SHAs | `E_REF` |
| | Non-commit objects | `E_OBJECT` |
| | Caller `GIT_DIR` override | No effect |
| | Validation stage | Zero subprocesses before validation |
| | All runs | `.git` and worktree snapshot unchanged |
| Gate | Unrelated change | `not applicable`, exit 0 |
| | Valid governed change (with the legacy iteration-4 plan present) | Exit 0, legacy listed |
| | Invalid governed change | Exit 1 |
| | PR head rewriting the checker | Cannot self-certify |
| | Spoofed check-name workflow | Exit 1 |
| | Non-SHA input | Exit 2 |
| | Workflow structure | `pull_request_target`, no `paths`, venv, `--require-hashes`, `timeout-minutes`, env-only SHAs, `persist-credentials: false`, no secrets |
| End to end | The combined VETO #108 plan, converted to v3 | Outcomes exactly as listed in the corpus table |
| Razor | All gate modules and tests | At most 250 lines per file, at most 40 lines per function, nesting at most 3 (elif counts as 1), no nested ternary |

Tests run offline. Hosted Actions are reserved for one consolidated candidate.

## 12. Separate dependencies (unchanged, still blocking closure)

- **D1 (operator).** After the bootstrap evidence in §8:
  - require `plan-evidence-gate` (GitHub Actions app, integration 15368) in ruleset `Default Main`;
  - set `require_code_owner_review: true`;
  - resolve the single-owner identity problem.

  CODEOWNERS alone enforces nothing.
- **D2 (Qor-logic-plus, separately governed).** Wire a repository-provided preflight into the `/qor-plan` submission path and `/qor-audit` Step 0.3 (ABORT). Step 0.6 stays WARN-only. Qor-logic-plus #173 is closed as not planned, and #179 and #176 are closed unmerged (verified 2026-10-12). The `feature-test-undeclared` escalator defect is therefore still live in 3.8.0.
- **D3.** A separately governed trusted test-receipt harness, needed before any test-outcome kind.
- **Closure.** Requires a separately authorized re-emit of the canonical remediation, an independent `reviews-remediate` PASS, and D1 and D2 satisfied. A design PASS or an implementation PASS is not remediation closure.
