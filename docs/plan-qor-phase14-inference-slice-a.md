# Plan: Phase 14 - Inference Slice A: contract types, broker, adjudication hooks, fake provider, conformance

**change_class**: feature

**doc_tier**: standard

**terms_introduced**:
- term: InferenceBroker
  home: docs/design/INFERENCE_CONTRACT.md
- term: InferenceAdjudicator
  home: docs/design/INFERENCE_CONTRACT.md
- term: inference capability report
  home: docs/design/INFERENCE_CONTRACT.md

**boundaries**:
- limitations: provider-free; the only provider is a deterministic synthetic fake registered from test code; nothing is persisted; no UI or IPC
- non_goals: a real provider (local or remote), credentials, network, SDKs, benchmark lift measurement, enabling any inference feature for users
- exclusions: no change to any deterministic module (Truth Gate, mapper, assessment, Career Evidence, resume, application materials, interview prep, lifecycle)

**pr_target**: main (issue #164)

**iteration**: 2

Amended after the plan audit VETO recorded at META_LEDGER Entry #75. Iteration 2 adds the missing Draft 0.2 rules: semantic-support evidence checks, location classification with fail-closed consent, a network-denial conformance check, a lane split for the SQLite test, adjudication-time staleness, and caller cancellation. Every non-blocking observation is also folded in.

Implements Slice A of `docs/design/INFERENCE_CONTRACT.md` Draft 0.2, as defined in its "Slice A" section and in the #164 acceptance criteria. The slice proves that Sojourner can host optional inference behind a bounded, testable seam without a provider, while the deterministic product stays untouched.

## Open Questions

None.

## Evidence

- The contract (Draft 0.2, merged with #163) defines the Slice A scope, the envelope, failure, provenance and capability types, the closed schemas of the two Slice A tasks, and the conformance list.
- The deterministic gate is `ResumeService.evaluateTruth(projection, statements, evidence)` (`electron/src/resume-service.cts:301-373`). It is callable without SQLite: `tests/resume-truth-gate-multilingual.test.cjs:11-17` builds a `ResumeService` with an unused database path and calls it directly.
- Canonical re-reads and the existing write path also exist:
  - `ResumeService.getProjectionDetail(id)` (`resume-service.cts:274-289`) returns the canonical statements, the selected evidence, and a Truth Gate report;
  - `ResumeService.updateStatement(id, { text })` (`resume-service.cts:291-299`) is the existing write.
- `tests/resume-lifecycle-smoke-test.cjs:11-130` shows how to build a real SQLite-backed `SojournerBackend`, `CareerEvidenceRepository` and `ResumeService` with network fetch forbidden, and how to create a confirmed-evidence projection.
- `buildJobEvidenceCoverage(jobId, requirements, evidence, now)` (`electron/src/requirement-mapper.cts:344-352`) and `buildOpportunityAssessment(job, track, coverage, now)` (`src/shared/opportunity-assessment.ts:252-256`) are pure deterministic functions.
- `tsconfig.electron.json` compiles `electron/src/**/*.cts` into `electron-runtime/`. Tests `require` the compiled `.cjs` (for example `tests/resume-truth-gate-multilingual.test.cjs:5`). No production entry point will import the new modules, so the PWA bundle is unaffected. `electron-builder.json:12` packages `electron-runtime/**/*`, so the compiled `inference/*.cjs` files ship inert in desktop builds: no entry point loads them, and the production registry is empty.
- `npm test` and `npm run test:unit` are explicit `&&` chains in `package.json:21-22`. `test:unit` is SQLite-free by construction: it omits every SQLite smoke test. The release lane (`.github/workflows/ci.yml:37-39`) runs it without SQLite provisioning. Pure tests therefore go in both chains, and the SQLite smoke test goes in `npm test` only, like the existing smoke tests.
- `CareerEvidenceRepository.reviewEvidence` updates `updated_at` (`electron/src/career-evidence-repository.cts:412`), so tests can produce stale evidence through an existing API. `canEvidenceSupportFactualClaim` (`src/shared/career-contracts.ts:401-408`) is the existing confirmation predicate.
- `buildJobEvidenceCoverage` and `buildOpportunityAssessment` default `now` to the current time; tests pass a fixed `now`.
- Hand-written validators are the repository's pattern: `electron/src/validators.cts` and the per-feature `*-validator.cts` files. No JSON-schema library is a dependency.

## Locked Decisions

- LD1: The new modules live under `electron/src/inference/` and import only `src/shared` types and Node built-ins that are injected. They are never imported by any deterministic module or by any production entry point (`main.cts`, `preload.cts`, `backend.cts`, `*-ipc.cts`, `src/pwa/**`, `src/**` UI). The modules:
  - `contract.cts`: types and closed enums;
  - `schemas-envelope.cts` and `schemas-tasks.cts`: closed validators;
  - `manifest.cts`: manifest computation;
  - `adjudicator.cts`: the `InferenceAdjudicator`;
  - `broker.cts`: the `InferenceBroker`, with registry, capability, timeout and cancellation;
  - `acceptance.cts`: the rewrite acceptance re-check and existing-path write;
  - `provenance.cts`: in-memory provenance with an injected HMAC.
  Each file is at most 250 lines, each function at most 40 lines, with nesting at most 3.
- LD2: Contract fidelity. Types match Draft 0.2 exactly:
  - `InferenceTask` (all ten values), `InferenceLocation` (`in-process | loopback | remote`), `InferenceDataClass`, and the request and response envelopes, including `taskSchemaVersion` and `instructionTemplate`;
  - `InferenceFailure {code, phase, message, retryAfterSeconds?}`, `InferenceProvenance` and `InferenceCapabilityReport`;
  - the closed `SemanticEvidenceSupportProposal` and `ResumeStatementRewriteProposal` with their closed code enums.
  Only the two Slice A tasks have registered task specs.
- LD3: Closed validation (`schemas-envelope.cts`, `schemas-tasks.cts`). Validators reject:
  - unknown keys at every level;
  - wrong types and out-of-enum values;
  - any key matching `/confidence|probability|score/i`;
  - an echo mismatch in `contractVersion`, `requestId`, `task`, `taskSchemaVersion` or `instructionTemplate`;
  - a `provider.providerId` or `adapterVersion` that differs from the registered descriptor (known-identity check);
  - a `modelId` mismatch unless the descriptor sets `resolvesModelAliases`;
  - output above a fixed byte bound (64 KiB serialized) and arrays above fixed item bounds.
  Failures map to the Draft 0.2 codes: `invalid-response` for schema and envelope problems, `policy-violation` for scope and policy, `validation-failed` for task checks. To stay within the Razor limits, the validators are split into `schemas-envelope.cts` and `schemas-tasks.cts`.
- LD4: Manifest (`manifest.cts`). `computeTransmissionManifest(envelopeWithoutManifest, fieldPolicy)` walks every leaf of `payload` and `context` and assigns each to a data class from the task's declared field policy. Any uncovered leaf throws `policy-violation` (phase `pre-transmission`). The manifest is attached before the adapter is called. Slice A transmits nothing; "transmission" means handing the envelope to the in-memory fake adapter.
- LD5: Scope and policy checks (adjudicator). Every referenced ID must be in the request's ID set. For rewrites, `supportingEvidenceIds` must be a subset of the source statement's canonical `evidenceIds` and `unsupportedRequirementIds` must be request-scoped. A URL (`scheme://` or `www.`), email address, phone number (at least 7 digits with separators) or filesystem path in `proposedText` that is absent from the request's evidence text is a `policy-violation`. A path means a drive-letter path, a leading `/` or `~/` followed by at least two segments, or a `\`-separated path. The patterns are deliberately narrow, so ordinary terms such as "CI/CD" and "A/B testing" never trigger them. A negative fixture proves it.
  - Semantic-support checks:
    - the broker builds semantic requests only from confirmed evidence, filtered with the existing `canEvidenceSupportFactualClaim`; a request containing unconfirmed evidence cannot be built;
    - the adjudicator receives `readEvidence(ids)` by injection (in tests, a real `CareerEvidenceRepository.getEvidenceById`). Every `rationale.evidenceFields` entry must name a field that is non-empty on the freshly read canonical record; otherwise it is `validation-failed`.
- LD6: Truth Gate wrapping (adjudicator and acceptance).
  - The adjudicator receives `truthGate: (statements, evidence) => ResumeTruthGateReport` and an async `readCanonical: (projectionId) => Promise<{ statements, evidence }>` by injection. In tests these are thin lambdas over a real `ResumeService`: `(st, ev) => service.evaluateTruth({}, st, ev)` and `getProjectionDetail`.
  - It evaluates `[{ ...sourceStatement, text: proposedText, userEdited: true }]` against freshly read canonical evidence.
  - Any issue is `validation-failed`.
  - A passing rewrite is returned as `{ status: "review-required", ... }`. Nothing is ever auto-accepted, whatever the gate's result.
  - The gate and every deterministic module are unchanged; the diff touches no file outside `electron/src/inference/`, `tests/`, `package.json` and docs.
- LD7a: Snapshot capture and adjudication-time staleness (contract rule 0 and adjudication item 10).
  - When building a rewrite request, the broker captures a snapshot from the canonical read: the source statement's `text` and `evidenceIds`, and each referenced evidence `updatedAt`. Semantic requests capture each evidence `updatedAt` the same way.
  - The snapshot stays local and is never placed in the transmitted envelope.
  - The adjudicator re-reads canonical state and compares it with the snapshot before running any gate. A difference is `validation-failed` (phase `validation`).
- LD7: Acceptance (`acceptance.cts`). `acceptRewrite(result, deps)`:
  1. re-reads the canonical detail;
  2. compares the source statement's `text` and `evidenceIds` with the request snapshot, and each evidence `updatedAt` with the captured values;
  3. re-runs the injected gate;
  4. writes only through the injected `updateStatement(id, { text })`.
  Any mismatch is `validation-failed` (phase `acceptance`) with no write. It requires an explicit `userApproved: true` argument.
- LD8: Broker (`broker.cts`).
  - Location classification: each registry entry carries a Sojourner-assigned `location`, set at registration and separate from the descriptor's `declaredLocation`, which the broker never reads for policy. The manifest's `location` is that classification.
  - Slice A has no consent mechanism, so the broker refuses any provider classified `loopback` or `remote` with `consent-required` (phase `pre-transmission`) before calling it. A conformance case registers the fake as `remote` and asserts this, with the adapter call counter at 0.
  - Callers may pass their own `AbortSignal`. Caller cancellation gives `{ code: "cancelled", phase: "provider" }`, the adapter sees `signal.aborted === true`, and the adapter call counter stays at 1.
  - `createInferenceBroker({ registry, adjudicator, hmac, clock, timeoutMs })` accepts only registered tasks (`unsupported-task`) and only registry providers that advertise the task and the contract version (`not-configured` otherwise).
  - It enforces the timeout with an `AbortController` and `Promise.race` and passes `signal` to the adapter. A response arriving after timeout or cancellation is discarded and never adjudicated.
  - It performs no retry and never falls back to another provider.
  - A thrown adapter error is classified only by its declared `code`; provider message text is never copied into the failure. A test makes the fake's `provider-error` and `rate-limited` behaviors throw a sentinel message, then asserts the sentinel appears in no failure field and no provenance field.
  - `rate-limited` carries `retryAfterSeconds` clamped to 0-3600.
- LD9: Capability and registry.
  - `createProductionInferenceRegistry()` returns an empty registry.
  - `reportInferenceCapability(registry, runtime)` returns `{ available: false, reason: "not-configured" }` for an empty registry, for both `"electron"` and `"pwa"`.
  - The fake provider lives in `tests/support/inference-fake-provider.cjs` and is registered only by tests.
- LD10: Provenance (`provenance.cts`). Records are built in memory with every Draft 0.2 field. Content hashes are `hmac(JSON.stringify(...))` with the injected `hmac`; tests use Node `crypto.createHmac` with a fixed test key. In Slice A, `providerSettingsHash` is the HMAC of the registry entry's non-secret settings: `providerId`, `adapterVersion`, `modelId`, location and timeout. The fake has no credentials. No raw prompt or response is stored; a test asserts that no provenance field contains payload or proposal text.
- LD11: The fake provider is obviously synthetic and deterministic: `providerId: "synthetic-fake"`, `declaredLocation: "in-process"`. Its response is chosen by a scripted `behavior` key, never by interpreting input semantics. Behaviors:
  - `valid`, `malformed-json`, `unknown-field`, `out-of-scope-id`, `unknown-requirement-id`, `invented-evidence-id`, `non-subset-evidence-id`, `empty-evidence-field`;
  - `oversized`, `hang`, `late`, `rate-limited`, `provider-error`;
  - `request-more-data`, `external-action-url`, `confidence-field`, `relationship-direct-on-gap`;
  - `unsupported-metric`, `negation-removal`, `reassembled-claim`;
  - `wrong-template-version`, `wrong-contract-version`, `wrong-provider-identity`, `model-alias`, `network-attempt`.
  - `network-attempt` tries to open a connection; the network-denial check must catch it.
- LD12: Conformance harness. `tests/support/inference-conformance.cjs` exports `runInferenceConformance(providerFactory, deps)` covering every Draft 0.2 conformance case applicable to an in-process provider. Remote and loopback consent cases are reported as not applicable, except the fail-closed refusal in LD8. `tests/inference-conformance.test.cjs` runs it against the fake provider.
  - Network-denial check for `in-process` (contract: an `in-process` adapter needs a network-denied conformance test). While the provider runs, the harness replaces these with throwing stubs and restores them in a `finally`:
    - `globalThis.fetch`;
    - `net.connect`, `net.createConnection` and `net.Socket.prototype.connect`;
    - `http.request` and `https.request`, with their `get` variants;
    - `dns.lookup`.
  - Any attempt fails the provider's conformance. The `network-attempt` behavior proves the check catches an attempt.
- LD13: Adversarial synthetic fixtures. `tests/fixtures/inference/adversarial.json` is versioned and content-hashed (the hash is asserted in the test). It covers the ten Draft 0.2 benchmark categories with synthetic records. `tests/inference-adversarial.test.cjs` runs the **deterministic baseline and the inference path over the same fixtures** and asserts the seam invariants:
  - deterministic coverage and assessment are identical before and after any proposal, including a `direct` label on a deterministic gap;
  - unknown requirements stay unknown;
  - prompt-injection text in a payload cannot add fields or IDs;
  - unsupported and stale cases are rejected or review-required.
  It measures no semantic lift; the fixtures are not benchmark evidence for adoption.
- LD14: Baseline regression, split by lane. Checks (a), (b), (c) and (e) are in `tests/inference-baseline.test.cjs` (pure; both `test` and `test:unit`). Check (d) is in `tests/inference-baseline-sqlite-smoke-test.cjs` (`npm test` only).
  - (a) a static import-boundary scan: no file in `electron/src` outside `inference/`, and no file in `src/`, references `inference/` through a static import, `require(`, or dynamic `import(`;
  - (b) a runtime check in a child process that has loaded no inference module: loading every Node-loadable deterministic module leaves no `inference/` module in `require.cache`. `main.cjs` and `preload.cjs` need Electron, so check (a) covers them;
  - (c) Truth Gate golden cases give identical reports, timestamps excluded, before and after the inference modules are loaded;
  - (d) a real SQLite workflow, with network forbidden, creates a deterministic resume projection, then runs:
    - failing broker paths (provider error, timeout, invalid response, policy violation);
    - a stale acceptance;
    - a rejected acceptance without approval;
    and asserts the canonical statements and evidence are byte-identical before and after, and that the deterministic projection still renders with the Truth Gate passing;
  - (e) with a fixed `now`, `buildJobEvidenceCoverage` and `buildOpportunityAssessment` outputs are identical with the inference modules loaded.
  The existing application-materials, interview-prep, Career Evidence and lifecycle smoke suites keep running unchanged in `npm test`. Check (a) proves those modules cannot depend on inference.
- LD15: Docs. The contract's Slice A section gains an "Implementation status" line naming the modules and tests. `docs/planning/PLAN.md` marks #164 complete. `docs/ARCHITECTURE_PLAN.md` adds the module paths. CHANGELOG Unreleased says that no user-facing inference exists.

## Phase 1: Contract types, validators, manifest

### Affected Files

- `electron/src/inference/contract.cts` (new)
- `electron/src/inference/schemas-envelope.cts`, `electron/src/inference/schemas-tasks.cts` (new)
- `electron/src/inference/manifest.cts` (new)

### Unit Tests

- `tests/inference-conformance.test.cjs` validator cases. Each feeds a crafted response to the validator and asserts the exact failure code and that nothing is returned as a proposal:
  - an unknown field, a confidence key, or an out-of-enum code gives `invalid-response`;
  - an echo mismatch gives `invalid-response`;
  - a model alias passes only with `resolvesModelAliases`.
- Manifest cases: an envelope with a payload or context leaf missing from the field policy throws `policy-violation` (phase `pre-transmission`). A covered envelope yields the expected data classes and record IDs.

## Phase 2: Adjudicator, acceptance, broker, capability, provenance

### Affected Files

- `electron/src/inference/adjudicator.cts`, `acceptance.cts`, `broker.cts`, `provenance.cts` (new)
- `tests/support/inference-fake-provider.cjs`, `tests/support/inference-conformance.cjs` (new)
- `tests/fixtures/inference/adversarial.json` (new)
- `tests/inference-conformance.test.cjs`, `tests/inference-adversarial.test.cjs`, `tests/inference-baseline.test.cjs`, `tests/inference-baseline-sqlite-smoke-test.cjs` (new)
- `package.json`: the three pure tests appended to `test` and `test:unit`; the SQLite smoke test appended to `test` only

### Unit Tests

- Conformance: every LD11 behavior gives the expected outcome:
  - `valid` gives `review-required` for both tasks;
  - each invalid behavior gives its exact code and phase;
  - `hang` gives `timeout`;
  - `late` is discarded after cancellation;
  - `rate-limited` gives the clamped `retryAfterSeconds`;
  - there is no second provider call (call counter);
  - a provider registered as `remote` gives `consent-required` before any call;
  - caller cancellation gives `cancelled`;
  - `network-attempt` is caught by the network-denial check;
  - `empty-evidence-field` and `unknown-requirement-id` give their exact codes;
  - a stale-at-adjudication fixture gives `validation-failed` (phase `validation`);
  - the sentinel provider text appears nowhere;
  - the path-pattern negative fixture ("CI/CD", "A/B testing") passes;
  - provenance carries all versions with HMAC hashes and no raw text.
- Adversarial: the LD13 invariants over the shared fixture set.
- Baseline: LD14 (a), (b), (c) and (e) in the pure test; (d) in the SQLite smoke test.
- Capability: the production registry is empty and both runtimes report `not-configured`.

## Phase 3: Documentation

### Affected Files

- `docs/design/INFERENCE_CONTRACT.md`, `docs/planning/PLAN.md`, `docs/ARCHITECTURE_PLAN.md`, `CHANGELOG.md`, `docs/GOVERNANCE_INDEX.md`, `docs/FEATURE_INDEX.md` (n/a check)

### Unit Tests

- None (documentation).

## Feature Inventory Touches

None user-touchable. No route, IPC command, UI event or service is exposed. `FEATURE_INDEX.md` is unchanged: n/a-justified, because no user-facing feature ships.

## Definition of Done

### Deliverable: Provider-free inference seam

- **D1**: Sojourner hosts optional inference behind a broker and adjudicator that wrap, without modifying, the deterministic gates. The seam is proven by a synthetic provider and a conformance suite, and the product is unchanged with inference absent.
- **D2**: The listed modules and tests exist within the Razor limits; no deterministic file is modified; no dependency is added.
- **D3**: Ledger plan, audit, implement and seal entries; governance index row; contract implementation status; PLAN, ARCHITECTURE_PLAN and CHANGELOG updated; #164 acceptance criteria ticked.
- **D4**: `node tests/inference-conformance.test.cjs`, `node tests/inference-adversarial.test.cjs`, `node tests/inference-baseline.test.cjs` and `node tests/inference-baseline-sqlite-smoke-test.cjs` pass. `npm test` and `npm run typecheck` pass. `git diff --stat main` shows no deterministic module changed.

## CI Commands

- `npm test` - full unit and smoke suite including the three new inference tests.
- `npm run typecheck` - TypeScript over `electron/src/inference/`.
- `node tests/inference-baseline.test.cjs` - deterministic baseline regression with inference absent.
- `node tests/inference-baseline-sqlite-smoke-test.cjs` - real-SQLite proof that inference failures leave canonical state unchanged.
