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

import { canonicalJsonBytes, sha256Hex } from "./canonical.ts";
import {
  AGENT_OWNED_KINDS,
  CONSEQUENTIAL_KINDS,
  parseCommitMarker,
  parseOperationBatch,
  type OperationBatchV1,
  type OperationKind,
  type OperationV1,
} from "./schema-v1.ts";
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
  | "pending_predecessor"
  | "already_reconciled"
  | "rejected";

interface LedgerEntry {
  content_sha256: string;
  outcome: Outcome;
  batch_id: string;
  record_id: string;
  kind: OperationKind;
  previous_operation_id: string | null;
}

export interface ReconcileLedger {
  format: "jr-agent-reconcile-ledger";
  schema_version: 1;
  operations: Record<string, LedgerEntry>;
  batches: Record<string, string>;
}

export interface ReconcileInput {
  receipts: ExportReceipt[];
  canonical: CanonicalSnapshot;
  policy: ReconcilePolicy;
  ledger: ReconcileLedger | null;
  submissions: Submission[];
}

const LOCATION = /^workspace\/agents\/([A-Za-z0-9][A-Za-z0-9._:-]{5,127})\/batches\/(batch_[A-Za-z0-9_-]{2,121})\.json$/;
const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORITATIVE = new Set(["user-confirmed", "user-authored"]);
// The draft batch schema's claim vocabulary differs from ApplicationStatus (#286 ambiguity).
const CLAIM_TO_CANONICAL: Record<string, string> = {
  drafted: "interested",
  submitted: "applied",
  interviewing: "interview",
  offered: "offer",
  rejected: "rejected",
  withdrawn: "withdrawn",
};
const REBASE_FLAGS = new Set(["stale_evidence", "unknown_or_unconfirmed_evidence", "stale_base_revision", "missing_base_revision"]);
// Outcomes a ledger may record. "pending_predecessor" and "rejected" are never ledgered.
const LEDGER_OUTCOMES = new Set<string>(["imported_draft", "staged_draft", "staged_for_review", "needs_rebase"]);
const ALL_KINDS = new Set<string>([...AGENT_OWNED_KINDS, ...CONSEQUENTIAL_KINDS]);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function sortedObject<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => byCodeUnit(a, b)));
}

function closedKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((k) => hasOwn(value, k));
}

/** The ledger is a local trust anchor; a malformed or forged one is refused, never repaired. */
function validateLedger(value: unknown): ReconcileLedger {
  const fail = (message: string): never => { throw new AgentWorkspaceError("invalid_ledger", message); };
  if (!isRecord(value) || !closedKeys(value, ["format", "schema_version", "operations", "batches"])) fail("Ledger must be a closed jr-agent-reconcile-ledger object.");
  const ledger = value as Record<string, unknown>;
  if (ledger.format !== "jr-agent-reconcile-ledger" || ledger.schema_version !== 1) fail("Unsupported ledger format or version.");
  if (!isRecord(ledger.operations) || !isRecord(ledger.batches)) fail("Ledger operations and batches must be objects.");
  for (const [id, entry] of Object.entries(ledger.operations as Record<string, unknown>)) {
    if (!/^op_[A-Za-z0-9_-]+$/.test(id) || !isRecord(entry) || !closedKeys(entry, ["content_sha256", "outcome", "batch_id", "record_id", "kind", "previous_operation_id"])) fail(`Ledger entry ${id.slice(0, 64)} is malformed.`);
    const e = entry as Record<string, unknown>;
    if (typeof e.content_sha256 !== "string" || !SHA256.test(e.content_sha256)) fail(`Ledger entry ${id} has an invalid content hash.`);
    if (typeof e.outcome !== "string" || !LEDGER_OUTCOMES.has(e.outcome)) fail(`Ledger entry ${id} has an invalid outcome.`);
    if (typeof e.kind !== "string" || !ALL_KINDS.has(e.kind)) fail(`Ledger entry ${id} has an invalid kind.`);
    if (typeof e.batch_id !== "string" || typeof e.record_id !== "string") fail(`Ledger entry ${id} is missing identifiers.`);
    if (e.previous_operation_id !== null && typeof e.previous_operation_id !== "string") fail(`Ledger entry ${id} has an invalid predecessor.`);
  }
  for (const [id, digest] of Object.entries(ledger.batches as Record<string, unknown>)) {
    if (!/^batch_[A-Za-z0-9_-]+$/.test(id) || typeof digest !== "string" || !SHA256.test(digest)) fail(`Ledger batch ${id.slice(0, 64)} is malformed.`);
  }
  return value as ReconcileLedger;
}

