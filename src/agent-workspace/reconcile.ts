// Deterministic long-gap reconciliation of agent workspace batches (#286).
//
// Pure: takes discovered submission bytes, local export receipts, a read-only canonical
// snapshot, the user's standing policy and the previous ledger, and returns a plan. It
// never mutates canonical data; any later canonical change must go through existing
// services and their approval boundaries. Times are display-only; ordering comes from
// operation IDs, content hashes and declared causal predecessors.
//
// The ledger and receipts are local trust anchors. They must be stored with Job Ranger's
// local data, never in a folder an agent can write to; both are validated before use.
//
// Contested state (#289, D09) is durable: a ledger entry's contest reasons only accumulate,
// so an operation that loses eligibility never regains it through reconciliation. Listing
// order, timestamps and actor claims never choose between competing versions.

import { canonicalJsonBytes, sha256Hex } from "./canonical.ts";
import { classifyCitation, evidenceRevision } from "./revisions.ts";
import {
  AGENT_OWNED_KINDS,
  batchAttachmentRefs,
  CLAIM_STATUS_MAPPING,
  CONSEQUENTIAL_KINDS,
  parseCommitMarker,
  parseOperationBatch,
  WORKSPACE_ID_PATTERN,
  type AttachmentRef,
  type Operation,
  type OperationBatch,
  type OperationKind,
} from "./schema.ts";
import { AgentWorkspaceError, type Diagnostic } from "./strict-json.ts";
import type { CanonicalSnapshot, ExportReceipt } from "./types.ts";

export interface Submission {
  /** Workspace-relative discovery path: workspace/agents/<actor>/batches/<batch_id>.json */
  location: string;
  batchBytes: Uint8Array;
  /** Completion marker published after the batch and attachments; null when absent. */
  commitBytes: Uint8Array | null;
  attachments: Record<string, Uint8Array>;
}

export interface ReconcilePolicy {
  /** Agent-owned kinds the user has opted to import automatically into the draft namespace. */
  autoImportKinds: string[];
}

export type Outcome =
  | "imported_draft"
  | "staged_draft"
  | "staged_for_review"
  | "needs_rebase"
  | "contested"
  | "pending_predecessor"
  | "already_reconciled"
  | "rejected";

/**
 * Durable reasons an operation can no longer be used automatically (#289, D09). Reasons
 * only accumulate; reconciliation never removes one. Acting on a contested operation needs
 * a deliberate local user decision, recorded outside this ledger.
 */
export const CONTEST_REASONS = ["ancestor_contested", "fork", "operation_id_conflict", "record_kind_conflict"] as const;
export type ContestReason = (typeof CONTEST_REASONS)[number];

export interface LedgerEntry {
  content_sha256: string;
  outcome: Outcome;
  batch_id: string;
  record_id: string;
  kind: OperationKind;
  previous_operation_id: string | null;
  contest: ContestReason[];
  /** Every distinct content hash ever seen for this operation ID, sorted. */
  variants: string[];
}

export interface LedgerBatch {
  sha256: string;
  /** Claimed actor of the batch; null only for entries migrated from a v1 ledger. */
  actor_claim: string | null;
}

export interface ReconcileLedger {
  format: "jr-agent-reconcile-ledger";
  schema_version: 2;
  operations: Record<string, LedgerEntry>;
  batches: Record<string, LedgerBatch>;
}

export interface ReconcileInput {
  /** Trusted local workspace identity; every receipt and batch must carry it (D13). */
  workspaceId: string;
  receipts: ExportReceipt[];
  canonical: CanonicalSnapshot;
  policy: ReconcilePolicy;
  ledger: ReconcileLedger | null;
  submissions: Submission[];
}

const LOCATION = /^workspace\/agents\/([A-Za-z0-9][A-Za-z0-9._:-]{5,127})\/batches\/(batch_[A-Za-z0-9_-]{2,121})\.json$/;
const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORITATIVE = new Set(["user-confirmed", "user-authored"]);
const REBASE_FLAGS = new Set(["stale_evidence", "unknown_or_unconfirmed_evidence", "legacy_evidence_revision", "stale_base_revision"]);
// Outcomes a ledger may record. "pending_predecessor" and "rejected" are never ledgered.
const LEDGER_OUTCOMES = new Set<string>(["imported_draft", "staged_draft", "staged_for_review", "needs_rebase", "contested"]);
const V1_LEDGER_OUTCOMES = new Set<string>(["imported_draft", "staged_draft", "staged_for_review", "needs_rebase"]);
const CONTEST_SET = new Set<string>(CONTEST_REASONS);
const ALL_KINDS = new Set<string>([...AGENT_OWNED_KINDS, ...CONSEQUENTIAL_KINDS]);
const SCOPES = new Set(["tracks", "career_direction", "confirmed_evidence", "selected_opportunities", "selected_applications", "resume_templates", "selected_resumes", "selected_cover_letters"]);
const OP_ID = /^op_[A-Za-z0-9_-]{4,125}$/;
const BATCH_ID = /^batch_[A-Za-z0-9_-]{2,121}$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const isConsequential = (kind: string) => (CONSEQUENTIAL_KINDS as readonly string[]).includes(kind);

function sortedObject<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => byCodeUnit(a, b)));
}

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort(byCodeUnit);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function closedKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((k) => hasOwn(value, k));
}

