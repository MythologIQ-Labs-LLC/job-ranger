import { promises as fs } from "node:fs";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");

/**
 * Reads the SQLite "file change counter" (header bytes 24-27, big-endian). In rollback
 * journal mode, which every Sojourner database uses, SQLite increments it on every
 * committed write transaction from ANY connection, so one 4-byte read tells whether the
 * workspace changed, without hooking every repository. Read-only queries and
 * `VACUUM INTO` (the backup snapshot) leave it unchanged. Null when unreadable.
 */
export async function readChangeCounter(databasePath: string): Promise<number | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(databasePath, "r");
    const header = Buffer.alloc(28);
    const { bytesRead } = await handle.read(header, 0, 28, 0);
    if (bytesRead < 28 || !header.subarray(0, 16).equals(SQLITE_HEADER)) return null;
    return header.readUInt32BE(24);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Tells workspace edits apart from Sojourner's own storage bookkeeping writes (which go
 * to the same database). `observe` wraps a bookkeeping write: if the counter moved by at
 * most one across it and had not moved before it, the change is absorbed; anything else
 * counts as a workspace change (at worst one extra backup, never a missed one).
 */
export class WorkspaceChangeMonitor {
  private last: number | null = null;
  private sequence = 0;
  private listeners: Array<() => void> = [];

  constructor(private readonly read: () => Promise<number | null>) {}

  /** Current change sequence: increases with every detected workspace change. */
  get changes(): number {
    return this.sequence;
  }

  get counter(): number | null {
    return this.last;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(value: number | null): void {
    this.last = value;
    this.sequence += 1;
    for (const listener of this.listeners) listener();
  }

  /** Starts observing; returns true when the database differs from `clean`. */
  async start(clean: number | null): Promise<boolean> {
    this.last = await this.read();
    return this.last !== null && this.last !== clean;
  }

  /** Reads the counter; reports (and notifies) a workspace change. */
  async poll(): Promise<boolean> {
    const value = await this.read();
    if (value === null || value === this.last) return false;
    this.changed(value);
    return true;
  }

  async observe<T>(write: () => Promise<T>): Promise<T> {
    const before = await this.read();
    if (before !== null && before !== this.last) this.changed(before);
    try {
      return await write();
    } finally {
      const after = await this.read();
      if (before !== null && after !== null && (after === before || after === ((before + 1) >>> 0))) {
        this.last = after;
      }
    }
  }
}
