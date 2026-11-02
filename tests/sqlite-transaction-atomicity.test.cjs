// SqliteClient.transaction must be all-or-nothing on the sqlite3 CLI engine. The CLI ignores
// -bail inside SQL passed as a command-line argument and still runs COMMIT after a failed
// statement; this guards the stdin-based implementation (found during #286 G3).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SqliteClient, resolveSqliteBinary } = require('../electron-runtime/electron/src/sqlite.cjs');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-ranger-atomicity-'));
  try {
    const db = new SqliteClient(path.join(dir, 'atomicity.sqlite3'), await resolveSqliteBinary());
    await db.exec('CREATE TABLE t (x INTEGER PRIMARY KEY); CREATE TABLE r (n INTEGER NOT NULL);');
    await db.transaction(['INSERT INTO t VALUES (1);']);
    // Failure in the middle, with work before and after it on the same and later lines.
    await assert.rejects(db.transaction([
      'INSERT INTO r VALUES (1);',
      'INSERT INTO r VALUES (2); INSERT INTO t VALUES (1); INSERT INTO r VALUES (3);',
      'INSERT INTO r VALUES (4);',
    ]), /UNIQUE constraint failed/);
    assert.deepEqual(await db.queryAll('SELECT n FROM r;'), [], 'nothing from the failed transaction persists');
    // A failing last statement must not commit the earlier ones either.
    await assert.rejects(db.transaction(['INSERT INTO r VALUES (5);', 'INSERT INTO t VALUES (1);']));
    assert.deepEqual(await db.queryAll('SELECT n FROM r;'), []);
    // Large scripts (beyond Windows command-line limits) commit as one unit.
    const rows = Array.from({ length: 3000 }, (_, i) => `INSERT INTO r VALUES (${i});`);
    await db.transaction(rows);
    assert.equal((await db.queryOne('SELECT COUNT(*) AS n FROM r;')).n, 3000);
    await assert.rejects(db.transaction([...rows.map((s) => s.replace('VALUES (', 'VALUES (10000 + ')), 'INSERT INTO t VALUES (1);']));
    assert.equal((await db.queryOne('SELECT COUNT(*) AS n FROM r;')).n, 3000);
    // Quotes and newlines inside literals survive the stdin path.
    await db.transaction(["INSERT INTO r VALUES (length('a''b\nc;\nCOMMIT;'));"]);
    assert.equal((await db.queryOne('SELECT MAX(n) AS n FROM r;')).n, 2999);
    // Control characters survive exactly: the Windows CLI reads stdin in text mode, so they
    // must never appear raw in SQL text (CR would be dropped, Ctrl-Z would end the input).
    const { sql } = require('../electron-runtime/electron/src/sqlite.cjs');
    await db.exec('CREATE TABLE c (v TEXT);');
    const tricky = 'a\r\nb\u001ac\u001bd\te\u007ff';
    await db.transaction([sql`INSERT INTO c VALUES (${tricky});`, sql`INSERT INTO c VALUES (${"it's \r fine"});`]);
    assert.deepEqual((await db.queryAll('SELECT hex(v) AS h FROM c ORDER BY rowid;')).map((r) => r.h), [Buffer.from(tricky).toString('hex').toUpperCase(), Buffer.from("it's \r fine").toString('hex').toUpperCase()]);
    // NUL is stored as U+FFFD: the CLI would read it back cut off at the NUL (#297).
    await db.transaction([sql`INSERT INTO c VALUES (${'nul \u0000 here'});`]);
    assert.equal((await db.queryOne('SELECT v FROM c ORDER BY rowid DESC LIMIT 1;')).v, 'nul \uFFFD here');
    console.log('SQLite transaction atomicity test passed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
