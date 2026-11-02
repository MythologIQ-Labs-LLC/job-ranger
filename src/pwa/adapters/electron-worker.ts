/**
 * Web runtime adapter for the `electron` module inside the runtime worker.
 *
 * It lets the shared IPC registration modules (core-ipc, resume-ipc,
 * backup-ipc, evidence-extension-ipc, ...) run unchanged: `ipcMain.handle`
 * registers into the worker's channel table, and dialogs/shell calls are
 * translated into explicit, user-initiated browser interactions.
 *
 * Dialog contract: the page shows the browser file picker *inside the user's
 * click* (browsers require user activation) and sends the chosen file with
 * the invoke message. Handlers call `dialog.show*Dialog` synchronously at
 * entry (before any await), so the worker binds the selection to exactly the
 * invocation that carried it. A dialog call without a bound invocation fails
 * closed.
 */
import { basename, join } from "./node-path";
import { promises as fs } from "./node-fs";
import { IO_DIRECTORY, mediaTypeForFileName, type DownloadPayload } from "../runtime/protocol";
import { fileBytesForTransfer } from "../runtime/transfer-file-bytes";

type Handler = (event: { sender: null }, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();

export interface InvocationContext {
  openPaths: string[] | null;
  saveTargets: string[];
}

let currentInvocation: InvocationContext | null = null;

type HostEvent =
  | { event: "relaunch" }
  | { event: "open-external"; url: string }
  | { event: "download"; download: DownloadPayload };

let hostEventSink: (event: HostEvent) => void = () => undefined;

export function setHostEventSink(sink: (event: HostEvent) => void): void {
  hostEventSink = sink;
}

export function getRegisteredChannels(): string[] {
  return Array.from(handlers.keys()).sort();
}

export function dispatchInvocation(
  channel: string,
  args: unknown[],
  context: InvocationContext,
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) {
    return Promise.reject(new Error(`No handler registered for '${channel}'`));
  }
  currentInvocation = context;
  try {
    return Promise.resolve(handler({ sender: null }, ...args));
  } catch (error) {
    return Promise.reject(error);
  } finally {
    currentInvocation = null;
  }
}

function requireInvocation(kind: string): InvocationContext {
  if (!currentInvocation) {
    throw new Error(`${kind} must be requested synchronously by a user-initiated invocation`);
  }
  return currentInvocation;
}

export const ipcMain = {
  handle(channel: string, handler: Handler): void {
    if (handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`);
    }
    handlers.set(channel, handler);
  },
  removeHandler(channel: string): void {
    handlers.delete(channel);
  },
};

export const dialog = {
  async showOpenDialog(_options?: unknown): Promise<{ canceled: boolean; filePaths: string[] }> {
    const invocation = requireInvocation("A file selection");
    const paths = invocation.openPaths;
    invocation.openPaths = null;
    return paths && paths.length > 0
      ? { canceled: false, filePaths: paths }
      : { canceled: true, filePaths: [] };
  },
  async showSaveDialog(options?: { defaultPath?: string }): Promise<{ canceled: boolean; filePath?: string }> {
    const invocation = requireInvocation("A save location");
    const fileName = basename(options?.defaultPath || "job-ranger-export");
    const filePath = join(IO_DIRECTORY, "outbox", crypto.randomUUID(), fileName);
    invocation.saveTargets.push(filePath);
    return { canceled: false, filePath };
  },
  showErrorBox(title: string, content: string): void {
    console.error(`${title}: ${content}`);
  },
};

let appVersion = "0.0.0";

export function setAppVersion(version: string): void {
  appVersion = version;
}

export const app = {
  getVersion: () => appVersion,
  getPath: (_name: string) => "/job-ranger",
  isPackaged: true,
  relaunch: () => hostEventSink({ event: "relaunch" }),
  exit: (_code?: number) => undefined,
  quit: () => undefined,
  commandLine: { hasSwitch: () => false },
};

export const shell = {
  async openExternal(url: string): Promise<void> {
    hostEventSink({ event: "open-external", url });
  },
  showItemInFolder(targetPath: string): void {
    void (async () => {
      const bytes = (await fs.readFile(targetPath)) as Uint8Array;
      const fileName = basename(targetPath);
      hostEventSink({
        event: "download",
        download: { fileName, mediaType: mediaTypeForFileName(fileName), bytes: fileBytesForTransfer(bytes) },
      });
    })().catch((error) => console.error("Could not provide the managed file", error));
  },
  async openPath(_target: string): Promise<string> {
    return "Opening folders is not available in the web runtime";
  },
};

export class BrowserWindow {
  constructor() {
    throw new Error("Hidden browser windows are not available in the web runtime");
  }
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
}

export const contextBridge = {
  exposeInMainWorld(): void {
    throw new Error("contextBridge is not available inside the runtime worker");
  },
};

export const ipcRenderer = {
  invoke(): Promise<never> {
    return Promise.reject(new Error("ipcRenderer is not available inside the runtime worker"));
  },
};

export default { app, dialog, ipcMain, shell, BrowserWindow, contextBridge, ipcRenderer };
