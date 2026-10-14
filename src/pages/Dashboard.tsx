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
import { useCareerEvidence } from "../career/evidence";
import { useTargetTracks } from "../career/target-tracks";
import { useApplications } from "../career/storage";
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
  // This pilot only reads existing canonical data. Every domain retains its current owner.
  const evidence = useCareerEvidence();
  const targetTracks = useTargetTracks();
  const applications = useApplications();

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
  const activeTracks = targetTracks.tracks.filter((track) => track.isActive);
  const pendingFacts = evidence.pending.length;
  const trackedApplications = applications.applications.length;
  type NextAction = { title: string; copy: string; href: string; action: string };
  const nextActions: NextAction[] = [];

  // An imported statement is a proposal, never a verified career fact.
  if (!evidence.loading && !evidence.error && pendingFacts > 0) {
    nextActions.push({
      title: `${pendingFacts} imported career ${pendingFacts === 1 ? "statement" : "statements"} to review`,
      copy: "Check each proposed fact against its source before confirming it.",
      href: "/career-profile",
      action: "Review proposed evidence",
    });
  }

  if (!targetTracks.loading && !targetTracks.error && activeTracks.length === 0) {
    nextActions.push({
      title: "Choose a career direction",
      copy: "You can start with a goal without completing a resume or career history.",
      href: "/target-tracks",
      action: "Create a target track",
    });
  }

  if (!loading && newJobs > 0) {
    nextActions.push({
      title: `${newJobs} unseen ${newJobs === 1 ? "opportunity" : "opportunities"} to assess`,
      copy: "Compare eligibility, evidence, career direction, preferences, and unknowns before deciding.",
      href: "/jobs",
      action: "Review opportunities",
    });
  }

  if (!loading && companies.length === 0) {
    nextActions.push({
      title: "Add an opportunity source",
      copy: "Choose a careers page to monitor when you are ready to discover opportunities.",
      href: "/companies",
      action: "Manage sources",
    });
  }

  const careerLoading = evidence.loading || targetTracks.loading || applications.loading;
  const careerErrors = [
    evidence.error && `Career Evidence: ${evidence.error}`,
    targetTracks.error && `Target Tracks: ${targetTracks.error}`,
    applications.error && `Applications: ${applications.error}`,
  ].filter((value): value is string => Boolean(value));


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
      <section className="panel panel-strong px-5 py-5 sm:px-7">
        <span className="alpha-pill">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Your local career workspace
        </span>
        <h1 className="page-title mt-3">Your next steps</h1>
        <p className="page-copy mt-2">
          Start with a decision that matters to you. Your career evidence, applications and search activity
          remain separate records, and nothing here changes them automatically.
        </p>
      </section>

      {error && (
        <div className="support-note mt-6 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {careerErrors.length > 0 && (
        <div role="alert" className="support-note mt-4 px-4 py-3 text-sm text-[var(--color-danger)]">
          Some career records could not be loaded. Their next steps are not shown until available:
          <ul className="mt-2 list-disc pl-5">
            {careerErrors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(245px,0.75fr)]">
        <section aria-labelledby="home-actions-title" className="panel panel-strong px-5 py-5 sm:px-7">
          <h2 id="home-actions-title" className="text-xl font-semibold">Needs your attention</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Based on saved records, not predictions or activity quotas.
          </p>
          {loading || careerLoading ? (
            <p role="status" className="mt-5 text-sm text-[var(--color-text-secondary)]">
              Loading your next steps...
            </p>
          ) : nextActions.length === 0 && careerErrors.length === 0 && !error ? (
            <p className="mt-5 text-sm text-[var(--color-text-secondary)]">
              Nothing is waiting for review. You can explore other career directions or check your applications.
            </p>
          ) : nextActions.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--color-text-secondary)]">
              Available next steps cannot be fully determined until your records load.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--color-border)]">
              {nextActions.map((item) => (
                <li key={item.href} className="py-4 first:pt-0">
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{item.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.copy}</p>
                  <Link
                    to={item.href}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]"
                  >
                    {item.action}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="home-progress-title" className="panel panel-strong px-5 py-5 sm:px-7">
          <h2 id="home-progress-title" className="text-xl font-semibold">Your career search</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Recorded activity is context, not a measure of your worth or effort.
          </p>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="metric-label">Active career directions</dt>
              <dd className="mt-1 text-lg font-semibold">{targetTracks.loading || targetTracks.error ? "Unavailable" : activeTracks.length}</dd>
              <dd><Link to="/target-tracks" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">Manage target tracks</Link></dd>
            </div>
            <div>
              <dt className="metric-label">Confirmed career facts</dt>
              <dd className="mt-1 text-lg font-semibold">{evidence.loading || evidence.error ? "Unavailable" : evidence.confirmed.length}</dd>
            </div>
            <div>
              <dt className="metric-label">Tracked applications</dt>
              <dd className="mt-1 text-lg font-semibold">{applications.loading || applications.error ? "Unavailable" : trackedApplications}</dd>
              <dd><Link to="/applications" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">Open applications</Link></dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            A recorded application status alone never means a follow-up is due.
          </p>
        </section>
      </div>

      <details className="panel panel-strong mt-6 px-5 py-5 sm:px-7">
        <summary className="cursor-pointer text-lg font-semibold text-[var(--color-text-primary)]">
          Search activity and technical diagnostics
        </summary>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Review source coverage, recent scans and local runtime details without making them your first task.
        </p>
        <div className="mt-5">
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      </section>

      <section className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-3">
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
        </div>
      </details>
    </Layout>
  );
}
