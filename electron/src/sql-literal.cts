// Runtime-neutral SQL literal encoding shared by every SQLite engine adapter
// (sqlite3 CLI in Electron, SQLite WASM in the browser runtime).

// Control characters other than tab and newline never appear raw in SQL text: the Windows
// sqlite3 CLI reads scripts in text mode (CR is dropped, Ctrl-Z ends input). Such values are
// written as one UTF-8 blob cast to text, which stores the identical string on every engine at
// constant expression depth. NUL itself is stored as U+FFFD (see toSqlLiteral).
const UNSAFE_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const utf8 = new TextEncoder();

function escapeSqlString(value: string): string {
  if (!UNSAFE_CONTROL.test(value)) return `'${value.replace(/'/g, "''")}'`;
  let hex = "";
  for (const byte of utf8.encode(value)) hex += byte.toString(16).padStart(2, "0");
  return `CAST(X'${hex}' AS TEXT)`;
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
    // The sqlite3 CLI prints every value as a C string, so text containing NUL would be stored
    // intact but read back cut off at the NUL on the desktop engine (#297). Every engine stores
    // NUL as U+FFFD instead, so the rest of the text survives and the gap stays visible.
    // JSON values are unaffected: JSON.stringify writes NUL as the \u0000 escape.
    return escapeSqlString(value.replace(/\u0000/g, "\uFFFD"));
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
