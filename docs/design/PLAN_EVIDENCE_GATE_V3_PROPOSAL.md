# Proposal: Plan evidence gate v3 after Phase 17 remediation VETOes

**Status:** proposed design on a separate, unmerged branch. **Not a new remediation amendment, ledger entry, Qor gate, accepted dependency, or implementation authorization.**  
**Owner:** [#267](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/267)  
**Incident:** [PR #232, Amendment 3 / independent VETO #108](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/232#issuecomment-6126858960)  
**Baseline examined:** PR #232 head `cb9b7b1bc0e27c96085be7c6da423369995d6fac`, compared with `main`  
**Decision:** Option A. Stop writing bespoke Markdown and TypeScript tokenizers.

## Problem and non-goal

Three consecutive remediation vetoes #104, #106 and #108 found fresh variants in the same lexical classes *after the preceding variants had all been fixed*. Adding one more tokenizer branch would not prove correctness. The v2 gate currently overclaims its ability to recognize arbitrary empirical prose and to measure JavaScript/TypeScript source. We can make the verified claim set precise without trying to solve general natural language.

The gate must **not** claim to detect all factual assertions anywhere in free-form prose. Even if every declared assertion is verified, an independent auditor must check whether the author omitted, contradicted, misrepresented, or misapplied relevant facts. Document syntax is a parser problem; source language semantics are a compiler/parser problem; human judgment remains an auditor problem.

## Authority boundary and unchanged invariants

1. **Never execute PR code.** Treat the PR head, plan, code and evidence inventory only as untrusted data. A protected base-ref gate uses trusted code and performs fixed read-only Git object operations over explicitly approved SHA-40 commit IDs and validated repository-relative paths. No PR-defined commands, `argv`, `setup`, execution, network fetches or interpolated shell.
2. **No mutable claims.** Reject `HEAD`, branches, tag names, short SHAs, symbolic ref expressions, symlinks, paths outside the repository, Git option/pathspec surprises, missing objects, non-UTF-8 where a text assertion is required, and excessive files/claim payloads.
3. **No false pass.** Report `VERIFIED` only for an individual successfully evaluated typed record. Report `NOT_CHECKED` for prose semantics, human judgments and unavailable trusted test receipts, rather than suggesting that the whole plan is proven.
4. **No self-approved closure.** Two Phase-16 events stay `addressed_pending=true`, `addressed=false`. Amendment 3 and ledger #107/#108 stand; no plan iteration 5, new amendment, shadow-event flip or provider implementation is authorized by this document.
5. **Preserve decision boundaries.** D1 ruleset/required-check owner action, D2 independently governed Qor-logic-plus `/qor-plan` + `/qor-audit` Step 0.3 binding, D3 future trusted test receipts, WWR publisher-terms HOLD and drafts #233/#238 remain separate.

## Proposed artifact contract

Use a **single external, schema-validated JSON evidence inventory** associated with a governed plan. Avoid embedding a second Markdown interpreter inside JSON fences. The plan declares an exact relative path to its inventory; the protected verifier reads both the plan and inventory at the immutable PR commit as **data**, and reads source files only at the fully resolved claim commit. The verifier never imports a Python/Node module from the PR head.

Candidate design (illustrative, *not* an accepted schema):

```json
{
  "schema_version": 3,
  "plan": "docs/plan-qor-phase17-provider-tranche.md",
  "claims": [
    {
      "id": "ipc-handler-size",
      "kind": "file-lines",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "path": "electron/src/core-ipc.cts",
      "predicate": { "operator": "at-most", "value": 200 },
      "purpose": "Existing module size for the refactor planning decision"
    }
  ],
  "judgments": [
    {
      "id": "source-value",
      "rationale": "Provider value requires independent user-story/coverage review",
      "review_required": true
    }
  ]
}
```

The SHA, path and claim are *examples only*; they are not facts about the repository. The schema must ban arbitrary extension properties; mandate normalized unique claim/judgment IDs and bounded counts/size; require full `commit` SHA-40; reject traversal, symlinks, source paths absent at that commit, duplicate IDs, unknown predicates, and evidence referring to a different plan. A v2 manifest cannot silently upgrade to v3.

**Claim kind policy for the first implementation:**

| v2 kind | v3 treatment | Reason |
| --- | --- | --- |
| `line-equals` | Candidate retain | Straight immutable line comparison; define newline/encoding/line counting precisely |
| `text-present`, `text-absent` | Candidate retain | Literal bytes or unambiguously decoded text only; no author-supplied regex |
| `file-lines` | Candidate retain | File line count can be defined exactly over immutable data; `at-most` / `equals` explicit |
| `function-lines` | **Remove** | Reliable JS/TS/CTS/MTS semantics require a real compiler AST, not another hand-rolled lexer |
| `import-edge` | Hold pending parser evidence | An expression like `require("x" + y)` cannot verify a literal import edge via string matching |
| `enum-values` | Hold pending parser evidence | TypeScript declarations and effective unions require real syntax-aware analysis |
| `test-outcome` | Mark `NOT_CHECKED` until D3 | A claim text is not a trusted test outcome receipt |

For v3 acceptance, either implement only the three conservative text/file forms or separately propose and authorize an AST-backed `import-edge`/`enum-values` extension with an independently vetted parser. Dropped claim kinds **fail** validation rather than returning a plausible measurement.

## Plan/reference grammar and CommonMark parsing

A plan's mechanically verifiable facts reside in the JSON evidence inventory. Free-form plan prose can refer to entries with `[claim:ipc-handler-size]` (or `[judgment:source-value]`) but does not cause an empirical assertion to be mechanically proven merely because it contains a recognizable phrase. A declaration in canonical sections can require specific evidence IDs by explicit plan schema, but **no arbitrary-prose “completeness verified” assertion** is permitted.

Parse Markdown to a CommonMark syntax tree with source locations using a maintained, audited parser pinned to exact distributable bytes. Candidate Python dependency: `markdown-it-py` with its required transitive packages, versions and wheel/sdist hashes. This is **not yet dependency admission**; pin/lock, supply-chain provenance, licensing, vulnerability and offline-availability review must be separately accepted. A fully vendored parser also requires pinned source SHA/license and maintained upgrade procedure. Execute parsing library **only from the protected base**, with bounded time/memory/file input.

AST rules:

- Canonical headings must be real **top-level** headings with exact visible text/code points. A heading inside a list or blockquote does not silently count as a top-level section.
- Accept actual CommonMark fences, nested blocks and multiline code spans *as parsed*; reference tokens inside code/fences are inert, not counted.
- A BOM is handled according to a defined UTF-8 decoding policy; duplicate or visually confusable required headings must fail as missing/ambiguous rather than substituting a visually similar string. Reject invisible controls in canonical heading names instead of normalizing potentially hostile lookalikes into trusted names.
- Collect exact evidence references only from eligible prose text nodes (not raw HTML, comments, fenced/inline code or generated DOM). Reject unknown/dangling/duplicate references and evidence rows that are never cited where references are required.
- Do not infer mathematical predicates from words such as “over”, “not”, “at most” or second operands in one sentence. The typed predicate is authoritative. The auditor checks surrounding prose for contradiction.
- Failing structural checks should say **which** section/reference/line is invalid without exposing private source content or a token.

**Claim completeness distinction:**

```text
mechanical status: VERIFIED 3 of 3 declared supported claims
unverified kinds: 0
judgments awaiting human auditor: 1
free-form prose completeness: NOT MECHANICALLY ASSERTED
document structure: VALIDATED by pinned CommonMark AST
governance/remediation closure: BLOCKED (independent review + D1/D2)
```

An omitted factual assertion in prose is **not magically detected**. Independent `/qor-audit` Step 3 must examine prose/context/source against declared records. Do not write a self-test claiming complete semantic prose recognition.

## Trustworthy workflow and bootstrapping

The proposed PR #232 workflow is `pull_request_target` and checks out protected base; the PR head is fetched only as data. This is the right **security direction** but is not sufficient authorization for D1.

**Bootstrap ordering matters:** a protected-base workflow/checker first has to be available and reviewed on the protected base branch, because a `pull_request_target` workflow *only executes when its workflow exists on the base*. Do not infer that a successful branch-local test of workflow content proves its protected-base enforcement for the very PR introducing it. A separate, audited initial rollout and a neutral/manual inspection phase may be required; operator controls main/ruleset approval.

After that bootstrap, test an unrelated PR to verify the required job always reports truthful `not applicable`. Check for same-name-status spoofing under actual GitHub ruleset/source binding; the existing checker treats spoof detection as best-effort. CODEOWNERS contents alone are not an effective review requirement. D1 cannot precede verified always-reporting and real owner/ruleset enforcement.

D2 requires a **separately governed** Qor-logic-plus release that aborts in the actual `/qor-plan` submission path and `/qor-audit` Step 0.3. Keep Step 0.6 WARN-only. Qor-logic-plus PR #179 was checked as **closed and unmerged** at design time, so issue #173's closed state is not evidence that the fix is in the runtime.

## Adversarial fixtures and verification

The test corpus must include *all* Amendment 3 reviewer probes as unchanged input fixtures, including fenced/backtick, nested heading, BOM, Unicode confusables, multiline code span, line-count phrase/operator drift, two subjects in a clause, TS `for await` / regex/division, `declare function`, `satisfies`, and computed `require()`. These fixtures **prove the redesign no longer misclassifies them**; they must not become another set of lexical regex patches.

Also challenge:
- wrong, truncated, symbolic or mismatched revisions; symlink and path traversal;
- a manifest with one irrelevant factual record; repeated IDs; unknown kinds; stale v2 payload;
- PR-origin `setup`, `argv`, script and workflow injection; source executable that would write a sentinel if run;
- a plan that cites an unrelated record, or uses code/fences to fake citation fulfillment;
- invalid CommonMark/structure and nested headings; denied dependency/parse/unavailable trusted tests;
- tampering with the gate/checker/tests in a PR head; independent base ref stays authoritative;
- governed and unrelated PRs, ensuring the required status job always terminates without triggering the full Electron/PWA matrix.

Validate offline on a local checkout first. Reserve hosted Actions for one fully reviewed candidate, rather than each test-fixture revision.

## Scoped gate decisions, sequence and stop conditions

1. **Design only (current permission):** freeze Amendment 3 evidence, define v3 schema and CommonMark parser choice, enumerate migrations, confirm trust boundaries, establish corpus, seek independent design review. Do not mutate existing `.qor` gates/ledger/shadows.
2. **Implementation requires separate scoped approval:** in a new branch, introduce v3 evidence/checker/parser dependencies as a coherent replacement. Do not overwrite `main` or mutate the vetoed PR #232 to make the old gate look passed.
3. **Independent remediation review:** only if the actual Qor runtime proposal and evidence are separately authorized, re-emit a newly versioned canonical remediation artifact under legitimate protocol and obtain `/qor-audit reviews-remediate` PASS. Preserve earlier amendments and VETOes.
4. **D1/D2 still mandatory:** require actual verified GitHub branch/ruleset check and independently governed Qor-logic-plus binding. No automated `addressed` event closure without both.
5. **Then**, subject to review, reconsider Phase 17 iteration 5 and the held provider tranche independently. No provider code or releases are authorized in this design issue.

**Design acceptance:** an independent reviewer can understand exactly which empirical claims are mechanically proved, which are merely asserted, which are left to human audit, and why hostile PR material cannot execute or certify itself. An unsupported claim must fail or remain explicitly unverified, never quietly turn green.
