import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DriveCredentialStorage } from "../../../src/shared/google-drive.js";

/** The subset of Electron's safeStorage the store needs (injected for tests). */
export interface CredentialEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface StoredDriveCredential {
  refreshToken: string;
  /** Google Drive permission id of the account that granted this token. */
  accountId: string;
  accountEmail: string | null;
  scope: string;
  savedAt: string;
}

export const DRIVE_CREDENTIAL_FILE = "google-drive-credential.bin";

function parseCredential(text: string): StoredDriveCredential | null {
  try {
    const value = JSON.parse(text) as Partial<StoredDriveCredential>;
    if (typeof value.refreshToken !== "string" || !value.refreshToken) return null;
    if (typeof value.accountId !== "string" || !value.accountId) return null;
    return {
      refreshToken: value.refreshToken,
      accountId: value.accountId,
      accountEmail: typeof value.accountEmail === "string" ? value.accountEmail : null,
      scope: typeof value.scope === "string" ? value.scope : "",
      savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Custody of the Google refresh token. With OS encryption available it is
 * written encrypted (Electron safeStorage) to a 0600 file in the user-data
 * root, outside data/ so backups never include it. Without encryption it is
 * held in memory for this session only. It is never written to SQLite, logs
 * or IPC.
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

  /** True while a stored credential exists but cannot be decrypted (it is kept). */
  credentialUnavailable(): boolean {
    return this.unavailable;
  }

  async load(): Promise<StoredDriveCredential | null> {
    if (this.loaded) return this.cached;
    if (!this.encryptionAvailable()) {
      this.loaded = true;
      return null;
    }
    let encrypted: Buffer;
    try {
      encrypted = await fs.readFile(this.filePath);
    } catch {
      this.loaded = true;
      this.unavailable = false;
      return null;
    }
    let text: string;
    try {
      text = this.encryption.decryptString(encrypted);
    } catch {
      // Possibly transient (locked keychain): keep the file and try again on the next load.
      this.unavailable = true;
      return null;
    }
    this.loaded = true;
    this.unavailable = false;
    this.cached = parseCredential(text);
    // Decrypted but not a credential this version understands: corrupt, remove it.
    if (!this.cached) await fs.rm(this.filePath, { force: true });
    return this.cached;
  }

  async save(credential: StoredDriveCredential): Promise<DriveCredentialStorage> {
    this.loaded = true;
    this.unavailable = false;
    this.cached = credential;
    if (!this.encryptionAvailable()) {
      this.sessionOnly = true;
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
