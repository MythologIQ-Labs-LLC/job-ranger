import type {
  AgentDecisionAction,
  AgentDecisionInput,
  AgentItemFilter,
  AgentItemInput,
  AgentItemState,
  AgentLedgerBatchRow,
  AgentLedgerOperationRow,
  AgentQuarantineInput,
  AgentReconciliationCommit,
  AgentWorkspacePolicy,
} from "../../src/shared/agent-workspace-api.js";

// IPC-boundary validation for the agent workspace store (#286 G3). The renderer computes
// reconciliation plans with the shared core; these checks keep the persisted shape closed
// and bounded so a malformed plan can never be stored, whatever produced it.

export const AGENT_OWNED_KINDS = ["workspace_note_version", "opportunity_annotation", "material_draft_version", "follow_up_plan"] as const;
export const CONSEQUENTIAL_KINDS = ["application_status_claim", "evidence_change_proposal"] as const;
const ALL_KINDS = new Set<string>([...AGENT_OWNED_KINDS, ...CONSEQUENTIAL_KINDS]);
const ITEM_OUTCOMES = new Set(["imported_draft", "staged_draft", "staged_for_review", "needs_rebase", "pending_predecessor", "contested"]);
const LEDGER_OUTCOMES = new Set(["imported_draft", "staged_draft", "staged_for_review", "needs_rebase", "contested"]);
const CONTEST = new Set(["ancestor_contested", "fork", "operation_id_conflict", "record_kind_conflict"]);
const STATES = new Set<AgentItemState>(["draft", "staged", "proposal", "needs_rebase", "pending", "contested", "kept", "dismissed", "rejected_by_user", "applied"]);
const ACTIONS = new Set<AgentDecisionAction>(["keep_draft", "dismiss", "reject_proposal", "record_status_applied"]);
const SCOPES = new Set(["tracks", "career_direction", "confirmed_evidence", "selected_opportunities", "selected_applications", "resume_templates", "selected_resumes", "selected_cover_letters"]);
const APPLICATION_STATUSES = new Set(["interested", "applied", "interview", "offer", "rejected", "withdrawn"]);
const OP_ID = /^op_[A-Za-z0-9_-]{4,125}$/;
const BATCH_ID = /^batch_[A-Za-z0-9_-]{2,121}$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const EXPORT_ID = /^ex_[A-Za-z0-9_-]{6,93}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const LOCATION = /^workspace\/[A-Za-z0-9._/:-]{1,400}$/;
const FLAG = /^[a-z][a-z0-9_]{1,63}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_OPERATION_JSON = 400_000;
const MAX_ITEMS = 20_000;

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function closed(value: Record<string, unknown>, required: string[], optional: string[], label: string): void {
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(`${label} has an unexpected field`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label} is missing ${key}`);
}

function text(value: unknown, label: string, pattern: RegExp | null, max: number): string {
  if (typeof value !== "string" || !value || value.length > max || (pattern && !pattern.test(value))) fail(`${label} is invalid`);
  return value as string;
}

function nullableText(value: unknown, label: string, pattern: RegExp, max: number): string | null {
  return value === null ? null : text(value, label, pattern, max);
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be a bounded list`);
  return value as unknown[];
}

function stringList(value: unknown, label: string, allowed: Set<string> | RegExp, max = 64): string[] {
  return list(value, label, max).map((v) => {
    if (typeof v !== "string" || (allowed instanceof Set ? !allowed.has(v) : !allowed.test(v))) fail(`${label} contains an invalid value`);
    return v as string;
  });
}

function boundedJson(value: unknown, label: string, max: number): Record<string, unknown> {
  const object = record(value, label);
  if (JSON.stringify(object).length > max) fail(`${label} is too large`);
  return object;
}

export const validateOperationId = (value: unknown) => text(value, "Operation id", OP_ID, 128);
export const validateSha256 = (value: unknown, label: string) => text(value, label, SHA256, 64);
export const validateQuarantineKey = (value: unknown) => text(value, "Quarantine key", /^(batch|operation)\|[a-f0-9]{64}\|[^|]{1,420}\|(op_[A-Za-z0-9_-]{4,125})?$/, 700);

