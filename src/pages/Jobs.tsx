import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Filter,
  MapPin,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Layout } from "../components/Layout";
import { JobEvidenceCoveragePanel } from "../components/JobEvidenceCoverage";
import { DemoListingBadge, DemoListingLinkMessage, openListingUrl } from "../components/DemoListingNotice";
import { useAppContext } from "../context/AppContext";
import { getDesktopApi } from "../services/api";
import type { CareerTargetTrack } from "../shared/contracts";
import { trackJob } from "../career/storage";

export function Jobs() {
  const { jobs, companies, markJobAsSeen, loading } = useAppContext();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [locationTerm, setLocationTerm] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [targetTracks, setTargetTracks] = useState<CareerTargetTrack[]>([]);
  const [selectedTargetTrackId, setSelectedTargetTrackId] = useState("");
  const [targetTracksLoading, setTargetTracksLoading] = useState(true);
  const [targetTrackError, setTargetTrackError] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  // Fictional demo listings have no real posting; opening one explains that instead.
  const [demoLinkJobId, setDemoLinkJobId] = useState<string | null>(null);
  // Presentation-only choice: neither filter/matching rules nor stored data changes.
  const [listingView, setListingView] = useState<"compact" | "detailed">("compact");

  useEffect(() => {
    let cancelled = false;
    setTargetTracksLoading(true);
    setTargetTrackError(null);

    void getDesktopApi()
      .career.listTargetTracks()
      .then((tracks) => {
        if (cancelled) return;
        const active = tracks.filter((track) => track.isActive);
        setTargetTracks(active);
        setSelectedTargetTrackId((current) =>
          current && active.some((track) => track.id === current)
            ? current
            : (active[0]?.id ?? ""),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setTargetTrackError(
          error instanceof Error ? error.message : "Unable to load target tracks",
        );
      })
      .finally(() => {
        if (!cancelled) setTargetTracksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTargetTrack = useMemo(
    () => targetTracks.find((track) => track.id === selectedTargetTrackId) ?? null,
    [selectedTargetTrackId, targetTracks],
  );

  const filteredJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        const query = searchTerm.trim().toLowerCase();
        const location = locationTerm.trim().toLowerCase();

        const matchesSearch =
          !query ||
          job.title.toLowerCase().includes(query) ||
          job.descriptionSnippet.toLowerCase().includes(query);
        const matchesLocation = !location || job.location.toLowerCase().includes(location);
        const matchesCompany = companyFilter === "all" || job.companyId === companyFilter;

        return matchesSearch && matchesLocation && matchesCompany;
      })
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );
  }, [jobs, searchTerm, locationTerm, companyFilter]);

  const handleTrackJob = async (job: (typeof jobs)[number]) => {
    setTrackError(null);
    try {
      await trackJob(job);
      navigate("/applications");
    } catch (error) {
      setTrackError(
        error instanceof Error ? error.message : "Unable to track this job",
      );
    }
  };

  // Errors propagate to the assessment drawer, which is the only visible layer while open.
  const handlePrepareResume = async (job: (typeof jobs)[number]) => {
    setTrackError(null);
    await trackJob(job);
    navigate(`/resume?job=${encodeURIComponent(job.id)}`);
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill">
          <Sparkles className="h-3.5 w-3.5" />
          Find Jobs
        </span>
        <h1 className="page-title mt-4">
          Spend your time on the jobs that look worth it.
        </h1>
        <p className="page-copy">
          Job Ranger compares each listing with the target track you choose and the Career Evidence you have actually confirmed. Eligibility, evidence coverage, career direction, preferences, blockers, and unknowns stay separate instead of being collapsed into a pretend hiring probability.
        </p>
      </section>

      {!targetTracksLoading && targetTracks.length === 0 && (
        <section className="support-note mt-6 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-[var(--color-text-primary)]">
              Add a target track to assess opportunities.
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              A target track describes what you want and what you require. Career Evidence remains the factual record of what you can prove.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => navigate("/target-tracks")}
          >
            Set up target tracks
          </button>
        </section>
      )}

      {(trackError || targetTrackError) && (
        <section className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">
          {trackError ?? targetTrackError}
        </section>
      )}

      <section className="panel panel-muted mt-6 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--color-text-secondary)]">Keywords</span>
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search title or description"
                className="input-shell pl-11"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--color-text-secondary)]">Location</span>
            <span className="relative block">
              <MapPin aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={locationTerm}
                onChange={(event) => setLocationTerm(event.target.value)}
                placeholder="Filter by location"
                className="input-shell pl-11"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--color-text-secondary)]">Company</span>
            <span className="relative block">
              <Building2 aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <select
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              className="select-shell pl-11"
            >
              <option value="all">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--color-text-secondary)]">Assessment direction</span>
            <span className="relative block">
              <Target aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <select
              value={selectedTargetTrackId}
              onChange={(event) => setSelectedTargetTrackId(event.target.value)}
              className="select-shell pl-11"
              disabled={targetTracksLoading || targetTracks.length === 0}
            >
              {targetTracksLoading && <option value="">Loading target tracks...</option>}
              {!targetTracksLoading && targetTracks.length === 0 && (
                <option value="">No active target track</option>
              )}
              {targetTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
            </span>
          </label>
        </div>
      </section>

      <section aria-label="Listing display preferences" className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p role="status" className="text-sm text-[var(--color-text-secondary)]">
            Showing {filteredJobs.length} of {jobs.length} captured listings
          </p>
          {searchTerm.trim() && listingView === "compact" && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Search terms may appear inside a collapsed listing description.
            </p>
          )}
        </div>
        <div role="group" aria-label="Listing layout" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={listingView === "compact"}
            onClick={() => setListingView("compact")}
            className={listingView === "compact" ? "primary-button" : "secondary-button"}
          >
            Compact
          </button>
          <button
            type="button"
            aria-pressed={listingView === "detailed"}
            onClick={() => setListingView("detailed")}
            className={listingView === "detailed" ? "primary-button" : "secondary-button"}
          >
            Detailed
          </button>
        </div>
      </section>

      <div className="mt-4 space-y-3">
        {filteredJobs.length === 0 && (
          <div className="panel panel-strong px-6 py-12 text-center text-sm text-[var(--color-text-secondary)]">
            {loading
              ? "Loading jobs..."
              : "No jobs match the current filters. Try widening the search or run another company scan."}
          </div>
        )}

        {filteredJobs.map((job) => {
          const company = companies.find(
            (candidate) => candidate.id === job.companyId,
          );
          const companyName = company?.name ?? "Unknown company";

          return (
            <article
              key={job.id}
              className="panel panel-strong px-4 py-4 sm:px-6 sm:py-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <DemoListingBadge url={job.url} />
                    {selectedTargetTrack && (
                      <span className="soft-badge">
                        <Target className="h-3.5 w-3.5" />
                        {selectedTargetTrack.name}
                      </span>
                    )}
                    {job.isNew && (
                      <span className="soft-badge soft-badge-warning">New</span>
                    )}
                    {!job.isActive && (
                      <span className="soft-badge soft-badge-danger" title="The most recent source check marked this listing inactive.">
                        Inactive on source
                      </span>
                    )}
                    <span
                      className={`soft-badge ${job.sourceCompleteness === "full" ? "soft-badge-success" : "soft-badge-warning"}`}
                      title={job.sourceCompleteness === "full"
                        ? "Assessment can use the preserved source description captured for this listing."
                        : "The source did not provide a complete preserved description. Missing requirements remain unknown."}
                    >
                      {job.sourceCompleteness === "full"
                        ? "Full source text"
                        : job.sourceCompleteness === "partial"
                          ? "Partial source text"
                          : "Listing-only source"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openListingUrl(job.url, () => setDemoLinkJobId(job.id))}
                    className="surface-link-button mt-3 inline-flex items-center gap-2 text-xl font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
                  >
                    {job.title}
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  {demoLinkJobId === job.id && <DemoListingLinkMessage />}
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[var(--color-text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-[var(--color-text-muted)]" />
                      {companyName}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />
                      {job.location || "Location not provided"}
                    </span>
                    {job.salaryText && <span>{job.salaryText}</span>}
                    {job.matchedFilterCount > 0 && (
                      <span className="soft-badge soft-badge-success">
                        <Filter className="h-3.5 w-3.5" />
                        {job.matchedFilterCount} saved filter
                        {job.matchedFilterCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {job.isNew && (
                    <button
                      type="button"
                      onClick={() => void markJobAsSeen(job.id)}
                      className="secondary-button"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mark seen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleTrackJob(job)}
                    className="primary-button"
                  >
                    Track this job
                  </button>
                </div>
              </div>

              {selectedTargetTrack && (
                <JobEvidenceCoveragePanel
                  job={job}
                  targetTrack={selectedTargetTrack}
                  onPrepareResume={() => handlePrepareResume(job)}
                />
              )}

              <details
                key={`${job.id}:${listingView}`}
                open={listingView === "detailed"}
                className="border-divider mt-4 border-t pt-3"
              >
                <summary className="cursor-pointer rounded-md py-2 text-sm font-semibold text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                  Listing description and source history
                </summary>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {job.descriptionSnippet}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
                  <span>
                    First seen{" "}
                    {formatDistanceToNow(new Date(job.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                  <span>
                    Last seen{" "}
                    {formatDistanceToNow(new Date(job.lastSeenAt), {
                      addSuffix: true,
                    })}
                  </span>
                  <span>
                    {job.isActive
                      ? "Still active on source"
                      : "Marked inactive on source"}
                  </span>
                  {selectedTargetTrack && (
                    <span>
                      Assessment uses {selectedTargetTrack.name} + confirmed Career Evidence
                      {job.currentSourceSnapshotId ? " + preserved source snapshot" : ""}
                    </span>
                  )}
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </Layout>
  );
}
