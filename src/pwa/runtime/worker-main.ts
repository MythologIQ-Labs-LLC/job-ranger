/**
 * Sojourner web runtime worker — the browser counterpart of Electron's main
 * process. It owns local persistence and runs the shared Sojourner
 * application core (the same modules Electron runs), registering the same IPC
 * channel table with the same boundary validators.
 *
 * Single-writer guarantee: the worker holds an exclusive Web Lock for its
 * whole lifetime, so two tabs can never write the same local database.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { JobScoutBackend } from "../../../electron/src/backend.cjs";
import { CareerBackend } from "../../../electron/src/career-backend.cjs";
import { RequirementBackend } from "../../../electron/src/requirement-backend.cjs";
import { registerCoreIpcHandlers } from "../../../electron/src/core-ipc.cjs";
import { initializeEvidenceExtensionIpc } from "../../../electron/src/evidence-extension-ipc.cjs";
import { initializeResumeIpc } from "../../../electron/src/resume-ipc.cjs";
import { initializeBackupIpc } from "../../../electron/src/backup-ipc.cjs";
import { applyPendingRestore } from "../../../electron/src/backup-service.cjs";
import { seedDemoWorkspace } from "../../../electron/src/demo-seed.cjs";
import { IS_DEMO_FLAVOR } from "../../demo/flavor";
import type { RuntimeInfo } from "../../shared/runtime";
import { WEB_CAPABILITIES, WEB_RUNNABLE_SOURCE_TYPES } from "../../shared/runtime";
import { createPinnedFetch } from "../adapters/pinned-fetch";
import {
  dispatchInvocation,
  ipcMain,
  setAppVersion,
  setHostEventSink,
  type InvocationContext,
} from "../adapters/electron-worker";
import { JobRangerStorageError, onStorageFailure, promises as fs } from "../adapters/node-fs";
import { basename, dirname, join } from "../adapters/node-path";
import {
  DATA_DIRECTORY,
  IO_DIRECTORY,
  mediaTypeForFileName,
  RUNTIME_LOCK_NAME,
  USER_DATA_DIRECTORY,
  type DemoWorkspaceStartup,
  type DownloadPayload,
  type PageToWorkerMessage,
  type WorkerToPageMessage,
} from "./protocol";
import { setActiveWasmSqliteEngine, WasmSqliteEngine } from "./wasm-sqlite-engine";
import {
  DEMO_REFUSAL_MESSAGE,
  createDemoSentinel,
  decideDemoStartup,
  resetDemoWorkspace,
  shouldRecordDemoActivity,
  writeDemoSentinel,
  type DemoWorkspaceFs,
  type DemoWorkspaceSentinel,
} from "./demo-workspace";
import { fileBytesForTransfer } from "./transfer-file-bytes";
import { canOfferRestoreFromBackup, RECOVERY_CHANNELS } from "./workspace-recovery";

declare const __JOB_RANGER_VERSION__: string;
declare const __JOB_RANGER_BUILD_ID__: string;

interface WorkerScope {
  postMessage(message: WorkerToPageMessage, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PageToWorkerMessage>) => void): void;
  navigator: Navigator;
}

const scope = self as unknown as WorkerScope;
const appVersion = __JOB_RANGER_VERSION__;
const buildId = __JOB_RANGER_BUILD_ID__;
const pending: Extract<PageToWorkerMessage, { type: "invoke" }>[] = [];
let ready = false;
/**
 * When the workspace database is damaged, only RECOVERY_CHANNELS are served, so a user can restore
 * a .jobranger backup. Restore never reads or writes the damaged database: it validates the backup,
 * stages it beside the workspace, and the next start swaps it in through applyPendingRestore before
 * anything opens the database. See workspace-recovery.ts for when it is offered.
 */
let recoveryMode = false;
/** applyPendingRestore finished; a failure there is never answered with another restore. */
let pendingRestoreSettled = false;
let backupIpcRegistered = false;
/** Validating a backup needs the SQLite engine; recovery is offered only once it is running. */
let engineReady = false;

