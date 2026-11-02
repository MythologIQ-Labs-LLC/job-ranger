import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_STORAGE_RETENTION, MAX_STORAGE_RETENTION, MIN_STORAGE_RETENTION, type StorageProviderKind,
} from "../../../src/shared/storage-locations.js";
import type { GoogleFolderIds } from "./google-storage-provider.cjs";

/**
 * Device settings for storage locations, in the user-data root (outside data/), so a
 * restored backup from another PC never changes where THIS PC backs up. Contains no
 * token: only the chosen provider, the local folder, retention, cached Google folder ids
 * and the last observed clean database change counter.
 */
export const STORAGE_CONFIG_FILE = "storage-location.json";

export interface StorageConfig {
  version: 1;
  selected: StorageProviderKind | null;
  localFolder: string | null;
  retention: number;
  googleFolders: GoogleFolderIds | null;
  /** SQLite file change counter when the workspace was last fully backed up. */
  cleanChangeCounter: number | null;
  lastSuccessAt: string | null;
  lastSuccessName: string | null;
  lastSuccessProvider: StorageProviderKind | null;
}

export function defaultStorageConfig(): StorageConfig {
  return {
    version: 1, selected: null, localFolder: null, retention: DEFAULT_STORAGE_RETENTION, googleFolders: null,
    cleanChangeCounter: null, lastSuccessAt: null, lastSuccessName: null, lastSuccessProvider: null,
  };
}

export function validRetention(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_STORAGE_RETENTION || value > MAX_STORAGE_RETENTION) {
    throw new Error(`Keep between ${MIN_STORAGE_RETENTION} and ${MAX_STORAGE_RETENTION} automatic backups.`);
  }
  return value;
}

const PROVIDERS = new Set(["local", "google", "onedrive"]);
const ID = /^[A-Za-z0-9_-]{1,160}$/;

function parse(value: unknown): StorageConfig {
  const config = defaultStorageConfig();
  if (!value || typeof value !== "object") return config;
  const raw = value as Record<string, unknown>;
  if (typeof raw.selected === "string" && PROVIDERS.has(raw.selected)) config.selected = raw.selected as StorageProviderKind;
  if (typeof raw.localFolder === "string" && path.isAbsolute(raw.localFolder)) config.localFolder = raw.localFolder;
  try { config.retention = validRetention(raw.retention); } catch { /* default */ }
  const folders = raw.googleFolders as Record<string, unknown> | null | undefined;
  if (folders && ["accountId", "rootId", "Backups", "Documents"].every((key) => typeof folders[key] === "string" && ID.test(folders[key] as string))) {
    config.googleFolders = folders as unknown as GoogleFolderIds;
  }
  if (typeof raw.cleanChangeCounter === "number" && Number.isSafeInteger(raw.cleanChangeCounter)) config.cleanChangeCounter = raw.cleanChangeCounter;
  if (typeof raw.lastSuccessAt === "string") config.lastSuccessAt = raw.lastSuccessAt;
  if (typeof raw.lastSuccessName === "string") config.lastSuccessName = raw.lastSuccessName;
  if (typeof raw.lastSuccessProvider === "string" && PROVIDERS.has(raw.lastSuccessProvider)) {
    config.lastSuccessProvider = raw.lastSuccessProvider as StorageProviderKind;
  }
  return config;
}

export class StorageConfigStore {
  private readonly filePath: string;
  private cached: StorageConfig | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, STORAGE_CONFIG_FILE);
  }

  async load(): Promise<StorageConfig> {
    if (this.cached) return { ...this.cached };
    try {
      this.cached = parse(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch {
      this.cached = defaultStorageConfig();
    }
    return { ...this.cached };
  }

  /** Applies a patch and writes the file atomically (temporary file + rename). */
  async update(patch: Partial<Omit<StorageConfig, "version">>): Promise<StorageConfig> {
    const next = { ...(await this.load()), ...patch, version: 1 as const };
    this.cached = next;
    const write = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(this.cached, null, 2)}\n`, "utf8");
        await fs.rename(temporary, this.filePath);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
    });
    this.writing = write.catch(() => undefined);
    await write;
    return { ...next };
  }
}
