// Persistence-backed agent workspace sync (#286 G3). Loads the locally trusted receipts and
// ledger from Job Ranger's own store, runs the deterministic reconciler, and commits the whole
// plan in one guarded transaction. The same code runs in Electron and the PWA; only the store
// implementation (IPC to the shared backend) differs, and tests can supply their own.

import type {
  AgentCommitResult,
  AgentItemInput,
  AgentQuarantineInput,
  AgentReconciliationCommit,
  AgentWorkspaceDesktopApi,
} from "../shared/agent-workspace-api.ts";
import { reconcileWorkspace, validateLedger, type LedgerEntry, type ReconcileLedger, type ReconcileResult, type Submission } from "./reconcile.ts";
import { AgentWorkspaceError } from "./strict-json.ts";
import type { CanonicalSnapshot, ExportReceipt } from "./types.ts";

export type AgentWorkspaceStore = AgentWorkspaceDesktopApi["agentWorkspace"];

const PAGE = 500;

/** Reads every ledger page and validates the result as a closed v2 ledger. */
export async function loadLedger(store: AgentWorkspaceStore): Promise<ReconcileLedger> {
  const operations: Record<string, unknown> = {};
  const batches: Record<string, unknown> = {};
  for (let cursor: string | null = null, first = true; first || cursor !== null; first = false) {
    const page = await store.ledgerOperations(cursor, PAGE);
    for (const row of page.rows) operations[row.operationId] = row.entry;
    cursor = page.nextCursor;
  }
  for (let cursor: string | null = null, first = true; first || cursor !== null; first = false) {
    const page = await store.ledgerBatches(cursor, PAGE);
    for (const row of page.rows) batches[row.batchId] = { sha256: row.sha256, actor_claim: row.actorClaim };
    cursor = page.nextCursor;
  }
  try {
    return validateLedger({ format: "jr-agent-reconcile-ledger", schema_version: 2, operations, batches });
  } catch (error) {
    // A damaged trust anchor stops the sync; it is never repaired or replaced silently.
    if (error instanceof AgentWorkspaceError) throw new AgentWorkspaceError("ledger_corrupt", `The local agent ledger failed validation: ${error.message} Restore a backup before syncing again.`);
    throw error;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Display-safe location: no separator characters the store reserves, bounded length. */
export function safeLocation(location: string): string {
  const cleaned = location.replace(/\|/g, "%7C").replace(/[\u0000-\u001f]/g, "");
  return (cleaned.startsWith("workspace/") ? cleaned : `workspace/(outside)/${cleaned}`).slice(0, 400);
}

// Batch IDs in summaries come from agent files; anything outside the format is dropped so one
// odd file name can never make the whole commit invalid.
const safeBatchId = (id: string | null) => (id !== null && /^batch_[A-Za-z0-9_-]{1,122}$/.test(id) ? id : null);

const sameEntry = (a: LedgerEntry | undefined, b: LedgerEntry) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** Turns a reconciliation result into the store's atomic commit. */
export function planCommit(result: ReconcileResult, before: ReconcileLedger, expectedRevision: number, startedAt: string): AgentReconciliationCommit {
  const items: AgentItemInput[] = [];
  const item = (r: Record<string, unknown>, outcome: string, flags: string[], contest: string[]): AgentItemInput => {
    const operation = r.operation as Record<string, unknown> | undefined;
    const op = operation ?? {
      operation_id: r.operation_id, record_id: r.record_id, base_revision: r.base_revision ?? null,
      previous_operation_id: r.previous_operation_id, authored_at: r.authored_at, kind: r.kind, payload: r.payload,
    };
    return {
      operationId: op.operation_id as string,
      contentSha256: (r.content_sha256 as string),
      recordId: op.record_id as string,
      kind: op.kind as string,
      batchId: r.batch_id as string,
      actorClaim: r.actor_claim as string,
      sourceExportId: r.source_export_id as string,
      authoredAt: op.authored_at as string,
      location: safeLocation((r.location as string | undefined) ?? `workspace/agents/${r.actor_claim}/batches/${r.batch_id}.json`),
      outcome,
      flags,
      contest,
      operation: op,
    };
  };
  for (const d of result.drafts) items.push(item(d, "imported_draft", [], []));
  for (const s of result.staged) items.push(item(s, s.outcome as string, s.flags as string[], s.contest as string[]));
  for (const c of result.contested) items.push(item(c as unknown as Record<string, unknown>, "contested", ["operation_id_conflict"], c.reasons));

  const quarantine: AgentQuarantineInput[] = result.quarantine.map((q) => ({
    kind: q.kind,
    location: safeLocation(q.location),
    batchId: safeBatchId(q.batch_id),
    operationId: q.operation_id ?? null,
    sha256: q.sha256,
    reasons: q.reasons,
    bytesBase64: q.bytes ? base64(q.bytes) : null,
    byteLength: q.bytes ? q.bytes.length : null,
    operation: q.operation ? (q.operation as unknown as Record<string, unknown>) : null,
  }));

  const ledgerOperations = Object.entries(result.ledger.operations)
    .filter(([id, entry]) => !sameEntry(before.operations[id], entry))
    .map(([operationId, entry]) => ({ operationId, entry: entry as unknown as Record<string, unknown> }));
  const ledgerBatches = Object.entries(result.ledger.batches)
    .filter(([id]) => !Object.prototype.hasOwnProperty.call(before.batches, id))
    .map(([batchId, b]) => ({ batchId, sha256: b.sha256, actorClaim: b.actor_claim }));

  return {
    expectedRevision,
    startedAt,
    ledgerOperations,
    ledgerBatches,
    items,
    downgrades: result.downgrades.map((d) => ({ operationId: d.operation_id, contest: d.contest })),
    quarantine,
    acceptedBatchShas: result.report.batches.filter((b) => b.status === "accepted").map((b) => b.sha256),
    counts: result.report.counts,
    batches: result.report.batches.map((b) => ({ location: safeLocation(b.location), batchId: safeBatchId(b.batch_id), status: b.status, reasons: b.reasons })),
  };
}

export interface SyncInput {
  store: AgentWorkspaceStore;
  canonical: CanonicalSnapshot;
  submissions: Submission[];
  now?: () => string;
}

export interface SyncOutcome {
  result: ReconcileResult;
  commit: AgentCommitResult;
  attempts: number;
}

/**
 * One local sync. A concurrent commit (another window or tab) makes this attempt fail
 * cleanly; it is retried once from freshly loaded state, never merged blindly.
 */
export async function syncAgentWorkspace({ store, canonical, submissions, now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }: SyncInput): Promise<SyncOutcome> {
  for (let attempt = 1; ; attempt += 1) {
    const startedAt = now();
    const state = await store.getState();
    const receipts = (await store.listReceipts()).map((r) => r.receipt as unknown as ExportReceipt);
    const ledger = await loadLedger(store);
    const result = await reconcileWorkspace({
      workspaceId: state.workspaceId,
      receipts,
      canonical,
      policy: state.policy,
      ledger,
      submissions,
    });
    try {
      const commit = await store.commitReconciliation(planCommit(result, ledger, state.ledgerRevision, startedAt));
      return { result, commit, attempts: attempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && /concurrent_update/.test(message)) continue;
      throw error;
    }
  }
}
