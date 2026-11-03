import path from "node:path";
import type {
  RuntimeDistributionChannel,
  RuntimeInfo,
} from "../../src/shared/runtime.js";
import { ELECTRON_CAPABILITIES } from "../../src/shared/runtime.js";

/**
 * Folder name (under the per-user roaming AppData directory) used by packaged
 * direct-download (NSIS) builds: `%APPDATA%\Sojourner`.
 */
export const DIRECT_USER_DATA_FOLDER = "Sojourner";

/**
 * Folder name used by Microsoft Store (AppX) builds. It deliberately differs from
 * the direct-download folder so the Store package never shares a live SQLite
 * database with a side-by-side NSIS installation. Under AppX file-system
 * virtualization a folder created by the package is private to that package.
 */
export const STORE_USER_DATA_FOLDER = "Sojourner Store";

/**
 * LEGACY: folder used by direct-download (NSIS) installations before the rename,
 * including Job Ranger v1.2.0 and the Sojourner pre-releases. Electron names userData
 * after the packaged package.json `productName` or, failing that, `name`; package.json
 * was named "job-ranger" and never carried a productName, so every such install kept
 * its data in `%APPDATA%\job-ranger` (verified on a real v1.2.0 install, 2026-11-02).
 * Startup migrates it to DIRECT_USER_DATA_FOLDER (legacy-migration.cts); it is never
 * modified or deleted.
 */
export const LEGACY_DIRECT_USER_DATA_FOLDER = "job-ranger";

/** LEGACY: Store (AppX) data folder before the rename. Migrated to STORE_USER_DATA_FOLDER. */
export const LEGACY_STORE_USER_DATA_FOLDER = "Job Ranger Store";

const CHANNEL_OVERRIDE_ENV = "SOJOURNER_DISTRIBUTION_CHANNEL_OVERRIDE";

export interface DistributionDetectionInput {
  windowsStore: boolean | undefined;
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
}

export function detectDistributionChannel(
  input: DistributionDetectionInput,
): RuntimeDistributionChannel {
  // `process.windowsStore` is set by Electron itself when the executable runs
  // from an AppX/MSIX package identity. It cannot be faked by a packaged app.
  if (input.windowsStore === true) return "microsoft-store";
  if (input.isPackaged) return "direct-download";
  // Unpackaged development/E2E runs may simulate Store mode to exercise the
  // Store-specific data isolation and legacy-import UI on any platform.
  const override = input.env[CHANNEL_OVERRIDE_ENV]?.trim();
  if (override === "microsoft-store") return "microsoft-store";
  return "development";
}

export function resolveStoreUserDataDirectory(appDataDirectory: string): string {
  return path.join(appDataDirectory, STORE_USER_DATA_FOLDER);
}

export function resolveDirectUserDataDirectory(appDataDirectory: string): string {
  return path.join(appDataDirectory, DIRECT_USER_DATA_FOLDER);
}

export function resolveLegacyDirectUserDataDirectory(appDataDirectory: string): string {
  return path.join(appDataDirectory, LEGACY_DIRECT_USER_DATA_FOLDER);
}

export function resolveLegacyStoreUserDataDirectory(appDataDirectory: string): string {
  return path.join(appDataDirectory, LEGACY_STORE_USER_DATA_FOLDER);
}

/**
 * The userData directory a build must use instead of Electron's default
 * (`<appData>/<package name>`), with the LEGACY folder its data may still be in,
 * or null to keep the default.
 *
 * - Microsoft Store builds use STORE_USER_DATA_FOLDER (legacy: "Job Ranger Store").
 * - Packaged direct-download builds use DIRECT_USER_DATA_FOLDER (legacy: "job-ranger").
 *   Pinning makes the folder independent of package metadata.
 * - Development and E2E runs keep Electron's default, and an explicit
 *   --user-data-dir (used by automated tests) always wins.
 *
 * legacy-migration.cts copies the legacy folder into the target before first use.
 */
export function resolvePinnedUserDataDirectory(input: {
  channel: RuntimeDistributionChannel;
  appDataDirectory: string;
  hasUserDataDirSwitch: boolean;
}): { target: string; legacy: string } | null {
  if (input.hasUserDataDirSwitch) return null;
  if (input.channel === "microsoft-store") {
    return {
      target: resolveStoreUserDataDirectory(input.appDataDirectory),
      legacy: resolveLegacyStoreUserDataDirectory(input.appDataDirectory),
    };
  }
  if (input.channel === "direct-download") {
    return {
      target: resolveDirectUserDataDirectory(input.appDataDirectory),
      legacy: resolveLegacyDirectUserDataDirectory(input.appDataDirectory),
    };
  }
  return null;
}

export function electronRuntimeInfo(input: {
  channel: RuntimeDistributionChannel;
  appVersion: string;
  platform: string;
  userDataDirectory: string;
  sqliteBinaryPath: string;
  buildId?: string;
}): RuntimeInfo {
  const warnings: string[] = [];
  if (input.channel === "microsoft-store") {
    warnings.push(
      "Legacy Microsoft Store installs keep Sojourner workspace data inside the package's private storage. Uninstalling the Store app removes that data, so create a backup before uninstalling.",
    );
  }
  return {
    kind: "electron",
    channel: input.channel,
    appVersion: input.appVersion,
    buildId: input.buildId?.trim() || `electron-${input.appVersion}`,
    platform: input.platform,
    capabilities: { ...ELECTRON_CAPABILITIES },
    storage: {
      location: input.userDataDirectory,
      engine: `SQLite (${input.sqliteBinaryPath})`,
      persisted: null,
      usageBytes: null,
      quotaBytes: null,
      warnings,
    },
  };
}

/**
 * Package family name of a running AppX/MSIX desktop app, derived from its
 * install path: `...\WindowsApps\<Name>_<Version>_<Arch>_<ResourceId>_<PublisherId>\...`.
 */
export function packageFamilyNameFromExecPath(execPath: string): string | null {
  const match = execPath.replace(/\\/g, "/").match(/\/WindowsApps\/([^/]+)\//i);
  if (!match) return null;
  const parts = match[1].split("_");
  if (parts.length < 5 || !parts[0] || !parts[parts.length - 1]) return null;
  return `${parts[0]}_${parts[parts.length - 1]}`;
}

/**
 * AppX file-system virtualization stores files a packaged app creates under
 * %APPDATA% in `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming`. The app
 * sees the virtual path; Explorer and other apps need the real one. Paths
 * outside %APPDATA% are returned unchanged.
 */
export function storeHostPath(
  virtualPath: string,
  input: { appDataDirectory: string; localAppDataDirectory: string; packageFamilyName: string | null },
): string {
  if (!input.packageFamilyName) return virtualPath;
  const relative = path.win32.relative(input.appDataDirectory, virtualPath);
  if (!relative || relative.startsWith("..") || path.win32.isAbsolute(relative)) return virtualPath;
  return path.win32.join(
    input.localAppDataDirectory,
    "Packages",
    input.packageFamilyName,
    "LocalCache",
    "Roaming",
    relative,
  );
}