function post(message: WorkerToPageMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

setAppVersion(appVersion);
setHostEventSink((event) => {
  if (event.event === "download") {
    post({ type: "event", event: "download", download: event.download }, [event.download.bytes]);
  } else {
    post({ type: "event", ...event } as WorkerToPageMessage);
  }
});
onStorageFailure((error) => post({ type: "event", event: "storage-failure", message: error.message }));

async function storageStatus(): Promise<RuntimeInfo["storage"]> {
  const warnings: string[] = [];
  let persisted: boolean | null = null;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    persisted = await scope.navigator.storage.persisted();
  } catch {
    persisted = null;
  }
  try {
    const estimate = await scope.navigator.storage.estimate();
    usage = estimate.usage ?? null;
    quota = estimate.quota ?? null;
  } catch {
    // Estimates are advisory; absence is reported as unknown.
  }
  const nearlyFull = usage !== null && quota !== null && quota > 0 && usage / quota > 0.8;
  if (IS_DEMO_FLAVOR) {
    // The demo workspace is temporary sample data: persistence and backup advice do not apply.
    if (nearlyFull) warnings.push("Browser storage for this demo is more than 80% full. Use Reset demo to start again from the sample data.");
  } else {
    if (persisted !== true) {
      warnings.push(
        "This browser has not granted persistent storage, so it may evict Sojourner data under storage pressure. Install the app or allow persistent storage, and export backups regularly.",
      );
    }
    if (nearlyFull) {
      warnings.push("Browser storage for Sojourner is more than 80% full. Export a backup and free space.");
    }
  }
  return {
    location: IS_DEMO_FLAVOR
      ? "This browser's private storage for this demo site (temporary demo workspace, replaced with fresh sample data in each new demo session)"
      : "This browser profile's private storage for this site (origin-private file system)",
    engine: "SQLite WASM",
    persisted,
    usageBytes: usage,
    quotaBytes: quota,
    warnings,
  };
}

async function runtimeInfo(): Promise<RuntimeInfo> {
  return {
    kind: "web",
    channel: "web",
    appVersion,
    buildId,
    platform: `web (${scope.navigator.userAgent})`,
    capabilities: { ...WEB_CAPABILITIES },
    storage: await storageStatus(),
  };
}

async function writeInbox(files: { name: string; bytes: ArrayBuffer }[]): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const directory = join(IO_DIRECTORY, "inbox", crypto.randomUUID());
    await fs.mkdir(directory, { recursive: true });
    const candidate = basename(file.name.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").slice(0, 200);
    const safeName = candidate && candidate !== "." && candidate !== ".." ? candidate : "selected-file";
    const target = join(directory, safeName);
    await fs.writeFile(target, new Uint8Array(file.bytes));
    paths.push(target);
  }
  return paths;
}

async function collectDownloads(paths: string[]): Promise<DownloadPayload[]> {
  const downloads: DownloadPayload[] = [];
  for (const target of paths) {
    try {
      const bytes = (await fs.readFile(target)) as Uint8Array;
      const fileName = basename(target);
      downloads.push({
        fileName,
        mediaType: mediaTypeForFileName(fileName),
        bytes: fileBytesForTransfer(bytes),
      });
    } catch {
      // The handler did not produce this file (e.g. it failed before writing).
    }
  }
  return downloads;
}

async function cleanupIo(paths: string[]): Promise<void> {
  for (const target of paths) {
    await fs.rm(dirname(target), { recursive: true, force: true }).catch(() => undefined);
  }
}

// Demo flavor only: the workspace's ownership sentinel (src/pwa/runtime/demo-workspace.ts).
const demoFs = fs as unknown as DemoWorkspaceFs;
let demoSentinel: DemoWorkspaceSentinel | null = null;
let demoActivityRecordedAt = 0;

/** Demo flavor: refresh the sentinel's lastActiveAt, at most every few minutes. */
function recordDemoActivity(): void {
  if (!demoSentinel) return;
  const now = Date.now();
  if (!shouldRecordDemoActivity(demoActivityRecordedAt, now)) return;
  demoActivityRecordedAt = now;
  demoSentinel = { ...demoSentinel, lastActiveAt: new Date(now).toISOString() };
  void writeDemoSentinel(demoFs, USER_DATA_DIRECTORY, demoSentinel).catch(() => undefined);
}

