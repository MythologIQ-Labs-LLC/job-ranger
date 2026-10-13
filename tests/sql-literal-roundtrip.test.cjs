// SQL literals must store any text exactly on both engines (#286 G3 review N1). Run plainly
// for the sqlite3 CLI engine and with --import ./tests/support/wasm-sqlite-preload.mjs for WASM.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sqliteModule = require('../electron-runtime/electron/src/sqlite.cjs');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-ranger-literal-'));
  try {
    const { SqliteClient, resolveSqliteBinary, sql } = sqliteModule;
    const db = new SqliteClient(path.join(dir, 'literal.sqlite3'), await resolveSqliteBinary());
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');
    const cases = [
      'plain',
      Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'), // long multi-line documents
      Array.from({ length: 3000 }, (_, i) => `row ${i}\r`).join('\n'), // CRLF documents
      'tab\there and quote \' and "double"',
      'ctrl-z \u001a mid, bell \u0007, del \u007f',
      'unicode résumé 🎓',
    ];
    for (const [i, value] of cases.entries()) {
      await db.transaction([sql`INSERT INTO t (id, v) VALUES (${i}, ${value});`]);
    }
    const rows = await db.queryAll('SELECT id, hex(v) AS h FROM t ORDER BY id;');
    for (const [i, value] of cases.entries()) {
      assert.equal(rows[i].h, Buffer.from(value, 'utf8').toString('hex').toUpperCase(), `case ${i} stored exactly`);
    }
    // Literals stay usable in comparisons.
    assert.equal((await db.queryOne(sql`SELECT id FROM t WHERE v = ${cases[4]};`)).id, 4);
    console.log(`SQL literal round-trip test passed on ${globalThis.__JOB_RANGER_SQL_ENGINE__ ?? 'sqlite3-cli'}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
