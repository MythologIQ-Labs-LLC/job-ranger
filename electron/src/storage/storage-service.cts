import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BackupCreateResult, BackupRestoreSelection, JobRangerArchiveProducer } from "../../../src/shared/backup.js";
import {
  STORAGE_PROVIDER_LABELS,
  type StorageBackupOutcome, type StorageBackupStatus, type StorageCredentialStorage, type StorageDisconnectResult,
  type StorageHistoryEntry, type StorageLocationItem, type StorageLocationListing, type StorageLocationStatus,
  type StorageProviderKind, type StorageProviderStatus, type StorageRecordKind,
} from "../../../src/shared/storage-locations.js";
import { GoogleStorageProvider, type GoogleFolderIds } from "./google-storage-provider.cjs";
import { MICROSOFT_MANUAL_REVOKE_HINT, type MicrosoftAuth } from "./microsoft-auth.cjs";
import { OneDriveProvider } from "./onedrive-provider.cjs";
import { StorageConfigStore, validRetention, type StorageConfig } from "./storage-config.cjs";
import type { StorageEgress } from "./storage-egress.cjs";
import {
  hashFile, LocalFolderProvider, STORAGE_FILE_NAME, StorageProviderError, validateLocalFolder,
  type RemoteEntry, type RetryPolicy, type StorageFolder, type StorageProvider,
} from "./storage-provider.cjs";
import type { StorageRecord, StorageRecords } from "./storage-records.cjs";
import type { WorkspaceChangeMonitor } from "./workspace-change-monitor.cjs";

export const STORAGE_WORK_PREFIX = ".job-ranger-storage-work-";
/** Largest file Sojourner downloads from a location (a .jobranger archive is < 2 GiB). */
export const STORAGE_DOWNLOAD_LIMIT = 2 * 1024 * 1024 * 1024 - 1;
const ARCHIVE_EXTENSION = ".jobranger";

/** The Google side of #369's Drive sign-in, as the storage location uses it. */
export interface GoogleAuthPort {
  configured: boolean;
  connecting: boolean;
  account(): Promise<{ accountId: string; label: string } | null>;
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  invalidateAccessToken(): void;
  connect(flowId: string): Promise<unknown>;
  cancelConnect(flowId?: string): boolean;
  disconnect(): Promise<{ revoked: boolean }>;
  credentialStorage(): StorageCredentialStorage;
  credentialUnavailable(): boolean;
}

export interface MicrosoftAuthPort extends Pick<MicrosoftAuth, "configured" | "connecting" | "account" |
  "getAccessToken" | "invalidateAccessToken" | "connect" | "cancelConnect" | "disconnect"> {
  credentialStorage(): StorageCredentialStorage;
  credentialUnavailable(): boolean;
}

export interface StorageTimings {
  /** Quiet time after the last workspace change before an automatic backup. */
  debounceMs: number;
  /** An automatic backup runs at the latest this long after the first unbacked change. */
  maxDelayMs: number;
  /** Retry delays after consecutive failures (the last one repeats). */
  retryDelaysMs: readonly number[];
  pollMs: number;
}

export const DEFAULT_STORAGE_TIMINGS: StorageTimings = {
  debounceMs: 10 * 60_000,
  maxDelayMs: 60 * 60_000,
  retryDelaysMs: [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000],
  pollMs: 5_000,
};

export function testTimings(debounceMs: number | null, retryBaseMs: number | null, pollMs: number | null): StorageTimings {
  return {
    debounceMs: debounceMs ?? DEFAULT_STORAGE_TIMINGS.debounceMs,
    maxDelayMs: debounceMs ? debounceMs * 6 : DEFAULT_STORAGE_TIMINGS.maxDelayMs,
    retryDelaysMs: retryBaseMs ? [retryBaseMs, retryBaseMs * 2, retryBaseMs * 4] : DEFAULT_STORAGE_TIMINGS.retryDelaysMs,
    pollMs: pollMs ?? DEFAULT_STORAGE_TIMINGS.pollMs,
  };
}

export interface StorageServiceOptions {
  enabled: boolean;
  userDataDirectory: string;
  defaultLocalFolder: string;
  backups: {
    createArchive(archivePath: string, producer: JobRangerArchiveProducer): Promise<BackupCreateResult>;
    validateRestoreSource(selectedPath: string): Promise<BackupRestoreSelection>;
  };
  producer: JobRangerArchiveProducer;
  config: StorageConfigStore;
  records: StorageRecords;
  monitor: WorkspaceChangeMonitor;
  google: GoogleAuthPort;
  googleUnavailableReason: string | null;
  microsoft: MicrosoftAuthPort;
  microsoftUnavailableReason: string | null;
  egress: StorageEgress;
  timings?: StorageTimings;
  retry?: RetryPolicy;
  now?: () => Date;
}

