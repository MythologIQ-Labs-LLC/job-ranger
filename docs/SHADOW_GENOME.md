# Shadow Genome

This document records failure patterns to prevent repetition.

---

## Failure Entry #1

**Date**: 2026-03-17T00:00:00Z
**Verdict ID**: Entry #2 (GATE TRIBUNAL)
**Failure Mode**: COMPLEXITY_VIOLATION + ORPHAN

### What Failed

Pre-implementation audit of Job Ranger scraper enhancement blueprint. The blueprint itself was sound, but the existing codebase contained violations that would be compounded by new implementation.

### Why It Failed

**Complexity Violations (5 files)**:
- `scrapers.cts` at 589 lines grew organically as adapters were added
- `main.cts` at 558 lines accumulated IPC handlers without extraction
- `AppContext.tsx` at 340 lines combined all state management
- `Companies.tsx` and `Filters.tsx` embedded forms within page components

**Nested Ternaries (3 instances)**:
- Used for conditional class names and template strings
- Appeared clever but violated readability standards

**Orphan Files (4 files)**:
- `useApi.ts`, `useForm.ts`, `animations.ts`, `constants/index.ts`
- Created speculatively but never integrated
- Dead code contributing to cognitive overhead

### Pattern to Avoid

1. **Speculative Abstraction**: Creating utility files before they're needed leads to orphans
2. **Monolithic Growth**: Files that start small can grow beyond limits without active splitting
3. **Clever Ternaries**: Nested ternaries feel concise but fail readability standards
4. **Form-in-Page Anti-Pattern**: Embedding complex forms in page components inflates file size

### Remediation Attempted

Phases 1-4 completed:
1. [x] Delete orphan files - DONE (useApi.ts, useForm.ts, animations.ts, constants/index.ts removed)
2. [x] Split backend files - DONE (validators.cts, browser-loader.cts, adapters/ created)
3. [x] Split frontend context - DONE (useCompanyActions.ts, useFilterActions.ts extracted)
4. [x] Replace nested ternaries - PARTIAL (Modal.tsx, Dashboard.tsx fixed; Companies.tsx missed)
5. [ ] Extract form components - NOT STARTED (Phase 5 was not requested)

---

## Failure Entry #2

**Date**: 2026-03-17T01:00:00Z
**Verdict ID**: Entry #3 (GATE TRIBUNAL Post-Remediation)
**Failure Mode**: INCOMPLETE_REMEDIATION

### What Failed

Re-audit after partial remediation. While 8 of 12 violations were addressed, 4 remain.

### Why It Failed

**Incomplete Scanning**: The nested ternary at Companies.tsx:109-116 was not detected during Phase 2 remediation. It used the same pattern as the fixed violations but was overlooked.

**Phase Scope Limitation**: Phases 1-4 addressed backend splitting and context extraction but did not include Phase 5 (form extraction), which was needed to bring Companies.tsx and Filters.tsx under the 250-line limit.

**Insufficient Backend Split**: scrapers.cts was reduced from 589 to 345 lines but still exceeds limit. The extraction functions (`extractJsonLdJobs`, `extractAnchorJobs`) should have been moved to a separate file.

### Pattern to Avoid

1. **Manual Ternary Scanning**: Grep for the pattern `\? .* \? .* :` but also visually inspect multi-line ternaries that span lines
2. **Incomplete Phase Execution**: When remediation requires multiple phases, estimate which phases are minimally required to clear the gate
3. **Target Overshoot**: When splitting files, aim for 200 lines (80% of limit) to allow for growth

### Remediation Required

1. Fix Companies.tsx:109-116 nested ternary with lookup object
2. Extract CompanyForm.tsx from Companies.tsx
3. Extract FilterForm.tsx from Filters.tsx
4. Extract extractors.cts from scrapers.cts

---

## Failure Entry #3

**Date**: 2026-03-18T00:00:00Z
**Verdict ID**: Entry #8 (GATE TRIBUNAL Phase 1 Verification)
**Failure Mode**: COMPLEXITY_VIOLATION

### What Failed

Phase 1 Browser Automation implementation. The `loadPageHtmlWithOptions` function in `browser-loader.cts` grew to 63 lines during implementation, exceeding the 40-line function limit.

### Why It Failed

**Promise-Based Async Pattern**: The function wraps complex async logic in a Promise executor, which requires:
- Window creation and configuration
- Multiple event handler registrations (`will-navigate`, `did-fail-load`, `did-finish-load`)
- Timeout management
- Cleanup via `finalize()` helper
- Post-load processing (wait for selectors, scroll, extract HTML)

This pattern naturally accumulates lines because all concerns are interleaved in a single function.

**Incremental Growth Blindspot**: The function was at 42 lines before Phase 1, received 21 new lines for smart waits and scroll handling. The violation was introduced during feature addition without splitting.

### Pattern to Avoid

1. **Promise Executor Bloat**: When using `new Promise()` with complex logic, extract the executor body to a named async function
2. **Event Handler Grouping**: Extract event handler setup into a dedicated helper function
3. **Pre-Commit Line Check**: Before claiming implementation complete, verify ALL functions <= 40 lines
4. **Growth Budget**: When adding to existing functions, check if the addition exceeds remaining budget

