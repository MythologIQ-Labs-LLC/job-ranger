import {
  Activity,
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  BookOpenText,
  ClipboardList,
  Compass,
  Database,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Layout } from "../components/Layout";
import { useAppContext } from "../context/AppContext";
import { useCareerEvidence } from "../career/evidence";
import { useTargetTracks } from "../career/target-tracks";
import { useApplications } from "../career/storage";
import { canRunSourceType, getSourceProfile } from "../types";
import { useRuntimeInfoStatus } from "../services/runtime";
import { isRunnableInRuntime, WEB_RUNNABLE_SOURCE_TYPES } from "../shared/runtime";

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
  const { companies, jobs, scrapeRuns, systemStatus, loading, loaded, error } = useAppContext();
  // Source and job facts exist only once the workspace has been read; a failed or pending read
  // must never look like an empty workspace.
  const workspaceUnavailable = !loading && !loaded;
  // This pilot only reads existing canonical data. Every domain retains its current owner.
  const evidence = useCareerEvidence();
  const targetTracks = useTargetTracks();
  const applications = useApplications();

  const activeJobs = jobs.filter((job) => job.isActive).length;
  const newJobs = jobs.filter((job) => job.isNew).length;
  // Which source types can run depends on the runtime, which is known shortly after mount.
  const runtime = useRuntimeInfoStatus();
  const runtimeKind = runtime.info?.kind;
  // Settled once the runtime is known or could not be read; source steps never wait forever.
  const runtimeSettled = runtime.info !== null || runtime.failed;
  const readableHere = (sourceType: (typeof companies)[number]["sourceType"]) =>
    runtime.info !== null && canRunSourceType(sourceType) && isRunnableInRuntime(runtimeKind, sourceType);
  const runnableCompanies = companies.filter((company) => readableHere(company.sourceType));
  const browserRequiredCompanies = companies.filter(
    (company) => company.sourceType === "browser-required",
  ).length;
  const manualReviewCompanies = companies.filter(
    (company) => getSourceProfile(company.sourceType).supportLevel === "manual-review",
  ).length;
  const failedScrapes = companies.filter((company) => company.lastRunStatus === "failure").length;
  // Paused sources keep their last result; only active sources need attention.
  const failingActiveSources = companies.filter(
    (company) => company.isActive && company.lastRunStatus === "failure",
  ).length;
  // Scannable here: active and readable in this runtime (the web app reads fewer source types
  // than the desktop harness). Paused sources can still be run once by hand.
  const scannableSources = companies.filter((company) => company.isActive && readableHere(company.sourceType)).length;
  const pausedReadableSources = companies.filter(
    (company) => !company.isActive && readableHere(company.sourceType),
  ).length;
  const activeUnreadableSources = companies.filter(
    (company) => company.isActive && !readableHere(company.sourceType),
  ).length;
  const activeTracks = targetTracks.tracks.filter((track) => track.isActive);
  const pendingFacts = evidence.pending.length;
  const trackedApplications = applications.applications.length;
  type NextAction = { title: string; copy: string; href: string; action: string; icon: LucideIcon };
  const nextActions: NextAction[] = [];

  // An imported statement is a proposal, never a verified career fact.
  if (!evidence.loading && !evidence.error && pendingFacts > 0) {
    nextActions.push({
      title: `${pendingFacts} imported career ${pendingFacts === 1 ? "statement" : "statements"} to review`,
      copy: "Check each proposed fact against its source before confirming it.",
      href: "/career-profile",
      action: "Review proposed evidence",
      icon: BookOpenText,
    });
  }

  if (!targetTracks.loading && !targetTracks.error && activeTracks.length === 0) {
    nextActions.push({
      title: "Choose a career direction",
      copy: "You can start with a goal without completing a resume or career history.",
      href: "/target-tracks",
      action: "Create a target track",
      icon: Compass,
    });
  }

  if (loaded && newJobs > 0) {
    nextActions.push({
      title: `${newJobs} unseen ${newJobs === 1 ? "opportunity" : "opportunities"} to assess`,
      copy: "Compare eligibility, evidence, career direction, preferences, and unknowns before deciding.",
      href: "/jobs",
      action: "Review opportunities",
      icon: Search,
    });
  }

  if (loaded && failingActiveSources > 0) {
    nextActions.push({
      title: `${failingActiveSources} ${failingActiveSources === 1 ? "source" : "sources"} failed on the last scan`,
      copy: "Open the source to see the recorded error before relying on its listings.",
      href: "/companies",
      action: "Check job sources",
      icon: AlertCircle,
    });
  }

  if (loaded && companies.length === 0) {
    nextActions.push({
      title: "Add an opportunity source",
      copy: "Choose a careers page to monitor when you are ready to discover opportunities.",
      href: "/companies",
      action: "Manage sources",
      icon: Building2,
    });
  }

  // With sources and nothing unseen, the useful step is a fresh scan (or fixing the sources
  // when none can be scanned), not "nothing to do". Scans run from the Companies page; Find Jobs
  // only shows what scans captured.
  if (loaded && runtimeSettled && companies.length > 0 && newJobs === 0 && failingActiveSources === 0) {
    const webReadable = WEB_RUNNABLE_SOURCE_TYPES.map((type) => getSourceProfile(type).label).join(", ");
    nextActions.push(
      runtime.info === null
        ? {
            title: "Check your job sources",
            copy: "Open the Companies page and run a source to look for new listings.",
            href: "/companies",
            action: "Review job sources",
            icon: Building2,
          }
        : scannableSources > 0
        ? {
            title: "No unseen opportunities right now",
            copy: "Run a source on the Companies page to look for new listings. Listings you have already seen stay in Find Jobs.",
            href: "/companies",
            action: "Run a job source",
            icon: Search,
          }
        : pausedReadableSources > 0
          ? {
              title: activeUnreadableSources > 0 ? "Your active sources cannot be read here" : "Your job sources are paused",
              copy:
                activeUnreadableSources > 0
                  ? "Resume a paused source this app can read, or run it once on the Companies page."
                  : "Resume a source to have it checked on its schedule, or run it once on the Companies page.",
              href: "/companies",
              action: "Review job sources",
              icon: Building2,
            }
          : {
              title: "None of your sources can be read here",
              copy:
                runtimeKind === "web"
                  ? `The web app reads careers pages hosted on ${webReadable}. Add one of those to look for listings.`
                  : "They need a reader this app does not have. Add another careers page to look for listings.",
              href: "/companies",
              action: "Review job sources",
              icon: Building2,
            },
    );
  }

  // Applications are a place to go, never a suggested step on their own: a recorded status
  // does not mean anything is due.
  const applicationsEntry: NextAction | null =
    !applications.loading && !applications.error && trackedApplications > 0
      ? {
          title: "Your applications",
          copy: "Update a status or add notes when something actually changes.",
          href: "/applications",
          action: "Open applications",
          icon: ClipboardList,
        }
      : null;

  // One dominant next step; the rest stay available but secondary.
  const [primaryAction, ...laterActions] = nextActions;
  const otherActions = applicationsEntry ? [...laterActions, applicationsEntry] : laterActions;

  // Places to work, in the order most people use them. Never a progress or completion state.
  const workflow = [
    { title: "Set your direction", copy: "Target Tracks describe the roles and conditions you want.", href: "/target-tracks", icon: Compass },
    { title: "Find opportunities", copy: "Review captured listings against your target track and confirmed evidence.", href: "/jobs", icon: Search },
    { title: "Back it with evidence", copy: "Confirmed Career Evidence is what truthful resumes are built from.", href: "/career-evidence/new", icon: BookOpenText },
    { title: "Track applications", copy: "Record where you applied and what actually happened.", href: "/applications", icon: ClipboardList },
  ];

  const careerLoading = evidence.loading || targetTracks.loading || applications.loading;
  const careerErrors = [
    evidence.error && `Career Evidence: ${evidence.error}`,
    targetTracks.error && `Target Tracks: ${targetTracks.error}`,
    applications.error && `Applications: ${applications.error}`,
  ].filter((value): value is string => Boolean(value));


  const stories = [
    {
      kicker: "Source coverage",
      title:
        !loaded
          ? workspaceUnavailable ? "Job sources could not be loaded" : "Loading your job sources"
          : companies.length === 0
          ? "Add your first careers page"
          : runtime.info === null
          ? runtime.failed ? "Could not check which sources can run here" : "Checking which sources can run here"
          : `${runnableCompanies.length} source${runnableCompanies.length === 1 ? "" : "s"} can run right now`,
      copy:
        !loaded
          ? "Source coverage appears once your saved sources load."
          : companies.length === 0
          ? "Job Ranger can detect broader ATS families and generic careers pages. Start with the sources you actually care about."
          : formatSourceCoverageMessage(browserRequiredCompanies, manualReviewCompanies),
      action: loaded && companies.length === 0 ? "Add a job source" : "Manage job sources",
      href: "/companies",
    },
    {
      kicker: "Signal quality",
      title:
        !loaded
          ? workspaceUnavailable ? "Recent scan results could not be loaded" : "Loading recent scan results"
          : scrapeRuns.length > 0
          ? `${scrapeRuns[0]?.jobsMatchedCount ?? 0} jobs matched your latest rules`
          : "Filters become useful after your first scrape",
      copy:
        !loaded
          ? "Filter guidance appears once your recent scans load."
          : scrapeRuns.length > 0
          ? "Use Filters to make the next scrape quieter and more relevant, especially if the latest run found too much noise."
          : "A simple title-plus-keyword rule is usually enough to turn a noisy board into a focused review deck.",
      action: loaded && scrapeRuns.length === 0 ? "Set up filters" : "Tune filters",
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
      detail: runtime.info === null ? "Runnable sources not checked yet" : `${runnableCompanies.length} runnable`,
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
      {/* Same intro shell as every other page, so the #248 compaction rules apply on constrained viewports. */}
      <section className="panel panel-strong home-hero px-6 py-7 sm:px-8">
        <span className="alpha-pill">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Your local career workspace
        </span>
        <h1 className="page-title mt-4">Your next steps</h1>
        <p className="page-copy">
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
        <section aria-labelledby="home-actions-title" className="panel panel-strong home-action-panel px-5 py-5 sm:px-7">
          <h2 id="home-actions-title" className="text-xl font-semibold">Needs your attention</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Based on saved records, not predictions or activity quotas.
          </p>
          {(loading && !loaded) || careerLoading || (loaded && !runtimeSettled && nextActions.length === 0) ? (
            <p role="status" className="mt-5 text-sm text-[var(--color-text-secondary)]">
              Loading your next steps...
            </p>
          ) : nextActions.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--color-text-secondary)]">
              Available next steps cannot be fully determined until your records load.
            </p>
          ) : (
            <>
              <div className="home-primary-action mt-4" data-testid="home-primary-action">
                <span className="home-action-icon" aria-hidden="true">
                  <primaryAction.icon className="h-5 w-5" strokeWidth={1.85} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="metric-label">Suggested next step</p>
                  <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{primaryAction.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{primaryAction.copy}</p>
                  <Link to={primaryAction.href} className="primary-button mt-4 inline-flex min-h-11 items-center gap-2">
                    {primaryAction.action}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
              {otherActions.length > 0 && (
                <>
                  <p id="home-other-actions-title" className="metric-label mt-6">Other things you can do</p>
                  <ul aria-labelledby="home-other-actions-title" className="home-action-list mt-2" data-testid="home-other-actions">
                    {otherActions.map((item) => (
                      <li key={`${item.href}:${item.action}`} className="home-action-row">
                        <span className="home-action-icon" aria-hidden="true">
                          <item.icon className="h-5 w-5" strokeWidth={1.85} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{item.title}</h3>
                          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{item.copy}</p>
                          <Link
                            to={item.href}
                            className="home-action-link mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]"
                          >
                            {item.action}
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
        <section aria-labelledby="home-progress-title" className="panel panel-strong home-progress-panel px-5 py-5 sm:px-7">
          <h2 id="home-progress-title" className="text-xl font-semibold">Your career search</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Recorded activity is context, not a measure of your worth or effort.
          </p>
          <dl className="home-progress-list mt-4 space-y-3">
            <div className="home-progress-row">
              <dt className="metric-label">Active career directions</dt>
              <dd className="mt-1 text-lg font-semibold">{targetTracks.loading || targetTracks.error ? "Unavailable" : activeTracks.length}</dd>
              <dd><Link to="/target-tracks" className="text-sm font-semibold text-[var(--color-primary)] hover:underline">Manage target tracks</Link></dd>
            </div>
            <div className="home-progress-row">
              <dt className="metric-label">Confirmed career facts</dt>
              <dd className="mt-1 text-lg font-semibold">{evidence.loading || evidence.error ? "Unavailable" : evidence.confirmed.length}</dd>
            </div>
            <div className="home-progress-row">
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

      <section aria-labelledby="home-workflow-title" className="panel panel-strong home-workflow mt-6 px-5 py-5 sm:px-7">
        <h2 id="home-workflow-title" className="text-xl font-semibold">How the pieces fit</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Places to work, in any order. This is not a checklist or a score.
        </p>
        <ul className="home-workflow-list mt-4">
          {workflow.map((step) => (
            <li key={step.href} className="home-workflow-step">
              <Link to={step.href} className="home-workflow-link">
                <span className="home-action-icon" aria-hidden="true">
                  <step.icon className="h-5 w-5" strokeWidth={1.85} />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-[var(--color-text-primary)]">{step.title}</span>
                  <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{step.copy}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

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
            <p className="metric-value">{loaded ? item.stat : workspaceUnavailable ? "—" : "…"}</p>
            <p className="metric-detail">{loaded ? item.detail : workspaceUnavailable ? "Unavailable" : "Loading"}</p>
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
                {!loaded
                  ? workspaceUnavailable ? "Recent activity could not be loaded." : "Loading recent activity..."
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
                <dd>{systemStatus?.platform ?? (workspaceUnavailable ? "Unavailable" : "Loading...")}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">SQLite binary</dt>
                <dd className="break-all">{systemStatus?.sqliteBinaryPath ?? (workspaceUnavailable ? "Unavailable" : "Loading...")}</dd>
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
