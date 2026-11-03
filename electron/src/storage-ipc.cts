import path from "node:path";
import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import type { SojournerArchiveProducer } from "../../src/shared/backup.js";
import type { StorageResult } from "../../src/shared/storage-locations.js";
import type { BackupService } from "./backup-service.cjs";
import type { DriveIpcHandles } from "./drive-ipc.cjs";
import type { CredentialEncryption } from "./drive/drive-credential-store.cjs";
import { resolveGoogleTestOrigin } from "./drive/google-config.cjs";
import { isAppFrame } from "./drive/drive-sender.cjs";
import { SqliteClient } from "./sqlite.cjs";
import { onDocumentExported } from "./storage/document-exports.cjs";
import { MicrosoftAuth } from "./storage/microsoft-auth.cjs";
import {
  resolveMicrosoftClientConfig, resolveMicrosoftTestOrigin, resolveStorageTestTimings,
} from "./storage/microsoft-config.cjs";
import { MicrosoftCredentialStore } from "./storage/microsoft-credential-store.cjs";
import { createStorageEgress, microsoftBrowserUrl } from "./storage/storage-egress.cjs";
import { StorageConfigStore } from "./storage/storage-config.cjs";
import { carryOverStorageRecords, StorageRecords } from "./storage/storage-records.cjs";
import { StorageService, testTimings, type GoogleAuthPort } from "./storage/storage-service.cjs";
import { readChangeCounter, WorkspaceChangeMonitor } from "./storage/workspace-change-monitor.cjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["local", "google", "onedrive"]);

function flowId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid sign-in id.");
  return value.toLowerCase();
}

function cloudProvider(value: unknown): "google" | "onedrive" {
  if (value !== "google" && value !== "onedrive") throw new Error("Invalid storage provider.");
  return value;
}

async function settle<T>(work: () => Promise<T>): Promise<StorageResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : "The storage location request failed." };
  }
}

/** The storage location's view of #369's Google sign-in (an unconfigured stand-in when it is missing). */
function googlePort(drive: DriveIpcHandles | null): GoogleAuthPort {
  if (!drive) {
    return {
      configured: false, connecting: false, account: async () => null,
      getAccessToken: async () => { throw new Error("Google Drive is unavailable."); },
      invalidateAccessToken: () => undefined, connect: async () => { throw new Error("Google Drive is unavailable."); },
      cancelConnect: () => false, disconnect: async () => ({ revoked: false }),
      credentialStorage: () => "none", credentialUnavailable: () => false,
    };
  }
  const { auth, store } = drive;
  return {
    get configured() { return auth.configured; },
    get connecting() { return auth.connecting; },
    account: () => auth.account(),
    getAccessToken: (force) => auth.getAccessToken(force),
    invalidateAccessToken: () => auth.invalidateAccessToken(),
    connect: (id) => auth.connect(id),
    cancelConnect: (id) => auth.cancelConnect(id),
    disconnect: () => auth.disconnect(),
    credentialStorage: () => store.storage(),
    credentialUnavailable: () => store.credentialUnavailable(),
  };
}

export function safeStorageEncryption(): CredentialEncryption {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() &&
      !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  };
}

/** %USERPROFILE%\Documents\Sojourner; a non-packaged E2E run may point it at a temporary folder. */
function defaultLocalFolder(runtime: { env: Record<string, string | undefined>; isPackaged: boolean }): string {
  const override = runtime.env.SOJOURNER_STORAGE_TEST_DEFAULT_FOLDER;
  if (!runtime.isPackaged && override && path.isAbsolute(override)) return override;
  return path.join(app.getPath("documents"), "Sojourner");
}

/**
 * Windows storage locations (#249) wired into IPC. The main process holds the Microsoft
 * public-client sign-in, reuses #369's Google sign-in, writes backups with the existing
 * BackupService and restores only through its validate -> stage -> restart path. Only
 * display state, listings and history cross IPC. Packaged builds enable it on Windows
 * only; non-packaged runs (development, E2E) enable it everywhere. Migration 1011 is
 * applied either way.
 */
