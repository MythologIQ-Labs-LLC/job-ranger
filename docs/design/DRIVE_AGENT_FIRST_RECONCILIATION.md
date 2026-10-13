# Draft architecture: agent-primary continuity and long-gap reconciliation

**Status:** DRAFT 0.1; user-directed capability requirement, **not** shipped, security-approved or an implemented Google Drive sync service.  
**Tracks:** [#249](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/249), [#285](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/285), [#286](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/286).  
**Foundational contracts:** [Drive document interchange](./DRIVE_AGENT_INTERCHANGE_CONTRACT.md), [local Career Evidence authority](./CAREER_EVIDENCE_PERSISTENCE_CONTRACT.md), [existing backup/restore](./BACKUP_RESTORE.md).

## Product acceptance story: months without opening Job Ranger

1. A user completes initial career setup, confirms provenance-bearing Career Evidence and target tracks, and explicitly opts to publish selected data to `My Drive/Job Ranger/Agent Workspace`.
2. The user works with **one or several agents** through their own Drive-authorized platforms for **60 days** without Job Ranger running. Agents gather opportunities, annotate research, compare paths, manage draft tasks/follow-ups and iteratively author resume/cover-letter drafts. Versioned structured records and attachments accumulate in Drive with no dependence on a local Job Ranger process. An agent that lacks a running deterministic validator labels factual/gate decisions `NOT CHECKED`.
3. The user also edits some records locally on another day/device, or the original export becomes stale. At next launch, Job Ranger reads only complete, validated Drive batches, detects forks and changed source revisions, imports allowed nonconflicting agent-owned work as new workspace drafts, and stages conflicting/consequential changes for review, **without discarding 60 days of work**.
4. The same process is idempotent after an interrupted sync, a restart and a second import. The UI shows new/updated/stale/conflicted/rejected records with provenance; resume and Career Evidence authority never change from an agent's own assertion.

**Sufficient agent utility requires editable agent-owned structured workspace data, not only one-off suggested paragraphs.** Drive is a durable *workspace* for agent-created content; it is **not** an untrusted database engine that may write Job Ranger's canonical SQLite/OPFS directly.

## Authority classes and default standing capability matrix

| Operation class | Agent may perform while Job Ranger closed | On reopening Job Ranger | Why |
| --- | --- | --- | --- |
| New/revised research note or opportunity annotation | Yes, append new typed version | Auto-stage as agent work; can automatically import to *agent-owned draft namespace* if user opted into narrow standing permission; never mark a source verified | Useful without falsely validating scraped information |
| Resume/cover-letter/worksheet/interview preparation draft | Yes, append version with evidence refs and source export ID | Import as **draft** after structural, hash and provenance checks; mark Truth/Parseability `NOT CHECKED` pending deterministic rerun | Long-term meaningful work without bypassing fact gates |
| Follow-up plan/reminder suggestion | Yes; durable agent-workspace record | User-configurable bounded import as *proposed* plan, never automatically claiming contact occurred | No fabricated contact/application history |
| Tracking observed or claimed application events | Yes, as **claimed/unverified event**, preserving exact source/user statement | Human attestation and existing application workflow required to mark `submitted`, `interviewed`, `offered` or similar consequential canonical status | Drive actor is not cryptographic proof of actual application submission |
| New/edited Career Evidence or source approval | Yes, as typed *proposed correction/new claim* with source references | Existing user confirmation, source provenance and deterministic validation mandatory; never auto-promote | Prevent evidence laundering |
| Approve materials, submit applications, delete/correct authoritative records, revoke/scope OAuth | **No**, not on a standing Drive capability | Must be performed via separately authorized trusted runtime and explicit user action | High-consequence authority cannot be self-declared by agent |

The table is **proposed policy**, not a user authorization configuration or active capability. A user's standing permission must be a local, versioned opt-in **per class**, with clear revocation, allowed material classes and an import audit; no Drive JSON field can grant it. The agent may still interact meaningfully through the Drive workspace when Job Ranger is closed, but `agent-built` is never synonymous with `confirmed by Job Ranger`.

## Explicit namespace and logical folder separation

```text
Job Ranger/
  Private Backups/                         # full .jobranger; never automatically shared with agents
  Agent Workspace/
    README.md
    agent-guide.md
    schema/
    exports/<export_id>/                   # immutable Job Ranger-generated snapshot / source receipts
    workspace/
      agents/<agent_id>/batches/<batch_id>.json   # immutable versioned operation batches
      attachments/<content-hash>/...      # complete hash-verified attachments; never executable
    proposals/<proposal_id>.json          # consequential operations requiring human review
    imports/                              # locally emitted reconcile receipts, non-authoritative to agent
```

Directories are a **discovery convention**. Drive controls actual containment via file ID and parent IDs; folder names, document titles and claimed agent IDs do not establish security authority. Google Drive permissions can allow writers to replace files; treat immutability as a *protocol invariant checked by receipts and hashes*, not as a magic storage guarantee. Never repair overwritten source manifests by trusting a Drive copy over the local receipt.

**Do not share the complete backup folder to solve workspace completeness.** A selectively shared corpus can include explicit identity-sensitive records only after informed consent; none is inferred from an agent's request.

## Proposed append-only operation batch: `jr-agent-operation-batch` v1

Draft JSON envelope schema: [`schemas/jr-agent-operation-batch-v1.schema.json`](./schemas/jr-agent-operation-batch-v1.schema.json). It permits specific, bounded kinds of work, with a single structural schema and narrow per-kind payload unions; future kinds require explicit schema/version governance.

Each batch records:

- `batch_id`, `workspace_id`, `source_export_id`, `source_manifest_sha256`, claimed `actor_id`, creation timestamp and optional causal `previous_batch_id`;
- bounded `operations[]` with globally unique `operation_id`, `record_id`, `base_revision` (null only on new agent-owned drafts), `kind`, content payload and relevant source `evidence_refs`;
- reference revisions and artifact SHA-256/byte length where external materials are included, plus explicit `NOT_CHECKED` for any attempted Job Ranger-only gate outcome;
- no permission grants, `confirmed`, `submitted`, `approved`, `merge`, `delete`, arbitrary script, SQL, expression evaluator or executable tool directive.

A batch is a claimed record of work, **not a Job Ranger import receipt or model identity credential**. Validate UTF-8 with no BOM, duplicate JSON keys, closed fields, correct integer bounds, known schema version, exact item media types and safe paths. Strict JSON Schema alone is insufficient for unique operation IDs across batches, trustworthy user statements, canonical source checks, safe path resolution, prompt-injection defense and atomic apply.

## Long-gap reconciliation algorithm (proposed behavior)

**Do not depend on one global mutable `current.json` file or timestamp order.** Agents can write unrelated branches offline. Reader enumerates complete versioned batches from configured parent folder IDs; a separate *final commit marker* (containing hashes/byte lengths for the immutable batch and attachments, published **last**) signals completeness. Missing marker, mismatched content or missing referenced attachment means `incomplete/quarantined`, never a partial import. This must be tested with actual Drive eventual visibility/concurrency behavior; do not assume a multi-file transaction.

1. **Discover:** list bounded, paginated batch inventory with opaque Drive IDs, enforce expected folder containment and MIME. Ignore/reject Google-native document conversions in the machine-readable contract. Never download unknown file types or follow external URL references automatically.
2. **Validate:** parse closed envelope + semantic policy. Recompute actual byte hashes; check a locally anchored trusted export receipt rather than an agent-supplied digest. Validate all per-record references before applying any change.
3. **Build history:** de-duplicate by stable `operation_id` and immutable content hash, detect same ID with different bytes as a conflict, reconstruct per-record causal order using predecessor/base revision, and record forks. Times are for display only; they do not resolve competing writes.
4. **Reconcile:** independent new agent-owned notes/materials may be imported to a segregated draft namespace under consented standing rules, even when original export is months old; **stale base does not mean discard all accumulated work**. For a record changed canonically since export, preserve both alternatives, mark `needs_rebase` and ask for field-level user review. Agent-provided records never overwrite canonical evidence by last-write-wins.
5. **Adjudicate:** any factual claims attached to resumes, application status, qualifications or approved materials must use the existing deterministic source, Truth/Parseability and user-approval path. If that path cannot execute (e.g., cloud agent cannot run local core), label the check `NOT CHECKED`; never invent a PASS from an agent.
6. **Apply atomically:** stage complete validated operations, show import plan, commit only allowed per-class changes under the actual current local data revision, and emit a local receipt recording applied/staged/conflicted/rejected IDs. On crash, idempotently resume or roll back so the second run makes no duplicate writes.
7. **Refresh:** after successful reconciliation, Job Ranger can publish a *new* immutable export and reconcile summary; agents can base later work on it. Never rewrite prior exports or erase agent history as part of refresh.

An optional **user-invoked local headless CLI** should execute the **same** deterministic importer/validators as the UI, enabling an agent operating on the user's authorized machine to reconcile without opening the graphical interface. This is not equivalent to remote Drive access running the local core, and a fully unattended background service is a separate credential/session security decision.

## Contract-hardening findings for real attachments and batch completion (audit draft)

The original versioned batch schema covered typed text operations but did not yet describe how binary/text attachments can be **content-verified** when an agent works without Job Ranger running. The audit lane proposes an optional closed `attachments[]` declaration on `jr-agent-operation-batch` v1, a `material_draft_version.payload.attachment_sha256` pointer, and a separate [`jr-agent-batch-complete` v1](./schemas/jr-agent-batch-complete-v1.schema.json) JSON marker written **last** after all attachment and batch bytes. The [draft operation schema](./schemas/jr-agent-operation-batch-v1.schema.json) bounds size, MIME types and paths. This is **not** a claim that Drive behaves transactionally or that a marker is an authenticated user approval.

Deterministic import must verify a complete marker for each declared batch, exact expected parent folder/file IDs, actual provider MIME types, downloaded raw byte length and SHA-256 for every declared file, unique attachment paths/digests, valid batch ownership linkage, and content-addressed matches to the locally trusted receipt when relevant. A JSON Schema-only PASS **does not** establish any of these facts. Missing attachment, converted Google Doc, duplicate filename with different content, absent final marker, stale canonical record revision or operation-ID collision means no partial canonical application; retain recoverable diagnostics. A third-party writer with edit/delete access could remove historical batches: the append-only convention alone cannot guarantee retention against a malicious or malfunctioning writer. Explicit backup and export-history policies must address that limitation, rather than falsely promising immutable Drive storage.

Independent [adversarial fixture corpus](../../tests/fixtures/agent-workspace/governance-vectors.v1.json) defines **31 input vectors** and **seven multi-step scenarios**, including structural invalidity, syntactically valid privilege spoofing, fake but valid-looking hashes, duplicate operation IDs, 60-day reconciliation, multi-agent forks and content-loss recovery. The [standalone subset schema probe](../../tests/agent-workspace-governance-corpus.test.mjs) is developer-only. These are draft contract changes awaiting genuine runtime and independent security review, not a certified implementation.

## Failure and threat matrix

| Condition | Required result |
| --- | --- |
| Two agents edit the same draft from revision A | Fork marked, neither silently overwrites the other; deterministic/no-loss comparison |
| Agent edits a two-month-old base after a local evidence correction | Preserve original draft text; mark source-derived claims stale and require revalidation |
| Batch succeeds but an attachment is missing or edited | Entire batch not imported; recoverably incomplete |
| File is renamed or converted into Google Doc | No machine import; report MIME/path mismatch |
| A batch ID or operation ID is replayed with different content | Reject conflict; no last-writer overwrite |
| User revokes Google OAuth / agent loses access | Agent work already stored remains readable according to existing Drive permissions; Job Ranger continues locally, imports only when authorized again |
| Job Ranger starts without Drive or offline | No local regression; existing canonical workspace and manual backups work |
| Agent invents `user_approved=true`, `TruthGate=PASS` or permission scope | Closed schema rejects unknown fields or status, trusted service still ignores any model self-assertion |
| Prompt injection in a job description or Google Doc | Treated as untrusted data, never an instruction source for Job Ranger or validator |
| Temporary Drive list order changes, two concurrent batches, clock skew | Use per-record base refs and operation IDs, not mtime or listing order |
| Imported draft already accepted in a prior run | Report already-applied by local receipt; never duplicate canonical writes |
| Stored export receipt missing on a different device | Do not trust a matching remote hash as authentication; require explicit user-proved local backup/restore or separately accepted trust-bootstrap process |
| Two devices each treat themselves as canonical | Do not auto-merge authoritative Career Evidence; stage portability/recovery conflict for deliberate user review |

## Delivery stages / acceptance, kept separate from production release

- **A. Schema and test harness:** closed JSON v1 operations, synthetic Job Ranger export, fake agents producing ~60 days of append-only work, 2-agent fork, corrupted/replayed batches, a stale/changed local record and deterministic reconciliation report; one test proves zero canonical mutations for unapproved changes.
- **B. Working local export + intake:** real draft namespace, receipt/idempotency ledger and UI review screen; headless CLI path if proven to reuse the same domain core and user permissions. Fail closed on stale source/revision, support lossless draft recovery.
- **C. Drive OAuth + transport:** user-visible folder, actual real-Google-client consent, minimal `drive.file` per app-created file access, correct provider verification, upload/commit-marker/download and independent authorized agent read/write. PWA and Windows-native token custody are different; no fictitious browser refresh-token persistence. Handle cross-origin script isolation #264.
- **D. Two-month agent-first acceptance:** after initial setup, do not open Job Ranger for 60 simulated days, have a separately authorized agent conduct useful structured work, then reconcile, inspect conflicts, verify unchanged authoritative data and run no-Drive recovery and cross-runtime archive tests.
- **E. Independent security review:** reject unsafe elevated/malformed operations, inspect trust boundary, data export minimization and real folder permissions; only then may the owner approve merging or treating agent-first mode as part of the next release.

## What remains deliberately undecided

Agent-owned working records versus canonical import classes need final risk-tier policy and UX; OAuth, consent persistence, retention/pruning #251, trust bootstrap onto a new device, Drive commit markers, ability to verify real user attestation from a remote agent interface, and whether a headless local verifier can be used on a remote worker require explicit design review. **Do not claim all agent services or Drive connectors support reading/writing arbitrary JSON files.** Verify actual provider capabilities with one end-to-end consumer. Existing MCP work can remain an optional live querying path, not the required agent-first integration.

This design intentionally expands the earlier **proposal-only** language in the interchange draft. Consequential *canonical* operations remain proposals, while well-scoped *agent-owned workspace* records may be authored and maintained over time. Both retain the same strict JSON formatting and deterministic validation boundaries.
