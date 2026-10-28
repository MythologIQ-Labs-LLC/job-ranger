/**
 * SQLite WASM engine for the Sojourner web runtime.
 *
 * It implements the same `SqliteEngineClient` port as the Electron sqlite3
 * CLI adapter, so every shared repository, migration, and domain service runs
 * unchanged on top of it.
 *
 * Durability model (documented in docs/design/PWA_RUNTIME.md):
 * - each database path is one in-memory SQLite connection shared by every
 *   client constructed for that path (the CLI adapter shares one file);
 * - after every write the full database image is serialized and written to
 *   the file system adapter (OPFS in browsers) through an atomic
 *   write-then-commit stream; the write must complete before the caller's
 *   promise resolves, mirroring the CLI adapter where a statement is durable
 *   when the sqlite3 process exits;
 * - if persisting fails, the in-memory connection is reloaded from the last
 *   durable image and the caller receives the storage error, so memory never
 *   claims state that is not on disk.
 *
 * Only erasable TypeScript syntax is used so Node can load this file directly
 * in the engine-parity tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface EngineFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
}

export interface WasmSqliteEngineOptions {
  /** The initialized `@sqlite.org/sqlite-wasm` module (`sqlite3InitModule()`). */
  sqlite3: any;
  fs: EngineFs;
  dirname(path: string): string;
  /**
   * Reload a connection when its backing file changes outside this engine.
   * Only the Node parity harness needs this (tests inspect/modify the file with
   * other tools). In the browser the dedicated worker holds an exclusive Web
   * Lock and is the sole writer.
   */
  revalidateExternalChanges?: boolean;
}

export class SqliteStorageError extends Error {
  code: string;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "SqliteStorageError";
    this.code = "EJOBRANGERSTORAGE";
    (this as { cause?: unknown }).cause = cause;
  }
}

interface Connection {
  path: string;
  db: any;
  persistedGeneration: number;
  dirtyGeneration: number;
  flushing: Promise<void> | null;
  /** Set while memory is being replaced by the durable image after a failed save. */
  reloading: Promise<void> | null;
  failedGeneration: number;
  lastKnownSize: number;
  lastKnownMtime: number;
  failure: unknown;
}

const VACUUM_INTO = /^\s*VACUUM\s+INTO\s+'((?:[^']|'')*)'\s*;?\s*$/i;

function normalizeWalHeader(bytes: Uint8Array): Uint8Array {
  // sqlite3_deserialize cannot open a WAL-mode image. Snapshots produced by
  // VACUUM INTO / backups are self-contained, so switching the header back to
  // rollback-journal mode is lossless.
  if (bytes.length >= 20 && (bytes[18] === 2 || bytes[19] === 2)) {
    const copy = new Uint8Array(bytes);
    copy[18] = 1;
    copy[19] = 1;
    return copy;
  }
  return bytes;
}

export class WasmSqliteEngine {
  private readonly options: WasmSqliteEngineOptions;
  private readonly connections = new Map<string, Promise<Connection>>();
  /** Number of statements/batches executed; lets parity tests prove engine use. */
  operationCount = 0;

  constructor(options: WasmSqliteEngineOptions) {
    this.options = options;
  }

  get version(): string {
    return String(this.options.sqlite3.version?.libVersion ?? "unknown");
  }

  private deserialize(db: any, bytes: Uint8Array): void {
    const sqlite3 = this.options.sqlite3;
    if (bytes.length === 0) return;
    const image = normalizeWalHeader(bytes);
    const pointer = sqlite3.wasm.allocFromTypedArray(image);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      "main",
      pointer,
      image.length,
      image.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    db.checkRc(rc);
  }

  private async readImage(path: string): Promise<{ bytes: Uint8Array; size: number; mtime: number }> {
    try {
      const stat = await this.options.fs.stat(path);
      const bytes = await this.options.fs.readFile(path);
      return { bytes: new Uint8Array(bytes), size: stat.size, mtime: stat.mtimeMs };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { bytes: new Uint8Array(), size: -1, mtime: -1 };
      throw error;
    }
  }

  private openDatabase(bytes: Uint8Array): any {
    const db = new this.options.sqlite3.oo1.DB(":memory:", "c");
    try {
      this.deserialize(db, bytes);
      db.exec("PRAGMA foreign_keys = ON;");
    } catch (error) {
      db.close();
      throw error;
    }
    return db;
  }

  private async open(path: string): Promise<Connection> {
    let pending = this.connections.get(path);
    if (!pending) {
      pending = (async () => {
        const image = await this.readImage(path);
        return {
          path,
          db: this.openDatabase(image.bytes),
          persistedGeneration: 0,
          dirtyGeneration: 0,
          flushing: null,
          reloading: null,
          failedGeneration: 0,
          lastKnownSize: image.size,
          lastKnownMtime: image.mtime,
          failure: null,
        };
      })();
      this.connections.set(path, pending);
      pending.catch(() => this.connections.delete(path));
    }
    const connection = await pending;
    // Never hand out a database that is about to be replaced: a write made on
    // it would report success and then vanish with the reload.
    while (connection.reloading) await connection.reloading;
    if (this.options.revalidateExternalChanges && !connection.flushing) {
      const image = await this.readImage(path);
      if (image.size !== connection.lastKnownSize || image.mtime !== connection.lastKnownMtime) {
        connection.db.close();
        connection.db = this.openDatabase(image.bytes);
        connection.lastKnownSize = image.size;
        connection.lastKnownMtime = image.mtime;
      }
    }
    return connection;
  }