async function handleInvoke(message: Extract<PageToWorkerMessage, { type: "invoke" }>): Promise<void> {
  if (IS_DEMO_FLAVOR) recordDemoActivity();
  const openPaths = message.dialog?.kind === "open" ? await writeInbox(message.dialog.files) : null;
  const context: InvocationContext = { openPaths, saveTargets: [] };
  try {
    const value = await dispatchInvocation(message.channel, message.args, context);
    const downloads = await collectDownloads(context.saveTargets);
    post(
      { type: "result", id: message.id, ok: true, value, downloads },
      downloads.map((download) => download.bytes),
    );
  } catch (error) {
    post({
      type: "result",
      id: message.id,
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    await cleanupIo([...(openPaths ?? []), ...context.saveTargets]);
  }
}

// Demo flavor only: the page sends this tab's demo session id once, at startup.
// The standard flavor never waits for (or acts on) this message.
let resolveDemoSession: (sessionId: string) => void = () => undefined;
const demoSessionRequest = new Promise<string>((resolve) => {
  resolveDemoSession = resolve;
});

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (IS_DEMO_FLAVOR && message?.type === "demo-session") {
    resolveDemoSession(String(message.sessionId));
    return;
  }
  if (!message || message.type !== "invoke") return;
  if (!ready) {
    if (recoveryMode && RECOVERY_CHANNELS.has(message.channel)) {
      void handleInvoke(message);
      return;
    }
    pending.push(message);
    return;
  }
  void handleInvoke(message);
});

async function acquireExclusiveLock(): Promise<void> {
  const locks = (scope.navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) {
    throw new JobRangerStorageError(
      "This browser cannot guarantee that only one Sojourner tab writes your data (Web Locks are unavailable).",
      "EUNSUPPORTED",
    );
  }
  await new Promise<void>((resolve, reject) => {
    let granted = false;
    void locks
      .request(RUNTIME_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) return;
        granted = true;
        resolve();
        await new Promise(() => undefined);
      })
      .then(() => {
        if (granted) return;
        post({ type: "waiting-for-lock" });
        void locks
          .request(RUNTIME_LOCK_NAME, { mode: "exclusive" }, async () => {
            resolve();
            await new Promise(() => undefined);
          })
          .catch(reject);
      })
      .catch(reject);
  });
}

async function verifyStorage(): Promise<void> {
  const probeDirectory = join(IO_DIRECTORY, "probe");
  await fs.mkdir(probeDirectory, { recursive: true });
  const probe = join(probeDirectory, `probe-${crypto.randomUUID()}.bin`);
  await fs.writeFile(probe, new Uint8Array([1, 2, 3]));
  const back = (await fs.readFile(probe)) as Uint8Array;
  if (back.length !== 3 || back[2] !== 3) throw new JobRangerStorageError("Browser storage returned different bytes than were written.", "EIO");
  await fs.rm(IO_DIRECTORY, { recursive: true, force: true });
}