function checkLedgerEntryCore(id: string, e: Record<string, unknown>, outcomes: Set<string>, fail: (message: string) => never): void {
  if (!OP_ID.test(id)) fail(`Ledger entry ${id.slice(0, 64)} has an invalid operation ID.`);
  if (typeof e.content_sha256 !== "string" || !SHA256.test(e.content_sha256)) fail(`Ledger entry ${id} has an invalid content hash.`);
  if (typeof e.outcome !== "string" || !outcomes.has(e.outcome)) fail(`Ledger entry ${id} has an invalid outcome.`);
  if (typeof e.kind !== "string" || !ALL_KINDS.has(e.kind)) fail(`Ledger entry ${id} has an invalid kind.`);
  if (typeof e.batch_id !== "string" || !BATCH_ID.test(e.batch_id) || typeof e.record_id !== "string" || !RECORD_ID.test(e.record_id)) fail(`Ledger entry ${id} has invalid identifiers.`);
  if (e.previous_operation_id !== null && (typeof e.previous_operation_id !== "string" || !OP_ID.test(e.previous_operation_id))) fail(`Ledger entry ${id} has an invalid predecessor.`);
}

/** The ledger is a local trust anchor; a malformed or forged one is refused, never repaired. */
export function validateLedger(value: unknown): ReconcileLedger {
  const fail = (message: string): never => { throw new AgentWorkspaceError("invalid_ledger", message); };
  if (!isRecord(value) || !closedKeys(value, ["format", "schema_version", "operations", "batches"])) fail("Ledger must be a closed jr-agent-reconcile-ledger object.");
  const ledger = value as Record<string, unknown>;
  if (ledger.format !== "jr-agent-reconcile-ledger") fail("Unsupported ledger format.");
  if (ledger.schema_version === 1) fail("This is a v1 ledger; migrate it explicitly with migrateLedgerV1 before use.");
  if (ledger.schema_version !== 2) fail("Unsupported ledger version.");
  if (!isRecord(ledger.operations) || !isRecord(ledger.batches)) fail("Ledger operations and batches must be objects.");
  for (const [id, entry] of Object.entries(ledger.operations as Record<string, unknown>)) {
    if (!isRecord(entry) || !closedKeys(entry, ["content_sha256", "outcome", "batch_id", "record_id", "kind", "previous_operation_id", "contest", "variants"])) fail(`Ledger entry ${id.slice(0, 64)} is malformed.`);
    const e = entry as Record<string, unknown>;
    checkLedgerEntryCore(id, e, LEDGER_OUTCOMES, fail);
    const { contest, variants } = e;
    if (!Array.isArray(contest) || contest.some((c) => typeof c !== "string" || !CONTEST_SET.has(c)) || !sameList(sortedUnique(contest as string[]), contest as string[])) fail(`Ledger entry ${id} has an invalid contest list.`);
    if (!Array.isArray(variants) || variants.length < 1 || variants.some((v) => typeof v !== "string" || !SHA256.test(v)) || !sameList(sortedUnique(variants as string[]), variants as string[])) fail(`Ledger entry ${id} has an invalid variant list.`);
    if (!(variants as string[]).includes(e.content_sha256 as string)) fail(`Ledger entry ${id} does not list its own content hash.`);
    // Disagreeing variants can only exist as a durable conflict.
    if ((variants as string[]).length > 1 && !(contest as string[]).includes("operation_id_conflict")) fail(`Ledger entry ${id} has variants without a recorded conflict.`);
    if (e.outcome === "contested" && !(contest as string[]).length) fail(`Ledger entry ${id} is contested without a reason.`);
  }
  for (const [id, batch] of Object.entries(ledger.batches as Record<string, unknown>)) {
    if (!BATCH_ID.test(id) || !isRecord(batch) || !closedKeys(batch, ["sha256", "actor_claim"])) fail(`Ledger batch ${id.slice(0, 64)} is malformed.`);
    const b = batch as Record<string, unknown>;
    if (typeof b.sha256 !== "string" || !SHA256.test(b.sha256)) fail(`Ledger batch ${id} has an invalid digest.`);
    if (b.actor_claim !== null && (typeof b.actor_claim !== "string" || !ACTOR_ID.test(b.actor_claim))) fail(`Ledger batch ${id} has an invalid actor claim.`);
  }
  return value as ReconcileLedger;
}

/**
 * Explicit, one-way migration of a G2 (v1) ledger. Entries keep their recorded outcome and
 * gain an empty contest list. Batch actors were never recorded in v1, so they migrate as
 * null and only prove a batch existed. Malformed input is refused, never repaired.
 */
export function migrateLedgerV1(value: unknown): ReconcileLedger {
  const fail = (message: string): never => { throw new AgentWorkspaceError("invalid_ledger", message); };
  if (!isRecord(value) || !closedKeys(value, ["format", "schema_version", "operations", "batches"])) fail("Ledger must be a closed jr-agent-reconcile-ledger object.");
  const v1 = value as Record<string, unknown>;
  if (v1.format !== "jr-agent-reconcile-ledger" || v1.schema_version !== 1) fail("Only a v1 ledger can be migrated.");
  if (!isRecord(v1.operations) || !isRecord(v1.batches)) fail("Ledger operations and batches must be objects.");
  const operations: [string, LedgerEntry][] = [];
  for (const [id, entry] of Object.entries(v1.operations as Record<string, unknown>)) {
    if (!isRecord(entry) || !closedKeys(entry, ["content_sha256", "outcome", "batch_id", "record_id", "kind", "previous_operation_id"])) fail(`Ledger entry ${id.slice(0, 64)} is malformed.`);
    const e = entry as Record<string, unknown>;
    checkLedgerEntryCore(id, e, V1_LEDGER_OUTCOMES, fail);
    operations.push([id, {
      content_sha256: e.content_sha256 as string, outcome: e.outcome as Outcome, batch_id: e.batch_id as string, record_id: e.record_id as string,
      kind: e.kind as OperationKind, previous_operation_id: e.previous_operation_id as string | null, contest: [], variants: [e.content_sha256 as string],
    }]);
  }
  const batches: [string, LedgerBatch][] = [];
  for (const [id, digest] of Object.entries(v1.batches as Record<string, unknown>)) {
    if (!BATCH_ID.test(id) || typeof digest !== "string" || !SHA256.test(digest)) fail(`Ledger batch ${id.slice(0, 64)} is malformed.`);
    batches.push([id, { sha256: digest as string, actor_claim: null }]);
  }
  return { format: "jr-agent-reconcile-ledger", schema_version: 2, operations: sortedObject(operations), batches: sortedObject(batches) };
}