export function validateAgentPolicy(value: unknown): AgentWorkspacePolicy {
  const policy = record(value, "Policy");
  closed(policy, ["autoImportKinds"], [], "Policy");
  const kinds = stringList(policy.autoImportKinds, "Automatic import kinds", new Set(AGENT_OWNED_KINDS), 4);
  if (new Set(kinds).size !== kinds.length) fail("Automatic import kinds must be unique");
  return { autoImportKinds: [...kinds].sort() };
}

/** Closed jr-agent-export-receipt v2 check; the receipt must belong to this workspace. */
export function validateAgentReceipt(value: unknown, workspaceId: string): Record<string, unknown> {
  const r = record(value, "Receipt");
  closed(r, ["format", "schema_version", "export_id", "workspace_id", "created_at", "job_ranger_build", "source_revision", "manifest_sha256", "manifest_bytes", "scopes", "files", "record_revisions"], [], "Receipt");
  if (r.format !== "jr-agent-export-receipt" || r.schema_version !== 2) fail("Receipt format or version is unsupported");
  text(r.export_id, "Receipt export id", EXPORT_ID, 96);
  if (r.workspace_id !== workspaceId) fail("Receipt belongs to another workspace");
  text(r.created_at, "Receipt timestamp", /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/, 32);
  text(r.job_ranger_build, "Receipt build", null, 120);
  text(r.source_revision, "Receipt source revision", null, 160);
  text(r.manifest_sha256, "Receipt manifest digest", SHA256, 64);
  if (!Number.isInteger(r.manifest_bytes) || (r.manifest_bytes as number) < 1 || (r.manifest_bytes as number) > 262_144) fail("Receipt manifest size is invalid");
  const scopes = stringList(r.scopes, "Receipt scopes", SCOPES, 8);
  if (!scopes.length || new Set(scopes).size !== scopes.length) fail("Receipt scopes are invalid");
  for (const f of list(r.files, "Receipt files", 100)) {
    const file = record(f, "Receipt file");
    closed(file, ["path", "sha256", "bytes"], [], "Receipt file");
    const path = text(file.path, "Receipt file path", /^(?:data|materials|schema)\/[A-Za-z0-9._/-]{1,236}$/, 240);
    if (path.includes("..")) fail("Receipt file path is invalid");
    text(file.sha256, "Receipt file digest", SHA256, 64);
    if (!Number.isInteger(file.bytes) || (file.bytes as number) < 1) fail("Receipt file size is invalid");
  }
  const revisions = record(r.record_revisions, "Receipt record revisions");
  if (Object.keys(revisions).length > 10_000) fail("Receipt has too many record revisions");
  for (const [id, rev] of Object.entries(revisions)) {
    text(id, "Receipt record id", RECORD_ID, 128);
    text(rev, "Receipt record revision", null, 160);
  }
  return r;
}

export function validateLedgerCursor(cursor: unknown, limit: unknown, maxPage: number): { cursor: string | null; limit: number } {
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 260)) fail("Cursor is invalid");
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > maxPage) fail("Page size is invalid");
  return { cursor: cursor as string | null, limit: limit as number };
}

export function validateItemFilter(value: unknown, maxPage: number): Required<AgentItemFilter> {
  const filter = record(value ?? {}, "Filter");
  closed(filter, [], ["states", "cursor", "limit"], "Filter");
  const states = filter.states === undefined ? [] : (stringList(filter.states, "States", STATES as Set<string>, 10) as AgentItemState[]);
  const cursor = filter.cursor === undefined || filter.cursor === null ? null : text(filter.cursor, "Cursor", /^op_[A-Za-z0-9_-]{4,125}\|[a-f0-9]{64}$/, 200);
  const limit = filter.limit === undefined ? 100 : (filter.limit as number);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxPage) fail("Page size is invalid");
  return { states, cursor, limit };
}

