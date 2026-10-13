// Persistent local agent-workspace state (#286 G3). The reconciliation core runs in the
// renderer (src/agent-workspace); this contract is how it reads and atomically commits the
// locally trusted state that both runtimes keep in Job Ranger's own SQLite database:
// receipts, the idempotency ledger, agent items, quarantine, runs and user decisions.
// None of it is ever written to an agent-writable folder.

export type AgentItemState =
  /** Imported into the agent-owned draft namespace under the user's standing policy. */
  | "draft"
  /** Agent-owned work that needs a look before it is used (fork, policy, unknown target). */
  | "staged"
  /** A consequential claim or proposal waiting for the user's review. */
  | "proposal"
  /** Cites evidence that changed or is not confirmed; text kept, facts need rebase. */
  | "needs_rebase"
  /** Waits for a causal predecessor that has not arrived intact. */
  | "pending"
  /** Its identity or branch is disputed; never used automatically (#289). */
  | "contested"
  // User decisions; reconciliation never changes these.
  | "kept"
  | "dismissed"
  | "rejected_by_user"
  | "applied";

export const AGENT_ITEM_DECISION_STATES: readonly AgentItemState[] = ["kept", "dismissed", "rejected_by_user", "applied"];

export interface AgentWorkspacePolicy {
  /** Agent-owned kinds imported automatically into the draft namespace. */
  autoImportKinds: string[];
}

export interface AgentRunSummary {
  runId: number;
  startedAt: string;
  completedAt: string;
  counts: Record<string, number>;
  batches: { location: string; batchId: string | null; status: string; reasons: string[] }[];
}

export interface AgentWorkspaceStateDto {
  workspaceId: string;
  policy: AgentWorkspacePolicy;
  ledgerRevision: number;
  lastRun: AgentRunSummary | null;
  itemCounts: Partial<Record<AgentItemState, number>>;
  openQuarantine: number;
  receiptCount: number;
}

export interface AgentLedgerOperationRow {
  operationId: string;
  /** A jr-agent-reconcile-ledger v2 operation entry; validated by the core on load. */
  entry: Record<string, unknown>;
}

export interface AgentLedgerBatchRow {
  batchId: string;
  sha256: string;
  actorClaim: string | null;
}

export interface AgentPage<T> {
  rows: T[];
  nextCursor: string | null;
}

export interface AgentReceiptRecord {
  exportId: string;
  receipt: Record<string, unknown>;
  recordedAt: string;
}

export interface AgentItemInput {
  operationId: string;
  contentSha256: string;
  recordId: string;
  kind: string;
  batchId: string;
  actorClaim: string;
  sourceExportId: string;
  authoredAt: string;
  location: string;
  outcome: string;
  flags: string[];
  contest: string[];
  /** The original operation object as submitted (bounded by the batch limits). */
  operation: Record<string, unknown>;
}

export interface AgentQuarantineInput {
  kind: "batch" | "operation";
  location: string;
  batchId: string | null;
  operationId: string | null;
  sha256: string;
  reasons: string[];
  /** Original batch bytes (base64) for batch entries; dropped beyond the size limits. */
  bytesBase64: string | null;
  byteLength: number | null;
  operation: Record<string, unknown> | null;
}

export interface AgentReconciliationCommit {
  /** Ledger revision the plan was computed from; a concurrent commit makes this one fail. */
  expectedRevision: number;
  startedAt: string;
  ledgerOperations: AgentLedgerOperationRow[];
  ledgerBatches: AgentLedgerBatchRow[];
  items: AgentItemInput[];
  downgrades: { operationId: string; contest: string[] }[];
  quarantine: AgentQuarantineInput[];
  /** Batch digests accepted in this run; earlier quarantine of the same bytes is resolved. */
  acceptedBatchShas: string[];
  counts: Record<string, number>;
  batches: AgentRunSummary["batches"];
}

