import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";

/**
 * Synchronous sqlite3 CLI helpers for the start-up data-folder migration
 * (legacy-migration.cts), which runs before the Electron app is ready and so cannot
 * await. Desktop-only: the web runtime never imports this module (it has no sqlite3
 * CLI and no legacy desktop folder), so it has no web adapter.
 */

function isFileSync(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * The sqlite3 binary, found synchronously (startup runs before the app is ready):
 * SQLITE3_PATH, the packaged Windows sqlite3.exe, then the system PATH and the usual
 * locations, as resolveSqliteBinary does.
 */
export function resolveSqliteBinarySync(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): string | null {
  if (env.SQLITE3_PATH) return env.SQLITE3_PATH;
  if (platform === "win32" && resourcesPath && isFileSync(path.join(resourcesPath, "sqlite3.exe"))) {
    return path.join(resourcesPath, "sqlite3.exe");
  }
  try {
    const found = execFileSync(platform === "win32" ? "where.exe" : "which", ["sqlite3"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found) return found;
  } catch {
    // Fall through to the usual locations.
  }
  const candidates =
    platform === "darwin"
      ? ["/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3", "/usr/local/bin/sqlite3", "/opt/local/bin/sqlite3"]
      : platform === "linux"
        ? ["/usr/bin/sqlite3", "/usr/local/bin/sqlite3", "/bin/sqlite3"]
        : [];
  return candidates.find(isFileSync) ?? null;
}

/** `PRAGMA integrity_check` through the sqlite3 CLI; returns its output ("ok" when intact). */
export function sqliteIntegrityCheck(sqliteBinaryPath: string | null): (databasePath: string) => string {
  return (databasePath: string) => {
    if (!sqliteBinaryPath) throw new Error("sqlite3 was not found, so the copied database could not be verified");
    return execFileSync(sqliteBinaryPath, [databasePath], {
      input: "PRAGMA integrity_check;\n",
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
    }).trim();
  };
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Rewrites `managed_path` in source_artifacts and resume_artifacts from one data folder
 * to another, in one transaction (as backup restore rebases them), and returns how many
 * rows still start with the old folder. Windows paths compare case-insensitively.
 */
export function sqliteManagedPathRebase(
  sqliteBinaryPath: string | null,
  platform: NodeJS.Platform = process.platform,
): (databasePath: string, fromDataDirectory: string, toDataDirectory: string) => number {
  return (databasePath, fromDataDirectory, toDataDirectory) => {
    if (!sqliteBinaryPath) throw new Error("sqlite3 was not found, so the copied database could not be updated");
    const run = (script: string) =>
      execFileSync(sqliteBinaryPath, ["-bail", databasePath], {
        input: script,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 300_000,
      });
    const tables = run(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('source_artifacts', 'resume_artifacts') ORDER BY name;\n",
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (tables.length === 0) return 0;
    const separator = platform === "win32" ? "\\" : "/";
    const from = fromDataDirectory.endsWith(separator) ? fromDataDirectory : `${fromDataDirectory}${separator}`;
    const to = toDataDirectory.endsWith(separator) ? toDataDirectory : `${toDataDirectory}${separator}`;
    const fold = (expression: string) => (platform === "win32" ? `lower(${expression})` : expression);
    const fromLength = `length(${sqlText(from)})`;
    const underFrom = `${fold(`substr(managed_path, 1, ${fromLength})`)} = ${fold(sqlText(from))}`;
    const updates = tables.map(
      (table) => `UPDATE ${table} SET managed_path = ${sqlText(to)} || substr(managed_path, ${fromLength} + 1) WHERE ${underFrom};`,
    );
    run(["BEGIN IMMEDIATE;", ...updates, "COMMIT;", ""].join("\n"));
    const remaining = tables.map((table) => `(SELECT count(*) FROM ${table} WHERE ${underFrom})`).join(" + ");
    return Number(run(`SELECT ${remaining};\n`).trim());
  };
}
