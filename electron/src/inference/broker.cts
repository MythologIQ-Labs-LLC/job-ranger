// InferenceBroker: registered tasks only, Sojourner-assigned location policy,
// computed manifest, broker-enforced timeout and cancellation, no retry, no
// fallback to another provider. It returns proposals; it never writes.

import {
  INFERENCE_CONTRACT_VERSION,
  inferenceFailure,
  type InferenceFailure,
  type InferenceHmac,
  type InferenceProvenance,
  type InferenceRequestEnvelope,
  type InferenceTask,
} from "./contract.cjs";
import type { AdjudicationResult, InferenceAdjudicator } from "./adjudicator.cjs";
import { ManifestCoverageError, computeTransmissionManifest } from "./manifest.cjs";
import { buildProvenance, type ProvenanceSource } from "./provenance.cjs";
import type { InferenceRegistry, InferenceRegistryEntry } from "./registry.cjs";
import { invokeWithLimits } from "./invoke.cjs";
import { rewriteResumeStatementSpec } from "./task-rewrite.cjs";
import { semanticEvidenceSupportSpec } from "./task-semantic.cjs";
import { RequestBuildError, type CanonicalReader, type RequestSnapshot, type TaskSpec } from "./task-spec.cjs";

const TASK_SPECS = new Map<InferenceTask, TaskSpec<unknown, unknown>>([
  [semanticEvidenceSupportSpec.task, semanticEvidenceSupportSpec as TaskSpec<unknown, unknown>],
  [rewriteResumeStatementSpec.task, rewriteResumeStatementSpec as TaskSpec<unknown, unknown>],
]);

export type InferenceRunResult<TProposal = unknown> =
  | {
      status: "review-required";
      request: InferenceRequestEnvelope;
      snapshot: RequestSnapshot;
      proposal: TProposal;
      provenance: InferenceProvenance;
      /** Binds snapshot and proposal for acceptance; see reviewToken(). */
      reviewToken: string;
    }
  | { status: "failed"; failure: InferenceFailure; provenance?: InferenceProvenance };

export interface InferenceBrokerOptions {
  registry: InferenceRegistry;
  adjudicator: InferenceAdjudicator;
  reader: CanonicalReader;
  hmac: InferenceHmac;
  clock?: () => string;
  newRequestId?: () => string;
}

export interface InferenceRunInput {
  task: InferenceTask;
  providerId: string;
  input: unknown;
  signal?: AbortSignal;
}

function resolveEntry(
  options: InferenceBrokerOptions,
  task: InferenceTask,
  providerId: string,
): { spec: TaskSpec<unknown, unknown>; entry: InferenceRegistryEntry } | InferenceFailure {
  const spec = TASK_SPECS.get(task);
  if (!spec) return inferenceFailure("unsupported-task", "pre-transmission", "This inference task is not registered.");
  const entry = options.registry.get(providerId);
  const descriptor = entry?.adapter.descriptor;
  const advertises = descriptor?.supportedTasks.some(
    (item) => item.task === task && item.taskSchemaVersion === spec.taskSchemaVersion,
  );
  if (!entry || !advertises || !descriptor?.supportedContractVersions.includes(INFERENCE_CONTRACT_VERSION)) {
    return inferenceFailure("not-configured", "pre-transmission", "No configured provider supports this task.");
  }
  if (entry.location !== "in-process") {
    return inferenceFailure("consent-required", "pre-transmission", "This provider needs consent, which is not available.");
  }
  return { spec, entry };
}

