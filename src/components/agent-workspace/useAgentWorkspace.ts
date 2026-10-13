import { useCallback, useEffect, useRef, useState } from "react";
import { createAgentExport, gatherCanonicalSnapshot, type ExportScope } from "../../agent-workspace/index.ts";
import { syncAgentWorkspace, type SyncOutcome } from "../../agent-workspace/sync.ts";
import { scanWorkspaceFiles, type WorkspaceFile } from "../../agent-workspace/workspace-files.ts";
import { createZip } from "../../agent-workspace/zip.ts";
import { getDesktopApi } from "../../services/api";
import type {
  AgentDecisionInput,
  AgentItemDetail,
  AgentItemSummary,
  AgentQuarantineSummary,
  AgentRunSummary,
  AgentWorkspaceStateDto,
} from "../../shared/agent-workspace-api";
import batchSchema from "../../../docs/design/schemas/jr-agent-operation-batch-v2.schema.json";
import commitSchema from "../../../docs/design/schemas/jr-agent-batch-commit-v1.schema.json";

const MAX_FOLDER_FILES = 5_000;
const MAX_FOLDER_BYTES = 256 * 1024 * 1024;
const MAX_ITEMS_SHOWN = 2_000;

export interface ExportSelection {
  scopes: ExportScope[];
  jobIds: string[];
  applicationIds: string[];
  resumeIds: string[];
  coverLetterIds: string[];
}

export interface SyncSummary {
  filesRead: number;
  skipped: { path: string; reason: string }[];
  outcome: SyncOutcome;
}

/** Strips milliseconds: export and run timestamps use whole UTC seconds. */
export const utcNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // IPC wraps backend errors; keep the readable part.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function useAgentWorkspace() {
  const [state, setState] = useState<AgentWorkspaceStateDto | null>(null);
  const [items, setItems] = useState<AgentItemSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [quarantine, setQuarantine] = useState<AgentQuarantineSummary[]>([]);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const api = getDesktopApi().agentWorkspace;
      const [nextState, nextQuarantine, nextRuns] = await Promise.all([api.getState(), api.listQuarantine(), api.listRuns(10)]);
      const collected: AgentItemSummary[] = [];
      let cursor: string | null = null;
      do {
        const page = await api.listItems({ cursor, limit: 500 });
        collected.push(...page.rows);
        cursor = page.nextCursor;
      } while (cursor && collected.length < MAX_ITEMS_SHOWN);
      setState(nextState);
      setItems(collected);
      setTruncated(cursor !== null);
      setQuarantine(nextQuarantine);
      setRuns(nextRuns);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guarded = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    if (busy.current) throw new Error("Another agent workspace action is still running.");
    busy.current = true;
    try {
      return await run();
    } finally {
      busy.current = false;
    }
  }, []);

  /** Reads a chosen folder and reconciles it into local storage in one atomic commit. */
  const syncFolder = useCallback((fileList: FileList | File[]) => guarded(async (): Promise<SyncSummary> => {
    const files = Array.from(fileList);
    if (files.length > MAX_FOLDER_FILES) throw new Error(`That folder has more than ${MAX_FOLDER_FILES} files. Choose the agent workspace folder itself.`);
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_FOLDER_BYTES) throw new Error("That folder is larger than Job Ranger reads in one sync (256 MB).");
    const workspaceFiles: WorkspaceFile[] = [];
    for (const file of files) {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      // Only the agent layout is read; everything else is never opened.
      if (!/(^|\/)workspace\/(agents|attachments)\//.test(path.replace(/\\/g, "/"))) continue;
      workspaceFiles.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    const scan = scanWorkspaceFiles(workspaceFiles);
    const canonical = await gatherCanonicalSnapshot(getDesktopApi());
    const outcome = await syncAgentWorkspace({ store: getDesktopApi().agentWorkspace, canonical, submissions: scan.submissions, now: utcNow });
    await refresh();
    return { filesRead: workspaceFiles.length, skipped: scan.skipped, outcome };
  }), [guarded, refresh]);

  /** Creates an export, records its receipt locally first, then returns a ZIP to save. */
  const createExport = useCallback((selection: ExportSelection) => guarded(async () => {
    const api = getDesktopApi();
    const current = await api.agentWorkspace.getState();
    const canonical = await gatherCanonicalSnapshot(api);
    const createdAt = utcNow();
    const exportId = `ex_${createdAt.replace(/[-:TZ]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
    const result = await createAgentExport(canonical, {
      exportId,
      workspaceId: current.workspaceId,
      createdAt,
      build: "job-ranger-app",
      scopes: selection.scopes,
      selectedJobIds: selection.jobIds,
      selectedApplicationIds: selection.applicationIds,
      selectedResumeIds: selection.resumeIds,
      selectedCoverLetterIds: selection.coverLetterIds,
      schemaDocuments: [
        { path: "schema/jr-agent-operation-batch-v2.schema.json", text: `${JSON.stringify(batchSchema, null, 2)}\n` },
        { path: "schema/jr-agent-batch-commit-v1.schema.json", text: `${JSON.stringify(commitSchema, null, 2)}\n` },
      ],
    });
    // The trusted receipt is stored locally before anything leaves Job Ranger.
    await api.agentWorkspace.recordExport(result.receipt as unknown as Record<string, unknown>);
    const zip = createZip([
      { path: `${exportId}/manifest.json`, bytes: result.manifestBytes },
      ...result.files.map((f) => ({ path: `${exportId}/${f.path}`, bytes: f.bytes })),
    ]);
    await refresh();
    return { exportId, zip, fileCount: result.files.length + 1, manifestSha256: result.manifestSha256 };
  }), [guarded, refresh]);

  const setPolicy = useCallback(async (autoImportKinds: string[]) => {
    const next = await getDesktopApi().agentWorkspace.setPolicy({ autoImportKinds });
    setState(next);
  }, []);

  const getItem = useCallback((operationId: string, contentSha256: string) => getDesktopApi().agentWorkspace.getItem(operationId, contentSha256), []);

  const decide = useCallback(async (decision: AgentDecisionInput): Promise<AgentItemDetail> => {
    const updated = await getDesktopApi().agentWorkspace.decide(decision);
    await refresh();
    return updated;
  }, [refresh]);

  return { state, items, truncated, quarantine, runs, loading, error, refresh, syncFolder, createExport, setPolicy, getItem, decide, messageOf };
}
