import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DriveCredentialStorage } from "../../../src/shared/google-drive-desktop.js";

/** The subset of Electron's safeStorage the store needs (injected; tests use a fake). */
export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface StoredDriveCredential {
  refreshToken: string;
  /** Google Drive permissionId of the account that granted this token. */
  accountId: string;
  accountLabel: string;
  scope: string;
  savedAt: string;
}

/** In the user-data root, outside data/, so backups and .sojourner archives never include it. */
export const DRIVE_CREDENTIAL_FILE = "google-drive-credential.bin";

function parseCredential(text: string): StoredDriveCredential | null {
  try {
    const value = JSON.parse(text) as Partial<StoredDriveCredential>;
    if (typeof value.refreshToken !== "string" || !value.refreshToken || value.refreshToken.length > 4096) return null;
    if (typeof value.accountId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.accountId)) return null;
    return {
      refreshToken: value.refreshToken,
      accountId: value.accountId,
      accountLabel: typeof value.accountLabel === "string" && value.accountLabel.length <= 254
        ? value.accountLabel : "Verified Google Drive account",
      scope: typeof value.scope === "string" ? value.scope : "",
      savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Custody of the Google refresh token (owner decision 2026-11-02). With OS encryption
 * available it is written encrypted (Electron safeStorage, DPAPI on Windows) to a file in
 * the user-data root. Without encryption it is held in memory for this session only and
 * nothing is written. It is never written to SQLite, logs, URLs, archives or IPC.
 */
export class DriveCredentialStore {
  private readonly filePath: string;
  private cached: StoredDriveCredential | null = null;
  private loaded = false;
  private sessionOnly = false;
  private unavailable = false;

  constructor(
    userDataDirectory: string,
    private readonly encryption: CredentialEncryption,
  ) {
    this.filePath = path.join(userDataDirectory, DRIVE_CREDENTIAL_FILE);
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

  /** True while a stored credential exists but cannot be decrypted (the file is kept). */
  credentialUnavailable(): boolean {
    return this.unavailable;
  }

  async load(): Promise<StoredDriveCredential | null> {
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
      // A file exists but this session cannot decrypt anything: keep it, report it.
      this.unavailable = true;
      return null;
    }
    let text: string;
    try {
      text = this.encryption.decryptString(encrypted);
    } catch {
      // Possibly transient (locked credential store): keep the file and try again later.
      this.unavailable = true;
      return null;
    }
    this.loaded = true;
    this.unavailable = false;
    this.cached = parseCredential(text);
    // Decrypted but not a credential this version understands: remove it.
    if (!this.cached) await fs.rm(this.filePath, { force: true });
    return this.cached;
  }

  async save(credential: StoredDriveCredential): Promise<DriveCredentialStorage> {
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
      // Fail safe: never fall back to plaintext on disk; keep it for this session only.
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
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return "encrypted";
  }

  /** Deletes the stored sign-in (file and memory). */
  async clear(): Promise<void> {
    this.cached = null;
    this.loaded = true;
    this.sessionOnly = false;
    this.unavailable = false;
    await fs.rm(this.filePath, { force: true });
  }

  storage(): DriveCredentialStorage {
    if (!this.cached) return "none";
    return this.sessionOnly ? "session" : "encrypted";
  }
}
