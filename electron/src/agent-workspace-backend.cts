import { randomUUID } from "node:crypto";
import type {
  AgentCommitResult,
  AgentDecisionAction,
  AgentDecisionInput,
  AgentDecisionRecord,
  AgentItemDetail,
  AgentItemFilter,
  AgentItemInput,
  AgentItemState,
  AgentItemSummary,
  AgentLedgerBatchRow,
  AgentLedgerOperationRow,
  AgentPage,
  AgentQuarantineDetail,
  AgentQuarantineInput,
  AgentQuarantineSummary,
  AgentReceiptRecord,
  AgentReconciliationCommit,
  AgentRunSummary,
  AgentWorkspacePolicy,
  AgentWorkspaceStateDto,
} from "../../src/shared/agent-workspace-api.js";
import { FEATURE_MIGRATIONS } from "./feature-migrations.cjs";
import { sql, SqliteClient } from "./sqlite.cjs";
import {
  AGENT_OWNED_KINDS,
  CONSEQUENTIAL_KINDS,
  validateAgentDecision,
  validateAgentPolicy,
  validateAgentReceipt,
  validateItemFilter,
  validateLedgerCursor,
  validateQuarantineKey,
  validateReconciliationCommit,
  validateSha256,
  validateOperationId,
} from "./agent-workspace-validators.cjs";

// Locally trusted agent-workspace state (#286 G3), in the same SQLite database as the rest
// of Job Ranger in both runtimes. Every reconciliation is committed in one transaction,
// guarded by the ledger revision it was computed from, so a failed or concurrent commit
// leaves nothing half-imported. Nothing here writes outside the local database, and no
// method changes canonical career data.

const MIGRATION = FEATURE_MIGRATIONS.agentWorkspace;

export const AGENT_WORKSPACE_LIMITS = {
  /** Original bytes kept per quarantined batch; larger batches keep digest and size only. */
  maxQuarantineBytesPerItem: 512 * 1024,
  /** Total quarantined bytes kept; beyond it new entries keep digest and size only. */
  maxQuarantineBytesTotal: 64 * 1024 * 1024,
  maxPageSize: 500,
} as const;

