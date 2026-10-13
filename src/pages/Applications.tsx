import { useCallback, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker } from "react-router-dom";
import { ArrowRight, ExternalLink, FileText, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ApplicationInsightsPanel } from "../components/ApplicationInsightsPanel";
import { ApplicationLifecyclePanel } from "../components/ApplicationLifecyclePanel";
import { ApplicationMaterialsPanel } from "../components/ApplicationMaterialsPanel";
import { ApplicationNotesEditor } from "../components/ApplicationNotesEditor";
import { ApplicationStatusEditor } from "../components/ApplicationStatusEditor";
import { InterviewPrepPanel } from "../components/InterviewPrepPanel";
import { Layout } from "../components/Layout";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useApplications } from "../career/storage";
import { getDesktopApi } from "../services/api";

export function Applications() {
  const { applications, update, remove, loading, error } = useApplications();
  const [deleteApplicationId, setDeleteApplicationId] = useState<string | null>(null);
  const deleteApplication = applications.find((item) => item.id === deleteApplicationId) ?? null;
  const [dirtyFields, setDirtyFields] = useState<Record<string, true>>({});
  const hasUnsavedChanges = Object.keys(dirtyFields).length > 0;
  const leavingRef = useRef(false);

  const markDirty = useCallback((id: string, field: "status" | "notes", dirty: boolean) => {
    const key = id + ":" + field;
    setDirtyFields((current) => {
      if (Boolean(current[key]) === dirty) return current;
      const next = { ...current };
      if (dirty) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);

  // A data-router blocker catches links, browser back/forward and programmatic
  // SPA navigation, not merely clicks within the Sidebar.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname,
  );

  // Hard reload and tab close use the browser's native advisory. Force-quit
  // or sudden power loss cannot be intercepted by client-side navigation.
  useBeforeUnload(useCallback((event) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  }, [hasUnsavedChanges]));


  // Derived only from persisted local statuses; no guessed progression or inference.
  const pipelineStages = [
    { status: "interested", label: "Interested" },
    { status: "applied", label: "Applied" },
    { status: "interview", label: "Interview" },
    { status: "offer", label: "Offer" },
    { status: "rejected", label: "Rejected" },
    { status: "withdrawn", label: "Withdrawn" },
  ] as const;
  const stageCounts = pipelineStages.map((stage) => ({
    ...stage,
    count: applications.filter((application) => application.status === stage.status).length,
  }));

  return (
    <Layout>
      <section className="applications-hero panel panel-strong px-6 py-7 sm:px-8" aria-labelledby="applications-title">
        <span className="alpha-pill">
          <FileText className="h-3.5 w-3.5" />
          Your job search
        </span>
        <h1 id="applications-title" className="page-title mt-4">Keep track of what happens after a job looks promising.</h1>
        <p className="page-copy">
          Save a listing from Find Jobs, then move it through the real process: interested, applied, interview, offer, or closed. Contacts, milestones, reminders, exact submitted resumes, factual application materials, grounded interview preparation, target-track context, and offer details stay attached to the application on this device.
        </p>
      </section>

      {error && (
        <section className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">
          {error}
        </section>
      )}

      {!loading && applications.length > 0 && (
        <section className="applications-pipeline mt-6" aria-labelledby="applications-pipeline-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="story-kicker">At a glance</p>
              <h2 id="applications-pipeline-title" className="mt-1 text-xl font-semibold">Application pipeline</h2>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {applications.length} tracked {applications.length === 1 ? "application" : "applications"}
            </p>
          </div>
          <ul className="applications-stage-grid mt-4">
            {stageCounts.map((stage) => (
              <li key={stage.status} className="applications-stage" data-status={stage.status}>
                <span className="applications-stage-label">{stage.label}</span>
                <span className="applications-stage-count">{stage.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            These are locally recorded statuses. Job Ranger does not submit applications for you.
          </p>
        </section>
      )}

      <section className="applications-workspace mt-8 space-y-4" aria-label="Tracked applications">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Tracked applications</h2>
          <Link to="/jobs" className="applications-find-link inline-flex items-center gap-2 text-sm font-semibold">
            Find jobs <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        {loading && (
          <div role="status" className="panel panel-strong px-6 py-12 text-center text-sm text-[var(--color-text-secondary)]">
            Loading your applications...
          </div>
        )}

        {!loading && applications.length === 0 && (
          <div className="applications-empty panel panel-strong px-6 py-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-[var(--color-primary)]" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">No applications tracked yet.</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)]">
              Open Find Jobs and choose Track this job on anything you want to keep. It will appear here without submitting anything on your behalf.
            </p>
            <Link to="/jobs" className="primary-button mt-5 inline-flex items-center gap-2">
              Find jobs to track <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}

        {applications.map((application) => (
          <article key={application.id} className="applications-card panel panel-strong p-5 sm:p-6" data-status={application.status}>
            <div className="applications-card-header flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="story-kicker">Tracked opportunity</p>
                <h3 className="mt-2 text-xl font-semibold">
                  <button
                    type="button"
                    onClick={() => void getDesktopApi().openExternal(application.url)}
                    className="applications-card-title surface-link-button inline-flex items-start gap-2 text-left text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
                  >
                    <span className="min-w-0">{application.title}</span>
                    <ExternalLink className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </h3>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{application.companyName}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Added {formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
                </p>
              </div>

              <div className="applications-card-actions flex flex-wrap items-start gap-3">
                <ApplicationStatusEditor
                  application={application}
                  onSave={(status) => update(application.id, { status })}
                  onDirtyChange={(dirty) => markDirty(application.id, "status", dirty)}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDeleteApplicationId(application.id)}
                  aria-label={`Remove ${application.title} from applications`}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </div>

            <ApplicationNotesEditor
              application={application}
              onSave={(notes) => update(application.id, { notes })}
              onDirtyChange={(dirty) => markDirty(application.id, "notes", dirty)}
            />

            <ApplicationLifecyclePanel applicationId={application.id} />
            <ApplicationInsightsPanel applicationId={application.id} />
            <ApplicationMaterialsPanel applicationId={application.id} />
            <div className="mt-4">
              <InterviewPrepPanel applicationId={application.id} />
            </div>
          </article>
        ))}
      </section>
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onClose={() => {
          if (!leavingRef.current && blocker.state === "blocked") blocker.reset();
          leavingRef.current = false;
        }}
        onConfirm={() => {
          if (blocker.state !== "blocked") return;
          leavingRef.current = true;
          blocker.proceed();
        }}
        title="Leave with unsaved changes?"
        message={hasUnsavedChanges
          ? "Your application has notes or a status selection that the local database has not confirmed. Leaving may discard those changes. Stay here to retry the save, or explicitly leave without saving."
          : "The pending changes are now saved. You can continue navigating or stay on this page."}
        confirmLabel={hasUnsavedChanges ? "Leave without saving" : "Continue navigation"}
        cancelLabel="Stay on this page"
        variant="warning"
      />
      <ConfirmDialog
        open={Boolean(deleteApplication)}
        onClose={() => setDeleteApplicationId(null)}
        onConfirm={async () => {
          if (!deleteApplication) throw new Error("The selected application is no longer available.");
          await remove(deleteApplication.id);
          setDirtyFields((current) => {
            const next = { ...current };
            delete next[deleteApplication.id + ":status"];
            delete next[deleteApplication.id + ":notes"];
            return next;
          });
          setDeleteApplicationId(null);
        }}
        title="Remove tracked application?"
        message={`Remove "${deleteApplication?.title ?? "this application"}" at "${deleteApplication?.companyName ?? "this organization"}" from your tracked job search? This also removes the locally recorded application context, including its notes and associated contacts and milestones. This cannot be undone.`}
        confirmLabel="Remove application"
      />
    </Layout>
  );
}
