/**
 * Windows (Electron) storage location IPC contract (#249, #314; owner decision 2026-11-02).
 *
 * The Windows app copies automatic and manual workspace backups (full `.jobranger`
 * archives) and exported documents to ONE chosen location: a folder on this computer,
 * the person's Google Drive ("Sojourner" folder, scope drive.file) or their OneDrive
 * (the app folder, scope Files.ReadWrite.AppFolder). The working SQLite database always
 * stays in the local user-data folder; this is backup-and-documents sync, not live
 * multi-PC editing.
 *
 * Electron-only: the main process holds every OAuth client, refresh token (Windows
 * safeStorage) and access token (memory). Nothing on this contract carries a token,
 * code, verifier or secret. The PWA worker registers none of these channels; the PWA
 * keeps its own local backup UI.
 */
import type { BackupRestoreSelection } from "./backup.js";

export type StorageProviderKind = "local" | "google" | "onedrive";
export type StorageRecordKind = "automatic" | "manual" | "document";
/** pending -> uploaded -> verified | failed; verified -> deleted (retention only). */
export type StorageRecordStatus = "pending" | "uploaded" | "verified" | "failed" | "deleted";
export type StorageCredentialStorage = "encrypted" | "session" | "none";

export const STORAGE_PROVIDER_LABELS: Record<StorageProviderKind, string> = {
  local: "This computer",
  google: "Google Drive",
  onedrive: "OneDrive",
};

export const DEFAULT_STORAGE_RETENTION = 20;
export const MIN_STORAGE_RETENTION = 1;
export const MAX_STORAGE_RETENTION = 200;

export interface StorageProviderStatus {
  provider: StorageProviderKind;
  label: string;
  /** False when this build has no OAuth client for the provider: the choice is disabled. */
  configured: boolean;
  /** Why the choice is disabled (not configured), or null. */
  unavailableReason: string | null;
  /** Local: a folder is chosen. Cloud: a verified sign-in is held. */
  connected: boolean;
  /** A browser sign-in is waiting for the person. */
  connecting: boolean;
  /** Folder path (local) or verified account label (cloud); null when not connected. */
  accountLabel: string | null;
  credentialStorage: StorageCredentialStorage;
  /** Where files go, e.g. "Google Drive > Sojourner". */
  locationDescription: string | null;
  message: string;
}

export interface StorageBackupStatus {
  running: boolean;
  /** Workspace changes that no verified backup at the selected location contains yet. */
  pendingChanges: boolean;
  lastSuccessAt: string | null;
  lastSuccessName: string | null;
  lastSuccessProvider: StorageProviderKind | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** When the next automatic attempt (debounced backup or retry) is due, if scheduled. */
  nextAttemptAt: string | null;
  /** Last document copy failure, surfaced until a later copy succeeds. */
  documentError: string | null;
  /** A non-fatal problem after the last backup (for example retention could not remove a file). */
  warning: string | null;
}

export interface StorageLocationStatus {
  /** False outside the Windows app: the Settings section is hidden. */
  available: boolean;
  selected: StorageProviderKind | null;
  retention: number;
  providers: StorageProviderStatus[];
  backup: StorageBackupStatus;
}

/** One file found at the selected location (Backups/ or Documents/). */
export interface StorageLocationItem {
  /** Opaque handle for prepareRestore/openDocument; validated again in the main process. */
  itemId: string;
  name: string;
  size: number;
  createdAt: string | null;
  folder: "Backups" | "Documents";
  /** Sojourner on this device recorded it; null for a file another device created. */
  kind: StorageRecordKind | null;
  /** Recorded status on this device; null when not recorded here. */
  status: StorageRecordStatus | null;
  /** Only backups that are not known-bad may be restored (they are validated again). */
  restorable: boolean;
}

export interface StorageLocationListing {
  provider: StorageProviderKind;
  locationDescription: string;
  backups: StorageLocationItem[];
  documents: StorageLocationItem[];
  /** The provider returned more files than Sojourner lists. */
  truncated: boolean;
}

/** A recorded copy at any location, newest first (old locations stay in history). */
export interface StorageHistoryEntry {
  id: string;
  provider: StorageProviderKind;
  locationLabel: string;
  name: string;
  size: number;
  kind: StorageRecordKind;
  status: StorageRecordStatus;
  createdAt: string;
  error: string | null;
  /** True when the entry belongs to the currently selected location. */
  current: boolean;
}

export interface StorageBackupOutcome {
  name: string;
  size: number;
  provider: StorageProviderKind;
  verifiedAt: string;
  /** Older automatic backups Sojourner removed under the retention setting. */
  removedByRetention: number;
}

export type StorageResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface StorageDisconnectResult {
  /** The provider confirmed revoking the grant; the local sign-in is deleted either way. */
  revoked: boolean;
  message: string;
  status: StorageLocationStatus;
}

export interface StorageLocationsDesktopApi {
  storageLocations: {
    status: () => Promise<StorageLocationStatus>;
    /** Makes a connected provider the location for new backups and documents. */
    select: (provider: StorageProviderKind) => Promise<StorageResult<StorageLocationStatus>>;
    /** Folder picker for "This computer"; selects it. `null` when the picker was cancelled. */
    chooseLocalFolder: () => Promise<StorageResult<StorageLocationStatus | null>>;
    /** System-browser sign-in; `flowId` is a UUID. */
    connect: (provider: "google" | "onedrive", flowId: string) => Promise<StorageResult<StorageLocationStatus>>;
    cancelConnect: (provider: "google" | "onedrive", flowId: string) => Promise<StorageResult<StorageLocationStatus>>;
    disconnect: (provider: "google" | "onedrive") => Promise<StorageResult<StorageDisconnectResult>>;
    setRetention: (count: number) => Promise<StorageResult<StorageLocationStatus>>;
    backUpNow: () => Promise<StorageResult<StorageBackupOutcome>>;
    list: () => Promise<StorageResult<StorageLocationListing>>;
    history: () => Promise<StorageResult<StorageHistoryEntry[]>>;
    /**
     * Downloads (cloud) or reads (local) the backup to a private temporary file and runs
     * the existing archive validation. The result is staged with backups.stageRestore.
     */
    prepareRestore: (itemId: string) => Promise<StorageResult<BackupRestoreSelection>>;
    /** Local: opens the file. Cloud: asks where to save it, downloads and verifies it. */
    openDocument: (itemId: string) => Promise<StorageResult<{ savedTo: string | null }>>;
  };
}

export const STORAGE_LOCATION_CHANNELS = [
  "storage-location:status", "storage-location:select", "storage-location:choose-local-folder",
  "storage-location:connect", "storage-location:cancel-connect", "storage-location:disconnect",
  "storage-location:set-retention", "storage-location:back-up-now", "storage-location:list",
  "storage-location:history", "storage-location:prepare-restore", "storage-location:open-document",
] as const;
