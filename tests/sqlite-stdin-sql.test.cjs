// SqliteClient must never put SQL on the sqlite3 command line. Windows inspects
// each process launch whose command line it has not seen before, and SQL carries
// unique ids and timestamps, so every statement paid 0.5-2 s (Career Profile
// imports took 2-5 s). With the script on stdin the command line never changes.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

// Record every sqlite3 launch. Installed before the client module loads so a
// client that captures execFile at load time is observed as well.
const launches = [];
const realSpawn = childProcess.spawn;
const realExecFile = childProcess.execFile;
childProcess.spawn = (binary, args, options) => {
  const child = realSpawn(binary, args, options);
  const launch = { args: [...args], stdin: '' };
  const end = child.stdin.end.bind(child.stdin);
  child.stdin.end = (chunk, ...rest) => { launch.stdin += String(chunk ?? ''); return end(chunk, ...rest); };
  launches.push(launch);
  return child;
};
childProcess.execFile = (binary, args, ...rest) => {
  launches.push({ args: [...args], stdin: null });
  return realExecFile(binary, args, ...rest);
};
childProcess.execFile[promisify.custom] = (binary, args, ...rest) => {
  launches.push({ args: [...args], stdin: null });
  return promisify(realExecFile)(binary, args, ...rest);
};
const { SqliteClient, resolveSqliteBinary, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-ranger-stdin-sql-'));
  try {
    const binary = await resolveSqliteBinary();
    launches.length = 0;
    const db = new SqliteClient(path.join(dir, 'stdin.sqlite3'), binary);
    const marker = `marker-${Date.now()}`;
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, note TEXT);');
    await db.exec(sql`INSERT INTO t VALUES (${marker}, ${'exec'});`);
    await db.transaction([sql`INSERT INTO t VALUES (${`${marker}-tx`}, ${'transaction'});`]);
    const rows = await db.queryAll(sql`SELECT id, note FROM t WHERE id LIKE ${`${marker}%`} ORDER BY id;`);
    assert.deepEqual(rows, [{ id: marker, note: 'exec' }, { id: `${marker}-tx`, note: 'transaction' }]);
    assert.deepEqual(await db.queryOne(sql`SELECT note FROM t WHERE id = ${marker};`), { note: 'exec' });

    assert.ok(launches.length >= 5, 'every call should launch sqlite3');
    for (const launch of launches) {
      const commandLine = launch.args.join(' ');
      assert.doesNotMatch(commandLine, /CREATE TABLE|INSERT|SELECT|marker-/, `SQL leaked onto the command line: ${commandLine}`);
      assert.notEqual(launch.stdin, null, 'sqlite3 must receive its SQL on stdin');
    }
    assert.equal(new Set(launches.map((launch) => launch.args.join(' '))).size <= 2, true,
      'the command line should be the same for every statement (plain and -json)');

    // Failures still reject with SQLite's own message.
    await assert.rejects(db.exec(sql`INSERT INTO t VALUES (${marker}, 'dup');`), /UNIQUE constraint failed/);
    await assert.rejects(db.queryAll('SELECT * FROM missing_table;'), /no such table/);

    console.log('SQLite stdin SQL test passed');
  } finally {
    childProcess.spawn = realSpawn;
    childProcess.execFile = realExecFile;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
