import { useEffect, useRef, useState } from "react";
import { AlertTriangle, GitBranchPlus, RotateCcw, Target } from "lucide-react";
import { getDesktopApi } from "../services/api";
import type {
  ResumeProjectionDetail,
  ResumeTailoringPlan,
} from "../shared/resume-contracts";

interface ResumeTailoringPanelProps {
  source: ResumeProjectionDetail;
  jobId: string;
  onApplied: (detail: ResumeProjectionDetail) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}

function supportLabel(support: ResumeTailoringPlan["candidates"][number]["support"]): string {
  switch (support) {
    case "direct":
      return "Direct match";
    case "transferable":
      return "Transferable";
    default:
      return "Source resume";
  }
}

export function ResumeTailoringPanel({
  source,
  jobId,
  onApplied,
  onMessage,
  onError,
}: ResumeTailoringPanelProps) {
  const [plan, setPlan] = useState<ResumeTailoringPlan | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Kept here rather than in the page banner: the page clears its banner when
  // it reloads in the background, which would silently drop a failed preview.
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Identifies the latest preview request. Changing the draft or job, or leaving,
  // invalidates any request still in flight so its late result is ignored.
  const previewRequest = useRef(0);

  useEffect(() => {
    setPlan(null);
    setSelectedIds([]);
    setPreviewError(null);
    setBusy(false);
    return () => {
      previewRequest.current += 1;
    };
  }, [source.projection.id, jobId]);

  const alreadyTailored =
    source.projection.sourceProjectionId !== null && source.projection.jobId === jobId;

  const preview = async () => {
    const request = ++previewRequest.current;
    const isCurrent = () => request === previewRequest.current;
    setBusy(true);
    setPreviewError(null);
    try {
      const next = await getDesktopApi().resume.previewTailoring({
        sourceProjectionId: source.projection.id,
        jobId,
      });
      if (!isCurrent()) return;
      setPlan(next);
      setSelectedIds(next.suggestedEvidenceIds);
      onMessage(
        `Tailoring preview found ${next.directCount} direct and ${next.transferableCount} transferable requirement match${next.directCount + next.transferableCount === 1 ? "" : "es"}.`,
      );
    } catch (failure) {
      if (!isCurrent()) return;
      setPreviewError(
        failure instanceof Error
          ? failure.message
          : "Unable to prepare tailoring preview",
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const apply = async () => {
    if (!plan || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const detail = await getDesktopApi().resume.applyTailoring({
        sourceProjectionId: plan.sourceProjectionId,
        jobId: plan.jobId,
        selectedEvidenceIds: selectedIds,
      });
      setPlan(null);
      setSelectedIds([]);
      onApplied(detail);
      onMessage(
        "Tailored draft created. The source resume is unchanged, and unsupported requirements remain gaps.",
      );
    } catch (applyError) {
      onError(
        applyError instanceof Error
          ? applyError.message
          : "Unable to create tailored resume draft",
      );
    } finally {
      setBusy(false);
    }
  };

  if (alreadyTailored) {
    return (
      <section className="support-note mt-5 flex items-start gap-3 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <GitBranchPlus className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-success)]" />
        <div>
          <p className="font-semibold text-[var(--color-text-primary)]">
            Tailored draft
          </p>
          <p className="mt-1">
            This resume was created from a reviewed target-specific plan. Its source draft remains unchanged.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-muted mt-5 rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--color-primary)]" />
            <h3 className="font-semibold">Tailor for this job</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            Preview how confirmed Career Evidence maps to this job before creating a new draft. Nothing changes until you accept the plan.
          </p>
        </div>
        {!plan && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void preview()}
          >
            <Target className="h-4 w-4" />
            {busy ? "Reviewing..." : "Preview tailoring"}
          </button>
        )}
      </div>

      {previewError && (
        <div
          role="alert"
          className="support-note mt-4 px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          <p className="font-semibold">Tailoring preview failed. Nothing was changed.</p>
          <p className="mt-1">{previewError}</p>
        </div>
      )}

      {plan && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="panel rounded-xl p-3">
              <span className="metric-label">Direct</span>
              <strong className="mt-1 block text-xl">{plan.directCount}</strong>
            </div>
            <div className="panel rounded-xl p-3">
              <span className="metric-label">Transferable</span>
              <strong className="mt-1 block text-xl">{plan.transferableCount}</strong>
            </div>
            <div className="panel rounded-xl p-3">
              <span className="metric-label">Ambiguous</span>
              <strong className="mt-1 block text-xl">{plan.ambiguousCount}</strong>
            </div>
            <div className="panel rounded-xl p-3">
              <span className="metric-label">Gaps</span>
              <strong className="mt-1 block text-xl">{plan.gapCount}</strong>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-semibold">Evidence for the tailored draft</h4>
              <span className="text-xs text-[var(--color-text-muted)]">
                {selectedIds.length} selected
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {plan.candidates.map((candidate) => {
                const selected = selectedIds.includes(candidate.evidenceId);
                const added = plan.addedEvidenceIds.includes(candidate.evidenceId);
                const omitted = plan.omittedSourceEvidenceIds.includes(candidate.evidenceId);
                return (
                  <label
                    key={candidate.evidenceId}
                    className="panel flex cursor-pointer gap-3 rounded-xl p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={busy}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, candidate.evidenceId]))
                            : current.filter((id) => id !== candidate.evidenceId),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong>{supportLabel(candidate.support)}</strong>
                        {added && <span className="soft-badge">Add</span>}
                        {omitted && <span className="soft-badge">Omit by default</span>}
                      </span>
                      <span className="mt-1 block text-[var(--color-text-secondary)]">
                        {candidate.statement}
                      </span>
                      {candidate.reasons.length > 0 && (
                        <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                          {candidate.reasons.join(" ")}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {plan.gaps.length > 0 && (
            <div className="support-note px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
                Requirements Sojourner will not claim
              </div>
              <div className="mt-3 space-y-3">
                {plan.gaps.map((gap) => (
                  <div key={gap.requirementId} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{gap.text}</strong>
                      <span className="soft-badge">
                        {gap.state === "gap" ? "Gap" : "Needs confirmation"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {gap.explanation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-divider flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <button
              type="button"
              className="surface-link-button flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]"
              disabled={busy}
              onClick={() => {
                setPlan(null);
                setSelectedIds([]);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Discard preview
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void apply()}
            >
              <GitBranchPlus className="h-4 w-4" />
              {busy ? "Creating..." : "Create tailored draft"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
