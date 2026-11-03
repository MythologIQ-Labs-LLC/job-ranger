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
import { SojournerBackend } from "../../../electron/src/backend.cjs";
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
  setUserDataPath,
  type InvocationContext,
} from "../adapters/electron-worker";
import { SojournerStorageError, onStorageFailure, promises as fs } from "../adapters/node-fs";
import { basename, dirname, join } from "../adapters/node-path";
import {
  DATA_DIRECTORY,
  DATABASE_FILE_NAME,
  IO_DIRECTORY,
  LEGACY_DATABASE_FILE_NAME,
  LEGACY_RUNTIME_LOCK_NAME,
  LEGACY_USER_DATA_DIRECTORY,
  mediaTypeForFileName,
  RUNTIME_LOCK_NAME,
  USER_DATA_DIRECTORY,
  type DemoWorkspaceStartup,
  type DownloadPayload,
  type PageToWorkerMessage,
  type WorkerToPageMessage,
  type WorkspaceStartup,
} from "./protocol";
import { setActiveWasmSqliteEngine, WasmSqliteEngine, type EngineFs } from "./wasm-sqlite-engine";
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
import { migrateLegacyWorkspace, type MigrationFs } from "./workspace-migration";

declare const __SOJOURNER_VERSION__: string;
declare const __SOJOURNER_BUILD_ID__: string;

interface WorkerScope {
  postMessage(message: WorkerToPageMessage, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PageToWorkerMessage>) => void): void;
  navigator: Navigator;
}

const scope = self as unknown as WorkerScope;
const appVersion = __SOJOURNER_VERSION__;
const buildId = __SOJOURNER_BUILD_ID__;
const pending: Extract<PageToWorkerMessage, { type: "invoke" }>[] = [];
let ready = false;
/**
 * When the workspace database is damaged, only RECOVERY_CHANNELS are served, so a user can restore
 * a Sojourner backup. Restore never reads or writes the damaged database: it validates the backup,
 * stages it beside the workspace, and the next start swaps it in through applyPendingRestore before
 * anything opens the database. See workspace-recovery.ts for when it is offered.
 */
let recoveryMode = false;
/** applyPendingRestore finished; a failure there is never answered with another restore. */
let pendingRestoreSettled = false;
let backupIpcRegistered = false;
/** Validating a backup needs the SQLite engine; recovery is offered only once it is running. */
let engineReady = false;
/**
 * The workspace in use. Always USER_DATA_DIRECTORY, except for a session in which copying a legacy
 * (pre-rename) workspace there failed: that session runs from the untouched legacy root instead.
 */
let userDataDirectory = USER_DATA_DIRECTORY;
let dataDirectory = DATA_DIRECTORY;
/** The legacy root keeps its database under the legacy file name (the shared core opens either name). */
let databaseFileName = DATABASE_FILE_NAME;

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
    throw new SojournerStorageError(
      "This browser cannot guarantee that only one Sojourner tab writes your data (Web Locks are unavailable).",
      "EUNSUPPORTED",
    );
  }
  // Both locks, always in this order, for the worker's whole lifetime: the current one keeps
  // Sojourner tabs single-writer; the legacy one keeps out a tab still running a build released
  // as Job Ranger, which would otherwise write the legacy workspace while it is being copied.
  await acquireLock(locks, RUNTIME_LOCK_NAME);
  await acquireLock(locks, LEGACY_RUNTIME_LOCK_NAME);
}

