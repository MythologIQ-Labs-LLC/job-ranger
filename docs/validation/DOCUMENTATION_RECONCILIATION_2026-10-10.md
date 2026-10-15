# Documentation and Governance Reconciliation, 2026-10-10

**Status:** documentation-only reconciliation evidence; not a runtime, release or governance qualification.
**Baseline reviewed:** `main` at `4721e7fa782099c69019494d6f823c2cc372b98d`.
**Reference release:** published stable `v1.2.0` from `71f9b790a1f456321aee2c783f39f4a6784b83a9`.
**Method:** read-only, exact-ref inspection through the connected GitHub repository interface; review of the repository tree, original source paths, tests, active GitHub PRs/issues, and canonical docs. No local executable checkout or UI testing in this environment. This record does not qualify application behavior.

## Drift corrected in the proposed documentation branch

| Current source of truth | Before | Reconciliation |
| --- | --- | --- |
| `docs/SYSTEM_STATE.md` | October 6 snapshot missing newer development capabilities | Dated source checkpoint plus bounded Personal Brand/LinkedIn, economic-pathway and read-only MCP sections; draft-provider exclusion |
| `docs/planning/PLAN.md` | Personal Brand incorrectly labelled not implemented; source providers described as ordinary next work | Manual-first slices marked implemented on main, unfinished integrations retained as open; #136 CHANGES REQUIRED/HOLD documented |
| `docs/FEATURE_INDEX.md` | Ended at FX050, omitting new user-touchable surfaces | FX051-FX059 added with exact code/test references; conservatively unverified without same-target UI evidence |
| `docs/GOVERNANCE_INDEX.md` | Claimed `docs/META_LEDGER.md` latest sealed entry #27 | Corrected to actual `main` latest entry #94, Phase 16 seal; later Phase 17 draft ledger separated |
| `docs/README.md` and root `README.md` | General hierarchy was accurate but did not point to current reconciliation evidence | Added a dated reconciliation pointer and explicit draft-branch authority boundary |
| `docs/validation/README.md` | Last documentation audit indexed was October 3 | This record linked as a current, evidence-scoped manual documentation audit |

## Source corroboration

