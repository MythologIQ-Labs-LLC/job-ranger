import {
  Activity,
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  Database,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Layout } from "../components/Layout";
import { useAppContext } from "../context/AppContext";
import { canRunSourceType, getSourceProfile } from "../types";

function formatSourceCoverageMessage(
  browserRequired: number,
  manualReview: number,
): string {
  if (browserRequired > 0) {
    const plural = browserRequired === 1 ? " still needs" : "s still need";
    return `${browserRequired} source${plural} browser-backed automation.`;
  }
  if (manualReview > 0) {
    const plural = manualReview === 1 ? " needs" : "s need";
    return `${manualReview} source${plural} a dedicated adapter or manual review path.`;
  }
  return "Everything in your source list currently has a runnable extraction path.";
}

export function Dashboard() {
  const { companies, jobs, scrapeRuns, systemStatus, loading, error } = useAppContext();

  const activeJobs = jobs.filter((job) => job.isActive).length;
  const newJobs = jobs.filter((job) => job.isNew).length;
  const runnableCompanies = companies.filter((company) => canRunSourceType(company.sourceType));
  const browserRequiredCompanies = companies.filter(
    (company) => company.sourceType === "browser-required",
  ).length;
  const manualReviewCompanies = companies.filter(
    (company) => getSourceProfile(company.sourceType).supportLevel === "manual-review",
  ).length;
  const failedScrapes = companies.filter((company) => company.lastRunStatus === "failure").length;

  const stories = [
    {
      kicker: "Morning review",
      title: newJobs > 0 ? `${newJobs} fresh jobs are ready for review` : "No unseen jobs right now",
      copy:
        newJobs > 0
          ? "Start in Find Jobs, acknowledge anything relevant, and use filters to tighten the next pass."
          : companies.length === 0
            ? "Your queue is clear. Add a source you care about so Job Ranger has somewhere useful to look."
            : "Your queue is clear. This is a good moment to review the sources you are tracking or add another one.",
      action: newJobs > 0 ? "Review new jobs" : companies.length === 0 ? "Add a job source" : "Review job sources",
      href: newJobs > 0 ? "/jobs" : "/companies",
    },
    {
      kicker: "Source coverage",
      title:
        companies.length === 0
          ? "Add your first careers page"
          : `${runnableCompanies.length} source${runnableCompanies.length === 1 ? "" : "s"} can run right now`,
      copy:
        companies.length === 0
          ? "Job Ranger can detect broader ATS families and generic careers pages. Start with the sources you actually care about."
          : formatSourceCoverageMessage(browserRequiredCompanies, manualReviewCompanies),
      action: companies.length === 0 ? "Add a job source" : "Manage job sources",
      href: "/companies",
    },
    {
      kicker: "Signal quality",
      title:
        scrapeRuns.length > 0
          ? `${scrapeRuns[0]?.jobsMatchedCount ?? 0} jobs matched your latest rules`
          : "Filters become useful after your first scrape",
      copy:
        scrapeRuns.length > 0
          ? "Use Filters to make the next scrape quieter and more relevant, especially if the latest run found too much noise."
          : "A simple title-plus-keyword rule is usually enough to turn a noisy board into a focused review deck.",
      action: scrapeRuns.length > 0 ? "Tune filters" : "Set up filters",
      href: "/filters",
    },
  ];

  const stats = [
    {
      name: "Active jobs",
      stat: activeJobs,
      detail: `${newJobs} new`,
      icon: Briefcase,
    },
    {
      name: "Tracked companies",
      stat: companies.length,
      detail: `${runnableCompanies.length} runnable`,
      icon: Building2,
    },
    {
      name: "Recent scrape runs",
      stat: scrapeRuns.length,
      detail: `${failedScrapes} failing`,
      icon: Activity,
    },
    {
      name: "Needs new adapters",
      stat: browserRequiredCompanies + manualReviewCompanies,
      detail: `${browserRequiredCompanies} browser-backed`,
      icon: AlertCircle,
    },
  ];

  return (
    <Layout>
      <section className="dashboard-hero panel panel-strong overflow-hidden px-6 py-7 sm:px-8" aria-labelledby="dashboard-title">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="alpha-pill">
              <Sparkles className="h-3.5 w-3.5" />
              Local workspace
            </span>
            <h1 id="dashboard-title" className="page-title mt-4">Build a calmer review ritual around the jobs you actually want.</h1>
            <p className="page-copy">
              Job Ranger keeps the search grounded: detect the source family, run the best available extraction path, and surface when a portal still needs a dedicated or browser-backed adapter.
            </p>
          </div>
          <div className="dashboard-hero-status panel panel-muted max-w-md rounded-[1.4rem] px-5 py-4">
            <p className="metric-label">Local backend</p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              SQLite persisted at <span className="block break-all font-mono text-xs">{systemStatus?.databasePath ?? "Loading..."}</span>
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="support-note mt-6 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <section className="dashboard-metrics mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Job search overview">
        {stats.map((item) => (
          <div key={item.name} className="metric-card dashboard-metric animate-rise">
            <div className="flex items-center justify-between">
              <p className="metric-label">{item.name}</p>
              <item.icon className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <p className="metric-value">{item.stat}</p>
            <p className="metric-detail">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="dashboard-actions mt-8 grid grid-cols-1 gap-5 xl:grid-cols-3" aria-label="Recommended next steps">
        {stories.map((story) => (
          <article key={story.kicker} className="story-card dashboard-action-card animate-rise">
            <p className="story-kicker">{story.kicker}</p>
            <h2 className="story-title">{story.title}</h2>
            <p className="story-copy">{story.copy}</p>
            <Link
              to={story.href}
              className="mt-5 inline-flex items-center gap-2 rounded-md text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]"
            >
              {story.action}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </article>
        ))}
      </section>

      <div className="dashboard-detail mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="panel panel-strong overflow-hidden">
          <div className="border-b border-divider px-6 py-5">
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Recent runs</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              The most recent scrape activity, with honest status and filter match counts.
            </p>
          </div>
          <div className="divide-divider">
            {scrapeRuns.length === 0 && (
              <div className="px-6 py-10 text-sm text-[var(--color-text-secondary)]">
                {loading
                  ? "Loading recent activity..."
                  : "No scrape runs yet. Add a company careers page and run a scrape to create your first review loop."}
              </div>
            )}
            {scrapeRuns.map((run) => {
              const company = companies.find((candidate) => candidate.id === run.companyId);
              return (
                <div key={run.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div>
                    <p className="font-semibold text-[var(--color-text-primary)]">{company?.name ?? "Unknown company"}</p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      Started {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                    </p>
                    {run.errorMessage && (
                      <p className="mt-2 text-sm text-[var(--color-danger)]">{run.errorMessage}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span
                      className={`soft-badge ${
                        run.status === "success"
                          ? "soft-badge-success"
                          : run.status === "unsupported"
                            ? "soft-badge-warning"
                            : "soft-badge-danger"
                      }`}
                    >
                      {run.status}
                    </span>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{run.jobsFoundCount} jobs found</p>
                    <p className="text-sm text-[var(--color-text-muted)]">{run.jobsMatchedCount} matched filters</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-5">
          <div className="story-card">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-xl font-semibold">Ground truth</h2>
            </div>
            <dl className="mt-4 space-y-3 text-sm text-[var(--color-text-secondary)]">
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Platform</dt>
                <dd>{systemStatus?.platform ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">SQLite binary</dt>
                <dd className="break-all">{systemStatus?.sqliteBinaryPath ?? "Loading..."}</dd>
              </div>
            </dl>
          </div>

          <div className="story-card">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--color-success)]" />
              <h2 className="text-xl font-semibold">Product promises</h2>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-[var(--color-text-secondary)]">
              <li>What you see here is persisted locally and survives restarts.</li>
              <li>Job Ranger detects a wider range of ATS families and generic careers pages.</li>
              <li>When a page still needs a dedicated or browser-backed adapter, it stays explicit.</li>
            </ul>
          </div>
        </section>
      </div>
    </Layout>
  );
}
