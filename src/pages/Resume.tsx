import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  FileDown,
  FileText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ResumeTailoringPanel } from "../components/ResumeTailoringPanel";
import { DemoListingBadge } from "../components/DemoListingNotice";
import { isDemoListing } from "../shared/demo-listing";
import { useCareerProfile } from "../career/storage";
import { getDesktopApi } from "../services/api";
import { useRuntimeInfo } from "../services/runtime";
import type {
  CandidateEvidenceReviewItem,
  TrackedApplication,
} from "../shared/contracts";
import type {
  ResumeArtifactRecord,
  ResumeContactSnapshot,
  ResumeCreateInput,
  ResumeProjectionDetail,
  ResumeProjectionRecord,
  ResumeTemplateId,
  ResumeVersionDiff,
} from "../shared/resume-contracts";

const emptyContact: ResumeContactSnapshot = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  links: [],
};

function confirmed(item: CandidateEvidenceReviewItem): boolean {
  return (
    item.evidence.verificationState === "user-confirmed" ||
    item.evidence.verificationState === "user-authored"
  );
}

function artifactGateLabel(artifact: ResumeArtifactRecord): string {
  try {
    const parsed = artifact.parseabilityResult
      ? (JSON.parse(artifact.parseabilityResult) as { passed?: boolean })
      : null;
    return parsed?.passed ? "Passed" : "Needs review";
  } catch {
    return "Recorded";
  }
}