export const emptyLedger = (): ReconcileLedger => ({ format: "jr-agent-reconcile-ledger", schema_version: 2, operations: {}, batches: {} });

/** Whether a ledgered operation is an eligible imported draft (no durable contest). */
export function operationEligibility(ledger: ReconcileLedger, operationId: string): { eligible: boolean; outcome: Outcome | null; contest: ContestReason[] } {
  const entry = hasOwn(ledger.operations, operationId) ? ledger.operations[operationId] : undefined;
  if (!entry) return { eligible: false, outcome: null, contest: [] };
  return { eligible: entry.outcome === "imported_draft" && entry.contest.length === 0, outcome: entry.outcome, contest: [...entry.contest] };
}

/** Closed check of a locally trusted receipt (jr-agent-export-receipt v2). */
export function validateReceipt(value: unknown, workspaceId?: string): ExportReceipt {
  const fail = (message: string): never => { throw new AgentWorkspaceError("invalid_receipt", message); };
  if (!isRecord(value) || !closedKeys(value, ["format", "schema_version", "export_id", "workspace_id", "created_at", "job_ranger_build", "source_revision", "manifest_sha256", "manifest_bytes", "scopes", "files", "record_revisions"])) fail("Receipt must be a closed jr-agent-export-receipt v2 object.");
  const r = value as Record<string, unknown>;
  if (r.format !== "jr-agent-export-receipt" || r.schema_version !== 2) fail("Unsupported receipt format or version.");
  if (typeof r.export_id !== "string" || !/^ex_[A-Za-z0-9_-]{6,93}$/.test(r.export_id)) fail("Receipt export ID is invalid.");
  if (typeof r.workspace_id !== "string" || !WORKSPACE_ID_PATTERN.test(r.workspace_id)) fail("Receipt workspace ID is invalid.");
  if (workspaceId !== undefined && r.workspace_id !== workspaceId) fail(`Receipt ${String(r.export_id)} belongs to another workspace.`);
  if (typeof r.created_at !== "string" || !TIMESTAMP.test(r.created_at)) fail("Receipt timestamp is invalid.");
  if (typeof r.job_ranger_build !== "string" || !r.job_ranger_build || r.job_ranger_build.length > 120) fail("Receipt build is invalid.");
  if (typeof r.source_revision !== "string" || !r.source_revision || r.source_revision.length > 160) fail("Receipt source revision is invalid.");
  if (typeof r.manifest_sha256 !== "string" || !SHA256.test(r.manifest_sha256)) fail(`Receipt ${String(r.export_id)} has an invalid manifest digest.`);
  if (!Number.isInteger(r.manifest_bytes) || (r.manifest_bytes as number) < 1 || (r.manifest_bytes as number) > 262_144) fail("Receipt manifest size is invalid.");
  if (!Array.isArray(r.scopes) || !r.scopes.length || r.scopes.some((s) => typeof s !== "string" || !SCOPES.has(s)) || new Set(r.scopes).size !== r.scopes.length) fail("Receipt scopes are invalid.");
  if (!Array.isArray(r.files) || !r.files.length || r.files.length > 100) fail("Receipt files are invalid.");
  for (const f of r.files as unknown[]) {
    if (!isRecord(f) || !closedKeys(f, ["path", "sha256", "bytes"]) || typeof f.path !== "string" || !/^(?:data|materials|schema)\/[A-Za-z0-9._/-]{1,236}$/.test(f.path) || f.path.includes("..") || typeof f.sha256 !== "string" || !SHA256.test(f.sha256) || !Number.isInteger(f.bytes) || (f.bytes as number) < 1) fail("Receipt file entry is invalid.");
  }
  if (!isRecord(r.record_revisions) || Object.keys(r.record_revisions).length > 10_000) fail("Receipt record revisions are invalid.");
  for (const [id, rev] of Object.entries(r.record_revisions as Record<string, unknown>)) {
    if (!RECORD_ID.test(id) || typeof rev !== "string" || !rev || rev.length > 160) fail("Receipt record revision entry is invalid.");
  }
  return value as ExportReceipt;
}

interface Occurrence {
  op: Operation;
  batch: OperationBatch;
  index: number;
  sha: string;
}

