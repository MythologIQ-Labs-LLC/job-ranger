import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATABASE_FILE_NAME, DATABASE_FILE_NAMES, LEGACY_DATABASE_FILE_NAME } from "./database-file.cjs";

/**
 * One-time startup migration of a data folder written before the rename
 * (Job Ranger -> Sojourner, owner decision 2026-11-02):
 *
 *   %APPDATA%\job-ranger        -> %APPDATA%\Sojourner         (direct download)
 *   %APPDATA%\Job Ranger Store  -> %APPDATA%\Sojourner Store   (Microsoft Store)
 *   data\jobscout.sqlite3       -> data\sojourner.sqlite3      (in the copy)
 *
 * It runs synchronously in main.cts before anything reads userData or opens the
 * database. The legacy folder is only read: the whole folder is copied into a
 * staging folder next to the target, every file is checked to have the same size,
 * the copied database is renamed and must pass `PRAGMA integrity_check`, and only
 * then is the staging folder renamed to the target (so the target never holds a
 * partial copy). A note is then left in the legacy folder. Any failure removes
 * only the staging copy and the app runs on the legacy folder, so no user is ever
 * stranded; the next start tries again.
 *
 * Concurrent starts:
 * - The whole migration runs under an exclusive lock file next to the target. Its holder
 *   refreshes the lock's modification time while it works; a lock is stale when its
 *   process is gone or it has not been refreshed for STALE_LOCK_MS. A stale lock is
 *   broken atomically (renamed away, then checked to be the one judged stale), so two
 *   starts can never both break it and both migrate.
 * - A start that finds the lock held waits (bounded) and then uses the result. If the
 *   wait runs out it reports "busy" (main.cts tells the person and exits); it never
 *   falls back to the legacy folder while another start may still be migrating.
 * - The legacy folder is not copied while an app instance runs from it (a fallback run,
 *   or Job Ranger itself): this start then uses the legacy folder too, so the
 *   single-instance lock (per data folder) hands the launch to the running instance.
 * - Staging copies are only removed by the lock holder.
 * Outcomes are appended to a small log next to the target
 * (for example %APPDATA%\Sojourner-migration.log).
 */

/** Note written into the legacy folder after a verified migration. */
export const MIGRATION_NOTE_FILE = "MIGRATED-TO-SOJOURNER.txt";

/** SQLite sidecar files that travel with the database file when it is renamed. */
const DATABASE_SIDECAR_SUFFIXES = ["", "-journal", "-wal", "-shm"] as const;

export type LegacyMigrationResult =
  /** The target already holds a workspace; the legacy folder (if any) is ignored. */
  | { kind: "current"; userDataDirectory: string }
  /** Neither folder holds a workspace: a fresh install starts in the target. */
  | { kind: "fresh"; userDataDirectory: string }
  /** The legacy workspace was copied, verified and is now used from the target. */
  | { kind: "migrated"; userDataDirectory: string; legacyDirectory: string; files: number; bytes: number }
  /** Not migrated this time; the app runs on the untouched legacy folder. */
  | { kind: "fallback"; userDataDirectory: string; legacyDirectory: string; reason: string }
  /** Another start is still migrating after the bounded wait; this start must not open any data. */
  | { kind: "busy"; reason: string };