async function buildEnvelope(
  options: InferenceBrokerOptions,
  spec: TaskSpec<unknown, unknown>,
  entry: InferenceRegistryEntry,
  input: unknown,
): Promise<{ request: InferenceRequestEnvelope; snapshot: RequestSnapshot } | InferenceFailure> {
  try {
    const built = await spec.buildRequest(input, options.reader);
    const transmitted = { payload: built.payload, context: built.context };
    const request: InferenceRequestEnvelope = {
      contractVersion: INFERENCE_CONTRACT_VERSION,
      requestId: (options.newRequestId ?? (() => globalThis.crypto.randomUUID()))(),
      task: spec.task,
      taskSchemaVersion: spec.taskSchemaVersion,
      instructionTemplate: { ...spec.instructionTemplate },
      createdAt: (options.clock ?? (() => new Date().toISOString()))(),
      provider: { providerId: entry.adapter.descriptor.providerId, modelId: entry.modelId, location: entry.location },
      policy: { proposalOnly: true, mayCreateFacts: false, mayWriteCanonicalState: false, mayPerformExternalActions: false },
      transmission: computeTransmissionManifest(transmitted, spec.manifestRules, entry.location, spec.redactions),
      ...transmitted,
    };
    return { request, snapshot: built.snapshot };
  } catch (error) {
    if (error instanceof RequestBuildError) return inferenceFailure(error.code, "pre-transmission", error.message);
    if (error instanceof ManifestCoverageError) return inferenceFailure("policy-violation", "pre-transmission", error.message);
    throw error;
  }
}

function provenanceSource(entry: InferenceRegistryEntry, request: InferenceRequestEnvelope, completedAt: string): ProvenanceSource {
  const { descriptor } = entry.adapter;
  return {
    request,
    adapterVersion: descriptor.adapterVersion,
    location: entry.location,
    settings: { providerId: descriptor.providerId, adapterVersion: descriptor.adapterVersion,
      modelId: entry.modelId, location: entry.location, timeoutMs: entry.timeoutMs },
    completedAt,
  };
}

/** HMAC binding what was adjudicated, so acceptance can detect a changed proposal or snapshot. */
export function reviewToken(
  hmac: InferenceHmac,
  requestId: string,
  task: InferenceTask,
  snapshot: RequestSnapshot,
  proposal: unknown,
): string {
  return hmac(JSON.stringify({ requestId, task, snapshot, proposal }));
}

async function safeAdjudicate(
  options: InferenceBrokerOptions,
  ...args: Parameters<InferenceAdjudicator["adjudicate"]>
): Promise<AdjudicationResult<unknown>> {
  try {
    return await options.adjudicator.adjudicate(...args);
  } catch {
    return { ok: false, failure: inferenceFailure("invalid-response", "validation", "The response could not be validated.") };
  }
}

export interface InferenceBroker {
  run<TProposal = unknown>(run: InferenceRunInput): Promise<InferenceRunResult<TProposal>>;
}

export function createInferenceBroker(options: InferenceBrokerOptions): InferenceBroker {
  const now = options.clock ?? (() => new Date().toISOString());
  return {
    async run<TProposal>(run: InferenceRunInput): Promise<InferenceRunResult<TProposal>> {
      const resolved = resolveEntry(options, run.task, run.providerId);
      if ("code" in resolved) return { status: "failed", failure: resolved };
      const { spec, entry } = resolved;
      const built = await buildEnvelope(options, spec, entry, run.input);
      if ("code" in built) return { status: "failed", failure: built };
      const invoked = await invokeWithLimits(entry, built.request, run.signal);
      const source = provenanceSource(entry, built.request, now());
      if ("code" in invoked) {
        return { status: "failed", failure: invoked, provenance: buildProvenance(source, "failed", options.hmac, invoked.code) };
      }
      const adjudicated = await safeAdjudicate(options, spec, built.request, built.snapshot, invoked.raw, entry.adapter.descriptor);
      if (!adjudicated.ok) {
        const rejected = { ...source, resolvedModelId: adjudicated.resolvedModelId };
        return { status: "failed", failure: adjudicated.failure,
          provenance: buildProvenance(rejected, "rejected", options.hmac, adjudicated.failure.code) };
      }
      const accepted = { ...source, resolvedModelId: adjudicated.resolvedModelId, proposal: adjudicated.proposal, usage: adjudicated.usage };
      return { status: "review-required", request: built.request, snapshot: built.snapshot,
        proposal: adjudicated.proposal as TProposal, provenance: buildProvenance(accepted, "pending", options.hmac),
        reviewToken: reviewToken(options.hmac, built.request.requestId, spec.task, built.snapshot, adjudicated.proposal) };
    },
  };
}
