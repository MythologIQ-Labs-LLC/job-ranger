// Provider-neutral inference contract types (docs/design/INFERENCE_CONTRACT.md,
// Draft 0.2). Inference returns proposals; nothing here writes canonical state.
// Deterministic modules must never import this directory.

export const INFERENCE_CONTRACT_VERSION = "1";

export type InferenceLocation = "in-process" | "loopback" | "remote";

export type InferenceTask =
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

export type InferenceDataClass =
  | "public-job-text"
  | "career-evidence"
  | "career-preferences"
  | "resume-content"
  | "application-material"
  | "application-history"
  | "interview-content"
  | "contact-data"
  | "credential-identifiers";

export interface InstructionTemplateRef {
  id: string;
  version: string;
}

export interface InferenceProviderDescriptor {
  providerId: string;
  adapterVersion: string;
  /** Adapter's claim only; policy uses the registry's assigned location. */
  declaredLocation: InferenceLocation;
  displayName: string;
  supportedContractVersions: string[];
  supportedTasks: Array<{ task: InferenceTask; taskSchemaVersion: string }>;
  models: Array<{ modelId: string; displayName: string; contextLimit?: number }>;
  resolvesModelAliases: boolean;
  supportsCancellation: boolean;
  reportsUsage: boolean;
  reportsCost: boolean;
}

export interface InferenceTransmissionItem {
  dataClass: InferenceDataClass;
  purpose: string;
  recordIds: string[];
  fields: string[];
  redactions: string[];
}

export interface InferenceTransmissionManifest {
  location: InferenceLocation;
  items: InferenceTransmissionItem[];
  containsPersonalCareerData: boolean;
  consentReceiptId: string | null;
}

export interface InferenceRequestContext {
  locale?: string;
  targetTrackId?: string;
  jobId?: string;
  applicationId?: string;
  sourceArtifactIds?: string[];
  evidenceIds?: string[];
}

export interface InferenceRequestEnvelope<TPayload = unknown> {
  contractVersion: typeof INFERENCE_CONTRACT_VERSION;
  requestId: string;
  task: InferenceTask;
  taskSchemaVersion: string;
  instructionTemplate: InstructionTemplateRef;
  createdAt: string;
  provider: { providerId: string; modelId: string; location: InferenceLocation };
  policy: {
    proposalOnly: true;
    mayCreateFacts: false;
    mayWriteCanonicalState: false;
    mayPerformExternalActions: false;
  };
  transmission: InferenceTransmissionManifest;
  context: InferenceRequestContext;
  payload: TPayload;
}

export type InferenceWarningCode =
  | "input-truncated"
  | "low-information-input"
  | "task-partially-supported";

export interface InferenceUsage {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  currency?: string;
}

export interface InferenceResponseEnvelope<TProposal = unknown> {
  contractVersion: typeof INFERENCE_CONTRACT_VERSION;
  requestId: string;
  task: InferenceTask;
  taskSchemaVersion: string;
  instructionTemplate: InstructionTemplateRef;
  provider: { providerId: string; modelId: string; adapterVersion: string };
  completedAt: string;
  proposal: TProposal;
  warnings: Array<{ code: InferenceWarningCode }>;
  usage?: InferenceUsage;
}

export type SemanticRationaleCode =
  | "shared-skill"
  | "shared-method-or-tool"
  | "similar-scope"
  | "related-outcome"
  | "adjacent-domain";

export type EvidenceField =
  | "statement"
  | "skills"
  | "methodsOrTools"
  | "scope"
  | "outcomes"
  | "metrics";

export interface SemanticEvidenceSupportProposal {
  requirementId: string;
  candidateEvidence: Array<{
    evidenceId: string;
    proposedRelationship: "direct" | "transferable" | "ambiguous";
    rationale: { code: SemanticRationaleCode; evidenceFields: EvidenceField[] };
  }>;
  unknownRequirementIds: string[];
}

export type RewriteRationaleCode =
  | "clarity"
  | "concision"
  | "active-voice"
  | "keyword-alignment"
  | "ordering";

export interface ResumeStatementRewriteProposal {
  sourceStatementId: string;
  supportingEvidenceIds: string[];
  proposedText: string;
  rationaleCode: RewriteRationaleCode;
  unsupportedRequirementIds: string[];
}

export type InferenceFailureCode =
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

export type InferenceFailurePhase = "pre-transmission" | "provider" | "validation" | "acceptance";

export interface InferenceFailure {
  code: InferenceFailureCode;
  phase: InferenceFailurePhase;
  /** Bounded, authored by Sojourner. Never provider-supplied text. */
  message: string;
  retryAfterSeconds?: number;
}

export type InferenceProvenanceOutcome =
  | "pending"
  | "accepted"
  | "rejected"
  | "discarded"
  | "failed"
  | "finalize-unknown";

export interface InferenceProvenance {
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
  providerSettingsHash: string;
  inputRecordIds: string[];
  inputContentHash: string;
  outputContentHash: string;
  createdAt: string;
  completedAt: string;
  outcome: InferenceProvenanceOutcome;
  failureCode?: InferenceFailureCode;
  usage?: InferenceUsage;
}

export type InferenceCapabilityReport =
  | {
      available: false;
      reason: "not-configured" | "runtime-unsupported" | "consent-required" | "credentials-missing";
    }
  | { available: true; providerId: string; location: InferenceLocation; tasks: InferenceTask[] };

/** Thrown by adapters to report a provider-side failure. Only `code` is read. */
export interface InferenceAdapterError {
  code: "rate-limited" | "provider-unavailable" | "provider-error";
  retryAfterSeconds?: number;
}

export interface InferenceProviderAdapter {
  descriptor: InferenceProviderDescriptor;
  invoke(request: InferenceRequestEnvelope, signal: AbortSignal): Promise<unknown>;
}

/** Keyed hash with a per-install secret salt, injected by the runtime. */
export type InferenceHmac = (data: string) => string;

export function inferenceFailure(
  code: InferenceFailureCode,
  phase: InferenceFailurePhase,
  message: string,
): InferenceFailure {
  return { code, phase, message };
}