export async function initializeStorageIpc(options: {
  userDataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
  backupService: BackupService;
  producer: SojournerArchiveProducer;
  /** #369's Google sign-in; null when Drive export could not start (Google is then unavailable). */
  drive: DriveIpcHandles | null;
}): Promise<StorageService> {
  const runtime = {
    env: process.env,
    isPackaged: app.isPackaged,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null,
  };
  const enabled = process.platform === "win32" || !app.isPackaged;
  const microsoftConfig = resolveMicrosoftClientConfig(runtime);
  const microsoftTestOrigin = resolveMicrosoftTestOrigin(runtime);
  const timings = resolveStorageTestTimings(runtime);
  const egress = createStorageEgress({
    fetch: (input, init) => globalThis.fetch(input, init),
    googleTestOrigin: resolveGoogleTestOrigin(runtime),
    microsoftTestOrigin,
    timeoutMs: timings.timeoutMs ?? undefined,
  });
  const encryption = safeStorageEncryption();
  const microsoftStore = new MicrosoftCredentialStore(options.userDataDirectory, encryption);
  const microsoftAuth = new MicrosoftAuth({
    clientId: microsoftConfig.configured ? microsoftConfig.clientId : null,
    store: microsoftStore,
    fetch: egress.fetch,
    openExternal: (url) => shell.openExternal(url),
    browserUrl: (url) => microsoftBrowserUrl(url, microsoftTestOrigin),
  });
  const monitor = new WorkspaceChangeMonitor(() => readChangeCounter(options.databasePath));
  const records = new StorageRecords(new SqliteClient(options.databasePath, options.sqliteBinaryPath),
    (write) => monitor.observe(write));
  const service = new StorageService({
    enabled,
    userDataDirectory: options.userDataDirectory,
    defaultLocalFolder: defaultLocalFolder(runtime),
    backups: options.backupService,
    producer: options.producer,
    config: new StorageConfigStore(options.userDataDirectory),
    records,
    monitor,
    google: googlePort(options.drive),
    googleUnavailableReason: !options.drive
      ? "Google Drive is unavailable because Sojourner could not start its Google Drive service on this device."
      : options.drive.auth.configured ? null
        : "Google Drive is not set up in this build of Sojourner (it was built without a Google sign-in client).",
    microsoft: {
      get configured() { return microsoftAuth.configured; },
      get connecting() { return microsoftAuth.connecting; },
      account: () => microsoftAuth.account(),
      getAccessToken: (force) => microsoftAuth.getAccessToken(force),
      invalidateAccessToken: () => microsoftAuth.invalidateAccessToken(),
      connect: (id) => microsoftAuth.connect(id),
      cancelConnect: (id) => microsoftAuth.cancelConnect(id),
      disconnect: () => microsoftAuth.disconnect(),
      credentialStorage: () => microsoftStore.storage(),
      credentialUnavailable: () => microsoftStore.credentialUnavailable(),
    },
    microsoftUnavailableReason: microsoftConfig.configured ? null
      : "OneDrive is not set up in this build of Sojourner (it was built without a Microsoft sign-in client).",
    egress,
    timings: testTimings(timings.debounceMs, timings.retryBaseMs, timings.pollMs),
    retry: timings.retryBaseMs ? { attempts: 4, baseDelayMs: Math.min(timings.retryBaseMs, 200), maxDelayMs: 1_000 } : undefined,
  });

  // Storage records describe files at the locations, not the workspace: keep them across a restore.
  options.backupService.addRestoreCarryOver((stagedDatabasePath) => carryOverStorageRecords({
    liveDatabasePath: options.databasePath, stagedDatabasePath, sqliteBinaryPath: options.sqliteBinaryPath,
  }));
  await service.start();
  onDocumentExported((filePath, displayName) => service.queueDocument(filePath, displayName));

  const handle = <T,>(channel: string, work: (...args: unknown[]) => Promise<T>) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isAppFrame(event)) return { ok: false, message: "Storage locations can be changed only from Sojourner's own window." };
      return settle(() => work(...args));
    });
  };

  ipcMain.handle("storage-location:status", (event) => {
    if (!isAppFrame(event)) throw new Error("Untrusted sender.");
    return service.status();
  });
  handle("storage-location:select", async (provider) => {
    if (typeof provider !== "string" || !PROVIDERS.has(provider)) throw new Error("Invalid storage provider.");
    return service.select(provider as "local" | "google" | "onedrive");
  });
  handle("storage-location:choose-local-folder", async () => {
    const selection = await dialog.showOpenDialog({
      title: "Choose the folder for Sojourner backups and documents",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: defaultLocalFolder(runtime),
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;
    return service.setLocalFolder(selection.filePaths[0]);
  });
  handle("storage-location:connect", async (provider, id) => service.connect(cloudProvider(provider), flowId(id)));
  handle("storage-location:cancel-connect", async (provider, id) => {
    if (!service.cancelConnect(cloudProvider(provider), flowId(id))) {
      throw new Error("That sign-in already ended, so there was nothing to cancel.");
    }
    return service.status();
  });
  handle("storage-location:disconnect", async (provider) => service.disconnect(cloudProvider(provider)));
  handle("storage-location:set-retention", async (count) => service.setRetention(count));
  handle("storage-location:back-up-now", async () => service.backUp("manual"));
  handle("storage-location:list", async () => service.list());
  handle("storage-location:history", async () => service.history());
  handle("storage-location:prepare-restore", async (itemId) => service.prepareRestore(itemId));
  handle("storage-location:open-document", async (itemId) => service.openDocument(itemId, {
    openPath: async (target) => {
      const failure = await shell.openPath(target);
      if (failure) throw new Error(failure);
    },
    chooseSavePath: async (name) => {
      const selection = await dialog.showSaveDialog({
        title: "Save the document from your storage location",
        defaultPath: path.join(app.getPath("downloads"), name),
      });
      return selection.canceled || !selection.filePath ? null : selection.filePath;
    },
  }));

  return service;
}
