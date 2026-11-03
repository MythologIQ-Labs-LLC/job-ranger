/**
 * Message protocol between the Sojourner web page (renderer) and its
 * dedicated runtime worker (the browser counterpart of Electron's main
 * process). Only structured-cloneable data crosses this boundary.
 */
import type { RuntimeInfo } from "../../shared/runtime";

export interface SelectedFilePayload {
  name: string;
  bytes: ArrayBuffer;
}

export type DialogPayload = { kind: "open"; files: SelectedFilePayload[] };

export interface DownloadPayload {
  fileName: string;
  mediaType: string;
  bytes: ArrayBuffer;
}

export type PageToWorkerMessage =
  | {
      type: "invoke";
      id: number;
      channel: string;
      args: unknown[];
      dialog?: DialogPayload;
    }
  /**
   * Demo flavor only, sent once right after the worker starts: this tab's demo
   * session id. The worker compares it with the workspace's demo sentinel to
   * decide whether to keep, replace or refuse to touch the workspace. The
   * standard-flavor worker ignores it.
   */
  | { type: "demo-session"; sessionId: string };

/** Demo flavor only: what the worker did to the demo workspace at startup. */
export interface DemoWorkspaceStartup {
  reset: boolean;
  reason: "empty" | "new-session" | "idle" | "incomplete-seed" | null;
  seeded: boolean;
}

/**
 * Standard flavor: where the workspace was opened from. "migrated" means this start copied a
 * legacy (pre-rename) workspace to the new root; "legacy-fallback" means that copy failed, was
 * removed, and this session runs from the untouched legacy root (the copy is retried next start).
 */
export interface WorkspaceStartup {
  root: "current" | "legacy-fallback";
  migrated: boolean;
}

export type WorkerFailureCode =
  | "storage-unsupported"
  | "storage-unavailable"
  | "startup-failed"
  /** Demo flavor: storage holds a workspace without a demo sentinel; the demo will not erase it. */
  | "demo-workspace-refused";

export type WorkerToPageMessage =
  | { type: "waiting-for-lock" }
  | { type: "ready"; info: RuntimeInfo; demo?: DemoWorkspaceStartup; workspace?: WorkspaceStartup }
  | {
      type: "fatal";
      code: WorkerFailureCode;
      message: string;
      /** The workspace could not be opened, but a Sojourner backup can still be validated and restored. */
      recoverableWithBackup?: boolean;
    }
  | {
      type: "result";
      id: number;
      ok: true;
      value: unknown;
      downloads: DownloadPayload[];
    }
  | { type: "result"; id: number; ok: false; error: { name: string; message: string } }
  | { type: "event"; event: "relaunch" }
  | { type: "event"; event: "open-external"; url: string }
  | { type: "event"; event: "download"; download: DownloadPayload }
  | { type: "event"; event: "storage-failure"; message: string };

export const RUNTIME_LOCK_NAME = "sojourner-web-runtime-v1";
export const USER_DATA_DIRECTORY = "/sojourner";
export const DATA_DIRECTORY = "/sojourner/data";
export const IO_DIRECTORY = "/sojourner-io";
/** The workspace database file inside DATA_DIRECTORY (the shared core's name for it). */
export const DATABASE_FILE_NAME = "sojourner.sqlite3";

/*
 * LEGACY_*: names used by builds released as "Job Ranger" (before the Sojourner rename).
 * They exist only so the renamed build can find, lock out and migrate an existing browser
 * workspace (src/pwa/runtime/workspace-migration.ts). Nothing new is ever written under them.
 */
/** Legacy runtime lock: also held, so a tab still running a legacy build never writes concurrently. */
export const LEGACY_RUNTIME_LOCK_NAME = "job-ranger-web-runtime-v1";
/** Legacy OPFS workspace root: copied (never moved, changed or deleted) to USER_DATA_DIRECTORY. */
export const LEGACY_USER_DATA_DIRECTORY = "/job-ranger";
/** Legacy database file name inside the legacy data directory. */
export const LEGACY_DATABASE_FILE_NAME = "jobscout.sqlite3";

export function mediaTypeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}
