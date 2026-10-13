# Agent workspace: local implementation record (#285 G1, #286 G2)

**Status:** implementation candidate on `impl/286-agent-workspace-reconciliation`; independent implementation/security review **PASS at `1d1d5e2`** (after VETO at `e36349f`). **Not merged, not released, not connected to Google Drive or OAuth.** It implements the *draft* contracts read-only from `design/285-drive-agent-document-contract` @ `10301a7`; those contracts are not yet normative (#255, #256).

## What exists

All code is provider-free TypeScript in `src/agent-workspace/` (Web Crypto; runs in Electron, the PWA worker and Node). Nothing writes canonical SQLite/OPFS data.

| Module | Behavior |
| --- | --- |
| `strict-json.ts` | UTF-8 without BOM, duplicate-key rejection at any depth, prototype-free objects, safe integers only, no lone surrogates, nesting and string limits. |
| `schema-v1.ts` | Closed validators transcribed from the draft `jr-agent-operation-batch` and `jr-agent-export` schemas; provisional `jr-agent-batch-commit` marker (see ambiguities). Unknown fields, kinds and versions fail with path-specific diagnostics. |
| `exporter.ts` | Selective, deterministic packet: typed records with `record_id`, `revision`, `authority_state`, `provenance`; untrusted job text labelled; manifest with byte lengths and SHA-256; local export receipt with record revisions. |
| `verify-export.ts` | Verifies a packet against the **local receipt** first, then file bytes against manifest entries. |
| `reconcile.ts` | Long-gap reconciliation: receipt binding, commit-marker completeness, operation-ID + content-hash de-duplication, conflict rejection, causal history, forks, stale evidence, staged consequential proposals, explicit per-kind standing policy, idempotency ledger. |
| `snapshot.ts` | Reads canonical data only through existing service `list`/`get` methods. |
| `scripts/agent-workspace-cli.mjs` | User-invoked offline `export`, `validate-batch`, `reconcile`. Reads only the workspace folder (realpath containment, links refused), never writes into it. No server, network or OAuth. |

### Export minimisation (default)

Included when selected: target tracks; `user-confirmed` (`authority_state: confirmed`) and `user-authored` (`user_authored`) Career Evidence with source artifact IDs, locators and relations; selected job postings (`observed_external`, `content_trust: untrusted_external_text`); resume template metadata; selected resumes with statement evidence references and revisions; Truth and Parseability Gate results (`job_ranger_deterministic_result`); selected cover letters with per-section evidence revisions and `stale` status; agent guide; schema documents.

Excluded: Career Profile identity (name, home location, radius), resume contact snapshots, application records and private notes, credential numbers, `imported`/`inferred-pending`/`rejected` evidence, raw source text and original file names, unselected jobs, resumes and letters, backups.

### Reconciliation outcomes

| Outcome | Meaning |
| --- | --- |
| `imported_draft` | Valid agent-owned work of a kind the user opted into; placed in the isolated agent draft namespace, `gate_status: not_checked`. |
| `staged_draft` | Valid agent-owned work not auto-imported (no standing permission, fork, unknown opportunity, or predecessor not imported). |
| `staged_for_review` | Consequential: application status claims and Career Evidence proposals. Never applied. |
| `needs_rebase` | References a stale or unconfirmed evidence revision, or a proposal's base revision changed. Text preserved. |
| `pending_predecessor` | Causal predecessor not yet available (for example in an incomplete batch); retried next run, not ledgered. |
| `already_reconciled` | Same operation ID and content hash as an earlier run. |
| `rejected` | Operation-ID conflict, canonical record ID shadowing, kind change on a record, invalid base revision, predecessor on another record, predecessor cycle. Every rejected operation is quarantined with its content, and its batch carries an `operations_rejected` warning. |

Batch-level: `rejected` (schema, location mismatch, unknown export receipt, manifest digest mismatch, batch-ID conflict) or `incomplete` (commit marker missing/invalid/mismatched, attachment missing or digest mismatch). Original bytes are kept in quarantine.

## Evidence (local, Windows 11, Node 24.19)

- Fail-first: commit `89f5bbf` added the tests; all failed (`ERR_MODULE_NOT_FOUND`) before the implementation.
- `npm run typecheck` clean; `npm run test:unit` passes, including:
  - `agent-workspace-export`: determinism, purity (deep-frozen input), receipt verification, tamper/missing/forged-manifest detection, minimisation, selection errors.
  - `agent-workspace-validation`: 25+ negative cases (duplicate keys, BOM, invalid UTF-8, unknown fields/kinds including `__proto__`/`toString`, gate `PASS`, status outside the enum, limits, timestamps, non-https links, duplicate operation IDs, attachment path and media-type rules).
  - `agent-workspace-60-day`: the 13-step acceptance scenario below.
  - `agent-workspace-snapshot`: read-only service use; content-derived revision.
  - `agent-workspace-reconcile-rules`: one assertion per integrity rule; a mutation run removing each of 16 rules (shadowing, kind conflict, manifest mismatch, predecessor record, ledger batch-ID conflict, marker digest, location, missing marker, base_revision, unknown application, cycles, operation quarantine, ledger and receipt validation, stale evidence, forks) fails a test every time; a 10,000-link chain reconciles in about 0.4 s.
  - `agent-workspace-cli`: export bytes match the manifest; reconcile is read-only over the workspace (byte/mtime snapshot unchanged); a Windows junction to an outside attachment is refused (mutation check: disabling containment fails the test); idempotent second run; consequential kinds cannot be auto-imported.

60-day scenario result (run 1): `imported_draft 3, staged_draft 2, staged_for_review 3, needs_rebase 2, pending_predecessor 1, duplicates 1; batches accepted 5, incomplete 1, rejected 1`. Canonical data identical before and after. Run 2 with the ledger: no new imports; ledger unchanged. Reordered discovery: identical report. Later op-ID reuse with other content: rejected as conflict. Re-uploading the intact attachment completes the held chain.

## Schema and contract ambiguities found (proposed for #286; draft files not edited)

1. **No commit-marker schema.** The reconciliation draft requires a "final commit marker" with batch and attachment hashes; none exists. Implemented provisional `jr-agent-batch-commit` v1 at `<batch_id>.commit.json` beside the batch.
2. **Batches cannot reference attachments.** `material_draft_version` has no attachment field; attachments are bound only through the commit marker. Proposed: optional `attachments: [{path, sha256, bytes, media_type}]` on draft payloads.
3. **`claimed_status` vocabulary differs from `ApplicationStatus`** (`drafted/submitted/interviewing/offered` vs `interested/applied/interview/offer`). Implemented mapping: drafted→interested, submitted→applied, interviewing→interview, offered→offer.
4. **`base_revision` for agent-owned records is undefined.** Implemented: must be `null` for agent-owned kinds and status claims (causality uses `previous_operation_id`); for `evidence_change_proposal` it is the canonical evidence revision being corrected.
5. **New evidence proposals need an `evidence_id`.** The schema requires one even for a qualification that does not exist yet; implemented as an unknown ID flagged `proposes_new_evidence`. Proposed: `evidence_id: null` with `proposal_kind: "new"`.
6. **No Career Profile or application scope in the export enum.** Agents cannot learn application IDs (needed for status claims) except through cover-letter records; Career Profile direction (titles, skills, sectors) has no scope. Exported nothing beyond the enum; proposed `career_direction` (identity-free) and `selected_applications` (no notes) scopes.
7. **Evidence revision mechanism.** Implemented as `updatedAt`, matching application-material staleness; a monotonic revision counter would be more robust.
8. **No canonical source revision.** Implemented as `sha256:` digest of the gathered snapshot.
9. **Fork and conflict policy** is described in prose only. Implemented: same-predecessor siblings are forks (staged, all preserved); same operation ID with different bytes is rejected for every occurrence unless a ledger entry fixes the original.
10. **Proposal schema (`jr-agent-proposal` v1) overlaps `evidence_change_proposal` operations.** The engine handles consequential changes as batch operations; separate proposal files and the `proposals/` folder are not yet ingested.
11. **Unschematised local formats.** `jr-agent-export-records`, `jr-agent-export-receipt` and `jr-agent-reconcile-ledger` exist only in code; receipts and the ledger are validated as closed local formats.
12. **First-writer priority for operation IDs.** An operation ID seen twice with different bytes in one run rejects both copies (no ordering authority exists), so a second agent can block the first agent's operation. Both copies are kept in quarantine. A per-actor ID namespace would remove this.
13. **Discovery path is normative in practice.** Batches must live at `workspace/agents/<actor_claim.actor_id>/batches/<batch_id>.json`; `workspace_id` is not checked and `previous_batch_id` only warns.
14. **`excluded_by_default`** always lists every exclusion class, even ones irrelevant to the selected scopes.

## Independent review

- **VETO at `e36349f`.** Five defects confirmed:
  - rejected operations dropped from all output (MAJOR);
  - stack overflow on hostile predecessor chains, which crashed the CLI (MAJOR);
  - eleven integrity rules untested (MAJOR);
  - cycles left pending forever (MINOR);
  - malformed ledgers crashed reconciliation (MINOR).
- **Corrected in `1d1d5e2`** (see commit message).
- **Re-review: PASS at `1d1d5e2`.**
  - None of the five defects reproduces.
  - API: a 50,000-link chain reconciled in about 2 s.
  - CLI: a 50,000-link chain across 501 batches exited 0 in 2.6 s, with the victim batch reconciled.
  - 11 reviewer-chosen rule mutations were all caught.
  - 60-day outputs are byte-identical to the previous engine, apart from the new `warnings` field.
  - Forks across runs and ledgered predecessors behave correctly.

Remaining reviewer observations, not defects:
- the CLI holds a batch's attachments in memory;
- hard links are not detected (not reachable through Drive);
- staged items are not persisted between runs;
- free text may contain NUL or bidirectional control characters;
- all target tracks, including constraints, are exported when the scope is selected.

## Capability boundaries

- A cloud agent with only Drive access can write valid batches but cannot run these validators; its gate fields stay `not_checked`.
- A local agent on the user's machine can run the CLI. That is user-invoked; there is no background service and no write API.
- Nothing here applies a draft or proposal to canonical data. A later UI step must route acceptance through existing services (Career Evidence review, application lifecycle, materials) and their approvals.

## Remaining work before real Google Drive use (G3/G4)

- Persisting receipts and the ledger in local storage (both runtimes) and a review UI for staged items.
- Applying accepted drafts through existing services with explicit user approval.
- Drive transport: user-selected visible folder, `drive.file` only, provider file/folder IDs and parent verification, append-only uploads with commit marker last, download and re-verification, pagination, eventual-consistency handling, permission loss/recovery, separate agent authorization.
- OAuth custody: Windows-native PKCE with OS credential storage versus PWA limits (no unattended closed-browser sync), and isolation of Google scripts from the Career Ops origin (#264). Draft PRs #260/#261/#262 remain unapproved.
- Trust bootstrap on a new device without the local receipt (#255).
- Retention/pruning (#251) and export trigger (#256) decisions.
