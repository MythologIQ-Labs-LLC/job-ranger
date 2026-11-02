import { useLayoutEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  ClipboardPaste,
  Compass,
  FileText,
  FileUp,
  GitMerge,
  MapPin,
  Pencil,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { LineListTextarea } from "../components/LineListTextarea";
import { useCareerEvidence } from "../career/evidence";
import {
  emptyCareerProfile,
  type CareerProfile as CareerProfileValue,
  useCareerProfile,
} from "../career/storage";
import type { EvidenceSubjectType, SourceArtifact } from "../shared/contracts";

function artifactStateLabel(state: SourceArtifact["extractionState"]): string {
  switch (state) {
    case "pending":
      return "Processing";
    case "extracted":
      return "Extracted";
    case "review-required":
      return "Needs review";
    case "needs-ocr":
      return "Needs OCR";
    case "encrypted":
      return "Encrypted";
    case "malformed":
      return "Could not read";
    case "unsupported":
      return "Unsupported";
    case "resource-limited":
      return "Too large";
    case "failed":
      return "Import failed";
  }
}

const subjectLabels: Record<EvidenceSubjectType, string> = {
  role: "Role",
  skill: "Skill",
  credential: "Credential",
  education: "Education",
  project: "Project",
  achievement: "Achievement",
  publication: "Publication",
  other: "Other",
};

export function CareerProfile() {
  const { profile, save, loading, error } = useCareerProfile();
  const evidence = useCareerEvidence();
  const [draft, setDraft] = useState<CareerProfileValue>(emptyCareerProfile);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteLabel, setPasteLabel] = useState("Previous resume");
  const [pasteText, setPasteText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingType, setEditingType] = useState<EvidenceSubjectType>("other");
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});

  // Every edit bumps editVersion synchronously; storedVersion is the newest edit known to be
  // stored. A stored profile (first load, a refresh after a save elsewhere, or the result of a
  // save) may replace the form only when the form holds no edit newer than what is stored, so
  // neither a background refresh (#278) nor a save that completes after further typing (#288)
  // discards what the person entered. A layout effect seeds the form in the same commit that
  // enables its controls, so no choice can land between enabling and seeding.
  const editVersion = useRef(0);
  const storedVersion = useRef(0);
  useLayoutEffect(() => {
    if (!loading && editVersion.current === storedVersion.current) setDraft(profile);
  }, [loading, profile]);

  const update = <K extends keyof CareerProfileValue,>(key: K, value: CareerProfileValue[K]) => {
    editVersion.current += 1;
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setSaveError(null);
  };

  const reset = () => {
    editVersion.current += 1;
    setDraft(emptyCareerProfile);
    setSaved(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    const savedVersion = editVersion.current;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const next = await save(draft);
      // Only the snapshot that was submitted is stored; later edits stay in the form.
      storedVersion.current = savedVersion;
      if (editVersion.current === savedVersion) {
        setDraft(next);
        setSaved(true);
      } else {
        setSaved(false);
        setSaveNotice("Changes made during saving are still here. Save again to keep them.");
      }
    } catch (saveFailure) {
      setSaved(false);
      setSaveError(
        saveFailure instanceof Error
          ? saveFailure.message
          : "Unable to save Career Profile",
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;
    try {
      await evidence.importPastedText({ label: pasteLabel, text: pasteText });
      setPasteText("");
      setPasteOpen(false);
    } catch {
      // The hook exposes the failure message in the page-level evidence error.
    }
  };

  const beginEdit = (id: string, statement: string, subjectType: EvidenceSubjectType) => {
    setEditingId(id);
    setEditingText(statement);
    setEditingType(subjectType);
  };

  const saveEdit = async () => {
    if (!editingId || !editingText.trim()) return;
    try {
      await evidence.review(editingId, {
        action: "edit",
        statement: editingText,
        subjectType: editingType,
      });
      setEditingId(null);
      setEditingText("");
    } catch {
      // The hook exposes the failure message.
    }
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill">
          <Sparkles className="h-3.5 w-3.5" />
          Start here
        </span>
        <h1 className="page-title mt-4">Tell Sojourner what good work looks like for you.</h1>
        <p className="page-copy">
          Add the work you want, where you can work, what you already know, and what matters to you. You can also import an existing resume to build a reusable record of career evidence without turning the document itself into the source of truth.
        </p>
      </section>

      {(error || saveError || evidence.error) && (
        <section className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">
          {saveError ?? evidence.error ?? error}
        </section>
      )}

      <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <aside className="space-y-5">
          <div className="story-card">
            <div className="flex items-center gap-3">
              <Compass className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-xl font-semibold">Broaden the search, not your résumé</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
              Start with roles you already understand, then add adjacent or stretch roles you would genuinely consider. Target roles guide discovery. They never become claims about experience you do not have.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
              <li>Add the role you do now or have done before.</li>
              <li>Add nearby roles that use the same strengths in a different setting.</li>
              <li>Add reasonable stretch roles you could grow into.</li>
            </ul>
          </div>

          <div className="story-card">
            <div className="flex items-center gap-3">
              <BadgeCheck className="h-5 w-5 text-[var(--color-success)]" />
              <h2 className="text-xl font-semibold">What stays yours</h2>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-[var(--color-text-secondary)]">
              <li>Your career profile and imported evidence stay in Sojourner&apos;s local data store.</li>
              <li>Imported statements do not become confirmed facts until you approve them.</li>
              <li>Sojourner never invents credentials, skills, experience, or results for you.</li>
            </ul>
          </div>
        </aside>

        <div className="panel panel-strong p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label>
              <span className="metric-label">Your name</span>
              <input
                className="input-shell mt-2"
                value={draft.fullName}
                onChange={(event) => update("fullName", event.target.value)}
                placeholder="Optional"
                disabled={loading}
              />
            </label>

            <label>
              <span className="metric-label">Home area</span>
              <div className="relative mt-2">
                <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  className="input-shell pl-11"
                  value={draft.homeLocation}
                  onChange={(event) => update("homeLocation", event.target.value)}
                  placeholder="City, state, or region"
                  disabled={loading}
                />
              </div>
            </label>

            <label>
              <span className="metric-label">Maximum commute</span>
              <div className="relative mt-2">
                <input
                  className="input-shell pr-16"
                  type="number"
                  min="0"
                  value={draft.radiusMiles ?? ""}
                  onChange={(event) =>
                    update("radiusMiles", event.target.value ? Number(event.target.value) : null)
                  }
                  placeholder="30"
                  disabled={loading}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]">
                  miles
                </span>
              </div>
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                Saved as a preference. Current matching uses the listed city/area until distance data is available.
              </span>
            </label>

            <label>
              <span className="metric-label">Minimum pay</span>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]">$</span>
                  <input
                    className="input-shell pl-8"
                    type="number"
                    min="0"
                    step={draft.payBasis === "hourly" ? "0.50" : "1000"}
                    value={draft.minimumPay ?? ""}
                    onChange={(event) =>
                      update("minimumPay", event.target.value ? Number(event.target.value) : null)
                    }
                    placeholder={draft.payBasis === "hourly" ? "30" : "75000"}
                    disabled={loading}
                  />
                </div>
                <select
                  className="select-shell w-auto min-w-28"
                  aria-label="Pay basis"
                  value={draft.payBasis}
                  onChange={(event) =>
                    update("payBasis", event.target.value as CareerProfileValue["payBasis"])
                  }
                  disabled={loading}
                >
                  <option value="hourly">per hour</option>
                  <option value="annual">per year</option>
                </select>
              </div>
            </label>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <label>
              <span className="metric-label">Roles you would consider</span>
              <LineListTextarea
                className="input-shell mt-2 min-h-36 resize-y py-3"
                values={draft.targetTitles}
                onValuesChange={(values) => update("targetTitles", values)}
                placeholder={"Current or preferred role\nAdjacent role\nStretch role"}
                disabled={loading}
              />
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                One title per line. Include adjacent roles that genuinely fit your interests and transferable strengths.
              </span>
            </label>

            <label>
              <span className="metric-label">Skills you already use</span>
              <LineListTextarea
                className="input-shell mt-2 min-h-36 resize-y py-3"
                values={draft.skills}
                onValuesChange={(values) => update("skills", values)}
                placeholder={"customer service\ntroubleshooting\nproject coordination"}
                disabled={loading}
              />
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">One skill per line. Only list work you can defend in an interview.</span>
            </label>

            <label>
              <span className="metric-label">Certifications and licenses</span>
              <LineListTextarea
                className="input-shell mt-2 min-h-32 resize-y py-3"
                values={draft.certifications}
                onValuesChange={(values) => update("certifications", values)}
                placeholder={"Professional license\nIndustry certification\nSafety training"}
                disabled={loading}
              />
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">One per line. Optional: leave this blank if credentials are not important in your field.</span>
            </label>

            <label>
              <span className="metric-label">Industries or work settings you prefer</span>
              <LineListTextarea
                className="input-shell mt-2 min-h-32 resize-y py-3"
                values={draft.sectors}
                onValuesChange={(values) => update("sectors", values)}
                placeholder={"Industry\nWork environment\nSpecialty area"}
                disabled={loading}
              />
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">One per line.</span>
            </label>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label>
              <span className="metric-label">After-hours or on-call work</span>
              <select
                className="select-shell mt-2"
                value={draft.onCallPreference}
                onChange={(event) => update("onCallPreference", event.target.value as CareerProfileValue["onCallPreference"])}
                disabled={loading}
              >
                <option value="either">No preference</option>
                <option value="yes">Okay with it</option>
                <option value="no">Prefer to avoid it</option>
              </select>
              <span className="mt-2 block text-xs text-[var(--color-text-muted)]">Optional preference for roles where after-hours availability matters.</span>
            </label>

            <label className="panel panel-muted flex items-center gap-3 rounded-2xl px-4 py-3 sm:mt-6">
              <input
                type="checkbox"
                checked={draft.fullTimeOnly}
                onChange={(event) => update("fullTimeOnly", event.target.checked)}
                className="h-4 w-4"
                disabled={loading}
              />
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">Show full-time work as the default fit</span>
            </label>
          </div>

          <div className="border-divider mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            <button type="button" className="surface-link-button text-sm font-semibold text-[var(--color-text-secondary)]" onClick={reset} disabled={loading || saving}>
              Clear form
            </button>
            <div className="flex items-center gap-3">
              {saved && <span className="text-sm font-semibold text-[var(--color-success)]">Saved on this device</span>}
              {saveNotice && <span role="status" data-testid="profile-save-notice" className="max-w-sm text-xs text-[var(--color-text-secondary)]">{saveNotice}</span>}
              <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={loading || saving}>
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save career profile"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel panel-strong mt-6 p-6 sm:p-8" aria-labelledby="career-evidence-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="metric-label">Career evidence</span>
            <h2 id="career-evidence-heading" className="mt-2 text-2xl font-semibold">Build from work you can prove.</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
              Import a DOCX, text-bearing PDF, or plain-text resume. Sojourner preserves the original, extracts locally, and asks you to review each statement before it can support a future resume.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="primary-button"
              onClick={() => void evidence.importFile()}
              disabled={evidence.busy}
            >
              <FileUp className="h-4 w-4" />
              {evidence.busy ? "Working..." : "Import resume"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPasteOpen((value) => !value)}
              disabled={evidence.busy}
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste text
            </button>
          </div>
        </div>

        {pasteOpen && (
          <div className="panel panel-muted mt-5 p-4">
            <div className="grid gap-4 sm:grid-cols-[0.4fr_1fr]">
              <label>
                <span className="metric-label">Source label</span>
                <input
                  className="input-shell mt-2"
                  value={pasteLabel}
                  onChange={(event) => setPasteLabel(event.target.value)}
                  placeholder="Previous resume"
                />
              </label>
              <label>
                <span className="metric-label">Career history or resume text</span>
                <textarea
                  className="input-shell mt-2 min-h-36 resize-y py-3"
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  placeholder="Paste resume text or career history here."
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="primary-button"
                onClick={() => void handlePasteImport()}
                disabled={evidence.busy || !pasteText.trim()}
              >
                <ClipboardPaste className="h-4 w-4" />
                Extract evidence
              </button>
            </div>
          </div>
        )}

        {evidence.lastImport?.message && (
          <div className={`support-note mt-5 px-4 py-3 text-sm ${evidence.lastImport.failureCode ? "text-[var(--color-danger)]" : "text-[var(--color-text-secondary)]"}`}>
            {evidence.lastImport.message}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="panel panel-muted rounded-2xl px-4 py-3">
            <div className="metric-label">Sources</div>
            <div className="mt-1 text-2xl font-semibold">{evidence.artifacts.length}</div>
          </div>
          <div className="panel panel-muted rounded-2xl px-4 py-3">
            <div className="metric-label">Needs review</div>
            <div className="mt-1 text-2xl font-semibold">{evidence.pending.length}</div>
          </div>
          <div className="panel panel-muted rounded-2xl px-4 py-3">
            <div className="metric-label">Confirmed facts</div>
            <div className="mt-1 text-2xl font-semibold">{evidence.confirmed.length}</div>
          </div>
        </div>

        {evidence.artifacts.length > 0 && (
          <div className="mt-6">
            <h3 className="text-base font-semibold">Imported sources</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {evidence.artifacts.map((artifact) => (
                <div key={artifact.id} className="panel panel-muted flex items-start gap-3 rounded-2xl px-4 py-3">
                  <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-primary)]" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{artifact.originalName}</div>
                    <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {artifactStateLabel(artifact.extractionState)}
                      {artifact.parserId ? ` · ${artifact.parserId} ${artifact.parserVersion ?? ""}` : ""}
                    </div>
                    {artifact.warnings[0] && (
                      <div className="mt-2 text-xs text-[var(--color-text-secondary)]">{artifact.warnings[0]}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Review imported evidence</h3>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Imported statements are proposals. Confirm, correct, merge, or reject them before Sojourner treats them as facts.
              </p>
            </div>
          </div>

          {evidence.loading ? (
            <div className="mt-4 text-sm text-[var(--color-text-muted)]">Loading career evidence...</div>
          ) : evidence.pending.length === 0 ? (
            <div className="support-note mt-4 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              Nothing is waiting for review.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {evidence.pending.map(({ evidence: item, sources }) => {
                const editing = editingId === item.id;
                const mergeTarget = mergeTargets[item.id] ?? "";
                return (
                  <article key={item.id} className="panel panel-muted rounded-2xl p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="metric-label">{subjectLabels[item.subjectType]}</div>
                        {editing ? (
                          <div className="mt-3 space-y-3">
                            <select
                              className="select-shell"
                              aria-label="Evidence type"
                              value={editingType}
                              onChange={(event) => setEditingType(event.target.value as EvidenceSubjectType)}
                            >
                              {Object.entries(subjectLabels).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            <textarea
                              className="input-shell min-h-24 resize-y py-3"
                              value={editingText}
                              onChange={(event) => setEditingText(event.target.value)}
                            />
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-[var(--color-text-primary)]">{item.statement}</p>
                        )}
                        {sources[0] && (
                          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                            From {sources[0].originalName}
                            {sources[0].sourceLocator ? ` · ${sources[0].sourceLocator}` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    {editing ? (
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="surface-link-button text-sm font-semibold"
                          onClick={() => setEditingId(null)}
                          disabled={evidence.busy}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void saveEdit()}
                          disabled={evidence.busy || !editingText.trim()}
                        >
                          <Check className="h-4 w-4" />
                          Save and confirm
                        </button>
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void evidence.review(item.id, { action: "confirm" })}
                          disabled={evidence.busy}
                        >
                          <Check className="h-4 w-4" />
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => beginEdit(item.id, item.statement, item.subjectType)}
                          disabled={evidence.busy}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void evidence.review(item.id, { action: "reject" })}
                          disabled={evidence.busy}
                        >
                          <X className="h-4 w-4" />
                          Reject
                        </button>

                        {evidence.confirmed.length > 0 && (
                          <div className="ml-auto flex min-w-[18rem] flex-1 flex-wrap items-center justify-end gap-2">
                            <select
                              className="select-shell min-w-0 flex-1"
                              aria-label={`Merge target for ${item.statement}`}
                              value={mergeTarget}
                              onChange={(event) =>
                                setMergeTargets((current) => ({ ...current, [item.id]: event.target.value }))
                              }
                            >
                              <option value="">Merge duplicate into...</option>
                              {evidence.confirmed.map(({ evidence: target }) => (
                                <option key={target.id} value={target.id}>{target.statement}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => mergeTarget && void evidence.merge(item.id, mergeTarget)}
                              disabled={evidence.busy || !mergeTarget}
                            >
                              <GitMerge className="h-4 w-4" />
                              Merge
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {evidence.confirmed.length > 0 && (
          <details className="mt-7">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-text-primary)]">
              Confirmed career evidence ({evidence.confirmed.length})
            </summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {evidence.confirmed.map(({ evidence: item }) => (
                <div key={item.id} className="panel panel-muted rounded-2xl px-4 py-3">
                  <div className="metric-label">{subjectLabels[item.subjectType]}</div>
                  <p className="mt-2 text-sm leading-6">{item.statement}</p>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="support-note mt-6 flex items-start gap-3 px-5 py-4 text-sm text-[var(--color-text-secondary)]">
        <BriefcaseBusiness className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-primary)]" />
        <p>
          Next, open Find Jobs. Listings will show plain-language fit guidance based on information you saved here and job data Sojourner actually collected. Confirmed career evidence will also become available to later resume and interview workflows.
        </p>
      </section>
    </Layout>
  );
}
