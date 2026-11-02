import { app, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { isAppFrame } from "./drive/drive-sender.cjs";
import type {
  DriveDesktopResult, DriveDesktopStatus, DriveDisconnectResult,
} from "../../src/shared/google-drive-desktop.js";
import { DriveExportFlow } from "../../src/shared/drive/drive-export-flow.js";
import { validateCareerEntityId } from "./career-validators.cjs";
import { SqliteClient } from "./sqlite.cjs";
import type { ResumeService } from "./resume-service.cjs";
import { DriveCredentialStore } from "./drive/drive-credential-store.cjs";
import { SqliteDriveExportJournal } from "./drive/drive-export-journal.cjs";
import { browserAuthorizationUrl, createDriveEgressFetch } from "./drive/drive-egress.cjs";
import { GoogleDesktopAuth, MANUAL_REVOKE_HINT } from "./drive/google-desktop-auth.cjs";
import { DriveAuthError } from "./drive/google-loopback.cjs";
import {
  resolveGoogleClientConfig, resolveGoogleTestOrigin, resolveTestTimeoutMs,
} from "./drive/google-config.cjs";

interface DriveIpcOptions {
  userDataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
  resumeService: Pick<ResumeService, "readVerifiedArtifactForExport">;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateDriveUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}.`);
  return value.toLowerCase();
}

export function validateArtifactVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error("Invalid resume PDF version.");
  }
  return value;
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppFrame(event)) throw new Error("Google Drive actions are available only from the Sojourner window.");
    return listener(event, ...args);
  });
}

/** Registered when Drive could not start (for example a journal error), so the app still opens. */
export function registerUnavailableDriveIpc(reason: string): void {
  const status: DriveDesktopStatus = { available: false, phase: "not_connected", accountLabel: null,
    credentialStorage: "none", message: `Google Drive export is unavailable: ${reason}` };
  handle("drive:status", () => status);
}

async function settle<T>(work: () => Promise<T>): Promise<DriveDesktopResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : "Google Drive export failed." };
  }
}

/**
 * Windows Google Drive export (#314) wired into IPC. The main process holds the Desktop
 * OAuth client, the refresh token (safeStorage) and the access token (memory); it runs
 * the shared DriveExportFlow against the SQLite journal. Only display state, review data
 * and journal summaries cross IPC. Without a configured Desktop client the renderer is
 * told `available: false` and hides the feature; no Google request is ever made then.
 * The journal migration (1010) is applied either way.
 */
export async function initializeDriveIpc(options: DriveIpcOptions): Promise<void> {
  const runtime = {
    env: process.env,
    isPackaged: app.isPackaged,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null,
  };
  const clientConfig = resolveGoogleClientConfig(runtime);
  const testOrigin = resolveGoogleTestOrigin(runtime);
  const testTimeoutMs = resolveTestTimeoutMs(runtime);
  const egress = createDriveEgressFetch({
    fetch: (input, init) => globalThis.fetch(input, init),
    testOrigin,
    timeoutMs: testTimeoutMs ?? undefined,
    uploadTimeoutMs: testTimeoutMs ?? undefined,
  });
  const store = new DriveCredentialStore(options.userDataDirectory, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() &&
      // On Linux without a keyring safeStorage uses a hard-coded key: treat as unavailable.
      !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"),
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted),
  });
  const auth = new GoogleDesktopAuth({
    client: clientConfig.configured ? clientConfig.client : null,
    store,
    fetch: egress,
    openExternal: (url) => shell.openExternal(url),
    browserUrl: (url) => browserAuthorizationUrl(url, testOrigin),
  });
  const journal = new SqliteDriveExportJournal(new SqliteClient(options.databasePath, options.sqliteBinaryPath));
  await journal.initialize();
  const flow = new DriveExportFlow({
    withToken: async (work) => work(await auth.getAccessToken()),
    journal: () => journal,
    readArtifact: (artifactId) => options.resumeService.readVerifiedArtifactForExport(artifactId),
    http: egress,
    onUploadAuthorizationRejected: () => auth.invalidateAccessToken(),
  });
  let notice: string | null = null;

  const status = async (): Promise<DriveDesktopStatus> => {
    if (!auth.configured) {
      return { available: false, phase: "not_connected", accountLabel: null, credentialStorage: "none",
        message: "Google Drive export is not set up in this build of Sojourner." };
    }
    if (auth.connecting) {
      return { available: true, phase: "authorizing", accountLabel: null, credentialStorage: "none",
        message: "Finish signing in to Google in your browser. Sojourner asks only for access to files it creates." };
    }
    const account = await auth.account();
    if (!account) {
      if (store.credentialUnavailable()) {
        return { available: true, phase: "action_needed", accountLabel: null, credentialStorage: "none",
          message: "Sojourner could not unlock the saved Google sign-in on this device. Disconnect Google Drive, then connect again." };
      }
      const message = notice ?? "Google Drive is not connected on this device.";
      return { available: true, phase: "not_connected", accountLabel: null, credentialStorage: "none", message };
    }
    notice = null;
    const storage = store.storage();
    return {
      available: true, phase: "connected", accountLabel: account.label, credentialStorage: storage,
      message: storage === "encrypted"
        ? `Google Drive is connected as ${account.label}. Windows keeps the sign-in encrypted on this device.`
        : `Google Drive is connected as ${account.label} for this session only. Windows encryption is not available, so Sojourner did not save the sign-in.`,
    };
  };

  /** Runs a Drive action; a revoked or expired sign-in is reported on the next status. */
  const action = <T,>(work: () => Promise<T>) => settle(async () => {
    try {
      return await work();
    } catch (error) {
      if (!(await auth.account())) {
        notice = error instanceof Error && error.message ? error.message : null;
        flow.discardAll();
      }
      throw error;
    }
  });

  handle("drive:status", () => status());
  handle("drive:connect", (_event, flowId: unknown) => settle(async () => {
    const id = validateDriveUuid(flowId, "Google sign-in id");
    notice = null;
    flow.discardAll();
    await auth.connect(id);
    return status();
  }));
  handle("drive:cancel-connect", (_event, flowId: unknown) => settle(async () => {
    if (!auth.cancelConnect(validateDriveUuid(flowId, "Google sign-in id"))) {
      throw new DriveAuthError("auth_cancelled", "That Google sign-in already ended, so there was nothing to cancel.");
    }
    return status();
  }));
  handle("drive:disconnect", () => settle(async (): Promise<DriveDisconnectResult> => {
    flow.discardAll();
    const { revoked } = await auth.disconnect();
    notice = revoked
      ? "Google Drive disconnected. Sojourner deleted its saved Google sign-in and Google revoked its access."
      : `Google Drive disconnected. Sojourner deleted its saved Google sign-in on this device, but Google did not confirm the revocation. ${MANUAL_REVOKE_HINT}`;
    return { revoked, status: await status() };
  }));
  handle("drive:prepare-export", (_event, artifactId: unknown, version: unknown) => action(() =>
    flow.prepare(validateCareerEntityId(artifactId, "Resume artifact id"), validateArtifactVersion(version))));
  handle("drive:discard-export", (_event, proposalId: unknown) => settle(async () => {
    flow.discard(validateDriveUuid(proposalId, "Drive export review id"));
    return null;
  }));
  handle("drive:confirm-export", (_event, proposalId: unknown) => action(() =>
    flow.confirm(validateDriveUuid(proposalId, "Drive export review id"))));
  handle("drive:reconcile-exports", (_event, artifactId: unknown) => action(() =>
    flow.reconcile(validateCareerEntityId(artifactId, "Resume artifact id"))));
  handle("drive:cancel-prepared-export", (_event, artifactId: unknown, operationId: unknown) => action(() =>
    flow.cancelPrepared(validateCareerEntityId(artifactId, "Resume artifact id"),
      validateDriveUuid(operationId, "Drive export operation id"))));
  handle("drive:abandon-export", (_event, artifactId: unknown, operationId: unknown) => action(() =>
    flow.abandon(validateCareerEntityId(artifactId, "Resume artifact id"),
      validateDriveUuid(operationId, "Drive export operation id"))));
}
