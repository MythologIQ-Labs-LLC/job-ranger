// NUL (U+0000) handling for #297. The desktop sqlite3 CLI reads every value back as a C string,
// so text containing NUL would be returned cut off at the NUL. toSqlLiteral stores NUL as U+FFFD
// on every engine; these helpers find and repair NUL text that is already stored (for example a
// web-app backup restored on the desktop) and let imports report the characters they replaced.
import { toSqlLiteral, type SqliteEngineClient } from "./sql-literal.cjs";

export function replaceNul(text: string): { text: string; replaced: number } {
  let replaced = 0;
  const result = text.replace(/\u0000/g, () => {
    replaced += 1;
    return "\uFFFD";
  });
  return { text: result, replaced };
}

export function unreadableCharactersWarning(count: number): string {
  return `${count} character${count === 1 ? "" : "s"} in this document could not be read and ${count === 1 ? "is" : "are"} shown as \uFFFD; review imported evidence for missing content.`;
}

export interface NulTextLocation {
  table: string;
  column: string;
  rows: number;
}

const COLUMNS_PER_QUERY = 200; // well under SQLite's 500-term compound SELECT limit

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function nulTextCondition(column: string): string {
  return `typeof(${column}) = 'text' AND instr(CAST(${column} AS BLOB), X'00') > 0`;
}

/** Finds stored TEXT values containing NUL, comparing bytes rather than the C-string prefix. */
export async function findNulText(client: SqliteEngineClient): Promise<NulTextLocation[]> {
  const columns = await client.queryAll<{ table_name: string; column_name: string }>(
    `SELECT m.name AS table_name, p.name AS column_name
       FROM sqlite_schema AS m JOIN pragma_table_info(m.name) AS p
      WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
      ORDER BY m.name, p.cid;`,
  );
  const found: NulTextLocation[] = [];
  for (let start = 0; start < columns.length; start += COLUMNS_PER_QUERY) {
    const counts = columns.slice(start, start + COLUMNS_PER_QUERY).map(({ table_name, column_name }) =>
      `SELECT ${toSqlLiteral(table_name)} AS table_name, ${toSqlLiteral(column_name)} AS column_name, count(*) AS rows
         FROM ${quoteIdentifier(table_name)} WHERE ${nulTextCondition(quoteIdentifier(column_name))}`);
    const rows = await client.queryAll<{ table_name: string; column_name: string; rows: number }>(
      `${counts.join("\nUNION ALL\n")};`,
    );
    for (const row of rows) {
      if (Number(row.rows) > 0) found.push({ table: row.table_name, column: row.column_name, rows: Number(row.rows) });
    }
  }
  return found;
}

export function describeNulText(locations: readonly NulTextLocation[]): string {
  return locations
    .map((found) => `${found.table}.${found.column} (${found.rows} value${found.rows === 1 ? "" : "s"})`)
    .join(", ");
}

const utf8 = new TextDecoder("utf-8");

function decodeHexText(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return utf8.decode(bytes);
}

export interface NulTextRepairFailure {
  table: string;
  column: string;
  message: string;
}

/**
 * Rewrites every listed NUL-bearing TEXT value with NUL as U+FFFD. The value is read as hex so the
 * text after the NUL survives on the sqlite3 CLI engine too. Each column is repaired in its own
 * transaction; a column that cannot be repaired (for example because the repaired value would
 * duplicate a UNIQUE key) is left unchanged and reported.
 */
export async function repairNulText(
  client: SqliteEngineClient,
  locations: readonly NulTextLocation[],
): Promise<NulTextRepairFailure[]> {
  const failures: NulTextRepairFailure[] = [];
  for (const { table, column } of locations) {
    const quotedTable = quoteIdentifier(table);
    const quotedColumn = quoteIdentifier(column);
    try {
      const rows = await client.queryAll<{ row_id: number; value_hex: string }>(
        `SELECT rowid AS row_id, hex(CAST(${quotedColumn} AS BLOB)) AS value_hex
           FROM ${quotedTable} WHERE ${nulTextCondition(quotedColumn)};`,
      );
      await client.transaction(rows.map((row) =>
        `UPDATE ${quotedTable} SET ${quotedColumn} = ${toSqlLiteral(decodeHexText(row.value_hex))} WHERE rowid = ${Number(row.row_id)};`));
    } catch (error) {
      failures.push({ table, column, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}

export function describeRepairFailures(failures: readonly NulTextRepairFailure[]): string {
  return failures.map((failure) => `${failure.table}.${failure.column} (${failure.message})`).join("; ");
}

const STARTUP_REPAIR = "nul_text_as_replacement_character";

/**
 * Once per database, stores NUL already held in TEXT values as U+FFFD, so the desktop engine reads
 * the whole text and new writes (which store U+FFFD) match old keys. Never blocks startup: values
 * that cannot be repaired are reported and left as they are.
 */
export async function repairStoredNulTextOnce(client: SqliteEngineClient): Promise<NulTextRepairFailure[]> {
  await client.exec("CREATE TABLE IF NOT EXISTS maintenance_runs (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL);");
  const done = await client.queryOne(`SELECT 1 AS done FROM maintenance_runs WHERE name = '${STARTUP_REPAIR}';`);
  if (done) return [];
  let failures: NulTextRepairFailure[];
  try {
    failures = await repairNulText(client, await findNulText(client));
  } catch (error) {
    failures = [{ table: "*", column: "*", message: error instanceof Error ? error.message : String(error) }];
  }
  // Marked done even when some columns failed: they are reported now and not retried at every start.
  await client.exec(
    `INSERT INTO maintenance_runs (name, completed_at) VALUES ('${STARTUP_REPAIR}', ${toSqlLiteral(new Date().toISOString())});`,
  );
  return failures;
}