export interface LegacyMigrationInput {
  /** The folder this build uses (for example %APPDATA%\Sojourner). */
  target: string;
  /** The LEGACY folder its data may still be in (for example %APPDATA%\job-ranger). */
  legacy: string;
  /** Throws (or returns a non-"ok" string) unless the database at this path is intact. */
  verifyDatabase: (databasePath: string) => string | void;
  /**
   * Rewrites absolute managed-artifact paths in the copied database from the legacy data
   * folder to the target's (see sqliteManagedPathRebase); returns how many rows still
   * point into the legacy folder afterwards (must be 0).
   */
  rebaseManagedPaths: (databasePath: string, fromDataDirectory: string, toDataDirectory: string) => number;
  log?: (message: string) => void;
  /** Outcome log (default `<parent>/<target name>-migration.log`); null disables it. */
  logFile?: string | null;
  /** Longest wait for another process's migration (default 10 minutes). */
  lockWaitMs?: number;
  /** A lock not refreshed for this long is stale even if its process id is in use (default 2 minutes). */
  staleLockMs?: number;
  /** Test seams; production uses node:fs, this process and a blocking sleep. */
  copyTree?: (source: string, destination: string, heartbeat: () => void) => void;
  renamePath?: (from: string, to: string) => void;
  now?: () => Date;
  sleep?: (milliseconds: number) => void;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  /** Whether an app instance is running from this user-data folder (default: its Chromium singleton lock). */
  isUserDataInUse?: (userDataDirectory: string) => boolean;
}

const DEFAULT_LOCK_WAIT_MS = 10 * 60_000;
const DEFAULT_STALE_LOCK_MS = 2 * 60_000;
const LOCK_POLL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 5_000;
/** Windows antivirus and indexers briefly lock new folders; renames are retried. */
const RENAME_RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000, 4000];
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function blockingSleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether an Electron/Chromium app runs from this user-data folder. Windows: the
 * process holds `lockfile` open without sharing, so opening it fails. Elsewhere:
 * `SingletonLock` is a link named `<host>-<pid>` whose process is alive.
 */
export function userDataInUse(userDataDirectory: string, alive: (pid: number) => boolean = processAlive): boolean {
  const lockfile = path.join(userDataDirectory, "lockfile");
  if (fs.existsSync(lockfile)) {
    try {
      fs.closeSync(fs.openSync(lockfile, "r+"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EBUSY" || code === "EPERM" || code === "EACCES") return true;
    }
  }
  try {
    const owner = fs.readlinkSync(path.join(userDataDirectory, "SingletonLock"));
    const pid = Number(owner.slice(owner.lastIndexOf("-") + 1));
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) return true;
  } catch {
    // No singleton link.
  }
  return false;
}

/** Exclusive lock held for the whole migration (next to the target, not inside it). */
export function migrationLockPath(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}-migration.lock`);
}

/** Outcome log next to the target, for example %APPDATA%\Sojourner-migration.log. */
export function migrationLogPath(target: string): string {
  return path.join(path.dirname(target), `${path.basename(target)}-migration.log`);
}

interface LockOwner {
  pid: number;
  startedAt: string;
  token: string;
}

function readLockText(lockPath: string): string | null {
  try {
    return fs.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
}

function parseLock(text: string | null): LockOwner | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<LockOwner>;
    if (typeof value.pid === "number" && typeof value.startedAt === "string" && typeof value.token === "string") {
      return value as LockOwner;
    }
  } catch {
    // Unreadable: judged by its age.
  }
  return null;
}

/** Stale: its process is gone, or it has not been refreshed (heartbeat) for staleMs. */
function lockIsStale(
  lockPath: string,
  owner: LockOwner | null,
  nowMs: number,
  staleMs: number,
  alive: (pid: number) => boolean,
): boolean {
  let refreshedMs: number;
  try {
    refreshedMs = fs.statSync(lockPath).mtimeMs;
  } catch {
    return true;
  }
  if (nowMs - refreshedMs > staleMs) return true;
  return owner !== null && !alive(owner.pid);
}

/**
 * Breaks a stale lock atomically: rename it to a name only this start uses, then check
 * it is the lock that was judged stale. If another start replaced it in between (its
 * fresh, live lock), it is put back untouched. Returns true when the stale lock is gone.
 */
function breakStaleLock(lockPath: string, judgedText: string | null, token: string): boolean {
  const aside = `${lockPath}.stale-${token}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    return false; // Already broken or replaced by another start; just retry.
  }
  if (readLockText(aside) === judgedText) {
    fs.rmSync(aside, { force: true });
    return true;
  }
  try {
    fs.linkSync(aside, lockPath); // Restore it (fails if yet another lock exists).
  } catch {
    // Another start holds a newer lock; the restored one is not needed.
  }
  fs.rmSync(aside, { force: true });
  return false;
}

