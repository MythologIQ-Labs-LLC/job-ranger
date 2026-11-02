import { useCallback, useMemo, useRef, useState } from "react";
import { ClipboardCopy, Compass, RefreshCw } from "lucide-react";
import type { CandidateEvidenceReviewItem } from "../shared/contracts";
import { getDesktopApi } from "../services/api";
import { buildCareerExplorationBrief } from "../shared/career-exploration-brief";

interface CareerExplorationHandoffProps {
  onTryDirection: (direction: string) => void;
}

const MAX_SELECTED = 6;
const MAX_STATEMENT = 650;

function usable(item: CandidateEvidenceReviewItem): boolean {
  const state = item.evidence.verificationState;
  return state === "user-confirmed" || state === "user-authored";
}

export function CareerExplorationHandoff({ onTryDirection }: CareerExplorationHandoffProps) {
  const [goal, setGoal] = useState("");
  const [preferences, setPreferences] = useState("");
  const [constraints, setConstraints] = useState("");
  const [records, setRecords] = useState<CandidateEvidenceReviewItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [consentedBrief, setConsentedBrief] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  // An in-flight read must not copy a brief after consent or input changed.
  const reviewEpoch = useRef(0);

  const refreshEvidence = useCallback(async () => {
    reviewEpoch.current += 1;
    setLoading(true);
    setError(null);
    try {
      const next = await getDesktopApi().career.listEvidence();
      setRecords(next.filter(usable));
      setSelectedIds((current) => current.filter((id) =>
        next.some((item) => item.evidence.id === id && usable(item)),
      ));
      setLoaded(true);
      setConsentedBrief(null);
      setCopyStatus(null);
    } catch {
      setError("Could not load confirmed Career Evidence. You can still explore without it.");
    } finally {
      setLoading(false);
    }
  }, []);

  const selected = useMemo(() =>
    records.filter((item) => selectedIds.includes(item.evidence.id))
      .map(({ evidence }) => ({ id: evidence.id, statement: evidence.statement })),
    [records, selectedIds],
  );
  const rendered = useMemo(() => {
    try {
      return { brief: buildCareerExplorationBrief({ goal, preferences, constraints, evidence: selected }), error: null };
    } catch (cause) {
      return { brief: "", error: cause instanceof Error ? cause.message : "Unable to build the brief." };
    }
  }, [goal, preferences, constraints, selected]);

  const onEdit = (update: () => void) => {
    reviewEpoch.current += 1;
    update();
    setConsentedBrief(null);
    setCopyStatus(null);
    setError(null);
  };

  const toggleEvidence = (id: string, checked: boolean) => onEdit(() => {
    setSelectedIds((current) => checked
      ? (current.length < MAX_SELECTED ? [...current, id] : current)
      : current.filter((item) => item !== id));
  });

  const copyBrief = async () => {
    if (!rendered.brief || rendered.brief !== consentedBrief) return;
    setCopyStatus(null);
    setError(null);
    const approvedEpoch = reviewEpoch.current;
    try {
      // Refuse copying an already-approved brief if its selected canonical
      // source has changed or become unconfirmed since the preview was made.
      const fresh = selected.length ? await getDesktopApi().career.listEvidence() : [];
      if (selected.length) {
        const current = fresh.filter(usable);
        const matches = selected.every((item) => current.some(({ evidence }) =>
          evidence.id === item.id && evidence.statement === item.statement));
        if (!matches) {
          setConsentedBrief(null);
          setError("Selected Career Evidence changed. Refresh and review the brief again.");
          return;
        }
      }
      if (approvedEpoch !== reviewEpoch.current) {
        setError("The brief changed during verification. Review and approve it again.");
        return;
      }
      if (!navigator.clipboard?.writeText) {
        setError("Clipboard access is unavailable. The preview remains available for manual copying.");
        return;
      }
      await navigator.clipboard.writeText(rendered.brief);
      setCopyStatus("Brief copied locally. Paste it only into an assistant you trust.");
    } catch {
      setError("Could not copy the brief. Sojourner did not send any information.");
    }
  };

  return (
    <details className="panel panel-strong mt-6 px-5 py-5 sm:px-7" onToggle={(event) => {
      if (event.currentTarget.open && !loaded && !loading) void refreshEvidence();
    }}>
      <summary className="cursor-pointer text-[var(--color-text-primary)]">
        <h2 id="career-exploration-heading" className="inline-flex items-center gap-2 text-xl font-semibold">
          <Compass className="h-5 w-5" aria-hidden="true" />
          Explore career possibilities with an assistant
        </h2>
      </summary>
      <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
        Start from your goals, not just a previous job title. Sojourner prepares a brief locally for
        ChatGPT or another assistant, but does not contact any model or upload your information.
        You can also sketch an idea yourself, without AI. Nothing becomes Career Evidence or a
        saved Target Track unless you review and save it separately.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="metric-label">Career exploration goal</span>
          <textarea className="input-shell mt-2 min-h-24 resize-y py-3"
            maxLength={600} value={goal}
            onChange={(event) => onEdit(() => setGoal(event.target.value))}
            placeholder="What kind of work, impact, or environment do you want to explore?"
          />
        </label>
        <label className="block">
          <span className="metric-label">Preferences and aspirations</span>
          <textarea className="input-shell mt-2 min-h-24 resize-y py-3"
            maxLength={1500} value={preferences}
            onChange={(event) => onEdit(() => setPreferences(event.target.value))}
            placeholder="What would you enjoy? Which trade-offs might be acceptable?"
          />
        </label>
        <label className="block">
          <span className="metric-label">Hard constraints you want respected</span>
          <textarea className="input-shell mt-2 min-h-24 resize-y py-3"
            maxLength={1500} value={constraints}
            onChange={(event) => onEdit(() => setConstraints(event.target.value))}
            placeholder="What cannot change? Leave blank if you are still exploring."
          />
        </label>
      </div>

      <section className="mt-6" aria-labelledby="exploration-evidence-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="exploration-evidence-heading" className="text-lg font-semibold">
            Optional Career Evidence to include
          </h3>
          <button type="button" className="secondary-button" onClick={() => void refreshEvidence()} disabled={loading}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {loading ? "Refreshing..." : "Refresh evidence"}
          </button>
        </div>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Nothing is selected by default. Choose up to six confirmed records only if you
          deliberately want their exact statements in a prompt for an external assistant.
          Sensitive details in a selected statement are not automatically redacted.
        </p>
        {loading && <p className="mt-3 text-sm">Loading evidence...</p>}
        {!loading && loaded && records.length === 0 && (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            No confirmed records are available. Goal-first exploration works without a resume.
          </p>
        )}
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
          {records.map(({ evidence }) => {
            const checked = selectedIds.includes(evidence.id);
            const tooLong = evidence.statement.length > MAX_STATEMENT || !evidence.statement.trim();
            return (
              <label key={evidence.id} className="panel panel-muted flex items-start gap-3 rounded-xl px-4 py-3 text-sm">
                <input type="checkbox" className="mt-1"
                  aria-label={`Include confirmed Career Evidence: ${evidence.statement.slice(0, 90)}`}
                  checked={checked}
                  disabled={tooLong || (!checked && selectedIds.length >= MAX_SELECTED)}
                  onChange={(event) => toggleEvidence(evidence.id, event.target.checked)}
                />
                <span className="min-w-0 break-words">
                  {evidence.statement}
                  {tooLong && <span className="mt-1 block text-xs text-[var(--color-warning)]">
                    This record is too long for the brief. Edit it in Career Evidence first.
                  </span>}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="border-divider mt-6 border-t pt-6" aria-label="Career exploration handoff">
        <h3 className="text-lg font-semibold">Preview exactly what you will share</h3>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Review the entire text before copying. Copying uses your local clipboard only.
          If you paste it into an AI service, that provider's privacy terms apply.
        </p>
        <textarea aria-label="Exact career exploration brief" readOnly
          className="input-shell mt-3 min-h-48 resize-y py-3 font-mono text-xs"
          value={rendered.brief} placeholder={rendered.error ?? "Enter a career goal to prepare a brief."}
        />
        <label className="mt-4 flex items-start gap-3 text-sm leading-6">
          <input type="checkbox" className="mt-1"
            checked={Boolean(rendered.brief && consentedBrief === rendered.brief)}
            disabled={!rendered.brief}
            onChange={(event) => {
              reviewEpoch.current += 1;
              setConsentedBrief(event.target.checked ? rendered.brief : null);
            }}
          />
          I have reviewed this exact brief and choose to copy it for possible use with an external assistant.
        </label>
        <button type="button" className="primary-button mt-4"
          onClick={() => void copyBrief()}
          disabled={!rendered.brief || consentedBrief !== rendered.brief}>
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
          Copy reviewed brief
        </button>
        {rendered.error && goal.trim() && <p className="mt-3 text-sm text-[var(--color-warning)]">{rendered.error}</p>}
        {copyStatus && <p role="status" className="mt-3 text-sm text-[var(--color-success)]">{copyStatus}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
      </section>

      <section className="border-divider mt-6 border-t pt-6" aria-label="Explore a proposed career direction">
        <h3 className="text-lg font-semibold">Turn a promising idea into a track draft</h3>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          After discussing possibilities with an assistant, or simply thinking on your own,
          enter one direction you want to investigate. This opens a new, <strong>paused and
          unsaved</strong> Target Track in the track editor. If the editor has unsaved changes,
          you will be asked before they are replaced. Review actual roles, constraints and
          requirements before you save or activate it.
        </p>
        <label className="mt-4 block">
          <span className="metric-label">Direction I want to explore</span>
          <input className="input-shell mt-2" maxLength={120} value={direction}
            onChange={(event) => setDirection(event.target.value)}
            placeholder="For example: community-focused operations" />
        </label>
        <button type="button" className="secondary-button mt-4"
          disabled={!direction.trim()}
          onClick={() => onTryDirection(direction.trim())}>
          Start an unsaved, paused track draft
        </button>
      </section>
    </details>
  );
}