async function boot(): Promise<void> {
  try {
    await acquireExclusiveLock();
    await verifyStorage();
  } catch (error) {
    const unsupported = (error as { code?: string }).code === "EUNSUPPORTED";
    post({
      type: "fatal",
      code: unsupported ? "storage-unsupported" : "storage-unavailable",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  let demo: DemoWorkspaceStartup | undefined;
  let demoClaim: DemoWorkspaceSentinel | null = null;
  try {
    if (IS_DEMO_FLAVOR) {
      // Demo flavor, under the exclusive lock and BEFORE anything opens the workspace:
      // keep it, replace it with fresh sample data, or refuse to touch a workspace that
      // carries no demo sentinel (it may be someone's real workspace).
      const sessionId = await demoSessionRequest;
      const now = Date.now();
      const decision = await decideDemoStartup(demoFs, { userDataDirectory: USER_DATA_DIRECTORY, sessionId, now });
      if (decision.action === "refuse") {
        post({ type: "fatal", code: "demo-workspace-refused", message: DEMO_REFUSAL_MESSAGE });
        return;
      }
      if (decision.action === "reset") {
        demoClaim = await resetDemoWorkspace(
          demoFs,
          { userDataDirectory: USER_DATA_DIRECTORY, ioDirectory: IO_DIRECTORY, sessionId, now },
          decision,
        );
        demo = { reset: true, reason: decision.reason, seeded: false };
      } else {
        demoSentinel = { ...decision.sentinel, lastActiveAt: new Date(now).toISOString() };
        await writeDemoSentinel(demoFs, USER_DATA_DIRECTORY, demoSentinel);
        demoActivityRecordedAt = now;
        demo = { reset: false, reason: null, seeded: false };
      }
    }

    const sqlite3 = await (sqlite3InitModule as (options?: Record<string, unknown>) => ReturnType<typeof sqlite3InitModule>)({
      print: () => undefined,
      printErr: () => undefined,
    });
    setActiveWasmSqliteEngine(
      new WasmSqliteEngine({
        sqlite3,
        fs: {
          readFile: async (target) => (await fs.readFile(target)) as Uint8Array,
          writeFile: (target, data) => fs.writeFile(target, data),
          mkdir: (target, options) => fs.mkdir(target, options),
          stat: (target) => fs.stat(target),
        },
        dirname,
      }),
    );
    engineReady = true;

    await fs.mkdir(USER_DATA_DIRECTORY, { recursive: true });
    await applyPendingRestore({ userDataDirectory: USER_DATA_DIRECTORY, dataDirectory: DATA_DIRECTORY });
    pendingRestoreSettled = true;

    const backend = new JobScoutBackend({
      dataDirectory: DATA_DIRECTORY,
      runtimeLabel: "web-worker",
      runnableSourceTypes: WEB_RUNNABLE_SOURCE_TYPES,
    });
    await backend.initialize();
    const systemStatus = await backend.getSystemStatus("web");
    const careerBackend = new CareerBackend({
      dataDirectory: DATA_DIRECTORY,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    await careerBackend.initialize();
    const requirementBackend = new RequirementBackend({
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    initializeEvidenceExtensionIpc({
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    await initializeResumeIpc({
      dataDirectory: DATA_DIRECTORY,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    initializeBackupIpc({
      dataDirectory: DATA_DIRECTORY,
      userDataDirectory: USER_DATA_DIRECTORY,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
      appVersion,
      producer: { runtime: "web", channel: "web", appVersion, buildId },
    });
    backupIpcRegistered = true;
    const discoveryFetch = createPinnedFetch();
    registerCoreIpcHandlers({
      backend,
      careerBackend,
      requirementBackend,
      appVersion,
      platform: "web",
      discoveryFetch: () => discoveryFetch,
      getRuntimeInfo: runtimeInfo,
    });
    ipcMain.handle("legacy-install:detect", () => ({
      applicable: false,
      found: false,
      dataDirectory: null,
      databaseBytes: null,
      lastModified: null,
    }));
    ipcMain.handle("legacy-install:stage-import", () => {
      throw new Error("The web app cannot import a desktop installation directly. Export a .jobranger backup from your desktop installation and restore it here instead.");
    });

    if (demo && demoClaim) {
      // A new demo session starts from the fictional workspace, written through the real core,
      // then the sentinel records that this session owns a completely seeded workspace.
      await seedDemoWorkspace({
        backend,
        careerBackend,
        requirementBackend,
        databasePath: systemStatus.databasePath,
        sqliteBinaryPath: systemStatus.sqliteBinaryPath,
      });
      const seededAt = Date.now();
      demoSentinel = createDemoSentinel({
        sessionId: demoClaim.sessionId,
        now: seededAt,
        seeded: true,
        createdAt: demoClaim.createdAt,
      });
      await writeDemoSentinel(demoFs, USER_DATA_DIRECTORY, demoSentinel);
      demoActivityRecordedAt = seededAt;
      demo.seeded = true;
    }

    ready = true;
    post(demo ? { type: "ready", info: await runtimeInfo(), demo } : { type: "ready", info: await runtimeInfo() });
    for (const message of pending.splice(0)) void handleInvoke(message);
  } catch (error) {
    const storageUnavailable = error instanceof JobRangerStorageError;
    // Only a positively identified damaged database is answered with "Restore from a backup":
    // a newer-version workspace, a storage error or a failed pending restore may hold healthy data.
    if (!storageUnavailable && canOfferRestoreFromBackup({ error, demo: IS_DEMO_FLAVOR, engineReady, pendingRestoreSettled })) {
      try {
        if (!backupIpcRegistered) {
          initializeBackupIpc({
            dataDirectory: DATA_DIRECTORY,
            userDataDirectory: USER_DATA_DIRECTORY,
            databasePath: join(DATA_DIRECTORY, "jobscout.sqlite3"),
            sqliteBinaryPath: "",
            appVersion,
            producer: { runtime: "web", channel: "web", appVersion, buildId },
          });
          backupIpcRegistered = true;
        }
        recoveryMode = true;
      } catch {
        recoveryMode = false;
      }
    }
    post({
      type: "fatal",
      code: storageUnavailable ? "storage-unavailable" : "startup-failed",
      message: error instanceof Error ? error.message : String(error),
      recoverableWithBackup: recoveryMode,
    });
  }
}

void boot();
