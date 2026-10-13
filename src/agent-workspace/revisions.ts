// Evidence revision tokens (D07). A token is a collision-resistant digest over the stable
// evidence ID, a namespace and exactly the fields an agent can read in an export, so any
// change to cited content changes the token, independent of clocks. The credential number
// is never part of the token: other fields are exported, so a digest over a low-entropy
// number could be brute-forced from them.
//
// G2 exports cited `updatedAt` instead. Such legacy citations are still recognised, but only
// as ambiguous: a matching timestamp does not prove the same content was read.

import type { CandidateEvidence } from "../shared/career-contracts.ts";
import { canonicalJsonBytes, sha256Hex } from "./canonical.ts";

export const EVIDENCE_REVISION_PREFIX = "evrev1:";

export function evidenceRevisionContent(e: CandidateEvidence): Record<string, unknown> {
  return {
    namespace: "job-ranger/career-evidence",
    id: e.id,
    verification_state: e.verificationState,
    subject_type: e.subjectType,
    organization: e.organization,
    title_or_name: e.titleOrName,
    start_date: e.startDate,
    end_date: e.endDate,
    statement: e.statement,
    action: e.action,
    context: e.context,
    skills: e.skills,
    methods_or_tools: e.methodsOrTools,
    scope: e.scope,
    outcomes: e.outcomes,
    metrics: e.metrics,
    credential: e.credential ? { issuer: e.credential.issuer, jurisdiction: e.credential.jurisdiction, status: e.credential.status, expiration_date: e.credential.expirationDate } : null,
  };
}

export async function evidenceRevision(e: CandidateEvidence): Promise<string> {
  return `${EVIDENCE_REVISION_PREFIX}${await sha256Hex(canonicalJsonBytes(evidenceRevisionContent(e)))}`;
}

export type CitationState = "current" | "legacy_current" | "stale";

/** Classifies a cited revision against the current evidence record. */
export function classifyCitation(cited: string, current: { token: string; updatedAt: string }): CitationState {
  if (cited === current.token) return "current";
  if (!cited.startsWith(EVIDENCE_REVISION_PREFIX) && cited === current.updatedAt) return "legacy_current";
  return "stale";
}