function isFile(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** A folder holds a workspace when its data folder holds a database under either name. */
export function hasWorkspace(userDataDirectory: string): boolean {
  return DATABASE_FILE_NAMES.some((name) => isFile(path.join(userDataDirectory, "data", name)));
}

function stagingPrefix(target: string): string {
  return `.${path.basename(target)}-migration-`;
}

function removeStaleStaging(target: string, log: (message: string) => void): void {
  const parent = path.dirname(target);
  const prefix = stagingPrefix(target);
  let names: string[] = [];
  try {
    names = fs.readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    log(`Removing an incomplete earlier data-folder migration copy: ${name}`);
    fs.rmSync(path.join(parent, name), { recursive: true, force: true });
  }
}

interface TreeEntry {
  relative: string;
  kind: "file" | "directory" | "symlink";
  size: number;
}

function walk(root: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const visit = (relative: string) => {
    const absolute = path.join(root, relative);
    for (const name of fs.readdirSync(absolute)) {
      const childRelative = relative ? path.join(relative, name) : name;
      const stat = fs.lstatSync(path.join(root, childRelative));
      if (stat.isSymbolicLink()) {
        entries.push({ relative: childRelative, kind: "symlink", size: 0 });
      } else if (stat.isDirectory()) {
        entries.push({ relative: childRelative, kind: "directory", size: 0 });
        visit(childRelative);
      } else {
        entries.push({ relative: childRelative, kind: "file", size: stat.size });
      }
    }
  };
  visit("");
  return entries;
}

/** Copies a folder tree file by file (timestamps kept, links copied as links), refreshing the lock as it goes. */
function copyTreeWithHeartbeat(source: string, destination: string, heartbeat: () => void): void {
  fs.mkdirSync(destination, { recursive: false });
  for (const entry of walk(source)) {
    const from = path.join(source, entry.relative);
    const to = path.join(destination, entry.relative);
    if (entry.kind === "directory") {
      fs.mkdirSync(to);
    } else if (entry.kind === "symlink") {
      fs.symlinkSync(fs.readlinkSync(from), to);
    } else {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const stat = fs.statSync(from);
      fs.utimesSync(to, stat.atime, stat.mtime);
    }
    heartbeat();
  }
}

/** Every legacy file and folder exists in the copy, files with the same size. */
function verifyCopy(legacy: string, copy: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of walk(legacy)) {
    const copied = path.join(copy, entry.relative);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(copied);
    } catch {
      throw new Error(`The copy is missing ${entry.relative}`);
    }
    if (entry.kind === "directory" && !stat.isDirectory()) throw new Error(`The copy of ${entry.relative} is not a folder`);
    if (entry.kind === "symlink" && !stat.isSymbolicLink()) throw new Error(`The copy of ${entry.relative} is not a link`);
    if (entry.kind === "file") {
      if (!stat.isFile() || stat.size !== entry.size) {
        throw new Error(`The copy of ${entry.relative} has ${stat.size} bytes instead of ${entry.size}`);
      }
      files += 1;
      bytes += entry.size;
    }
  }
  return { files, bytes };
}

