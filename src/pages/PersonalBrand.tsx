import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Save, BarChart3, CheckCircle2, AlertTriangle } from "lucide-react";
import { Layout } from "../components/Layout";
import { CareerOutcomeJournal } from "../components/CareerOutcomeJournal";
import { HistoricalLinkedInArchive } from "../components/HistoricalLinkedInArchive";
import { LinkedInObservedDashboard } from "../components/LinkedInObservedDashboard";
import { LinkedInApprovedContentCohorts } from "../components/LinkedInApprovedContentCohorts";
import { LinkedInTopicAttestations } from "../components/LinkedInTopicAttestations";
import { LinkedInTopicCohortSummary } from "../components/LinkedInTopicCohortSummary";
import { getDesktopApi } from "../services/api";
import {
  assessPersonalBrandDraft, derivedPostMetrics,
  type AnalyticsSnapshot, type ManualPostPackage, type ManualPublicationReceipt,
  type PersonalBrandDraft, type MetricName,
} from "../shared/personal-brand";
import type { PersonalBrandDraftInput } from "../shared/personal-brand-api";
import {
  buildPersonalBrandLearningReport, type LearningMetric, type LearningWindowHours,
} from "../shared/personal-brand-learning";
import type { CandidateEvidence } from "../shared/contracts";
import { normalizeLinkedInAnalyticsExport, type LinkedInExportPreview } from "../shared/linkedin-analytics";
import { readLinkedInXlsx } from "../browser/linkedin-xlsx";
import type { SavedLinkedInExport } from "../shared/linkedin-import-ledger";
import { reconcileLinkedInExports, type ReconciledValue } from "../shared/linkedin-reconciliation";
import { matchLinkedInRankedPosts, canonicalLinkedInPostUrl, type RankedPostContentReport } from "../shared/linkedin-post-content";

const baseInput: PersonalBrandDraftInput = {
  body: "",
  objective: "expertise_proof",
  audiences: ["recruiters", "hiring managers"],
  destination: "linkedin",
  format: "text",
  hookArchetype: null,
  hypothesis: "",
  claimChecks: [],
  mediaCount: 0,
  mediaAccessibilityReviewed: true,
};
const objectives = [
  ["recruiter_discovery", "Recruiter discovery"],
  ["expertise_proof", "Demonstrate expertise"],
  ["project_visibility", "Project visibility"],
  ["career_narrative", "Career narrative"],
  ["network_growth", "Network growth"],
  ["community_contribution", "Community contribution"],
  ["job_search_learning", "Job-search learning"],
  ["other", "Other"],
] as const;
const hooks = [
  ["", "Not selected"],
  ["concrete_experience", "Specific experience"],
  ["contradiction", "Contradiction"],
  ["build_proof", "Demonstrated work"],
  ["lesson", "Lesson"],
  ["counterintuitive", "Counterintuitive claim"],
  ["before_after", "Before / after"],
  ["question", "Question"],
  ["other", "Other"],
] as const;
const metricInputs: ReadonlyArray<[MetricName, string]> = [
  ["impressions", "Impressions"],
  ["reached", "Members reached"],
  ["reactions", "Reactions"],
  ["comments", "Comments"],
  ["reposts", "Reposts"],
  ["saves", "Saves"],
  ["sends", "Sends"],
  ["profile_views", "Profile views from post"],
  ["followers_gained", "Followers gained"],
];

function inputFromDraft(draft: PersonalBrandDraft): PersonalBrandDraftInput {
  const { id: _id, revision: _revision, ...input } = draft;
  return input;
}
function formatPercent(n: number | null): string {
  return n === null ? "Unavailable" : `${(n * 100).toFixed(2)}%`;
}
function displayLinkedInMetric(metric: ReconciledValue): string {
  if (metric.state === "conflict") return "Conflicting";
  if (metric.state === "missing") return "Unknown";
  return metric.value!.toLocaleString();
}

