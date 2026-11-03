export const BACKUP_FORMAT = "sojourner-backup" as const;
export const BACKUP_VERSION = 1 as const;
/**
 * LEGACY: backup format id written by Job Ranger and by Sojourner before the
 * rename (2026-11-02). Still accepted when reading; never written.
 */
export const LEGACY_BACKUP_FORMATS = ["job-ranger-backup"] as const;

/**
 * Single-file portable archive wrapping a backup bundle. This is the
 * interchange contract between the Electron and web/PWA runtimes.
 */
export const ARCHIVE_FORMAT = "sojourner-portable-archive" as const;
export const ARCHIVE_VERSION = 1 as const;
/** LEGACY: archive format id of `.jobranger` files. Still accepted when reading; never written. */
export const LEGACY_ARCHIVE_FORMATS = ["job-ranger-portable-archive"] as const;
/** Extension of every archive Sojourner writes. */
export const ARCHIVE_FILE_EXTENSION = ".sojourner" as const;
/** LEGACY: archives written by Job Ranger (and Sojourner before the rename). Still read and restored. */
export const LEGACY_ARCHIVE_FILE_EXTENSIONS = [".jobranger"] as const;
/** Every extension a restore accepts, the current one first. */
export const ARCHIVE_FILE_EXTENSIONS = [ARCHIVE_FILE_EXTENSION, ...LEGACY_ARCHIVE_FILE_EXTENSIONS] as const;
/** `accept` value for a file input that selects an archive to restore. */
export const ARCHIVE_FILE_ACCEPT = ARCHIVE_FILE_EXTENSIONS.join(",");

/** True when a file name carries a current or legacy archive extension (case-insensitive). */
export function isArchiveFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ARCHIVE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isBackupFormat(value: unknown): boolean {
  return value === BACKUP_FORMAT || (LEGACY_BACKUP_FORMATS as readonly unknown[]).includes(value);
}

export function isArchiveFormat(value: unknown): boolean {
  return value === ARCHIVE_FORMAT || (LEGACY_ARCHIVE_FORMATS as readonly unknown[]).includes(value);
}

export interface SojournerArchiveProducer {
  runtime: "electron" | "web";
  channel: string;
  appVersion: string;
  buildId: string;
}

export interface SojournerArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  archiveVersion: typeof ARCHIVE_VERSION;
  createdAt: string;
  producer: SojournerArchiveProducer;
  content: {
    format: typeof BACKUP_FORMAT;
    version: typeof BACKUP_VERSION;
  };
  backupManifest: {
    path: "manifest.json";
    sha256: string;
    bytes: number;
  };
}

export interface BackupArchiveRecord {
  path: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

export interface BackupFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupMigrationRecord {
  version: number;
  name: string;
}

export interface BackupManagedPathRecord {
  table: "source_artifacts" | "resume_artifacts";
  id: string;
  relativePath: string;
}

export interface SojournerBackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  appVersion: string;
  database: BackupFileRecord;
  artifactFiles: BackupFileRecord[];
  migrations: BackupMigrationRecord[];
  managedPaths: BackupManagedPathRecord[];
}

export interface BackupSummary {
  bundlePath: string;
  createdAt: string;
  appVersion: string;
  artifactFileCount: number;
  totalBytes: number;
}

export interface BackupCreateResult {
  manifest: SojournerBackupManifest;
  summary: BackupSummary;
  /** Present when the backup was written as a single-file portable archive. */
  archive?: BackupArchiveRecord;
}

export interface BackupRestoreSelection {
  bundlePath: string;
  /** Archive provenance when the selection came from an archive file (`.sojourner`, or legacy `.jobranger`). */
  archive?: SojournerArchiveManifest;
  manifest: SojournerBackupManifest;
  summary: BackupSummary;
  warnings: string[];
}

export interface BackupDesktopApi {
  backups: {
    create: () => Promise<BackupCreateResult | null>;
    selectRestore: () => Promise<BackupRestoreSelection | null>;
    stageRestore: (bundlePath: string) => Promise<{ restarting: true }>;
  };
}
