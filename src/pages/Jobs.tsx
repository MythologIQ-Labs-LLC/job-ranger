import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
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

  const hasActiveFilters = Boolean(searchTerm.trim() || locationTerm.trim() || companyFilter !== "all");
  const clearFilters = () => {
    setSearchTerm("");
    setLocationTerm("");
    setCompanyFilter("all");
  };

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

  const handlePrepareResume = async (job: (typeof jobs)[number]) => {
    setTrackError(null);
    try {
      await trackJob(job);
      navigate(`/resume?job=${encodeURIComponent(job.id)}`);
    } catch (error) {
      setTrackError(
        error instanceof Error
          ? error.message
          : "Unable to start resume preparation",
      );
    }
  };

  return (
    <Layout>
      <section className="jobs-hero panel panel-strong px-6 py-7 sm:px-8" aria-labelledby="jobs-title">
        <span className="alpha-pill">
          <Sparkles className="h-3.5 w-3.5" />
          Find Jobs
        </span>
        <h1 id="jobs-title" className="page-title mt-4">
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

      <section className="jobs-filter-panel panel panel-muted mt-6 p-4 sm:p-5" aria-label="Refine job listings">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Refine your search</h2>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Filters narrow visible listings. The target track changes assessment context, not which jobs appear.
            </p>
          </div>
          {hasActiveFilters && (
            <button type="button" className="secondary-button" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="jobs-filter-field relative block min-w-0">
            <span className="sr-only">Search job title or description</span>
            <Search aria-hidden="true" className="jobs-filter-icon pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search title or description"
              className="jobs-filter-control input-shell"
            />
          </label>
          <label className="jobs-filter-field relative block min-w-0">
            <span className="sr-only">Filter by location</span>
            <MapPin aria-hidden="true" className="jobs-filter-icon pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={locationTerm}
              onChange={(event) => setLocationTerm(event.target.value)}
              placeholder="Filter by location"
              className="jobs-filter-control input-shell"
            />
          </label>
          <label className="jobs-filter-field relative block min-w-0">
            <span className="sr-only">Filter by company</span>
            <Building2 aria-hidden="true" className="jobs-filter-icon pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <select
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              className="jobs-filter-control select-shell"
            >
              <option value="all">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-filter-field relative block min-w-0">
            <span className="sr-only">Assessment target track</span>
            <Target aria-hidden="true" className="jobs-filter-icon pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <select
              value={selectedTargetTrackId}
              onChange={(event) => setSelectedTargetTrackId(event.target.value)}
              className="jobs-filter-control select-shell"
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
          </label>
        </div>
      </section>

      <section className="jobs-results mt-8" aria-label="Job search results">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Opportunity listings</h2>
          <p role="status" className="text-sm text-[var(--color-text-secondary)]">
            {loading ? "Loading jobs..." : `Showing ${filteredJobs.length} of ${jobs.length} locally collected ${jobs.length === 1 ? "job" : "jobs"}`}
          </p>
        </div>
        <div className="space-y-4">
          {filteredJobs.length === 0 && (
            <div className="jobs-empty panel panel-strong px-5 py-9 text-center sm:px-6">
              <Search className="mx-auto h-7 w-7 text-[var(--color-primary)]" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-semibold">
                {loading ? "Loading jobs..." : jobs.length === 0 ? "No collected jobs yet." : "No jobs match these filters."}
              </h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)]">
                {loading
                  ? "The local job list is being loaded."
                  : jobs.length === 0
                    ? "Add a careers-page source and run a collection before reviewing listings."
                    : "Try widening your search terms, location, or company filter. Existing listings have not been removed."}
              </p>
              {!loading && jobs.length === 0 && (
                <button type="button" className="primary-button mt-5" onClick={() => navigate("/companies")}>
                  Add a job source <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
              {!loading && jobs.length > 0 && hasActiveFilters && (
                <button type="button" className="secondary-button mt-5" onClick={clearFilters}>
                  Show all collected jobs
                </button>
              )}
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
              className="jobs-opportunity-card panel panel-strong p-5 sm:p-6"
              data-source-completeness={job.sourceCompleteness}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedTargetTrack && (
                      <span className="soft-badge">
                        <Target className="h-3.5 w-3.5" />
                        {selectedTargetTrack.name}
                      </span>
                    )}
                    {job.isNew && (
                      <span className="soft-badge soft-badge-warning">New</span>
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
                  <h3 className="mt-3 text-xl font-semibold">
                    <button
                      type="button"
                      onClick={() => void getDesktopApi().openExternal(job.url)}
                      className="jobs-opportunity-title surface-link-button inline-flex items-start gap-2 text-left text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
                    >
                      <span className="min-w-0">{job.title}</span>
                      <ExternalLink aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
                    </button>
                  </h3>
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

                <div className="jobs-opportunity-actions flex min-w-0 flex-wrap items-center gap-2">
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

              <p className="mt-4 text-sm leading-6 text-[var(--color-text-secondary)]">
                {job.descriptionSnippet}
              </p>

              {selectedTargetTrack && (
                <JobEvidenceCoveragePanel
                  job={job}
                  targetTrack={selectedTargetTrack}
                  onPrepareResume={() => void handlePrepareResume(job)}
                />
              )}

              <div className="jobs-source-meta border-divider mt-4 flex flex-wrap items-center gap-4 border-t pt-4 text-xs text-[var(--color-text-muted)]">
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
            </article>
          );
        })}
        </div>
      </section>
    </Layout>
  );
}
