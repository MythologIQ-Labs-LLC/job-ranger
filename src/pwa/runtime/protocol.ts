/**
 * Message protocol between the Job Ranger web page (renderer) and its
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
   * Demo flavor only, sent once right after the worker starts: whether this
   * tab begins a new demo session (wipe + reseed before opening the database).
   * The standard-flavor worker ignores it.
   */
  | { type: "demo-session"; reset: boolean };

/** Demo flavor only: what the worker did to the session-scoped demo workspace at startup. */
export interface DemoWorkspaceStartup {
  reset: boolean;
  seeded: boolean;
}

export type WorkerFailureCode =
  | "storage-unsupported"
  | "storage-unavailable"
  | "startup-failed";

export type WorkerToPageMessage =
  | { type: "waiting-for-lock" }
  | { type: "ready"; info: RuntimeInfo; demo?: DemoWorkspaceStartup }
  | { type: "fatal"; code: WorkerFailureCode; message: string }
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

export const RUNTIME_LOCK_NAME = "job-ranger-web-runtime-v1";
export const USER_DATA_DIRECTORY = "/job-ranger";
export const DATA_DIRECTORY = "/job-ranger/data";
export const IO_DIRECTORY = "/job-ranger-io";

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
