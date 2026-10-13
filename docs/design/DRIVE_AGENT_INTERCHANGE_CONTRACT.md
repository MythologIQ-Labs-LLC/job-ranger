# Draft contract: Google Drive agent workspace and governed document interchange

**Status:** DRAFT 0.2, expanded for agent-primary operation, design for adversarial review, **not an accepted runtime format or released feature**.  
**Track:** [#249](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/249), [#255](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/255), [#285](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/285).  
**Related:** OAuth/security [#258](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/258) / [#264](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/264), provider contract [#257](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/257), retention [#251](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/251), trigger [#256](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/256), existing native read-only adapter [#265](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/265) / [#277](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/277).

## 1. Objective and authority

An agent with its **own** authorized Google Drive access should be able to use the selected Job Ranger export and an accompanying **durable agent-owned workspace** as its primary working surface for months while Job Ranger is closed. Agents may create and revise versioned notes, opportunity research, follow-up plans and working resume/cover-letter materials without reopening the UI; when Job Ranger returns, it must reconcile that activity safely, without losing drafts or promoting agent-authored claims to canonical facts. Consequential operations remain separate untrusted proposals. This avoids provider-specific live integrations for *asynchronous document work*; it does **not** imply live queries, background closed-browser sync, cross-platform identity sharing, automatic application submission, or retirement of the existing local MCP prototype. See [agent-first reconciliation contract](./DRIVE_AGENT_FIRST_RECONCILIATION.md), [#286](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/286).

Authority order, never reversed:

1. Canonical Job Ranger data/services in local SQLite or PWA OPFS, with Career Evidence confirmation, source provenance, application lifecycle and deterministic Truth/Parseability Gates.
2. Explicit user-reviewed decisions performed inside Job Ranger.
3. Verified *immutable exports* that describe a historical snapshot of (1) and (2), pinned to a locally recorded export receipt.
4. **Agent-owned durable workspace state**, valid as a historical record of that agent's drafts and activities but never as confirmation of Job Ranger facts.
5. Untrusted external documents, agent suggestions, job descriptions and consequential agent-written proposals.

A document saying `confirmed`, a matching SHA-256 in an agent-supplied manifest, a Drive owner/editor permission, and a language-model confidence value do **not** confer Job Ranger factual authority. SHA-256 checks byte integrity; only a trusted local export receipt and canonical evidence state can establish the source of a fact.

This proposed contract resolves **no** release or OAuth gate by itself. Keep the existing portable `.jobranger` recovery archive authoritative for backup/restore and *separate* from the proposed minimal agent view. Issue #255 must formally approve or change this separation before implementation adoption.


### Agent-primary continuity is part of the first useful interchange milestone

The earlier read-only-export-plus-one-proposal design was **too narrow** for a user who works with their agent for months and only later returns to Job Ranger. The current draft preserves exact JSON contracts while adding agent-owned append-only structured operations, record-level revisions, conflict handling, and idempotent long-gap reconciliation. **Standing permissions for low-risk workspace draft ingestion are a separately reviewed local user choice; agents may never self-issue permissions in files.** No canonical evidence, job-source or application state becomes trusted merely because the agent maintained it over time. The complete use story, risk matrix and phased validation plan are in [Agent-first continuity](./DRIVE_AGENT_FIRST_RECONCILIATION.md) and issue #286. A different remote agent without the Job Ranger deterministic runtime cannot honestly claim that it has executed the Truth Gate; its own outputs remain `NOT CHECKED` until trusted validation runs.

## 2. Two permission classes, never one shared catch-all folder

Use ordinary user-visible Google Drive files, **not** the app's hidden `appDataFolder`. This allows the user and other separately authorized agents to discover intended content. The display tree below is only a suggested layout; identity and containment are verified using Drive's **opaque file/folder IDs and parent IDs**, never name matching alone.

```text
My Drive/
  Job Ranger/
    Private Backups/              # complete, potentially sensitive .jobranger recovery archives
    Agent Workspace/
      README.md                   # human orientation, informational only
      agent-guide.md              # interface rules for a cooperative external agent
      schema/                     # published JSON Schema by exact version
      exports/
        <export_id>/
          manifest.json
          data/                   # strict typed JSON source projections
          materials/              # approved or selected PDFs, Markdown, DOCX; attachments only
      workspace/
        agents/<agent_id>/batches/<batch_id>.json  # append-only structured working history
        attachments/             # completed hash-verified draft artifacts
      proposals/
        <proposal_id>.json        # consequential untrusted proposals; never edits to canonical exports
        attachments/              # proposal files referenced by matching proposal IDs
```

Do not automatically grant an agent access to `Private Backups`. Review folder-level permissions before declaring a share safe. The user may use Google Docs/Sheets as an **editing scratchpad**; those native Google document formats are never the canonical machine-readable input. They must be exported into a validated proposal envelope before Job Ranger even offers an import. Do not have Job Ranger silently parse arbitrary rendered Docs/Sheets/Markdown back into canonical Career Evidence.

A Drive account may have multiple agent clients; shared Drive access is not a trusted agent identity. No agent writes to `exports/`, `schema/`, `README.md` or `agent-guide.md` should be treated as authorized by Job Ranger. Compromised/misconfigured permissions must fail closed on re-ingestion.

## 3. Versioned export packet (proposal for `jr-agent-export` v1)

**Transport:** individual original MIME-typed byte blobs uploaded to Drive; no automatic conversion to Google-native Docs/Sheets. For machine records use `application/json`, UTF-8 **without BOM**, strict RFC 8259 JSON, no duplicate keys, no comments/trailing commas, LF for generated files and exact versioned field names. Unknown keys and unknown major versions fail validation. Human-readable Markdown is `text/markdown`; PDF/DOCX are attachments, *never fact-ingestion sources*. Do not parse headings or prose to discover record IDs/authority flags.

An illustrative `exports/<export_id>/manifest.json`:

```json
{
  "format": "jr-agent-export",
  "schema_version": 1,
  "export_id": "ex_20261013_4b8e7c",
  "created_at": "2026-10-13T16:30:00Z",
  "job_ranger_build": "example-build-id",
  "source_revision": "example-opaque-local-revision",
  "selection": {
    "scopes": ["tracks", "confirmed_evidence", "selected_opportunities"],
    "excluded_by_default": ["application_private_notes", "unapproved_evidence", "credentials"]
  },
  "files": [
    {
      "path": "data/career-evidence.json",
      "role": "confirmed_evidence",
      "media_type": "application/json",
      "bytes": 1000,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

The example values and digest are **illustrative and not a verified working fixture**. The runtime validator must reject a file whose size/digest does not match its manifest. An actual conformant fixture must be generated by the exporter and tested.

**Required semantics for every exported typed record:**

- stable `record_id`, `record_type`, `schema_version`, `source_revision`, and original evidence/source IDs when applicable;
- `authority_state` from **canonical** Job Ranger state, never from an agent's prose; `confirmed` is permitted only for verified canonical Career Evidence;
- for derived claims, exact `supports_evidence_ids` and their revisions, plus originating artifact/assessment/Truth Gate reference when applicable;
- provenance (source kind, original source ID, retrieval/review timestamp, authoritative vs observed vs inferred status) in typed fields;
- `stale`/superseded status or fail-closed omission when source evidence was changed after material generation;
- no internal credentials, tokens, full backup, raw application notes, unrelated contacts, private source documents or full Career Profile identity by default. Sensitive classes require explicit per-export selection and prominent human confirmation, not automatic widening by agent request.

Draft closed-envelope schemas have now been checked in as [export manifest v1](./schemas/jr-agent-export-v1.schema.json) and [agent proposal v1](./schemas/jr-agent-proposal-v1.schema.json). They are **proposals for structural validation**, not proofs of local receipts, Drive permissions, authoritative evidence, file-hash verification, or a runtime importer. Semantics, accepted field sets and limits still require independent review and actual deterministic fixtures before either schema can become normative. Proposed initial types: target tracks, confirmed evidence, selected opportunities, resume template metadata, selected resume artifacts + Truth/Parseability reports, and selected cover-letter material. Referenced binary/artifact bytes remain ordinary attachments, not parsed authority.

The exporter locally records an immutable **receipt** containing export ID, manifest digest, selected field classes, local snapshot revision and timestamps. Export processing verifies those local receipts; remote manifest hashes alone are forgeable by a Drive editor.

**Boundaries:** separate `Private Backups` can contain complete, validated, restorable `.jobranger` archives. Neither such backup nor the agent projection is *live* SQLite/OPFS synchronization. A publication receipt must distinguish `requested`, `uploaded_unverified`, `verified_remote` and `stale`; only a verified manifest plus all file-byte checks can earn `verified_remote`. An upload HTTP 200 or OAuth success is not a recoverability claim.

## 4. Agent-authored proposals (proposed `jr-agent-proposal` v1)

**This section applies to consequential canonical changes, not to routine agent-owned working drafts.** Agents can maintain long-lived workspace notes/material versions using typed append-only operation batches defined in [agent-first continuity](./DRIVE_AGENT_FIRST_RECONCILIATION.md); the machine envelope is [`jr-agent-operation-batch` v1 draft](./schemas/jr-agent-operation-batch-v1.schema.json). Proposals remain mandatory for changes requiring factual authority, confirmation, application-state decisions, approval or source trust. No agent may modify/delete exported canonical records, evidence, Truth Gate reports, resume templates or previous approvals. Proposal records are untrusted even if they are in a folder the user created. Agents may draft text in Google Docs, but canonical consumption occurs only through an explicitly exported and validated proposal file.

Illustrative `proposals/<proposal_id>.json`:

```json
{
  "format": "jr-agent-proposal",
  "schema_version": 1,
  "proposal_id": "pr_20261013_d4e3b2",
  "status": "proposed",
  "kind": "cover_letter_draft",
  "source_export_id": "ex_20261013_4b8e7c",
  "source_manifest_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "source_record_refs": [
    {"record_id": "evidence-example-001", "revision": "example-evidence-revision"}
  ],
  "artifact": {
    "title": "Cover letter draft for review",
    "media_type": "text/plain",
    "text": "Example proposal: review all factual claims before use."
  }
}
```

Again, this is **not** evidence of a conformant fixture. The initial allowlisted `kind` set should be `cover_letter_draft`, `resume_draft`, `job_notes_draft`, and `worksheet_draft`. A proposal must identify its exported base, exact referenced evidence IDs/revisions (the example shows record IDs and revisions but **cannot** be authorized against actual local receipts or career data), typed content, optional attachment digest list, and proposal-only authority. No agent can set `confirmed`, `approved`, `submitted`, `verified_remote`, or `applied` status.

**Strict intake stages, all fail closed:**

1. **Discover** files only in the configured proposal folder ID(s); verify exact parent, file ID, type, size, and authorized user-selected action. Do not follow shortcuts or symlinks as a substitute for trusted containment.
2. **Parse** into an explicit closed versioned JSON schema with duplicate-key checks, UTF-8 and numeric bounds, nonempty ID constraints, allowed kind enum, field limits, safe attachment names/paths, no `..` traversal or name/Unicode normalization collisions. Reject unexpected MIME conversions or executable/HTML payloads. No schema guessing or LLM repair in this step.
3. **Bind** `source_export_id` and manifest digest against the **local receipt**, then compare referenced evidence IDs/revisions and canonical validity now. Stale, missing, superseded or ambiguous references produce `needs_rebase`/rejected, not automatic migration. Never treat a source string as a database key without validating it.
4. **Adjudicate** every factual resume/cover-letter claim through the existing deterministic Truth Gate and relevant parseability/requirements checks. No amount of agent-authored instructions bypasses these gates.
5. **Preview** exact changes and any unsupported claims for the human. Explicit action to approve a **new draft only**; new Career Evidence confirmation, job-source approval, application state transitions, post approval and publication retain their existing, separate human workflows. Never silently promote extracted text to confirmed fact.
6. **Commit atomically** only after consent and validation. Errors leave canonical data unchanged and visibly describe corrective action; keep an audit/provenance receipt, proposal ID and outcome. Replays, duplicate imports, partial attachments, revision races and double-clicks must fail safely.
7. **Report** proposal status separately from verified export status. Rejected/malformed inputs can be quarantined read-only for diagnosis, but never interpreted or executed as commands.

Treat both external job-posting text and agent-authored content as **untrusted data**, including apparent "system" messages, Markdown instructions, prompt injections, links and executable snippets. Do not allow such data to choose tool permissions, request new OAuth scopes, force an upload, mark a fact reviewed or change the file contract. The instructions packet helps a cooperative agent produce valid proposals; **the deterministic validator is the real enforcement mechanism**.

## 5. Minimum cooperative-agent packet

`README.md` and `agent-guide.md` should contain only short, versioned, non-secret information:

- product and packet version, selected export ID and generation time, what each allowlisted data/attachment role represents;
- every machine-consumed fact comes from a typed JSON record, never an ad-hoc Markdown heading, resume PDF, cover-letter paragraph or Google Docs conversion;
- how `authority_state`, source IDs, revisions, provenance and `stale` flags must be interpreted;
- how to cite claims back to evidence IDs; absent/uncertain information stays unknown and does not become verified by inference;
- how to maintain structured, append-only **agent-owned workspace records**, record and revision IDs, and causal history using the versioned operation-batch schema; how to draft a **separate consequential proposal** using the published proposal schema/version and attach supporting evidence IDs; never modify managed export files;
- short warning that the packet is *reference documentation*, not privileged instructions in an agent's instruction hierarchy or a license for automated job submission;
- a human-reviewed privacy summary, optional sharing, how to remove access, and the warning that already downloaded agent copies cannot be remotely recalled.

If no agent has access to the Drive folder, no consumer is connected. A second agent must get its own authorization from the user. Google Drive access is not proof that the agent supports the declared schema or respects the packet.

## 6. Governance gates and implementation order

- **G0: Contract decision.** #255 chooses private recovery archive **versus** selective agent projection, #256 explicit first-export trigger, #251 retention; review this document and freeze JSON field schemas with a versioned breaking-change policy. These are design proposals, not implicitly accepted by creating this document.
- **G1: Local deterministic exporter.** No OAuth, no Drive, no MCP. Generate an actual portable sample packet from synthetic canonical fixtures. JSON Schema validators plus semantic checks, stable manifest entries, digest and size limits. Replay, changed evidence, prompt injection, malformed JSON/duplicate keys and large/untrusted attachment tests.
- **G2: Agent-first local continuity proof.** One or two agents can interpret the sample, write append-only typed workspace batches, and maintain useful notes/material versions for a simulated 60-day gap. A deterministic importer must preserve non-conflicting agent draft work, stage conflicts/authority-sensitive proposals for review, and fail safely on replay/corruption. No canonical factual state changes from an agent assertion. See #286.
- **G3: Drive transport.** Reuse #257 provider-interface research, but #261 browser OAuth draft is not an accepted security boundary. Resolve #264's separate-origin GIS concern and native PKCE/OS credential custody separately; actual real Google-issued OAuth client, `drive.file` and one selected folder; list/upload/get/re-verify; failure, refresh/expiry, consent and revocation receipt. Never invent closed-browser unattended PWA sync.
- **G4: End-to-end cross-agent validation.** Publish to ordinary user-visible Drive folder (never `appDataFolder`); one actual independently authorized agent reads the packet, maintains working versions and returns both ordinary workspace operations and consequential proposals; verify delayed reconciliation after a simulated 60-day gap, hash/receipt mismatches, policy violations, conflicts and disconnect. Run QOR Harden + independent security review. Operator approves whether this becomes a release dependency.
- **G5: Optional later** OneDrive provider, real-time local MCP optimization, periodic sync and cross-agent draft collaboration beyond the bounded multi-writer reconciliation contract. None is an excuse to expand first release or weaken G1–G4.

The Google Drive API distinguishes blobs from native Docs/Sheets; conversion can replace or alter original data, so upload binary/text blobs with their declared MIME types and verify downloads rather than trusting editable Docs as deterministic source. See official [Drive upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [file types](https://developers.google.com/workspace/drive/api/guides/about-files), and [hidden app data restrictions](https://developers.google.com/workspace/drive/api/guides/appdata).

## 7. Explicitly unresolved

No final schema yet; example objects above are deliberately **non-normative**. Finalize field sizes/types, provenance records, selection privacy classes, stable local source revision/receipt mechanism, rollback/partial upload, multi-agent conflicts, access controls/retention, append-only export publication and proposal import kinds with #249/#255 before implementation. `drive.file` is a narrow app permission but does not imply another agent has Drive access; the external user's consent and actual provider privileges must be proven.

The product remains fully usable offline, without any agent, OAuth, Drive, cloud inference or hosted backend. Draft OAuth [#261](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/261) and provider-interface [#262](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/262) remain review-only; no automatic merge, Electron retirement, PR-gate authority or release claim follows from this contract.