/** Renames the copied LEGACY database (and its sidecars) to the current name. */
function renameCopiedDatabase(copy: string, rename: (from: string, to: string) => void): string {
  const dataDirectory = path.join(copy, "data");
  const current = path.join(dataDirectory, DATABASE_FILE_NAME);
  if (isFile(current)) return current;
  for (const suffix of DATABASE_SIDECAR_SUFFIXES) {
    const from = path.join(dataDirectory, `${LEGACY_DATABASE_FILE_NAME}${suffix}`);
    if (fs.existsSync(from)) rename(from, path.join(dataDirectory, `${DATABASE_FILE_NAME}${suffix}`));
  }
  if (!isFile(current)) throw new Error("The copied data folder has no database");
  return current;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function migrationNote(target: string, date: Date): string {
  return [
    "This folder holds data from Job Ranger, which is now named Sojourner.",
    "",
    `On ${date.toISOString()} Sojourner copied everything in this folder to:`,
    `  ${target}`,
    "and now uses that copy. The copy was verified before it was used.",
    "",
    "Nothing in this folder was changed or deleted. You can keep it as a backup,",
    "or delete it once you have confirmed Sojourner shows all of your data.",
    "",
  ].join("\r\n");
}

function renameWithRetry(
  rename: (from: string, to: string) => void,
  sleep: (milliseconds: number) => void,
  from: string,
  to: string,
): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (!code || !TRANSIENT_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
      sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

interface MigrationContext {
  input: LegacyMigrationInput;
  target: string;
  legacy: string;
  log: (message: string) => void;
  sleep: (milliseconds: number) => void;
  now: () => Date;
  /** Refreshes the held lock; throws if this start no longer holds it. */
  heartbeat: (force?: boolean) => void;
}

export function migrateLegacyUserData(input: LegacyMigrationInput): LegacyMigrationResult {
  const consoleLog = input.log ?? (() => undefined);
  const now = input.now ?? (() => new Date());
  const target = path.resolve(input.target);
  const legacy = path.resolve(input.legacy);
  const pid = input.pid ?? process.pid;
  const logFile = input.logFile === undefined ? migrationLogPath(target) : input.logFile;
  const log = (message: string) => {
    consoleLog(message);
    if (!logFile) return;
    try {
      fs.appendFileSync(logFile, `${now().toISOString()} [pid ${pid}] ${message}\r\n`);
    } catch {
      // The log is a convenience; it never affects the migration.
    }
  };

  if (target.toLowerCase() === legacy.toLowerCase()) return { kind: "current", userDataDirectory: target };
  if (hasWorkspace(target)) return { kind: "current", userDataDirectory: target };
  if (!hasWorkspace(legacy)) return { kind: "fresh", userDataDirectory: target };

  const sleep = input.sleep ?? blockingSleep;
  const alive = input.isProcessAlive ?? processAlive;
  const lockPath = migrationLockPath(target);
  const waitMs = input.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const staleMs = input.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const token = randomUUID();
  const waitStarted = Date.now();
  let waited = false;

  // Acquire the lock, or wait for the start holding it and use what it produced.
  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      const handle = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(handle, JSON.stringify({ pid, startedAt: now().toISOString(), token } satisfies LockOwner));
      } finally {
        fs.closeSync(handle);
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        const reason = `could not take the migration lock (${error instanceof Error ? error.message : String(error)})`;
        log(`Data-folder migration did not start: ${reason}; using ${legacy} this time.`);
        return { kind: "fallback", userDataDirectory: legacy, legacyDirectory: legacy, reason };
      }
    }
    const judgedText = readLockText(lockPath);
    const owner = parseLock(judgedText);
    if (lockIsStale(lockPath, owner, now().getTime(), staleMs, alive)) {
      if (breakStaleLock(lockPath, judgedText, token)) {
        log(`Removed a stale migration lock${owner ? ` (pid ${owner.pid}, ${owner.startedAt})` : ""}.`);
      }
      continue;
    }
    if (!waited) {
      log(`Another Sojourner start (pid ${owner?.pid ?? "unknown"}) is moving the data folder; waiting for it.`);
      waited = true;
    }
    if (Date.now() - waitStarted >= waitMs) {
      const reason = "another Sojourner start is still moving the data folder";
      log(`Not opening any data: ${reason}.`);
      return { kind: "busy", reason };
    }
    sleep(LOCK_POLL_MS);
    if (hasWorkspace(target)) {
      log(`The other start finished moving the data folder; using ${target}.`);
      return { kind: "current", userDataDirectory: target };
    }
  }

  let lastBeat = 0;
  const heartbeat = (force = false) => {
    const nowMs = Date.now();
    if (!force && nowMs - lastBeat < HEARTBEAT_INTERVAL_MS) return;
    if (parseLock(readLockText(lockPath))?.token !== token) throw new Error("the migration lock was lost");
    const touched = new Date(nowMs);
    fs.utimesSync(lockPath, touched, touched);
    lastBeat = nowMs;
  };
  try {
    // Re-check under the lock: another start may have finished just before we took it.
    if (hasWorkspace(target)) return { kind: "current", userDataDirectory: target };
    if (!hasWorkspace(legacy)) return { kind: "fresh", userDataDirectory: target };
    if ((input.isUserDataInUse ?? ((folder) => userDataInUse(folder, alive)))(legacy)) {
      const reason = `an app is running from ${legacy}`;
      log(`Not moving the data folder: ${reason}; this start uses it too.`);
      return { kind: "fallback", userDataDirectory: legacy, legacyDirectory: legacy, reason };
    }
    return migrateUnderLock({ input, target, legacy, log, sleep, now, heartbeat });
  } finally {
    if (parseLock(readLockText(lockPath))?.token === token) fs.rmSync(lockPath, { force: true });
  }
}

