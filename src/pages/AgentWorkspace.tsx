import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Download, FolderSync, ShieldCheck } from "lucide-react";
import { Layout } from "../components/Layout";
import { AgentItemReview } from "../components/agent-workspace/AgentItemReview";
import { useAgentWorkspace, type ExportSelection, type SyncSummary } from "../components/agent-workspace/useAgentWorkspace";
import { explain, KIND_LABELS, STATE_LABELS } from "../agent-workspace/review.ts";
import { gatherCanonicalSnapshot, type CanonicalSnapshot, type ExportScope } from "../agent-workspace/index.ts";
import { getDesktopApi } from "../services/api";
import type { AgentItemState, AgentItemSummary } from "../shared/agent-workspace-api";

type View = "review" | "drafts" | "problems" | "history";
const VIEWS: { id: View; label: string; states: AgentItemState[] }[] = [
  { id: "review", label: "Needs review", states: ["proposal", "contested", "needs_rebase", "staged", "pending"] },
  { id: "drafts", label: "Drafts", states: ["draft", "kept"] },
  { id: "problems", label: "Problems", states: [] },
  { id: "history", label: "History", states: ["dismissed", "rejected_by_user", "applied"] },
];
const SCOPES: { id: ExportScope; label: string; hint: string }[] = [
  { id: "confirmed_evidence", label: "Confirmed Career Evidence", hint: "Only confirmed or self-authored evidence; no credential numbers." },
  { id: "career_direction", label: "Career direction", hint: "Target titles, sectors and skills. No name, location or pay." },
  { id: "tracks", label: "Target tracks", hint: "The career directions you defined." },
  { id: "selected_opportunities", label: "Selected jobs", hint: "Job postings you pick below, labelled as untrusted text." },
  { id: "selected_applications", label: "Selected applications", hint: "Title, company and status only. Never your notes." },
  { id: "selected_resumes", label: "Selected resumes", hint: "Resume statements and gate results, without contact details." },
  { id: "selected_cover_letters", label: "Selected cover letters", hint: "Cover letter sections with their evidence citations." },
  { id: "resume_templates", label: "Resume templates", hint: "Built-in ATS template names." },
];
const AGENT_KINDS = ["workspace_note_version", "opportunity_annotation", "material_draft_version", "follow_up_plan"];

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Checklist({ legend, options, value, onChange }: { legend: string; options: { id: string; label: string }[]; value: string[]; onChange: (next: string[]) => void }) {
  if (!options.length) return null;
  return (
    <fieldset className="mt-3">
      <legend className="metric-label">{legend}</legend>
      <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id))} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AgentWorkspace() {
  const ws = useAgentWorkspace();
  const [view, setView] = useState<View>("review");
  const [reviewing, setReviewing] = useState<AgentItemSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [canonical, setCanonical] = useState<CanonicalSnapshot | null>(null);
  const [selection, setSelection] = useState<ExportSelection>({ scopes: ["confirmed_evidence", "career_direction"], jobIds: [], applicationIds: [], resumeIds: [], coverLetterIds: [] });
  const [policyDraft, setPolicyDraft] = useState<string[] | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void gatherCanonicalSnapshot(getDesktopApi()).then(setCanonical).catch(() => setCanonical(null));
  }, []);
  useEffect(() => {
    if (ws.state && policyDraft === null) setPolicyDraft(ws.state.policy.autoImportKinds);
  }, [ws.state, policyDraft]);

  const visible = useMemo(() => {
    const states = VIEWS.find((v) => v.id === view)!.states;
    return ws.items.filter((i) => states.includes(i.state));
  }, [ws.items, view]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, v.id === "problems" ? ws.quarantine.filter((q) => q.status === "open").length : ws.items.filter((i) => v.states.includes(i.state)).length])), [ws.items, ws.quarantine]);

  const onFolder = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setSyncing(true);
    setActionError(null);
    setSyncResult(null);
    try {
      setSyncResult(await ws.syncFolder(files));
    } catch (cause) {
      setActionError(ws.messageOf(cause));
    } finally {
      setSyncing(false);
      if (folderInput.current) folderInput.current.value = "";
    }
  };

  const onExport = async () => {
    setActionError(null);
    setExportStatus(null);
    try {
      const result = await ws.createExport(selection);
      download(result.zip, `${result.exportId}.zip`);
      setExportStatus(`Export ${result.exportId} created with ${result.fileCount} files. Its receipt is stored in Job Ranger; extract the ZIP into the agents' workspace folder.`);
    } catch (cause) {
      setActionError(ws.messageOf(cause));
    }
  };

  const last = ws.state?.lastRun ?? null;
  const resultCounts = syncResult?.outcome.result.report.counts;

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill"><Bot className="h-3.5 w-3.5" aria-hidden="true" />Agent workspace</span>
        <h1 className="page-title mt-4">Review what your agents worked on while you were away.</h1>
        <p className="page-copy">
          Agents read an export you choose and write their work into a folder. Job Ranger checks every file, keeps their drafts
          separate from your records, and never lets an agent confirm evidence, change an application or claim a gate passed.
        </p>
        {ws.state && (
          <dl className="mt-5 grid gap-3 sm:grid-cols-4" data-testid="agent-workspace-summary">
            <div className="metric-card"><dt className="metric-label">Last sync</dt><dd className="metric-value text-base">{last ? new Date(last.completedAt).toLocaleString() : "Never"}</dd></div>
            <div className="metric-card"><dt className="metric-label">Needs review</dt><dd className="metric-value">{counts.review}</dd></div>
            <div className="metric-card"><dt className="metric-label">Drafts</dt><dd className="metric-value">{counts.drafts}</dd></div>
            <div className="metric-card"><dt className="metric-label">Problems</dt><dd className="metric-value">{counts.problems}</dd></div>
          </dl>
        )}
      </section>

      {(ws.error || actionError) && <p role="alert" className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">{actionError ?? ws.error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="panel px-6 py-6" aria-labelledby="sync-heading">
          <h2 id="sync-heading" className="flex items-center gap-2 text-lg font-semibold"><FolderSync className="h-5 w-5" aria-hidden="true" />Sync from a folder</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Choose the shared workspace folder. Only <code>workspace/agents</code> and <code>workspace/attachments</code> are read, and nothing is written back to it.
          </p>
          <input ref={folderInput} id="agent-folder" type="file" multiple className="sr-only" {...{ webkitdirectory: "", directory: "" }}
            onChange={(e) => void onFolder(e.target.files)} disabled={syncing} data-testid="agent-folder-input" />
          <label htmlFor="agent-folder" className={`primary-button mt-4 cursor-pointer ${syncing ? "opacity-60" : ""}`} tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); folderInput.current?.click(); } }}>
            {syncing ? "Syncing…" : "Choose folder and sync"}
          </label>
          {syncResult && resultCounts && (
            <div role="status" className="support-note mt-4 px-4 py-3 text-sm" data-testid="agent-sync-result">
              Sync #{syncResult.outcome.commit.runId} read {syncResult.filesRead} files: {resultCounts.imported_draft} imported, {resultCounts.staged_for_review} to review,
              {" "}{resultCounts.staged_draft + resultCounts.needs_rebase} drafts to check, {resultCounts.contested} conflicting, {resultCounts.pending_predecessor} waiting,
              {" "}{resultCounts.rejected} refused, {resultCounts.duplicates} duplicates ignored
              {(resultCounts.batches_incomplete ?? 0) + (resultCounts.batches_rejected ?? 0) > 0 && `; ${(resultCounts.batches_incomplete ?? 0) + (resultCounts.batches_rejected ?? 0)} batches held (see Problems)`}. {syncResult.outcome.result.downgrades.length > 0 && `${syncResult.outcome.result.downgrades.length} earlier drafts are now in conflict.`}
            </div>
          )}
          {policyDraft && (
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold">Import automatically as drafts</legend>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Only agent-owned work can be imported automatically. Claims and evidence proposals always wait for you.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {AGENT_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-3 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={policyDraft.includes(k)} onChange={(e) => setPolicyDraft(e.target.checked ? [...policyDraft, k] : policyDraft.filter((v) => v !== k))} />
                    {KIND_LABELS[k]}
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => void ws.setPolicy(policyDraft).catch((c) => setActionError(ws.messageOf(c)))}
                className="secondary-button mt-3 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={JSON.stringify([...policyDraft].sort()) === JSON.stringify(ws.state?.policy.autoImportKinds ?? [])}>
                Save import setting
              </button>
            </fieldset>
          )}
        </section>

        <section className="panel px-6 py-6" aria-labelledby="export-heading">
          <h2 id="export-heading" className="flex items-center gap-2 text-lg font-semibold"><Download className="h-5 w-5" aria-hidden="true" />Export for agents</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Agents only see what you select. Private notes, contact details and unconfirmed evidence are never included.</p>
          <fieldset className="mt-3">
            <legend className="metric-label">Include</legend>
            <div className="mt-2 grid gap-2">
              {SCOPES.map((s) => (
                <label key={s.id} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selection.scopes.includes(s.id)}
                    onChange={(e) => setSelection((cur) => ({ ...cur, scopes: e.target.checked ? [...cur.scopes, s.id] : cur.scopes.filter((v) => v !== s.id) }))} />
                  <span>{s.label}<span className="block text-xs text-[var(--color-text-muted)]">{s.hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {canonical && selection.scopes.includes("selected_opportunities") && (
            <Checklist legend="Jobs" options={canonical.jobs.slice(0, 200).map((j) => ({ id: j.id, label: j.title }))} value={selection.jobIds} onChange={(jobIds) => setSelection((c) => ({ ...c, jobIds }))} />
          )}
          {canonical && selection.scopes.includes("selected_applications") && (
            <Checklist legend="Applications" options={canonical.applications.map((a) => ({ id: a.id, label: `${a.title} at ${a.companyName}` }))} value={selection.applicationIds} onChange={(applicationIds) => setSelection((c) => ({ ...c, applicationIds }))} />
          )}
          {canonical && selection.scopes.includes("selected_resumes") && (
            <Checklist legend="Resumes" options={canonical.resumes.map((r) => ({ id: r.projection.id, label: r.projection.id }))} value={selection.resumeIds} onChange={(resumeIds) => setSelection((c) => ({ ...c, resumeIds }))} />
          )}
          {canonical && selection.scopes.includes("selected_cover_letters") && (
            <Checklist legend="Cover letters" options={canonical.coverLetters.map((c) => ({ id: c.id, label: `Cover letter v${c.version}` }))} value={selection.coverLetterIds} onChange={(coverLetterIds) => setSelection((c) => ({ ...c, coverLetterIds }))} />
          )}
          <button type="button" className="primary-button mt-4" onClick={() => void onExport()} disabled={!selection.scopes.length}>Create export ZIP</button>
          {exportStatus && <p role="status" className="support-note mt-4 px-4 py-3 text-sm">{exportStatus}</p>}
        </section>
      </div>

      <section className="panel mt-6 px-6 py-6" aria-labelledby="work-heading">
        <h2 id="work-heading" className="text-lg font-semibold">Agent work</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}
              className={view === v.id ? "primary-button" : "secondary-button"}>
              {v.label} <span className="sr-only">items:</span>({counts[v.id]})
            </button>
          ))}
        </div>
        {ws.truncated && <p className="mt-3 text-xs text-[var(--color-text-muted)]">Showing the first 2,000 items.</p>}

        {ws.loading ? <p role="status" className="mt-4 text-sm">Loading…</p> : view === "problems" ? (
          ws.quarantine.length === 0 ? <p className="support-note mt-4 px-5 py-4 text-sm">No problems. Incomplete uploads and refused files appear here.</p> : (
            <ul className="mt-4 space-y-3" data-testid="agent-problems">
              {ws.quarantine.map((q) => (
                <li key={q.quarantineKey} className="panel panel-muted rounded-2xl p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`soft-badge ${q.status === "open" ? "soft-badge-danger" : "soft-badge-info"}`}>{q.status === "open" ? (q.kind === "batch" ? "Batch held" : "Item refused") : "Resolved"}</span>
                    <span className="text-sm font-medium break-all">{q.location}</span>
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">
                    {q.reasons.map((r) => <li key={r}>{explain(r)}</li>)}
                  </ul>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {q.bytesRetained ? `Original ${q.byteLength ?? 0} bytes kept locally.` : q.byteLength ? "Too large to keep a copy; the file remains in the agent folder." : "Content kept locally."}
                    {" "}SHA-256 {q.sha256.slice(0, 12)}…
                  </p>
                </li>
              ))}
            </ul>
          )
        ) : visible.length === 0 ? (
          <p className="support-note mt-4 px-5 py-4 text-sm">{view === "review" ? "Nothing is waiting for review." : view === "drafts" ? "No agent drafts yet. Sync a workspace folder to see their work." : "No decisions yet."}</p>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="agent-items">
            {visible.map((item) => {
              const state = STATE_LABELS[item.state];
              return (
                <li key={`${item.operationId}|${item.contentSha256}`} className="panel panel-muted rounded-2xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="metric-label">{KIND_LABELS[item.kind] ?? item.kind}</p>
                      <h3 className="mt-1 text-base font-semibold break-words">{item.title}</h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Claimed by {item.actorClaim} (unverified) · agent-reported {item.authoredAt}</p>
                    </div>
                    <span className={`soft-badge soft-badge-${state.tone}`}>{state.label}</span>
                  </div>
                  {(item.contest.length > 0 || item.flags.length > 0) && (
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{explain(item.contest[0] ?? item.flags[0])}</p>
                  )}
                  <button type="button" className="secondary-button mt-3" onClick={() => setReviewing(item)} aria-label={`Review ${item.title}`}>Review</button>
                </li>
              );
            })}
          </ul>
        )}

        {view === "history" && ws.runs.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold">Recent syncs</h3>
            <ul className="mt-2 space-y-1 text-sm text-[var(--color-text-secondary)]">
              {ws.runs.map((r) => (
                <li key={r.runId}>#{r.runId} on {new Date(r.completedAt).toLocaleString()}: {r.counts.imported_draft ?? 0} imported, {r.counts.contested ?? 0} conflicting, {(r.counts.batches_rejected ?? 0) + (r.counts.batches_incomplete ?? 0)} batches held</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="mt-6 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Receipts, history and decisions stay in Job Ranger's local storage and are included in your backups. Workspace {ws.state?.workspaceId ?? "…"}.
      </p>

      <AgentItemReview item={reviewing} onClose={() => setReviewing(null)} getItem={ws.getItem} decide={ws.decide} messageOf={ws.messageOf} />
    </Layout>
  );
}
