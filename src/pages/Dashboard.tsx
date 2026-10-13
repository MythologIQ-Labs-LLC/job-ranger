import {
  Activity,
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  ChevronDown,
  Compass,
  Database,
  FileText,
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

  // The strongest action is driven only by known, observed source/job data.
  // A loading workspace must not claim that the queue is empty.
  const nextAction = loading
    ? { label: "Explore your career", href: "/career-profile", note: "Your workspace is loading." }
    : newJobs > 0
      ? { label: `Review ${newJobs} new job${newJobs === 1 ? "" : "s"}`, href: "/jobs", note: "New listings are ready for your judgment." }
      : companies.length === 0
        ? { label: "Add your first job source", href: "/companies", note: "Start with employers and roles that matter to you." }
        : { label: "Review job sources", href: "/companies", note: "No unseen listings are currently reported." };

  const journey = [
    { number: "01", title: "Know your direction", description: "Shape the work you want to pursue.", href: "/career-profile", icon: Compass },
    { number: "02", title: "Find promising work", description: "Review opportunities, not just listings.", href: "/jobs", icon: Briefcase },
    { number: "03", title: "Ground your evidence", description: "Keep claims traceable to real experience.", href: "/career-evidence/new", icon: ShieldCheck },
    { number: "04", title: "Track what happens", description: "Stay deliberate about each application.", href: "/applications", icon: FileText },
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

      <section className="panel panel-strong dashboard-hero overflow-hidden px-6 py-7 sm:px-8" aria-labelledby="dashboard-heading">
        <div className="relative z-10 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.65fr)] lg:items-center">
          <div className="min-w-0">
            <span className="alpha-pill">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Your career workspace
            </span>
            <h1 id="dashboard-heading" className="page-title mt-4">Make the next career move count.</h1>
            <p className="page-copy">
              Choose a direction, find work worth considering, and build every application on evidence you can stand behind.
              Your decisions stay yours.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link to={nextAction.href} className="primary-button min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-primary)]">
                {nextAction.label}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/target-tracks" className="secondary-button min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-primary)]">
                Explore target tracks
              </Link>
            </div>
          </div>
          <div className="dashboard-hero-note min-w-0">
            <p className="dashboard-hero-note-label">Your next useful action</p>
            <p className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">{nextAction.label}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{nextAction.note}</p>
            <p className="mt-4 border-t border-divider pt-3 text-xs leading-5 text-[var(--color-text-muted)]">
              Job Ranger supports your judgment. It does not automatically apply or treat inferred experience as fact.
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="support-note mt-6 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}


      <section className="mt-7" aria-labelledby="dashboard-journey-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="story-kicker">Your path</p>
            <h2 id="dashboard-journey-heading" className="mt-1 text-2xl font-semibold">One decision at a time</h2>
          </div>
          <p className="max-w-md text-sm text-[var(--color-text-secondary)]">
            These are places to work, not completion scores. Start where you need to.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {journey.map((step) => (
            <li key={step.number} className="min-w-0">
              <Link to={step.href} className="dashboard-step group flex h-full items-start gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                <span className="dashboard-step-index" aria-hidden="true">{step.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold leading-5 text-[var(--color-text-primary)]">{step.title}</span>
                    <step.icon className="h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[var(--color-text-secondary)]">{step.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)]">
                    Open workspace
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8" aria-labelledby="dashboard-activity-heading">
        <div className="mb-4">
          <p className="story-kicker">Observed activity</p>
          <h2 id="dashboard-activity-heading" className="mt-1 text-2xl font-semibold">Search at a glance</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.name} className="metric-card animate-rise">
            <div className="flex items-center justify-between">
              <p className="metric-label">{item.name}</p>
              <item.icon className="h-5 w-5 text-[var(--color-primary)]" />
            </div>
            <p className="metric-value">{item.stat}</p>
            <p className="metric-detail">{item.detail}</p>
          </div>
        ))}
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-3" aria-label="Recommended actions">
        {stories.map((story) => (
          <article key={story.kicker} className="story-card animate-rise">
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

      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-[1.15fr_0.85fr]">
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

        <section className="space-y-5" aria-label="Workspace integrity and diagnostics">
          <div className="story-card">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[var(--color-success)]" />
              <h2 className="text-xl font-semibold">Product promises</h2>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--color-text-secondary)]">
              <li>Job listings are observations. Source limitations remain visible.</li>
              <li>Qualifications and resume claims need supporting Career Evidence.</li>
              <li>Applications remain deliberate decisions, not automated submissions.</li>
            </ul>
          </div>
          <details className="dashboard-diagnostics story-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
              <span className="inline-flex items-center gap-3">
                <Database className="h-5 w-5 text-[var(--color-primary)]" aria-hidden="true" />
                Local diagnostics
              </span>
              <ChevronDown className="dashboard-diagnostics-chevron h-4 w-4 text-[var(--color-text-secondary)]" aria-hidden="true" />
            </summary>
            <dl className="mt-4 space-y-3 border-t border-divider pt-4 text-sm text-[var(--color-text-secondary)]">
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Platform</dt>
                <dd>{systemStatus?.platform ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">SQLite binary</dt>
                <dd className="break-all font-mono text-xs">{systemStatus?.sqliteBinaryPath ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Database location</dt>
                <dd className="break-all font-mono text-xs">{systemStatus?.databasePath ?? "Loading..."}</dd>
              </div>
            </dl>
          </details>
        </section>
      </div>
    </Layout>
  );
}
