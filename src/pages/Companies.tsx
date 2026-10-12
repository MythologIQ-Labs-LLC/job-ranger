import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Compass,
  ExternalLink,
  Plus,
  Play,
  Radar,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTargetTracks } from "../career/target-tracks";
import { CompanyForm } from "../components/CompanyForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Layout } from "../components/Layout";
import { Modal } from "../components/Modal";
import { useAppContext } from "../context/AppContext";
import { getDesktopApi } from "../services/api";
import { useRuntimeInfo } from "../services/runtime";
import { isRunnableInRuntime } from "../shared/runtime";
import type {
  SourceDiscoveryCandidate,
  SourceDiscoveryResult,
} from "../shared/source-discovery";
import { canRunSourceType, getSourceProfile } from "../types";

const SUPPORT_BADGE_CLASSES: Record<string, string> = {
  supported: "soft-badge-success",
  detected: "soft-badge-info",
  "browser-required": "soft-badge-warning",
  "manual-review": "soft-badge-danger",
};

export function Companies() {
  const runtimeKind = useRuntimeInfo()?.kind;
  const { companies, addCompany, deleteCompany, runScraper, refreshing } = useAppContext();
  const targetTracks = useTargetTracks();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const deleteTarget = companies.find((company) => company.id === deleteTargetId) ?? null;
  const [runningId, setRunningId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [discovery, setDiscovery] = useState<SourceDiscoveryResult | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [dismissedCandidateIds, setDismissedCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [approvedCandidateIds, setApprovedCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const activeTracks = useMemo(
    () => targetTracks.tracks.filter((track) => track.isActive && track.roleTitles.length > 0),
    [targetTracks.tracks],
  );

  useEffect(() => {
    if (
      !selectedTrackId ||
      !activeTracks.some((track) => track.id === selectedTrackId)
    ) {
      setSelectedTrackId(activeTracks[0]?.id ?? "");
    }
  }, [activeTracks, selectedTrackId]);

  const selectedTrack = useMemo(
    () => activeTracks.find((track) => track.id === selectedTrackId) ?? null,
    [activeTracks, selectedTrackId],
  );

  const visibleCandidates = useMemo(
    () =>
      (discovery?.candidates ?? []).filter(
        (candidate) => !dismissedCandidateIds.has(candidate.id),
      ),
    [discovery, dismissedCandidateIds],
  );

  const runnableCount = useMemo(
    () => companies.filter((company) => canRunSourceType(company.sourceType)).length,
    [companies],
  );
  const browserRequiredCount = useMemo(
    () => companies.filter((company) => company.sourceType === "browser-required").length,
    [companies],
  );

  const handleRun = async (companyId: string) => {
    setRunningId(companyId);
    try {
      await runScraper(companyId);
    } finally {
      setRunningId(null);
    }
  };

  const runDiscovery = async () => {
    if (!selectedTrack) {
      setDiscoveryError("Choose an active target track with at least one role title first.");
      return;
    }

    setDiscoveryBusy(true);
    setDiscoveryError(null);
    setDismissedCandidateIds(new Set());
    setApprovedCandidateIds(new Set());
    try {
      const result = await getDesktopApi().discovery.discover({
        targetTrackId: selectedTrack.id,
        roleTitles: selectedTrack.roleTitles,
        locations: selectedTrack.constraints.geography.locations,
        limit: 24,
      });
      setDiscovery(result);
    } catch (error) {
      setDiscovery(null);
      setDiscoveryError(
        error instanceof Error ? error.message : "Unable to discover opportunities right now.",
      );
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const approveSource = async (candidate: SourceDiscoveryCandidate) => {
    if (!candidate.sourceUrl || !candidate.canMonitor) return;
    setApprovingId(candidate.id);
    setDiscoveryError(null);
    try {
      await addCompany({
        name: candidate.employerName,
        url: candidate.sourceUrl,
        frequencyMinutes: 1440,
        isActive: true,
      });
      setApprovedCandidateIds((current) => new Set(current).add(candidate.id));
    } catch (error) {
      setDiscoveryError(
        error instanceof Error ? error.message : "Unable to approve this source for monitoring.",
      );
    } finally {
      setApprovingId(null);
    }
  };

  const dismissCandidate = (id: string) => {
    setDismissedCandidateIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="alpha-pill">
              <Compass className="h-3.5 w-3.5" />
              Opportunity sources
            </span>
            <h1 className="page-title mt-4">
              Find places to look, then choose what Job Ranger should monitor.
            </h1>
            <p className="page-copy">
              Start from a target track instead of hunting down career-page URLs yourself. Discovery can surface opportunities and, when a reliable employer source is available, let you approve it for local monitoring. Nothing becomes a monitored source without your approval.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Add a source manually
          </button>
        </div>
      </section>

      <section className="panel panel-strong mt-6 p-6 sm:p-8" aria-labelledby="discover-sources-heading">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[var(--color-primary)]">
              <Radar className="h-5 w-5" />
              <span className="metric-label">Discovery</span>
            </div>
            <h2 id="discover-sources-heading" className="mt-2 text-2xl font-semibold">
              Search from the work you actually want.
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              The first discovery provider uses public job feeds and is intentionally incomplete. It is useful for finding leads without pretending to represent the whole labor market.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <label className="min-w-64">
              <span className="metric-label">Target track</span>
              <select
                className="select-shell mt-2"
                aria-label="Discovery target track"
                value={selectedTrackId}
                onChange={(event) => {
                  setSelectedTrackId(event.target.value);
                  setDiscovery(null);
                  setDiscoveryError(null);
                }}
                disabled={targetTracks.loading || activeTracks.length === 0}
              >
                {activeTracks.length === 0 && <option value="">No active target tracks</option>}
                {activeTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary-button self-end"
              onClick={() => void runDiscovery()}
              disabled={!selectedTrack || discoveryBusy}
            >
              <Search className="h-4 w-4" />
              {discoveryBusy ? "Searching..." : "Find opportunities"}
            </button>
          </div>
        </div>

        {activeTracks.length === 0 && !targetTracks.loading && (
          <div className="support-note mt-5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            Create or activate a Target Track with at least one role title before running discovery. Job Ranger needs to know what kind of work to look for, which is apparently an unreasonable demand to place on a search box.
          </div>
        )}

        {selectedTrack && (
          <div className="mt-5 flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
            {selectedTrack.roleTitles.map((title) => (
              <span key={title} className="soft-badge soft-badge-info">{title}</span>
            ))}
            {selectedTrack.constraints.geography.locations.map((location) => (
              <span key={location} className="soft-badge">{location}</span>
            ))}
          </div>
        )}

        {discoveryError && (
          <div className="support-note mt-5 px-4 py-3 text-sm text-[var(--color-danger)]">
            {discoveryError}
          </div>
        )}

        {discovery && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`soft-badge ${
                    discovery.coverage === "partial" ? "soft-badge-warning" : "soft-badge-danger"
                  }`}
                >
                  {discovery.coverage === "partial" ? "Partial coverage" : "Provider unavailable"}
                </span>
                <span className="text-sm text-[var(--color-text-secondary)]">
                  {discovery.candidates.length} candidate{discovery.candidates.length === 1 ? "" : "s"} from {discovery.providerName}
                </span>
              </div>
              {dismissedCandidateIds.size > 0 && (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {dismissedCandidateIds.size} dismissed this run
                </span>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {discovery.warnings.map((warning) => (
                <div key={warning} className="support-note px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                  {warning}
                </div>
              ))}
            </div>

            {visibleCandidates.length === 0 ? (
              <div className="support-note mt-5 px-4 py-4 text-sm text-[var(--color-text-secondary)]">
                {discovery.candidates.length === 0
                  ? "No matching opportunities were returned by the current public feeds. That does not mean none exist."
                  : "All candidates from this discovery run are dismissed."}
              </div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {visibleCandidates.map((candidate) => {
                  const approved = approvedCandidateIds.has(candidate.id);
                  const alreadyMonitored = Boolean(candidate.duplicateCompanyId) || approved;
                  return (
                    <article key={candidate.id} className="panel panel-muted rounded-2xl p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="metric-label">Opportunity</div>
                          <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                            {candidate.opportunityTitle}
                          </h3>
                          <p className="mt-1 text-sm font-semibold text-[var(--color-text-secondary)]">
                            {candidate.employerName}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="surface-link-button rounded-xl p-2 text-[var(--color-text-muted)]"
                          onClick={() => dismissCandidate(candidate.id)}
                          aria-label={`Dismiss ${candidate.opportunityTitle} at ${candidate.employerName}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
                        <span className="soft-badge">{candidate.location}</span>
                        {candidate.employmentType && (
                          <span className="soft-badge">{candidate.employmentType}</span>
                        )}
                        <span className="soft-badge soft-badge-info">Found via {candidate.providerName}</span>
                      </div>

                      <p className="mt-4 text-sm leading-6 text-[var(--color-text-secondary)]">
                        {candidate.summary}
                      </p>

                      <div className="mt-4 rounded-xl border border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-text-secondary)]">
                        {candidate.sourceUrl ? (
                          <>
                            <div className="font-semibold text-[var(--color-text-primary)]">
                              Monitorable employer source found
                            </div>
                            <div className="mt-1">
                              Job Ranger can monitor this employer through an existing supported source path. Approval is still required.
                            </div>
                            {candidate.sourceLabel && (
                              <div className="mt-1 text-[var(--color-text-muted)]">
                                Diagnostic: {candidate.sourceLabel}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-[var(--color-text-primary)]">
                              Opportunity only
                            </div>
                            <div className="mt-1">
                              The discovery provider did not expose a reliable employer source that Job Ranger can monitor yet.
                            </div>
                          </>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void getDesktopApi().openExternal(candidate.opportunityUrl)}
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open opportunity
                        </button>

                        {candidate.sourceUrl && (
                          alreadyMonitored ? (
                            <span className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--color-success)]">
                              <CheckCircle2 className="h-4 w-4" />
                              {approved ? "Approved for monitoring" : "Already monitored"}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => void approveSource(candidate)}
                              disabled={!candidate.canMonitor || approvingId === candidate.id}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {approvingId === candidate.id ? "Approving..." : "Approve & monitor source"}
                            </button>
                          )
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <article className="metric-card">
          <p className="metric-label">Monitored sources</p>
          <p className="metric-value">{companies.length}</p>
          <p className="metric-detail">Sources you explicitly approved or added</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Runnable now</p>
          <p className="metric-value">{runnableCount}</p>
          <p className="metric-detail">Sources with a working acquisition path</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Needs browser</p>
          <p className="metric-value">{browserRequiredCount}</p>
          <p className="metric-detail">Known sources that need browser-backed extraction</p>
        </article>
      </section>

      <div className="table-shell mt-8">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="px-6 py-4 text-left">Source</th>
              <th className="px-6 py-4 text-left">Support</th>
              <th className="px-6 py-4 text-left">Cadence</th>
              <th className="px-6 py-4 text-left">Last run</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-[var(--color-text-secondary)]">
                  No monitored sources yet. Run discovery above or add one manually.
                </td>
              </tr>
            )}
            {companies.map((company) => {
              const profile = getSourceProfile(company.sourceType);
              const canRun = canRunSourceType(company.sourceType);
              const runnableHere = isRunnableInRuntime(runtimeKind, company.sourceType);
              const badgeClass = SUPPORT_BADGE_CLASSES[profile.supportLevel] ?? "soft-badge-danger";

              return (
                <tr key={company.id}>
                  <td className="px-6 py-5 align-top">
                    <div className="flex items-start gap-3">
                      <div className="brand-mark flex h-11 w-11 items-center justify-center rounded-2xl">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-[var(--color-text-primary)]">{company.name}</p>
                        <button
                          type="button"
                          onClick={() => void getDesktopApi().openExternal(company.url)}
                          className="surface-link surface-link-button mt-1 block max-w-xs truncate text-left text-sm"
                        >
                          {company.url}
                        </button>
                        <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">{profile.summary}</p>
                        {company.lastErrorMessage && (
                          <p className="mt-2 max-w-md text-sm text-[var(--color-danger)]">{company.lastErrorMessage}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5 align-top">
                    <span className={`soft-badge ${badgeClass}`}>{profile.label}</span>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                      {canRun
                        ? `${profile.extractionMode} extraction available`
                        : profile.supportLevel === "browser-required"
                          ? "Browser-backed extraction required"
                          : "No reliable acquisition path yet"}
                    </p>
                    {canRun && !runnableHere && (
                      <p className="mt-1 text-sm text-[var(--color-warning)]" data-testid="web-source-limit">
                        Needs the Windows app: this site cannot be read from a browser tab.
                      </p>
                    )}
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      {company.isActive ? "Scheduled locally" : "Paused"}
                    </p>
                  </td>
                  <td className="px-6 py-5 align-top text-sm text-[var(--color-text-secondary)]">
                    Every {company.frequencyMinutes >= 60 ? `${company.frequencyMinutes / 60} hour(s)` : `${company.frequencyMinutes} min`}
                  </td>
                  <td className="px-6 py-5 align-top text-sm text-[var(--color-text-secondary)]">
                    {company.lastRunAt
                      ? `${company.lastRunStatus} ${formatDistanceToNow(new Date(company.lastRunAt), {
                          addSuffix: true,
                        })}`
                      : "Never run"}
                  </td>
                  <td className="px-6 py-5 align-top">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={!canRun || runningId === company.id || refreshing}
                        onClick={() => void handleRun(company.id)}
                        className="secondary-button disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Play className="h-4 w-4" />
                        {runningId === company.id ? "Running" : "Run"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargetId(company.id)}
                        aria-label={`Remove source ${company.name}`}
                        className="danger-button"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="support-note mt-6 px-4 py-3 text-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-primary)]" />
          <p>
            Discovery and monitoring are separate on purpose. A provider can show you an opportunity without Job Ranger trusting that provider or silently adding anything to your monitored sources.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteCompany(deleteTarget.id);
          setDeleteTargetId(null);
        }}
        title="Remove job source?"
        message={`Remove "${deleteTarget?.name ?? "this source"}" and its saved jobs and scrape history? This is permanent and may affect tracked opportunities. Review carefully before continuing.`}
        confirmLabel="Remove source"
      />
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add job source">
        <CompanyForm
          onSubmit={async (draft) => {
            await addCompany(draft);
            setModalOpen(false);
          }}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </Layout>
  );
}