### Remediation Required

1. Extract post-load processing into `extractHtmlAfterLoad(webContents, options): Promise<string>`
2. Extract event wiring into `setupBrowserWindowEvents(window, handlers): void`
3. Keep `loadPageHtmlWithOptions` as orchestration only (< 25 lines)

---

## Failure Entry #4

**Date**: 2026-03-18T01:00:00Z
**Verdict ID**: Entry #9 (GATE TRIBUNAL V1 Remediation Plan Audit)
**Failure Mode**: PLAN_ARITHMETIC_ERROR

### What Failed

Remediation plan for `loadPageHtmlWithOptions` (plan-v1-remediation.md) contained incorrect line count estimate.

### Why It Failed

**Optimistic Approximation**: The plan claimed the refactored function would be "~40 lines" without doing precise arithmetic:
- Current function: 63 lines
- Lines removed (117-137): 21 lines
- Lines added (new handler): 6 lines
- Actual result: 63 - 21 + 6 = **48 lines**

The "~40" estimate was off by 8 lines (20% error), which is significant when the limit is exactly 40.

**Insufficient Extraction**: The plan correctly identified `extractHtmlAfterLoad` as extractable (16 lines), but failed to account for the remaining overhead in the orchestrator function.

### Pattern to Avoid

1. **Do the Math**: Never use "~" approximations for line counts. Calculate exactly: `current - removed + added`
2. **Buffer for Safety**: When planning refactors, target 80% of limit (32 lines) not 100% (40 lines)
3. **Verify Before Submitting**: Count the lines in the proposed code blocks and verify they add up

### Remediation Required

Revise plan to extract additional logic:
1. Move `finalize` helper to module scope (saves ~9 lines from function body)
2. OR extract event handler setup into helper function
3. Target: ≤35 lines for `loadPageHtmlWithOptions` (not "~40")

---

## Failure Entry #5

**Date**: 2026-03-18T16:00:00Z
**Verdict ID**: Entry #24 (GATE TRIBUNAL Phase 5 Plan)
**Failure Mode**: COMPLEXITY_VIOLATION + MISSING_MIGRATION + INCOMPLETE_PLAN

### What Failed

Phase 5 (Notifications & System Tray) plan submitted with:
1. Pre-existing codebase violation (validators.cts exceeds 250 lines)
2. Projected violation (main.cts would exceed 250 lines after additions)
3. Missing database migration for new Settings fields
4. Unresolved open questions (architectural decisions deferred)

### Why It Failed

**Accumulated Technical Debt**: validators.cts grew to 264 lines during previous phases without being split. The Phase 4 remediation focused on the immediate violations but did not proactively address validators.cts, which was close to the limit.

**Plan-Time Blindspot**: The plan estimated main.cts changes (~40 lines for tray + notifications) without checking that main.cts is already at 217 lines. Simple arithmetic: 217 + 40 = 257 > 250.

**Migration Omission**: The plan adds 4 new boolean fields to Settings (notificationsEnabled, notifyOnNewJobs, notifyOnMatchedJobs, minimizeToTray) but does not specify how these persist. Phase 4 introduced migration v3 for circuit breaker; Phase 5 needs migration v4 for notification settings.

**Deferred Decisions**: The plan explicitly listed "Open Questions" at the top:
1. Notification grouping strategy
2. Tray icon badge behavior

These are implementation-affecting decisions that cannot remain open when submitting for audit.

### Pattern to Avoid

1. **Pre-Flight Size Check**: Before starting a plan, run `wc -l` on all files that will be modified. If any are >200 lines, plan includes remediation.

2. **Migration Accounting**: Any plan that adds fields to persisted interfaces MUST include migration specification. Checklist:
   - Is the interface persisted to SQLite?
   - If yes, add migration entry
   - If no, document why not needed

3. **No Open Questions in Plans**: A plan is not ready for audit if it contains unresolved architectural questions. Either:
   - Resolve them before submitting
   - Submit separate research request to explore options
   - Make a decision and document the rationale

4. **Arithmetic Verification**: When estimating post-change file sizes:
   - Current lines + added lines - removed lines = projected lines
   - If projected > 200, plan extraction to new module
   - If projected > 250, VETO is guaranteed

### Remediation Required

1. Pre-Phase 5: Split validators.cts into domain-specific modules OR extract settings validation
2. Plan revision: Create tray-notifications.cts module (~60 lines) to keep main.cts under limit
3. Add migration v4 to migrations.cts for notification/tray settings columns
4. Resolve open questions:
   - Notification grouping: Single notification per company scrape ("N new jobs at Company")
   - Tray badge: No badge (tooltip only) - defer badge complexity to future phase

---

## Failure Entry #6

**Date**: 2026-10-06T21:10:00Z
**Verdict ID**: Entry #28 (GATE TRIBUNAL Governance-Health Remediation)
**Failure Mode**: HALLUCINATION

