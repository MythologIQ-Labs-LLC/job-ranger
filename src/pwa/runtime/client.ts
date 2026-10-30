/**
 * Page-side client for the Sojourner web runtime worker. It plays the role
 * of Electron's `ipcRenderer` + native dialogs for the shared preload bridge.
 */
import type { RuntimeInfo } from "../../shared/runtime";
import { validateExternalUrl } from "../../../electron/src/validators/common.cjs";
import { isDemoListing } from "../../shared/demo-listing";
import type {
  DemoWorkspaceStartup,
  DialogPayload,
  DownloadPayload,
  PageToWorkerMessage,
  WorkerFailureCode,
  WorkerToPageMessage,
} from "./protocol";
import { RECOVERY_CHANNELS } from "./workspace-recovery";

export type RuntimeBootState =
  | { status: "starting" }
  | { status: "waiting-for-lock" }
  | { status: "ready"; info: RuntimeInfo; demo?: DemoWorkspaceStartup }
  | { status: "failed"; code: WorkerFailureCode; message: string; recoverableWithBackup?: boolean };

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface OpenDialogSpec {
  accept: string;
  maxBytes: number;
  label: string;
}

const MiB = 1024 * 1024;

/**
 * Channels whose handler starts with a native "open file" dialog. In the
 * browser the picker must be shown inside the user's click, before the
 * request reaches the worker.
 */
export const OPEN_DIALOG_CHANNELS: Record<string, OpenDialogSpec> = {
  "career:select-resume-import": {
    accept: ".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    maxBytes: 50 * MiB,
    label: "resume or career document",
  },
  "json-resume:import": { accept: ".json,application/json", maxBytes: 10 * MiB, label: "JSON Resume file" },
  "backups:select-restore": { accept: ".jobranger", maxBytes: 1024 * MiB, label: "Sojourner backup" },
};

export const STORAGE_FAILURE_EVENT = "job-ranger:storage-failure";
export const BOOT_STATE_EVENT = "job-ranger:boot-state";

function pickFile(spec: OpenDialogSpec): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = spec.accept;
    input.style.position = "fixed";
    input.style.left = "-10000px";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function triggerDownload(download: DownloadPayload): void {
  const blob = new Blob([download.bytes], { type: download.mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export class WebRuntimeClient {
  private readonly worker: Worker;
  private readonly calls = new Map<number, PendingCall>();
  private nextId = 1;
  private state: RuntimeBootState = { status: "starting" };
  private readonly stateListeners = new Set<(state: RuntimeBootState) => void>();

  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent<WorkerToPageMessage>) => this.onMessage(event.data));
    worker.addEventListener("error", (event) => {
      this.setState({
        status: "failed",
        code: "startup-failed",
        message: event.message || "The Sojourner runtime worker failed to start.",
      });
    });
  }

  get bootState(): RuntimeBootState {
    return this.state;
  }

  onStateChange(listener: (state: RuntimeBootState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(state: RuntimeBootState): void {
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
    window.dispatchEvent(new CustomEvent(BOOT_STATE_EVENT, { detail: state }));
    if (state.status === "failed") {
      for (const call of this.calls.values()) call.reject(new Error(state.message));
      this.calls.clear();
    }
  }

  private onMessage(message: WorkerToPageMessage): void {
    switch (message.type) {
      case "waiting-for-lock":
        this.setState({ status: "waiting-for-lock" });
        return;
      case "ready":
        this.setState(
          message.demo ? { status: "ready", info: message.info, demo: message.demo } : { status: "ready", info: message.info },
        );
        return;
      case "fatal":
        this.setState({
          status: "failed",
          code: message.code,
          message: message.message,
          recoverableWithBackup: message.recoverableWithBackup === true,
        });
        return;
      case "result": {
        const call = this.calls.get(message.id);
        if (!call) return;
        this.calls.delete(message.id);
        if (message.ok) {
          for (const download of message.downloads) triggerDownload(download);
          call.resolve(message.value);
        } else {
          const error = new Error(message.error.message);
          error.name = message.error.name;
          call.reject(error);
        }
        return;
      }
      case "event":
        this.onEvent(message);
        return;
    }
  }

  private onEvent(message: Extract<WorkerToPageMessage, { type: "event" }>): void {
    switch (message.event) {
      case "relaunch":
        window.location.reload();
        return;
      case "open-external": {
        // Validated again on the page side: defense in depth for navigation.
        const url = validateExternalUrl(message.url);
        // Fictional demo listings live on a reserved, non-resolving host; the UI explains
        // that instead of navigating, and this boundary never opens one either.
        if (isDemoListing(url)) return;
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      case "download":
        triggerDownload(message.download);
        return;
      case "storage-failure":
        window.dispatchEvent(new CustomEvent(STORAGE_FAILURE_EVENT, { detail: message.message }));
        return;
    }
  }

  private send(channel: string, args: unknown[], dialog?: DialogPayload): Promise<unknown> {
    if (this.state.status === "failed" && !(this.state.recoverableWithBackup && RECOVERY_CHANNELS.has(channel))) {
      return Promise.reject(new Error(this.state.message));
    }
    const id = this.nextId++;
    const message: PageToWorkerMessage = { type: "invoke", id, channel, args, dialog };
    const transfer = dialog?.files.map((file) => file.bytes) ?? [];
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const spec = OPEN_DIALOG_CHANNELS[channel];
    if (!spec) return this.send(channel, args);
    const file = await pickFile(spec);
    if (!file) return null;
    if (file.size > spec.maxBytes) {
      throw new Error(
        `The selected ${spec.label} is ${(file.size / MiB).toFixed(1)} MB, which exceeds the web app's ${(spec.maxBytes / MiB).toFixed(0)} MB limit for this import.`,
      );
    }
    const bytes = await file.arrayBuffer();
    return this.send(channel, args, { kind: "open", files: [{ name: file.name, bytes }] });
  }
}

let activeClient: WebRuntimeClient | null = null;

export function setActiveWebRuntimeClient(client: WebRuntimeClient): void {
  activeClient = client;
}

export function requireWebRuntimeClient(): WebRuntimeClient {
  if (!activeClient) throw new Error("The Sojourner web runtime has not started");
  return activeClient;
}
