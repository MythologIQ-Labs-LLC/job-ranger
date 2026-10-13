// Builds reconciliation submissions from a user-chosen local workspace folder (#286 G3).
// Works on plain {path, bytes} pairs so the same code serves a browser directory picker in
// the PWA and Electron renderer, tests, and later the Drive transport. Only the conventional
// layout is read: workspace/agents/<actor>/batches/<batch_id>.json, its .commit.json marker
// and the attachments that marker declares. Anything else is ignored and reported.

import { LIMITS, parseCommitMarker } from "./schema.ts";
import type { Submission } from "./reconcile.ts";

export interface WorkspaceFile {
  /** Path relative to the chosen folder, using "/" separators. */
  path: string;
  bytes: Uint8Array;
}

export interface WorkspaceScan {
  submissions: Submission[];
  skipped: { path: string; reason: string }[];
}

const BATCH = /^workspace\/agents\/[^/]+\/batches\/[^/]+\.json$/;

/** Normalises a picker path and strips the chosen folder's own name when present. */
export function normaliseWorkspacePath(raw: string): string | null {
  const path = raw.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  const at = parts.indexOf("workspace");
  if (at < 0 || at > 1) return null;
  return parts.slice(at).join("/");
}

export function scanWorkspaceFiles(files: WorkspaceFile[]): WorkspaceScan {
  const byPath = new Map<string, Uint8Array>();
  const skipped: WorkspaceScan["skipped"] = [];
  for (const file of files) {
    const path = normaliseWorkspacePath(file.path);
    if (!path) { skipped.push({ path: file.path.slice(0, 240), reason: "outside_workspace_layout" }); continue; }
    if (byPath.has(path)) { skipped.push({ path, reason: "duplicate_path" }); continue; }
    byPath.set(path, file.bytes);
  }
  const submissions: Submission[] = [];
  for (const path of [...byPath.keys()].sort()) {
    if (!BATCH.test(path) || path.endsWith(".commit.json")) continue;
    const batchBytes = byPath.get(path)!;
    if (batchBytes.length > LIMITS.maxBatchBytes) {
      // Still reported: the reconciler rejects it as too large and records its full digest.
      submissions.push({ location: path, batchBytes, commitBytes: null, attachments: {} });
      continue;
    }
    const commitPath = path.replace(/\.json$/, ".commit.json");
    const commitBytes = byPath.get(commitPath) ?? null;
    const attachments: Record<string, Uint8Array> = {};
    const marker = commitBytes && commitBytes.length <= LIMITS.maxCommitBytes ? parseCommitMarker(commitBytes) : null;
    if (marker?.ok) {
      for (const attachment of marker.value.attachments) {
        const bytes = byPath.get(attachment.path);
        if (bytes && bytes.length <= LIMITS.maxAttachmentBytes) attachments[attachment.path] = bytes;
      }
    }
    submissions.push({ location: path, batchBytes, commitBytes, attachments });
  }
  return { submissions, skipped };
}
