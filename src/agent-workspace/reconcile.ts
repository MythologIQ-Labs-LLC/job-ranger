// Deterministic long-gap reconciliation of agent workspace batches (#286).
//
// Pure: takes discovered submission bytes, local export receipts, a read-only canonical
// snapshot, the user's standing policy and the previous ledger, and returns a plan. It
// never mutates canonical data; any later canonical change must go through existing
// services and their approval boundaries. Times are display-only; ordering comes from
// operation IDs, content hashes and declared causal predecessors.

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
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortedObject<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => byCodeUnit(a, b)));
}

interface Occurrence {
  op: OperationV1;
  batch: OperationBatchV1;
  index: number;
  sha: string;
}

export async function reconcileWorkspace(input: ReconcileInput) {
  const { receipts, canonical, policy, submissions } = input;
  for (const kind of policy.autoImportKinds) {
    if (!(AGENT_OWNED_KINDS as readonly string[]).includes(kind)) {
      throw new AgentWorkspaceError("invalid_policy", `"${kind}" cannot be imported automatically; consequential kinds always need review.`);
    }
  }
  const ledger: ReconcileLedger = input.ledger ?? { format: "jr-agent-reconcile-ledger", schema_version: 1, operations: {}, batches: {} };
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
              const bytes = Object.prototype.hasOwnProperty.call(s.attachments, attachment.path) ? s.attachments[attachment.path] : undefined;
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
    const known = ledger.batches[batchId];
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
  const resultFor = (o: Occurrence, outcome: Outcome, flags: string[] = []): Result => ({
    operation_id: o.op.operation_id, record_id: o.op.record_id, kind: o.op.kind, batch_id: o.batch.batch_id,
    actor_claim: o.batch.actor_claim.actor_id, authored_at: o.op.authored_at, outcome, flags,
  });
  const byOpId = new Map<string, Occurrence[]>();
  for (const o of occurrences) byOpId.set(o.op.operation_id, [...(byOpId.get(o.op.operation_id) ?? []), o]);
  for (const [opId, group] of byOpId) {
    const prior = ledger.operations[opId];
    const reference = prior?.content_sha256 ?? (new Set(group.map((o) => o.sha)).size === 1 ? group[0].sha : null);
    let kept = false;
    for (const o of group) {
      if (reference === null || o.sha !== reference) {
        results.push(resultFor(o, "rejected", ["operation_id_conflict"]));
        quarantine.push({ kind: "operation", location: `workspace/agents/${o.batch.actor_claim.actor_id}/batches/${o.batch.batch_id}.json`, batch_id: o.batch.batch_id, operation_id: opId, sha256: o.sha, operation: o.op, reasons: ["operation_id_conflict"] });
      } else if (kept) {
        duplicates.push({ operation_id: opId, batch_id: o.batch.batch_id });
      } else {
        kept = true;
        if (prior) results.push({ ...resultFor(o, "already_reconciled"), previous_outcome: prior.outcome });
        else live.set(opId, o);
      }
    }
  }

  // 4. Causal evaluation. Known operations include earlier runs' ledger entries.
  const known = new Map<string, { record_id: string; kind: OperationKind; previous_operation_id: string | null }>();
  for (const [id, e] of Object.entries(ledger.operations)) known.set(id, e);
  for (const [id, o] of live) known.set(id, { record_id: o.op.record_id, kind: o.op.kind, previous_operation_id: o.op.previous_operation_id });
  const recordKinds = new Map<string, Set<OperationKind>>();
  for (const k of known.values()) recordKinds.set(k.record_id, new Set([...(recordKinds.get(k.record_id) ?? []), k.kind]));
  const siblings = new Map<string, number>();
  for (const k of known.values()) {
    const key = `${k.record_id}\u0000${k.previous_operation_id ?? ""}`;
    siblings.set(key, (siblings.get(key) ?? 0) + 1);
  }

  const outcomes = new Map<string, Outcome>(Object.entries(ledger.operations).map(([id, e]) => [id, e.outcome]));
  const evaluating = new Set<string>();
  const evaluate = (opId: string): Outcome => {
    const cached = outcomes.get(opId);
    if (cached) return cached;
    const o = live.get(opId);
    if (!o) return "pending_predecessor";
    if (evaluating.has(opId)) return "rejected";
    evaluating.add(opId);
    const { op } = o;
    const flags = new Set<string>();
    let outcome: Outcome | null = null;
    const consequential = (CONSEQUENTIAL_KINDS as readonly string[]).includes(op.kind);

    if (canonicalIds.has(op.record_id)) { flags.add("record_id_shadows_canonical"); outcome = "rejected"; }
    if ((recordKinds.get(op.record_id)?.size ?? 0) > 1) { flags.add("record_kind_conflict"); outcome = "rejected"; }
    if (!consequential && op.base_revision !== null) { flags.add("base_revision_not_applicable"); outcome = "rejected"; }
    if (op.kind === "application_status_claim" && op.base_revision !== null) { flags.add("base_revision_not_applicable"); outcome = "rejected"; }

    let predecessorOutcome: Outcome | null = null;
    if (!outcome && op.previous_operation_id) {
      const prev = known.get(op.previous_operation_id);
      if (!prev) { flags.add("missing_predecessor"); outcome = "pending_predecessor"; }
      else if (prev.record_id !== op.record_id) { flags.add("predecessor_record_mismatch"); outcome = "rejected"; }
      else {
        predecessorOutcome = evaluate(op.previous_operation_id);
        if (predecessorOutcome === "rejected" || predecessorOutcome === "pending_predecessor") { flags.add("predecessor_unavailable"); outcome = "pending_predecessor"; }
      }
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
    evaluating.delete(opId);
    outcomes.set(opId, outcome);
    results.push(resultFor(o, outcome, [...flags].sort(byCodeUnit)));
    return outcome;
  };
  for (const opId of [...live.keys()].sort(byCodeUnit)) evaluate(opId);
  // Already-reconciled entries report the outcome recorded when they were first reconciled.
  for (const r of results) if (r.outcome === "already_reconciled" && r.previous_outcome === undefined) r.previous_outcome = ledger.operations[r.operation_id]?.outcome;

  results.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.batch_id, b.batch_id));
  duplicates.sort((a, b) => byCodeUnit(a.operation_id, b.operation_id) || byCodeUnit(a.batch_id, b.batch_id));

  // 5. Per-record heads: alternatives are preserved, never resolved by time or listing order.
  const activeOutcome = (id: string) => outcomes.get(id);
  const records = new Map<string, { kind: OperationKind; heads: string[]; fork: boolean }>();
  for (const [id, k] of known) {
    const state = activeOutcome(id);
    if (!state || state === "rejected" || state === "pending_predecessor") continue;
    const hasChild = [...known].some(([childId, c]) => c.previous_operation_id === id && c.record_id === k.record_id && !["rejected", "pending_predecessor", undefined].includes(activeOutcome(childId)));
    const rec = records.get(k.record_id) ?? { kind: k.kind, heads: [], fork: false };
    if (!hasChild) rec.heads.push(id);
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
  const historyPool = results.filter((r) => r.outcome !== "rejected");
  const placed = new Set<string>();
  const history: Result[] = [];
  const remaining = [...historyPool].sort((a, b) => byCodeUnit(a.authored_at, b.authored_at) || byCodeUnit(a.operation_id, b.operation_id));
  while (remaining.length) {
    const next = remaining.findIndex((r) => {
      const prev = known.get(r.operation_id)?.previous_operation_id;
      return !prev || placed.has(prev) || !remaining.some((x) => x.operation_id === prev);
    });
    const [item] = remaining.splice(next === -1 ? 0 : next, 1);
    placed.add(item.operation_id);
    history.push(item);
  }

  // 7. Ledger: final outcomes only (pending work is retried, rejections are not recorded).
  const newOps: [string, LedgerEntry][] = Object.entries(ledger.operations);
  for (const r of results) {
    const o = live.get(r.operation_id);
    if (!o || o.batch.batch_id !== r.batch_id || r.outcome === "pending_predecessor" || r.outcome === "rejected") continue;
    newOps.push([r.operation_id, { content_sha256: o.sha, outcome: r.outcome, batch_id: r.batch_id, record_id: r.record_id, kind: r.kind, previous_operation_id: o.op.previous_operation_id }]);
  }
  const newBatches: [string, string][] = Object.entries(ledger.batches);
  for (const c of accepted) if (!ledger.batches[c.batch.batch_id]) newBatches.push([c.batch.batch_id, c.entry.sha256]);
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