  private exportImage(connection: Connection): Uint8Array {
    return this.options.sqlite3.capi.sqlite3_js_db_export(connection.db.pointer);
  }

  private async reloadFromDisk(connection: Connection): Promise<void> {
    const image = await this.readImage(connection.path);
    connection.db.close();
    connection.db = this.openDatabase(image.bytes);
    connection.lastKnownSize = image.size;
    connection.lastKnownMtime = image.mtime;
  }

  private async persist(connection: Connection): Promise<void> {
    connection.dirtyGeneration += 1;
    const target = connection.dirtyGeneration;
    for (;;) {
      if (connection.persistedGeneration >= target) return;
      if (connection.failedGeneration >= target) throw connection.failure;
      if (connection.flushing) {
        await connection.flushing.catch(() => undefined);
        continue;
      }
      const generation = connection.dirtyGeneration;
      connection.flushing = (async () => {
        try {
          const bytes = this.exportImage(connection);
          await this.options.fs.mkdir(this.options.dirname(connection.path), { recursive: true });
          await this.options.fs.writeFile(connection.path, bytes);
          const stat = await this.options.fs.stat(connection.path);
          connection.lastKnownSize = stat.size;
          connection.lastKnownMtime = stat.mtimeMs;
          connection.persistedGeneration = generation;
        } catch (error) {
          connection.failure =
            error instanceof Error && (error as { code?: string }).code?.startsWith("E")
              ? error
              : new SqliteStorageError(
                  `Sojourner could not save its database to browser storage: ${error instanceof Error ? error.message : String(error)}`,
                  error,
                );
          // Every change made since the last durable image is reverted, so
          // every caller waiting on those changes must observe the failure.
          connection.failedGeneration = connection.dirtyGeneration;
          connection.reloading = this.reloadFromDisk(connection).catch(() => undefined);
          try {
            await connection.reloading;
          } finally {
            connection.reloading = null;
          }
          throw connection.failure;
        } finally {
          connection.flushing = null;
        }
      })();
    }
  }

  async exec(path: string, statement: string): Promise<void> {
    this.operationCount += 1;
    const connection = await this.open(path);
    const vacuum = statement.match(VACUUM_INTO);
    if (vacuum) {
      const target = vacuum[1].replace(/''/g, "'");
      const bytes = this.exportImage(connection);
      await this.options.fs.mkdir(this.options.dirname(target), { recursive: true });
      await this.options.fs.writeFile(target, bytes);
      return;
    }
    connection.db.exec(statement);
    await this.persist(connection);
  }

  async transaction(path: string, statements: readonly string[]): Promise<void> {
    if (statements.length === 0) return;
    this.operationCount += 1;
    const connection = await this.open(path);
    const db = connection.db;
    db.exec("BEGIN IMMEDIATE;");
    try {
      for (const statement of statements) db.exec(statement);
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // The failed statement may already have ended the transaction.
      }
      throw error;
    }
    await this.persist(connection);
  }

  async queryAll<T>(path: string, statement: string): Promise<T[]> {
    this.operationCount += 1;
    const connection = await this.open(path);
    const before = connection.db.changes(true);
    const rows = connection.db.exec({
      sql: statement,
      rowMode: "object",
      returnValue: "resultRows",
    }) as Record<string, unknown>[];
    if (connection.db.changes(true) !== before) await this.persist(connection);
    // The sqlite3 CLI's -json output yields ordinary objects; match that shape
    // (plain prototype, JSON-compatible numbers) so domain code sees identical rows.
    return rows.map((row) => {
      const plain: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        const value = row[key];
        plain[key] = typeof value === "bigint" ? Number(value) : value;
      }
      return plain as T;
    });
  }

  /** Drops cached connections (used when a restore replaced files on disk). */
  closeAll(): void {
    for (const pending of this.connections.values()) {
      void pending.then((connection) => connection.db.close()).catch(() => undefined);
    }
    this.connections.clear();
  }
}

let activeEngine: WasmSqliteEngine | null = null;

export function setActiveWasmSqliteEngine(engine: WasmSqliteEngine | null): void {
  activeEngine = engine;
}

export function requireActiveWasmSqliteEngine(): WasmSqliteEngine {
  if (!activeEngine) {
    throw new Error("The Sojourner SQLite WASM engine has not been initialized");
  }
  return activeEngine;
}

/**
 * Drop-in replacement for the Electron `SqliteClient` class. The second
 * constructor argument (sqlite3 binary path) is accepted for signature
 * compatibility and ignored.
 */
export class WasmSqliteClient {
  private readonly databasePath: string;

  constructor(databasePath: string, _sqliteBinaryPath?: string, _mode?: { readOnly?: boolean }) {
    this.databasePath = databasePath;
  }

  async exec(statement: string): Promise<void> {
    await requireActiveWasmSqliteEngine().exec(this.databasePath, statement);
  }

  async transaction(statements: readonly string[]): Promise<void> {
    await requireActiveWasmSqliteEngine().transaction(this.databasePath, statements);
  }

  async queryAll<T>(statement: string): Promise<T[]> {
    return requireActiveWasmSqliteEngine().queryAll<T>(this.databasePath, statement);
  }

  async queryOne<T>(statement: string): Promise<T | null> {
    const rows = await this.queryAll<T>(statement);
    return rows[0] ?? null;
  }
}
