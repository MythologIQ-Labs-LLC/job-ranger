// Review helpers for agent work (#286 G3): plain-language explanations and fresh
// deterministic re-checks against current canonical data. Pure and UI-independent; nothing
// here approves anything. Acceptance always goes through Job Ranger's existing services.

import { classifyCitation, evidenceRevision } from "./revisions.ts";
import { CLAIM_STATUS_MAPPING } from "./schema.ts";
import type { CanonicalSnapshot } from "./types.ts";

export const KIND_LABELS: Record<string, string> = {
  workspace_note_version: "Research note",
  opportunity_annotation: "Job annotation",
  material_draft_version: "Material draft",
  follow_up_plan: "Follow-up plan",
  application_status_claim: "Application status claim",
  evidence_change_proposal: "Career Evidence proposal",
};

export const STATE_LABELS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Imported draft", tone: "success" },
  kept: { label: "Kept by you", tone: "success" },
  staged: { label: "Needs a look", tone: "info" },
  proposal: { label: "Waiting for your review", tone: "warning" },
  needs_rebase: { label: "Cites changed evidence", tone: "warning" },
  pending: { label: "Waiting for earlier work", tone: "info" },
  contested: { label: "Conflicting versions", tone: "danger" },
  dismissed: { label: "Dismissed", tone: "info" },
  rejected_by_user: { label: "Rejected by you", tone: "info" },
  applied: { label: "Status changed by you", tone: "success" },
};

/** Why an item, operation or batch is where it is, in words a user can act on. */
export const REASONS: Record<string, string> = {
  fork: "Two versions were written from the same earlier version. Neither is chosen automatically.",
  operation_id_conflict: "The same operation ID arrived with different content. Every version is kept and none is used automatically.",
  ancestor_contested: "It builds on a version that is in conflict, so it can't be used automatically.",
  record_kind_conflict: "The same record was written as two different kinds of work.",
  stale_evidence: "It cites a version of your Career Evidence that has since changed.",
  legacy_evidence_revision: "It cites evidence by an older timestamp format, so Job Ranger can't tell which content the agent read.",
  unknown_or_unconfirmed_evidence: "It cites evidence that isn't confirmed or wasn't exported.",
  stale_base_revision: "It corrects a version of the evidence that has since changed.",
  missing_base_revision: "A correction must say which version of the evidence it corrects.",
  unknown_evidence_target: "It corrects evidence that doesn't exist in Job Ranger.",
  base_revision_not_applicable: "Drafts and claims can't carry a base revision; this one does, so it was refused.",
  claim_differs_from_canonical: "The agent's claim differs from the status Job Ranger has.",
  unknown_application: "It refers to an application Job Ranger doesn't have.",
  unknown_opportunity: "It refers to a job Job Ranger doesn't have.",
  record_id_shadows_canonical: "It reuses the ID of one of your own records, so it was refused.",
  predecessor_cycle: "Its version history loops back on itself, so it was refused.",
  predecessor_record_mismatch: "It claims to revise a different record, so it was refused.",
  missing_predecessor: "The earlier version it revises hasn't arrived.",
  predecessor_unavailable: "The earlier version it revises isn't usable yet.",
  predecessor_not_imported: "The earlier version it revises wasn't imported, so this one waits for you too.",
  // Batch-level reasons.
  commit_marker_missing: "The upload isn't finished: its completion marker is missing.",
  commit_marker_invalid: "The completion marker is malformed.",
  commit_marker_mismatch: "The completion marker describes different bytes than the batch file.",
  attachment_missing: "An attachment named in the completion marker is missing.",
  attachment_digest_mismatch: "An attachment's bytes don't match the completion marker (it may be corrupted).",
  attachment_reference_mismatch: "The drafts' attachment list doesn't match the completion marker exactly.",
  previous_batch_unavailable: "The agent's previous batch hasn't arrived intact, so this one waits.",
  previous_batch_actor_mismatch: "It claims to continue another agent's batches.",
  previous_batch_cycle: "Its batch history loops back on itself.",
  workspace_mismatch: "It was written for a different Job Ranger workspace.",
  unknown_source_export: "It refers to an export this Job Ranger didn't create.",
  source_manifest_mismatch: "It refers to an export, but not the exact version Job Ranger recorded.",
  location_mismatch: "Its folder doesn't match the agent and batch it names.",
  invalid_location: "It isn't in the expected workspace folder layout.",
  batch_id_conflict: "A batch with this ID was already received with different content.",
  superseded_schema_version: "It uses an older format that this version of Job Ranger no longer reads.",
  unsupported_schema_version: "It uses a format version Job Ranger doesn't support.",
  unsupported_format: "It isn't a Job Ranger agent batch.",
  unknown_field: "It contains fields Job Ranger doesn't accept, such as self-declared approvals.",
  duplicate_key: "It repeats a field name, which Job Ranger refuses.",
  invalid_json: "It isn't valid JSON.",
  too_large: "It's larger than Job Ranger accepts.",
  duplicate_batch: "It's an exact copy of another batch; the copy is ignored.",
};

export function explain(code: string): string {
  return REASONS[code] ?? `Diagnostic: ${code.replace(/_/g, " ")}.`;
}

export interface CitationCheck {
  recordId: string;
  revision: string;
  state: "current" | "legacy_current" | "stale" | "not_confirmed";
  statement: string | null;
}

/** Re-checks a draft's evidence citations against the current canonical evidence. */
export async function recheckCitations(refs: { record_id: string; revision: string }[], canonical: CanonicalSnapshot): Promise<CitationCheck[]> {
  const out: CitationCheck[] = [];
  for (const ref of refs) {
    const found = canonical.evidence.find((item) => item.evidence.id === ref.record_id)?.evidence;
    if (!found || (found.verificationState !== "user-confirmed" && found.verificationState !== "user-authored")) {
      out.push({ recordId: ref.record_id, revision: ref.revision, state: "not_confirmed", statement: found?.statement ?? null });
      continue;
    }
    const state = classifyCitation(ref.revision, { token: await evidenceRevision(found), updatedAt: found.updatedAt });
    out.push({ recordId: ref.record_id, revision: ref.revision, state, statement: found.statement });
  }
  return out;
}

export interface StatusClaimReview {
  applicationId: string;
  claimed: string;
  mappedStatus: string | null;
  currentStatus: string | null;
  applicationTitle: string | null;
  /** True only when the application exists and the status would actually change. */
  canApply: boolean;
}

export function reviewStatusClaim(payload: Record<string, unknown>, canonical: CanonicalSnapshot): StatusClaimReview {
  const applicationId = String(payload.application_id ?? "");
  const claimed = String(payload.claimed_status ?? "");
  const mappedStatus = (CLAIM_STATUS_MAPPING.map as Record<string, string>)[claimed] ?? null;
  const application = canonical.applications.find((a) => a.id === applicationId) ?? null;
  return {
    applicationId,
    claimed,
    mappedStatus,
    currentStatus: application?.status ?? null,
    applicationTitle: application ? `${application.title} at ${application.companyName}` : null,
    canApply: application !== null && mappedStatus !== null && mappedStatus !== application.status,
  };
}