export function Resume() {
  const revealLabel = useRuntimeInfo()?.capabilities.revealInFileManager === false ? "Download file" : "Show file";
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const { profile } = useCareerProfile();
  const [evidence, setEvidence] = useState<CandidateEvidenceReviewItem[]>([]);
  const [projections, setProjections] = useState<ResumeProjectionRecord[]>([]);
  const [applications, setApplications] = useState<TrackedApplication[]>([]);
  const [active, setActive] = useState<ResumeProjectionDetail | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contact, setContact] = useState<ResumeContactSnapshot>(emptyContact);
  const [templateId, setTemplateId] = useState<ResumeTemplateId>("ats-standard-v1");
  const [context, setContext] = useState<ResumeCreateInput["context"]>("private-sector");
  const [pageFormat, setPageFormat] = useState<ResumeCreateInput["pageFormat"]>("letter");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ResumeVersionDiff | null>(null);

  const confirmedEvidence = useMemo(() => evidence.filter(confirmed), [evidence]);
  const application = useMemo(
    () => applications.find((item) => item.jobId === jobId) ?? null,
    [applications, jobId],
  );

  const load = useCallback(async () => {
    try {
      const api = getDesktopApi();
      const [nextEvidence, nextProjections, nextApplications] = await Promise.all([
        api.career.listEvidence(),
        api.resume.list(),
        api.applications.list(),
      ]);
      setEvidence(nextEvidence);
      setProjections(nextProjections);
      setApplications(nextApplications);

      const usable = nextEvidence.filter(confirmed).map((item) => item.evidence.id);
      if (jobId) {
        const coverage = await api.jobs.getEvidenceCoverage(jobId);
        const targeted = Array.from(
          new Set(
            coverage.items
              .filter(
                (item) =>
                  item.evidence &&
                  (item.mapping.classification === "direct" ||
                    item.mapping.classification === "transferable"),
              )
              .map((item) => item.evidence!.id)
              .filter((id) => usable.includes(id)),
          ),
        );
        setSelectedIds(targeted.length > 0 ? targeted : usable);
      } else {
        setSelectedIds(usable);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load resume workspace");
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setContact((current) => ({
      ...current,
      fullName: current.fullName || profile.fullName,
      location: current.location || profile.homeLocation,
    }));
  }, [profile.fullName, profile.homeLocation]);

  const openProjection = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setActive(await getDesktopApi().resume.get(id));
      setDiff(null);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open resume draft");
    } finally {
      setBusy(false);
    }
  };

  const createProjection = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const detail = await getDesktopApi().resume.create({
        jobId,
        context,
        pageFormat,
        templateId,
        contact,
        selectedEvidenceIds: selectedIds,
      });
      setActive(detail);
      setProjections(await getDesktopApi().resume.list());
      setMessage("Resume draft created from confirmed Career Evidence.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create resume draft");
    } finally {
      setBusy(false);
    }
  };

  const updateStatement = async (id: string, text: string) => {
    if (!active) return;
    try {
      const updated = await getDesktopApi().resume.updateStatement(id, { text });
      setActive((current) =>
        current
          ? {
              ...current,
              statements: current.statements.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      setActive(await getDesktopApi().resume.get(active.projection.id));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update resume statement");
    }
  };

  const handleTailored = async (detail: ResumeProjectionDetail) => {
    setActive(detail);
    setDiff(null);
    setError(null);
    setProjections(await getDesktopApi().resume.list());
  };

  const exportPdf = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await getDesktopApi().resume.exportPdf({
        projectionId: active.projection.id,
        applicationId: application?.id ?? null,
        purpose: application ? "submitted" : undefined,
      });
      if (!result.artifact) {
        const critical = result.parseabilityGate?.issues
          .filter((issue) => issue.severity === "critical")
          .map((issue) => issue.message)
          .join(" ");
        setError(critical || "The exported PDF did not pass the Parseability Gate.");
      } else {
        setMessage(
          application
            ? `PDF v${result.artifact.version} passed the gates and was linked to this application.`
            : `PDF v${result.artifact.version} passed the gates and was saved locally.`,
        );
        setActive(await getDesktopApi().resume.get(active.projection.id));
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export resume PDF");
    } finally {
      setBusy(false);
    }
  };

  const compareLatest = async () => {
    if (!active || active.artifacts.length < 2) return;
    const [latest, previous] = active.artifacts;
    setDiff(await getDesktopApi().resume.compareVersions(previous.id, latest.id));
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill">
          <FileText className="h-3.5 w-3.5" /> Resume
        </span>
        <h1 className="page-title mt-4">Build the document from facts you have actually confirmed.</h1>
        <p className="page-copy">
          Job Ranger creates deterministic, ATS-safe resume drafts from Career Evidence. No AI provider is required, and unsupported claims block export.
        </p>
        {jobId && (
          <p className="mt-3 text-sm font-semibold text-[var(--color-primary)]">
            Targeting tracked job {jobId}. Evidence mapped as direct or transferable is preselected where available.
          </p>
        )}
        {application && isDemoListing(application.url) && (
          <div className="mt-2">
            <DemoListingBadge url={application.url} />
          </div>
        )}
      </section>

      {(error || message) && (
        <section className={`support-note mt-6 px-5 py-4 text-sm ${error ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
          {error ?? message}
        </section>
      )}

      <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <div className="panel panel-strong p-6">
            <h2 className="text-xl font-semibold">New resume draft</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Contact details are snapshotted into this resume version. They do not become Career Evidence.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label><span className="metric-label">Name</span><input className="input-shell mt-2" value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} /></label>
              <label><span className="metric-label">Location</span><input className="input-shell mt-2" value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} /></label>
              <label><span className="metric-label">Email</span><input className="input-shell mt-2" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
              <label><span className="metric-label">Phone</span><input className="input-shell mt-2" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></label>
            </div>
            <label className="mt-4 block">
              <span className="metric-label">Links</span>
              <input className="input-shell mt-2" value={contact.links.join(", ")} onChange={(e) => setContact({ ...contact, links: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Portfolio, LinkedIn, GitHub, or other relevant links" />
            </label>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label><span className="metric-label">Format</span><select className="select-shell mt-2" value={context} onChange={(e) => setContext(e.target.value as ResumeCreateInput["context"])}><option value="private-sector">Private sector</option><option value="hybrid">Hybrid / career change</option><option value="federal">Federal</option><option value="academic">Academic CV</option></select></label>
              <label><span className="metric-label">Template</span><select className="select-shell mt-2" value={templateId} onChange={(e) => setTemplateId(e.target.value as ResumeTemplateId)}><option value="ats-standard-v1">ATS-safe standard</option><option value="ats-compact-v1">ATS-safe compact</option></select></label>
              <label><span className="metric-label">Page size</span><select className="select-shell mt-2" value={pageFormat} onChange={(e) => setPageFormat(e.target.value as ResumeCreateInput["pageFormat"])}><option value="letter">Letter</option><option value="a4">A4</option></select></label>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Confirmed Career Evidence</h3>
                <span className="text-xs text-[var(--color-text-muted)]">{selectedIds.length} selected</span>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                {confirmedEvidence.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">Confirm Career Evidence in Career Profile before creating a resume.</p>
                ) : confirmedEvidence.map((item) => (
                  <label key={item.evidence.id} className="panel panel-muted flex gap-3 rounded-2xl p-3 text-sm">
                    <input type="checkbox" checked={selectedIds.includes(item.evidence.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.evidence.id] : current.filter((id) => id !== item.evidence.id))} />
                    <span><strong>{item.evidence.subjectType}</strong><span className="mt-1 block text-[var(--color-text-secondary)]">{item.evidence.statement}</span></span>
                  </label>
                ))}
              </div>
            </div>

            <button type="button" className="primary-button mt-5" disabled={busy || selectedIds.length === 0} onClick={() => void createProjection()}>
              <ShieldCheck className="h-4 w-4" /> Create truthful draft
            </button>
          </div>

          <div className="panel panel-strong p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Saved drafts</h2><button type="button" className="secondary-button" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</button></div>
            <div className="mt-4 space-y-2">
              {projections.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No resume drafts yet.</p> : projections.map((projection) => (
                <button key={projection.id} type="button" className="panel panel-muted w-full rounded-2xl p-4 text-left" onClick={() => void openProjection(projection.id)}>
                  <span className="font-semibold">{projection.templateId === "ats-compact-v1" ? "ATS-safe compact" : "ATS-safe standard"}</span>
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{projection.context} · {projection.status} · {projection.selectedEvidenceIds.length} evidence item{projection.selectedEvidenceIds.length === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="panel panel-strong p-6 sm:p-8">
          {!active ? (
            <div className="py-14 text-center"><FileText className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" /><h2 className="mt-4 text-xl font-semibold">Open or create a resume draft</h2><p className="mt-2 text-sm text-[var(--color-text-secondary)]">Drafts stay structured until they pass truth and parseability checks.</p></div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><h2 className="text-2xl font-semibold">{active.projection.contact.fullName}</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{active.projection.templateId} · {active.projection.context}</p></div>
                <span className={`soft-badge ${active.truthGate.passed ? "soft-badge-success" : "soft-badge-danger"}`}>{active.truthGate.passed ? "Truth Gate passed" : `${active.truthGate.issues.length} truth issue${active.truthGate.issues.length === 1 ? "" : "s"}`}</span>
              </div>

              {!active.truthGate.passed && <div className="support-note mt-4 px-4 py-3 text-sm text-[var(--color-danger)]">{active.truthGate.issues.map((issue) => issue.message).join(" ")}</div>}

              {jobId && (
                <ResumeTailoringPanel
                  source={active}
                  jobId={jobId}
                  onApplied={(detail) => void handleTailored(detail)}
                  onMessage={(next) => {
                    setMessage(next);
                    setError(null);
                  }}
                  onError={(next) => {
                    setError(next);
                    setMessage(null);
                  }}
                />
              )}

              <div className="mt-6 space-y-6">
                {active.projection.sections.map((section) => (
                  <section key={section}><h3 className="border-divider border-b pb-2 text-sm font-bold uppercase tracking-wide">{section}</h3><div className="mt-3 space-y-3">{active.statements.filter((statement) => statement.section === section).map((statement) => (
                    <textarea key={statement.id} className="input-shell min-h-24 resize-y py-3" defaultValue={statement.text} onBlur={(event) => { if (event.target.value !== statement.text) void updateStatement(statement.id, event.target.value); }} />
                  ))}</div></section>
                ))}
              </div>

              <div className="border-divider mt-7 flex flex-wrap items-center gap-3 border-t pt-5">
                <button type="button" className="primary-button" disabled={busy || !active.truthGate.passed} onClick={() => void exportPdf()}><FileDown className="h-4 w-4" /> Export verified PDF</button>
                {active.artifacts.length >= 2 && <button type="button" className="secondary-button" onClick={() => void compareLatest()}>Compare latest versions</button>}
              </div>

              {active.artifacts.length > 0 && <div className="mt-6"><h3 className="font-semibold">Exported versions</h3><div className="mt-3 space-y-2">{active.artifacts.map((artifact) => (
                <div key={artifact.id} className="panel panel-muted flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 text-sm"><div><strong>PDF v{artifact.version}</strong><span className="ml-2 text-[var(--color-text-muted)]">{artifact.pageCount ?? "?"} page{artifact.pageCount === 1 ? "" : "s"} · {artifactGateLabel(artifact)}</span></div><button type="button" className="surface-link-button font-semibold text-[var(--color-primary)]" onClick={() => void getDesktopApi().showItemInFolder(artifact.managedPath)}>{revealLabel}</button></div>
              ))}</div></div>}

              {diff && <div className="support-note mt-5 px-4 py-3 text-sm text-[var(--color-text-secondary)]"><p className="font-semibold text-[var(--color-text-primary)]">Latest version difference</p><p className="mt-2">{diff.addedStatements.length} added · {diff.removedStatements.length} removed · {diff.unchangedStatements.length} unchanged</p></div>}

              {application && <div className="support-note mt-5 flex items-start gap-3 px-4 py-3 text-sm text-[var(--color-text-secondary)]"><CheckCircle2 className="mt-0.5 h-4 w-4 text-[var(--color-success)]" /><div><p>Exports from this targeted workspace are linked to the tracked application for <strong>{application.title}</strong>.</p>{isDemoListing(application.url) && <div className="mt-2"><DemoListingBadge url={application.url} /></div>}</div></div>}
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}
