import { app, ipcMain, safeStorage, shell } from "electron";
import type { DriveResult } from "../../src/shared/google-drive.js";
import { validateCareerEntityId } from "./career-validators.cjs";
import { SqliteClient } from "./sqlite.cjs";
import { DriveCredentialStore } from "./drive/drive-credential-store.cjs";
import { driveErrorInfo } from "./drive/drive-errors.cjs";
import { validateConnectFlowId, validateDriveApproveRequest, validateDriveOperationId } from "./drive/drive-validators.cjs";
import { DriveError } from "./drive/drive-errors.cjs";
import { DriveExportService } from "./drive/drive-export-service.cjs";
import { DriveTransport } from "./drive/drive-transport.cjs";
import { GoogleDesktopAuth, MANUAL_REVOKE_HINT } from "./drive/google-desktop-auth.cjs";
import { GoogleTransport } from "./drive/google-transport.cjs";
import {
  resolveGoogleClientConfig,
  resolveGoogleEndpoints,
  resolveTestTimeoutMs,
} from "./drive/google-config.cjs";

interface DriveIpcOptions {
  dataDirectory: string;
  userDataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
}

async function settle<T>(work: () => Promise<T>): Promise<DriveResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: driveErrorInfo(error) };
  }
}

/**
 * Wires DriveAuthorization (desktop OAuth), DriveTransport and ArtifactExport
 * into IPC. Results are structured so the renderer can offer Retry or
 * Reconnect; no token ever crosses IPC.
 */
export async function initializeDriveIpc(options: DriveIpcOptions): Promise<DriveExportService> {
  const runtime = {
    env: process.env,
    isPackaged: app.isPackaged,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null,
  };
  const clientConfig = resolveGoogleClientConfig(runtime);
  const endpoints = resolveGoogleEndpoints(runtime);
  const testTimeoutMs = resolveTestTimeoutMs(runtime);
  const transport = new GoogleTransport({
    fetch: (input, init) => globalThis.fetch(input, init),
    allowedOrigins: endpoints.allowedOrigins,
    defaultTimeoutMs: testTimeoutMs ?? 30_000,
  });
  const store = new DriveCredentialStore(options.userDataDirectory, {
    // On Linux without a keyring, safeStorage falls back to a hard-coded key
    // ("basic_text"); treat that as no encryption and keep the token in memory.
    isEncryptionAvailable: () =>
      safeStorage.isEncryptionAvailable() &&
      !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  });
  const auth = new GoogleDesktopAuth({
    client: clientConfig.configured ? clientConfig.client : null,
    endpoints,
    transport,
    store,
    openExternal: (url) => shell.openExternal(url),
  });
  const drive = new DriveTransport({
    transport,
    endpoints,
    auth,
    requestTimeoutMs: testTimeoutMs ?? undefined,
    uploadTimeoutMs: testTimeoutMs ?? undefined,
  });
  const service = new DriveExportService({
    dataDirectory: options.dataDirectory,
    sqlite: new SqliteClient(options.databasePath, options.sqliteBinaryPath),
    unavailableReason: clientConfig.configured ? null : clientConfig.reason,
    auth,
    store,
    drive,
  });
  await service.initialize();

  ipcMain.handle("drive:status", () => service.status());
  ipcMain.handle("drive:connect", (_event, flowId: unknown) =>
    settle(async () => {
      const outcome = await auth.connect(validateConnectFlowId(flowId));
      const status = await service.status();
      return outcome.previousAccountNotRevoked === undefined
        ? status
        : {
            ...status,
            warning: `Job Ranger could not revoke the previous Google account (${outcome.previousAccountNotRevoked ?? "unknown"}). ${MANUAL_REVOKE_HINT}`,
          };
    }),
  );
  ipcMain.handle("drive:cancel-connect", (_event, flowId: unknown) =>
    settle(async () => {
      if (!auth.cancelConnect(validateConnectFlowId(flowId))) {
        throw new DriveError("invalid_request", "That Google sign-in already ended, so there was nothing to cancel.");
      }
      return service.status();
    }),
  );
  ipcMain.handle("drive:disconnect", () =>
    settle(async () => {
      const { revoked } = await auth.disconnect();
      return { revoked, status: await service.status() };
    }),
  );
  ipcMain.handle("drive:prepare-export", (_event, artifactId: unknown) =>
    settle(() => service.prepare(validateCareerEntityId(artifactId, "Resume artifact id"))),
  );
  ipcMain.handle("drive:approve-export", (_event, request: unknown) =>
    settle(() => service.approve(validateDriveApproveRequest(request))),
  );
  ipcMain.handle("drive:retry-export", (_event, operationId: unknown) =>
    settle(() => service.retry(validateDriveOperationId(operationId))),
  );
  ipcMain.handle("drive:abandon-export", (_event, operationId: unknown) =>
    settle(() => service.abandon(validateDriveOperationId(operationId))),
  );
  ipcMain.handle("drive:list-exports", (_event, artifactId: unknown) =>
    service.listExports(validateCareerEntityId(artifactId, "Resume artifact id")),
  );

  return service;
}
