/**
 * File name of the workspace SQLite database inside the data directory.
 * Dependency-free so the desktop, packaged-smoke and web runtimes share it.
 */
export const DATABASE_FILE_NAME = "sojourner.sqlite3";

/**
 * LEGACY: the database file name used by Job Ranger and by Sojourner before the
 * rename (2026-11-02). Startup migration (legacy-migration.cts) renames it in the
 * migrated copy; a workspace that still holds only this file (a fallback run on the
 * legacy folder, a backup bundle or a staged restore written before the rename, a
 * web workspace not yet migrated) is still opened under this name.
 */
export const LEGACY_DATABASE_FILE_NAME = "jobscout.sqlite3";

/** Every database file name a workspace may hold, the current one first. */
export const DATABASE_FILE_NAMES = [DATABASE_FILE_NAME, LEGACY_DATABASE_FILE_NAME] as const;
