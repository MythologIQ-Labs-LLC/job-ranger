// Text written through `sql` must read back exactly through queryAll on both engines (#297).
// The sqlite3 CLI prints values as C strings, so text containing NUL (U+0000) was stored intact
// but read back cut off at the NUL. Every engine now stores NUL as U+FFFD. Run plainly for the
// sqlite3 CLI engine and with --import ./tests/support/wasm-sqlite-preload.mjs for WASM.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sqliteModule = require('../electron-runtime/electron/src/sqlite.cjs');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-ranger-readback-'));
  try {
    const { SqliteClient, resolveSqliteBinary, sql } = sqliteModule;
    const binary = await resolveSqliteBinary();
    const db = new SqliteClient(path.join(dir, 'readback.sqlite3'), binary);
    // sqlite3 CLIs before 3.48 drop the backslash of control-character escapes in -json output
    // (#321), so control characters without a short JSON escape cannot read back exactly there.
    const cliVersion = globalThis.__JOB_RANGER_SQL_ENGINE__
      ? null
      : execFileSync(binary, ['-version'], { encoding: 'utf8' }).trim().split(' ')[0];
    const [major, minor] = (cliVersion ?? '3.48').split('.').map(Number);
    const jsonEscapesControls = major > 3 || (major === 3 && minor >= 48);
    const knownOldCliDefect = (value) => !jsonEscapesControls && /[\x01-\x07\x0b\x0e-\x1f\x7f]/.test(value);
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);');

    const cases = [
      'plain',
      'apostrophes \'single\' \'\' and "double"',
      Array.from({ length: 4000 }, (_, i) => `line ${i} of a long multi-line document`).join('\n'),
      Array.from({ length: 2000 }, (_, i) => `crlf row ${i}`).join('\r\n'),
      'lone CR \r in the middle',
      'ctrl-z \u001a mid, bell \u0007, escape \u001b, del \u007f, unit sep \u001f',
      'supplementary 🎓 𝒥𝑜𝒷 𠀀 and résumé',
      'mixed \t\u0001\r\n\u001a\u0008 controls',
    ];
    for (const [id, value] of cases.entries()) {
      await db.exec(sql`INSERT INTO t (id, v) VALUES (${id}, ${value});`);
    }
    const rows = await db.queryAll('SELECT id, v, hex(v) AS h FROM t ORDER BY id;');
    assert.equal(rows.length, cases.length);
    for (const [id, value] of cases.entries()) {
      assert.equal(rows[id].h, Buffer.from(value, 'utf8').toString('hex').toUpperCase(), `case ${id} is stored exactly`);
      if (knownOldCliDefect(value)) {
        console.warn(`KNOWN DEFECT #321: sqlite3 ${cliVersion} cannot read case ${id} back exactly; checked storage only.`);
        continue;
      }
      assert.equal(rows[id].v, value, `case ${id} reads back exactly`);
    }

    // Text containing NUL is stored with NUL as U+FFFD on both engines, so everything after it
    // survives the desktop engine's C-string readback; a transaction writes every row.
    const nulText = 'before\u0000after\u0000';
    await db.exec(sql`INSERT INTO t (id, v) VALUES (100, ${nulText});`);
    await db.transaction([
      sql`INSERT INTO t (id, v) VALUES (101, ${'kept'});`,
      sql`INSERT INTO t (id, v) VALUES (102, ${nulText});`,
    ]);
    assert.deepEqual(await db.queryAll('SELECT id, v FROM t WHERE id >= 100 ORDER BY id;'), [
      { id: 100, v: 'before\uFFFDafter\uFFFD' },
      { id: 101, v: 'kept' },
      { id: 102, v: 'before\uFFFDafter\uFFFD' },
    ]);
    // JSON values encode NUL as the \u0000 escape and keep it exactly.
    await db.exec(sql`INSERT INTO t (id, v) VALUES (103, ${{ text: nulText }});`);
    assert.deepEqual(JSON.parse((await db.queryOne('SELECT v FROM t WHERE id = 103;')).v), { text: nulText });

    console.log(`SQL text readback test passed on ${globalThis.__JOB_RANGER_SQL_ENGINE__ ?? 'sqlite3-cli'}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
