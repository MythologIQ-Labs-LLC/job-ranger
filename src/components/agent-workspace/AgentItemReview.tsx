import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";
import { useApplications } from "../../career/storage";
import { explain, KIND_LABELS, recheckCitations, reviewStatusClaim, STATE_LABELS, type CitationCheck } from "../../agent-workspace/review.ts";
import { gatherCanonicalSnapshot, type CanonicalSnapshot } from "../../agent-workspace/index.ts";
import { getDesktopApi } from "../../services/api";
import type { AgentDecisionInput, AgentItemDetail, AgentItemSummary } from "../../shared/agent-workspace-api";
import type { ApplicationStatus } from "../../shared/career-contracts";

const STATUS_LABELS: Record<string, string> = { interested: "Interested", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };
const CITATION_LABELS: Record<CitationCheck["state"], string> = {
  current: "Current",
  legacy_current: "Older citation format; can't confirm which content was read",
  stale: "Changed since the agent read it",
  not_confirmed: "Not confirmed evidence",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="metric-label">{label}</dt>
      <dd className="mt-1 text-sm text-[var(--color-text-primary)] break-words">{children}</dd>
    </div>
  );
}

function Text({ value }: { value: unknown }) {
  // Agent text is untrusted data: always rendered as plain text, never as markup.
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">{String(value ?? "")}</p>;
}