function validateLedgerEntry(value: unknown): Record<string, unknown> {
  const e = record(value, "Ledger entry");
  closed(e, ["content_sha256", "outcome", "batch_id", "record_id", "kind", "previous_operation_id", "contest", "variants"], [], "Ledger entry");
  text(e.content_sha256, "Ledger content hash", SHA256, 64);
  if (typeof e.outcome !== "string" || !LEDGER_OUTCOMES.has(e.outcome)) fail("Ledger outcome is invalid");
  text(e.batch_id, "Ledger batch id", BATCH_ID, 128);
  text(e.record_id, "Ledger record id", RECORD_ID, 128);
  if (typeof e.kind !== "string" || !ALL_KINDS.has(e.kind)) fail("Ledger kind is invalid");
  nullableText(e.previous_operation_id, "Ledger predecessor", OP_ID, 128);
  stringList(e.contest, "Ledger contest", CONTEST, 4);
  const variants = stringList(e.variants, "Ledger variants", SHA256, 10_000);
  if (!variants.includes(e.content_sha256 as string)) fail("Ledger variants must include the content hash");
  return e;
}

function validateItem(value: unknown): AgentItemInput {
  const i = record(value, "Item");
  closed(i, ["operationId", "contentSha256", "recordId", "kind", "batchId", "actorClaim", "sourceExportId", "authoredAt", "location", "outcome", "flags", "contest", "operation"], [], "Item");
  const operation = boundedJson(i.operation, "Item operation", MAX_OPERATION_JSON);
  if (operation.operation_id !== i.operationId || operation.kind !== i.kind || operation.record_id !== i.recordId) fail("Item operation does not match its identifiers");
  if (typeof i.kind !== "string" || !ALL_KINDS.has(i.kind)) fail("Item kind is invalid");
  if (typeof i.outcome !== "string" || !ITEM_OUTCOMES.has(i.outcome)) fail("Item outcome is invalid");
  // Consequential work is never stored as an imported draft.
  if (i.outcome === "imported_draft" && (CONSEQUENTIAL_KINDS as readonly string[]).includes(i.kind)) fail("Claims and proposals cannot be imported as drafts");
  return {
    operationId: validateOperationId(i.operationId),
    contentSha256: validateSha256(i.contentSha256, "Item content hash"),
    recordId: text(i.recordId, "Item record id", RECORD_ID, 128),
    kind: i.kind,
    batchId: text(i.batchId, "Item batch id", BATCH_ID, 128),
    actorClaim: text(i.actorClaim, "Item actor claim", ACTOR_ID, 128),
    sourceExportId: text(i.sourceExportId, "Item source export", EXPORT_ID, 96),
    authoredAt: text(i.authoredAt, "Item authored time", TIMESTAMP, 32),
    location: text(i.location, "Item location", LOCATION, 420),
    outcome: i.outcome,
    flags: stringList(i.flags, "Item flags", FLAG, 64),
    contest: stringList(i.contest, "Item contest", CONTEST, 4),
    operation,
  };
}

function validateQuarantine(value: unknown): AgentQuarantineInput {
  const q = record(value, "Quarantine entry");
  closed(q, ["kind", "location", "batchId", "operationId", "sha256", "reasons", "bytesBase64", "byteLength", "operation"], [], "Quarantine entry");
  if (q.kind !== "batch" && q.kind !== "operation") fail("Quarantine kind is invalid");
  const bytes = q.bytesBase64 === null ? null : text(q.bytesBase64, "Quarantined bytes", BASE64, 12 * 1024 * 1024);
  if (q.byteLength !== null && (!Number.isInteger(q.byteLength) || (q.byteLength as number) < 0)) fail("Quarantined size is invalid");
  if (q.location !== null && (typeof q.location !== "string" || q.location.length > 420 || q.location.includes("|"))) fail("Quarantine location is invalid");
  return {
    kind: q.kind,
    location: q.location as string,
    batchId: nullableText(q.batchId, "Quarantine batch id", BATCH_ID, 128),
    operationId: nullableText(q.operationId, "Quarantine operation id", OP_ID, 128),
    sha256: validateSha256(q.sha256, "Quarantine digest"),
    reasons: stringList(q.reasons, "Quarantine reasons", FLAG, 64),
    bytesBase64: bytes,
    byteLength: q.byteLength as number | null,
    operation: q.operation === null ? null : boundedJson(q.operation, "Quarantined operation", MAX_OPERATION_JSON),
  };
}

