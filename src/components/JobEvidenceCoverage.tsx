import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  HelpCircle,
  Target,
} from "lucide-react";
import type { CareerTargetTrack, Job, JobEvidenceCoverage } from "../shared/contracts";
import {
  buildOpportunityAssessment,
  type AlignmentStatus,
  type EligibilityStatus,
  type EvidenceCoverageStatus,
} from "../shared/opportunity-assessment";
import { getDesktopApi } from "../services/api";
import { Modal } from "./Modal";

interface Props {
  job: Job;
  targetTrack: CareerTargetTrack;
  onPrepareResume: () => void;
}

function classificationLabel(
  value: JobEvidenceCoverage["items"][number]["mapping"]["classification"],
): string {
  switch (value) {
    case "direct":
      return "Supported";
    case "transferable":
      return "Transferable";
    case "ambiguous":
      return "Needs confirmation";
    case "gap":
      return "Gap";
  }
}

function ClassificationIcon({
  value,
}: {
  value: JobEvidenceCoverage["items"][number]["mapping"]["classification"];
}) {
  if (value === "direct" || value === "transferable") {
    return (
      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-success)]" />
    );
  }
  if (value === "ambiguous") {
    return (
      <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warning)]" />
    );
  }
  return (
    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger)]" />
  );
}

function statusLabel(
  value: AlignmentStatus | EligibilityStatus | EvidenceCoverageStatus,
): string {
  switch (value) {
    case "likely":
      return "Likely";
    case "unclear":
      return "Unclear";
    case "unlikely":
      return "Unlikely";
    case "strong":
      return "Strong";
    case "partial":
      return "Partial";
    case "limited":
      return "Limited";
    case "aligned":
      return "Aligned";
    case "mixed":
      return "Mixed";
    case "misaligned":
      return "Misaligned";
    case "unknown":
      return "Unknown";
  }
}

function statusClass(
  value: AlignmentStatus | EligibilityStatus | EvidenceCoverageStatus,
): string {
  if (value === "likely" || value === "strong" || value === "aligned") {
    return "soft-badge-success";
  }
  if (value === "unlikely" || value === "limited" || value === "misaligned") {
    return "soft-badge-danger";
  }
  return "soft-badge-warning";
}

