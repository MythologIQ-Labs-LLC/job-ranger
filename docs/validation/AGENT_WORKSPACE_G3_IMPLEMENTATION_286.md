# Agent workspace G3: persistence, review screen and contract alignment (#286)

**Branch:** `impl/286-g3-agent-workspace`, from the G2 implementation `ad2bf40` (independent PASS at `1d1d5e2`) merged with the contract decisions `a6a8a2b`, which include the audit corpus `57a4097`.
**Status:** implemented, tested locally, and independently reviewed: **PASS at `cd04074`** after two VETOs. Not merged, no release, no Drive or OAuth code.

## What G3 delivers

| Area | Where | What |
|---|---|---|
| Contract v2 (D01–D14) | `src/agent-workspace/schema.ts`, `docs/design/schemas/*-v2.schema.json` | `jr-agent-operation-batch` v2 and `jr-agent-export` v2; `jr-agent-export-receipt` v2 and `jr-agent-reconcile-ledger` v2 (local only). v1 files are refused with `superseded_schema_version`, never reinterpreted. `jr-agent-batch-commit` v1 stays the only completion marker. |
| #289 late conflicts | `src/agent-workspace/reconcile.ts` | Ledger entries carry accumulate-only `contest` reasons (`operation_id_conflict`, `fork`, `record_kind_conflict`, `ancestor_contested`) and every content `variant`. A late conflict or late fork downgrades the earlier import (`downgrades`), keeps every version (`contested`) and never restores eligibility. `migrateLedgerV1` is explicit and one-way. |
| Persistence (both runtimes) | `electron/src/agent-workspace-{backend,validators,ipc}.cts`, migration 1010 | Tables in Job Ranger's own SQLite database: workspace identity and policy, receipts, ledger, items, quarantine, runs, decisions. Electron runs them on the sqlite3 CLI and the PWA on SQLite WASM/OPFS, with the same backend code. One reconciliation is one transaction, guarded by the ledger revision it was planned from. |
| Sync orchestration | `src/agent-workspace/sync.ts`, `workspace-files.ts` | Loads and validates the ledger, reconciles and commits. A corrupt ledger stops the sync (`ledger_corrupt`), and a concurrent commit is retried once. Folder scanning reads only `workspace/agents` and `workspace/attachments`. |
| Review UI | `src/pages/AgentWorkspace.tsx`, `src/components/agent-workspace/*` | Under My Career → Agent Workspace: folder sync, export ZIP (receipt stored first), the standing import policy, and Needs review / Drafts / Problems / History views. |
| Governed acceptance | backend `decide()`, review dialog | Keep or dismiss agent-owned drafts; keeping a contested version needs acknowledgement. Status claims change status only through the existing applications workflow after a confirmation, and the backend verifies the change before recording it. Evidence proposals and material drafts stay staged (#293, #294). |
| Shared fixes | `electron/src/sqlite.cts`, `sql-literal.cts` | `SqliteClient.transaction` now pipes SQL on stdin. As a command-line argument, the sqlite3 CLI ignored `-bail` and still committed after a failed statement (#292). Values containing unsafe control characters (not tab or newline) are written as one `CAST(X'…' AS TEXT)`, because the Windows CLI reads stdin in text mode. |
| Parser fix | `src/agent-workspace/strict-json.ts` | Raw lone surrogates in strings passed in directly are refused. Escaped ones already were. |

### Contract decisions as implemented

- **D01:** marker `jr-agent-batch-commit` v1, published last. Its `attachments` inventory must exactly equal the drafts' references.
- **D02:** `material_draft_version.payload.attachments[]` with `{path, media_type, bytes, sha256}`.
  - A marker-only or unlisted attachment rejects the batch with `attachment_reference_mismatch`.
  - Missing or corrupt bytes leave the batch `incomplete`, and it is retried.
- **D03:** `CLAIM_STATUS_MAPPING` v1 maps drafted→interested, submitted→applied, interviewing→interview, offered→offer, rejected→rejected and withdrawn→withdrawn. It is used only for comparison and display; the UI says "A claim is not proof."
- **D04:** drafts and status claims must have `base_revision: null`. Corrections must cite the current evidence revision.
- **D05:** `proposal_kind: "new"` requires `evidence_id: null`; `"correction"` requires a real target. Unknown targets and missing bases are refused and quarantined.
- **D06:** `career_direction` covers titles, sectors, skills, full-time and on-call preferences. `selected_applications` covers title, company and canonical status. Neither includes notes, URLs, name, location or pay.
- **D07:** evidence revisions are `evrev1:` content digests over the exported fields. The credential number is excluded, because it could be brute-forced from the other exported fields. Legacy `updatedAt` citations are flagged `legacy_evidence_revision` and need a rebase.
- **D08/D11:** receipts are closed v2 objects bound to the workspace ID. They are stored only locally and travel with backups.
- **D09:** both fork branches are staged and contested, and same-ID variants are all contested, across runs.
- **D10:** only operation batches are ingested; `jr-agent-proposal` is not read.
- **D12:** actor IDs are claims, shown as "(unverified)".
- **D13:**
  - `workspace_mismatch` is a rejection.
  - A batch waits (`previous_batch_unavailable`) until its own actor's previous batch is accepted.
  - Actor mismatches and chain cycles are rejected.
- **D14:** a stable `excluded_by_default` class list plus `omitted_scopes`.

## Evidence (local, Windows 11, Node 24.19, sqlite3 3.53.4)

**Fail-first:**
- `b0cabea`: the #289 test failed on G2 semantics. The earlier draft stayed eligible ("#289: … must lose automatic eligibility").
- `tests/sqlite-transaction-atomicity.test.cjs` fails on `main`'s `sqlite.cts` and passes with the fix.
- The raw-surrogate case fails without the parser fix.
- The audit's #290 file (`b08594f`), run unchanged at `ad2bf40`, gives RED 4 / GREEN 1. Translated onto v2 it gives GREEN 5.

**New tests, all passing:**

| Test | Proves |
|---|---|
| `agent-workspace-late-conflict` | #289 steps 1–8 at reconciler level, late fork, descendants, reorderings |
| `agent-workspace-store` (CLI + WASM) | restart, #289 through storage, idempotent reorder/replay, atomic failure (no partial write), stale and forged plans refused, corruption stops sync, decisions survive syncs, governed status claim, 150-operation bulk commit |
| `agent-workspace-60-day-persistent` (CLI + WASM) | two agents, day-30 partial sync with a corrupted attachment, day-50 canonical edit, day-60 forks, stale citations, replay, missing parent, repaired attachment, late conflict, day-61 no-op, backup and restore to another installation, post-restore no-op. All non-agent tables are byte-identical. |
| `agent-workspace-audit-translation` | strict JSON plus 1,500-case fuzz, 31 governance vectors, the long-gap oracle under 256 listing permutations and 64 split discoveries across a persisted restart, marker negatives |
| `agent-workspace-g3-trust-translation` | #290 workspace binding, closed receipts, contested state, replay control |
| `agent-workspace-review-regressions` (CLI + WASM) | 11 scenarios from the review VETOs: batch-ID bounds, control characters, pending and refused variants, kept-then-conflict, decision during sync, integer job IDs, monotonic ledger, pending claims, pending contested keep, column migration |
| `sql-literal-roundtrip` (CLI + WASM) | 5,000-line, CRLF and control-character text stored exactly |
| `tests/pwa/agent-workspace.spec.ts` | PWA journey: nav → policy → export ZIP → folder sync → keyboard review → governed status change → restart → late conflict → keep-with-acknowledgement → idempotent re-sync. Markup in agent text renders as text. |
| `tests/e2e/agent-workspace.spec.ts` | Electron: sync, quit, relaunch with the same user data, late conflict downgrade |

**Updated G2 tests:** export, validation, 60-day, rules, CLI and snapshot were updated to v2. The independent audit tests still pass unchanged.

**Results at `cd04074`:**
- **Unit and smoke:** typecheck is clean, and `npm test` passes in full (exit 0) with `SQLITE3_PATH` set.
- **SQLite WASM parity:** all 18 shared-core suites pass.
- **PWA browser suite:** 70 of 70 pass.
- **Electron:** the agent-workspace and app specs pass, 16 of 16.

**60-day persistent outcome (both engines):**
- 11 distinct stored items: 4 drafts, 4 contested (2 fork branches and 2 versions of one ID), 1 needs-rebase letter, 1 proposal and 1 pending orphan.
- 1 late downgrade.
- 3 runs, a repeat run with zero changes, and the restored copy identical.

## Known limits

- Material-draft promotion (#293) and evidence-proposal intake (#294) have no safe domain interface yet, so those items stay staged.
- Pending items whose source batch later disappears stay listed as pending with their content.
- Folder sync reads up to 5,000 files and 256 MB per run. Quarantine keeps up to 512 KiB per batch and 64 MiB in total; larger items keep their digest and size, and the file stays in the agent folder.
- Export IDs use a timestamp plus a random suffix, and the build label is generic (`job-ranger-app`).
- Electron e2e needs `SQLITE3_PATH` (or sqlite3 on PATH) in development runs, like the other suites.
- On the sqlite3 CLI engine, text containing NUL is stored intact but `-json` reads it back truncated at the NUL (review N3). WASM is exact.
- The ledger's representative content hash for an operation with several conflicting versions depends on arrival order. Eligibility and stored versions do not.

## Independent review

Adversarial reviewer, separate from the implementer, working only from probes and reading code.

1. **VETO at `e43720f`.** Five confirmed defects:
   - a schema-valid 7- or 128-character batch ID blocked every sync;
   - stdin text mode on Windows dropped CR, and Ctrl-Z broke a sync;
   - a pending or refused variant was not counted, so a later different version imported cleanly;
   - a kept draft stayed eligible after a late conflict;
   - a sync overwrote a decision made while it ran.

   Fail-first regressions at `5707945` (RED 9/9), fixed at `edf2a08`. The fix also covered several non-blocking notes, and made the page lazy-loaded after a start-up timing regression.
2. **VETO at `edf2a08`.** All five confirmed fixed, but the `char()` literal fix broke storage of text with about 500 or more lines (N1, blocker). Also N2 (a contested pending item could be kept) and N4 (column migration). Fixed at `cd04074` with fail-first tests.
3. **PASS at `cd04074`.** Re-checks on both engines: the depth, stdin, CAST-context, re-keep, race, forged-plan and claim probes, and the transaction-caller smoke suites. No new defects.

## G4

See [`docs/design/DRIVE_G4_TRANSPORT_PLAN_286.md`](../design/DRIVE_G4_TRANSPORT_PLAN_286.md). It is not started and not authorized.