export function AgentItemReview({
  item,
  onClose,
  getItem,
  decide,
  messageOf,
}: {
  item: AgentItemSummary | null;
  onClose: () => void;
  getItem: (operationId: string, contentSha256: string) => Promise<AgentItemDetail | null>;
  decide: (decision: AgentDecisionInput) => Promise<AgentItemDetail>;
  messageOf: (error: unknown) => string;
}) {
  const [detail, setDetail] = useState<AgentItemDetail | null>(null);
  const [canonical, setCanonical] = useState<CanonicalSnapshot | null>(null);
  const [citations, setCitations] = useState<CitationCheck[] | null>(null);
  const [selected, setSelected] = useState<{ operationId: string; contentSha256: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [pending, setPending] = useState(false);
  const applications = useApplications();

  useEffect(() => {
    setSelected(item ? { operationId: item.operationId, contentSha256: item.contentSha256 } : null);
    setAcknowledged(false);
    setNotice(null);
  }, [item]);

  useEffect(() => {
    let cancelled = false;
    // Acknowledging one version's conflict never carries over to another version.
    setAcknowledged(false);
    if (!selected) { setDetail(null); return; }
    setError(null);
    void (async () => {
      try {
        const [loaded, snapshot] = await Promise.all([getItem(selected.operationId, selected.contentSha256), gatherCanonicalSnapshot(getDesktopApi())]);
        if (cancelled) return;
        setDetail(loaded);
        setCanonical(snapshot);
        const refs = (loaded?.operation.payload as Record<string, unknown> | undefined)?.source_evidence_refs as { record_id: string; revision: string }[] | undefined;
        setCitations(refs ? await recheckCitations(refs, snapshot) : null);
      } catch (cause) {
        if (!cancelled) setError(messageOf(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [selected, getItem, messageOf]);

  const act = async (decision: Omit<AgentDecisionInput, "operationId" | "contentSha256">, message: string) => {
    if (!detail || pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await decide({ operationId: detail.operationId, contentSha256: detail.contentSha256, ...decision });
      setDetail(updated);
      setNotice(message);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  };

  const payload = (detail?.operation.payload ?? {}) as Record<string, unknown>;
  const decided = detail ? ["kept", "dismissed", "rejected_by_user", "applied"].includes(detail.state) : false;
  const agentOwned = detail ? !["application_status_claim", "evidence_change_proposal"].includes(detail.kind) : false;
  const contested = !!detail && (detail.state === "contested" || detail.contest.length > 0);
  const claim = detail?.kind === "application_status_claim" && canonical ? reviewStatusClaim(payload, canonical) : null;
  const target = detail?.kind === "evidence_change_proposal" && canonical && payload.evidence_id
    ? canonical.evidence.find((e) => e.evidence.id === payload.evidence_id)?.evidence ?? null
    : null;
  const state = detail ? STATE_LABELS[detail.state] : null;

  return (
    <Modal open={item !== null} onClose={onClose} title={detail ? `${KIND_LABELS[detail.kind] ?? detail.kind}: ${detail.title}` : "Agent work"} size="lg">
      {!detail && !error && <p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
      {error && <p role="alert" className="support-note px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {detail && state && (
        <div className="space-y-5" data-testid="agent-item-review">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`soft-badge soft-badge-${state.tone}`}>{state.label}</span>
            {detail.previousState && <span className="text-xs text-[var(--color-text-muted)]">Previously: {STATE_LABELS[detail.previousState]?.label ?? detail.previousState}</span>}
          </div>
          {notice && <p role="status" className="support-note px-4 py-3 text-sm">{notice}</p>}

          {(detail.flags.length > 0 || detail.contest.length > 0) && (
            <section aria-labelledby="agent-item-why" className="support-note px-4 py-3">
              <h3 id="agent-item-why" className="text-sm font-semibold text-[var(--color-text-primary)]">Why it's here</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {[...new Set([...detail.contest, ...detail.flags])].map((code) => <li key={code}>{explain(code)}</li>)}
              </ul>
            </section>
          )}

          <section aria-labelledby="agent-item-content">
            <h3 id="agent-item-content" className="text-sm font-semibold">Content</h3>
            <div className="panel panel-muted mt-2 space-y-3 rounded-2xl p-4">
              {detail.kind === "workspace_note_version" && <Text value={payload.body} />}
              {detail.kind === "opportunity_annotation" && <><Text value={payload.notes} /><p className="text-xs text-[var(--color-text-muted)]">About job {String(payload.opportunity_id)}</p></>}
              {detail.kind === "follow_up_plan" && <><Text value={payload.description} /><p className="text-xs text-[var(--color-text-muted)]">Suggested due date: {payload.due_at ? String(payload.due_at) : "none"} (a suggestion, not a scheduled event)</p></>}
              {detail.kind === "material_draft_version" && <><p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{String(payload.material_kind).replace(/_/g, " ")}</p><Text value={payload.body} /></>}
              {detail.kind === "application_status_claim" && <Text value={payload.reported_context} />}
              {detail.kind === "evidence_change_proposal" && (
                <>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{payload.proposal_kind === "new" ? "Proposed new evidence" : "Proposed correction"}</p>
                  <Text value={payload.proposed_text} />
                  <p className="text-xs text-[var(--color-text-muted)]">Agent's reason: {String(payload.change_reason ?? "")}</p>
                  {target && <div><p className="metric-label">Your current evidence</p><Text value={target.statement} /></div>}
                </>
              )}
            </div>
          </section>

          {citations && (
            <section aria-labelledby="agent-item-citations">
              <h3 id="agent-item-citations" className="text-sm font-semibold">Evidence it cites, checked now</h3>
              {citations.length === 0 ? <p className="mt-1 text-sm text-[var(--color-text-secondary)]">It cites no evidence.</p> : (
                <ul className="mt-2 space-y-2">
                  {citations.map((c) => (
                    <li key={`${c.recordId}-${c.revision}`} className="text-sm">
                      <span className={`status-dot status-dot-${c.state === "current" ? "success" : "warning"}`} aria-hidden="true" />{" "}
                      <span className="font-medium">{c.recordId}</span>: {CITATION_LABELS[c.state]}
                      {c.statement && <span className="block text-xs text-[var(--color-text-muted)]">{c.statement}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {detail.kind === "material_draft_version" && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Truth Gate and Parseability Gate: not checked. Agents can't run them, and turning an agent draft into a resume or cover letter
                  isn't available yet, so it stays here as a draft you can copy from.
                </p>
              )}
            </section>
          )}

          {claim && (
            <section aria-labelledby="agent-item-claim" className="panel panel-muted rounded-2xl p-4">
              <h3 id="agent-item-claim" className="text-sm font-semibold">Claim compared with Job Ranger</h3>
              <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                <Field label="Agent says">{claim.claimed}</Field>
                <Field label="Means in Job Ranger">{claim.mappedStatus ? STATUS_LABELS[claim.mappedStatus] : "Unsupported"}</Field>
                <Field label="Current status">{claim.currentStatus ? STATUS_LABELS[claim.currentStatus] : "Application not found"}</Field>
              </dl>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">A claim is not proof. Only you can change an application's status.</p>
            </section>
          )}

          <section aria-labelledby="agent-item-source">
            <h3 id="agent-item-source" className="text-sm font-semibold">Source</h3>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Claimed author (unverified)">{detail.actorClaim}</Field>
              <Field label="Agent-reported time">{detail.authoredAt}</Field>
              <Field label="Based on export">{detail.sourceExportId}</Field>
              <Field label="File">{detail.location}</Field>
              <Field label="First seen in sync">#{detail.firstSeenRun}</Field>
              <Field label="Content SHA-256"><code className="text-xs">{detail.contentSha256}</code></Field>
            </dl>
          </section>

          {detail.variants.length > 0 && (
            <section aria-labelledby="agent-item-variants">
              <h3 id="agent-item-variants" className="text-sm font-semibold">Other versions with the same operation ID</h3>
              <ul className="mt-2 space-y-2">
                {detail.variants.map((v) => (
                  <li key={v.contentSha256} className="flex flex-wrap items-center gap-3 text-sm">
                    <span>From {v.actorClaim} in {v.batchId}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{STATE_LABELS[v.state]?.label ?? v.state}</span>
                    <button type="button" className="surface-link-button" onClick={() => setSelected({ operationId: detail.operationId, contentSha256: v.contentSha256 })}>
                      View this version
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.decisions.length > 0 && (
            <section aria-labelledby="agent-item-decisions">
              <h3 id="agent-item-decisions" className="text-sm font-semibold">Decisions</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {detail.decisions.map((d) => (
                  <li key={d.decisionId}>{d.decidedAt}: {STATE_LABELS[d.fromState]?.label ?? d.fromState} → {STATE_LABELS[d.toState]?.label ?? d.toState}{d.note ? ` (${d.note})` : ""}</li>
                ))}
              </ul>
            </section>
          )}

          {!decided && (
            <section aria-label="Actions" className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
              {agentOwned && detail.state !== "pending" && detail.outcome !== "pending_predecessor" && (
                <>
                  {contested && (
                    <label className="flex w-full items-center gap-3 text-sm">
                      <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="h-4 w-4" />
                      I've reviewed every version and want to keep this one.
                    </label>
                  )}
                  <button type="button" className="primary-button disabled:cursor-not-allowed disabled:opacity-50" disabled={pending || (contested && !acknowledged)}
                    onClick={() => act({ action: "keep_draft", acknowledgeContest: contested ? true : undefined }, "Kept as an agent draft. It isn't a confirmed fact.")}>
                    Keep as draft
                  </button>
                </>
              )}
              {claim?.canApply && !contested && detail.state === "proposal" && (
                <button type="button" className="primary-button" disabled={pending} onClick={() => setConfirmStatus(true)}>
                  Change status to {STATUS_LABELS[claim.mappedStatus!]}…
                </button>
              )}
              {detail.kind === "evidence_change_proposal" && (
                <Link to="/career-evidence/new" className="secondary-button">Add evidence yourself</Link>
              )}
              {!agentOwned && (
                <button type="button" className="secondary-button" disabled={pending} onClick={() => act({ action: "reject_proposal" }, "Rejected. Nothing in Job Ranger changed.")}>
                  Reject
                </button>
              )}
              <button type="button" className="secondary-button" disabled={pending} onClick={() => act({ action: "dismiss" }, "Dismissed. The content is still stored locally.")}>
                Dismiss
              </button>
            </section>
          )}
          {detail.kind === "evidence_change_proposal" && !decided && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Job Ranger doesn't accept agent-proposed Career Evidence directly yet. If it's accurate, add it yourself with your own source;
              it then goes through the normal confirmation.
            </p>
          )}
        </div>
      )}
      {claim && claim.mappedStatus && detail && (
        <ConfirmDialog
          open={confirmStatus}
          onClose={() => setConfirmStatus(false)}
          variant="warning"
          title="Change application status?"
          message={`You're changing ${claim.applicationTitle ?? "this application"} from ${STATUS_LABELS[claim.currentStatus ?? ""] ?? claim.currentStatus} to ${STATUS_LABELS[claim.mappedStatus]}. Only do this if it's true; the agent's claim isn't proof.`}
          confirmLabel={`Change to ${STATUS_LABELS[claim.mappedStatus]}`}
          onConfirm={async () => {
            // The existing applications workflow makes the change; the decision is recorded after.
            await applications.update(claim.applicationId, { status: claim.mappedStatus as ApplicationStatus });
            await act({ action: "record_status_applied", applicationId: claim.applicationId, appliedStatus: claim.mappedStatus! }, "Status changed by you and recorded.");
          }}
        />
      )}
    </Modal>
  );
}
