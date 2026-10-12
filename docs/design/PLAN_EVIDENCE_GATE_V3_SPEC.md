# Specification: plan evidence gate v3

**Status:** refined specification for independent design audit (#267). It refines `PLAN_EVIDENCE_GATE_V3_PROPOSAL.md` and does not replace it. Neither document is a remediation amendment, closes an event, or authorizes D1 or D2.
**Branch:** `impl/267-plan-evidence-gate-v3`. This is a new branch: it starts from PR #232 head `cb9b7b1bc0e27c96085be7c6da423369995d6fac`, with the proposal commit cherry-picked on top. Basing it on that head keeps the remediation session and ledger chain continuous. PR #232's own branch is not modified.
**Operator decision:** Option A, the structural redesign. No Amendment 4 and no Phase 17 plan iteration 5.

## 1. What v3 claims, and what it does not

v3 mechanically proves exactly two things:

1. **Declared evidence.** Every record in a plan's typed evidence inventory is evaluated against immutable git objects. Each record is reported as `VERIFIED` or `FAILED`.
2. **Document structure and citations.** A pinned CommonMark parser confirms that the plan's canonical sections are real top-level sections. It also confirms that every inventory record is cited exactly once from eligible prose in those sections, and that every citation resolves.

v3 does **not** claim to find empirical assertions in free-form prose, and does not judge whether prose matches its citations. It also does not measure functions, import graphs or type unions, and does not judge test outcomes. The report says this every time: `free-form prose completeness: NOT MECHANICALLY ASSERTED`. The independent `/qor-audit` Step 3 auditor remains responsible for omitted, contradictory or misleading prose and for every judgment record.

## 2. Unchanged invariants (R3/R4)

- **No execution of PR material.** PR content (plan, inventory, code, tests, workflows) is data only. The verifier code, its parser dependency and its workflow come from the protected base revision.
- **Fixed, read-only git calls.** Git is invoked only as `cat-file -t|-s|blob`, `ls-tree -z`, `merge-base` and `diff --name-only -z`. Arguments are list-form, there is no shell, the environment is scrubbed, `GIT_OPTIONAL_LOCKS=0` is set, and there is no checkout or worktree.
- **Immutable references.** Commits are full 40-character lowercase SHAs that resolve to commit objects. `HEAD`, branches, tags, short SHAs and expressions are rejected before any git call.
- **Validated paths.** A path is repository-relative. Each `/`-separated segment matches `[A-Za-z0-9_.][A-Za-z0-9_.-]*` and is not `.` or `..`. The object must be a blob with mode `100644` or `100755`, so symlinks and gitlinks are rejected.
- **No nominal success.** Anything that cannot be evaluated exits non-zero. There is no "warning and pass".

## 3. Artifact layout

- A governed plan is `docs/plan-qor-phaseNN-slug.md`. `NN` has no leading zero; a name with a leading zero is rejected, not grandfathered. Plans with NN >= 17 are gated.
- Its inventory is the sibling file `docs/plan-qor-phaseNN-slug.evidence.json`. The path is derived from the plan path, never declared inside the plan, so there is nothing to spoof.
- A plan that still contains a v2 embedded `json qor-plan-claims` fence is rejected with a migration message. An inventory with `version` instead of `schema_version`, or with `schema_version` other than 3, is rejected. There is no silent reinterpretation.

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
| `text-absent` | `text` | `text` is not a substring |
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
| Plan file | ≤ 256 KiB |
| Inventory file | ≤ 64 KiB |
| Claims | ≤ 200 |
| Judgments | ≤ 50 |
| Source blob per claim | ≤ 2 MiB (checked with `cat-file -s` before reading) |

JSON is parsed with duplicate-key rejection, and integers are limited to 1–9 digits. Any violation fails closed with a coded error.

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

The text is then parsed with `MarkdownIt("commonmark")` from `markdown-it-py`. The parser runs from the trusted base install.

- **Headings.**
  - Every `heading_open` token must have nesting `level == 0`. A heading inside a list or blockquote fails closed.
  - Every heading's inline text must be printable ASCII with no double spaces, so NBSP, zero-width and confusable letters fail.
  - At most one `h1` is allowed, and only as the first heading.
  - The canonical sections are `h2` headings named exactly `Locked Decisions`, `Definition of Done` and `CI Commands` (each appearing exactly once), plus at least one `Phase <digits>: <text>`.
  - A canonical section runs from its heading to the next `h1`/`h2`.
- **Raw HTML.** Any `html_block` or `html_inline` token anywhere fails closed.
- **Citations.** `[claim:id]` and `[judgment:id]` are collected only from `text` children of `inline` tokens inside canonical sections. Text inside links, `code_inline`, `fence`, `code_block` and HTML never counts. A link whose text or reference label matches the citation pattern fails closed. A citation-shaped string in an ineligible position therefore cannot satisfy a record.
- **Citation rules.**
  - Every claim and judgment is cited exactly once in eligible canonical prose.
  - Every citation resolves to a record.
  - Eligible citations outside canonical sections fail.
- **Error reporting.** Errors name the rule and the source line from the parser token `map`. They never echo hidden content.

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
| 0 | Structure valid and every claim `VERIFIED` |
| 1 | Any structural, schema, citation or claim failure |
| 2 | Invalid invocation or an unresolvable revision |

Output is written with `errors="backslashreplace"`.

## 8. Required-check architecture and bootstrap

- **`plan-evidence-gate`** (`pull_request_target`) runs on every PR, with no path filter.
  - It checks out the base SHA with a SHA-pinned `actions/checkout` and `persist-credentials: false`.
  - It installs the hash-pinned parser with `pip install --require-hashes --no-deps --only-binary=:all: -r governance/requirements-plan-evidence.txt`.
  - It fetches `refs/pull/N/head` as objects only and runs the base copy of `scripts/plan_evidence_gate.py`.
  - It has `contents: read`, no secrets, and SHAs reach the shell only through env vars.
- **Outcomes.**
  - When no governed path changed, the gate exits 0 with an explicit `not applicable`.
  - Governed paths are: `docs/plan-qor-phase*.md`, `docs/plan-qor-phase*.evidence.json`, `scripts/plan_evidence_*.py`, `tests/test_plan_evidence_*.py`, `tests/plan_evidence_fixture.py`, `governance/requirements-plan-evidence.txt`, `.github/workflows/*` and `.github/CODEOWNERS`.
  - When a governed path changed, every gated plan at the head is verified.
  - Workflow name spoofing is detected on a best-effort basis only. The real control is code-owner review on `.github/workflows/` (D1).
- **`plan-evidence-selftest`** (`pull_request`, unprivileged, path-filtered) runs the PR head's own suites. It is informational and must never be the required check.
- **Bootstrap.** `pull_request_target` runs only workflows already on the base branch. The PR that introduces the gate therefore cannot be gated by it, and branch-local or self-test runs do not prove enforcement. Enforcement exists only after:
  1. the gate is merged by an operator-approved process;
  2. an unrelated PR shows a completed `not applicable` success;
  3. an invalid governed PR shows a failure;
  4. D1 is configured.

## 9. Dependency admission (proposed for audit)

| Package | Version | Wheel SHA-256 | License | Notes |
| --- | --- | --- | --- | --- |
| markdown-it-py | 4.2.0 | `9f7ebbcd14fe59494226453aed97c1070d83f8d24b6fc3a3bcf9a38092641c4a` | MIT | Pure Python, `requires-python >=3.10`, sole runtime dependency `mdurl`; PyPI lists no known vulnerabilities (checked 2026-10-12) |
| mdurl | 0.1.2 | `84008a41e51615a49fc9966191ff91509e3c40b939176e643fd50a5c2196b8f8` | MIT | Pure Python; no known vulnerabilities |

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
- The Phase 17 iteration-4 plan has no v3 inventory, so it fails the v3 gate. That is truthful and expected. Iteration 5 is not authorized.
- Self-application: this phase's own plan carries a v3 inventory and must pass the v3 checker.

## 11. Test plan (written red-first)

| Area | Fixtures | Expected |
| --- | --- | --- |
| Amendment 3 Markdown probes | Escaped backtick plus `<h2>`; backtick in fence info string; heading in blockquote; heading in list; NBSP, ZWSP, Cyrillic and double-space headings; BOM; multi-line code span hiding a citation; HTML comment and `<pre>`; four-backtick and tilde fences | Structural FAIL or citation not counted, decided by parser tokens with no lexical special case |
| Amendment 3 predicate probes | "more than / not N lines"; two subjects in one sentence | Prose is not interpreted. Only the typed predicate is evaluated; the report keeps `NOT MECHANICALLY ASSERTED` and the auditor owns the prose |
| Amendment 3 source probes | `for await (…) /re/`, `o.in / 2`, `declare function`, `satisfies`, `require("x" + y)` | Any `function-lines` or `import-edge` record is rejected as unsupported, so no measurement is attempted |
| Schema | Unknown or held kinds; extra keys; duplicate IDs; duplicate JSON keys; v2 masquerading as v3; wrong `plan`; empty claims; oversize; deep or huge numbers; judgment without owner; duplicate rationales | FAIL, with a coded error |
| Binding | Uncited record; citation used twice; dangling citation; citation in code, link, HTML or a non-canonical section; a record whose `commit`, `path`, `line`, `text` or `predicate` does not match the source | FAIL |
| R3/R4 | Executable payload fields; hostile blob contents; traversal, option-like, absolute and symlink paths; HEAD, branch, tag, short and uppercase SHAs; non-commit objects; a caller `GIT_DIR` override; zero subprocesses before validation; `.git` and worktree snapshot unchanged | FAIL with no execution and no writes |
| Gate | Unrelated change → `not applicable`, exit 0; valid governed → 0; invalid → 1; PR head that rewrites the checker cannot self-certify; spoofed check-name workflow → 1; non-SHA → 2 | As stated |
| Honest limitation | A plan with fact-like uncited prose and valid inventory | Exit 0, and the report states `NOT MECHANICALLY ASSERTED` |
| Razor | All gate modules and tests | ≤ 250 lines per file, ≤ 40 lines per function, nesting ≤ 3 (elif = 1), no nested ternary |

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
