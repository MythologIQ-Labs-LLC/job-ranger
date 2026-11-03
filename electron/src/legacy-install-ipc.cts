import { app, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RuntimeDistributionChannel } from "../../src/shared/runtime.js";
import type { LegacyInstallStatus } from "../../src/shared/legacy-install.js";
import { randomUUID } from "node:crypto";
import { BackupService } from "./backup-service.cjs";
import { resolveDirectUserDataDirectory, resolveLegacyDirectUserDataDirectory } from "./distribution.cjs";
import { DATABASE_FILE_NAME, LEGACY_DATABASE_FILE_NAME } from "./database-file.cjs";

export interface LegacyInstallOptions {
  channel: RuntimeDistributionChannel;
  appDataDirectory: string;
  userDataDirectory: string;
  dataDirectory: string;
  /** The Store installation's live database. */
  databasePath: string;
  sqliteBinaryPath: string;
  appVersion: string;
}

/**
 * Where a direct-download (NSIS) installation keeps its data, newest first:
 * %APPDATA%\Sojourner, then the LEGACY %APPDATA%\job-ranger folder of Job Ranger and
 * of Sojourner before the rename (the database there is the LEGACY jobscout.sqlite3).
 */
function directDownloadCandidates(appDataDirectory: string): Array<{ userData: string; databaseFile: string }> {
  const current = resolveDirectUserDataDirectory(appDataDirectory);
  const legacy = resolveLegacyDirectUserDataDirectory(appDataDirectory);
  return [
    { userData: current, databaseFile: DATABASE_FILE_NAME },
    { userData: current, databaseFile: LEGACY_DATABASE_FILE_NAME },
    { userData: legacy, databaseFile: LEGACY_DATABASE_FILE_NAME },
    { userData: legacy, databaseFile: DATABASE_FILE_NAME },
  ];
}

async function findDirectDownloadDatabase(
  options: LegacyInstallOptions,
): Promise<{ dataDirectory: string; databasePath: string; stat: { size: number; mtime: Date } } | null> {
  for (const candidate of directDownloadCandidates(options.appDataDirectory)) {
    if (path.resolve(candidate.userData) === path.resolve(options.userDataDirectory)) continue;
    const dataDirectory = path.join(candidate.userData, "data");
    const databasePath = path.join(dataDirectory, candidate.databaseFile);
    try {
      const stat = await fs.stat(databasePath);
      if (stat.isFile()) return { dataDirectory, databasePath, stat };
    } catch {
      // Try the next location.
    }
  }
  return null;
}

export async function detectLegacyInstall(
  options: LegacyInstallOptions,
): Promise<LegacyInstallStatus> {
  if (options.channel !== "microsoft-store") {
    return { applicable: false, found: false, dataDirectory: null, databaseBytes: null, lastModified: null };
  }
  const found = await findDirectDownloadDatabase(options);
  if (!found) {
    const fallbackData = path.join(resolveDirectUserDataDirectory(options.appDataDirectory), "data");
    return { applicable: true, found: false, dataDirectory: fallbackData, databaseBytes: null, lastModified: null };
  }
  return {
    applicable: true,
    found: true,
    dataDirectory: found.dataDirectory,
    databaseBytes: found.stat.size,
    lastModified: found.stat.mtime.toISOString(),
  };
}

/**
 * Builds a validated backup bundle from the legacy installation (read-only),
 * then stages it through the normal restore path. The current Store data is
 * kept as the rollback candidate until the staged restore is applied.
 */
export async function stageLegacyImport(options: LegacyInstallOptions): Promise<void> {
  const found = options.channel === "microsoft-store" ? await findDirectDownloadDatabase(options) : null;
  if (!found) {
    throw new Error("No direct-download Sojourner (or earlier Job Ranger) installation data was found to import.");
  }
  const workDirectory = path.join(
    options.userDataDirectory,
    `.sojourner-legacy-import-${randomUUID()}`,
  );
  await fs.mkdir(workDirectory, { recursive: true });
  try {
    const legacyService = new BackupService({
      dataDirectory: found.dataDirectory,
      userDataDirectory: workDirectory,
      databasePath: found.databasePath,
      sqliteBinaryPath: options.sqliteBinaryPath,
      appVersion: options.appVersion,
      readOnlySource: true,
    });
    const bundle = await legacyService.createBackup(workDirectory);
    const storeService = new BackupService({
      dataDirectory: options.dataDirectory,
      userDataDirectory: options.userDataDirectory,
      databasePath: options.databasePath,
      sqliteBinaryPath: options.sqliteBinaryPath,
      appVersion: options.appVersion,
    });
    await storeService.stageRestore(bundle.summary.bundlePath);
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

export function initializeLegacyInstallIpc(options: LegacyInstallOptions): void {
  ipcMain.handle("legacy-install:detect", () => detectLegacyInstall(options));
  ipcMain.handle("legacy-install:stage-import", async () => {
    await stageLegacyImport(options);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return { restarting: true as const };
  });
}
