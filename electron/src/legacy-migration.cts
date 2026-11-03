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
  /** Migration failed; the app runs on the untouched legacy folder this time. */
  | { kind: "fallback"; userDataDirectory: string; legacyDirectory: string; reason: string };

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
  /** Test seams; production uses node:fs. */
  copyTree?: (source: string, destination: string) => void;
  renamePath?: (from: string, to: string) => void;
  now?: () => Date;
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

export function migrateLegacyUserData(input: LegacyMigrationInput): LegacyMigrationResult {
  const log = input.log ?? (() => undefined);
  const copyTree =
    input.copyTree ??
    ((source: string, destination: string) =>
      fs.cpSync(source, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      }));
  const rename = input.renamePath ?? ((from: string, to: string) => fs.renameSync(from, to));
  const now = input.now ?? (() => new Date());
  const target = path.resolve(input.target);
  const legacy = path.resolve(input.legacy);

  if (target.toLowerCase() === legacy.toLowerCase()) return { kind: "current", userDataDirectory: target };
  if (hasWorkspace(target)) return { kind: "current", userDataDirectory: target };
  if (!hasWorkspace(legacy)) return { kind: "fresh", userDataDirectory: target };

  const startedAt = now();
  const staging = path.join(path.dirname(target), `${stagingPrefix(target)}${stamp(startedAt)}-${randomUUID().slice(0, 8)}`);
  let setAside: string | null = null;
  try {
    removeStaleStaging(target, log);
    // A target folder without a workspace (an interrupted earlier start, an empty folder):
    // an empty one is removed, anything else is kept under another name, never deleted.
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isDirectory() && fs.readdirSync(target).length === 0) {
        fs.rmdirSync(target);
      } else {
        setAside = `${target}.before-migration-${stamp(startedAt)}`;
        rename(target, setAside);
        log(`Kept the existing ${path.basename(target)} folder (no workspace) as ${path.basename(setAside)}.`);
      }
    }

    copyTree(legacy, staging);
    const { files, bytes } = verifyCopy(legacy, staging);
    const databasePath = renameCopiedDatabase(staging, rename);
    // Managed artifacts are stored by absolute path; point them at the migrated copy so
    // nothing keeps reading (or depends on) the legacy folder.
    const stillLegacy = input.rebaseManagedPaths(databasePath, path.join(legacy, "data"), path.join(target, "data"));
    if (stillLegacy !== 0) throw new Error(`${stillLegacy} artifact paths still point into the old data folder`);
    const integrity = input.verifyDatabase(databasePath);
    if (typeof integrity === "string" && integrity.trim() !== "ok") {
      throw new Error(`The copied database failed its integrity check: ${integrity.trim().slice(0, 200)}`);
    }
    rename(staging, target);

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
      // A stale staging copy is removed on the next start.
    }
    if (setAside && !fs.existsSync(target)) {
      try {
        rename(setAside, target);
      } catch {
        // The set-aside folder is kept under its other name.
      }
    }
    log(`Data-folder migration did not complete (${reason}); using ${legacy} this time.`);
    return { kind: "fallback", userDataDirectory: legacy, legacyDirectory: legacy, reason };
  }
}
