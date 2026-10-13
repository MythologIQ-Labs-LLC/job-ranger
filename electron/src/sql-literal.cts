// Runtime-neutral SQL literal encoding shared by every SQLite engine adapter
// (sqlite3 CLI in Electron, SQLite WASM in the browser runtime).

// Control characters never appear raw in SQL text: the Windows sqlite3 CLI reads scripts in
// text mode (CR is dropped, Ctrl-Z ends input) and NUL cannot cross a process boundary. They
// are spliced in with char(), which yields the identical string on every engine.
const CONTROL = /[\u0000-\u001f\u007f]/;

function escapeSqlString(value: string): string {
  if (!CONTROL.test(value)) return `'${value.replace(/'/g, "''")}'`;
  const parts: string[] = [];
  let run = "";
  for (const ch of value) {
    if (CONTROL.test(ch)) {
      if (run) parts.push(`'${run.replace(/'/g, "''")}'`);
      run = "";
      parts.push(`char(${ch.charCodeAt(0)})`);
    } else {
      run += ch;
    }
  }
  if (run) parts.push(`'${run.replace(/'/g, "''")}'`);
  return `(${parts.join(" || ")})`;
}

export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite number cannot be persisted to SQLite");
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (typeof value === "string") {
    return escapeSqlString(value);
  }

  return escapeSqlString(JSON.stringify(value));
}

export function sql(queryParts: TemplateStringsArray, ...values: unknown[]): string {
  return queryParts.reduce((output, part, index) => {
    if (index === values.length) {
      return output + part;
    }
    return output + part + toSqlLiteral(values[index]);
  }, "");
}

/**
 * The persistence port every Job Ranger repository depends on. Electron
 * implements it with the bundled sqlite3 CLI; the browser runtime implements
 * it with SQLite WASM persisted to the origin-private file system. Both
 * engines execute the same migrations and the same repository SQL.
 */
export interface SqliteEngineClient {
  exec(statement: string): Promise<void>;
  transaction(statements: readonly string[]): Promise<void>;
  queryAll<T>(statement: string): Promise<T[]>;
  queryOne<T>(statement: string): Promise<T | null>;
}