export function PersonalBrand() {
  const [drafts, setDrafts] = useState<PersonalBrandDraft[]>([]);
  const [selected, setSelected] = useState<PersonalBrandDraft | null>(null);
  const [input, setInput] = useState<PersonalBrandDraftInput>(baseInput);
  const [dirty, setDirty] = useState(false);
  const [prepared, setPrepared] = useState<ManualPostPackage[]>([]);
  const [publications, setPublications] = useState<ManualPublicationReceipt[]>([]);
  const [postId, setPostId] = useState("");
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [cohortSnapshots, setCohortSnapshots] = useState<Record<string, AnalyticsSnapshot[]>>({});
  const [cohortRevision, setCohortRevision] = useState(0);
  const [topicRevision, setTopicRevision] = useState(0);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [cohortAge, setCohortAge] = useState<LearningWindowHours>(24);
  const [cohortMetric, setCohortMetric] = useState<LearningMetric>("profile_views_per_reached");
  const [metrics, setMetrics] = useState<Partial<Record<MetricName, string>>>({});
  const [metricsSource, setMetricsSource] = useState("LinkedIn post analytics (manual entry)");
  const [linkedinPreview, setLinkedinPreview] = useState<LinkedInExportPreview | null>(null);
  const [linkedinImportError, setLinkedinImportError] = useState<string | null>(null);
  const [linkedinImportBusy, setLinkedinImportBusy] = useState(false);
  const [linkedinSaved, setLinkedinSaved] = useState<SavedLinkedInExport[]>([]);
  const linkedinReconciliation = useMemo(() => reconcileLinkedInExports(linkedinSaved), [linkedinSaved]);
  const [rankedPostLinkReport, setRankedPostLinkReport] = useState<RankedPostContentReport | null>(null);
  const [rankedPostLinkError, setRankedPostLinkError] = useState<string | null>(null);
  const [linkedinReviewed, setLinkedinReviewed] = useState(false);
  const [linkedinDeleteId, setLinkedinDeleteId] = useState("");
  const [linkedinDeleteConfirmed, setLinkedinDeleteConfirmed] = useState(false);
  const [linkedinImportMessage, setLinkedinImportMessage] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [publishedLocal, setPublishedLocal] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [freshPreparedRevision, setFreshPreparedRevision] = useState<string | null>(null);
  const [evidenceRecords, setEvidenceRecords] = useState<CandidateEvidence[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [publishedConfirmed, setPublishedConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const reloadEvidence = useCallback(async (): Promise<void> => {
    // Hide selectable cached copy until it has passed a new backend evidence check.
    setFreshPreparedRevision(null);
    setEvidenceLoading(true);
    try {
      const records = await getDesktopApi().career.listEvidence();
      setEvidenceRecords(records.map((item) => item.evidence));
      setEvidenceError(null);
    } catch (cause) {
      setEvidenceError(cause instanceof Error ? cause.message : "Career Evidence is unavailable.");
      throw cause;
    } finally {
      setEvidenceLoading(false);
    }
  }, []);

  const refresh = useCallback(async (preferredDraftId?: string) => {
    const api = getDesktopApi().personalBrand;
    const [loadedDrafts, loadedPrepared, loadedPublications] = await Promise.all([
      api.listDrafts(), api.listPrepared(), api.listPublications(),
    ]);
    setDrafts(loadedDrafts);
    setPrepared(loadedPrepared);
    setPublications(loadedPublications);
    if (preferredDraftId) {
      const active = loadedDrafts.find((item) => item.id === preferredDraftId);
      if (active) { setSelected(active); setInput(inputFromDraft(active)); setDirty(false); }
    }
    return { loadedDrafts, loadedPublications };
  }, []);

  useEffect(() => {
    let live = true;
    const start = async () => {
      try {
        const { loadedDrafts, loadedPublications } = await refresh();
        if (!live) return;
        if (loadedDrafts.length) {
          setSelected(loadedDrafts[0]);
          setInput(inputFromDraft(loadedDrafts[0]));
        }
        if (loadedPublications.length) setPostId(loadedPublications[0].postId);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Unable to load Personal Brand records.");
      } finally { if (live) setLoading(false); }
    };
    void start();
    return () => { live = false; };
  }, [refresh]);

  useEffect(() => {
    void reloadEvidence().catch(() => undefined);
  }, [reloadEvidence]);

  useEffect(() => {
    if (!postId) { setSnapshots([]); return; }
    let live = true;
    void getDesktopApi().personalBrand.listSnapshots(postId)
      .then((items) => { if (live) setSnapshots(items); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [postId]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      setCohortLoading(true);
      setCohortError(null);
      try {
        const pairs = await Promise.all(publications.map(async (receipt) => [
          receipt.postId, await getDesktopApi().personalBrand.listSnapshots(receipt.postId),
        ] as const));
        if (live) setCohortSnapshots(Object.fromEntries(pairs));
      } catch (cause) {
        if (live) {
          setCohortError(cause instanceof Error ? cause.message : "Unable to load comparable post analytics.");
          setCohortSnapshots({});
        }
      } finally { if (live) setCohortLoading(false); }
    };
    void load();
    return () => { live = false; };
  }, [publications, cohortRevision]);

  useEffect(() => {
    let live = true;
    setRankedPostLinkReport(null);
    setRankedPostLinkError(null);
    void matchLinkedInRankedPosts(linkedinReconciliation, publications, prepared, drafts)
      .then(report => { if (live) setRankedPostLinkReport(report); })
      .catch(cause => {
        if (live) setRankedPostLinkError(
          cause instanceof Error ? cause.message : "Unable to verify LinkedIn ranked post provenance.");
      });
    return () => { live = false; };
  }, [linkedinReconciliation, publications, prepared, drafts]);

  const learning = useMemo(() => buildPersonalBrandLearningReport(
    publications.map((receipt) => ({
      receipt,
      snapshots: cohortSnapshots[receipt.postId] ?? [],
      draft: drafts.find((draft) => draft.id === receipt.draftId),
    })),
    cohortAge, cohortMetric,
  ), [publications, cohortSnapshots, drafts, cohortAge, cohortMetric]);

  const current = useMemo<PersonalBrandDraft>(() => ({
    ...input, id: selected?.id ?? "new-draft", revision: selected?.revision ?? 1,
  }), [input, selected]);
  const readiness = useMemo(() => assessPersonalBrandDraft(current), [current]);
  const evidenceById = useMemo(
    () => new Map(evidenceRecords.map((evidence) => [evidence.id, evidence])),
    [evidenceRecords],
  );
  const eligibleEvidence = useMemo(
    () => evidenceRecords.filter((item) =>
      item.verificationState === "user-authored" || item.verificationState === "user-confirmed"),
    [evidenceRecords],
  );
  const staleEvidenceIds = input.claimChecks.flatMap((claim) => claim.evidenceIds).filter((id) => {
    const item = evidenceById.get(id);
    return !item || (item.verificationState !== "user-authored" && item.verificationState !== "user-confirmed");
  });
  const currentPackage = prepared.find((item) =>
    item.draftId === selected?.id && item.approvedRevision === selected?.revision);
  const currentReceipt = publications.find((item) =>
    item.draftId === selected?.id && item.approvedRevision === selected?.revision);
  const lastSnapshot = snapshots.at(-1);
  const summary = lastSnapshot ? derivedPostMetrics(lastSnapshot) : null;

  const change = <K extends keyof PersonalBrandDraftInput>(key: K, value: PersonalBrandDraftInput[K]) => {
    setInput((before) => ({
      ...before,
      [key]: value,
      // Only a BODY edit resets existing claim attestations. Other updates,
      // especially claimChecks itself, must retain the caller's next value.
      ...(key === "body" ? {
        claimChecks: before.claimChecks.map((claim) =>
          ({ ...claim, verified: false, privacyCleared: false })),
      } : {}),
    }));
    setDirty(true);
    setReviewed(false);
    setFreshPreparedRevision(null);
    setNotice("");
  };
  const updateClaim = (index: number, patch: Partial<PersonalBrandDraftInput["claimChecks"][number]>) => {
    change("claimChecks", input.claimChecks.map((claim, position) =>
      position === index
        ? {
            ...claim,
            ...patch,
            ...(patch.claim !== undefined || patch.evidenceIds !== undefined
              ? { verified: false, privacyCleared: false }
              : {}),
          }
        : claim,
    ));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice("");
    try { await fn(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete this action."); }
    finally { setBusy(false); }
  };
  const save = async (): Promise<PersonalBrandDraft> => {
    if (selected && !dirty) return selected;
    const api = getDesktopApi().personalBrand;
    const saved = selected
      ? await api.updateDraft(selected.id, selected.revision, input)
      : await api.createDraft(input);
    await refresh(saved.id);
    setSelected(saved); setDirty(false);
    return saved;
  };
  const copyPost = () => void run(async () => {
    const saved = !selected || dirty ? await save() : selected;
    await reloadEvidence();
    // The backend checks the CURRENT authority of every linked evidence ID, even
    // for already prepared revisions. A cached copy is never a bypass.
    const pkg = await getDesktopApi().personalBrand.prepareDraft(saved.id, saved.revision, reviewed);
    await refresh(saved.id);
    setFreshPreparedRevision(`${saved.id}:r${saved.revision}`);
    try {
      await navigator.clipboard.writeText(pkg.body);
      setNotice("Approved text copied. Paste it into LinkedIn, then return with the permalink.");
    } catch {
      setNotice("Copy permission was unavailable. Select the post text below and copy it manually.");
    }
  });
  const confirmPost = () => void run(async () => {
    if (!selected || dirty || !currentPackage) throw new Error("Save and prepare the exact version before recording publication.");
    if (!publishedLocal.trim()) throw new Error("Enter the actual publication date and time.");
    const receipt = await getDesktopApi().personalBrand.confirmPublication({
      draftId: selected.id,
      revision: selected.revision,
      publishedUrl: publishedUrl.trim(),
      publishedAt: new Date(publishedLocal).toISOString(),
      userConfirmed: publishedConfirmed,
    });
    await refresh(selected.id);
    setPostId(receipt.postId);
    setPublishedConfirmed(false);
    setNotice("Your publication was recorded as user-confirmed, not independently verified by LinkedIn.");
  });
  const recordMetrics = () => void run(async () => {
    if (!postId) throw new Error("Select a recorded publication.");
    const receipt = publications.find((item) => item.postId === postId);
    if (!receipt) throw new Error("Publication not found.");
    const capturedAt = new Date().toISOString();
    const observations = metricInputs.map(([name]) => {
      const value = metrics[name]?.trim();
      return value === undefined || value === ""
        ? { name, state: "unavailable" as const, limitation: "Not reported in this manual snapshot." }
        : { name, state: "manual" as const, value: Number(value) };
    });
    await getDesktopApi().personalBrand.appendSnapshot(postId, {
      capturedAt,
      windowStart: receipt.publishedAt,
      windowEnd: capturedAt,
      sourceLabel: metricsSource.trim(),
      observations,
    });
    setSnapshots(await getDesktopApi().personalBrand.listSnapshots(postId));
    setCohortRevision((value) => value + 1);
    setMetrics({});
    setNotice("Timestamped analytics saved with manual provenance. Empty fields remain unavailable, not zero.");
  });

  useEffect(() => {
    let live = true;
    void getDesktopApi().personalBrand.listLinkedInImports().then(items => {
      if (live) setLinkedinSaved(items);
    }).catch(cause => {
      if (live) setLinkedinImportError(cause instanceof Error ? cause.message : "Could not load LinkedIn import history.");
    });
    return () => { live = false; };
  }, []);

  const saveLinkedInPreview = async (): Promise<void> => {
    if (!linkedinPreview || !linkedinReviewed || linkedinImportBusy) return;
    setLinkedinImportBusy(true);
    setLinkedinImportError(null);
    setLinkedinImportMessage("");
    try {
      const result = await getDesktopApi().personalBrand.saveLinkedInImport(linkedinPreview, true);
      setLinkedinSaved(await getDesktopApi().personalBrand.listLinkedInImports());
      setLinkedinImportMessage(result.alreadyPresent
        ? "This exact normalized export was already saved. No duplicate records were created."
        : "LinkedIn analytics saved in the local Job Ranger database and included in backups.");
      setLinkedinReviewed(false);
    } catch (cause) {
      setLinkedinImportError(cause instanceof Error ? cause.message : "Could not save LinkedIn analytics.");
    } finally {
      setLinkedinImportBusy(false);
    }
  };
  const deleteLinkedInSaved = async (): Promise<void> => {
    if (!linkedinDeleteId || !linkedinDeleteConfirmed || linkedinImportBusy) return;
    setLinkedinImportBusy(true);
    setLinkedinImportError(null);
    try {
      await getDesktopApi().personalBrand.deleteLinkedInImport(linkedinDeleteId, true);
      setLinkedinSaved(await getDesktopApi().personalBrand.listLinkedInImports());
      setLinkedinDeleteId("");
      setLinkedinDeleteConfirmed(false);
      setLinkedinImportMessage("Selected LinkedIn export removed from this Job Ranger database.");
    } catch (cause) {
      setLinkedinImportError(cause instanceof Error ? cause.message : "Could not delete LinkedIn analytics.");
    } finally {
      setLinkedinImportBusy(false);
    }
  };

  const previewLinkedInWorkbook = async (file: File | null): Promise<void> => {
    setLinkedinPreview(null);
    setLinkedinReviewed(false);
    setLinkedinImportMessage("");
    setLinkedinImportError(null);
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > 4 * 1024 * 1024) {
      setLinkedinImportError("Select a LinkedIn .xlsx export under 4 MB.");
      return;
    }
    setLinkedinImportBusy(true);
    try {
      const rows = readLinkedInXlsx(await file.arrayBuffer());
      setLinkedinPreview(normalizeLinkedInAnalyticsExport(rows));
    } catch (cause) {
      setLinkedinImportError(cause instanceof Error ? cause.message : "Could not read the LinkedIn workbook.");
    } finally {
      setLinkedinImportBusy(false);
    }
  };

  return (
    <Layout>
      <section className="panel panel-strong p-6 sm:p-8 space-y-3">
        <span className="alpha-pill"><BarChart3 className="h-3.5 w-3.5" /> Professional presence</span>
        <h1 className="page-title">Make the post useful. Then measure what happened.</h1>
        <p className="page-copy">Job Ranger supports an intentional, manual LinkedIn workflow. It does not publish for you, invent career claims, or require AI or a social account connection.</p>
      </section>
      {error && <section role="alert" className="support-note mt-5 p-4 text-sm text-[var(--color-danger)]">{error}</section>}
      {notice && <section role="status" className="support-note mt-5 p-4 text-sm">{notice}</section>}
      {loading ? <p className="mt-6">Loading saved professional presence data...</p> : (
        <div className="mt-6 space-y-6">
          <section className="panel panel-strong p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">1. Compose and validate</h2>
              <button type="button" className="secondary-button" onClick={() => {
                setSelected(null); setInput({ ...baseInput }); setReviewed(false); setFreshPreparedRevision(null); setPublishedConfirmed(false); setDirty(false); setError(null); setNotice("");
              }}>New post</button>
            </div>
            <label className="block text-sm font-semibold">Saved drafts
              <select className="input-shell mt-2 w-full" value={selected?.id ?? ""} onChange={(e) => {
                const next = drafts.find((draft) => draft.id === e.target.value) ?? null;
                setSelected(next); setInput(next ? inputFromDraft(next) : { ...baseInput });
                setDirty(false); setReviewed(false); setFreshPreparedRevision(null); setPublishedConfirmed(false);
              }}>
                <option value="">New draft</option>
                {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.body.slice(0, 75) || "(untitled)"} · v{draft.revision}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm font-semibold">Objective
                <select className="input-shell mt-2 w-full" value={input.objective ?? ""} onChange={(e) => change("objective", e.target.value as PersonalBrandDraftInput["objective"])}>
                  {objectives.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">Hook type
                <select className="input-shell mt-2 w-full" value={input.hookArchetype ?? ""} onChange={(e) => change("hookArchetype", (e.target.value || null) as PersonalBrandDraftInput["hookArchetype"])}>
                  {hooks.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">Audience
                <input className="input-shell mt-2 w-full" value={input.audiences.join(", ")} onChange={(e) => change("audiences", e.target.value.split(",").map((s) => s.trim()))} placeholder="Recruiters, hiring managers" />
              </label>
            </div>
            <label className="block text-sm font-semibold">Post text (LinkedIn, text only)
              <textarea className="input-shell mt-2 w-full min-h-[230px]" value={input.body} onChange={(e) => change("body", e.target.value)} placeholder="Start with a specific, supportable claim or experience." />
              <span className="text-xs font-normal text-[var(--color-text-secondary)]">{input.body.length} / 3,000 characters</span>
            </label>
            <label className="block text-sm font-semibold">Hypothesis to evaluate
              <input className="input-shell mt-2 w-full" value={input.hypothesis} onChange={(e) => change("hypothesis", e.target.value)} placeholder="What should this post accomplish, and what will we observe?" />
            </label>
            <section className="rounded-xl border border-[var(--color-border)] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Claim and Career Evidence review</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    Link each specific factual claim to evidence you have authored or confirmed.
                    Evidence linking records your human review; it does not prove that the evidence entails the words.
                  </p>
                </div>
                <button type="button" className="secondary-button" disabled={busy || evidenceLoading}
                  onClick={() => void run(async () => { await reloadEvidence(); setNotice("Career Evidence refreshed."); })}>
                  Refresh Career Evidence
                </button>
              </div>
              {evidenceLoading && <p role="status" className="text-sm">Loading Career Evidence...</p>}
              {evidenceError && <p role="alert" className="text-sm text-[var(--color-danger)]">Unable to refresh Career Evidence: {evidenceError}</p>}
              {!evidenceLoading && !evidenceError && eligibleEvidence.length === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)]">
                  No confirmed or user-authored Career Evidence is available yet.
                  Add it in <a className="underline" href="#/career-profile">Career Profile</a> before linking claims.
                </p>
              )}
              {input.claimChecks.map((claim, index) => (
                <fieldset key={index} className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                  <legend className="px-2 font-semibold">Factual claim {index + 1}</legend>
                  <label className="block text-sm font-semibold">
                    Claim being checked
                    <textarea className="input-shell mt-2 w-full min-h-[72px]" value={claim.claim}
                      onChange={(event) => updateClaim(index, { claim: event.target.value })}
                      placeholder="Exact factual claim this evidence supports" />
                  </label>
                  <label className="block text-sm font-semibold">
                    Link Career Evidence for claim {index + 1}
                    <select className="input-shell mt-2 w-full" value="" disabled={evidenceLoading || Boolean(evidenceError)}
                      onChange={(event) => {
                        const id = event.target.value;
                        if (id && !claim.evidenceIds.includes(id))
                          updateClaim(index, { evidenceIds: [...claim.evidenceIds, id] });
                      }}>
                      <option value="">Choose confirmed evidence to link</option>
                      {eligibleEvidence.filter((item) => !claim.evidenceIds.includes(item.id)).map((item) =>
                        <option key={item.id} value={item.id}>
                          {item.titleOrName || item.organization || item.subjectType}: {item.statement.slice(0, 120)}
                        </option>)}
                    </select>
                  </label>
                  <ul className="space-y-2">
                    {claim.evidenceIds.map((id) => {
                      const item = evidenceById.get(id);
                      const current = item && (item.verificationState === "user-authored" || item.verificationState === "user-confirmed");
                      return (
                        <li key={id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--color-border)] p-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="break-words">{item?.statement ?? "Linked evidence no longer exists."}</p>
                            <p className={current ? "mt-1 text-[var(--color-text-secondary)]" : "mt-1 text-[var(--color-danger)]"}>
                              {current ? `Current · ${item.verificationState}` : `Not current · ${item?.verificationState ?? "missing"}`}
                            </p>
                          </div>
                          <button type="button" className="secondary-button" onClick={() =>
                            updateClaim(index, { evidenceIds: claim.evidenceIds.filter((linked) => linked !== id) })}>
                            Remove link
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" checked={claim.verified}
                      onChange={(event) => updateClaim(index, { verified: event.target.checked })} />
                    <span>I personally checked this claim against the linked current evidence.</span>
                  </label>
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" checked={claim.privacyCleared}
                      onChange={(event) => updateClaim(index, { privacyCleared: event.target.checked })} />
                    <span>I checked this claim for private, confidential, or restricted information.</span>
                  </label>
                  <button type="button" className="secondary-button"
                    onClick={() => change("claimChecks", input.claimChecks.filter((_, position) => position !== index))}>
                    Remove claim
                  </button>
                </fieldset>
              ))}
              {staleEvidenceIds.length > 0 && (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  {staleEvidenceIds.length} linked evidence record(s) are missing, rejected, or superseded.
                  Replace those links and review the affected claims again before preparing a post.
                </p>
              )}
              <button type="button" className="secondary-button" onClick={() =>
                change("claimChecks", [...input.claimChecks, {
                  claim: "", evidenceIds: [], verified: false, privacyCleared: false,
                }])}>
                Add factual claim
              </button>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Claims not entered here are not automatically fact-checked. A final human review remains required.
              </p>
            </section>
            <section className="rounded-xl border border-[var(--color-border)] p-4">
              <h3 className="font-semibold">Deterministic readiness</h3>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">These checks do not prove that prose is factual, emotionally effective, or safe to disclose. Those require editorial and Career Evidence review.</p>
              <ul className="mt-3 space-y-1 text-sm">
                {readiness.findings.map((item) => (
                  <li key={item.code} className="flex gap-2">
                    {item.severity === "blocking" ? <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-danger)]" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />}
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            </section>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              <span>I personally reviewed the exact content, including all factual claims, supporting evidence, privacy, and wording. I understand that preparing a copy does not publish it.</span>
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy} className="secondary-button" onClick={() => void run(async () => { await save(); setNotice("Draft saved in the Job Ranger database."); })}><Save className="h-4 w-4" /> Save draft</button>
              <button type="button" disabled={busy || !reviewed || readiness.status === "blocked" ||
                (input.claimChecks.length > 0 && (evidenceLoading || Boolean(evidenceError) || staleEvidenceIds.length > 0))}
                className="primary-button" onClick={copyPost}><ClipboardCopy className="h-4 w-4" /> Prepare and copy</button>
            </div>
            {currentPackage && !dirty && !evidenceLoading && !evidenceError &&
              staleEvidenceIds.length === 0 && freshPreparedRevision === `${selected?.id}:r${selected?.revision}` && (
              <div className="space-y-2">
                <button type="button" className="secondary-button" disabled={busy || !reviewed ||
                  evidenceLoading || Boolean(evidenceError) || staleEvidenceIds.length > 0}
                  onClick={copyPost}>
                  <ClipboardCopy className="h-4 w-4" /> Recheck evidence and copy
                </button>
                <textarea readOnly aria-label="Exact prepared post text" className="input-shell w-full min-h-[100px] text-sm" value={currentPackage.body} />
              </div>
            )}
          </section>

          <section className="panel panel-strong p-6 space-y-4">
            <h2 className="text-xl font-semibold">2. Record publication</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">After posting manually, record LinkedIn's actual permalink and publication time. Job Ranger labels this a user-confirmed receipt.</p>
            <label className="block text-sm font-semibold">LinkedIn post URL
              <input type="url" className="input-shell mt-2 w-full" value={publishedUrl} onChange={(e) => setPublishedUrl(e.target.value)} placeholder="https://www.linkedin.com/feed/update/..." />
            </label>
            <label className="block text-sm font-semibold">Local publication date and time
              <input type="datetime-local" className="input-shell mt-2 w-full" value={publishedLocal} onChange={(e) => setPublishedLocal(e.target.value)} />
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={publishedConfirmed} onChange={(e) => setPublishedConfirmed(e.target.checked)} />
              <span>I confirm this exact post was published by me.</span>
            </label>
            <button type="button" className="primary-button" disabled={busy || !currentPackage || !publishedConfirmed || dirty || Boolean(currentReceipt)} onClick={confirmPost}>
              {currentReceipt ? "Publication recorded" : "Record manual publication"}
            </button>
          </section>

          <section className="panel panel-strong p-6 space-y-4">
            <h2 className="text-xl font-semibold">3. Observe and learn</h2>
            <details className="rounded-xl border border-[var(--color-border)] p-4 space-y-3" data-testid="linkedin-analytics-export-guide">
              <summary className="cursor-pointer font-semibold">How to export your LinkedIn analytics (Excel)</summary>
              <div className="pt-3 space-y-3 text-sm text-[var(--color-text-secondary)]">
                <p>Use LinkedIn's own export. No LinkedIn developer API or account connection is needed.</p>
                <ol className="list-decimal pl-6 space-y-1">
                  <li>On LinkedIn desktop, open <strong>Me → View Profile</strong>.</li>
                  <li>Scroll to <strong>Analytics</strong> and select <strong>Show all</strong> or <strong>Show all analytics</strong>.</li>
                  <li>Select <strong>Post impressions</strong> to open combined post analytics.</li>
                  <li>Choose a reporting period, such as <strong>Past 365 days</strong>, from the date-range menu.</li>
                  <li>Select <strong>Export</strong> in the upper-right corner and save the <strong>.XLSX</strong> file.</li>
                </ol>
                <p>For audience and follower trends, open <strong>Total followers</strong> in Analytics, select the date range, and export separately.</p>
                <p>
                  <a className="underline underline-offset-2" href="https://www.linkedin.com/help/linkedin/answer/a703268"
                    target="_blank" rel="noopener noreferrer">
                    LinkedIn Help: View your creator analytics (official instructions)
                  </a>
                </p>
                <p>LinkedIn can change its labels or navigation. Follow the linked official help article if the steps differ.</p>
                <p><strong>Import preview available below:</strong> You can inspect an XLSX export locally. Previewed data is not yet saved to the Job Ranger database. Keep the original file unchanged. The fields below are manual, per-post observations, not an upload destination for account-wide totals.</p>
              </div>
            </details>
            <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3" data-testid="linkedin-xlsx-preview">
              <h3 className="font-semibold">Review a LinkedIn analytics export</h3>
              <label className="block text-sm font-medium">Choose exported LinkedIn XLSX (local preview only)
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="input-shell mt-2 w-full" disabled={linkedinImportBusy}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    event.currentTarget.value = "";
                    void previewLinkedInWorkbook(file);
                  }} />
              </label>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Read locally without LinkedIn account access, network calls or automatic saving. The complete workbook is not uploaded. Imported figures are observational analytics, not evidence of career outcomes.
              </p>
              {linkedinImportBusy && <p role="status">Reading workbook locally...</p>}
              {linkedinImportError && <p role="alert" className="text-sm text-[var(--color-danger)]">{linkedinImportError}</p>}
              {linkedinImportMessage && <p role="status" className="text-sm">{linkedinImportMessage}</p>}
              {linkedinPreview && (
                <div className="space-y-3 text-sm" data-testid="linkedin-preview-results" role="region" aria-label="LinkedIn analytics workbook preview">
                  <p className="font-semibold">Export review: {linkedinPreview.period.start} through {linkedinPreview.period.end} (not saved unless confirmed)</p>
                  <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div><dt>Impressions</dt><dd className="font-semibold">{linkedinPreview.discovery.impressions.toLocaleString()}</dd></div>
                    <div><dt>Members reached</dt><dd className="font-semibold">{linkedinPreview.discovery.membersReached.toLocaleString()}</dd></div>
                    <div><dt>Current followers</dt><dd className="font-semibold">{linkedinPreview.followers.total.toLocaleString()}</dd></div>
                    <div><dt>Ranked unique posts</dt><dd className="font-semibold">{linkedinPreview.topPosts.length}</dd></div>
                  </dl>
                  <p>{linkedinPreview.daily.length} daily engagement observations; {linkedinPreview.audienceDemographics.length} audience and {linkedinPreview.contentDemographics.length} content demographic rows.</p>
                  {linkedinPreview.warnings.length > 0 && (
                    <div className="rounded-lg border border-[var(--color-border)] p-3" role="note">
                      <strong>Import interpretation warnings</strong>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        {linkedinPreview.warnings.map(warning => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  )}
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={linkedinReviewed} onChange={event => setLinkedinReviewed(event.target.checked)} />
                    <span>I reviewed the reporting period, metrics and warnings. Save this snapshot without merging overlapping exports or attributing outcomes.</span>
                  </label>
                  <button type="button" className="primary-button" disabled={!linkedinReviewed || linkedinImportBusy}
                    onClick={() => { void saveLinkedInPreview(); }}>Review and save LinkedIn export</button>
                  <div className="max-h-72 overflow-auto" tabIndex={0} aria-label="Sample of ranked post observations">
                    <table className="w-full text-left text-xs">
                      <caption className="text-left font-semibold mb-2">Top posts (sample; missing values are unknown)</caption>
                      <thead><tr><th scope="col" className="pr-3">Published</th><th scope="col" className="pr-3">Impressions</th><th scope="col" className="pr-3">Engagements</th><th scope="col">LinkedIn post</th></tr></thead>
                      <tbody>{linkedinPreview.topPosts.slice(0, 8).map(post => (
                        <tr key={post.url}>
                          <td className="pr-3 py-1">{post.publishedOn}</td>
                          <td className="pr-3">{post.impressions === null ? "Unknown" : post.impressions.toLocaleString()}</td>
                          <td className="pr-3">{post.engagements === null ? "Unknown" : post.engagements.toLocaleString()}</td>
                          <td><a href={post.url} target="_blank" rel="noopener noreferrer" className="underline">View post</a></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              <LinkedInObservedDashboard report={linkedinReconciliation} />
              <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3" aria-label="LinkedIn historical reconciliation" data-testid="linkedin-reconciliation">
                <h4 className="font-semibold">Historical analytics, reconciled across exports</h4>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Observational data from manually supplied exports, not a verified provider API.
                  Every calendar day is counted once. If two exports disagree, the disputed number stays hidden.
                  No attribution to career outcomes, and no prediction.
                </p>
                {linkedinReconciliation.period ? (
                  <>
                    <p className="text-sm">
                      Period: <strong>{linkedinReconciliation.period.start} to {linkedinReconciliation.period.end}</strong>
                      {" · "}{linkedinReconciliation.imports} saved export(s)
                    </p>
                    <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                      <div><dt>Days observed</dt><dd className="font-semibold">{linkedinReconciliation.coverage.observedDays} of {linkedinReconciliation.coverage.calendarDays}</dd></div>
                      <div><dt>Missing days</dt><dd className="font-semibold">{linkedinReconciliation.coverage.missingDays}</dd></div>
                      <div><dt>Conflicted days</dt><dd className="font-semibold">{linkedinReconciliation.coverage.conflictedDays}</dd></div>
                      <div><dt>Daily impressions total</dt><dd className="font-semibold">{linkedinReconciliation.totals.impressions === null ? "Withheld (incomplete or disputed)" : linkedinReconciliation.totals.impressions.toLocaleString()}</dd></div>
                    </dl>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      Full-period daily engagements: {linkedinReconciliation.totals.engagements === null ? "Unavailable" : linkedinReconciliation.totals.engagements.toLocaleString()}.
                      {" "}Daily new followers: {linkedinReconciliation.totals.newFollowers === null ? "Unavailable" : linkedinReconciliation.totals.newFollowers.toLocaleString()}.
                      Totals require all calendar days and agreement between overlapping observations.
                    </p>
                    <div className="max-h-64 overflow-auto" tabIndex={0} aria-label="Recent reconciled LinkedIn dates">
                      <table className="w-full text-left text-xs">
                        <caption className="text-left font-semibold mb-2">Latest 14 calendar days, including missing or disputed entries</caption>
                        <thead><tr>
                          <th scope="col" className="pr-3">Date</th>
                          <th scope="col" className="pr-3">Impressions</th>
                          <th scope="col" className="pr-3">Engagements</th>
                          <th scope="col">New followers</th>
                        </tr></thead>
                        <tbody>{linkedinReconciliation.daily.slice(-14).reverse().map(row => (
                          <tr key={row.date}>
                            <th scope="row" className="pr-3 py-1">{row.date}</th>
                            <td className="pr-3">{displayLinkedInMetric(row.impressions)}</td>
                            <td className="pr-3">{displayLinkedInMetric(row.engagements)}</td>
                            <td>{displayLinkedInMetric(row.newFollowers)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    {linkedinReconciliation.warnings.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold">Reconciliation limitations ({linkedinReconciliation.warnings.length})</summary>
                        <ul className="list-disc pl-5 mt-2 text-xs space-y-1">
                          {linkedinReconciliation.warnings.map(warning => <li key={warning}>{warning}</li>)}
                        </ul>
                      </details>
                    )}
                  </>
                ) : <p className="text-sm">No saved LinkedIn exports yet. Export and review a workbook above to begin.</p>}
              </section>
              <section className="rounded-lg border border-[var(--color-border)] p-4 space-y-3"
                data-testid="linkedin-post-content-enrichment" aria-label="LinkedIn ranked post and approved copy matches">
                <h4 className="font-semibold">Ranked post content: confirmed matches only</h4>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  LinkedIn's XLSX lists URLs and metrics, not the text or comments.
                  Job Ranger displays an original post copy only when a matching human-confirmed
                  publication receipt and its fingerprint-checked reviewed package agree.
                  A copy match does not verify the live LinkedIn post, and post totals
                  are not comparable unless observation windows are equivalent.
                </p>
                {rankedPostLinkError && <p role="alert" className="text-sm text-[var(--color-danger)]">{rankedPostLinkError}</p>}
                {!rankedPostLinkReport && !rankedPostLinkError && <p role="status" className="text-sm">Checking source matches...</p>}
                {rankedPostLinkReport && (
                  <>
                    <p className="text-sm">
                      <strong>{rankedPostLinkReport.verifiedCopyCount}</strong> original approved copies matched
                      {" · "}<strong>{rankedPostLinkReport.unmatchedCount}</strong> posts without a recorded publication
                      {" · "}<strong>{rankedPostLinkReport.totalRanked}</strong> ranked posts in the latest saved export
                    </p>
                    {rankedPostLinkReport.totalRanked === 0 ? (
                      <p className="text-sm">Save a LinkedIn analytics export to inspect ranked post matches.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          Showing up to 12 posts from the latest imported workbook. Missing metrics are unknown, not zero.
                        </p>
                        {rankedPostLinkReport.rows.slice(0, 12).map(row => (
                          <div key={row.url} className="rounded-lg border border-[var(--color-border)] p-3 space-y-1 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold">{row.publishedOn} · {row.impressions === null ? "Impressions unavailable" : row.impressions.toLocaleString() + " impressions"}</span>
                              {canonicalLinkedInPostUrl(row.url) && (
                                <a className="underline break-all text-xs" href={row.url} target="_blank"
                                  rel="noopener noreferrer">LinkedIn post</a>
                              )}
                            </div>
                            <p className="text-xs">
                              Engagements: {row.engagements === null ? "Unknown" : row.engagements.toLocaleString()}
                              {" · "}Source match: <strong>{row.status.replaceAll("-", " ")}</strong>
                            </p>
                            <p className="text-xs text-[var(--color-text-secondary)]">{row.explanation}</p>
                            {row.reviewedCopy !== null && (
                              <details className="text-sm">
                                <summary className="cursor-pointer font-medium">View original user-approved copy</summary>
                                <p className="whitespace-pre-wrap break-words mt-2">{row.reviewedCopy}</p>
                                {row.metadataCurrent && (
                                  <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                                    Current draft metadata: hook {row.hook?.replaceAll("_", " ") ?? "Not recorded"};
                                    {" "}format {row.format ?? "Not recorded"};
                                    {" "}objective {row.objective?.replaceAll("_", " ") ?? "Not recorded"}.
                                  </p>
                                )}
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer font-semibold">Coverage and provenance cautions ({rankedPostLinkReport.warnings.length})</summary>
                      <ul className="list-disc pl-5 space-y-1 mt-2">
                        {rankedPostLinkReport.warnings.map(warning => <li key={warning}>{warning}</li>)}
                      </ul>
                    </details>
                  </>
                )}
              </section>
              <HistoricalLinkedInArchive analytics={linkedinReconciliation} />
              <LinkedInTopicAttestations publications={publications} onLabelsChanged={() => setTopicRevision(n => n + 1)} />
              <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-3" data-testid="linkedin-import-ledger">
                <h4 className="font-semibold">Saved LinkedIn exports ({linkedinSaved.length})</h4>
                <p className="text-xs text-[var(--color-text-secondary)]">Overlapping exports are separate observations, never summed together. Original .xlsx files are not stored; preserve your originals. Deleting an import does not modify career evidence or manually recorded post snapshots.</p>
                {linkedinSaved.length > 0 && (
                  <>
                    <ul className="space-y-2 text-sm">
                      {linkedinSaved.map(item => (
                        <li key={item.id} className="break-words">
                          {item.preview.period.start} to {item.preview.period.end} · imported {new Date(item.importedAt).toLocaleString()} · {item.preview.daily.length} daily rows · {item.contentSha256.slice(0, 12)}
                        </li>
                      ))}
                    </ul>
                    <label className="block text-sm font-medium">Select an import to delete
                      <select className="input-shell mt-2 w-full" value={linkedinDeleteId}
                        onChange={event => { setLinkedinDeleteId(event.target.value); setLinkedinDeleteConfirmed(false); }}>
                        <option value="">No import selected</option>
                        {linkedinSaved.map(item => <option key={item.id} value={item.id}>{item.preview.period.start} to {item.preview.period.end} · {item.contentSha256.slice(0, 12)}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={linkedinDeleteConfirmed}
                        onChange={event => setLinkedinDeleteConfirmed(event.target.checked)} />
                      <span>I confirm deletion of the selected imported snapshot.</span>
                    </label>
                    <button className="secondary-button" type="button"
                      disabled={!linkedinDeleteId || !linkedinDeleteConfirmed || linkedinImportBusy}
                      onClick={() => { void deleteLinkedInSaved(); }}>Delete selected export</button>
                  </>
                )}
              </div>
            </div>
            <label className="block text-sm font-semibold">Published post
              <select className="input-shell mt-2 w-full" value={postId} onChange={(e) => setPostId(e.target.value)}>
                <option value="">Select a publication</option>
                {publications.map((receipt) => <option key={receipt.postId} value={receipt.postId}>{receipt.destination} · {new Date(receipt.publishedAt).toLocaleString()} · {receipt.draftId.slice(0, 14)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">Source of this snapshot
              <input className="input-shell mt-2 w-full" value={metricsSource} onChange={(e) => setMetricsSource(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {metricInputs.map(([name, label]) => (
                <label key={name} className="text-sm font-semibold">{label}
                  <input type="number" min="0" step="1" inputMode="numeric" className="input-shell mt-2 w-full" value={metrics[name] ?? ""} onChange={(e) => setMetrics((before) => ({ ...before, [name]: e.target.value }))} placeholder="Not available" />
                </label>
              ))}
            </div>
            <button type="button" disabled={busy || !postId} className="primary-button" onClick={recordMetrics}>Save timestamped analytics</button>
            <p className="text-xs text-[var(--color-text-secondary)]">Blank metrics are unavailable, not zero. Results are self-reported snapshots, not retrieved from LinkedIn.</p>
            {summary && lastSnapshot && (
              <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-2">
                <p className="font-semibold">Latest snapshot: {new Date(lastSnapshot.capturedAt).toLocaleString()}</p>
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <p>Impressions: <strong>{summary.impressions ?? "Unavailable"}</strong></p>
                  <p>Reached: <strong>{summary.reached ?? "Unavailable"}</strong></p>
                  <p>Engagement/reached: <strong>{formatPercent(summary.engagementsPerReached)}</strong></p>
                  <p>Profile visits/reached: <strong>{formatPercent(summary.profileViewsPerReached)}</strong></p>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)]">{summary.caveat} {snapshots.length} snapshot(s) saved.</p>
              </div>
            )}
          </section>
          <section className="panel panel-strong p-6 space-y-4">
            <h2 className="text-xl font-semibold">4. Compare equivalent post ages</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Compare observed cumulative totals at similar post ages, not screenshots
              captured at different times. No prediction, invented values, or causal attribution.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold">Observation age
                <select className="input-shell mt-2 w-full" value={cohortAge}
                  onChange={(event) => setCohortAge(Number(event.target.value) as LearningWindowHours)}>
                  <option value={24}>About 24 hours (±3h)</option>
                  <option value={48}>About 48 hours (±6h)</option>
                  <option value={168}>About 7 days (±12h)</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">Outcome measure
                <select className="input-shell mt-2 w-full" value={cohortMetric}
                  onChange={(event) => setCohortMetric(event.target.value as LearningMetric)}>
                  <option value="profile_views_per_reached">Attributed profile views / reached</option>
                  <option value="engagements_per_reached">Engagements / reached</option>
                  <option value="followers_per_reached">Attributed followers / reached</option>
                  <option value="reached">Members reached</option>
                  <option value="impressions">Impressions</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="secondary-button" disabled={cohortLoading}
                onClick={() => setCohortRevision((value) => value + 1)}>Refresh observations</button>
              <p role="status" className="text-sm text-[var(--color-text-secondary)]">
                {cohortLoading ? "Loading post observations..." :
                  `${learning.eligibleCount} comparable of ${learning.rows.length} recorded LinkedIn posts`}
              </p>
            </div>
            {cohortError && <p role="alert" className="text-sm text-[var(--color-danger)]">{cohortError}</p>}
            {!cohortLoading && !cohortError && (
              <>
                <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-[var(--color-border)]">
                      <th scope="col" className="p-3">Post</th>
                      <th scope="col" className="p-3">Observed age</th>
                      <th scope="col" className="p-3">{learning.label}</th>
                      <th scope="col" className="p-3">Evidence and limitations</th>
                    </tr></thead>
                    <tbody>
                      {learning.rows.map((row) => (
                        <tr key={row.postId} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="p-3 align-top">
                            <a className="underline break-all" href={row.publishedUrl} target="_blank"
                              rel="noopener noreferrer">{new Date(row.publishedAt).toLocaleDateString()}</a>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              {row.metadataCurrent ? `${row.objective ?? "No objective"} · ${row.hook ?? "No hook"}` :
                                "Historical hook/objective not available"}
                            </p>
                          </td>
                          <td className="p-3 align-top">{row.observedAgeHours === null ?
                            "Unavailable" : `${row.observedAgeHours.toFixed(1)}h`}</td>
                          <td className="p-3 align-top font-semibold tabular-nums">
                            {row.value === null ? "Unavailable" : learning.units === "rate" ?
                              `${(row.value * 100).toFixed(2)}%` : row.value.toLocaleString()}
                          </td>
                          <td className="p-3 align-top">
                            <p>{row.reason}</p>
                            {row.sourceLabel && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                              {row.sourceLabel} · {row.states.join(", ") || "required metric not recorded"}
                            </p>}
                          </td>
                        </tr>
                      ))}
                      {learning.rows.length === 0 && (
                        <tr><td colSpan={4} className="p-4 text-[var(--color-text-secondary)]">
                          No manually recorded LinkedIn posts yet.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
                  <h3 className="font-semibold">Next experiment, based on available observations</h3>
                  <p className="text-sm">{learning.recommendation}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {learning.comparisonPossible ?
                      "This is a testable suggestion, not a prediction or proof of a winning format." :
                      "Insufficient comparable data. No post is ranked as a winner."}
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-xs text-[var(--color-text-secondary)]">
                    {learning.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
                  </ul>
                </div>
              </>
            )}
          </section>
          {!cohortLoading && !cohortError && <LinkedInApprovedContentCohorts learning={learning} publications={publications} prepared={prepared} drafts={drafts} />}
          {!cohortLoading && !cohortError && <LinkedInTopicCohortSummary learning={learning} publications={publications} prepared={prepared} drafts={drafts} refreshToken={topicRevision} />}
          <CareerOutcomeJournal publications={publications} />
        </div>
      )}
    </Layout>
  );
}