interface DocumentJob {
  sourcePath: string;
  name: string;
  attempts: number;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
}

/** A safe, unique location name for an exported document. */
export function documentName(sourceName: string, at: Date): string {
  const extension = path.extname(sourceName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  const base = path.basename(sourceName, path.extname(sourceName)).replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "").slice(0, 120) || "document";
  return `${stamp(at)}-${base}${extension}`;
}

export function backupName(kind: "automatic" | "manual", at: Date, sha256: string): string {
  return `Sojourner-backup-${kind}-${stamp(at)}-${sha256.slice(0, 8)}${ARCHIVE_EXTENSION}`;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The label stored in a record. Records live in the workspace database, so they travel in
 * every backup: they never carry the account e-mail. Cloud labels name the provider only;
 * the account is added at display time from the live sign-in.
 */
export function recordLabel(kind: StorageProviderKind, locationKey: string): string {
  if (kind === "google") return "Google Drive > Sojourner";
  if (kind === "onedrive") return "OneDrive > Apps > Sojourner";
  return locationKey;
}

/** Documents Sojourner opens or saves from a location: only the kinds it exports. */
export const OPENABLE_DOCUMENT_EXTENSIONS = [".pdf", ".json"] as const;

export function openableDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  return OPENABLE_DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

interface RecordMatch {
  record: StorageRecord;
  /** Same remote item (id; locally the path) and size: the copy Sojourner recorded. */
  exact: boolean;
}

/**
 * Matches a file at the location to the record of the copy Sojourner made. A file found
 * only by path (same name, different item id or size) was replaced after Sojourner copied
 * it, so it is never treated as Sojourner's verified copy.
 */
export function matchRecord(kind: StorageProviderKind, entry: RemoteEntry, records: readonly StorageRecord[]): RecordMatch | null {
  const samePath = records.filter((record) => record.remotePath === entry.remotePath);
  const exact = samePath.find((record) => (kind === "local" || record.remoteId === entry.remoteId) && record.size === entry.size);
  if (exact) return { record: exact, exact: true };
  return samePath[0] ? { record: samePath[0], exact: false } : null;
}

function itemKey(provider: StorageProviderKind, entry: RemoteEntry): string {
  return provider === "google" ? entry.remoteId : entry.name;
}

/**
 * Storage locations for the Windows app (#249): automatic and manual workspace backups
 * and exported documents copied to one chosen location, listed and restored from there.
 *
 * - The live database never leaves the user-data folder; backups are full `.jobranger`
 *   archives from the existing streaming export, restores go through the existing
 *   validate -> stage -> restart path.
 * - One operation at a time (backups, document copies, retention, recovery).
 * - Automatic backups run after a quiet period following workspace changes, at the
 *   latest after a maximum delay, on quit when changes are unbacked, and retry with
 *   backoff after failures, which stay visible in the status.
 * - Every copy is recorded pending -> uploaded -> verified (or failed); only a verified
 *   record counts as a backup, and retention removes only older verified AUTOMATIC
 *   backups Sojourner recorded at that location.
 */
export class StorageService {
  private readonly timings: StorageTimings;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private nextAttemptAt: number | null = null;
  private pendingSince: number | null = null;
  private lastChangeAt: number | null = null;
  private failures = 0;
  private retryAt: number | null = null;
  private lastError: string | null = null;
  private lastErrorAt: string | null = null;
  private warning: string | null = null;
  private documentError: string | null = null;
  private documents: DocumentJob[] = [];
  private documentRetryAt: number | null = null;
  private stopped = false;

  constructor(private readonly options: StorageServiceOptions) {
    this.timings = options.timings ?? DEFAULT_STORAGE_TIMINGS;
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  /** Applies migration 1011, recovers local records and starts watching for changes. */
  async start(): Promise<void> {
    await this.removeWorkFiles();
    await this.options.records.initialize();
    const config = await this.options.config.load();
    if (!this.options.enabled) return;
    const dirty = await this.options.monitor.start(config.cleanChangeCounter);
    if (dirty) this.markChanged();
    this.options.monitor.onChange(() => this.markChanged());
    this.pollTimer = setInterval(() => void this.options.monitor.poll(), this.timings.pollMs);
    this.pollTimer.unref?.();
    if (config.selected === "local") {
      void this.enqueue(async () => {
        const provider = await this.activeProvider();
        await this.recover(provider);
      }).catch(() => undefined);
    }
    this.schedule();
  }

  /**
   * Removes temporary archives and downloads an earlier session left behind (a quit-flush
   * timeout, a crash or a power loss mid-backup can leave up to a full archive each).
   */
  async removeWorkFiles(): Promise<void> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.options.userDataDirectory);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(STORAGE_WORK_PREFIX)) {
        await fs.rm(path.join(this.options.userDataDirectory, name), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.timer = null;
    this.pollTimer = null;
  }

  private requireEnabled(): void {
    if (!this.options.enabled) throw new Error("Storage locations are available only in the Sojourner Windows app.");
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private markChanged(): void {
    const at = this.now().getTime();
    this.lastChangeAt = at;
    this.pendingSince ??= at;
    this.schedule();
  }

  // ---------------------------------------------------------------- providers

  private async localFolder(config?: StorageConfig): Promise<string> {
    return (config ?? await this.options.config.load()).localFolder ?? this.options.defaultLocalFolder;
  }

  private async providerFor(kind: StorageProviderKind): Promise<StorageProvider> {
    if (kind === "local") {
      return new LocalFolderProvider(await validateLocalFolder(await this.localFolder(), this.options.userDataDirectory));
    }
    if (kind === "google") {
      if (!this.options.google.configured) throw new StorageProviderError("action_needed", this.options.googleUnavailableReason ?? "Google Drive is not set up in this build of Sojourner.");
      const account = await this.options.google.account();
      if (!account) throw new StorageProviderError("action_needed", "Connect Google Drive first.");
      const config = await this.options.config.load();
      return new GoogleStorageProvider({
        token: (force) => this.options.google.getAccessToken(force),
        invalidate: () => this.options.google.invalidateAccessToken(),
        accountId: account.accountId,
        accountLabel: account.label,
        fetch: this.options.egress.fetch,
        folders: config.googleFolders,
        saveFolders: async (folders: GoogleFolderIds) => {
          await this.options.config.update({ googleFolders: folders });
        },
        retry: this.options.retry,
      });
    }
    if (!this.options.microsoft.configured) throw new StorageProviderError("action_needed", this.options.microsoftUnavailableReason ?? "OneDrive is not set up in this build of Sojourner.");
    const account = await this.options.microsoft.account();
    if (!account) throw new StorageProviderError("action_needed", "Connect OneDrive first.");
    return new OneDriveProvider({
      token: (force) => this.options.microsoft.getAccessToken(force),
      invalidate: () => this.options.microsoft.invalidateAccessToken(),
      accountId: account.accountId,
      accountLabel: account.label,
      egress: this.options.egress,
      retry: this.options.retry,
    });
  }

  private async activeProvider(): Promise<StorageProvider> {
    const config = await this.options.config.load();
    if (!config.selected) throw new StorageProviderError("action_needed", "Choose a storage location first.");
    return this.providerFor(config.selected);
  }

  /** True when the selected location can take a backup right now (no network check). */
  private async ready(): Promise<boolean> {
    const config = await this.options.config.load();
    if (!config.selected) return false;
    if (config.selected === "local") return true;
    if (config.selected === "google") return this.options.google.configured && (await this.options.google.account()) !== null;
    return this.options.microsoft.configured && (await this.options.microsoft.account()) !== null;
  }

  // ---------------------------------------------------------------- scheduling

  private schedule(): void {
    if (this.stopped || !this.options.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAttemptAt = null;
    void this.ready().then((ready) => {
      if (this.stopped || !ready) return;
      let due = Number.POSITIVE_INFINITY;
      if (this.pendingSince !== null) {
        const lastChange = this.lastChangeAt ?? this.pendingSince;
        due = Math.min(lastChange + this.timings.debounceMs, this.pendingSince + this.timings.maxDelayMs);
        if (this.retryAt !== null) due = Math.max(due, this.retryAt);
      }
      if (this.documents.length > 0) due = Math.min(due, this.documentRetryAt ?? this.now().getTime());
      if (!Number.isFinite(due)) return;
      const delay = Math.max(0, due - this.now().getTime());
      if (this.timer) clearTimeout(this.timer);
      this.nextAttemptAt = due;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.nextAttemptAt = null;
        void this.tick();
      }, delay);
      this.timer.unref?.();
    });
  }

  private retryDelay(failures = this.failures): number {
    const delays = this.timings.retryDelaysMs;
    return delays[Math.max(0, Math.min(failures - 1, delays.length - 1))];
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.documents.length > 0 && (this.documentRetryAt ?? 0) <= this.now().getTime()) await this.flushDocuments();
    const now = this.now().getTime();
    const lastChange = this.lastChangeAt ?? this.pendingSince;
    if (this.pendingSince !== null && lastChange !== null && (this.retryAt ?? 0) <= now &&
        (lastChange + this.timings.debounceMs <= now || this.pendingSince + this.timings.maxDelayMs <= now)) {
      await this.backUp("automatic").catch(() => undefined);
    }
    this.schedule();
  }

  /** True when quitting now would leave workspace changes without a backup at the location. */
  async needsQuitFlush(): Promise<boolean> {
    if (!this.options.enabled || this.stopped) return false;
    await this.options.monitor.poll().catch(() => false);
    return (this.pendingSince !== null || this.running) && await this.ready();
  }

  /** Runs the pending automatic backup before quitting (bounded by `timeoutMs`). */
  async flushForQuit(timeoutMs: number): Promise<void> {
    const work = this.backUp("automatic").then(() => undefined, () => undefined);
    let timeout: NodeJS.Timeout | null = null;
    await Promise.race([work, new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); })]);
    if (timeout) clearTimeout(timeout);
    this.stop();
  }

  // ---------------------------------------------------------------- backups

  /** Creates, uploads and verifies one backup; never runs concurrently with another. */
  backUp(kind: "automatic" | "manual"): Promise<StorageBackupOutcome> {
    this.requireEnabled();
    return this.enqueue(async () => {
      await this.options.monitor.poll().catch(() => false);
      if (kind === "automatic" && this.pendingSince === null) {
        throw new Error("Nothing changed since the last backup.");
      }
      this.running = true;
      try {
        const outcome = await this.runBackup(kind);
        this.failures = 0;
        this.retryAt = null;
        this.lastError = null;
        this.lastErrorAt = null;
        return outcome;
      } catch (error) {
        this.failures += 1;
        this.lastError = message(error, "The backup failed.");
        this.lastErrorAt = this.now().toISOString();
        this.retryAt = this.now().getTime() + this.retryDelay();
        throw new Error(this.lastError);
      } finally {
        this.running = false;
        this.schedule();
      }
    });
  }

  private async runBackup(kind: "automatic" | "manual"): Promise<StorageBackupOutcome> {
    const provider = await this.activeProvider();
    await this.recover(provider);
    await this.options.monitor.poll();
    const changesAtStart = this.options.monitor.changes;
    const workDirectory = path.join(this.options.userDataDirectory, `${STORAGE_WORK_PREFIX}${randomUUID()}`);
    await fs.mkdir(workDirectory, { recursive: true });
    try {
      const created = await this.options.backups.createArchive(path.join(workDirectory, `backup${ARCHIVE_EXTENSION}`), this.options.producer);
      const archive = created.archive;
      if (!archive) throw new Error("The backup archive was not created.");
      const at = this.now();
      const name = backupName(kind, at, archive.sha256);
      const record = await this.copy(provider, { folder: "Backups", name, filePath: archive.path, size: archive.bytes,
        sha256: archive.sha256, kind });
      const removed = kind === "automatic" ? await this.applyRetention(provider) : 0;
      const verifiedAt = this.now().toISOString();
      const clean = this.options.monitor.changes === changesAtStart;
      if (clean) {
        this.pendingSince = null;
        this.lastChangeAt = null;
      }
      await this.options.config.update({
        lastSuccessAt: verifiedAt, lastSuccessName: record.name, lastSuccessProvider: provider.kind,
        ...(clean ? { cleanChangeCounter: this.options.monitor.counter } : {}),
      });
      return { name: record.name, size: record.size, provider: provider.kind, verifiedAt, removedByRetention: removed };
    } finally {
      await fs.rm(workDirectory, { recursive: true, force: true });
    }
  }

  /** Records, uploads and verifies one file at a location. */
  private async copy(provider: StorageProvider, input: { folder: StorageFolder; name: string; filePath: string;
    size: number; sha256: string; kind: StorageRecordKind }): Promise<StorageRecord> {
    const id = randomUUID();
    const record = await this.options.records.insertPending({
      id, provider: provider.kind, locationKey: await provider.locationKey(),
      locationLabel: recordLabel(provider.kind, await provider.locationKey()),
      remotePath: `${input.folder}/${input.name}`, name: input.name, size: input.size, sha256: input.sha256, kind: input.kind,
    });
    let ref;
    try {
      ref = await provider.upload({
        ...input, recordId: id,
        beforeSend: async (remote) => {
          await this.options.records.setRemote(id, remote.remoteId, remote.remotePath);
        },
      });
    } catch (error) {
      await this.options.records.transition(id, "pending", "failed", { error: message(error, "The upload failed.") });
      throw error;
    }
    await this.options.records.transition(id, "pending", "uploaded", { remoteId: ref.remoteId });
    if (!(await provider.verify(ref, { size: input.size, sha256: input.sha256, recordId: id }))) {
      const reason = `${STORAGE_PROVIDER_LABELS[provider.kind]} did not return the exact bytes Sojourner stored, so this copy is not counted as a backup.`;
      await this.options.records.transition(id, "uploaded", "failed", { error: reason });
      throw new Error(reason);
    }
    await this.options.records.transition(id, "uploaded", "verified", { error: null });
    return { ...record, remoteId: ref.remoteId, status: "verified" };
  }

  /** Keeps the newest N verified automatic backups Sojourner recorded at this location. */
  private async applyRetention(provider: StorageProvider): Promise<number> {
    const { retention } = await this.options.config.load();
    const records = await this.options.records.verifiedAutomatic(provider.kind, await provider.locationKey());
    let removed = 0;
    const problems: string[] = [];
    for (const record of records.slice(retention)) {
      try {
        const result = await provider.remove({ remoteId: record.remoteId, remotePath: record.remotePath },
          { size: record.size, sha256: record.sha256 });
        if (result === "mismatch") {
          problems.push(`${record.name} was changed outside Sojourner, so it was kept.`);
          continue;
        }
        await this.options.records.transition(record.id, "verified", "deleted");
        if (result === "deleted") removed += 1;
      } catch (error) {
        problems.push(`${record.name}: ${message(error, "could not be removed")}`);
      }
    }
    this.warning = problems.length ? `Retention kept some older automatic backups: ${problems.slice(0, 3).join(" ")}` : null;
    return removed;
  }

  /** Re-checks records a crash or failure left pending or uploaded at this location. */
  private async recover(provider: StorageProvider): Promise<void> {
    // Operations are serialized, so no copy is in progress: any partial file is a leftover.
    if (provider instanceof LocalFolderProvider) await provider.removePartials();
    const locationKey = await provider.locationKey();
    for (const record of await this.options.records.unresolved()) {
      if (record.provider !== provider.kind || record.locationKey !== locationKey) continue;
      const ref = { remoteId: record.remoteId, remotePath: record.remotePath };
      if (await provider.verify(ref, { size: record.size, sha256: record.sha256, recordId: record.id })) {
        await this.options.records.transition(record.id, record.status, "verified", { error: null });
        continue;
      }
      const presence = record.provider === "google" && !record.remoteId ? "absent" : await provider.probe(ref);
      if (presence === "unknown") continue;
      await this.options.records.transition(record.id, record.status, "failed", {
        error: presence === "absent" ? "Sojourner stopped before this copy finished." : "Sojourner stopped before this copy was verified, and it did not verify afterwards.",
      });
    }
  }

  // ---------------------------------------------------------------- documents

  /** Copies an exported document to the selected location (queued, retried on failure). */
  queueDocument(sourcePath: string, sourceName = path.basename(sourcePath)): void {
    if (!this.options.enabled || this.stopped) return;
    void this.ready().then((ready) => {
      if (!ready) return;
      this.documents.push({ sourcePath, name: sourceName, attempts: 0 });
      this.schedule();
    });
  }

  private async flushDocuments(): Promise<void> {
    const jobs = this.documents.splice(0);
    this.documentRetryAt = null;
    for (const job of jobs) {
      try {
        await this.enqueue(() => this.copyDocument(job));
        this.documentError = null;
      } catch (error) {
        job.attempts += 1;
        this.documentError = `${path.basename(job.name)} was not copied to the storage location: ${message(error, "the copy failed")}`;
        if (job.attempts < 5) {
          this.documents.push(job);
          this.documentRetryAt = Math.max(this.documentRetryAt ?? 0, this.now().getTime() + this.retryDelay(job.attempts));
        }
      }
    }
  }

  private async copyDocument(job: DocumentJob): Promise<void> {
    const provider = await this.activeProvider();
    const stat = await fs.lstat(job.sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > STORAGE_DOWNLOAD_LIMIT) {
      throw new Error("The exported document is not a regular file.");
    }
    const workDirectory = path.join(this.options.userDataDirectory, `${STORAGE_WORK_PREFIX}${randomUUID()}`);
    await fs.mkdir(workDirectory, { recursive: true });
    try {
      // Copy first, so the uploaded bytes are exactly the ones hashed and recorded.
      const snapshot = path.join(workDirectory, "document");
      await fs.copyFile(job.sourcePath, snapshot);
      const { size, sha256 } = await hashFile(snapshot);
      const key = await provider.locationKey();
      const existing = (await this.options.records.forLocation(provider.kind, key))
        .some((record) => record.kind === "document" && record.status === "verified" && record.sha256 === sha256);
      if (existing) return;
      await this.copy(provider, { folder: "Documents", name: documentName(job.name, this.now()), filePath: snapshot,
        size, sha256, kind: "document" });
    } finally {
      await fs.rm(workDirectory, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- settings

  async select(kind: StorageProviderKind): Promise<StorageLocationStatus> {
    this.requireEnabled();
    if (kind === "local") {
      await validateLocalFolder(await this.localFolder(), this.options.userDataDirectory);
    } else {
      await this.providerFor(kind);
    }
    const config = await this.options.config.load();
    if (config.selected !== kind) {
      await this.options.config.update({ selected: kind });
      // A new location starts with a backup of the current workspace.
      this.markChanged();
      this.failures = 0;
      this.retryAt = null;
      this.lastError = null;
      this.lastErrorAt = null;
    }
    this.schedule();
    return this.status();
  }

  async setLocalFolder(folder: string): Promise<StorageLocationStatus> {
    this.requireEnabled();
    const resolved = await validateLocalFolder(folder, this.options.userDataDirectory);
    const config = await this.options.config.load();
    const changed = config.localFolder !== resolved || config.selected !== "local";
    await this.options.config.update({ localFolder: resolved, selected: "local" });
    if (changed) {
      this.markChanged();
      this.failures = 0;
      this.retryAt = null;
      this.lastError = null;
      this.lastErrorAt = null;
    }
    this.schedule();
    return this.status();
  }

  async setRetention(count: unknown): Promise<StorageLocationStatus> {
    this.requireEnabled();
    await this.options.config.update({ retention: validRetention(count) });
    return this.status();
  }

  async connect(kind: "google" | "onedrive", flowId: string): Promise<StorageLocationStatus> {
    this.requireEnabled();
    if (kind === "google") await this.options.google.connect(flowId);
    else await this.options.microsoft.connect(flowId);
    return this.select(kind);
  }

  cancelConnect(kind: "google" | "onedrive", flowId: string): boolean {
    return kind === "google" ? this.options.google.cancelConnect(flowId) : this.options.microsoft.cancelConnect(flowId);
  }

  async disconnect(kind: "google" | "onedrive"): Promise<StorageDisconnectResult> {
    this.requireEnabled();
    const config = await this.options.config.load();
    let revoked: boolean;
    let text: string;
    if (kind === "google") {
      ({ revoked } = await this.options.google.disconnect());
      await this.options.config.update({ googleFolders: null });
      text = revoked
        ? "Google Drive disconnected. Sojourner deleted its saved Google sign-in and Google revoked its access. This also disconnects Google Drive resume export."
        : "Google Drive disconnected. Sojourner deleted its saved Google sign-in on this device, but Google did not confirm the revocation. You can remove Sojourner's access at myaccount.google.com/permissions. This also disconnects Google Drive resume export.";
    } else {
      ({ revoked } = await this.options.microsoft.disconnect());
      text = `OneDrive disconnected. Sojourner deleted its saved Microsoft sign-in on this device. ${MICROSOFT_MANUAL_REVOKE_HINT}`;
    }
    if (config.selected === kind) {
      await this.options.config.update({ selected: null });
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.nextAttemptAt = null;
      this.documents = [];
      this.documentRetryAt = null;
      this.retryAt = null;
      this.failures = 0;
    }
    return { revoked, message: text, status: await this.status() };
  }

  // ---------------------------------------------------------------- status

  private providerStatus = async (kind: StorageProviderKind, config: StorageConfig): Promise<StorageProviderStatus> => {
    const label = STORAGE_PROVIDER_LABELS[kind];
    if (kind === "local") {
      const folder = await this.localFolder(config);
      return { provider: kind, label, configured: true, unavailableReason: null, connected: true, connecting: false,
        accountLabel: folder, credentialStorage: "none", locationDescription: folder,
        message: config.localFolder ? `Backups and documents go to ${folder}.` : `Backups and documents go to ${folder} (the default).` };
    }
    const auth = kind === "google" ? this.options.google : this.options.microsoft;
    const unavailable = kind === "google" ? this.options.googleUnavailableReason : this.options.microsoftUnavailableReason;
    if (!auth.configured) {
      return { provider: kind, label, configured: false, connected: false, connecting: false, accountLabel: null,
        credentialStorage: "none", locationDescription: null,
        unavailableReason: unavailable ?? `${label} is not set up in this build of Sojourner.`,
        message: unavailable ?? `${label} is not set up in this build of Sojourner.` };
    }
    if (auth.connecting) {
      return { provider: kind, label, configured: true, unavailableReason: null, connected: false, connecting: true,
        accountLabel: null, credentialStorage: "none", locationDescription: null,
        message: `Finish signing in to ${label} in your browser.` };
    }
    const account = await auth.account();
    if (!account) {
      return { provider: kind, label, configured: true, unavailableReason: null, connected: false, connecting: false,
        accountLabel: null, credentialStorage: "none", locationDescription: null,
        message: auth.credentialUnavailable()
          ? `Sojourner could not unlock the saved ${label} sign-in on this device. Disconnect ${label}, then connect again.`
          : `${label} is not connected on this device.` };
    }
    const storage = auth.credentialStorage();
    const description = kind === "google" ? `Google Drive > Sojourner (${account.label})` : `${account.label} > Apps > Sojourner`;
    return { provider: kind, label, configured: true, unavailableReason: null, connected: true, connecting: false,
      accountLabel: account.label, credentialStorage: storage, locationDescription: description,
      message: storage === "encrypted"
        ? `${label} is connected as ${account.label}. Windows keeps the sign-in encrypted on this device.`
        : `${label} is connected as ${account.label} for this session only. Windows encryption is not available, so Sojourner did not save the sign-in; you will need to connect again after restarting.` };
  };

  async status(): Promise<StorageLocationStatus> {
    const config = await this.options.config.load();
    const backup: StorageBackupStatus = {
      running: this.running,
      pendingChanges: this.pendingSince !== null,
      lastSuccessAt: config.lastSuccessAt,
      lastSuccessName: config.lastSuccessName,
      lastSuccessProvider: config.lastSuccessProvider,
      lastError: this.lastError,
      lastErrorAt: this.lastError ? this.lastErrorAt : null,
      nextAttemptAt: this.nextAttemptAt !== null ? new Date(this.nextAttemptAt).toISOString() : null,
      documentError: this.documentError,
      warning: this.warning,
    };
    if (!this.options.enabled) {
      return { available: false, selected: null, retention: config.retention, providers: [], backup };
    }
    const providers = await Promise.all((["local", "google", "onedrive"] as const).map((kind) => this.providerStatus(kind, config)));
    return { available: true, selected: config.selected, retention: config.retention, providers, backup };
  }

  // ---------------------------------------------------------------- reading back

  async list(): Promise<StorageLocationListing> {
    this.requireEnabled();
    return this.enqueue(async () => {
      const provider = await this.activeProvider();
      const key = await provider.locationKey();
      const records = await this.options.records.forLocation(provider.kind, key);
      const annotate = (entry: RemoteEntry): StorageLocationItem => {
        const match = matchRecord(provider.kind, entry, records);
        const record = match?.record ?? null;
        // Sojourner's copy, verified: the exact item it recorded, in the verified state.
        const verified = match !== null && match.exact && record?.status === "verified";
        // Known bad: Sojourner's copy that never verified, or a file that replaced it.
        const bad = match !== null && !verified;
        return {
          itemId: `${entry.folder}:${itemKey(provider.kind, entry)}`,
          name: entry.name, size: entry.size, createdAt: entry.createdAt ?? record?.createdAt ?? null, folder: entry.folder,
          kind: record?.kind ?? null,
          status: match === null ? null : match.exact ? record!.status : "replaced",
          restorable: entry.folder === "Backups" && entry.name.toLowerCase().endsWith(ARCHIVE_EXTENSION) && !bad,
          openable: entry.folder === "Documents" && verified && record?.kind === "document" && openableDocumentName(entry.name),
        };
      };
      const backups = await provider.list("Backups");
      const documents = await provider.list("Documents");
      const byDate = (a: StorageLocationItem, b: StorageLocationItem) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      return {
        provider: provider.kind,
        locationDescription: await provider.locationLabel(),
        backups: backups.entries.map(annotate).sort(byDate),
        documents: documents.entries.map(annotate).sort(byDate),
        truncated: backups.truncated || documents.truncated,
      };
    });
  }

  async history(): Promise<StorageHistoryEntry[]> {
    this.requireEnabled();
    const config = await this.options.config.load();
    let currentKey: string | null = null;
    if (config.selected) {
      try {
        currentKey = `${config.selected}:${await (await this.providerFor(config.selected)).locationKey()}`;
      } catch {
        currentKey = null;
      }
    }
    const google = await this.options.google.account().catch(() => null);
    const microsoft = await this.options.microsoft.account().catch(() => null);
    const label = (record: StorageRecord): string => {
      const account = record.provider === "google" ? google : record.provider === "onedrive" ? microsoft : null;
      return account && account.accountId === record.locationKey ? `${record.locationLabel} (${account.label})` : record.locationLabel;
    };
    return (await this.options.records.history()).map((record) => ({
      id: record.id, provider: record.provider, locationLabel: label(record), name: record.name, size: record.size,
      kind: record.kind, status: record.status, createdAt: record.createdAt, error: record.error,
      current: currentKey === `${record.provider}:${record.locationKey}`,
    }));
  }

  private async resolveItem(provider: StorageProvider, itemId: unknown): Promise<RemoteEntry> {
    if (typeof itemId !== "string" || itemId.length > 260) throw new Error("Invalid storage item.");
    const separator = itemId.indexOf(":");
    const folder = itemId.slice(0, separator);
    const key = itemId.slice(separator + 1);
    if (separator < 1 || (folder !== "Backups" && folder !== "Documents") || !key) throw new Error("Invalid storage item.");
    const entry = await provider.resolve(folder, key);
    if (!entry) throw new Error("That file is no longer at the storage location.");
    return entry;
  }

  private async recordFor(provider: StorageProvider, entry: RemoteEntry): Promise<RecordMatch | null> {
    return matchRecord(provider.kind, entry, await this.options.records.forLocation(provider.kind, await provider.locationKey()));
  }

  /**
   * Restore source: downloads (or copies) the archive into a private temporary file and
   * runs the existing archive validation on it. Staging and the restart then use the
   * existing backups:stage-restore path, which validates the bundle again.
   */
  async prepareRestore(itemId: unknown): Promise<BackupRestoreSelection> {
    this.requireEnabled();
    return this.enqueue(async () => {
      const provider = await this.activeProvider();
      const entry = await this.resolveItem(provider, itemId);
      if (entry.folder !== "Backups" || !entry.name.toLowerCase().endsWith(ARCHIVE_EXTENSION)) {
        throw new Error("Only a Sojourner backup (.jobranger) can be restored.");
      }
      const match = await this.recordFor(provider, entry);
      if (match && !match.exact) {
        throw new Error("This file replaced the backup Sojourner saved under that name, so Sojourner will not restore from it.");
      }
      const record = match?.record ?? null;
      if (record && record.status !== "verified") {
        throw new Error("This backup was never verified, so Sojourner will not restore from it.");
      }
      const temporary = path.join(this.options.userDataDirectory, `${STORAGE_WORK_PREFIX}${randomUUID()}${ARCHIVE_EXTENSION}`);
      try {
        const downloaded = await provider.download(entry, temporary, STORAGE_DOWNLOAD_LIMIT);
        if (record && (downloaded.size !== record.size || downloaded.sha256 !== record.sha256)) {
          throw new Error("This backup changed since Sojourner verified it, so it was not restored.");
        }
        const selection = await this.options.backups.validateRestoreSource(temporary);
        if (!record) {
          selection.warnings.push("This backup was not created by Sojourner on this device. It passed the same integrity checks as any backup.");
        }
        return selection;
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  }

  /** Local documents open in place; cloud documents are saved where the person chooses. */
  async openDocument(itemId: unknown, io: {
    openPath: (target: string) => Promise<void>;
    chooseSavePath: (name: string) => Promise<string | null>;
  }): Promise<{ savedTo: string | null }> {
    this.requireEnabled();
    const provider = await this.activeProvider();
    const entry = await this.resolveItem(provider, itemId);
    const match = await this.recordFor(provider, entry);
    const record = match?.record ?? null;
    if (entry.folder !== "Documents" || !openableDocumentName(entry.name) || !match || !match.exact ||
        !record || record.kind !== "document" || record.status !== "verified") {
      throw new Error("Sojourner opens only the PDF and JSON documents it copied to this location and verified.");
    }
    if (provider instanceof LocalFolderProvider) {
      const target = provider.absolutePath(entry);
      const observed = await hashFile(target);
      if (observed.size !== record.size || observed.sha256 !== record.sha256) {
        throw new Error("This document changed since Sojourner copied it, so Sojourner did not open it.");
      }
      await io.openPath(target);
      return { savedTo: null };
    }
    const target = await io.chooseSavePath(entry.name);
    if (!target) return { savedTo: null };
    return this.enqueue(async () => {
      const temporary = `${target}.sojourner-download-${randomUUID()}`;
      try {
        const downloaded = await provider.download(entry, temporary, STORAGE_DOWNLOAD_LIMIT);
        if (downloaded.size !== record.size || downloaded.sha256 !== record.sha256) {
          throw new Error("This document changed since Sojourner copied it, so it was not saved.");
        }
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return { savedTo: target };
    });
  }
}

export function validStorageFileName(name: string): boolean {
  return STORAGE_FILE_NAME.test(name);
}