/** Minimal binary heap keyed by (authored_at, operation_id) for deterministic history order. */
class OrderedQueue<T extends { authored_at: string; operation_id: string }> {
  private items: T[] = [];
  private less(a: T, b: T): boolean {
    return byCodeUnit(a.authored_at, b.authored_at) < 0 || (a.authored_at === b.authored_at && byCodeUnit(a.operation_id, b.operation_id) < 0);
  }
  get size(): number { return this.items.length; }
  push(item: T): void {
    const items = this.items;
    items.push(item);
    for (let i = items.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  pop(): T {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as T;
    if (items.length) {
      items[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l], items[m])) m = l;
        if (r < items.length && this.less(items[r], items[m])) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top;
  }
}

const attachmentKey = (a: AttachmentRef) => `${a.path}\u0000${a.media_type}\u0000${a.bytes}\u0000${a.sha256}`;
const locationOf = (batch: OperationBatch) => `workspace/agents/${batch.actor_claim.actor_id}/batches/${batch.batch_id}.json`;

export async function reconcileWorkspace(input: ReconcileInput) {
  const { canonical, policy, submissions, workspaceId } = input;
  if (typeof workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceId)) throw new AgentWorkspaceError("invalid_workspace_id", "A trusted local workspace ID is required.");
  for (const kind of policy.autoImportKinds) {
    if (!(AGENT_OWNED_KINDS as readonly string[]).includes(kind)) {
      throw new AgentWorkspaceError("invalid_policy", `"${kind}" cannot be imported automatically; consequential kinds always need review.`);
    }
  }
  const ledger: ReconcileLedger = input.ledger === null ? emptyLedger() : validateLedger(input.ledger);
  const receipts = input.receipts.map((r) => validateReceipt(r, workspaceId));
  const receiptById = new Map(receipts.map((r) => [r.export_id, r]));
  const evidence = new Map<string, { token: string; updatedAt: string; authoritative: boolean }>();
  for (const { evidence: e } of canonical.evidence) {
    evidence.set(e.id, { token: await evidenceRevision(e), updatedAt: e.updatedAt, authoritative: AUTHORITATIVE.has(e.verificationState) });
  }
  const applications = new Map(canonical.applications.map((a) => [a.id, a.status as string]));
  const jobs = new Set(canonical.jobs.map((j) => j.id));
  const canonicalIds = new Set<string>([
    ...evidence.keys(), ...applications.keys(), ...jobs, "career_direction",
    ...canonical.tracks.map((t) => t.id), ...canonical.resumes.map((r) => r.projection.id), ...canonical.coverLetters.map((c) => c.id),
  ]);

  // 1. Validate and bind every submitted batch. Nothing partial is ever used.
  type BatchEntry = { location: string; batch_id: string | null; actor_claim: string | null; status: string; reasons: string[]; warnings: string[]; sha256: string; diagnostics: Diagnostic[] };
  const batchEntries: BatchEntry[] = [];
  const quarantine: { kind: "batch" | "operation"; location: string; batch_id: string | null; operation_id?: string; sha256: string; bytes?: Uint8Array; operation?: Operation; reasons: string[] }[] = [];
  const candidates: { entry: BatchEntry; batch: OperationBatch; bytes: Uint8Array }[] = [];
  const ordered = await Promise.all(submissions.map(async (s) => ({ s, sha: await sha256Hex(s.batchBytes) })));
  ordered.sort((a, b) => byCodeUnit(a.s.location, b.s.location) || byCodeUnit(a.sha, b.sha));

  for (const { s, sha } of ordered) {
    const location = LOCATION.exec(s.location);
    const entry: BatchEntry = { location: s.location, batch_id: location?.[2] ?? null, actor_claim: null, status: "accepted", reasons: [], warnings: [], sha256: sha, diagnostics: [] };
    const fail = (status: "rejected" | "incomplete", reason: string, diagnostics: Diagnostic[] = []) => {
      if (entry.status !== "rejected") entry.status = status;
      entry.reasons.push(reason);
      entry.diagnostics.push(...diagnostics);
    };
    const parsed = parseOperationBatch(s.batchBytes);
    if (!location) fail("rejected", "invalid_location");
    if (!parsed.ok) {
      entry.status = "rejected";
      entry.reasons.push(...new Set(parsed.diagnostics.map((d) => d.code)));
      entry.diagnostics.push(...parsed.diagnostics);
    } else {
      const batch = parsed.batch;
      entry.batch_id = batch.batch_id;
      entry.actor_claim = batch.actor_claim.actor_id;
      if (location && (location[1] !== batch.actor_claim.actor_id || location[2] !== batch.batch_id)) fail("rejected", "location_mismatch");
      if (batch.workspace_id !== workspaceId) fail("rejected", "workspace_mismatch");
      const receipt = receiptById.get(batch.source_export_id);
      if (!receipt) fail("rejected", "unknown_source_export");
      else if (receipt.manifest_sha256 !== batch.source_manifest_sha256) fail("rejected", "source_manifest_mismatch");
      if (entry.status === "accepted") {
        if (!s.commitBytes) fail("incomplete", "commit_marker_missing");
        else {
          const marker = parseCommitMarker(s.commitBytes);
          if (!marker.ok) fail("incomplete", "commit_marker_invalid", marker.diagnostics);
          else if (marker.value.batch_id !== batch.batch_id || marker.value.batch_sha256 !== sha || marker.value.batch_bytes !== s.batchBytes.length) fail("incomplete", "commit_marker_mismatch");
          else {
            // D02: the marker inventory and the drafts' references must be the same set.
            const declared = marker.value.attachments.map(attachmentKey).sort(byCodeUnit);
            const referenced = batchAttachmentRefs(batch).map(attachmentKey).sort(byCodeUnit);
            if (!sameList(declared, referenced)) fail("rejected", "attachment_reference_mismatch");
            else {
              for (const attachment of marker.value.attachments) {
                const bytes = hasOwn(s.attachments, attachment.path) ? s.attachments[attachment.path] : undefined;
                if (!bytes) fail("incomplete", "attachment_missing");
                else if (bytes.length !== attachment.bytes || (await sha256Hex(bytes)) !== attachment.sha256) fail("incomplete", "attachment_digest_mismatch");
              }
            }
          }
        }
      }
      if (entry.status === "accepted") candidates.push({ entry, batch, bytes: s.batchBytes });
    }
    batchEntries.push(entry);
  }

  // 2. A batch ID names one immutable byte sequence, now and in every earlier run.
  const byBatchId = new Map<string, typeof candidates>();
  for (const c of candidates) byBatchId.set(c.batch.batch_id, [...(byBatchId.get(c.batch.batch_id) ?? []), c]);
  let accepted: typeof candidates = [];
  for (const [batchId, group] of byBatchId) {
    const known = hasOwn(ledger.batches, batchId) ? ledger.batches[batchId].sha256 : undefined;
    const hashes = new Set([...group.map((c) => c.entry.sha256), ...(known ? [known] : [])]);
    if (hashes.size > 1) {
      group.forEach((c) => { c.entry.status = "rejected"; c.entry.reasons.push("batch_id_conflict"); });
      continue;
    }
    accepted.push(group[0]);
    group.slice(1).forEach((c) => { c.entry.status = "duplicate"; c.entry.reasons.push("duplicate_batch"); });
  }