function migrateUnderLock(context: MigrationContext): LegacyMigrationResult {
  const { input, target, legacy, log, sleep, now, heartbeat } = context;
  const copyTree = input.copyTree ?? copyTreeWithHeartbeat;
  const rename = input.renamePath ?? ((from: string, to: string) => fs.renameSync(from, to));
  const startedAt = now();
  const staging = path.join(path.dirname(target), `${stagingPrefix(target)}${stamp(startedAt)}-${randomUUID().slice(0, 8)}`);
  let setAside: string | null = null;
  try {
    // Only the lock holder gets here, so every staging folder left is from a start that died.
    heartbeat(true);
    removeStaleStaging(target, log);
    // A target folder without a workspace (an interrupted earlier start, an empty folder):
    // an empty one is removed, anything else is kept under another name, never deleted.
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isDirectory() && fs.readdirSync(target).length === 0) {
        fs.rmdirSync(target);
      } else {
        setAside = `${target}.before-migration-${stamp(startedAt)}`;
        renameWithRetry(rename, sleep, target, setAside);
        log(`Kept the existing ${path.basename(target)} folder (no workspace) as ${path.basename(setAside)}.`);
      }
    }

    copyTree(legacy, staging, () => heartbeat());
    heartbeat(true);
    const { files, bytes } = verifyCopy(legacy, staging);
    const databasePath = renameCopiedDatabase(staging, rename);
    // Managed artifacts are stored by absolute path; point them at the migrated copy so
    // nothing keeps reading (or depends on) the legacy folder.
    const stillLegacy = input.rebaseManagedPaths(databasePath, path.join(legacy, "data"), path.join(target, "data"));
    if (stillLegacy !== 0) throw new Error(`${stillLegacy} artifact paths still point into the old data folder`);
    heartbeat(true);
    const integrity = input.verifyDatabase(databasePath);
    if (typeof integrity === "string" && integrity.trim() !== "ok") {
      throw new Error(`The copied database failed its integrity check: ${integrity.trim().slice(0, 200)}`);
    }
    heartbeat(true);
    renameWithRetry(rename, sleep, staging, target);

    try {
      fs.writeFileSync(path.join(legacy, MIGRATION_NOTE_FILE), migrationNote(target, startedAt), { flag: "w" });
    } catch (error) {
      log(`Could not leave a note in the old data folder: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(`Moved data from ${legacy} to ${target} (${files} files, ${bytes} bytes, verified).`);
    return { kind: "migrated", userDataDirectory: target, legacyDirectory: legacy, files, bytes };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      // A stale staging copy is removed by the next start that holds the lock.
    }
    if (setAside && !fs.existsSync(target)) {
      try {
        renameWithRetry(rename, sleep, setAside, target);
      } catch {
        // The set-aside folder is kept under its other name.
      }
    }
    log(`Data-folder migration did not complete (${reason}); using ${legacy} this time.`);
    return { kind: "fallback", userDataDirectory: legacy, legacyDirectory: legacy, reason };
  }
}
