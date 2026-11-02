import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CredentialEncryption } from "../drive/drive-credential-store.cjs";
import type { StorageCredentialStorage } from "../../../src/shared/storage-locations.js";

export interface StoredMicrosoftCredential {
  refreshToken: string;
  /** OneDrive drive id of the account that granted this token. */
  accountId: string;
  accountLabel: string;
  scope: string;
  savedAt: string;
}

/** In the user-data root, outside data/, so backups and .jobranger archives never include it. */
export const MICROSOFT_CREDENTIAL_FILE = "microsoft-onedrive-credential.bin";
export const ONEDRIVE_ACCOUNT_ID = /^[A-Za-z0-9!_.-]{1,200}$/;

function parseCredential(text: string): StoredMicrosoftCredential | null {
  try {
    const value = JSON.parse(text) as Partial<StoredMicrosoftCredential>;
    if (typeof value.refreshToken !== "string" || !value.refreshToken || value.refreshToken.length > 16_384) return null;
    if (typeof value.accountId !== "string" || !ONEDRIVE_ACCOUNT_ID.test(value.accountId)) return null;
    return {
      refreshToken: value.refreshToken,
      accountId: value.accountId,
      accountLabel: typeof value.accountLabel === "string" && value.accountLabel.length <= 254
        ? value.accountLabel : "Verified OneDrive account",
      scope: typeof value.scope === "string" ? value.scope : "",
      savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Custody of the Microsoft refresh token, with the same rules as the Google one
 * (drive-credential-store.cts): encrypted with Electron safeStorage (DPAPI on Windows)
 * in a file in the user-data root, or held in memory for this session only when
 * encryption is unavailable. Never written to SQLite, logs, URLs, archives or IPC.
 */
export class MicrosoftCredentialStore {
  private readonly filePath: string;
  private cached: StoredMicrosoftCredential | null = null;
  private loaded = false;
  private sessionOnly = false;
  private unavailable = false;

  constructor(userDataDirectory: string, private readonly encryption: CredentialEncryption) {
    this.filePath = path.join(userDataDirectory, MICROSOFT_CREDENTIAL_FILE);
  }

  get path(): string {
    return this.filePath;
  }

  encryptionAvailable(): boolean {
    try {
      return this.encryption.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  credentialUnavailable(): boolean {
    return this.unavailable;
  }

  async load(): Promise<StoredMicrosoftCredential | null> {
    if (this.loaded) return this.cached;
    let encrypted: Buffer;
    try {
      encrypted = await fs.readFile(this.filePath);
    } catch {
      this.loaded = true;
      this.unavailable = false;
      return null;
    }
    if (!this.encryptionAvailable()) {
      this.unavailable = true;
      return null;
    }
    let text: string;
    try {
      text = this.encryption.decryptString(encrypted);
    } catch {
      this.unavailable = true;
      return null;
    }
    this.loaded = true;
    this.unavailable = false;
    this.cached = parseCredential(text);
    if (!this.cached) await fs.rm(this.filePath, { force: true });
    return this.cached;
  }

  async save(credential: StoredMicrosoftCredential): Promise<StorageCredentialStorage> {
    this.loaded = true;
    this.unavailable = false;
    this.cached = credential;
    if (!this.encryptionAvailable()) {
      this.sessionOnly = true;
      await fs.rm(this.filePath, { force: true });
      return "session";
    }
    let encrypted: Buffer;
    try {
      encrypted = this.encryption.encryptString(JSON.stringify(credential));
    } catch {
      this.sessionOnly = true;
      await fs.rm(this.filePath, { force: true });
      return "session";
    }
    this.sessionOnly = false;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return "encrypted";
  }

  async clear(): Promise<void> {
    this.cached = null;
    this.loaded = true;
    this.sessionOnly = false;
    this.unavailable = false;
    await fs.rm(this.filePath, { force: true });
  }

  storage(): StorageCredentialStorage {
    if (!this.cached) return "none";
    return this.sessionOnly ? "session" : "encrypted";
  }
}