### What Failed

First draft of the governance-health remediation (docs/BACKLOG.md, docs/FEATURE_INDEX.md, docs/GOVERNANCE_INDEX.md).

### Why It Failed

Status labels and coverage claims were inferred instead of read from evidence:
1. FX011 marked `verified` from a test of a sibling control (the Onboarding import).
2. FX019 marked untested although `tests/e2e/app.spec.ts` removes a source through the UI; BACKLOG B1 repeated the overstatement ("destructive deletes").
3. A template freshness marker ("every feature has a test") was kept although the index contradicts it.
4. Plan files were labelled "sealed" without SEAL entries in the ledger.
5. `plan-remediation.md` was labelled "superseded" without any ledger record.
6. `docs/planning/PLAN.md` and `docs/README.md` were left out of an index that claims to list every governance artifact.
7. Doctrine paths were cited as if they lived in this repo.

### Pattern to Avoid

Every status word in a governance index (verified, sealed, superseded, every-X-has-Y) must be traced to the specific test, ledger entry, or file that proves it. Absence of contrary evidence is not evidence. Template text inherited from `seed` must be re-checked against the actual artifact.

### Remediation Required

Amend the three files per AUDIT_REPORT iteration-1 findings 1-7 and resubmit to /qor-audit. Done; see Failure Entry #7 for the iteration-2 outcome.

---

## Failure Entry #7

**Date**: 2026-10-06T21:40:00Z
**Verdict ID**: Entry #29 (GATE TRIBUNAL Governance-Health Remediation, Iteration 2)
**Failure Mode**: HALLUCINATION + SPECIFICATION_DRIFT

### What Failed

Iteration-2 resubmission of the governance-health remediation.

### Why It Failed

The fixes for iteration 1 were scoped to the reported rows only, so neighbouring claims stayed unverified:
1. FX011 was corrected to `unverified` but dropped the web spec that does drive it, breaking the index's own convention.
2. BACKLOG B1 then claimed that control had no UI test at all.
3. BACKLOG B3 said per-row buttons lack accessible names; their names exist but are not unique per row.
4. Ledger Entry #28 used a different chain formula and layout from Entries #2-#27.
5. The ledger footer still declared "None - implementation complete" under an open VETO.
6. Failure Entry #6 was incomplete and off-format.
7. GOVERNANCE_INDEX did not list itself.

### Pattern to Avoid

When correcting an audit finding, re-verify every sibling claim that shares its evidence (same test, same control family, same ledger section), and match the surrounding file's existing conventions (formula, layout, footer) instead of a tool default.

### Remediation Required

Amend per iteration-2 findings 1-7 and resubmit to /qor-audit.

---

## Failure Entry #8

**Date**: 2026-10-07T04:50:00Z
**Verdict ID**: Entry #33 (GATE TRIBUNAL Phase 6 Windows Runtime Fixes)
**Failure Mode**: HALLUCINATION + INCOMPLETE_PLAN

### What Failed

Phase 6 plan for the Windows PWA adapter-resolution and upgrade-check CRLF fixes.

### Why It Failed

1. The new Windows CI job copied the PWA job's steps without checking which specs reach native dependencies; the portability specs need a sqlite3 binary that Windows runners do not have.
2. A resolver test case was written from memory of the adapter map (`node:crypto` unmapped) instead of from `src/pwa/adapter-map.ts`.
3. The fix re-implemented Vite's module-id format in a local helper and then tested the helper against itself, leaving casing and realpath divergence uncovered.

### Pattern to Avoid