- `src/pages/PersonalBrand.tsx` renders the draft, manually confirmed copy/receipt, local XLSX preview, confirmed persistence, observed metrics, historical post archive, attested topic labels, and conservative comparable-content views. The implementation lives in `electron/src/personal-brand-backend.cts`, `src/shared/personal-brand*.ts`, `src/shared/linkedin-*.ts` and related components. The linked `tests/pwa/personal-brand.spec.ts` and deterministic `tests/*brand*`, `tests/linkedin-*.test.mjs` are **test paths present**, not an invented passing UI result.
- `src/pages/TargetTracks.tsx:354` mounts `EconomicPathwayExplorer`. Its values are user-entered assumptions, not labor-market facts. `tests/economic-pathways.test.mjs` and `tests/pwa/economic-pathways-exploration.spec.ts` exist.
- `mcp/local-readonly-server.mjs`, `mcp/read-only-adapter.mjs`, `docs/integrations/JOB_RANGER_MCP_READONLY.md` are a development-only read surface. Neither publication nor live verified ChatGPT connectivity is established.
- On `main` at the reviewed SHA, the `docs/META_LEDGER.md` final entry is **#94 (Phase 16 seal)**. Phase 17 ledger events #95+ are confined to draft PR #232, so the main index must **not** claim an independent audit PASS or seal for them.
- Issue [#136](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/136): draft Himalayas PR #233 has CHANGES REQUIRED; WWR RSS PR #238 remains HOLD pending publisher-terms clearance. Application-assistance PRs #229/#230 remain drafts. These branches are excluded from shipped/current-main capabilities.
- Current `docs/validation/RELEASE_CANDIDATE_V1.3.0.md` is a **pre-tag October 6** evidence record, not automatic admission or qualification of features added later.

## Validation and limitations

- Inspected main-branch tree, checked-in source, tests and current documentation using GitHub reads at the exact baseline SHA.
- Cross-checked documentation and governance status against current open PR and issue metadata at the time of review.
- Documentation-only changes; the review does not touch application runtime code, test execution, release tags, or protected governance gate artifacts.
- Parsed **129 Markdown relative links** across the 11 changed/indexed documents and checked every internal file target against the repository's recursive branch tree: **0 broken file targets**. Parsed **59 feature-index IDs**, covering FX001–FX059 without gaps, and checked source/test paths for every feature row against that same tree: **0 missing paths**. These are static GitHub-source checks, not application tests.
- **No local lint/build/unit/E2E/test commands were run**, and no qualification of new features is claimed.
- This record is a dated reconciliation snapshot. Merging subsequent changes or receiving new independent governance decisions requires another update, rather than retroactively interpreting this record as current.

## Maintenance rule

Every material capability/authority change should reconcile, in the same change or a linked release-prep update, the smallest relevant set of: user README/HELP, `SYSTEM_STATE`, active roadmap, feature index, governance index/ledger, design/ADR, CHANGELOG, and validation evidence. The release evidence must continue to distinguish **published**, **on main**, **draft/unqualified**, **held**, **deferred**, and **historical**. Preserve ledger and veto history; never convert an unqualified draft to a shipped claim through documentation edits.

## Refresh, 2026-10-15

**Status:** documentation-only refresh of the record above; the October 10 sections are kept as written.
**New baseline:** `main` at `5c749dc28170bc46ce2b104fe24309d3aff7a02c` (#318), merged into this branch. The previous baseline was `4721e7fa782099c69019494d6f823c2cc372b98d`.
**Releases:** v1.2.0 is still the only published stable release. v1.3.0 is a candidate and is not published. Nothing merged in this window, including #316, #317 and #318, is released.
**Method:** local checkout of the merged branch; `git log` and commit messages for every main commit after the October 10 baseline; source and test paths checked in the working tree; open PR and issue states read with the GitHub CLI. No application behavior was re-tested.

### What changed on main

The merge brought in 21 main commits: #246 (2026-10-10, the stated base of this PR but after the October 10 baseline SHA) and 20 commits merged 2026-10-13 to 2026-10-15. There were no merge conflicts.

| Area | Pull requests |
| --- | --- |
| Personal Brand | #246 topic cohort comparisons |
| Navigation, Help and layout | #186 offline Help page, #273 grouped sidebar, #279 keyboard and focus, #280 compact page introductions, #305 accessibility baseline, #317 branded shell and Atelier palette |
| Pages | #306 task-first Home, #310 Applications status focus, #270 cover-letter copy (G3), #272 filter editing (G2), #275 source pause/resume (G1), #276 notification settings (G5, B3), #282 and #318 Career Profile edits |
| Data and reliability | #184 mapper terminal periods (G11 bounded), #296 SQLite CLI transaction atomicity, #316 SQLite statements on stdin, #318 sidebar group reset and tailoring coverage race |
| Repository and tests | #313 repository workflow and hygiene audit, #269 optional local evidence checker, #304 PWA readiness wait |

### Documents updated in this refresh

| Document | Change |
| --- | --- |
| `docs/SYSTEM_STATE.md` | Snapshot moved to 2026-10-15 at the new baseline; a "Merged to main from 2026-10-10 to 2026-10-15" section lists each item with its PR and test; #246 added to Personal Brand; known gaps now say notifications save in place but are still not sent after scrapes, and record open issue #297 (NUL readback on the Electron CLI path) |
| `docs/FEATURE_INDEX.md` | FX060-FX069 added for user-touchable features from this window, all `unverified`; FX051 and FX053 line anchors moved to their current lines; FX020 re-pointed because its old line no longer exists |
| `HELP.md` | A development-line subsection lists the changed pages and says the v1.2.0 installers do not have them |
| `CHANGELOG.md` | Unreleased: Fixed entries for #316 and #318 and a Changed entry for #317 |
| `docs/BACKLOG.md` | G7 progress note: two of the three flaky specs diagnosed and fixed (#316, #318); `onboarding.spec.ts:219` is not diagnosed, so G7 stays open |
| `docs/GOVERNANCE_INDEX.md` | Review date and System State marker moved to 2026-10-15; Roadmap marker matches PLAN (2026-10-10); `docs/REPOSITORY_WORKFLOW.md` (#313) indexed under doctrine and policy |
| `docs/README.md`, `README.md`, `docs/validation/README.md` | Pointers to this record mention the refresh. `docs/README.md` no longer calls the local evidence checker unmerged: `scripts/local_evidence_cli.py` is on main since #269 |

Newer repository-hygiene text from #313 (`CONTRIBUTING.md`, `docs/README.md`, `docs/REPOSITORY_WORKFLOW.md`, `AGENTS.md`, `CLAUDE.md`, PR and issue templates) came in through the merge unchanged.

### Unchanged facts rechecked

- `docs/META_LEDGER.md` on main still ends at #94 (Phase 16 seal).
- Draft PRs #229, #230, #232, #233 and #238 are still open drafts. Issues #136, #181 and #228 are open. The exclusions above still apply.
- #319 (e2e busy timeout, test-only) was open and not merged at the time of this refresh, so nothing here depends on it.

### Checks run for this refresh

Run locally on Windows 11 with Node 24.19 against the refreshed branch content (main `5c749dc` merged, plus these documentation edits):

- A static checker parsed every relative Markdown link in the 12 Markdown files this PR changes against main: **136 relative links, 0 broken file or anchor targets**. It also found **201 backticked repository paths, 0 missing**.
- The same checker parsed **69 feature-index rows, FX001-FX069 with no gaps**, and found every source file, doc citation and test path present, with every source line anchor inside its file.
- Every PR number cited in this refresh (#184, #186, #246, #269, #270, #272, #273, #275, #276, #279, #280, #282, #296, #304, #305, #306, #310, #313, #316, #317, #318) was checked with the GitHub CLI as merged, and its merge commit is an ancestor of `5c749dc`.
- `npm run repo:hygiene:test` (3/3), `node tests/qor-hardening.test.cjs` and `npm run typecheck` passed. None of these checks documentation content; no application, PWA or Electron suite was run.

### Not covered

- The October 10 section's `docs/planning/PLAN.md` content was not re-reviewed. It does not track the #248 UX or #194 reliability programs.
- `CHANGELOG.md` has no Unreleased entries for #184, #186, #246, #269, #270, #272, #273, #275, #276, #279, #280, #282, #296, #304, #305, #306, #310 or #313.
- BACKLOG G1, G2, G3, G5, G6 and G11 are still open checkboxes although their fixes are on main. Items close only through a sealed governance cycle, so this refresh does not tick them.
- `docs/research/LOCAL_EVIDENCE_CLI_267.md` still describes its tool as unmerged; it was not edited here.
- Apart from FX020, FX001-FX050 line anchors are from the October 6 inventory and were not re-pointed. Rows in files changed since then (for example Sidebar, Dashboard, Companies, Filters, Applications, Settings and Career Profile) now point at unrelated lines; the files themselves exist.