function FindingList({
  title,
  items,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  tone?: "neutral" | "positive" | "warning";
}) {
  if (items.length === 0) return null;
  const marker = tone === "positive" ? "✓" : tone === "warning" ? "•" : "·";
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm leading-5 text-[var(--color-text-secondary)]">
        {items.map((item) => (
          <li key={item}>
            {marker} {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JobEvidenceCoveragePanel({ job, targetTrack, onPrepareResume }: Props) {
  const [coverage, setCoverage] = useState<JobEvidenceCoverage | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessment = useMemo(
    () => (coverage ? buildOpportunityAssessment(job, targetTrack, coverage) : null),
    [coverage, job, targetTrack],
  );

  const toggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || coverage || loading) return;

    setLoading(true);
    setError(null);
    try {
      setCoverage(await getDesktopApi().jobs.getEvidenceCoverage(job.id));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to build the opportunity assessment",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/60">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
          <Target className="h-4 w-4 flex-shrink-0 text-[var(--color-primary)]" />
          Opportunity assessment
          <span className="truncate text-xs font-medium text-[var(--color-text-secondary)]">
            {targetTrack.name}
          </span>
          {assessment && (
            <>
              <span className={`soft-badge ${statusClass(assessment.eligibility.status)}`}>
                Eligibility {statusLabel(assessment.eligibility.status)}
              </span>
              <span
                className={`soft-badge ${statusClass(assessment.evidenceCoverage.status)}`}
              >
                Evidence {statusLabel(assessment.evidenceCoverage.status)}
              </span>
            </>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
      <Modal
        open={true}
        onClose={() => setOpen(false)}
        title={`Opportunity assessment: ${job.title}`}
        size="xl"
        placement="right"
      >
          {loading && (
            <p role="status" className="text-sm text-[var(--color-text-secondary)]">
              Comparing this listing with {targetTrack.name} and your confirmed Career Evidence...
            </p>
          )}
          {error && <p role="alert" className="text-sm text-[var(--color-danger)]">Assessment unavailable: {error}</p>}

          {assessment && coverage && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                <span className={`soft-badge ${statusClass(assessment.eligibility.status)}`}>
                  Eligibility · {statusLabel(assessment.eligibility.status)}
                </span>
                <span
                  className={`soft-badge ${statusClass(assessment.evidenceCoverage.status)}`}
                >
                  Evidence · {statusLabel(assessment.evidenceCoverage.status)}
                </span>
                <span
                  className={`soft-badge ${statusClass(assessment.careerAlignment.status)}`}
                >
                  Career · {statusLabel(assessment.careerAlignment.status)}
                </span>
                <span
                  className={`soft-badge ${statusClass(assessment.preferenceAlignment.status)}`}
                >
                  Preferences · {statusLabel(assessment.preferenceAlignment.status)}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="panel panel-muted rounded-2xl p-4">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Eligibility and blockers
                  </p>
                  {assessment.eligibility.blockers.length === 0 &&
                    assessment.eligibility.potentialBlockers.length === 0 && (
                      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                        No hard blocker is established by the listing data Job Ranger currently has.
                      </p>
                    )}
                  <div className="mt-3 space-y-3">
                    <FindingList
                      title="Known blockers"
                      items={assessment.eligibility.blockers}
                      tone="warning"
                    />
                    <FindingList
                      title="Potential blockers"
                      items={assessment.eligibility.potentialBlockers}
                      tone="warning"
                    />
                  </div>
                </div>

                <div className="panel panel-muted rounded-2xl p-4">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Career alignment
                  </p>
                  <div className="mt-3">
                    <FindingList title="Why" items={assessment.careerAlignment.reasons} />
                  </div>
                </div>

                <div className="panel panel-muted rounded-2xl p-4 lg:col-span-2">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Preference and constraint alignment
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <FindingList
                      title="Matches"
                      items={assessment.preferenceAlignment.matches}
                      tone="positive"
                    />
                    <FindingList
                      title="Misses"
                      items={assessment.preferenceAlignment.misses}
                      tone="warning"
                    />
                    <FindingList
                      title="Unknown"
                      items={assessment.preferenceAlignment.unknowns}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <FileSearch className="h-4 w-4 text-[var(--color-primary)]" />
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Evidence coverage
                  </p>
                  <span className="soft-badge soft-badge-success">
                    {coverage.directCount} direct
                  </span>
                  <span className="soft-badge soft-badge-success">
                    {coverage.transferableCount} transferable
                  </span>
                  <span className="soft-badge soft-badge-warning">
                    {coverage.ambiguousCount} confirm
                  </span>
                  <span className="soft-badge soft-badge-danger">
                    {coverage.gapCount} gaps
                  </span>
                </div>

                {coverage.totalCount === 0 ? (
                  <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                    Job Ranger could not identify an explicit requirement in the listing text it currently has. That stays unknown rather than becoming a fake penalty or bonus.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {coverage.items.map((item) => (
                      <li key={item.requirement.id} className="flex gap-2 text-sm leading-5">
                        <ClassificationIcon value={item.mapping.classification} />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[var(--color-text-primary)]">
                              {classificationLabel(item.mapping.classification)}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {item.requirement.kind}
                            </span>
                          </div>
                          <p className="mt-1 text-[var(--color-text-secondary)]">
                            {item.requirement.text}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                            {item.mapping.explanation}
                          </p>
                          {item.evidence && (
                            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                              Evidence: {item.evidence.statement}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {assessment.unknowns.length > 0 && (
                <div className="support-note px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    What Job Ranger still does not know
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-text-secondary)]">
                    {assessment.unknowns.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-[var(--color-text-muted)]">
                  This is deterministic guidance from the selected target track, collected listing data, and Career Evidence. It is not a hiring prediction.
                </p>
                <button type="button" className="secondary-button" onClick={onPrepareResume}>
                  Prepare resume
                </button>
              </div>
            </div>
          )}
      </Modal>
      )}
    </div>
  );
}
