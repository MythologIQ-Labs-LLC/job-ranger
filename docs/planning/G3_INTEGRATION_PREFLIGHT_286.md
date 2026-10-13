# G3 Agent Workspace integration preflight (#286)

**State:** pre-implementation coordination, not a merge approval or release record.
**Date:** 2026-10-13.
**Reference `main`:** `170b0594097d1107a1c9d7642cdc6dee5aa18830` (includes merged PR #282).
**Reviewed G3:** code at `cd04074` (independent PASS after two VETOs), pushed `impl/286-g3-agent-workspace` head `5f1673a6d2640ad1830bae600c6e41a738134722`. Contains unmerged G2 and contract decisions, not Google Drive transport.
**Standalone shared SQLite fix:** PR #296, head `4d37fdd6a1b9911e616363a943270fa86d8d0584`, unmerged at preflight.
**No new hosted jobs or pull requests were triggered by this document.**

## Why this slice exists

G3 is materially implemented and independently reviewed, but opening or merging a large PR without integrating its existing dependencies and the newly merged main fixes risks a confusing comparison and wasted GitHub Actions. This preflight records exactly what can safely be reconciled and what evidence is still required. It does **not** reopen completed G3 governance decisions or authorize G4.

## Verified branch relationship

GitHub compare `main...impl/286-g3-agent-workspace`:
- G3 is **58 commits ahead**, **3 commits behind** the current main head. Merge base `5561104d9ee15011b53a23002bec77198f9ffd1c`.
- G3 currently differs from main in **83 files** (G2, contract decisions, G3, tests and docs combined).
- Across the shared merge base, current main changed exactly eight files: `HELP.md`, `src/context/AppContext.tsx`, `src/pages/CareerProfile.tsx`, `src/pages/Companies.tsx`, `src/pages/Settings.tsx`, `tests/pwa/career-profile-draft.spec.ts`, `tests/pwa/settings-save-feedback.spec.ts`, and `tests/pwa/source-schedule.spec.ts`.
- **File-path intersection between those eight main changes and G3 changes: empty.** This reduces textual merge risk but is not runtime or behavioral compatibility proof. In particular preserve #282's Career Profile edit-loss fix and new tests.
- G3 is **18 commits / 61 changed files** ahead of `a6a8a2b` (contract decisions). That does not represent an independently mergeable G3 release: G2 and contract decisions still need to be included.
- G3 changes `src/App.tsx` and `src/components/Sidebar.tsx` for Agent Workspace. Main has not separately changed those files since the shared merge base; there is no current line-level overlap from recent main commits.

## Verified #296 overlap

PR #296 extracts the exact same versions of these G3 files:
- `electron/src/sqlite.cts`: identical blob SHA `4a5cfd2a9286d0dde266dd347aec3387b53108c7`.
- `electron/src/sql-literal.cts`: identical blob SHA `5873759bea27d86133f4fd066ae5789de815bcef`.
- `tests/sqlite-transaction-atomicity.test.cjs` and `tests/sql-literal-roundtrip.test.cjs`: both added in #296 and G3.
- `package.json`: both branches extend `test` and `test:unit`. The G3 version contains the two shared SQLite regressions **plus** additional Agent Workspace tests, including persistence, recovery, challenge corpus and CLI/WASM parity. **Merge the scripts by preserving the union of distinct tests**; do not overwrite the integrated main script with an older version or run duplicate SQLite regressions. `desktop:compile`, `build`, `build:pwa`, `test:pwa:e2e`, and `test:e2e` scripts were unchanged between the inspected main, #296 and G3 snapshots.

If the shared SQLite file SHA changes while resolving #296, discard the identical-blob assumption and perform a new compatibility review.

## Current blocker: Windows PWA suite

#296's existing GitHub Actions run `38480005605` had a Windows PWA failure; one targeted re-run also failed. Detailed review note on [#296](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/296#issuecomment-6157088912):
- First run: 75 pass, 1 fail (skip link does not receive first-tab focus, `tests/pwa/nav-keyboard-a11y.spec.ts:55`).
- Targeted rerun: 74 pass, 2 fail (same skip-link focus test and `tests/pwa/personal-brand.spec.ts:462` strict-mode ambiguity from two "Unavailable" labels).
- Neither failing test directly exercises the changed SQLite files, but the failure is **not waived** or described as proven baseline-only. Independent exact-head local reproduction and root-cause evaluation belong to the #296 validation owner. Do not rerun another full hosted suite without a targeted fix or useful new evidence.

## Integration procedure once #296 has passed its gate

1. Record the exact new `main` SHA after #296 merges. Re-run compare against `impl/286-g3-agent-workspace`. If G3 has advanced, require its own new independent review or explicitly validate the delta after `cd04074`.
2. Create one **new isolated integration branch** from that exact `main`. Do not force-push, squash away G2/contract audit provenance, or directly rewrite reviewed `impl/286-g3-agent-workspace`.
3. Integrate G3's G2 + contract-decision + G3 history (Git merge preferred to preserve audit chain; no synthetic graft of files without the expected content). Resolve the `package.json` test-script overlap by union and deduplication; compare identical SQLite blobs and make sure all schema v2 migrations and D01–D14 contracts are intact. Confirm #282's Career Profile implementation and relevant current-main fixes remain unchanged.
4. Run exact-head local compile/typecheck, `npm test`, `npm run test:pwa:e2e`, and `npm run test:e2e` using actual native sqlite3 and WASM where called for. The G3 evidence (70/70 browser; 16/16 Electron; 18 shared storage suites on WASM) was collected at `cd04074` and **does not certify a new integration head**. Exercise migration-on-upgrade, restart, portable backup/restore, 60-day dual-agent replay and 256-order oracle as part of the new integrated test acceptance.
5. Verify at least the following with the production UI: New Workspace menu, import policy, export receipts stored before ZIP, folder-based sync, Needs Review/Drafts/Problems/History, conflicts after prior keep, rejected v1 inputs, source-unverified labels, and post-confirmation application status. Text must always be rendered as text, not HTML. Upload errors must not modify canonical career tables. Verify keyboard and screen-reader semantics and errors.
6. Independently review the integration exact commit, focusing on cross-feature regressions and per-kind authority. Keep #293 evidence promotion and #294 material-draft import staged with clear user-facing limitations. Do not treat agent claims as proof of submission, qualification or hire.
7. Open the G3 integration PR **after** readiness evidence, or as a deliberate draft when the owner explicitly chooses to spend hosted CI. Label source/target SHAs and include branch ancestry, D01–D14, local testing and known limits. No release and no demo until merge and final product acceptance.

## Distinct defect and release decision

[#297](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/297) tracks SQLite CLI `-json` **readback truncation for text containing NUL**. The database stores the full bytes, but readback may omit content. This is **not** fixed by #296 transaction atomicity or G3's stdin/control-character encoding. It requires an exact ingress rejection with explicit error or byte-preserving retrieval with fail-first tests before claiming arbitrary user/agent text fidelity. Decide separately whether to block the G3 merge or restrict accepted input, but **do not ship a silent truncation path while claiming complete fidelity**.

## Scope lock

- **Included in G3:** local-first, v2-contract Agent Workspace; importer/reconciliation, locally stored receipts/ledger/decisions, staged proposals, governed review, Electron/PWA parity.
- **Not included:** G4 Google Drive or OAuth, automatic resume/cover-letter/evidence promotion, background syncing, mass applications, agent authority over canonical status or facts, or a new product demo.
- **UI elevation:** [#248](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/248) is in discovery/mockup and accessibility review. Unmerged screen-polish branches are prototypes, **not** authorized to be combined with this G3 integration until the UX direction is reviewed.

## Current owner handoffs

- **Claude/local validation:** resolve the Windows PWA check on #296 and validate that PR's exact head. Gather exact-SHA current UI baseline screenshots for #248. These tasks are already independently underway; no duplicate broad CI runs.
- **Integration maintainer:** apply this preflight at the point #296 is green, establish the new integration SHA, preserve current-main changes, validate tests/authority, then create a reviewable G3 PR.
- **User:** review UX mockups/user journey evidence before approving broad UI implementation; decide NUL handling before advertising full arbitrary-text fidelity.

**No runtime changes, merge, G3 PR, Drive enablement, UI redesign, or recording were performed as part of this preflight.**
