// Per-task specification shared by the broker (request building) and the
// adjudicator (scope and task checks). Canonical state is read only through the
// injected reader; deterministic gates are injected, never imported here.

import type {
  CandidateEvidence,
  ResumeStatement,
} from "../../../src/shared/career-contracts.js";
import type { ResumeTruthGateReport } from "../../../src/shared/resume-contracts.js";
import type {
  InferenceRequestContext,
  InferenceTask,
  InstructionTemplateRef,
} from "./contract.cjs";
import type { ManifestFieldRule } from "./manifest.cjs";

/** Read-only access to canonical state, injected by the runtime or test. */
export interface CanonicalReader {
  readStatements(projectionId: string): Promise<ResumeStatement[]>;
  readEvidence(ids: readonly string[]): Promise<CandidateEvidence[]>;
}

/** The existing deterministic Truth Gate, injected unchanged. */
export type TruthGate = (
  statements: ResumeStatement[],
  evidence: CandidateEvidence[],
) => ResumeTruthGateReport;

/** Local request-time snapshot; never transmitted. */
export interface RequestSnapshot {
  projectionId?: string;
  statementId?: string;
  statementText?: string;
  statementEvidenceIds?: string[];
  evidenceUpdatedAt: Record<string, string>;
  requestIds: { requirementIds: string[]; evidenceIds: string[] };
  /** Evidence and source-statement text a proposal may quote links, contacts or paths from. */
  allowedText?: string[];
}

export interface BuiltRequest {
  payload: unknown;
  context: InferenceRequestContext;
  snapshot: RequestSnapshot;
}

export interface TaskCheckDeps {
  reader: CanonicalReader;
  truthGate: TruthGate;
}

/** A task check returns null on success or a Sojourner-authored reason. */
export type TaskCheckResult = { code: "policy-violation" | "validation-failed"; message: string } | null;

export interface TaskSpec<TInput, TProposal> {
  task: InferenceTask;
  taskSchemaVersion: string;
  instructionTemplate: InstructionTemplateRef;
  manifestRules: readonly ManifestFieldRule[];
  redactions: readonly string[];
  buildRequest(input: TInput, reader: CanonicalReader): Promise<BuiltRequest>;
  validateProposal(value: unknown): TProposal;
  checkScope(proposal: TProposal, snapshot: RequestSnapshot): TaskCheckResult;
  checkTask(proposal: TProposal, snapshot: RequestSnapshot, deps: TaskCheckDeps): Promise<TaskCheckResult>;
}

export class RequestBuildError extends Error {
  constructor(
    readonly code: "policy-violation" | "validation-failed",
    message: string,
  ) {
    super(message);
  }
}

export function subsetOf(values: readonly string[], allowed: readonly string[]): boolean {
  return values.every((value) => allowed.includes(value));
}

/** Compares a fresh canonical read with the request-time evidence snapshot. */
export function evidenceChanged(
  snapshot: RequestSnapshot,
  fresh: readonly CandidateEvidence[],
): boolean {
  const byId = new Map(fresh.map((item) => [item.id, item]));
  return Object.entries(snapshot.evidenceUpdatedAt).some(
    ([id, updatedAt]) => byId.get(id)?.updatedAt !== updatedAt,
  );
}