export interface AgentCommitResult {
  runId: number;
  ledgerRevision: number;
  completedAt: string;
  quarantineBytesDropped: number;
}

export interface AgentItemSummary {
  operationId: string;
  contentSha256: string;
  recordId: string;
  kind: string;
  batchId: string;
  actorClaim: string;
  sourceExportId: string;
  authoredAt: string;
  location: string;
  outcome: string;
  state: AgentItemState;
  previousState: AgentItemState | null;
  flags: string[];
  contest: string[];
  title: string;
  firstSeenRun: number;
  lastSeenRun: number;
  updatedAt: string;
  /** Usable as an agent-owned draft: imported without contest, or kept by the user. */
  eligible: boolean;
}

export interface AgentItemDetail extends AgentItemSummary {
  operation: Record<string, unknown>;
  decisions: AgentDecisionRecord[];
  /** Other stored content variants of the same operation ID (contested versions). */
  variants: { contentSha256: string; batchId: string; actorClaim: string; state: AgentItemState }[];
}

export interface AgentQuarantineSummary {
  quarantineKey: string;
  kind: "batch" | "operation";
  location: string;
  batchId: string | null;
  operationId: string | null;
  sha256: string;
  reasons: string[];
  byteLength: number | null;
  bytesRetained: boolean;
  status: "open" | "resolved";
  firstSeenRun: number;
  lastSeenRun: number;
  resolvedRun: number | null;
}

export interface AgentQuarantineDetail extends AgentQuarantineSummary {
  bytesBase64: string | null;
  operation: Record<string, unknown> | null;
}

export type AgentDecisionAction =
  /** Keep agent-owned work as a usable draft (never approves a fact). */
  | "keep_draft"
  /** Hide agent work without deleting it. */
  | "dismiss"
  /** Decline a claim or proposal. */
  | "reject_proposal"
  /** Record that the user changed an application's status through the existing workflow. */
  | "record_status_applied";

export interface AgentDecisionInput {
  operationId: string;
  contentSha256: string;
  action: AgentDecisionAction;
  note?: string;
  /** Required to keep a contested version: the user saw every alternative. */
  acknowledgeContest?: boolean;
  /** For record_status_applied: the application and the canonical status now stored. */
  applicationId?: string;
  appliedStatus?: string;
}

export interface AgentDecisionRecord {
  decisionId: number;
  operationId: string;
  contentSha256: string;
  action: AgentDecisionAction;
  fromState: AgentItemState;
  toState: AgentItemState;
  note: string | null;
  decidedAt: string;
}

export interface AgentItemFilter {
  states?: AgentItemState[];
  cursor?: string | null;
  limit?: number;
}

export interface AgentWorkspaceDesktopApi {
  agentWorkspace: {
    getState(): Promise<AgentWorkspaceStateDto>;
    setPolicy(policy: AgentWorkspacePolicy): Promise<AgentWorkspaceStateDto>;
    recordExport(receipt: Record<string, unknown>): Promise<AgentReceiptRecord>;
    listReceipts(): Promise<AgentReceiptRecord[]>;
    ledgerOperations(cursor: string | null, limit: number): Promise<AgentPage<AgentLedgerOperationRow>>;
    ledgerBatches(cursor: string | null, limit: number): Promise<AgentPage<AgentLedgerBatchRow>>;
    commitReconciliation(commit: AgentReconciliationCommit): Promise<AgentCommitResult>;
    listItems(filter: AgentItemFilter): Promise<AgentPage<AgentItemSummary>>;
    getItem(operationId: string, contentSha256: string): Promise<AgentItemDetail | null>;
    listQuarantine(): Promise<AgentQuarantineSummary[]>;
    getQuarantine(quarantineKey: string): Promise<AgentQuarantineDetail | null>;
    listRuns(limit: number): Promise<AgentRunSummary[]>;
    decide(decision: AgentDecisionInput): Promise<AgentItemDetail>;
  };
}
