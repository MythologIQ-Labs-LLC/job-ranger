import { execFile, spawn } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SQLITE_BUSY_TIMEOUT_MS = 5000;

function runWithStdin(binary: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sqlite3 exited with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.on("error", reject);
    child.stdin.end(input, "utf8");
  });
}

type ElectronProcess = NodeJS.Process & { resourcesPath?: string };

import type { SqliteEngineClient } from "./sql-literal.cjs";

export { sql, toSqlLiteral } from "./sql-literal.cjs";
export type { SqliteEngineClient } from "./sql-literal.cjs";

async function findExecutable(candidates: string[]): Promise<string | null> {
  for (const candidatePath of candidates) {
    if (!candidatePath) {
      continue;
    }
    try {
      await fs.access(candidatePath, fsConstants.X_OK);
      return candidatePath;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function resolveSqliteBinary(): Promise<string> {
  if (process.env.SQLITE3_PATH) {
    return process.env.SQLITE3_PATH;
  }

  if (process.platform === "win32") {
    const resourcesPath = (process as ElectronProcess).resourcesPath;
    const bundledSqlite = resourcesPath
      ? await findExecutable([path.join(resourcesPath, "sqlite3.exe")])
      : null;
    if (bundledSqlite) {
      return bundledSqlite;
    }
  }

  const command = process.platform === "win32" ? "where.exe" : "which";
  const lookupTarget = "sqlite3";

  try {
    const { stdout } = await execFileAsync(command, [lookupTarget]);
    const [firstMatch] = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (firstMatch) {
      return firstMatch;
    }
  } catch {
    // Fall through to the platform-specific candidates below.
  }

  const fallbackCandidates =
    process.platform === "darwin"
      ? [
          "/usr/bin/sqlite3",
          "/opt/homebrew/bin/sqlite3",
          "/usr/local/bin/sqlite3",
          "/opt/local/bin/sqlite3",
        ]
      : process.platform === "linux"
        ? ["/usr/bin/sqlite3", "/usr/local/bin/sqlite3", "/bin/sqlite3"]
        : [];

  const fallback = await findExecutable(fallbackCandidates);
  if (fallback) {
    return fallback;
  }

  const expectedBinary = process.platform === "win32" ? "sqlite3.exe" : "sqlite3";
  const platformHint =
    process.platform === "darwin"
      ? " On macOS, Finder-launched apps may not inherit Homebrew paths, so set SQLITE3_PATH or install sqlite3 in a standard location such as /usr/bin, /opt/homebrew/bin, or /usr/local/bin."
      : process.platform === "win32"
        ? " Packaged Windows builds include sqlite3.exe. Source/development runs can set SQLITE3_PATH or install sqlite3 on PATH."
        : "";
  throw new Error(
    `${expectedBinary} was not found. Set SQLITE3_PATH to a valid sqlite3 binary.${platformHint}`,
  );
}

export class SqliteClient implements SqliteEngineClient {
  constructor(
    private readonly databasePath: string,
    private readonly sqliteBinaryPath: string,
    private readonly mode: { readOnly?: boolean } = {},
  ) {}

  /** `-readonly` makes the sqlite3 CLI refuse every write, including journal rollback. */
  private connectionArgs(): string[] {
    return this.mode.readOnly ? ["-readonly"] : [];
  }

  async ensureDatabaseDirectory(): Promise<void> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
  }

  async exec(statement: string): Promise<void> {
    await this.ensureDatabaseDirectory();
    await execFileAsync(this.sqliteBinaryPath, [
      ...this.connectionArgs(),
      "-cmd",
      `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`,
      this.databasePath,
      `PRAGMA foreign_keys = ON; ${statement}`,
    ]);
  }

  /**
   * Execute a set of statements atomically in one sqlite3 process.
   *
   * SqliteClient intentionally uses the sqlite3 CLI instead of holding a
   * persistent connection. A transaction therefore cannot be assembled from
   * multiple exec() calls because each call owns a different process/connection.
   * Keep BEGIN, every mutation, and COMMIT in this single invocation instead.
   *
   * The script is piped on stdin with COMMIT on its own line. The sqlite3 CLI
   * honours -bail only between input lines: SQL passed as a command-line
   * argument keeps executing after a failed statement and still reaches COMMIT,
   * which would persist a partial transaction. On stdin, the first error stops
   * the process before the COMMIT line and the transaction rolls back. Stdin
   * also avoids OS command-line length limits (about 32K characters on Windows).
   */
  async transaction(statements: readonly string[]): Promise<void> {
    if (statements.length === 0) {
      return;
    }
    await this.ensureDatabaseDirectory();
    const transactionSql = [
      "PRAGMA foreign_keys = ON;",
      "BEGIN IMMEDIATE;",
      ...statements,
      "COMMIT;",
      "",
    ].join("\n");
    await runWithStdin(
      this.sqliteBinaryPath,
      [...this.connectionArgs(), "-bail", "-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, this.databasePath],
      transactionSql,
    );
  }

  async queryAll<T>(statement: string): Promise<T[]> {
    await this.ensureDatabaseDirectory();
    const { stdout } = await execFileAsync(this.sqliteBinaryPath, [
      ...this.connectionArgs(),
      "-json",
      "-cmd",
      `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`,
      this.databasePath,
      `PRAGMA foreign_keys = ON; ${statement}`,
    ]);

    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }

    return JSON.parse(trimmed) as T[];
  }

  async queryOne<T>(statement: string): Promise<T | null> {
    const rows = await this.queryAll<T>(statement);
    return rows[0] ?? null;
  }
}