async function acquireLock(locks: LockManager, name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let granted = false;
    void locks
      .request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) return;
        granted = true;
        resolve();
        await new Promise(() => undefined);
      })
      .then(() => {
        if (granted) return;
        post({ type: "waiting-for-lock" });
        void locks
          .request(name, { mode: "exclusive" }, async () => {
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
  if (back.length !== 3 || back[2] !== 3) throw new SojournerStorageError("Browser storage returned different bytes than were written.", "EIO");
  await fs.rm(IO_DIRECTORY, { recursive: true, force: true });
}

/** A separate engine for the migrated copy, so it is never cached for the workspace itself. */
async function withCopyEngine(sqlite3: unknown, engineFs: EngineFs, action: (engine: WasmSqliteEngine) => Promise<void>): Promise<void> {
  const engine = new WasmSqliteEngine({ sqlite3, fs: engineFs, dirname });
  try {
    await action(engine);
  } finally {
    engine.closeAll();
  }
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Managed artifacts are recorded with absolute paths. In the migrated copy they are moved from the
 * legacy data directory to the new one in one transaction, exactly as a backup restore rebases them.
 */
async function rebaseManagedPaths(engine: WasmSqliteEngine, path: string, from: string, to: string): Promise<void> {
  const fromPrefix = `${from.replace(/\/+$/, "")}/`;
  const toPrefix = `${to.replace(/\/+$/, "")}/`;
  const underFrom = `substr(managed_path, 1, ${fromPrefix.length}) = ${sqlText(fromPrefix)}`;
  const tables = await engine.queryAll<{ name: string }>(
    path,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('source_artifacts', 'resume_artifacts') ORDER BY name;",
  );
  if (tables.length === 0) return;
  await engine.transaction(
    path,
    tables.map(({ name }) => `UPDATE ${name} SET managed_path = ${sqlText(toPrefix)} || substr(managed_path, ${fromPrefix.length + 1}) WHERE ${underFrom};`),
  );
  for (const { name } of tables) {
    const [row] = await engine.queryAll<{ remaining: number }>(path, `SELECT count(*) AS remaining FROM ${name} WHERE ${underFrom};`);
    if (row?.remaining) throw new Error(`${row.remaining} managed artifact path(s) in ${name} still point to the earlier workspace.`);
  }
}

/**
 * Standard flavor, under both Web Locks and before the engine opens anything: copy a legacy
 * (pre-rename) workspace to the Sojourner root when that root has none (workspace-migration.ts).
 * If the copy fails it is removed again and this session runs from the untouched legacy root,
 * whose database file keeps its legacy name; the next start retries the copy.
 */
async function openWorkspaceRoot(sqlite3: unknown, engineFs: EngineFs): Promise<WorkspaceStartup> {
  const outcome = await migrateLegacyWorkspace(fs as unknown as MigrationFs, {
    userDataDirectory: USER_DATA_DIRECTORY,
    legacyUserDataDirectory: LEGACY_USER_DATA_DIRECTORY,
    dataDirectoryName: basename(DATA_DIRECTORY),
    databaseFileName: DATABASE_FILE_NAME,
    legacyDatabaseFileName: LEGACY_DATABASE_FILE_NAME,
    rebaseDatabase: (path, from, to) => withCopyEngine(sqlite3, engineFs, (engine) => rebaseManagedPaths(engine, path, from, to)),
    verifyDatabase: (path) =>
      withCopyEngine(sqlite3, engineFs, async (engine) => {
        const rows = await engine.queryAll<{ integrity_check: string }>(path, "PRAGMA integrity_check;");
        if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
          throw new Error(`The copied workspace database failed its integrity check: ${rows.map((row) => row.integrity_check).join("; ")}`);
        }
      }),
    now: () => Date.now(),
  });
  if (outcome.action !== "failed") return { root: "current", migrated: outcome.action === "migrated" };
  console.warn("Sojourner kept using this browser's earlier workspace; copying it to the new location is retried next start.", outcome.error);
  userDataDirectory = LEGACY_USER_DATA_DIRECTORY;
  dataDirectory = join(LEGACY_USER_DATA_DIRECTORY, basename(DATA_DIRECTORY));
  databaseFileName = LEGACY_DATABASE_FILE_NAME;
  setUserDataPath(userDataDirectory);
  return { root: "legacy-fallback", migrated: false };
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
  let workspace: WorkspaceStartup | undefined;
  try {
    if (IS_DEMO_FLAVOR) {
      // Demo flavor, under the exclusive lock and BEFORE anything opens the workspace:
      // keep it, replace it with fresh sample data, or refuse to touch a workspace that
      // carries no demo sentinel (it may be someone's real workspace).
      const sessionId = await demoSessionRequest;
      const now = Date.now();
      const decision = await decideDemoStartup(demoFs, {
        userDataDirectory: USER_DATA_DIRECTORY,
        legacyUserDataDirectory: LEGACY_USER_DATA_DIRECTORY,
        sessionId,
        now,
      });
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
    const engineFs: EngineFs = {
      readFile: async (target) => (await fs.readFile(target)) as Uint8Array,
      writeFile: (target, data) => fs.writeFile(target, data),
      mkdir: (target, options) => fs.mkdir(target, options),
      stat: (target) => fs.stat(target),
    };
    if (!IS_DEMO_FLAVOR) workspace = await openWorkspaceRoot(sqlite3, engineFs);
    setActiveWasmSqliteEngine(new WasmSqliteEngine({ sqlite3, fs: engineFs, dirname }));
    engineReady = true;

    await fs.mkdir(userDataDirectory, { recursive: true });
    await applyPendingRestore({ userDataDirectory, dataDirectory });
    pendingRestoreSettled = true;

    const backend = new SojournerBackend({
      dataDirectory,
      runtimeLabel: "web-worker",
      runnableSourceTypes: WEB_RUNNABLE_SOURCE_TYPES,
    });
    await backend.initialize();
    const systemStatus = await backend.getSystemStatus("web");
    const careerBackend = new CareerBackend({
      dataDirectory,
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
      dataDirectory,
      databasePath: systemStatus.databasePath,
      sqliteBinaryPath: systemStatus.sqliteBinaryPath,
    });
    initializeBackupIpc({
      dataDirectory,
      userDataDirectory,
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
      throw new Error("The web app cannot import a desktop installation directly. Export a backup from your desktop installation and restore it here instead.");
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
    const info = await runtimeInfo();
    post(demo ? { type: "ready", info, demo } : workspace ? { type: "ready", info, workspace } : { type: "ready", info });
    for (const message of pending.splice(0)) void handleInvoke(message);
  } catch (error) {
    const storageUnavailable = error instanceof SojournerStorageError;
    // Only a positively identified damaged database is answered with "Restore from a backup":
    // a newer-version workspace, a storage error or a failed pending restore may hold healthy data.
    if (!storageUnavailable && canOfferRestoreFromBackup({ error, demo: IS_DEMO_FLAVOR, engineReady, pendingRestoreSettled })) {
      try {
        if (!backupIpcRegistered) {
          initializeBackupIpc({
            dataDirectory,
            userDataDirectory,
            databasePath: join(dataDirectory, databaseFileName),
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
