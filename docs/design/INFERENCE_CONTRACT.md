# Inference Contract

Status: **Draft 0.2 — adversarially reviewed; Slice A (#164) authorized; no provider authorized**  
Owner: #162  
Prior constraints: #59, #64  
Review: Phase 13 adversarial architecture/security review (`docs/plan-qor-phase13-inference-contract-review.md`, META_LEDGER #67-#71). Findings F1-F23, and post-amendment findings F24-F27, are listed under [Review record](#review-record).

## Purpose

Sojourner is deliberately useful without probabilistic inference. Its canonical career state, requirement/evidence model, opportunity assessment, document gates, application lifecycle, and portability model are deterministic and local-first.

Optional inference may improve semantic interpretation, drafting, explanation, and prioritization. It must not become a second authority for career truth or a hidden prerequisite for the product.

This document defines the provider-neutral boundary between Sojourner's deterministic core and any future local or remote inference provider.

The governing rule is:

> **Inference returns proposals. Sojourner validates, explains, and decides what may enter product state.**

A model response is never Career Evidence, eligibility truth, an application action, or an approved factual claim merely because a provider returned it.

## Goals

The inference boundary must:

1. allow useful semantic and language assistance without provider lock-in;
2. preserve Career Evidence and user authority;
3. preserve a deterministic no-inference path for every enhanced workflow;
4. make data leaving the device explicit before remote transmission;
5. keep provider responses schema-bounded and provenance-linked;
6. prevent model output from directly mutating canonical state;
7. work across Sojourner runtimes only where the runtime can satisfy the same security contract;
8. make failure degrade to deterministic behavior rather than product failure;
9. preserve enough local provenance to explain how inference-assisted output was produced;
10. allow future providers to be tested through one conformance contract.

## Deterministic baseline invariant

The deterministic product is the baseline implementation and takes precedence over inference enhancements.

Inference integration must be **additive**:

- disabling or removing every inference provider must return Sojourner to the same deterministic product behavior, authority model, and safety guarantees;
- inference must not become a prerequisite for Career Evidence, requirement mapping, opportunity assessment, resume generation, Truth Gate, Parseability Gate, application materials, interview preparation, Search Insights, backup/restore, or normal application lifecycle;
- provider availability, model quality, rate limits, cost, or consent state must not reduce the correctness of the non-inference path;
- an inference-specific safeguard may add restrictions to inference-assisted output, but it must not weaken or bypass the deterministic controls;
- a generic deterministic improvement may strengthen the baseline Truth Gate for everyone, but it must be justified independently of inference and preserve existing supported non-inference workflows;
- an inference-only semantic validator must not be inserted into the baseline Truth Gate in a way that makes deterministic use depend on a model.

The layering is:

```text
deterministic workflow  (never enters the inference layer)
      |
      v
existing deterministic Truth / domain gates
      |
      v
normal deterministic product behavior


inference-assisted workflow
      |
      v
inference proposal  (provider output: untrusted, schema-bounded)
      |
      v
inference-specific adjudication  (InferenceAdjudicator)
schema / scope / provenance / policy / task-specific checks
      |
      v
existing deterministic Truth / domain gates  (unchanged, injected)
      |
      v
explicit user review where required
      |
      v
existing canonical domain write path
```

The deterministic gates are shared and unchanged. The inference path has **additional** governance; it does not redefine the baseline gates around model behavior.

**Dependency direction is one-way.** Inference modules may import deterministic contracts and receive deterministic gates by injection. Deterministic gates, domain services, and existing workflows must not import inference modules. Slice A enforces this with an import-boundary test.

**Disabled means output-equivalent.** When inference is unconfigured, refused, missing credentials, failed, or on an unsupported runtime, inference entry points are absent or inert. Deterministic screens, outputs, and actions remain output-equivalent to the inference-free product, with generated timestamps such as `checkedAt` excluded from the comparison. No deterministic action is blocked to prompt for inference.

Any implementation that refactors an existing deterministic gate must prove behavioral equivalence for inference-disabled workflows through regression tests before the inference feature is considered.

## Non-goals

This contract does not:

- choose OpenAI, Anthropic, Gemini, Ollama, or any other provider;
- add a generic agent runtime;
- grant models arbitrary tools, filesystem access, browser control, or application-write authority;
- make inference required for Sojourner;
- permit autonomous application submission;
- permit inference to establish factual Career Evidence;
- permit inference to override, replace, or weaken the deterministic Truth Gate, Parseability Gate, source approval, network policy, or user confirmation;
- permit an opaque hiring-probability score;
- authorize remote inference implementation merely because this document exists.

Any remote implementation remains a security/privacy boundary change under `GOVERNANCE.md`.

## Authority model

The existing Sojourner authority hierarchy does not change.

```text
Canonical local state
  Career Evidence / Target Tracks / Jobs / Applications
                  |
                  v
       deterministic preparation
  requirements / coverage / context / allowed facts
                  |
                  v
        InferenceBroker (shared core)
  policy + minimization + manifest + consent + schema contract
                  |
                  v
     InferenceProviderAdapter (replaceable)
       in-process, loopback, or remote provider
                  |
                  v
        schema-bounded proposal only
                  |
                  v
       InferenceAdjudicator, then the existing deterministic gates
  IDs / provenance / claim support / policy / gates
                  |
                  v
           user review where required
                  |
                  v
       canonical write through existing service
```

### What remains authoritative

- **Career Evidence** remains the factual career authority.
- **Target Tracks** remain the user's intent/preferences authority.
- **preserved job/source text** remains the authority for what Sojourner actually observed in a listing.
- **Applications** remain lifecycle authority.
- **deterministic gates** remain blocking controls.
- **the user** remains the authority for confirming imported/proposed career facts and consequential external actions.

### What inference may be

Inference may be:

- an extractor that proposes structure from untrusted text;
- a semantic assistant that proposes likely relationships;
- a drafting assistant that proposes evidence-linked wording;
- an explainer that references deterministic state;
- a prioritization assistant that proposes ordering while exposing its inputs;
- a practice assistant for interview or reflection workflows.

Inference is not canonical storage and is not a permission boundary.

### What provider output may never write directly

Provider output never directly writes Career Evidence, Target Tracks, requirement/evidence canonical mappings, Applications, source configuration, resume artifacts, application materials, settings, or lifecycle state. Every canonical write goes through the existing domain service after any required user approval.

## Architectural components

### InferenceBroker

A shared-core `InferenceBroker` owns the product contract.

It is responsible for:

- accepting only registered inference task types;
- constructing the minimum request payload from canonical state;
- **computing** the transmission manifest from that payload;
- classifying provider location itself (see [Location classification](#location-classification));
- enforcing runtime/provider policy and consent;
- invoking a provider adapter under a broker-enforced timeout and cancellation signal;
- passing the response to the `InferenceAdjudicator`;
- returning an `InferenceProposalResult` to the calling domain service.

The broker does **not** write Career Evidence, applications, resumes, target tracks, sources, or settings. It performs no automatic retry and never invokes a second provider.

### InferenceAdjudicator

The `InferenceAdjudicator` is the inference-specific gate. It runs the inference-only checks listed under [Inference-specific adjudication](#inference-specific-adjudication). Where a task produces factual wording, it then calls the existing deterministic gate, which it **receives by injection**. In production that is the existing service instance's gate. In tests it is a real instance of the same service.

The adjudicator never re-implements, copies, forks, or modifies a deterministic gate.

### InferenceProviderAdapter

A provider adapter is narrow and replaceable.

It may:

- report capabilities;
- receive one versioned request envelope;
- return one versioned response envelope;
- expose bounded usage/cost metadata when the provider supplies it;
- support cancellation.

It may not:

- read arbitrary application state;
- read arbitrary files;
- choose additional data to send;
- call Sojourner domain services;
- perform browser automation;
- write canonical state;
- retry on its own;
- silently invoke another provider;
- silently retain credentials in Sojourner content stores.

Provider-specific prompt construction belongs behind this adapter boundary. Provider-specific concepts must not leak into domain contracts.

### Runtime support and capability reporting

Inference capability is runtime-gated. A runtime must not advertise inference merely because another runtime can support it.

Each runtime reports:

```ts
type InferenceCapabilityReport =
  | {
      available: false;
      reason: "not-configured" | "runtime-unsupported" | "consent-required" | "credentials-missing";
    }
  | {
      available: true;
      providerId: string;
      location: InferenceLocation;
      tasks: InferenceTask[];
    };
```

- Runtime capability reporting is an environment fact, not product truth.
- Test-only providers, including the synthetic fake provider, are registered only from test code. They are never reachable from production entry points. A test proves the production registry is empty.
- Until a conforming provider is configured, both Electron and PWA report `{ available: false, reason: "not-configured" }`.
- A PWA must not store long-lived provider API keys in ordinary application state or in a portable `.sojourner` archive.
- A PWA remote-provider path requires a separately approved credential/transport design before it can claim parity.
- A local browser-accessible inference endpoint must still satisfy browser origin/CORS/network policy and explicit provider configuration.

## Capability handshake

Every adapter exposes a versioned descriptor.

```ts
type InferenceLocation = "in-process" | "loopback" | "remote";

type InferenceTask =
  | "extract-career-evidence"
  | "extract-job-requirements"
  | "semantic-evidence-support"
  | "rewrite-resume-statement"
  | "draft-application-material"
  | "draft-career-story"
  | "draft-interview-practice"
  | "explain-opportunity"
  | "prioritize-opportunities"
  | "interpret-search-insight";

interface InferenceProviderDescriptor {
  providerId: string;
  adapterVersion: string;
  /** Adapter's claim only. Sojourner classifies location itself. */
  declaredLocation: InferenceLocation;
  displayName: string;
  supportedContractVersions: string[];
  supportedTasks: Array<{ task: InferenceTask; taskSchemaVersion: string }>;
  models: Array<{
    modelId: string;
    displayName: string;
    contextLimit?: number;
  }>;
  /** When true, a response may report a resolved model that differs from the requested alias. */
  resolvesModelAliases: boolean;
  supportsCancellation: boolean;
  reportsUsage: boolean;
  reportsCost: boolean;
}
```

Task support is explicit. There is no `"generic-agent"` or unrestricted `"chat-with-all-my-data"` task in this contract.

Adding a new task type is an architecture change because it defines a new data and authority boundary.

### Location classification

Sojourner classifies a provider's location itself. It does not trust `declaredLocation`.

- **`in-process`**: inference runs inside Sojourner with no network connection, for example a bundled model. Because this class is exempt from remote consent, an adapter may be classified `in-process` only after review confirms it has no network capability. A conformance test runs it with networking denied, so an SDK wrapper cannot be labeled `in-process`.
- **`loopback`**: the endpoint resolves to `127.0.0.0/8` or `::1`, and the connection is pinned to that address, so DNS rebinding cannot redirect it.
  - In Electron, the address is checked after name resolution and the connection is pinned to it.
  - In the PWA, browser `fetch` cannot resolve-then-pin, so only IP-literal loopback URLs (`http://127.x.x.x`, `http://[::1]`) count as `loopback`. Every hostname, including `localhost`, is `remote`.
  - A loopback endpoint is **user-attested**: Sojourner cannot verify that a local gateway does not forward data to a remote service, and the configuration disclosure says so.
- **`remote`**: everything else.

For consent, `loopback` is treated exactly like `remote` for every private data class (see [Remote consent](#remote-consent)). Only `in-process` is exempt from remote consent.

## Request envelope

All providers receive the same logical request envelope after task-specific minimization.

```ts
interface InferenceRequestEnvelope<TTask extends InferenceTask, TPayload> {
  contractVersion: "1";
  requestId: string;
  task: TTask;
  taskSchemaVersion: string;
  instructionTemplate: {
    id: string;
    version: string;
  };
  createdAt: string;

  provider: {
    providerId: string;
    modelId: string;
    location: InferenceLocation; // Sojourner's classification
  };

  policy: {
    proposalOnly: true;
    mayCreateFacts: false;
    mayWriteCanonicalState: false;
    mayPerformExternalActions: false;
  };

  transmission: InferenceTransmissionManifest; // computed by the broker from payload and context

  context: {
    locale?: string;
    targetTrackId?: string;
    jobId?: string;
    applicationId?: string;
    sourceArtifactIds?: string[];
    evidenceIds?: string[];
  };

  payload: TPayload;
}
```

The task payload must contain only data needed for that task. The provider never receives a database-shaped dump. Credentials never appear in the envelope, payload, or context.

In v1 each task is **one request, one response**. Provider output is never used as input to a later inference request, and there is no multi-turn exchange or provider-requested follow-up.

## Data classes and transmission manifest

Sojourner records what a request contains **before** any call is made.

```ts
type InferenceDataClass =
  | "public-job-text"
  | "career-evidence"
  | "career-preferences"
  | "resume-content"
  | "application-material"
  | "application-history"
  | "interview-content"
  | "contact-data"
  | "credential-identifiers";

interface InferenceTransmissionItem {
  dataClass: InferenceDataClass;
  purpose: string;
  recordIds: string[];
  fields: string[];
  redactions: string[];
}

interface InferenceTransmissionManifest {
  location: InferenceLocation;
  items: InferenceTransmissionItem[];
  containsPersonalCareerData: boolean;
  consentReceiptId: string | null;
}
```

The broker **computes** the manifest from everything it transmits. It is not a declaration written beside the payload.

- Coverage spans the whole transmitted envelope: `payload` and `context`. For example, an `applicationId` in `context` is covered as `application-history`.
- Every transmitted field must be covered by a manifest item. An uncovered field is a `policy-violation` before anything is sent, so the manifest cannot understate what leaves Sojourner.

The private data classes are every class except `public-job-text`.

### Minimization rules

- Send canonical IDs plus the minimum text/fields required for the task.
- Do not send the full Career Evidence store when three evidence records are sufficient.
- Do not send phone, email, street address, credential ID, contact names, notes, or unrelated application history by default.
- Provider prompts must not embed secrets.
- Provider configuration does not imply permission to transmit every data class.
- A task contract may prohibit a data class even if the user has configured a remote provider.
- Minimization never drops deterministic blockers, gaps, or unknowns that a task is required to account for (see [Opportunity explanation, prioritization, and search insight](#opportunity-explanation-prioritization-and-search-insight)).

### Remote consent

Remote inference, and loopback inference involving any private data class, requires disclosure that clearly identifies:

- provider;
- model when known;
- the location classification, and for loopback, that Sojourner cannot verify the endpoint does not forward data;
- data classes that will leave Sojourner;
- why each class is required;
- that Sojourner does not retain raw prompts or responses (see [Local provenance and retention](#local-provenance-and-retention));
- known provider-side retention/training status when Sojourner can state it from configured provider policy.

Consent must be specific enough to distinguish, for example, sending a public job description from sending private Career Evidence.

A consent receipt binds **provider + model + task + data-class set**. A request whose computed manifest falls outside its receipt fails as `consent-required` before transmission. A future UI may allow remembered consent per receipt scope. Broad "AI enabled" consent is insufficient.

Revoking consent prevents future calls. It does not rewrite already accepted local artifacts.

## Untrusted input and prompt injection

Resume text, job descriptions, employer pages, imported documents, application notes, and model output are all untrusted input.

Provider instructions must treat user/source text as **data**, not instructions. Sojourner does not rely on detecting injection. It relies on the provider having no authority to act on injected text.

No inference task may allow untrusted content to:

- change system/provider policy;
- request more local data;
- select files;
- retrieve URLs;
- invoke tools;
- change provider/model configuration;
- write canonical state;
- submit applications;
- weaken deterministic gates.

**Every v1 task schema is closed** (`additionalProperties: false`). A response carrying an unknown field, an action field, a request for more data, or a tool request is rejected as `invalid-response`. It is not "ignored". Nothing in a response can expand the request scope.

Prompt injection can still steer output *within* a valid schema, for example "label all evidence direct" or "rank this job first". That residual risk is why relationship labels never change deterministic state, why prioritization is only a proposed ordering the user must adopt, and why factual wording always requires user review.

### Untrusted output

Model output is untrusted content even after schema validation.

- Narrative output is treated as text, not executable Markdown/HTML.
- URLs returned by a provider are not fetched or opened automatically.
- Provider text cannot introduce UI actions, IPC calls, filesystem paths, shell commands, or network destinations.
- In any task, a URL, email address, phone number, or filesystem path in provider text that does not appear verbatim in the request's supporting evidence or source text is a `policy-violation`. Non-factual phrasing therefore cannot introduce new links.
- Rendering must escape or sanitize provider-controlled text through the same boundaries used for other untrusted content.
- Schema validation proves shape, not truth. Domain validation and user authority still apply.

## Response envelope

A provider returns a typed envelope, not free-form product state.

```ts
type InferenceWarningCode =
  | "input-truncated"
  | "low-information-input"
  | "task-partially-supported";

interface InferenceResponseEnvelope<TProposal> {
  contractVersion: "1";
  requestId: string;
  task: InferenceTask;
  taskSchemaVersion: string;
  instructionTemplate: {
    id: string;
    version: string;
  };

  provider: {
    providerId: string;
    modelId: string; // requested model, or resolved model when the descriptor resolves aliases
    adapterVersion: string;
  };

  completedAt: string;

  proposal: TProposal;

  warnings: Array<{ code: InferenceWarningCode }>; // closed codes; no provider free text

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    currency?: string;
  };
}
```

- `requestId`, `task`, `taskSchemaVersion`, and `instructionTemplate` must echo the request exactly. Any mismatch is `invalid-response`.
- The single exception is `provider.modelId`. When the descriptor declares `resolvesModelAliases`, the response may report a different resolved model, and provenance records both the requested and the resolved model. No other field has an exception.
- **No v1 task schema contains a numeric confidence, probability, or score field.** Such a field is `invalid-response`. Product-facing uncertainty is represented only through explicit support, gaps, unknowns, warnings, and provenance.

## Proposal contracts

**Structured-only rule (all v1 tasks).** The only provider free text that can reach a user is:

1. `proposedText` of `rewrite-resume-statement`, gated as described below;
2. the quoted fragment and proposed fields of `extract-career-evidence`, gated as described below;
3. bounded, non-factual communication phrasing in the tasks limited to non-factual output (see [Application materials, Career Stories, and interview practice](#application-materials-career-stories-and-interview-practice)).

Every other explanatory field is a closed code or a request-scoped ID. Any other free-text field is `invalid-response` under the closed schema.

### Career Evidence extraction

Inference may propose Candidate Evidence from a preserved source artifact.

Every proposal must include:

- proposed fields;
- source artifact ID;
- source snapshot/hash;
- a quoted source fragment sufficient to review provenance;
- no invented facts.

Inference-specific adjudication checks that:

- the quoted fragment appears verbatim in the extraction snapshot text referenced by the proposal (`extractionSnapshotId`), not in a possibly binary artifact;
- the proposed free-text fields (`statement`, `organization`, `titleOrName`, `skills`, `methodsOrTools`, `scope`, `outcomes`, `metrics`) introduce no unsupported factual token. The existing, unchanged `buildTruthEvidenceIndex` and `unsupportedTruthTokens` run with the fragment as the evidence. Enum and date fields are validated by schema, not tokenized.

Either mismatch is `validation-failed`.

Proposals are not persisted before review. A proposal accepted for review enters the existing Candidate Evidence review path with `verificationState: "inferred-pending"`, so inference-sourced candidates stay distinguishable from parser-imported ones. `CandidateEvidence.confidence` stays null for inference-sourced records. `canEvidenceSupportFactualClaim` admits only `user-confirmed` and `user-authored`, so the candidate supports no claim until the user confirms it.

The existing renderer review queue lists only `imported` candidates as pending (`src/career/evidence.ts`). The slice that registers this task must therefore show `inferred-pending` candidates in a **separate, labeled review list** that uses the existing backend review action (`reviewEvidence`, which confirms from any state). It must not change the deterministic queue. A persisted candidate the user cannot review is a defect. The slice that registers this task must name the existing insert path that persists an accepted proposal as an unconfirmed candidate. It may not add a new canonical write path.

### Job requirement extraction

Inference may propose additional or differently segmented requirements.

Every proposed requirement must:

- reference the saved job/source record;
- point to observed source text;
- identify its proposed kind from a closed set;
- remain a proposal until accepted by the domain path defined for requirements.

Adjudication checks that each proposed requirement's quoted source text appears verbatim in the saved listing text; a mismatch is `validation-failed`. The slice that registers this task implements the check.

Inference may not infer a missing employer requirement from general occupational knowledge and present it as though the listing stated it.

### Semantic evidence support

Inference may propose that one or more Career Evidence records are semantically relevant to a job requirement.

```ts
type SemanticRationaleCode =
  | "shared-skill"
  | "shared-method-or-tool"
  | "similar-scope"
  | "related-outcome"
  | "adjacent-domain";

type EvidenceField = "statement" | "skills" | "methodsOrTools" | "scope" | "outcomes" | "metrics";

interface SemanticEvidenceSupportProposal {
  requirementId: string;
  candidateEvidence: Array<{
    evidenceId: string;
    proposedRelationship: "direct" | "transferable" | "ambiguous";
    rationale: {
      code: SemanticRationaleCode;
      evidenceFields: EvidenceField[];
    };
  }>;
  unknownRequirementIds: string[];
}
```

Rules:

- The request includes only confirmed evidence (`canEvidenceSupportFactualClaim`), so a relationship label is never shown beside unconfirmed evidence.
- The provider may reference only requirement/evidence IDs supplied in the request. Any other ID is `policy-violation`.
- `evidenceFields` must name fields that are non-empty in the canonical evidence record.
- `proposedRelationship` is shown only as an **unreviewed inferential proposal**. It never changes deterministic coverage, opportunity-assessment statuses, badges, counts, gaps, or unknowns. A provider label of `direct` never turns a deterministic gap or `transferable` into direct experience.
- A v1 semantic proposal may not overwrite the canonical deterministic `RequirementEvidenceMap`, and v1 defines no durable inferential mapping. v1 never writes a `RequirementEvidenceMap` row with `createdBy: "inference"`, even though that enum value exists. A later design may add reviewed inferential relationships only as a distinct, separately reviewed type. It may never change the meaning of the existing mapper.

### Resume statement rewrite

Inference may propose wording for an existing evidence-backed statement.

```ts
type RewriteRationaleCode = "clarity" | "concision" | "active-voice" | "keyword-alignment" | "ordering";

interface ResumeStatementRewriteProposal {
  sourceStatementId: string;
  supportingEvidenceIds: string[];
  proposedText: string;
  rationaleCode: RewriteRationaleCode;
  unsupportedRequirementIds: string[];
}
```

Rules:

0. At request time, the broker captures the source statement's `text` and `evidenceIds` as a snapshot.
1. `supportingEvidenceIds` must be a subset of the **source statement's canonical `evidenceIds`**. Any other ID is a `policy-violation`, so a rewrite cannot widen the evidence pool and pin facts from another record.
2. The adjudicator builds a synthetic statement carrying the source statement's canonical `evidenceIds` with `userEdited: true`. It evaluates that statement with the existing, unchanged Truth Gate (`ResumeService.evaluateTruth`), received by injection. Evidence is re-read from the canonical repository, never taken from the request payload. Presenting the text as edited matters: the deterministic gate runs its unsupported-token check only for edited statements, and inference text must always receive that check.
3. The Truth Gate is necessary but **not sufficient** for inference-generated prose. Its deterministic checks cannot prove semantic equivalence merely because all factual tokens are supported, so explicit user review is mandatory for inference-generated factual wording in contract v1.
4. The provider may improve phrasing but may not manufacture metrics, ownership, tools, titles, dates, credentials, employers, scope, or outcomes.
5. Acceptance writes **only text**, through the existing `ResumeService.updateStatement`. That path trims and length-checks the text and records `user_edited = 1`, so the export-time gate in `prepareRender` re-runs on it. Accepted inference wording therefore becomes a user edit with no separate canonical marker. Its inference origin is recorded only in local provenance.
6. The deterministic fallback is the canonical evidence statement.

### Application materials, Career Stories, and interview practice

These surfaces have no deterministic factual token gate today:

- application materials check evidence currency only;
- Career Stories check evidence linkage and confirmation only.

So in contract v1, the **factual content** of `draft-application-material`, `draft-career-story`, and `draft-interview-practice` cannot be enabled.

- Until a deterministic support gate exists for the surface, these tasks may be registered only for non-factual output (questions, structure, communication feedback) that carries no career claims. Their closed schemas contain no factual field, so one is `invalid-response`; factual content detected in the allowed phrasing is a `policy-violation`.
- That gate must be justified independently as a product improvement and regression-tested without inference.
- The slice that enables even the non-factual output must define a deterministic check for embedded career claims, or state the residual risk explicitly. "Describe how you led your 40-person team" embeds a claim.
- Reusing the resume gate by injection, as a synthetic edited statement bound to each section's evidence IDs, is a candidate design for that later decision. It is not authorized by this contract.
- Inference may not claim to know what an employer will ask or how an employer will evaluate the user.
- Deterministic templates remain the fallback.

### Opportunity explanation, prioritization, and search insight

`explain-opportunity`, `prioritize-opportunities`, and `interpret-search-insight` are **structured-only and allow no free text in v1**.

- Responses refer to deterministic state only by request-scoped IDs: requirements, evidence, blockers, gaps, unknowns, opportunities, and observations.
- `prioritize-opportunities` returns an ordering of request-scoped opportunity IDs. It is shown as a proposed ordering the user may adopt; it never reorders anything automatically.
- Generated content never replaces deterministic explanation text; it is shown beside it, labeled as generated.
- Completeness is checked against the canonical deterministic assessment, which stays unchanged.
  - The inference layer derives stable reference IDs from it without modifying it:
    - gap and ambiguity IDs are the job requirement IDs whose deterministic `RequirementEvidenceClassification` is `gap` or `ambiguous`;
    - blocker, potential-blocker, unknown, preference-miss, and preference-unknown IDs are a stable hash of the deterministic string together with its position. They are computed in the inference layer, never in `opportunity-assessment.ts`. Because position is part of the hash, any change to the deterministic strings between request and adjudication or acceptance fails closed as `validation-failed`.
  - The completeness set covers `eligibility.blockers`, `eligibility.potentialBlockers`, top-level `unknowns`, `preferenceAlignment.misses`, `preferenceAlignment.unknowns`, and the gap and ambiguity requirement IDs.
  - The broker includes every ID in the set in the request. Adjudication re-derives the set from a fresh read of the canonical assessment and verifies that each ID appears in the response. An omission is `validation-failed`, so a provider cannot hide a blocker.
- No response field can change a deterministic status, Target Track, filter, monitored source, or application state.
- A ranking is never a hiring probability. Generated content may not state a hiring probability, a likelihood of success, or an employer's evaluation. Should a later contract version allow free text for these tasks, adjudication must reject explicit percent-chance language.
- Search insights preserve the distinction among observation, recommendation, and caveat.
- A deterministic ordering/filter remains available without inference.

## Inference-specific adjudication

Inference-specific adjudication is an **additional gate around inference output**. It is not a replacement implementation of the existing Truth Gate or other deterministic domain gates. The non-inference path does not pass through the broker or the adjudicator and remains independently functional.

Every response passes through these checks before the calling feature can display it as an actionable proposal:

1. the envelope version matches;
2. `requestId`, `task`, `taskSchemaVersion`, and `instructionTemplate` echo the request (with the `modelId` alias exception only);
3. the closed task schema validates, with no unknown fields and no confidence fields;
4. the provider/model identity is known;
5. every referenced ID was present in the request scope, plus the task-specific subset rules;
6. forbidden fields, actions, and data requests are absent, as are URLs, contact details, and paths not found in the request's evidence or source text (any task);
7. output size/resource bounds pass;
8. task-specific provenance requirements pass (verbatim fragments, completeness against the canonical assessment);
9. inference-generated factual wording passes the unchanged deterministic Truth Gate as edited text, then stays blocked on explicit user review in contract v1. Truth Gate success alone must not be presented as semantic proof;
10. current canonical records have not been invalidated or superseded since request creation.

A response that fails adjudication is rejected with exactly one code per case:

- `invalid-response`: envelope or closed-schema violations, including unknown fields, free text outside the allowed kinds, and confidence fields;
- `policy-violation`: schema-valid content that breaks a scope or policy rule, including out-of-scope or non-subset IDs, disallowed URLs, contact details, or paths, uncovered manifest fields, and factual content in the allowed non-factual phrasing;
- `validation-failed`: task-specific checks, including verbatim fragments, the deterministic Truth Gate, completeness, and staleness. Partial silent salvage is prohibited unless the task schema explicitly defines item-level validation and exposes rejected items.

## User review and state promotion

Inference output has three states:

```text
provider response
   |
   v
validated proposal
   |
   +--> rejected / discarded
   |
   +--> user-reviewed proposal (when required)
              |
              v
   canonical write through existing domain service
```

The inference layer itself never performs the canonical write.

**Acceptance re-check.** When the user accepts, immediately before the existing domain write:

- evidence is re-read from the canonical repository;
- confirmation and currency are re-checked against the `updatedAt` values captured at request time, so any evidence changed or superseded since the request invalidates the proposal;
- for a resume rewrite, the source statement's current `text` and `evidenceIds` are compared with the request-time snapshot. A changed or deleted statement invalidates the proposal, so a stale proposal can never silently overwrite a newer user edit. A small window remains between this comparison and the existing unconditional write. That is accepted residual risk in a single-user local process;
- for factual wording, the injected deterministic gate is run again on the freshly read evidence.

This closes the window between adjudication and use.

Examples:

- inferred Career Evidence enters the existing Candidate Evidence review path as unconfirmed evidence;
- a resume rewrite uses the existing `ResumeService.updateStatement` path only after adjudication and review;
- a proposed strategy change requires the same explicit user action as a manually entered change.

## Failure contract

Inference is optional. Failure must be boring.

```ts
type InferenceFailureCode =
  | "not-configured"
  | "unsupported-task"
  | "runtime-unsupported"
  | "consent-required"
  | "credentials-missing"
  | "cancelled"
  | "timeout"
  | "rate-limited"
  | "provider-unavailable"
  | "provider-error"
  | "invalid-response"
  | "validation-failed"
  | "policy-violation";

type InferenceFailurePhase = "pre-transmission" | "provider" | "validation" | "acceptance";

interface InferenceFailure {
  code: InferenceFailureCode;
  phase: InferenceFailurePhase;
  message: string; // bounded, authored by Sojourner
  retryAfterSeconds?: number; // rate-limited only; validated integer clamped to 0-3600; advisory data
}
```

An invalidated proposal at acceptance fails as `validation-failed` with phase `acceptance`.

Rules:

- inference failure must not corrupt or partially mutate canonical state;
- deterministic functionality remains available, and offline/local-first workflows remain usable;
- rate limits and provider outages are not represented as empty evidence or a negative assessment;
- provider-supplied error and warning text is never logged, persisted, or shown verbatim, because it may echo prompt content;
- v1 performs **no automatic retry**, in the broker or in the adapter. Retries are user-initiated, and a `retryAfterSeconds` hint is shown as data only;
- the broker enforces the timeout whatever the adapter does. A response that arrives after cancellation or timeout is discarded and never applied;
- Sojourner never silently switches to a different provider because one failed. That includes switching from a local provider to a remote one or back;
- a deterministic result shown after a failure is labeled as deterministic, never as inference output.

## Credentials and secrets

Provider credentials are not Career Ops data.

They must:

- live behind a runtime-specific secret/configuration boundary;
- never appear in request envelopes, payloads, prompts, provenance, or the input to `providerSettingsHash`;
- never be written to logs;
- never be included in backup or portable `.sojourner` archives;
- never be exposed to renderer/UI code beyond bounded configuration state such as `configured: true | false`;
- be independently removable.

The PWA may not claim support for long-lived remote-provider credentials until a credential design appropriate to the browser threat model is approved.

## Local provenance and retention

Sojourner retains enough local metadata to explain inference-assisted state without turning storage into a raw prompt archive.

A provenance record includes:

```ts
interface InferenceProvenance {
  requestId: string;
  task: InferenceTask;
  contractVersion: string;
  taskSchemaVersion: string;
  instructionTemplateId: string;
  instructionTemplateVersion: string;
  providerId: string;
  requestedModelId: string;
  resolvedModelId: string;
  providerLocation: InferenceLocation;
  adapterVersion: string;
  providerSettingsHash: string; // excludes credentials
  inputRecordIds: string[];
  inputContentHash: string; // HMAC over the whole canonical payload
  outputContentHash: string; // HMAC over the whole proposal
  createdAt: string;
  completedAt: string;
  outcome: "pending" | "accepted" | "rejected" | "discarded" | "failed" | "finalize-unknown";
  failureCode?: InferenceFailureCode;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    currency?: string;
  };
}
```

Rules:

- **No raw prompts or raw provider responses are persisted in v1**, including for debugging. There is no opt-in diagnostic retention in v1.
- Accepted product artifacts persist through their normal domain store.
- Content hashes are HMACs keyed with a per-install secret salt, so a low-entropy personal payload cannot be confirmed by guessing. Each hash covers the whole payload or proposal, never individual fields. The salt lives behind the runtime secret boundary, outside the main database and outside backup and portable archives.
- Provenance lives in a **separate local inference store**, a separate file or store and never a table in the main database. Electron backup copies the live main database with `VACUUM INTO`, so a main-database table would be exported.
- Acceptance writes in a fixed order:
  1. a `pending` provenance record;
  2. the existing domain write;
  3. finalize the record to `accepted`.

  If step 1 fails, nothing is written. If step 2 fails, the record becomes `failed`. If step 3 fails, or the app stops between steps 2 and 3, the user-approved domain write stands, and the record is reconciled to `finalize-unknown` on the next start.
- `rejected`, `discarded`, and `failed` outcomes that never reach a domain write are recorded in a single provenance write. A failure to write that record affects nothing else.
- Deterministic flows never read or write this store.
- Whether provenance is included in backup or portable archives is decided by the first slice that persists accepted inference output. Until then it is not exported. It never contains raw text or credentials in any case.

No telemetry is implied by local provenance.

## Cost and usage

If a provider reports usage/cost:

- preserve it locally as advisory metadata;
- never require it for correctness;
- do not transmit it to MythologIQ or another telemetry service;
- do not claim exact cost when the provider exposes only token counts or incomplete pricing information.

Future provider configuration may support user-defined budgets, but budget enforcement is outside draft v1.

## Provider conformance

A provider implementation must pass a shared conformance suite before it can be enabled. Conformance tests use synthetic data only.

Minimum conformance cases:

- valid response for every advertised task;
- malformed JSON/schema rejection, including unknown fields;
- unknown ID rejection;
- out-of-request-scope ID rejection;
- invented evidence ID rejection, and evidence IDs outside the source statement's set for rewrites;
- oversized output rejection;
- cancellation;
- timeout, with late responses discarded;
- rate-limit/provider failure representation, with no automatic retry;
- no mutation after failure;
- no hidden fallback to another provider;
- transmission manifest correctness, including rejection of uncovered transmitted fields (payload and context);
- deterministic fallback availability;
- baseline-regression coverage proving inference-disabled behavior is unchanged;
- prompt-injection fixture where job/resume text attempts to override instructions;
- provider response attempting to request more local data;
- provider response attempting to introduce external actions or URLs;
- response confidence or relationship labels trying to override a deterministic unknown or gap;
- factual rewrite fixture that introduces an unsupported metric and is blocked;
- rewrite fixtures that remove a negation or reassemble existing tokens into a stronger claim ("supported the lead" becoming "led"). The deterministic gate may pass these, so the test asserts they remain review-required and are never auto-accepted;
- a stale rewrite whose source statement changed after the request is rejected at acceptance;
- stale/superseded evidence between request and acceptance;
- provider, model, task schema, and instruction template provenance recorded correctly;
- remote and loopback consent enforcement. These cases are not applicable until a slice adds a non-in-process adapter, and are then mandatory.

## Security review requirements

Before the first implementation PR that adds a real provider can merge, review must explicitly cover:

- data minimization;
- remote and loopback consent UX;
- provider retention/training disclosures;
- secret storage;
- PWA credential exposure;
- CSP/connect-src changes;
- SSRF/network implications of local endpoints, including address pinning;
- prompt injection and data exfiltration;
- schema/resource exhaustion;
- log redaction of provider text;
- cancellation/timeouts;
- provider SDK dependency/licensing/supply-chain risk;
- backup/export exclusion of secrets, salts, and raw content;
- model response handling as untrusted input.

## Initial implementation sequence

This contract intentionally separates architecture from provider adoption.

### Slice A — contract types, broker, adjudication hooks, fake provider (#164)

**Implementation status:** implemented in Phase 14 (#164).
- Modules: `electron/src/inference/`. No deterministic module or production entry point imports them, and the production registry is empty.
- Tests: `tests/inference-conformance.test.cjs`, `tests/inference-adversarial.test.cjs`, `tests/inference-baseline.test.cjs` and `tests/inference-baseline-sqlite-smoke-test.cjs`.
- Test-only fake provider and conformance harness: `tests/support/`.
- The in-process network-denial check patches Node networking APIs. That is enough for the synthetic fake; an in-process real adapter (Slice B) needs process- or OS-level isolation.

Implement only:

- shared request/response/failure/provenance/capability types;
- the `InferenceBroker` policy shell, with task registration, capability checks, manifest computation, a broker-enforced timeout, and cancellation;
- hand-written closed-schema validators, with no new runtime dependency;
- request-scope and ID validation;
- the `InferenceAdjudicator`, which wraps the existing deterministic gates by injection without replacing or modifying them;
- in-memory provenance record construction, with the HMAC salt injected (a fixed test key in tests; Slice A stores no salt). Nothing is persisted in Slice A;
- a deterministic synthetic fake provider, registered from test code only, advertising exactly two tasks: `semantic-evidence-support` and `rewrite-resume-statement`;
- the conformance suite and adversarial synthetic fixtures;
- capability reporting that returns `{ available: false, reason: "not-configured" }` in both Electron and PWA;
- an import-boundary test proving deterministic modules do not import inference modules;
- regression tests proving the inference-disabled Truth Gate and core workflows preserve baseline behavior.

Slice A adds no network, no provider SDK, no credentials, no IPC channel, no UI, no persistence or migration, no new canonical write path, and no user data leaving the device.

This proves the boundary before a provider exists.

### Slice B — local provider candidate

Only after Slice A review, and in a separate issue:

- evaluate one local inference adapter against measured Sojourner tasks;
- preserve deterministic fallback;
- measure semantic lift against the benchmark below;
- do not change canonical authority rules.

Local inference is preferred for initial capability evaluation because it tests usefulness without introducing remote career-data transmission. A loopback endpoint still follows the loopback consent rules.

### Slice C — remote provider candidate

Only after explicit product/security approval:

- choose one provider based on measured capability, terms, privacy, reliability, cost, and maintenance;
- implement governed credentials and disclosure;
- add remote transport;
- run the same conformance suite plus remote privacy/security tests.

Provider choice is an implementation decision below this contract, not an architecture decision above it.

## Evaluation requirement

Inference should be adopted only where it demonstrates measurable lift over the deterministic baseline.

Each task candidate needs a benchmark that compares:

- deterministic-only output;
- inference-assisted proposal;
- factual/support violations;
- false direct/transferable mappings;
- missed relevant evidence;
- user correction rate where measurable;
- latency;
- provider failures;
- cost where applicable.

The benchmark must not consist only of fixtures whose wording was authored to align cleanly with the expected result. It must include adversarial and counterfactual cases:

- semantically relevant evidence with little lexical overlap;
- high lexical overlap with materially different meaning;
- explicit negation and exclusion;
- adjacent/transferable experience that must not become direct experience;
- unsupported metrics, tools, credentials, dates, titles, employers, ownership, scope, or outcomes;
- conflicting evidence records;
- stale/superseded evidence;
- sparse job text where unknown must remain unknown;
- source text containing prompt-injection instructions;
- job/evidence pairs designed to expose flattering but unsupported explanations.

Benchmark integrity rules:

- the fixture set is versioned and content-hashed;
- expected labels are authored before any provider output is seen and are never edited to match one;
- the deterministic baseline and inference-assisted path run over the **same input fixtures**;
- results are reported per adversarial category, not only in aggregate;
- demo fixtures, including the public demo recorder fixture, are illustrative only and never count as benchmark evidence;
- a task candidate is rejected if the inference-assisted path produces more factual or support violations than the deterministic baseline on the same fixtures.

A more fluent sentence is not sufficient evidence if factual reliability or explainability regresses.

## Compatibility and versioning

The contract version is independent of provider/model version.

Breaking changes to:

- request envelope;
- response envelope;
- task semantics or task schemas;
- data classes;
- authority/promotion rules;

require a new inference contract version (contract) or task schema version (task).

Adapters declare supported contract versions and per-task schema versions. Sojourner must fail closed on incompatible versions.

Model upgrades within a provider adapter must retain provenance and rerun the provider benchmark/conformance suite before promotion.

## Open questions

Resolved by Draft 0.2:

- *Durable inferential requirement/evidence relationships*: none in v1. A later design needs a distinct, separately reviewed type and may never change the deterministic mapper's meaning.
- *Whether retention/training policy is an adapter capability or configuration metadata*: disclosed at configuration and consent time. A machine-readable form can be added with Slice C without changing authority rules.

Still open, each gating only the surface named:

1. Remote consent memory (per receipt scope, per session, or per request). Gates: Slice C and any loopback adapter.
2. Safe remote-credential architecture for the PWA, if any. Gates: any PWA remote-provider claim.
3. Whether a local endpoint is a first-party adapter, a generic OpenAI-compatible protocol adapter, or both. Gates: Slice B.
4. Which task provides enough measurable value for the first real-provider slice. Gates: Slice B task selection.
5. The deterministic support gate for application materials, Career Stories, and interview answers. Gates: enabling their factual content.

These questions must be resolved before their corresponding implementation surface is enabled. They are not permission to let provider behavior decide by accident.

## Review record

Phase 13 adversarial architecture/security review of Draft 0.1. Each finding is resolved in the section named.

| # | Finding in Draft 0.1 | Resolved in |
| --- | --- | --- |
| F1 | "Must pass the existing Truth Gate" did not say which path; the gate token-checks only edited statements | [Resume statement rewrite](#resume-statement-rewrite), rule 2 |
| F2 | Layering diagram placed the inference branch after the gate; no dependency-direction rule | [Deterministic baseline invariant](#deterministic-baseline-invariant) |
| F3 | Provider requests for data/actions were "ignored", and chaining was not forbidden | [Untrusted input and prompt injection](#untrusted-input-and-prompt-injection), [Request envelope](#request-envelope) |
| F4 | Manifest declared beside the payload; consent not bound to it | [Data classes and transmission manifest](#data-classes-and-transmission-manifest), [Remote consent](#remote-consent) |
| F5 | Location self-reported by the adapter | [Location classification](#location-classification) |
| F6 | No task schema or instruction template versions; model mismatch undefined | [Request envelope](#request-envelope), [Response envelope](#response-envelope) |
| F7 | Provider error/warning text could leak prompt content | [Failure contract](#failure-contract), [Response envelope](#response-envelope) |
| F8 | Confidence and relationship labels not barred from assessment state | [Response envelope](#response-envelope), [Semantic evidence support](#semantic-evidence-support) |
| F9 | Retry ownership and late responses undefined | [Failure contract](#failure-contract) |
| F10 | Provenance store, failure ordering, archive inclusion, and hash scope undefined | [Local provenance and retention](#local-provenance-and-retention) |
| F11 | No capability report shape; test providers could be reported as available | [Runtime support and capability reporting](#runtime-support-and-capability-reporting) |
| F12 | Slice A scope unbounded | [Slice A](#slice-a--contract-types-broker-adjudication-hooks-fake-provider-164) |
| F13 | Benchmark lacked frozen labels, per-category reporting, demo exclusion, and a non-regression bar | [Evaluation requirement](#evaluation-requirement) |
| F14 | URLs, contact details, and paths in factual output were only "not fetched" | [Untrusted output](#untrusted-output) |
| F15 | No staleness re-check at acceptance | [User review and state promotion](#user-review-and-state-promotion) |
| F16 | Credentials not excluded from the envelope, provenance, or settings hash | [Credentials and secrets](#credentials-and-secrets) |
| F17 | Entry-point behavior when inference unavailable was unspecified | [Deterministic baseline invariant](#deterministic-baseline-invariant) |
| F18 | Conformance lacked scope, data-request, action/URL, confidence, and template cases | [Provider conformance](#provider-conformance) |
| F19 | Loopback endpoints can proxy to remote services; hostname checks can be rebound | [Location classification](#location-classification) |
| F20 | Rewrite evidence IDs could widen the gate's token pool; the write path stores text only | [Resume statement rewrite](#resume-statement-rewrite), rules 1, 2 and 5 |
| F21 | No deterministic factual gate for application materials, Career Stories, or interview answers | [Application materials, Career Stories, and interview practice](#application-materials-career-stories-and-interview-practice) |
| F22 | Explanation, prioritization, and search-insight prose had no deterministic factual control | [Opportunity explanation, prioritization, and search insight](#opportunity-explanation-prioritization-and-search-insight) |
| F23 | Slice A task schemas carried free-text rationale and unknowns | [Proposal contracts](#proposal-contracts) structured-only rule, [Semantic evidence support](#semantic-evidence-support), [Resume statement rewrite](#resume-statement-rewrite) |

Post-amendment review of Draft 0.2 (independent security review of the amended text):

| # | Finding in the amended text | Resolved in |
| --- | --- | --- |
| F24 | The completeness rule assumed blocker/gap/unknown IDs that the deterministic assessment does not have | [Opportunity explanation, prioritization, and search insight](#opportunity-explanation-prioritization-and-search-insight): IDs derived in the inference layer from the unchanged assessment |
| F25 | The acceptance re-check skipped the source statement, so a stale rewrite could overwrite a newer user edit | [Resume statement rewrite](#resume-statement-rewrite) rule 0, [User review and state promotion](#user-review-and-state-promotion) |
| F26 | The manifest covered the payload but not the transmitted `context` | [Data classes and transmission manifest](#data-classes-and-transmission-manifest) |
| F27 | Loopback resolve-and-pin is impossible in the PWA, and `in-process` was unverified | [Location classification](#location-classification) |

Minor items folded in by the same review:
- `inferred-pending` for extracted candidates, shown in a separate labeled review list rather than by changing the deterministic queue;
- no `createdBy: "inference"` map rows;
- verbatim checks for requirement extraction;
- one failure code per case;
- negation-removal and reassembled-claim conformance fixtures;
- confirmed-only evidence in semantic requests;
- URL rejection in every task;
- a statement of residual in-schema steering;
- a clamped `retryAfterSeconds`;
- non-acceptance provenance writes;
- the Slice A salt source.