export function validateReconciliationCommit(value: unknown): AgentReconciliationCommit {
  const c = record(value, "Reconciliation");
  closed(c, ["expectedRevision", "startedAt", "ledgerOperations", "ledgerBatches", "items", "downgrades", "quarantine", "acceptedBatchShas", "counts", "batches"], [], "Reconciliation");
  if (!Number.isInteger(c.expectedRevision) || (c.expectedRevision as number) < 0) fail("Expected revision is invalid");
  const ledgerOperations = list(c.ledgerOperations, "Ledger operations", 1_000_000).map((v): AgentLedgerOperationRow => {
    const row = record(v, "Ledger operation");
    closed(row, ["operationId", "entry"], [], "Ledger operation");
    return { operationId: validateOperationId(row.operationId), entry: validateLedgerEntry(row.entry) };
  });
  const ledgerBatches = list(c.ledgerBatches, "Ledger batches", 1_000_000).map((v): AgentLedgerBatchRow => {
    const row = record(v, "Ledger batch");
    closed(row, ["batchId", "sha256", "actorClaim"], [], "Ledger batch");
    return { batchId: text(row.batchId, "Ledger batch id", BATCH_ID, 128), sha256: validateSha256(row.sha256, "Ledger batch digest"), actorClaim: nullableText(row.actorClaim, "Ledger batch actor", ACTOR_ID, 128) };
  });
  const downgrades = list(c.downgrades, "Downgrades", MAX_ITEMS).map((v) => {
    const row = record(v, "Downgrade");
    closed(row, ["operationId", "contest"], [], "Downgrade");
    return { operationId: validateOperationId(row.operationId), contest: stringList(row.contest, "Downgrade contest", CONTEST, 4) };
  });
  const counts = record(c.counts, "Counts");
  for (const [key, n] of Object.entries(counts)) if (!FLAG.test(key) || !Number.isInteger(n) || (n as number) < 0) fail("Counts are invalid");
  const batches = list(c.batches, "Batch summaries", 10_000).map((v) => {
    const b = record(v, "Batch summary");
    closed(b, ["location", "batchId", "status", "reasons"], [], "Batch summary");
    if (typeof b.location !== "string" || b.location.length > 420) fail("Batch summary location is invalid");
    return { location: b.location, batchId: nullableText(b.batchId, "Batch summary id", BATCH_ID, 128), status: text(b.status, "Batch status", /^(accepted|incomplete|rejected|duplicate)$/, 16), reasons: stringList(b.reasons, "Batch reasons", FLAG, 64) };
  });
  return {
    expectedRevision: c.expectedRevision as number,
    startedAt: text(c.startedAt, "Start time", TIMESTAMP, 32),
    ledgerOperations,
    ledgerBatches,
    items: list(c.items, "Items", MAX_ITEMS).map(validateItem),
    downgrades,
    quarantine: list(c.quarantine, "Quarantine", MAX_ITEMS).map(validateQuarantine),
    acceptedBatchShas: stringList(c.acceptedBatchShas, "Accepted batch digests", SHA256, 100_000),
    counts: counts as Record<string, number>,
    batches,
  };
}

export function validateAgentDecision(value: unknown): AgentDecisionInput {
  const d = record(value, "Decision");
  closed(d, ["operationId", "contentSha256", "action"], ["note", "acknowledgeContest", "applicationId", "appliedStatus"], "Decision");
  if (typeof d.action !== "string" || !ACTIONS.has(d.action as AgentDecisionAction)) fail("Decision action is invalid");
  if (d.note !== undefined && (typeof d.note !== "string" || d.note.length > 2000)) fail("Decision note is invalid");
  if (d.acknowledgeContest !== undefined && typeof d.acknowledgeContest !== "boolean") fail("Contest acknowledgement is invalid");
  if (d.applicationId !== undefined) text(d.applicationId, "Application id", /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, 128);
  if (d.appliedStatus !== undefined && (typeof d.appliedStatus !== "string" || !APPLICATION_STATUSES.has(d.appliedStatus))) fail("Applied status is invalid");
  return {
    operationId: validateOperationId(d.operationId),
    contentSha256: validateSha256(d.contentSha256, "Content hash"),
    action: d.action as AgentDecisionAction,
    note: d.note as string | undefined,
    acknowledgeContest: d.acknowledgeContest as boolean | undefined,
    applicationId: d.applicationId as string | undefined,
    appliedStatus: d.appliedStatus as string | undefined,
  };
}
