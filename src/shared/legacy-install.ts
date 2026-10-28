/**
 * Explicit, user-initiated import of data from a historical direct-download
 * (NSIS) legacy Job Ranger installation into a Microsoft Store installation.
 *
 * The legacy data directory is only read. Nothing is moved or deleted, so the
 * historical installation keeps working and the import can be repeated or
 * abandoned.
 */
export interface LegacyInstallStatus {
  /** True only for Microsoft Store runtimes, where the data roots differ. */
  applicable: boolean;
  found: boolean;
  dataDirectory: string | null;
  databaseBytes: number | null;
  lastModified: string | null;
}

export interface LegacyInstallDesktopApi {
  legacyInstall: {
    detect: () => Promise<LegacyInstallStatus>;
    stageImport: () => Promise<{ restarting: true }>;
  };
}