function validateReceipt(value: unknown): ExportReceipt {
  const fail = (message: string): never => { throw new AgentWorkspaceError("invalid_receipt", message); };
  if (!isRecord(value)) fail("Receipt must be an object.");
  const r = value as Record<string, unknown>;
  if (r.format !== "jr-agent-export-receipt" || r.schema_version !== 1) fail("Unsupported receipt format or version.");
  if (typeof r.export_id !== "string" || !/^ex_[A-Za-z0-9_-]{6,93}$/.test(r.export_id)) fail("Receipt export ID is invalid.");
  if (typeof r.manifest_sha256 !== "string" || !SHA256.test(r.manifest_sha256)) fail(`Receipt ${String(r.export_id)} has an invalid manifest digest.`);
  if (!Number.isInteger(r.manifest_bytes) || (r.manifest_bytes as number) < 1) fail("Receipt manifest size is invalid.");
  if (!Array.isArray(r.files) || !isRecord(r.record_revisions)) fail("Receipt files and record revisions are required.");
  return value as ExportReceipt;
}

interface Occurrence {
  op: OperationV1;
  batch: OperationBatchV1;
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

export async function reconcileWorkspace(input: ReconcileInput) {
  const { canonical, policy, submissions } = input;
  for (const kind of policy.autoImportKinds) {
    if (!(AGENT_OWNED_KINDS as readonly string[]).includes(kind)) {
      throw new AgentWorkspaceError("invalid_policy", `"${kind}" cannot be imported automatically; consequential kinds always need review.`);
    }
  }
  const ledger: ReconcileLedger = input.ledger === null
    ? { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: {}, batches: {} }
    : validateLedger(input.ledger);
  const receipts = input.receipts.map(validateReceipt);
  const receiptById = new Map(receipts.map((r) => [r.export_id, r]));
  const evidence = new Map(canonical.evidence.map(({ evidence: e }) => [e.id, { revision: e.updatedAt, authoritative: AUTHORITATIVE.has(e.verificationState) }]));
  const applications = new Map(canonical.applications.map((a) => [a.id, a.status as string]));
  const jobs = new Set(canonical.jobs.map((j) => j.id));
  const canonicalIds = new Set<string>([
    ...evidence.keys(), ...applications.keys(), ...jobs,
    ...canonical.tracks.map((t) => t.id), ...canonical.resumes.map((r) => r.projection.id), ...canonical.coverLetters.map((c) => c.id),
  ]);

  // 1. Validate and bind every submitted batch. Nothing partial is ever used.
  type BatchEntry = { location: string; batch_id: string | null; actor_claim: string | null; status: string; reasons: string[]; warnings: string[]; sha256: string; diagnostics: Diagnostic[] };
  const batchEntries: BatchEntry[] = [];
  const quarantine: { kind: "batch" | "operation"; location: string; batch_id: string | null; operation_id?: string; sha256: string; bytes?: Uint8Array; operation?: OperationV1; reasons: string[] }[] = [];
  const candidates: { entry: BatchEntry; batch: OperationBatchV1; bytes: Uint8Array }[] = [];
  const ordered = await Promise.all(submissions.map(async (s) => ({ s, sha: await sha256Hex(s.batchBytes) })));
  ordered.sort((a, b) => byCodeUnit(a.s.location, b.s.location) || byCodeUnit(a.sha, b.sha));

  for (const { s, sha } of ordered) {
    const location = LOCATION.exec(s.location);
    const entry: BatchEntry = { location: s.location, batch_id: location?.[2] ?? null, actor_claim: null, status: "accepted", reasons: [], warnings: [], sha256: sha, diagnostics: [] };
    const fail = (status: "rejected" | "incomplete", reason: string, diagnostics: Diagnostic[] = []) => {
      entry.status = status;
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
            for (const attachment of marker.value.attachments) {
              const bytes = hasOwn(s.attachments, attachment.path) ? s.attachments[attachment.path] : undefined;
              if (!bytes) fail("incomplete", "attachment_missing");
              else if (bytes.length !== attachment.bytes || (await sha256Hex(bytes)) !== attachment.sha256) fail("incomplete", "attachment_digest_mismatch");
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
  const accepted: typeof candidates = [];
  for (const [batchId, group] of byBatchId) {
    const known = hasOwn(ledger.batches, batchId) ? ledger.batches[batchId] : undefined;
    const hashes = new Set([...group.map((c) => c.entry.sha256), ...(known ? [known] : [])]);
    if (hashes.size > 1) {
      group.forEach((c) => { c.entry.status = "rejected"; c.entry.reasons.push("batch_id_conflict"); });
      continue;
    }
    accepted.push(group[0]);
    group.slice(1).forEach((c) => { c.entry.status = "duplicate"; c.entry.reasons.push("duplicate_batch"); });
  }
  const acceptedIds = new Set([...accepted.map((c) => c.batch.batch_id), ...Object.keys(ledger.batches)]);
  for (const c of accepted) {
    if (c.batch.previous_batch_id && !acceptedIds.has(c.batch.previous_batch_id)) c.entry.warnings.push("previous_batch_unavailable");
  }
  for (const e of batchEntries) {
    if (e.status === "rejected" || e.status === "incomplete") {
      const original = ordered.find((o) => o.s.location === e.location && o.sha === e.sha256);
      quarantine.push({ kind: "batch", location: e.location, batch_id: e.batch_id, sha256: e.sha256, bytes: original?.s.batchBytes, reasons: [...e.reasons] });
    }
  }

  // 3. Operations: de-duplicate by ID and content hash; same ID with other bytes is a conflict.
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
  const resultFor = (o: Occurrence, outcome: Outcome, flags: string[] = []): Result => ({
    operation_id: o.op.operation_id, record_id: o.op.record_id, kind: o.op.kind, batch_id: o.batch.batch_id,
    actor_claim: o.batch.actor_claim.actor_id, authored_at: o.op.authored_at, outcome, flags,
  });
  const byOpId = new Map<string, Occurrence[]>();
  for (const o of occurrences) byOpId.set(o.op.operation_id, [...(byOpId.get(o.op.operation_id) ?? []), o]);
  for (const [opId, group] of byOpId) {
    const prior = hasOwn(ledger.operations, opId) ? ledger.operations[opId] : undefined;
    const reference = prior?.content_sha256 ?? (new Set(group.map((o) => o.sha)).size === 1 ? group[0].sha : null);
    let kept = false;
    for (const o of group) {
      if (reference === null || o.sha !== reference) {
        results.push(resultFor(o, "rejected", ["operation_id_conflict"]));
        rejectedOccurrences.push({ o, flags: ["operation_id_conflict"] });
      } else if (kept) {
        duplicates.push({ operation_id: opId, batch_id: o.batch.batch_id });
      } else {
        kept = true;
        if (prior) results.push({ ...resultFor(o, "already_reconciled"), previous_outcome: prior.outcome });
        else live.set(opId, o);
      }
    }
  }

  // 4. Causal evaluation, iterative (no recursion depth limit). Known operations include
  // earlier runs' ledger entries; each operation has at most one predecessor.
  type Node = { record_id: string; kind: OperationKind; previous_operation_id: string | null };
  const known = new Map<string, Node>();
  for (const [id, e] of Object.entries(ledger.operations)) known.set(id, e);
  for (const [id, o] of live) known.set(id, { record_id: o.op.record_id, kind: o.op.kind, previous_operation_id: o.op.previous_operation_id });
  const recordKinds = new Map<string, Set<OperationKind>>();
  const siblings = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const [id, k] of known) {
    recordKinds.set(k.record_id, new Set([...(recordKinds.get(k.record_id) ?? []), k.kind]));
    const key = `${k.record_id}\u0000${k.previous_operation_id ?? ""}`;
    siblings.set(key, (siblings.get(key) ?? 0) + 1);
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

  const outcomes = new Map<string, Outcome>(Object.entries(ledger.operations).map(([id, e]) => [id, e.outcome]));
  const flagsById = new Map<string, Set<string>>();
  const decide = (opId: string, predecessorOutcome: Outcome | null): Outcome => {
    const o = live.get(opId)!;
    const { op } = o;
    const flags = new Set<string>();
    flagsById.set(opId, flags);
    const consequential = (CONSEQUENTIAL_KINDS as readonly string[]).includes(op.kind);
    let outcome: Outcome | null = null;

    if (cyclic.has(opId)) { flags.add("predecessor_cycle"); outcome = "rejected"; }
    if (canonicalIds.has(op.record_id)) { flags.add("record_id_shadows_canonical"); outcome = "rejected"; }
    if ((recordKinds.get(op.record_id)?.size ?? 0) > 1) { flags.add("record_kind_conflict"); outcome = "rejected"; }
    if ((!consequential || op.kind === "application_status_claim") && op.base_revision !== null) { flags.add("base_revision_not_applicable"); outcome = "rejected"; }
    if (!outcome && op.previous_operation_id) {
      const prev = known.get(op.previous_operation_id);
      if (!prev) { flags.add("missing_predecessor"); outcome = "pending_predecessor"; }
      else if (prev.record_id !== op.record_id) { flags.add("predecessor_record_mismatch"); outcome = "rejected"; }
      else if (predecessorOutcome === "rejected" || predecessorOutcome === "pending_predecessor" || predecessorOutcome === null) { flags.add("predecessor_unavailable"); outcome = "pending_predecessor"; }
    }
    if ((siblings.get(`${op.record_id}\u0000${op.previous_operation_id ?? ""}`) ?? 0) > 1) flags.add("fork");

    const payload = op.payload as Record<string, unknown>;
    const refs = (payload.source_evidence_refs as { record_id: string; revision: string }[] | undefined) ?? [];
    for (const ref of refs) {
      const current = evidence.get(ref.record_id);
      if (!current || !current.authoritative) flags.add("unknown_or_unconfirmed_evidence");
      else if (current.revision !== ref.revision) flags.add("stale_evidence");
    }
    if (op.kind === "evidence_change_proposal") {
      const target = evidence.get(payload.evidence_id as string);
      if (!target) flags.add("proposes_new_evidence");
      else if (op.base_revision === null) flags.add("missing_base_revision");
      else if (op.base_revision !== target.revision) flags.add("stale_base_revision");
    }
    if (op.kind === "application_status_claim") {
      const status = applications.get(payload.application_id as string);
      if (status === undefined) flags.add("unknown_application");
      else if (CLAIM_TO_CANONICAL[payload.claimed_status as string] !== status) flags.add("claim_differs_from_canonical");
    }
    if (op.kind === "opportunity_annotation" && !jobs.has(payload.opportunity_id as string)) flags.add("unknown_opportunity");

    if (!outcome) {
      const needsRebase = [...flags].some((f) => REBASE_FLAGS.has(f));
      if (consequential) outcome = needsRebase ? "needs_rebase" : "staged_for_review";
      else if (needsRebase) outcome = "needs_rebase";
      else if (flags.has("fork") || flags.has("unknown_opportunity")) outcome = "staged_draft";
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
    const prev = live.get(id)!.op.previous_operation_id;
    const predecessorOutcome = prev ? (outcomes.get(prev) ?? null) : null;
    const outcome = decide(id, predecessorOutcome);
    outcomes.set(id, outcome);
    decided.add(id);
    for (const child of (children.get(id) ?? []).filter((c) => live.has(c) && !decided.has(c)).sort(byCodeUnit)) queue.push(child);
  }
  for (const id of [...live.keys()].sort(byCodeUnit)) {
    // Anything unreached hangs off a cycle; it waits for a valid predecessor.
    if (!decided.has(id)) { outcomes.set(id, decide(id, null)); decided.add(id); }
    const o = live.get(id)!;
    const flags = [...(flagsById.get(id) ?? [])].sort(byCodeUnit);
    const outcome = outcomes.get(id)!;
    results.push(resultFor(o, outcome, flags));
    if (outcome === "rejected") rejectedOccurrences.push({ o, flags });
  }

  results.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.batch_id, b.batch_id));
  duplicates.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.batch_id, b.batch_id));

  // Every rejected operation is preserved with its content, and its batch says so.
  const entryByBatch = new Map(accepted.map((c) => [c.batch.batch_id, c.entry]));
  for (const { o, flags } of rejectedOccurrences.sort((a, b) => byCodeUnit(a.o.op.operation_id, b.o.op.operation_id) || byCodeUnit(a.o.batch.batch_id, b.o.batch.batch_id))) {
    quarantine.push({ kind: "operation", location: `workspace/agents/${o.batch.actor_claim.actor_id}/batches/${o.batch.batch_id}.json`, batch_id: o.batch.batch_id, operation_id: o.op.operation_id, sha256: o.sha, operation: o.op, reasons: flags });
    const entry = entryByBatch.get(o.batch.batch_id);
    if (entry && !entry.warnings.includes("operations_rejected")) entry.warnings.push("operations_rejected");
  }

  // 5. Per-record heads: alternatives are preserved, never resolved by time or listing order.
  const active = (id: string) => {
    const state = outcomes.get(id);
    return state !== undefined && state !== "rejected" && state !== "pending_predecessor";
  };
  const records = new Map<string, { kind: OperationKind; heads: string[]; fork: boolean }>();
  for (const [id, k] of known) {
    if (!active(id)) continue;
    const hasActiveChild = (children.get(id) ?? []).some((c) => active(c) && known.get(c)?.record_id === k.record_id);
    const rec = records.get(k.record_id) ?? { kind: k.kind, heads: [], fork: false };
    if (!hasActiveChild) rec.heads.push(id);
    records.set(k.record_id, rec);
  }
  for (const rec of records.values()) {
    rec.heads.sort(byCodeUnit);
    rec.fork = rec.heads.length > 1;
  }

  // 6. Plans: imported drafts, staged items and a causal activity history.
  const staged: Record<string, unknown>[] = [];
  const drafts: Record<string, unknown>[] = [];
  for (const r of results) {
    const o = live.get(r.operation_id);
    if (!o || o.batch.batch_id !== r.batch_id) continue;
    const base = {
      operation_id: r.operation_id, record_id: r.record_id, kind: r.kind, batch_id: r.batch_id,
      previous_operation_id: o.op.previous_operation_id, authored_at: o.op.authored_at,
      actor_claim: o.batch.actor_claim.actor_id, source_export_id: o.batch.source_export_id,
      payload: o.op.payload, gate_status: "not_checked",
      authority: (CONSEQUENTIAL_KINDS as readonly string[]).includes(r.kind) ? "agent_proposal" : "agent_draft",
    };
    if (r.outcome === "imported_draft") drafts.push(base);
    else if (r.outcome !== "rejected") staged.push({ ...base, outcome: r.outcome, flags: r.flags });
  }
  // Kahn's algorithm over predecessor edges; ties ordered by (authored_at, operation_id).
  const pool = results.filter((r) => r.outcome !== "rejected");
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

  // 7. Ledger: final outcomes only (pending work is retried, rejections are not recorded).
  const newOps: [string, LedgerEntry][] = Object.entries(ledger.operations);
  for (const r of results) {
    const o = live.get(r.operation_id);
    if (!o || o.batch.batch_id !== r.batch_id || !LEDGER_OUTCOMES.has(r.outcome)) continue;
    newOps.push([r.operation_id, { content_sha256: o.sha, outcome: r.outcome, batch_id: r.batch_id, record_id: r.record_id, kind: r.kind, previous_operation_id: o.op.previous_operation_id }]);
  }
  const newBatches: [string, string][] = Object.entries(ledger.batches);
  for (const c of accepted) if (!hasOwn(ledger.batches, c.batch.batch_id)) newBatches.push([c.batch.batch_id, c.entry.sha256]);
  const nextLedger: ReconcileLedger = { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: sortedObject(newOps), batches: sortedObject(newBatches) };

  const counts: Record<string, number> = { imported_draft: 0, staged_draft: 0, staged_for_review: 0, needs_rebase: 0, pending_predecessor: 0, already_reconciled: 0, rejected: 0, duplicates: duplicates.length };
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
    quarantine,
    history,
    ledger: nextLedger,
  };
}