When a bug comes from two code paths disagreeing about an identifier, make one path delegate to the other (here: let Vite's resolver produce the id) rather than imitating its format; and verify the invariant on the real artifact (the built bundle), not on a re-implementation. When cloning a CI job to a new OS, trace each test's native prerequisites.

### Remediation Required

Amend the plan per AUDIT_REPORT findings 1-3 and resubmit to /qor-audit.

---

## Failure Entry #9

**Date**: 2026-10-07T10:30:00Z
**Verdict ID**: Entry #38 (GATE TRIBUNAL Phase 8 PWA Reload Test Race)
**Failure Mode**: HALLUCINATION

### What Failed

Phase 8 plan for the PR #158 `pwa-windows` failure.

### Why It Failed

The plan named a root cause (event listener registered after the reload-triggering click) by pattern-matching the failing line, without a trace and without checking Playwright's navigation semantics. Its verification could only pass, because it repeated the test on a host where it had never failed.

### Pattern to Avoid

Do not diagnose a flaky test from the line it timed out on. Reproduce it (repeat runs until it fails), read the retained trace, and design a verification that fails on the unfixed code.

### Remediation Required

Reproduce, read the trace, amend the plan, and resubmit to /qor-audit.

---

## Failure Entry #10

**Date**: 2026-10-07T14:30:00Z
**Verdict ID**: Entry #47 (GATE TRIBUNAL Phase 9 Form-Control Shell Layer)
**Failure Mode**: SPECIFICATION_DRIFT

### What Failed

Phase 9 plan to fix icon/text overlap in form controls.

### Why It Failed

The plan moved an entire unlayered rule into a cascade layer to free one overridden utility (`pl-11`), and checked only the two pages where the bug was seen. Every other utility on those classes that the unlayered rule had been suppressing (`w-auto` on six selects, `py-3` on 19 textareas) would also have started applying, on screens the plan never looked at.

### Pattern to Avoid

When changing cascade precedence, enumerate every utility used alongside the affected class across the codebase and declare what changes; move only the declarations the fix needs.

### Remediation Required

Layer only the padding declaration, declare the padding utilities that newly apply, and resubmit to /qor-audit.

---

## Failure Entry #11

**Date**: 2026-10-07T15:10:00Z
**Verdict ID**: Entry #48 (GATE TRIBUNAL Phase 9 Form-Control Shell Layer, Iteration 2)
**Failure Mode**: SPECIFICATION_DRIFT

### What Failed

Iteration-2 amendment of the Phase 9 plan.

### Why It Failed

The design changed (whole rule -> padding only) but only the Locked Decision was rewritten; the Definition of Done and a supporting justification kept the old design's wording, so the plan contradicted itself.

### Pattern to Avoid

After changing a plan's design, re-read every section (Locked Decisions, Affected Files, tests, Definition of Done) for statements that describe the old design.

### Remediation Required

Amend D2 and LD3, re-read the whole plan, and resubmit to /qor-audit.

---

## Failure Entry #12

**Date**: 2026-10-07T18:40:00Z
**Verdict ID**: Entry #54 (GATE TRIBUNAL Phase 10 Public Demo Harness)
**Failure Mode**: INFRASTRUCTURE_MISMATCH

### What Failed

Phase 10 plan for the demo-recording harness.

### Why It Failed

A browser-launching test was wired into the unit scripts without checking which CI lanes run them and whether those lanes install a browser; and an acceptance threshold (video duration) was declared without saying how it is measured.

### Pattern to Avoid

Before adding a test to a shared script, list every workflow that runs the script and confirm each one provides the test's runtime prerequisites. Every acceptance threshold names its measurement method.

### Remediation Required

Move the extractor test to a demo-only script; define duration measurement; resubmit.

---

## Failure Entry #13

**Date**: 2026-10-07T22:30:00Z
**Verdict ID**: Entry #59 (GATE TRIBUNAL Phase 11 Public-Review README)
**Failure Mode**: HALLUCINATION

### What Failed

Phase 11 plan for the public-review README.

### Why It Failed

To justify leaving the old repository owner in attestation commands, the plan asserted that the v1.2.0 artifacts had been attested before the transfer. The repository's own CHANGELOG shows attestations start with v1.3.0. The inventory of old-owner references also searched only `docs/`, missing a build-config fallback.

### Pattern to Avoid

A reason given for not changing something is a factual claim and needs the same evidence as a reason for changing it. Inventory references across the whole repository, not only the directory the work is about.

### Remediation Required

Correct the attestation commands and the build-config fallback; resubmit.

---

## Failure Entry #14

**Date**: 2026-10-10T04:54:11Z
**Verdict ID**: Entry #96 (GATE TRIBUNAL Phase 17 Public Discovery Provider Tranche, Iteration 2)
**Failure Mode**: SPECIFICATION_DRIFT

### What Failed

Iteration-2 plan for the Himalayas provider (Phase 1), built on an exploratory candidate branch (e22d49b) that was written before any plan existed.

### Why It Failed

The plan described only its own deltas on top of the candidate. As a result:
- A new parsing rule silently broke candidate assertions that the plan said "must pass unchanged", including an E2E exact-text check.
- The plan claimed an E2E assertion that the test does not make.
- Affected Files omitted the candidate files that Phase 1 would actually ship.
- The declared `pr_target` (main) did not match the real PR base. The candidate was forked before main and conflicts with it.

The candidate also carried a Razor overage, and an unbounded response read, into the authorized scope. One live-data figure (164 countries) did not reproduce; the observed value was 149.

### Pattern to Avoid

When a plan adopts pre-existing candidate code, enumerate the full diff against `pr_target` as Affected Files. Re-read every candidate assertion against each new rule. Confirm the real PR base and merge cleanliness against the declared baseline. Re-measure every live figure from a saved capture before writing it into a Locked Decision.

### Remediation Required

Amend the plan per AUDIT_REPORT V1-V10 (with /qor-refactor for the Razor ground and /qor-debug for the A04 byte cap), then resubmit to an independent /qor-audit.

---

## Failure Entry #15

**Date**: 2026-10-10T05:09:35Z
**Verdict ID**: Entry #98 (GATE TRIBUNAL Phase 17 Public Discovery Provider Tranche, Iteration 3)
**Failure Mode**: SPECIFICATION_DRIFT

### What Failed

Iteration-3 plan for the Himalayas provider. It closed the iteration-2 findings V1-V8 and V10, but its new test and evidence contracts did not hold up against the candidate code.

### Why It Failed

- The plan required every new Phase 1 assertion to fail red before the source change, and D4 required the red output to name each one. Seven planned assertions already pass on the candidate, because the candidate is already stricter on those inputs. The "named assertion" red evidence against main is also impossible: the unit test fails with MODULE_NOT_FOUND.
- A CI command was described as covering the web Himalayas skip warning. No PWA test does.
- The time-zone rule cited a live maximum of 37 entries but set no list-length rule, and every planned test used 3 or fewer entries. The candidate's 12-entry cap could therefore survive with all tests green.
- The Phase 0 behaviour-preserving refactor relied on suites that never exercise the dedupe stage it restructures.

### Pattern to Avoid

Before you declare a red-first test, run it in your head against the code as it stands. A fail-closed assertion on code that already fails closed is a regression lock, not red evidence; label it that way. Every "this command covers X" statement needs a grep hit in the test tree. When a Locked Decision records a live maximum, turn it into a rule and a test at that maximum. A refactor's test lock has to exercise each pipeline stage the refactor touches.

### Remediation Required

Amend the plan per AUDIT_REPORT N1-N4: classify the red-first and regression-lock assertions and amend D4; add or retract the PWA skip-warning coverage; add the time-zone length rule and a test longer than 12 entries; add a dedupe and exact-output lock fixture for Phase 0. Then resubmit to an independent /qor-audit.

---

## Failure Entry #16

**Date**: 2026-10-10T05:24:27Z
**Verdict ID**: Entry #100 (GATE TRIBUNAL Phase 17 Public Discovery Provider Tranche, Iteration 4)
**Failure Mode**: SPECIFICATION_DRIFT (with COMPLEXITY_VIOLATION)

### What Failed

The iteration-4 plan for the Himalayas provider. It closed N2 and N3 and stated the main baseline truthfully, but its new red-first classification and Phase 0 golden lock were not fully verified against the candidate.

### Why It Failed

- The plan called its red/green split "measured", yet it placed "51 time-zone entries -> null" in the red-first group. The candidate already returns null for that input.
- The golden test's ability to catch dedupe and cap regressions depends on the duplicate pair being the first two Remote OK rows. The plan never says so; two of the three orders it permits detect nothing at limit 4.
- Moving `himalayasQuery` while keeping the endpoints in `source-discovery.cts` either contradicts the plan or creates an import cycle.
- D2 promises that every function is under 40 lines, while the authorized diff edits the 167-line `registerCoreIpcHandlers`.
- The golden test names a runtime kind ("desktop") that the `RuntimeKind` type does not contain.

### Pattern to Avoid

Run every red-first input, including each length-rule input, through the current code, and write the observed output beside it. Any item without an observed red value is a regression lock. When a golden test claims to detect a pipeline-stage mutation, state the fixture precondition that puts the affected item inside the cap window, and check it by mutating the stage once. When a refactor moves a function, move its constants with it, or say where they live. A Razor promise covers every function the diff touches, including pre-existing ones; exempt them explicitly or split them.

### Remediation Required

Amend the plan per AUDIT_REPORT F1-F5: reclassify the 51-entry item; pin the golden duplicate rows to positions 0 and 1; resolve the endpoint and `himalayasQuery` placement; refactor or explicitly exempt `registerCoreIpcHandlers` (/qor-refactor); use `runtimeKind: "electron"`. Then resubmit to an independent /qor-audit.

---

## Failure Entry #17

**Date**: 2026-10-10T06:12:25Z
**Verdict ID**: Entry #102 (GATE TRIBUNAL Phase 17 Gate-Loop Remediation Review)
**Failure Mode**: SPECIFICATION_DRIFT (nominal closure enforcer; with an OWASP A03/A04 subprocess design gap)

### What Failed

The Phase 17 /qor-remediate proposal (.qor/gates/2026-10-10T0443-9d3df3/remediate.json) and its closure enforcer, tests/test_plan_claims_manifest.py.

### Why It Failed

- The enforcer executes only the claims a plan author chooses to declare. A gated plan with one trivial claim passes while its prose carries false empirical claims. The root cause it was meant to close (empirical claims nobody executed) therefore stays unguarded, and the remaining guard is a Judge-side prose rule that restates existing audit behaviour.
- The plan-time and audit-time rules that would bind the enforcer exist only in the gate JSON and the ledger. One of them places a hard short-circuit at /qor-audit Step 0.6, which the skill defines as WARN-only. No CI job, doctrine file or skill reference invokes the enforcer.
- Author-controlled command claims execute on the auditor's machine before any adversarial pass, with no executable allowlist, inside a worktree that shares the audited repository's .git.
- "Exact ref" is promised but not enforced.

### Pattern to Avoid

A closure enforcer must fail on the pattern it closes, not only on the instances the author opts in to. If an executable check can be satisfied vacuously, add the completeness check (here, every prose citation must reference a claim id) or the closure is prose in disguise. Do not declare a gate step a hard stop when the skill defines it as WARN; write the binding rule where the skill or CI actually reads it. Any mechanism that runs plan-supplied commands on the auditor's host needs an executable allowlist and isolation from the audited repository.

### Remediation Attempted

None in this cycle. The events 1f15661a and f0b67f91 remain addressed_pending, and no addressed flip was performed. The Governor amends the remediation per AUDIT_REPORT R1-R4 via /qor-remediate, then resubmits to an independent /qor-audit reviews-remediate.

---

## Failure Entry #18

**Date**: 2026-10-10T06:43:41Z
**Verdict ID**: Entry #104 (GATE TRIBUNAL Phase 17 Gate-Loop Remediation Amendment 1 Review)
**Failure Mode**: COMPLEXITY_VIOLATION / coverage-gap (completeness gate satisfiable by reference reuse; false verification in a claim evaluator; binding dependency unworkable as specified)

### What Failed

Amendment 1 of the Phase 17 /qor-remediate proposal (.qor/gates/2026-10-10T0443-9d3df3/remediate.json, content hash 55782866) and its read-only checker (scripts/plan_claims_check.py, plan_claims_schema.py, plan_claims_source.py), plus .github/workflows/plan-claims.yml.

### Why It Failed

- The completeness rule tests only whether a detected assertion has *some* declared reference on the same line. One trivial claim ID, or one generic judgment, reused on every false line passes. So does an empty manifest whose prose uses undetected phrasings, and so does prose inside a fenced (or unclosed) block in a canonical section.
- The function-lines brace scanner does not understand regex literals, so it under-counts. A 104-line function measured 2 lines and a max-40 claim verified true.
- The CI job is path-filtered. Under GitHub semantics a path-skipped required check stays pending, so the declared closure dependency D1 cannot be applied as written. The gated PR can also edit the checker that gates it.
- The test file is 308 lines, and the evaluator contains a nested ternary.

### Pattern to Avoid

Requiring that an assertion carry a reference is not the same as linking that assertion to a claim. A completeness gate must check that the referenced claim is about the asserted thing (compatible kind, same path) and must reject empty inventories when assertions are detected. Never exempt fenced content inside the sections being scanned. A verifier that can return a false PASS is worse than none, so fail closed on any token the parser does not model. A path-filtered workflow cannot be made a required check without blocking unrelated PRs. And a gate that runs from the PR head can be weakened by the PR it gates: load it from the base revision or protect it with CODEOWNERS.

### Remediation Attempted

None in this cycle. Events 1f15661a and f0b67f91 remain addressed_pending, and no addressed flip was performed. The Governor amends via /qor-remediate (Amendment 2) per AUDIT_REPORT V1-V4, then resubmits to an independent /qor-audit reviews-remediate. Closure additionally requires D1 and D2.

---

## Failure Entry #19

**Date**: 2026-10-10T07:25:42Z
**Verdict ID**: Entry #106 (GATE TRIBUNAL Phase 17 Gate-Loop Remediation Amendment 2 Review)
**Failure Mode**: COMPLEXITY_VIOLATION / coverage-gap (parser divergence between gate and rendered document; line-wide subject binding; false verification in the function-span and import evaluators)

### What Failed

Amendment 2 of the Phase 17 /qor-remediate proposal (.qor/gates/2026-10-10T0443-9d3df3/remediate.json, content hash fa0e6924) and its checker (scripts/plan_claims_prose.py, plan_claims_source.py, plan_claims_tokens.py, plan_claims_gate.py).

### Why It Failed

- The scanner decides sections and fences with its own line rules. These diverge from Markdown rendering in several ways:
  - a heading inside an HTML comment or a <pre> block;
  - a ~~~ line or a shorter fence inside a backtick fence;
  - a 1-3-space-indented heading.

  Facts that render inside Locked Decisions therefore went unscanned, and both the checker and the gate passed the plan.
- Subject binding accepts any claim whose path or function name appears anywhere on the line. A claim about file B therefore discharges an assertion about file A. Exact-size prose also binds to an upper-bound claim.
- Any H3 heading containing the substring "test" disables numeric-assertion detection.
- The JS/TS span evaluator returns a 1-line measurement for a 103-line arrow function whose generic constraint contains `=> { ... }`. Template-literal require/import arguments are invisible to the import-edge evaluator. Both produce false PASS results instead of failing closed.
- _bind_claims nests 4 levels deep.

### Pattern to Avoid

A lexical gate over a rendered document must use the renderer's block structure, or it must fail closed on every construct whose structure it does not model (raw HTML, non-matching fences, indented headings). Otherwise a reader sees content that the gate never scanned. Bind each assertion to the subject named inside its own span, not to any token on the line. Bind exact quantities to exact claims. Exemptions must match exact headings and delimited data, never substrings or prose. A parser-based verifier must fail closed whenever its own heuristics skip a region (type parameters, non-literal specifiers); any shortcut that can shrink a measurement or hide an edge is a false-PASS generator. Measure nesting depth in the automated razor test as well as line counts.

### Remediation Attempted

None in this cycle. Events 1f15661a and f0b67f91 remain addressed_pending, and no addressed flip was performed. The Governor amends via /qor-remediate (Amendment 3) per AUDIT_REPORT V1-A, V1-B, V1-C, V2 and Razor, then resubmits to an independent /qor-audit reviews-remediate. Closure additionally requires D1 and D2.

---

## Failure Entry #20

**Date**: 2026-10-12T14:57:06Z
**Verdict ID**: Entry #108 (GATE TRIBUNAL Phase 17 Gate-Loop Remediation Amendment 3 Review)
**Failure Mode**: coverage-gap / specification-drift. The restricted-Markdown subset still diverges from CommonMark. Unrecognised size qualifiers default to an exact binding. Tokenizer context heuristics shrink function spans.

### What Failed

Amendment 3 of the Phase 17 /qor-remediate proposal (.qor/gates/2026-10-10T0443-9d3df3/remediate.json, content hash 7bbc1e24). It covers scripts/plan_claims_markdown.py, plan_claims_prose.py, plan_claims_tokens.py, plan_claims_source.py and plan_claims_gate.py.

### Why It Failed

- The subset rejected the constructs reviewers had already named, but not their siblings:
  - backslash-escaped backticks, which hide raw HTML from the code-span blanker;
  - backtick fences whose info string contains a backtick (not a fence in CommonMark);
  - headings inside blockquotes or list items;
  - canonical heading names written with NBSP, doubled spaces, zero-width or confusable characters;
  - a leading BOM;
  - code spans that cross lines.
- Size prose with an unrecognised qualifier ("more than", "over", "not") falls through to the exact equals binding, so a false sentence verifies. Only the last backticked subject before an assertion is checked, so a coordinated second subject or operand rides along unverified.
- The tokenizer decides regex versus division from the previous token. It does not handle `for await (` or property names that collide with keywords (`o.in`), so a 103-line function measured 2 lines. `_body_open` scans past the end of the declaring statement. A literal followed by `+` was accepted as a module specifier.

### Pattern to Avoid

Fixing the enumerated counterexamples is not closing a class. When a gate claims parity with a renderer, enumerate the renderer's grammar for each structure:
- escapes;
- info strings;
- container blocks;
- Unicode in identifiers;
- the BOM;
- multi-line inlines.

Fail closed on everything outside a small, explicitly modelled subset, for example ASCII-only headings at column 0, no backslash before a backtick, and single-line code spans. For bindings, any unrecognised modifier must fail closed, never fall through to the strongest binding. For lexer heuristics, an unproven context must raise, never guess. A heuristic that can shrink a measurement is a false-PASS generator.

### Remediation Attempted

None in this cycle. Events 1f15661a and f0b67f91 remain addressed_pending, and no addressed flip was performed. The Governor amends via /qor-remediate (Amendment 4) per AUDIT_REPORT V1-A, V1-B, V2 and the V3 documentation item, then resubmits to an independent /qor-audit reviews-remediate. Closure additionally requires D1 and D2.

---

## Failure Entry #21

**Date**: 2026-10-12T16:10:13Z
**Verdict ID**: Entry #110 (GATE TRIBUNAL Phase 18 Plan Evidence Gate v3 Design Review)
**Failure Mode**: infrastructure-mismatch / owasp-violation (A04) / coverage-gap / specification-drift. A sound redesign whose delivery premise and parser boundary were not checked against reality.

### What Failed

The Phase 18 design: docs/plan-qor-phase18-plan-evidence-gate-v3.md (content hash d034403b), its inventory, and docs/design/PLAN_EVIDENCE_GATE_V3_SPEC.md. The dependency (markdown-it-py 4.2.0 + mdurl 0.1.2) was ADMITTED. The failures are in plan and specification text.

### Why It Failed

- pr_target named the vetoed PR #232 head branch, contradicting the plan's own exclusions and the operator's "new branch" direction.
- The bootstrap never showed that a valid governed PR can pass on a lineage that still carries a plan the new gate fails.
- A Locked Decision said the v2 gate "already runs" when the cited record proves only that a workflow file contains a trigger keyword. That workflow has never executed.
- The spec trusted parser tokens as a complete view of the document. markdown-it silently drops content nested at depth 20 or more (maxNesting), so "raw HTML anywhere fails" and "structure VALIDATED" overclaim.
- The test plan omitted rules the spec itself asserts (NUL/C0, U+2028, case-variant headings) and did not require the full reviewer corpus.
- The operator's parse-time bound was not specified.

### Pattern to Avoid

Adopting a real parser removes lexer drift but not boundary drift. For every parser, enumerate the conditions under which it stops producing tokens: nesting limits, recursion limits and error recovery. Fail closed when they are reached.

A record that proves a file contains text supports only "is configured", never "runs". Write prose no stronger than its record.

Before planning delivery, resolve the landing path: target branch, the content stacked under the branch, and whether a valid governed PR can pass on that lineage.

Every rule written into a spec needs a named fixture.

### Remediation Attempted

None in this cycle. The Governor amends the plan and spec per AUDIT_REPORT V1-V5 and resubmits to a fresh independent /qor-audit. Phase 17 remains VETO #108, and events 1f15661a and f0b67f91 remain addressed_pending.

---

## Failure Entry #22

**Date**: 2026-10-12T16:31:08Z
**Verdict ID**: Entry #112 (GATE TRIBUNAL Phase 18 Plan Evidence Gate v3 Design Re-audit, iteration 2)
**Failure Mode**: owasp-violation (A04) / specification-drift / coverage-gap. A bounded correction that fixed reachability by opening a fail-open classification.

### What Failed

The Phase 18 design iteration 2: docs/plan-qor-phase18-plan-evidence-gate-v3.md (content hash 752c1b20), its inventory, and docs/design/PLAN_EVIDENCE_GATE_V3_SPEC.md iteration 2.
The parser boundary (V3), the LD1 wording (V2) and most of V5 were closed and empirically confirmed. The dependency ADMIT stands.

### Why It Failed

- To make "a valid governed PR passes" reachable (V1), the spec exempted plans as LEGACY when the phase number is below 18 and no inventory exists. Both inputs are PR-head data. A new low-phase plan, an edited Phase 17 plan, a deleted opt-in inventory or a renamed plan therefore exits 0 unevaluated, contradicting the spec's own "No nominal success" invariant.
- The opt-in obligation was delegated to an artifact (the Phase 17 remediation record) that the plan may not modify and the gate never reads.
- Section 10 was not updated and still says the iteration-4 plan fails the gate.
- The plan's self-application command omitted the --head argument that the spec made mandatory, while plan.json recorded it.
- The converted-corpus table asserted PASS for a probe (s3) whose only record is a removed kind. It also left the conversion procedure unspecified, which changes n19's outcome.

### Pattern to Avoid

An exemption is an authority decision. Never derive "is this subject to the gate?" from data the gated party controls: file names, self-declared numbers, or the presence or absence of an opt-in file. Fix exemptions as a closed set on the trusted side (paths plus blob hashes), or gate everything the change touches. Treat deletion of an opt-in artifact as a failure.

When a correction changes one section's outcome for a case, search every section for statements about that case.

Every command the plan cites must be checked against the spec's CLI contract.

Every expected outcome in a fixture table must be reachable under the spec's own rules, and the fixture conversion procedure must be written down.

### Remediation Attempted

None in this cycle. Under #267, the operator allowed one bounded correction after VETO #110, and this entry records the review of that correction. Any further correction (R1-R5, A1-A6 in AUDIT_REPORT) requires an operator decision. Phase 17 remains VETO #108, and events 1f15661a and f0b67f91 remain addressed_pending.

---

## Failure Entry #23

**Date**: 2026-10-12T17:05:44Z
**Verdict ID**: Entry #114 (GATE TRIBUNAL Phase 18 Plan Evidence Gate v3 Final Design Audit, iteration 3)
**Failure Mode**: owasp-violation (A04) / coverage-gap / specification-drift. The fail-closed rule trusted a single merge base that the PR head can choose through its own ancestry.

### What Failed

The Phase 18 design iteration 3, which was the final authorized iteration: docs/plan-qor-phase18-plan-evidence-gate-v3.md (content hash a9dd7e46) and docs/design/PLAN_EVIDENCE_GATE_V3_SPEC.md iteration 3. The head-controlled LEGACY exemption was removed. Every named linear-history R1 scenario behaved correctly in real git. R3 and R5 closed.

### Why It Failed

- Applicability came from `git diff --no-renames M H`, with M taken from a single `git merge-base`. The PR author chooses H's parents. A head that merges both parents of any historical base merge commit has two merge bases, and `git merge-base` prints one of them, chosen by commit date. The M..H list can then be empty while the actual merge deletes a governed plan or strips an inventory. This was demonstrated on real repository history: the merge deletes docs/plan-qor-phase10-public-demo-harness.md, while the gate sees no change and reports not applicable with exit 0.
- The status table enumerated A, M and D but not T (type change to a symlink or gitlink), and it gave no default for unlisted statuses.
- The corpus conversion specified the Markdown side precisely but not the inventory side. The v3-mandatory purpose and owner fields, and records carrying both max and equals, had no defined mapping. The "57 of 57" reproduction came from a structure-only harness that never ran the schema stage.
- The new file-name grammar, the governed-path filter and a grammar fixture contradicted each other on case and extension.

### Pattern to Avoid

A change list decides authority only if it is the change the merge will actually apply. Never trust a single `git merge-base` answer from history the gated party controls. Either require a unique merge base, or require the base to be an ancestor of the head, so that the evaluated tree is the merged tree. Close every enumerated status table with an explicit fail-closed default. When a test oracle is "reproduced", say which stages the harness actually ran. A conversion procedure must yield inputs that are valid under the target schema as written.

### Remediation Attempted

None. Under #267 comment 6128584663, a VETO on this final iteration means stop and report: no fourth design iteration, no amendment loop and no override. Phase 17 remains VETO #108, and events 1f15661a and f0b67f91 remain addressed_pending.

---

*Shadow Genome updated. Pattern documented for future avoidance.*