export const AGENT_WORKSPACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_workspace_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  workspace_id TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  ledger_revision INTEGER NOT NULL DEFAULT 0 CHECK (ledger_revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Any row inserted here fails its CHECK; used to abort a stale commit inside its transaction.
CREATE TABLE IF NOT EXISTS agent_workspace_guard (
  stale INTEGER NOT NULL CHECK (stale = 0)
);
CREATE TABLE IF NOT EXISTS agent_workspace_receipts (
  export_id TEXT PRIMARY KEY,
  receipt_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_workspace_ledger_operations (
  operation_id TEXT PRIMARY KEY,
  entry_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_workspace_ledger_batches (
  batch_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  actor_claim TEXT
);
CREATE TABLE IF NOT EXISTS agent_workspace_items (
  operation_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  actor_claim TEXT NOT NULL,
  source_export_id TEXT NOT NULL,
  authored_at TEXT NOT NULL,
  location TEXT NOT NULL,
  outcome TEXT NOT NULL,
  state TEXT NOT NULL,
  previous_state TEXT,
  flags_json TEXT NOT NULL,
  contest_json TEXT NOT NULL,
  title TEXT NOT NULL,
  operation_json TEXT NOT NULL,
  first_seen_run INTEGER NOT NULL,
  last_seen_run INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (operation_id, content_sha256)
);
CREATE INDEX IF NOT EXISTS agent_workspace_items_state ON agent_workspace_items (state, operation_id);
CREATE TABLE IF NOT EXISTS agent_workspace_quarantine (
  quarantine_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('batch', 'operation')),
  location TEXT NOT NULL,
  batch_id TEXT,
  operation_id TEXT,
  sha256 TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  bytes_base64 TEXT,
  byte_length INTEGER,
  operation_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  first_seen_run INTEGER NOT NULL,
  last_seen_run INTEGER NOT NULL,
  resolved_run INTEGER
);
CREATE TABLE IF NOT EXISTS agent_workspace_runs (
  run_id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  batches_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_workspace_decisions (
  decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  action TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  note TEXT,
  detail_json TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
`;

const DECISION_STATES = new Set<AgentItemState>(["kept", "dismissed", "rejected_by_user", "applied"]);
const OUTCOME_STATE: Record<string, AgentItemState> = {
  imported_draft: "draft",
  staged_draft: "staged",
  staged_for_review: "proposal",
  needs_rebase: "needs_rebase",
  pending_predecessor: "pending",
  contested: "contested",
};
const CLAIM_STATUS: Record<string, string> = { drafted: "interested", submitted: "applied", interviewing: "interview", offered: "offer", rejected: "rejected", withdrawn: "withdrawn" };

type ItemRow = {
  operation_id: string;
  content_sha256: string;
  record_id: string;
  kind: string;
  batch_id: string;
  actor_claim: string;
  source_export_id: string;
  authored_at: string;
  location: string;
  outcome: string;
  state: AgentItemState;
  previous_state: AgentItemState | null;
  flags_json: string;
  contest_json: string;
  title: string;
  operation_json?: string;
  first_seen_run: number;
  last_seen_run: number;
  updated_at: string;
};

type QuarantineRow = {
  quarantine_key: string;
  kind: "batch" | "operation";
  location: string;
  batch_id: string | null;
  operation_id: string | null;
  sha256: string;
  reasons_json: string;
  bytes_base64?: string | null;
  bytes_retained: number;
  byte_length: number | null;
  operation_json?: string | null;
  status: "open" | "resolved";
  first_seen_run: number;
  last_seen_run: number;
  resolved_run: number | null;
};

export class AgentWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentWorkspaceError";
    this.code = code;
  }
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AgentWorkspaceError("storage_corrupt", `Stored ${label} is not valid JSON.`);
  }
}

const sortedUnique = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function titleOf(item: AgentItemInput): string {
  const payload = (item.operation.payload ?? {}) as Record<string, unknown>;
  const candidate = payload.title ?? payload.label ?? payload.change_reason ?? payload.reported_context ?? item.recordId;
  const text = typeof candidate === "string" ? candidate : item.recordId;
  return text.replace(/\s+/g, " ").trim().slice(0, 160) || item.recordId;
}

function quarantineKey(entry: AgentQuarantineInput): string {
  return [entry.kind, entry.sha256, entry.location, entry.operationId ?? ""].join("|");
}

export class AgentWorkspaceBackend {
  private readonly sqlite: SqliteClient;

  constructor(options: { databasePath: string; sqliteBinaryPath: string }) {
    this.sqlite = new SqliteClient(options.databasePath, options.sqliteBinaryPath);
  }

  async initialize(): Promise<void> {
    await this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );
    const existing = await this.sqlite.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${MIGRATION.version} LIMIT 1;
    `);
    if (!existing) {
      const now = new Date().toISOString();
      // Schema, version record and workspace identity land together or not at all.
      await this.sqlite.transaction([
        AGENT_WORKSPACE_SCHEMA,
        sql`INSERT INTO schema_migrations (version, name, applied_at) VALUES (${MIGRATION.version}, ${MIGRATION.name}, ${now});`,
        sql`INSERT OR IGNORE INTO agent_workspace_state (id, workspace_id, policy_json, ledger_revision, created_at, updated_at)
            VALUES (1, ${`ws_${randomUUID().replace(/-/g, "")}`}, ${JSON.stringify({ autoImportKinds: [] })}, 0, ${now}, ${now});`,
      ]);
    }
  }

  private async stateRow(): Promise<{ workspace_id: string; policy_json: string; ledger_revision: number; updated_at: string }> {
    const row = await this.sqlite.queryOne<{ workspace_id: string; policy_json: string; ledger_revision: number; updated_at: string }>(
      "SELECT workspace_id, policy_json, ledger_revision, updated_at FROM agent_workspace_state WHERE id = 1;",
    );
    if (!row) throw new AgentWorkspaceError("storage_corrupt", "The local agent workspace identity is missing.");
    return row;
  }

  async getState(): Promise<AgentWorkspaceStateDto> {
    const state = await this.stateRow();
    const policy = validateAgentPolicy(parseJson(state.policy_json, "policy"));
    const counts = await this.sqlite.queryAll<{ state: AgentItemState; n: number }>(
      "SELECT state, COUNT(*) AS n FROM agent_workspace_items GROUP BY state;",
    );
    const quarantine = await this.sqlite.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM agent_workspace_quarantine WHERE status = 'open';");
    const receipts = await this.sqlite.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM agent_workspace_receipts;");
    const [lastRun] = await this.listRuns(1);
    return {
      workspaceId: state.workspace_id,
      policy,
      ledgerRevision: state.ledger_revision,
      lastRun: lastRun ?? null,
      itemCounts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
      openQuarantine: quarantine?.n ?? 0,
      receiptCount: receipts?.n ?? 0,
    };
  }

  async setPolicy(input: unknown): Promise<AgentWorkspaceStateDto> {
    const policy: AgentWorkspacePolicy = validateAgentPolicy(input);
    await this.sqlite.transaction([
      sql`UPDATE agent_workspace_state SET policy_json = ${JSON.stringify(policy)}, updated_at = ${new Date().toISOString()} WHERE id = 1;`,
    ]);
    return this.getState();
  }

  /** Stores the locally trusted receipt of an export Job Ranger itself created. */
  async recordExport(input: unknown): Promise<AgentReceiptRecord> {
    const state = await this.stateRow();
    const receipt = validateAgentReceipt(input, state.workspace_id);
    const exportId = receipt.export_id as string;
    const existing = await this.sqlite.queryOne<{ receipt_json: string }>(sql`SELECT receipt_json FROM agent_workspace_receipts WHERE export_id = ${exportId};`);
    if (existing && existing.receipt_json !== JSON.stringify(receipt)) {
      throw new AgentWorkspaceError("receipt_conflict", `Export ${exportId} already has a different receipt; export IDs are never reused.`);
    }
    const recordedAt = new Date().toISOString();
    if (!existing) {
      await this.sqlite.transaction([
        sql`INSERT INTO agent_workspace_receipts (export_id, receipt_json, manifest_sha256, created_at, recorded_at)
            VALUES (${exportId}, ${JSON.stringify(receipt)}, ${receipt.manifest_sha256 as string}, ${receipt.created_at as string}, ${recordedAt});`,
      ]);
    }
    const row = await this.sqlite.queryOne<{ recorded_at: string }>(sql`SELECT recorded_at FROM agent_workspace_receipts WHERE export_id = ${exportId};`);
    return { exportId, receipt, recordedAt: row?.recorded_at ?? recordedAt };
  }

  async listReceipts(): Promise<AgentReceiptRecord[]> {
    const rows = await this.sqlite.queryAll<{ export_id: string; receipt_json: string; recorded_at: string }>(
      "SELECT export_id, receipt_json, recorded_at FROM agent_workspace_receipts ORDER BY created_at, export_id;",
    );
    return rows.map((r) => ({ exportId: r.export_id, receipt: parseJson(r.receipt_json, "receipt"), recordedAt: r.recorded_at }));
  }

  async ledgerOperations(cursorInput: unknown, limitInput: unknown): Promise<AgentPage<AgentLedgerOperationRow>> {
    const { cursor, limit } = validateLedgerCursor(cursorInput, limitInput, AGENT_WORKSPACE_LIMITS.maxPageSize);
    const rows = await this.sqlite.queryAll<{ operation_id: string; entry_json: string }>(sql`
      SELECT operation_id, entry_json FROM agent_workspace_ledger_operations
      WHERE operation_id > ${cursor ?? ""} ORDER BY operation_id LIMIT ${limit + 1};
    `);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({ operationId: r.operation_id, entry: parseJson(r.entry_json, `ledger entry ${r.operation_id}`) })),
      nextCursor: rows.length > limit ? page[page.length - 1].operation_id : null,
    };
  }

  async ledgerBatches(cursorInput: unknown, limitInput: unknown): Promise<AgentPage<AgentLedgerBatchRow>> {
    const { cursor, limit } = validateLedgerCursor(cursorInput, limitInput, AGENT_WORKSPACE_LIMITS.maxPageSize);
    const rows = await this.sqlite.queryAll<{ batch_id: string; sha256: string; actor_claim: string | null }>(sql`
      SELECT batch_id, sha256, actor_claim FROM agent_workspace_ledger_batches
      WHERE batch_id > ${cursor ?? ""} ORDER BY batch_id LIMIT ${limit + 1};
    `);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({ batchId: r.batch_id, sha256: r.sha256, actorClaim: r.actor_claim })),
      nextCursor: rows.length > limit ? page[page.length - 1].batch_id : null,
    };
  }

  private async existingItems(operationIds: string[]): Promise<Map<string, ItemRow[]>> {
    const byOperation = new Map<string, ItemRow[]>();
    for (let i = 0; i < operationIds.length; i += 200) {
      const chunk = operationIds.slice(i, i + 200);
      const list = chunk.map((id) => sql`${id}`).join(", ");
      const rows = await this.sqlite.queryAll<ItemRow>(`
        SELECT operation_id, content_sha256, state, previous_state, contest_json, first_seen_run
        FROM agent_workspace_items WHERE operation_id IN (${list});
      `);
      for (const row of rows) byOperation.set(row.operation_id, [...(byOperation.get(row.operation_id) ?? []), row]);
    }
    return byOperation;
  }

  /**
   * Applies one reconciliation plan atomically. Reconciliation never overrides a user's
   * decision, contest reasons only grow, and quarantined bytes respect the size limits.
   */
  async commitReconciliation(input: unknown): Promise<AgentCommitResult> {
    const commit: AgentReconciliationCommit = validateReconciliationCommit(input);
    const state = await this.stateRow();
    if (state.ledger_revision !== commit.expectedRevision) {
      throw new AgentWorkspaceError("concurrent_update", "The local agent workspace changed while this sync was running; run it again.");
    }
    const runId = commit.expectedRevision + 1;
    const now = new Date().toISOString();
    const statements: string[] = [
      // Abort the whole transaction if another commit landed after the check above.
      sql`INSERT INTO agent_workspace_guard (stale) SELECT 1 WHERE (SELECT ledger_revision FROM agent_workspace_state WHERE id = 1) <> ${commit.expectedRevision};`,
      sql`UPDATE agent_workspace_state SET ledger_revision = ${runId}, updated_at = ${now} WHERE id = 1;`,
    ];
    for (const op of commit.ledgerOperations) {
      statements.push(sql`INSERT INTO agent_workspace_ledger_operations (operation_id, entry_json) VALUES (${op.operationId}, ${JSON.stringify(op.entry)})
        ON CONFLICT (operation_id) DO UPDATE SET entry_json = excluded.entry_json;`);
    }
    for (const b of commit.ledgerBatches) {
      statements.push(sql`INSERT INTO agent_workspace_ledger_batches (batch_id, sha256, actor_claim) VALUES (${b.batchId}, ${b.sha256}, ${b.actorClaim})
        ON CONFLICT (batch_id) DO NOTHING;`);
    }

    const touched = sortedUnique([...commit.items.map((i) => i.operationId), ...commit.downgrades.map((d) => d.operationId)]);
    const existing = await this.existingItems(touched);
    const contestOf = (row: ItemRow) => parseJson<string[]>(row.contest_json, "contest");
    for (const item of commit.items) {
      const prior = existing.get(item.operationId)?.find((r) => r.content_sha256 === item.contentSha256);
      const outcomeState = OUTCOME_STATE[item.outcome];
      const contest = sortedUnique([...item.contest, ...(prior ? contestOf(prior) : [])]);
      let nextState: AgentItemState = contest.length && outcomeState === "draft" ? "contested" : outcomeState;
      let previousState: AgentItemState | null = prior?.previous_state ?? null;
      if (prior && DECISION_STATES.has(prior.state)) nextState = prior.state;
      // A version that was contested stays contested until the user decides.
      else if (prior && prior.state === "contested") nextState = "contested";
      if (prior && prior.state !== nextState) previousState = prior.state;
      statements.push(sql`INSERT INTO agent_workspace_items (
          operation_id, content_sha256, record_id, kind, batch_id, actor_claim, source_export_id, authored_at, location,
          outcome, state, previous_state, flags_json, contest_json, title, operation_json, first_seen_run, last_seen_run, updated_at)
        VALUES (${item.operationId}, ${item.contentSha256}, ${item.recordId}, ${item.kind}, ${item.batchId}, ${item.actorClaim},
          ${item.sourceExportId}, ${item.authoredAt}, ${item.location}, ${item.outcome}, ${nextState}, ${previousState},
          ${JSON.stringify(sortedUnique(item.flags))}, ${JSON.stringify(contest)}, ${titleOf(item)}, ${JSON.stringify(item.operation)},
          ${prior?.first_seen_run ?? runId}, ${runId}, ${now})
        ON CONFLICT (operation_id, content_sha256) DO UPDATE SET
          outcome = excluded.outcome, state = excluded.state, previous_state = excluded.previous_state,
          flags_json = excluded.flags_json, contest_json = excluded.contest_json, last_seen_run = excluded.last_seen_run,
          updated_at = excluded.updated_at;`);
    }
    // #289: a late conflict downgrades every stored version of the operation.
    for (const downgrade of commit.downgrades) {
      for (const row of existing.get(downgrade.operationId) ?? []) {
        if (commit.items.some((i) => i.operationId === row.operation_id && i.contentSha256 === row.content_sha256)) continue;
        const contest = sortedUnique([...contestOf(row), ...downgrade.contest]);
        const nextState: AgentItemState = DECISION_STATES.has(row.state) ? row.state : row.state === "draft" || row.state === "staged" ? "contested" : row.state;
        statements.push(sql`UPDATE agent_workspace_items SET contest_json = ${JSON.stringify(contest)}, state = ${nextState},
            previous_state = ${nextState === row.state ? row.previous_state : row.state}, last_seen_run = ${runId}, updated_at = ${now}
          WHERE operation_id = ${row.operation_id} AND content_sha256 = ${row.content_sha256};`);
      }
    }

    const keys = commit.quarantine.map(quarantineKey);
    const priorQuarantine = new Set<string>();
    for (let i = 0; i < keys.length; i += 200) {
      const list = keys.slice(i, i + 200).map((k) => sql`${k}`).join(", ");
      const rows = await this.sqlite.queryAll<{ quarantine_key: string }>(`SELECT quarantine_key FROM agent_workspace_quarantine WHERE quarantine_key IN (${list});`);
      rows.forEach((r) => priorQuarantine.add(r.quarantine_key));
    }
    const stored = await this.sqlite.queryOne<{ total: number | null }>("SELECT SUM(LENGTH(bytes_base64)) AS total FROM agent_workspace_quarantine;");
    let budget = AGENT_WORKSPACE_LIMITS.maxQuarantineBytesTotal - (stored?.total ?? 0);
    let dropped = 0;
    commit.quarantine.forEach((entry, index) => {
      const key = keys[index];
      if (priorQuarantine.has(key)) {
        statements.push(sql`UPDATE agent_workspace_quarantine SET last_seen_run = ${runId}, status = 'open', resolved_run = NULL WHERE quarantine_key = ${key};`);
        return;
      }
      let bytes = entry.bytesBase64;
      if (bytes !== null && (bytes.length > Math.ceil(AGENT_WORKSPACE_LIMITS.maxQuarantineBytesPerItem / 3) * 4 || bytes.length > budget)) {
        bytes = null;
        dropped += 1;
      }
      if (bytes !== null) budget -= bytes.length;
      statements.push(sql`INSERT INTO agent_workspace_quarantine (
          quarantine_key, kind, location, batch_id, operation_id, sha256, reasons_json, bytes_base64, byte_length, operation_json,
          status, first_seen_run, last_seen_run, resolved_run)
        VALUES (${key}, ${entry.kind}, ${entry.location}, ${entry.batchId}, ${entry.operationId}, ${entry.sha256},
          ${JSON.stringify(sortedUnique(entry.reasons))}, ${bytes}, ${entry.byteLength}, ${entry.operation === null ? null : JSON.stringify(entry.operation)},
          'open', ${runId}, ${runId}, NULL);`);
    });
    for (const sha of sortedUnique(commit.acceptedBatchShas)) {
      statements.push(sql`UPDATE agent_workspace_quarantine SET status = 'resolved', resolved_run = ${runId}
        WHERE kind = 'batch' AND sha256 = ${sha} AND status = 'open';`);
    }
    statements.push(sql`INSERT INTO agent_workspace_runs (run_id, started_at, completed_at, counts_json, batches_json)
      VALUES (${runId}, ${commit.startedAt}, ${now}, ${JSON.stringify(commit.counts)}, ${JSON.stringify(commit.batches)});`);

    try {
      await this.sqlite.transaction(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CHECK constraint failed: (agent_workspace_guard.)?stale = 0|CHECK constraint failed: agent_workspace_guard/i.test(message)) {
        throw new AgentWorkspaceError("concurrent_update", "The local agent workspace changed while this sync was running; run it again.");
      }
      throw error;
    }
    return { runId, ledgerRevision: runId, completedAt: now, quarantineBytesDropped: dropped };
  }

  private mapItem(row: ItemRow): AgentItemSummary {
    const contest = parseJson<string[]>(row.contest_json, "contest");
    return {
      operationId: row.operation_id,
      contentSha256: row.content_sha256,
      recordId: row.record_id,
      kind: row.kind,
      batchId: row.batch_id,
      actorClaim: row.actor_claim,
      sourceExportId: row.source_export_id,
      authoredAt: row.authored_at,
      location: row.location,
      outcome: row.outcome,
      state: row.state,
      previousState: row.previous_state,
      flags: parseJson<string[]>(row.flags_json, "flags"),
      contest,
      title: row.title,
      firstSeenRun: row.first_seen_run,
      lastSeenRun: row.last_seen_run,
      updatedAt: row.updated_at,
      eligible: row.state === "kept" || (row.state === "draft" && contest.length === 0),
    };
  }

  async listItems(input: unknown): Promise<AgentPage<AgentItemSummary>> {
    const filter: Required<AgentItemFilter> = validateItemFilter(input, AGENT_WORKSPACE_LIMITS.maxPageSize);
    const states = filter.states.length ? `AND state IN (${filter.states.map((s) => sql`${s}`).join(", ")})` : "";
    const cursor = filter.cursor ?? "";
    const rows = await this.sqlite.queryAll<ItemRow>(`
      SELECT operation_id, content_sha256, record_id, kind, batch_id, actor_claim, source_export_id, authored_at, location,
        outcome, state, previous_state, flags_json, contest_json, title, first_seen_run, last_seen_run, updated_at
      FROM agent_workspace_items
      WHERE (operation_id || '|' || content_sha256) > ${sql`${cursor}`} ${states}
      ORDER BY operation_id, content_sha256 LIMIT ${filter.limit + 1};
    `);
    const page = rows.slice(0, filter.limit);
    const last = page[page.length - 1];
    return { rows: page.map((r) => this.mapItem(r)), nextCursor: rows.length > filter.limit && last ? `${last.operation_id}|${last.content_sha256}` : null };
  }

  async getItem(operationIdInput: unknown, shaInput: unknown): Promise<AgentItemDetail | null> {
    const operationId = validateOperationId(operationIdInput);
    const contentSha256 = validateSha256(shaInput, "Content hash");
    const row = await this.sqlite.queryOne<ItemRow>(sql`
      SELECT * FROM agent_workspace_items WHERE operation_id = ${operationId} AND content_sha256 = ${contentSha256};
    `);
    if (!row) return null;
    const variants = await this.sqlite.queryAll<{ content_sha256: string; batch_id: string; actor_claim: string; state: AgentItemState }>(sql`
      SELECT content_sha256, batch_id, actor_claim, state FROM agent_workspace_items
      WHERE operation_id = ${operationId} AND content_sha256 <> ${contentSha256} ORDER BY content_sha256;
    `);
    const decisions = await this.sqlite.queryAll<{ decision_id: number; operation_id: string; content_sha256: string; action: AgentDecisionAction; from_state: AgentItemState; to_state: AgentItemState; note: string | null; decided_at: string }>(sql`
      SELECT decision_id, operation_id, content_sha256, action, from_state, to_state, note, decided_at
      FROM agent_workspace_decisions WHERE operation_id = ${operationId} ORDER BY decision_id;
    `);
    return {
      ...this.mapItem(row),
      operation: parseJson(row.operation_json as string, `operation ${operationId}`),
      variants: variants.map((v) => ({ contentSha256: v.content_sha256, batchId: v.batch_id, actorClaim: v.actor_claim, state: v.state })),
      decisions: decisions.map((d): AgentDecisionRecord => ({
        decisionId: d.decision_id, operationId: d.operation_id, contentSha256: d.content_sha256, action: d.action,
        fromState: d.from_state, toState: d.to_state, note: d.note, decidedAt: d.decided_at,
      })),
    };
  }

  private mapQuarantine(row: QuarantineRow): AgentQuarantineSummary {
    return {
      quarantineKey: row.quarantine_key,
      kind: row.kind,
      location: row.location,
      batchId: row.batch_id,
      operationId: row.operation_id,
      sha256: row.sha256,
      reasons: parseJson<string[]>(row.reasons_json, "reasons"),
      byteLength: row.byte_length,
      bytesRetained: row.bytes_retained === 1,
      status: row.status,
      firstSeenRun: row.first_seen_run,
      lastSeenRun: row.last_seen_run,
      resolvedRun: row.resolved_run,
    };
  }

  async listQuarantine(): Promise<AgentQuarantineSummary[]> {
    const rows = await this.sqlite.queryAll<QuarantineRow>(`
      SELECT quarantine_key, kind, location, batch_id, operation_id, sha256, reasons_json, byte_length,
        CASE WHEN bytes_base64 IS NULL THEN 0 ELSE 1 END AS bytes_retained, status, first_seen_run, last_seen_run, resolved_run
      FROM agent_workspace_quarantine ORDER BY status, last_seen_run DESC, quarantine_key;
    `);
    return rows.map((r) => this.mapQuarantine(r));
  }

  async getQuarantine(keyInput: unknown): Promise<AgentQuarantineDetail | null> {
    const key = validateQuarantineKey(keyInput);
    const row = await this.sqlite.queryOne<QuarantineRow>(sql`
      SELECT *, CASE WHEN bytes_base64 IS NULL THEN 0 ELSE 1 END AS bytes_retained FROM agent_workspace_quarantine WHERE quarantine_key = ${key};
    `);
    if (!row) return null;
    return {
      ...this.mapQuarantine(row),
      bytesBase64: row.bytes_base64 ?? null,
      operation: row.operation_json ? parseJson(row.operation_json, "quarantined operation") : null,
    };
  }

  async listRuns(limitInput: unknown): Promise<AgentRunSummary[]> {
    const limit = Number.isInteger(limitInput) && (limitInput as number) > 0 && (limitInput as number) <= 100 ? (limitInput as number) : 20;
    const rows = await this.sqlite.queryAll<{ run_id: number; started_at: string; completed_at: string; counts_json: string; batches_json: string }>(sql`
      SELECT run_id, started_at, completed_at, counts_json, batches_json FROM agent_workspace_runs ORDER BY run_id DESC LIMIT ${limit};
    `);
    return rows.map((r) => ({ runId: r.run_id, startedAt: r.started_at, completedAt: r.completed_at, counts: parseJson(r.counts_json, "run counts"), batches: parseJson(r.batches_json, "run batches") }));
  }

  /**
   * Records a user's decision about one stored version. A decision never approves a fact:
   * keeping a draft keeps agent-owned work; status changes happen only through the existing
   * application workflow, which this method verifies afterwards.
   */
  async decide(input: unknown): Promise<AgentItemDetail> {
    const decision: AgentDecisionInput = validateAgentDecision(input);
    const item = await this.getItem(decision.operationId, decision.contentSha256);
    if (!item) throw new AgentWorkspaceError("not_found", "That agent item is not stored locally.");
    const consequential = (CONSEQUENTIAL_KINDS as readonly string[]).includes(item.kind);
    const agentOwned = (AGENT_OWNED_KINDS as readonly string[]).includes(item.kind);
    if (DECISION_STATES.has(item.state)) throw new AgentWorkspaceError("already_decided", `This item was already ${item.state.replace(/_/g, " ")}.`);
    let toState: AgentItemState;
    const detail: Record<string, unknown> = {};
    switch (decision.action) {
      case "keep_draft":
        if (!agentOwned) throw new AgentWorkspaceError("not_allowed", "Claims and proposals cannot be kept as drafts; review them instead.");
        if (item.state === "pending") throw new AgentWorkspaceError("not_allowed", "This draft is waiting for an earlier version that has not arrived intact.");
        if ((item.state === "contested" || item.contest.length) && decision.acknowledgeContest !== true) {
          throw new AgentWorkspaceError("contest_not_acknowledged", "Review every competing version before keeping one.");
        }
        toState = "kept";
        detail.contest = item.contest;
        break;
      case "dismiss":
        toState = "dismissed";
        break;
      case "reject_proposal":
        if (!consequential) throw new AgentWorkspaceError("not_allowed", "Only claims and proposals can be rejected; dismiss drafts instead.");
        toState = "rejected_by_user";
        break;
      case "record_status_applied": {
        if (item.kind !== "application_status_claim") throw new AgentWorkspaceError("not_allowed", "Only application status claims can record a status change.");
        if (item.contest.length || item.state === "contested") throw new AgentWorkspaceError("not_allowed", "A contested claim cannot be applied.");
        const payload = (item.operation.payload ?? {}) as Record<string, unknown>;
        const expected = CLAIM_STATUS[payload.claimed_status as string];
        if (decision.applicationId !== payload.application_id || decision.appliedStatus !== expected) {
          throw new AgentWorkspaceError("not_allowed", "The recorded change does not match this claim.");
        }
        // The status must already have been changed by the user through the existing workflow.
        const application = await this.sqlite.queryOne<{ status: string }>(sql`SELECT status FROM applications WHERE id = ${decision.applicationId};`);
        if (!application) throw new AgentWorkspaceError("not_found", "That application does not exist.");
        if (application.status !== expected) throw new AgentWorkspaceError("status_not_changed", "The application's status has not been changed; nothing was recorded.");
        toState = "applied";
        detail.applicationId = decision.applicationId;
        detail.appliedStatus = expected;
        break;
      }
      default:
        throw new AgentWorkspaceError("not_allowed", "Unsupported decision.");
    }
    const now = new Date().toISOString();
    await this.sqlite.transaction([
      sql`INSERT INTO agent_workspace_guard (stale) SELECT 1 WHERE (SELECT state FROM agent_workspace_items
          WHERE operation_id = ${item.operationId} AND content_sha256 = ${item.contentSha256}) <> ${item.state};`,
      sql`UPDATE agent_workspace_items SET state = ${toState}, previous_state = ${item.state}, updated_at = ${now}
          WHERE operation_id = ${item.operationId} AND content_sha256 = ${item.contentSha256};`,
      sql`INSERT INTO agent_workspace_decisions (operation_id, content_sha256, action, from_state, to_state, note, detail_json, decided_at)
          VALUES (${item.operationId}, ${item.contentSha256}, ${decision.action}, ${item.state}, ${toState}, ${decision.note ?? null}, ${JSON.stringify(detail)}, ${now});`,
    ]);
    return (await this.getItem(item.operationId, item.contentSha256)) as AgentItemDetail;
  }
}
