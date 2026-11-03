# Plan: Phase 13 - Adversarial review amendments to the inference contract

**change_class**: feature

**doc_tier**: standard

**terms_introduced**:
- term: InferenceAdjudicator
  home: docs/design/INFERENCE_CONTRACT.md
- term: inference capability report
  home: docs/design/INFERENCE_CONTRACT.md

**boundaries**:
- limitations: documentation-only; no code, dependency, provider, credential, network or schema-migration change
- non_goals: choosing a provider; designing PWA remote credentials; persisting provenance; any UI
- exclusions: Slice A implementation (#164) is a separate governed phase

**pr_target**: main (PR #163, branch `architecture/inference-contract`)

**iteration**: 4

Amended after the plan audit VETOs recorded at META_LEDGER Entries #68, #69 and #70; the cycle-count escalation ran `/qor-remediate`, gate `remediate.json`)

Completes the adversarial architecture and security review that PR #163 requires before merge (#162 acceptance criterion: "Implementation remains deferred until this contract receives adversarial architecture/security review"). Each defect found becomes a normative amendment to `docs/design/INFERENCE_CONTRACT.md`. The review record lives in the contract itself, so the PR, #162 and #164 can point at one place.

## Open Questions

None. Contract open questions that stay open are listed in the amended contract with the implementation surface each one gates.

## Evidence

- `docs/design/INFERENCE_CONTRACT.md` at PR head `96fcc8c` (Draft 0.1, 851 lines) is the review target.
- The deterministic Truth Gate is `ResumeService.evaluateTruth` (`electron/src/resume-service.cts:301-373`). It runs the unsupported-token check only when `statement.userEdited` is true (`resume-service.cts:335`, `if (statement.userEdited && resolved.length > 0)`). For statements that are not user-edited, it checks only evidence linkage and confirmation (`missing-evidence`, `unconfirmed-evidence`). Draft 0.1 says an inference rewrite "must pass the existing Truth Gate" but does not say which path. Evaluated as a non-edited statement, an inference rewrite that invents a metric would pass.
- `canEvidenceSupportFactualClaim` (`src/shared/career-contracts.ts:401-408`) admits only `user-confirmed` and `user-authored` evidence. That is the existing confirmation authority.
- Application materials compute `staleEvidenceIds` against section snapshots (`electron/src/application-materials-backend.cts:305-322`). That is the existing staleness model the contract cites.
- `tsconfig.electron.json` compiles `electron/src/**/*.cts` and `src/shared/**/*` into `electron-runtime/`. The PWA worker imports shared-core modules from `electron/src` (for example `src/pwa/adapters/sqlite.ts:7`). Shared-core inference code would therefore ship in both runtimes, which is why registering a test-only provider must be impossible in production builds.
- Draft 0.1 findings (each fixed by an amendment below):
  - F1: the Truth Gate path for inference text is unspecified; the token check is skipped for non-edited statements.
  - F2: the layering diagram routes the inference branch after the deterministic gate, and no dependency-direction rule keeps deterministic gates free of inference imports.
  - F3: Draft 0.1 says provider requests for more data or actions are "ignored" rather than rejected, and does not forbid chaining model output into later requests.
  - F4: the transmission manifest is declared beside the payload instead of computed from it, and consent is not bound to the manifest.
  - F5: local versus remote is taken from the adapter's own descriptor; a "local" endpoint can proxy to a remote service.
  - F6: the request lacks the task schema version and instruction template ID and version that provenance requires; requested and resolved model mismatch is undefined.
  - F7: provider error and warning text can carry prompt content into logs, failures or persisted records.
  - F8: provider confidence and relationship labels have no closed-schema prohibition and could reach assessment state.
  - F9: retries are "bounded and explicit in the adapter policy", so retry ownership and late responses are undefined.
  - F10: the location of the provenance store, how a provenance write failure is handled, archive inclusion, and the input hash's scope are undefined.
  - F11: runtime capability reporting has no shape, and nothing stops a test-only provider from being reported as available.
  - F12: Slice A does not bound its advertised tasks, IPC/UI surface, persistence or dependencies.
  - F13: the benchmark lacks held-out and frozen labels, per-category reporting, exclusion of demo fixtures, and a non-regression bar; "outcomes" is missing from the unsupported-claim list.
  - F14: URLs, contact details and paths in output are only "not fetched"; factual tasks do not reject them.
  - F15: staleness is checked at adjudication, but not again when the user accepts (time-of-check to time-of-use).
  - F16: the credential boundary does not exclude secrets from the request envelope, provenance or the settings hash input.
  - F17: the behavior of entry points when inference is unconfigured, refused, missing a key, or on an unsupported runtime is unspecified.
  - F18: the conformance list lacks out-of-scope IDs, more-data requests, external actions or URLs, confidence overriding unknowns, and template provenance.
  - F19 (from the Entry #68 audit): a loopback endpoint is the common proxy case, for example a localhost gateway that forwards to a cloud API. Hostname-based "loopback" also allows DNS rebinding and aliasing.
  - F20 (Entry #68): `ResumeStatementRewriteProposal.supportingEvidenceIds` need only be a subset of the request, which widens the gate's allowed-token pool. The allowed set is built from the union of resolved evidence (`resume-service.cts:336-353`). The existing write path `ResumeRepository.updateStatement(id, text)` (`electron/src/resume-repository.cts:241-253`) stores text and `user_edited = 1`, never evidence IDs.
  - F21 (Entry #68): no deterministic token gate exists for factual drafting outside resumes. Application materials check evidence currency only (`application-materials-backend.cts:305-311`). Career Stories check linkage and confirmation only (`electron/src/career-story-backend.cts:149-165`). Draft 0.1's "must pass deterministic support validation" for those tasks names a validator that does not exist.
  - F22 (Entry #69): explanation, prioritization and search-insight prose (Draft 0.1 :525-549) has no deterministic factual control. Labeling it as generated does not stop prose that asserts an unsupported career claim, contradicts a deterministic gap, or omits a blocker.
  - F23 (Entry #70): the two Slice A task schemas still carry free text with no deterministic factual control. These are `SemanticEvidenceSupportProposal.rationale` and `unknowns`, and `ResumeStatementRewriteProposal.rationale` and `unsupportedRequirementsAcknowledged` (Draft 0.1 :458-484). A rationale such as "you led a 40-person team" would reach the user beside an actionable proposal.
- `evaluateTruth` is an instance method of the SQLite-backed `ResumeService` (`resume-service.cts:179-193`) and ignores its `_projection` argument. Electron backup copies the live main database with `VACUUM INTO` (`electron/src/backup-service.cts:396`), so any table in the main database is exported.

## Locked Decisions

- LD1 (F1, F2, F20): inference-generated resume wording is evaluated by the unchanged `evaluateTruth` with the candidate presented as edited text (`userEdited: true`), so the unsupported-token check always runs.
  - The synthetic statement carries the source statement's canonical `evidenceIds`. The `evidence` passed to the gate is re-read from the canonical repository at adjudication time, never taken from the minimized request payload.
  - The proposal's `supportingEvidenceIds` must be a subset of those IDs; any other ID is a `policy-violation`, so a rewrite cannot widen the evidence pool.
  - The adjudicator receives the gate by injection: in production, the existing `ResumeService` instance's `evaluateTruth`; in tests, a real `ResumeService`. The gate is never extracted, copied or refactored.
  - Acceptance writes only text through the existing `ResumeService.updateStatement` (`resume-service.cts:291-299`, which trims and length-checks), and that records `user_edited = 1`. The export-time gate in `prepareRender` re-runs on it. The contract states that accepted inference wording becomes a user edit with no separate canonical marker.
  - The gate is called as-is; the inference layer does not re-implement, wrap-modify or fork it. A named `InferenceAdjudicator` runs inference-only checks before the gate. Dependency direction is one-way: inference modules may import deterministic gates and contracts, and deterministic gates, domain services and existing workflows must not import inference modules. Slice A enforces this with a test.
- LD2 (F3, F14): every v1 task schema is closed (`additionalProperties: false`). Unknown fields, action fields, data requests and tool requests make the response `invalid-response`; they are not ignored. In v1 each task is one request and one response. Provider output never becomes input to another inference request. For factual tasks, a URL, email address, phone number or filesystem path in provider text that is absent from the supporting evidence is a `policy-violation`.
- LD3 (F4, F5, F19): the broker computes the transmission manifest from the minimized payload. A payload field the manifest does not cover is a `policy-violation` before anything is sent.
  - Sojourner classifies location itself; the adapter's claim is not trusted. There are three classes:
    - `in-process`: no network, for example a bundled model running inside Sojourner;
    - `loopback`: the endpoint's address literal, checked after resolution, is `127.0.0.0/8` or `::1`. It is user-attested, because Sojourner cannot verify that it does not forward;
    - `remote`: everything else.
  - `loopback` gets the same consent treatment as `remote` for every private data class (`career-evidence`, `career-preferences`, `resume-content`, `application-material`, `application-history`, `interview-content`, `contact-data`, `credential-identifiers`). The configuration disclosure says Sojourner cannot verify that a local endpoint does not forward data.
  - Only `in-process` is exempt from remote consent. Conformance includes a loopback endpoint that requires consent.
  - The connection is pinned to the address that was checked, so the disclosure matches the endpoint actually used. A consent receipt binds provider, model, task and data-class set; a request outside its receipt fails as `consent-required`.
- LD4 (F6, F9, F10, F16): the request carries `taskSchemaVersion` and `instructionTemplate {id, version}`, and the response echoes them; any mismatch is `invalid-response`.
  - The single exception is `modelId`. If the descriptor declares model-alias resolution, the response may report a different resolved model, and both the requested and resolved model are recorded. No other field has an exception.
  - v1 has no automatic retry, by the broker or the adapter; retries are user-initiated. The broker enforces the timeout. Responses that arrive after cancellation or timeout are discarded.
  - Provenance lives in a separate local inference store, a separate file or store and never a table in the main database (which `VACUUM INTO` backups would export).
  - Acceptance writes in a fixed order:
    1. a pending provenance record;
    2. the existing domain write;
    3. finalizing the provenance record.
  - If step 1 fails, nothing is written. If step 2 fails, the pending record is marked failed.
  - If step 3 fails, or the app stops between steps 2 and 3, the user-approved domain write stands. The pending record is reconciled to `finalize-unknown` on the next start.
  - Deterministic flows never touch this store.
  - `inputContentHash` and `outputContentHash` are keyed with a per-install secret salt (HMAC), so a low-entropy payload cannot be confirmed by guessing. Each covers the whole canonical payload or output, not individual fields. The salt lives behind the runtime secret boundary, outside the main database and outside backup and portable archives.
  - Archive inclusion of provenance is deferred to the first slice that persists accepted inference output. Until then provenance is not exported, and it never contains raw text or credentials.
  - Credentials never enter the request envelope, payload, provenance, or the input to `providerSettingsHash`.
- LD5 (F7): failures carry a closed code (including `rate-limited`, which surfaces any provider retry-after hint as data and never triggers an automatic retry), a phase (`pre-transmission | provider | validation | acceptance`) and a bounded Sojourner-authored message. Provider-supplied error and warning text is never logged, persisted or shown verbatim. Warning codes come from a closed enum.
- LD6 (F8, F17): v1 task schemas contain no numeric confidence, probability or score field; one present is `invalid-response`.
  - A provider relationship label (`direct`, `transferable`, `ambiguous`) is displayed only as an unreviewed inferential proposal. It never changes deterministic coverage, opportunity-assessment statuses, badges, counts, gaps or unknowns.
  - Generated explanation text is always labeled as generated and never replaces deterministic explanation text. Generated prose may not state a hiring probability, a likelihood of success, or an employer's evaluation. The benchmark checks this, and adjudication rejects explicit percent-chance language for explanation and prioritization tasks. LD13 takes precedence: those tasks allow no free text in v1, so this rule applies to any later version that allows it.
  - When inference is unconfigured, refused, missing credentials, failed, or on an unsupported runtime, inference entry points are absent or inert. Deterministic screens, outputs and actions stay output-equivalent, with generated timestamps such as `checkedAt` excluded from the comparison. Nothing blocks a deterministic action to prompt for inference.
- LD12 (F21): for contract v1, the factual content of `draft-application-material`, `draft-career-story` and `draft-interview-practice` cannot be enabled.
  - Those surfaces have no deterministic factual token gate today. Enabling them needs a deterministic support gate for that surface, justified independently as a product improvement (Draft :46) and regression-tested without inference.
  - Until then, these tasks may be registered only for non-factual output (questions, structure, communication feedback) that carries no career claims. Any factual field or section in their responses is a `policy-violation`.
  - Reusing the resume gate through injection, as a synthetic edited statement bound to each section's evidence IDs, is a candidate design for that later decision. It is not authorized here.
- LD13 (F22, F23): every v1 task schema is structured-only. The rule is class-wide and applies to all ten tasks, including the two Slice A ships.
  - The only provider free text that can reach a user is:
    - `proposedText` of `rewrite-resume-statement`, gated by LD1;
    - the quoted fragment and proposed fields of `extract-career-evidence`, gated by LD14;
    - bounded, non-factual communication phrasing in tasks LD12 limits to non-factual output.
  - Every other explanatory field is a closed code or a request-scoped ID. Specifically:
    - `SemanticEvidenceSupportProposal` becomes `{ requirementId, candidateEvidence: [{ evidenceId, proposedRelationship, rationale: { code, evidenceFields } }], unknownRequirementIds }`.
      - `code` is from a closed enum: `shared-skill`, `shared-method-or-tool`, `similar-scope`, `related-outcome`, `adjacent-domain`.
      - `evidenceFields` names which canonical evidence fields the relationship rests on (`statement`, `skills`, `methodsOrTools`, `scope`, `outcomes`, `metrics`).
      - `unknownRequirementIds` are request-scoped IDs.
    - `ResumeStatementRewriteProposal` becomes `{ sourceStatementId, supportingEvidenceIds, proposedText, rationaleCode, unsupportedRequirementIds }`.
      - `rationaleCode` is from a closed enum: `clarity`, `concision`, `active-voice`, `keyword-alignment`, `ordering`.
      - `unsupportedRequirementIds` are request-scoped IDs.
  - Any free-text field outside the three allowed kinds is `invalid-response` by closed schema (LD2).
  - For `explain-opportunity`, `prioritize-opportunities` and `interpret-search-insight`, the rules are as follows:
  - Responses refer to deterministic state only by request-scoped IDs: requirements, evidence, blockers, gaps, unknowns and opportunities. `prioritize-opportunities` returns an ordering of request-scoped opportunity IDs.
  - Completeness is checked against the canonical deterministic assessment, not only against the request. The broker must include every blocker, gap and unknown ID from the canonical assessment in the request; minimization may not drop them. Adjudication re-reads the canonical assessment and checks that every one of those IDs appears in the response. An omission is `validation-failed`.
  - No response field can change a deterministic status.
  - Free-text prose that explains the user's fit or states career facts cannot be enabled in v1, for the same reason as LD12. Any such field is a `policy-violation`.
  - These three tasks allow no free text in v1.
- LD14 (contract :424-436): an inference-only check verifies that each Career Evidence extraction proposal's quoted source fragment appears verbatim in the preserved source artifact. A second check runs the proposed fields through the existing, unchanged `buildTruthEvidenceIndex` and `unsupportedTruthTokens`, using the fragment as the evidence. A field term absent from the fragment fails. Either mismatch is `validation-failed`.
  - Proposals are not persisted before review; they are held in memory until the user acts on them in the existing Candidate Evidence review path.
  - `CandidateEvidence.confidence` stays null for inference-sourced records.
  - The existing deterministic backstop is unchanged: unconfirmed evidence cannot support claims (`canEvidenceSupportFactualClaim`).
- LD7 (F15): at user acceptance, immediately before the existing domain write, evidence is re-read from the canonical repository. Currency and confirmation are re-checked, and the injected `evaluateTruth` is re-run on the freshly read evidence. Evidence that changed since the request invalidates the proposal.
- LD8 (F11, F12):
  - The inference capability report is `{ available: false, reason } | { available: true, providerId, location, tasks }` per runtime.
  - Test-only providers are registered only through test code and are never reachable from production entry points; a test proves the production registry is empty.
  - Slice A reports `available: false` (reason `not-configured`) on both Electron and PWA.
  - Slice A advertises exactly two tasks through the fake provider: `semantic-evidence-support` and `rewrite-resume-statement`. It adds no IPC channel, no UI, no persistence or migration, and no new runtime dependency.
- LD9 (F13, F18):
  - The benchmark fixture set is versioned and hashed. Expected labels are authored before any provider output is seen and never edited to match one.
  - Results are reported per adversarial category, not only in aggregate.
  - Demo fixtures, including the Phase 10 recorder fixture, are excluded from benchmark evidence.
  - A task candidate is rejected if the inference-assisted path produces more factual or support violations than the deterministic baseline on the same fixtures.
  - The unsupported-claim category includes outcomes and scope.
  - The conformance list adds:
    - out-of-request-scope IDs;
    - provider requests for more data;
    - provider attempts at external actions or URLs;
    - confidence overriding a deterministic unknown or gap;
    - instruction-template provenance.
  - Remote-consent and loopback-consent conformance are marked not applicable until a slice adds a non-in-process adapter.
  - Slice A validators are hand-written, which satisfies LD2's closed schemas without a schema-library dependency. v1 has no opt-in raw diagnostic retention; Draft 0.1's opt-in clause is removed.
- LD10: the contract moves to **Draft 0.2 — adversarially reviewed; Slice A (#164) authorized; no provider authorized**. A review record section lists F1-F23 and where each is resolved. Draft 0.1 open question 1 is resolved for v1: there are no durable inferential mappings, and any later design needs a distinct reviewed type. The remaining open questions stay, each tagged with the surface it gates.
- LD15: the contract's layering diagram is redrawn. The deterministic path never enters the broker. The inference path runs proposal, then inference-specific adjudication, then the existing deterministic gates, then explicit user review, then the existing domain write.
- LD11: `docs/ARCHITECTURE_PLAN.md`, `docs/planning/PLAN.md` and `SECURITY.md` are kept consistent with LD1-LD15. Specifically, ARCHITECTURE_PLAN's line "Generated factual language must remain evidence-linked and pass deterministic validation before use" gains the edited-text Truth Gate path and mandatory user review, and the PLAN checklist marks the review complete.

## Phase 1: Contract amendments

### Unit Tests

- Documentation only; no executable test is added in this phase. Acceptance is by independent adversarial re-review of the amended contract against F1-F23 (`/qor-audit`, Option B), and by checking that every LD names a contract section that implements it. Slice A (#164) turns LD1, LD2, LD3 (manifest coverage only; consent conformance is not applicable until a non-in-process adapter exists), LD6, LD7, LD8 and LD13 (closed schemas of the two Slice A tasks) into executable tests.

### Affected Files

- `docs/design/INFERENCE_CONTRACT.md` - amendments LD1-LD10 and LD12-LD15, and the review record
- `docs/ARCHITECTURE_PLAN.md` - LD11 consistency
- `docs/planning/PLAN.md` - review checkbox; Slice A status
- `SECURITY.md` - one sentence on credential and diagnostic exclusion (LD4, LD5)
- `docs/GOVERNANCE_INDEX.md` - Phase 13 plan row

## Feature Inventory Touches

None.

## Definition of Done

### Deliverable: Reviewed inference contract

- **D1**: The contract states, without ambiguity, how inference text reaches the unchanged Truth Gate (bound evidence set, injected gate, text-only write) and which factual tasks and prose surfaces are not enableable in v1. It cannot let a provider become factual authority, mutate canonical state, or alter inference-disabled behavior.
- **D2**: The files above are amended; there are no code changes.
- **D3**: Ledger plan, audit, implement and seal entries; governance index row; the PR #163 description and #162/#164 acceptance criteria updated to match.
- **D4.d**: Waiver: documentation-only phase with no executable surface. Verification is independent adversarial review plus repository health (`npm test`) to confirm nothing else moved. **Follow-up phase**: Phase 14 (#164) implements the executable checks for LD1, LD2, LD3 (manifest coverage), LD6-LD8, and LD13 for the two Slice A schemas. LD12, LD13 for the other tasks, and LD14 become executable in the slice that registers those tasks.

## CI Commands

- `npm test` - repository health; confirms the docs-only change moved nothing.
- `qor-logic-plus governance-index --enforce --repo-root .` - governance index registration.