  // 2b. D13: each batch extends its own claimed actor's chain. A batch whose predecessor is
  // not yet available waits (incomplete); it is never imported out of causal order.
  const runBatches = new Map(accepted.map((c) => [c.batch.batch_id, c]));
  const chain = new Map<string, "ok" | "waiting" | "actor_mismatch" | "cycle">();
  for (const start of [...runBatches.keys()].sort(byCodeUnit)) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | null = start;
    let verdict: "ok" | "waiting" | "actor_mismatch" | "cycle" = "ok";
    while (current !== null) {
      if (chain.has(current)) { verdict = chain.get(current)!; break; }
      if (onPath.has(current)) { verdict = "cycle"; break; }
      const c: (typeof candidates)[number] = runBatches.get(current)!;
      path.push(current);
      onPath.add(current);
      const prev: string | null = c.batch.previous_batch_id;
      if (prev === null) { verdict = "ok"; break; }
      if (hasOwn(ledger.batches, prev)) {
        const actor = ledger.batches[prev].actor_claim;
        if (actor === null) { if (!c.entry.warnings.includes("previous_batch_actor_unverified")) c.entry.warnings.push("previous_batch_actor_unverified"); verdict = "ok"; }
        else verdict = actor === c.batch.actor_claim.actor_id ? "ok" : "actor_mismatch";
        break;
      }
      const next = runBatches.get(prev);
      if (!next) { verdict = "waiting"; break; }
      if (next.batch.actor_claim.actor_id !== c.batch.actor_claim.actor_id) { verdict = "actor_mismatch"; break; }
      current = prev;
    }
    // A failure anywhere on the chain holds every batch built on it.
    for (const id of path) chain.set(id, verdict);
  }
  accepted = accepted.filter((c) => {
    const verdict = chain.get(c.batch.batch_id);
    if (verdict === "ok") return true;
    if (verdict === "waiting") { c.entry.status = "incomplete"; c.entry.reasons.push("previous_batch_unavailable"); }
    else { c.entry.status = "rejected"; c.entry.reasons.push(verdict === "cycle" ? "previous_batch_cycle" : "previous_batch_actor_mismatch"); }
    return false;
  });
  for (const e of batchEntries) {
    if (e.status === "rejected" || e.status === "incomplete") {
      const original = ordered.find((o) => o.s.location === e.location && o.sha === e.sha256);
      quarantine.push({ kind: "batch", location: e.location, batch_id: e.batch_id, sha256: e.sha256, bytes: original?.s.batchBytes, reasons: [...new Set(e.reasons)].sort(byCodeUnit) });
    }
  }

  // 3. Operations: de-duplicate by ID and content hash. Any second content for one ID
  // contests every version, durably, whichever was seen or imported first.
  const occurrences: Occurrence[] = [];
  for (const { batch } of accepted.sort((a, b) => byCodeUnit(a.batch.batch_id, b.batch.batch_id))) {
    for (const [index, op] of batch.operations.entries()) {
      occurrences.push({ op, batch, index, sha: await sha256Hex(canonicalJsonBytes(op)) });
    }
  }
  type Result = { operation_id: string; record_id: string; kind: OperationKind; batch_id: string; actor_claim: string; authored_at: string; outcome: Outcome; flags: string[]; previous_outcome?: Outcome };
  const results: Result[] = [];
  const duplicates: { operation_id: string; batch_id: string }[] = [];
  const live = new Map<string, Occurrence>();
  const rejectedOccurrences: { o: Occurrence; flags: string[] }[] = [];
  const contested: { operation_id: string; batch_id: string; location: string; content_sha256: string; actor_claim: string; source_export_id: string; operation: Operation; reasons: ContestReason[] }[] = [];
  // Ledger entries to write for operation IDs whose identity is contested this run.
  const idConflicts = new Map<string, LedgerEntry>();
  const resultFor = (o: Occurrence, outcome: Outcome, flags: string[] = []): Result => ({
    operation_id: o.op.operation_id, record_id: o.op.record_id, kind: o.op.kind, batch_id: o.batch.batch_id,
    actor_claim: o.batch.actor_claim.actor_id, authored_at: o.op.authored_at, outcome, flags,
  });
  const byOpId = new Map<string, Occurrence[]>();
  for (const o of occurrences) byOpId.set(o.op.operation_id, [...(byOpId.get(o.op.operation_id) ?? []), o]);
  for (const [opId, group] of byOpId) {
    const prior = hasOwn(ledger.operations, opId) ? ledger.operations[opId] : undefined;
    const knownVariants = new Set(prior?.variants ?? []);
    const allVariants = new Set([...knownVariants, ...group.map((o) => o.sha)]);
    const seenSha = new Set<string>();
    if (allVariants.size > 1) {
      const newlyConflicted = !prior || !prior.contest.includes("operation_id_conflict");
      for (const o of group) {
        if (seenSha.has(o.sha)) { duplicates.push({ operation_id: opId, batch_id: o.batch.batch_id }); continue; }
        seenSha.add(o.sha);
        if (!newlyConflicted && knownVariants.has(o.sha)) {
          results.push({ ...resultFor(o, "already_reconciled"), previous_outcome: prior!.outcome });
          continue;
        }
        results.push(resultFor(o, "contested", ["operation_id_conflict"]));
        contested.push({ operation_id: opId, batch_id: o.batch.batch_id, location: locationOf(o.batch), content_sha256: o.sha, actor_claim: o.batch.actor_claim.actor_id, source_export_id: o.batch.source_export_id, operation: o.op, reasons: ["operation_id_conflict"] });
      }
      const variants = sortedUnique(allVariants);
      if (prior) {
        idConflicts.set(opId, { ...prior, contest: sortedUnique([...prior.contest, "operation_id_conflict" as const]), variants });
      } else {
        // No version was ever accepted: record the lowest hash as a deterministic representative.
        const rep = [...group].sort((a, b) => byCodeUnit(a.sha, b.sha) || byCodeUnit(a.batch.batch_id, b.batch.batch_id))[0];
        idConflicts.set(opId, {
          content_sha256: rep.sha, outcome: "contested", batch_id: rep.batch.batch_id, record_id: rep.op.record_id, kind: rep.op.kind,
          previous_operation_id: rep.op.previous_operation_id, contest: ["operation_id_conflict"], variants,
        });
      }
      continue;
    }
    for (const o of group) {
      if (seenSha.has(o.sha)) { duplicates.push({ operation_id: opId, batch_id: o.batch.batch_id }); continue; }
      seenSha.add(o.sha);
      if (prior) results.push({ ...resultFor(o, "already_reconciled"), previous_outcome: prior.outcome });
      else live.set(opId, o);
    }
  }

  // 4. Causal evaluation, iterative (no recursion depth limit). Known operations include
  // earlier runs' ledger entries; each operation has at most one predecessor.
  type Node = { record_id: string; kind: OperationKind; previous_operation_id: string | null };
  const known = new Map<string, Node>();
  for (const [id, e] of Object.entries(ledger.operations)) known.set(id, e);
  for (const [id, e] of idConflicts) known.set(id, e);
  for (const [id, o] of live) known.set(id, { record_id: o.op.record_id, kind: o.op.kind, previous_operation_id: o.op.previous_operation_id });
  const recordKinds = new Map<string, Set<OperationKind>>();
  const siblings = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const siblingKey = (n: Node) => `${n.record_id}\u0000${n.previous_operation_id ?? ""}`;
  for (const [id, k] of known) {
    recordKinds.set(k.record_id, new Set([...(recordKinds.get(k.record_id) ?? []), k.kind]));
    siblings.set(siblingKey(k), [...(siblings.get(siblingKey(k)) ?? []), id]);
    if (k.previous_operation_id) children.set(k.previous_operation_id, [...(children.get(k.previous_operation_id) ?? []), id]);
  }

  // Cycle detection over predecessor pointers (a functional graph): colour each node once.
  const cyclic = new Set<string>();
  const colour = new Map<string, 1 | 2>();
  for (const start of [...live.keys()].sort(byCodeUnit)) {
    const path: string[] = [];
    let current: string | null = start;
    while (current && known.has(current) && !colour.has(current)) {
      colour.set(current, 1);
      path.push(current);
      current = known.get(current)!.previous_operation_id;
    }
    if (current && colour.get(current) === 1) {
      for (let i = path.indexOf(current); i >= 0 && i < path.length; i += 1) cyclic.add(path[i]);
    }
    for (const id of path) colour.set(id, 2);
  }

  const contestOf = (id: string): ContestReason[] => idConflicts.get(id)?.contest ?? (hasOwn(ledger.operations, id) ? ledger.operations[id].contest : []);
  const outcomes = new Map<string, Outcome>(Object.entries(ledger.operations).map(([id, e]) => [id, e.outcome]));
  for (const [id, e] of idConflicts) outcomes.set(id, e.outcome);
  const flagsById = new Map<string, Set<string>>();
  const decide = (opId: string, predecessor: string | null): Outcome => {
    const o = live.get(opId)!;
    const { op } = o;
    const flags = new Set<string>();
    flagsById.set(opId, flags);
    const consequential = isConsequential(op.kind);
    const payload = op.payload as Record<string, unknown>;
    const predecessorOutcome = predecessor ? (outcomes.get(predecessor) ?? null) : null;
    let outcome: Outcome | null = null;

    if (cyclic.has(opId)) { flags.add("predecessor_cycle"); outcome = "rejected"; }
    if (canonicalIds.has(op.record_id)) { flags.add("record_id_shadows_canonical"); outcome = "rejected"; }
    if ((recordKinds.get(op.record_id)?.size ?? 0) > 1) { flags.add("record_kind_conflict"); outcome = "rejected"; }
    // D04: drafts and status claims chain through previous_operation_id, never base_revision.
    const correction = op.kind === "evidence_change_proposal" && payload.proposal_kind === "correction";
    if (!correction && op.base_revision !== null) { flags.add("base_revision_not_applicable"); outcome = "rejected"; }
    if (correction) {
      const target = evidence.get(payload.evidence_id as string);
      if (!target) { flags.add("unknown_evidence_target"); outcome = "rejected"; }
      else if (op.base_revision === null) { flags.add("missing_base_revision"); outcome = "rejected"; }
      else {
        const state = classifyCitation(op.base_revision, target);
        if (state === "legacy_current") flags.add("legacy_evidence_revision");
        else if (state === "stale") flags.add("stale_base_revision");
      }
    }
    if (!outcome && op.previous_operation_id) {
      const prev = known.get(op.previous_operation_id);
      if (!prev) { flags.add("missing_predecessor"); outcome = "pending_predecessor"; }
      else if (prev.record_id !== op.record_id) { flags.add("predecessor_record_mismatch"); outcome = "rejected"; }
      else if (predecessorOutcome === "rejected" || predecessorOutcome === "pending_predecessor" || predecessorOutcome === null) { flags.add("predecessor_unavailable"); outcome = "pending_predecessor"; }
      else if (contestOf(op.previous_operation_id).length || predecessorOutcome === "contested") flags.add("ancestor_contested");
    }
    if ((siblings.get(siblingKey(op))?.length ?? 0) > 1) flags.add("fork");

    const refs = (payload.source_evidence_refs as { record_id: string; revision: string }[] | undefined) ?? [];
    for (const ref of refs) {
      const current = evidence.get(ref.record_id);
      if (!current || !current.authoritative) { flags.add("unknown_or_unconfirmed_evidence"); continue; }
      const state = classifyCitation(ref.revision, current);
      if (state === "legacy_current") flags.add("legacy_evidence_revision");
      else if (state === "stale") flags.add("stale_evidence");
    }
    if (op.kind === "application_status_claim") {
      const status = applications.get(payload.application_id as string);
      if (status === undefined) flags.add("unknown_application");
      else if ((CLAIM_STATUS_MAPPING.map as Record<string, string>)[payload.claimed_status as string] !== status) flags.add("claim_differs_from_canonical");
    }
    if (op.kind === "opportunity_annotation" && !jobs.has(payload.opportunity_id as string)) flags.add("unknown_opportunity");

    if (!outcome) {
      const needsRebase = [...flags].some((f) => REBASE_FLAGS.has(f));
      if (consequential) outcome = needsRebase ? "needs_rebase" : "staged_for_review";
      else if (needsRebase) outcome = "needs_rebase";
      else if (flags.has("fork") || flags.has("ancestor_contested") || flags.has("unknown_opportunity")) outcome = "staged_draft";
      else if (predecessorOutcome && predecessorOutcome !== "imported_draft") { flags.add("predecessor_not_imported"); outcome = "staged_draft"; }
      else outcome = policy.autoImportKinds.includes(op.kind) ? "imported_draft" : "staged_draft";
    }
    return outcome;
  };

  // Process roots first, then children once their predecessor is decided.
  const queue: string[] = [];
  for (const id of [...live.keys()].sort(byCodeUnit)) {
    const prev = live.get(id)!.op.previous_operation_id;
    if (!prev || !live.has(prev) || cyclic.has(id)) queue.push(id);
  }
  const decided = new Set<string>();
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (decided.has(id)) continue;
    outcomes.set(id, decide(id, live.get(id)!.op.previous_operation_id));
    decided.add(id);
    for (const child of (children.get(id) ?? []).filter((c) => live.has(c) && !decided.has(c)).sort(byCodeUnit)) queue.push(child);
  }
  // Anything unreached hangs off a cycle; it waits for a valid predecessor.
  for (const id of [...live.keys()].sort(byCodeUnit)) {
    if (!decided.has(id)) { outcomes.set(id, decide(id, null)); decided.add(id); }
  }

  // 5. Durable contest propagation over everything the ledger will hold.
  const ledgerable = (id: string) => {
    if (hasOwn(ledger.operations, id) || idConflicts.has(id)) return true;
    return live.has(id) && LEDGER_OUTCOMES.has(outcomes.get(id)!);
  };
  const contest = new Map<string, Set<ContestReason>>();
  const addContest = (id: string, reason: ContestReason) => {
    if (!ledgerable(id)) return;
    contest.set(id, new Set([...(contest.get(id) ?? []), reason]));
  };
  for (const id of known.keys()) for (const reason of contestOf(id)) addContest(id, reason);
  for (const group of siblings.values()) {
    const members = group.filter(ledgerable);
    if (members.length > 1) members.forEach((id) => addContest(id, "fork"));
  }
  for (const [id, k] of known) if ((recordKinds.get(k.record_id)?.size ?? 0) > 1) addContest(id, "record_kind_conflict");
  const frontier = [...contest.keys()].sort(byCodeUnit);
  const visited = new Set<string>();
  while (frontier.length) {
    const id = frontier.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of children.get(id) ?? []) {
      if (!ledgerable(child)) continue;
      addContest(child, "ancestor_contested");
      frontier.push(child);
    }
  }

  for (const id of [...live.keys()].sort(byCodeUnit)) {
    const o = live.get(id)!;
    const flags = flagsById.get(id) ?? new Set<string>();
    let outcome = outcomes.get(id)!;
    // An import whose ancestry became contested in this same run is held instead.
    if (outcome === "imported_draft" && contest.get(id)?.size) {
      for (const reason of contest.get(id)!) flags.add(reason);
      outcome = "staged_draft";
      outcomes.set(id, outcome);
    }
    results.push(resultFor(o, outcome, [...flags].sort(byCodeUnit)));
    if (outcome === "rejected") rejectedOccurrences.push({ o, flags: [...flags].sort(byCodeUnit) });
  }

  results.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.batch_id, b.batch_id) || byCodeUnit(a.outcome, b.outcome));
  duplicates.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.batch_id, b.batch_id));
  contested.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.content_sha256, b.content_sha256));

  // Every rejected operation is preserved with its content, and its batch says so.
  const entryByBatch = new Map(accepted.map((c) => [c.batch.batch_id, c.entry]));
  for (const { o, flags } of rejectedOccurrences.sort((a, b) => byCodeUnit(a.o.op.operation_id, b.o.op.operation_id) || byCodeUnit(a.o.batch.batch_id, b.o.batch.batch_id))) {
    quarantine.push({ kind: "operation", location: locationOf(o.batch), batch_id: o.batch.batch_id, operation_id: o.op.operation_id, sha256: o.sha, operation: o.op, reasons: flags });
    const entry = entryByBatch.get(o.batch.batch_id);
    if (entry && !entry.warnings.includes("operations_rejected")) entry.warnings.push("operations_rejected");
  }

  // 6. Per-record heads: alternatives are preserved, never resolved by time or listing order.
  const active = (id: string) => {
    const state = outcomes.get(id);
    return state !== undefined && state !== "rejected" && state !== "pending_predecessor" && state !== "contested";
  };
  const records = new Map<string, { kind: OperationKind; heads: string[]; fork: boolean; contested: boolean }>();
  for (const [id, k] of known) {
    if (!active(id)) continue;
    const hasActiveChild = (children.get(id) ?? []).some((c) => active(c) && known.get(c)?.record_id === k.record_id);
    const rec = records.get(k.record_id) ?? { kind: k.kind, heads: [], fork: false, contested: false };
    if (!hasActiveChild) rec.heads.push(id);
    if (contest.get(id)?.size) rec.contested = true;
    records.set(k.record_id, rec);
  }
  for (const rec of records.values()) {
    rec.heads.sort(byCodeUnit);
    rec.fork = rec.heads.length > 1;
  }

  // 7. Plans: imported drafts, staged items and a causal activity history.
  const staged: Record<string, unknown>[] = [];
  const drafts: Record<string, unknown>[] = [];
  for (const r of results) {
    const o = live.get(r.operation_id);
    if (!o || o.batch.batch_id !== r.batch_id) continue;
    const base = {
      operation_id: r.operation_id, record_id: r.record_id, kind: r.kind, batch_id: r.batch_id,
      previous_operation_id: o.op.previous_operation_id, authored_at: o.op.authored_at,
      actor_claim: o.batch.actor_claim.actor_id, source_export_id: o.batch.source_export_id,
      content_sha256: o.sha, base_revision: o.op.base_revision,
      payload: o.op.payload, gate_status: "not_checked",
      authority: isConsequential(r.kind) ? "agent_proposal" : "agent_draft",
    };
    if (r.outcome === "imported_draft") drafts.push(base);
    else if (r.outcome !== "rejected") staged.push({ ...base, outcome: r.outcome, flags: r.flags, contest: sortedUnique(contest.get(r.operation_id) ?? []) });
  }
  // Kahn's algorithm over predecessor edges; ties ordered by (authored_at, operation_id).
  const pool = results.filter((r) => r.outcome !== "rejected" && r.outcome !== "contested");
  const inPool = new Set(pool.map((r) => r.operation_id));
  const byId = new Map(pool.map((r) => [r.operation_id, r]));
  const ready = new OrderedQueue<Result>();
  for (const r of pool) {
    const prev = known.get(r.operation_id)?.previous_operation_id;
    if (!prev || !inPool.has(prev)) ready.push(r);
  }
  const history: Result[] = [];
  const placed = new Set<string>();
  while (ready.size) {
    const item = ready.pop();
    if (placed.has(item.operation_id)) continue;
    placed.add(item.operation_id);
    history.push(item);
    for (const child of children.get(item.operation_id) ?? []) if (byId.has(child) && !placed.has(child)) ready.push(byId.get(child)!);
  }

  // 8. Ledger: final outcomes only (pending work is retried, rejections are not recorded).
  // Contest reasons are merged in, so they can only ever grow.
  const downgrades: { operation_id: string; record_id: string; kind: OperationKind; previous_outcome: Outcome; contest: ContestReason[]; added: ContestReason[] }[] = [];
  const newOps = new Map<string, LedgerEntry>(Object.entries(ledger.operations));
  for (const [id, e] of idConflicts) newOps.set(id, e);
  for (const r of results) {
    const o = live.get(r.operation_id);
    if (!o || o.batch.batch_id !== r.batch_id || !LEDGER_OUTCOMES.has(r.outcome)) continue;
    newOps.set(r.operation_id, { content_sha256: o.sha, outcome: r.outcome, batch_id: r.batch_id, record_id: r.record_id, kind: r.kind, previous_operation_id: o.op.previous_operation_id, contest: [], variants: [o.sha] });
  }
  for (const [id, entry] of newOps) {
    const before = hasOwn(ledger.operations, id) ? ledger.operations[id].contest : [];
    const merged = sortedUnique([...entry.contest, ...(contest.get(id) ?? [])]);
    if (!sameList(merged, entry.contest)) newOps.set(id, { ...entry, contest: merged });
    const added = merged.filter((c) => !before.includes(c));
    if (hasOwn(ledger.operations, id) && added.length) {
      downgrades.push({ operation_id: id, record_id: entry.record_id, kind: entry.kind, previous_outcome: ledger.operations[id].outcome, contest: merged, added });
    }
  }
  downgrades.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id));
  const newBatches: [string, LedgerBatch][] = Object.entries(ledger.batches);
  for (const c of accepted) if (!hasOwn(ledger.batches, c.batch.batch_id)) newBatches.push([c.batch.batch_id, { sha256: c.entry.sha256, actor_claim: c.batch.actor_claim.actor_id }]);
  const nextLedger: ReconcileLedger = { format: "jr-agent-reconcile-ledger", schema_version: 2, operations: sortedObject([...newOps]), batches: sortedObject(newBatches) };

  const counts: Record<string, number> = { imported_draft: 0, staged_draft: 0, staged_for_review: 0, needs_rebase: 0, contested: 0, pending_predecessor: 0, already_reconciled: 0, rejected: 0, duplicates: duplicates.length, downgraded: downgrades.length };
  for (const r of results) counts[r.outcome] += 1;
  for (const e of batchEntries) counts[`batches_${e.status}`] = (counts[`batches_${e.status}`] ?? 0) + 1;

  return {
    report: {
      batches: batchEntries.map(({ diagnostics, ...rest }) => ({ ...rest, reasons: [...new Set(rest.reasons)].sort(byCodeUnit), warnings: [...rest.warnings].sort(byCodeUnit), diagnostics })),
      operations: results,
      duplicates,
      records: sortedObject([...records]),
      counts,
    },
    drafts,
    staged,
    contested,
    downgrades,
    quarantine,
    history,
    ledger: nextLedger,
  };
}

export type ReconcileResult = Awaited<ReturnType<typeof reconcileWorkspace>>;
