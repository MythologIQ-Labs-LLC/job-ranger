// #297: the desktop sqlite3 CLI reads text back as C strings, so text containing NUL (U+0000) came
// back cut off at the NUL. Every engine now stores NUL as U+FFFD: scraped listings, UTF-16 text
// files read as UTF-8, and backups holding NUL text (for example from the web app) keep the text
// after the NUL, and the replacement is visible and reported.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { JobScoutBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { BackupService, applyPendingRestore } = require('../electron-runtime/electron/src/backup-service.cjs');
const { SqliteClient } = require('../electron-runtime/electron/src/sqlite.cjs');
const { replaceNul, findNulText, repairStoredNulTextOnce } = require('../electron-runtime/electron/src/nul-text.cjs');

const engine = globalThis.__JOB_RANGER_SQL_ENGINE__ ?? 'sqlite3-cli';
const R = '\uFFFD';

function greenhouseWithNul() {
  return async (url) => {
    if (!String(url).includes('boards-api.greenhouse.io/v1/boards/nulco/jobs')) {
      throw new Error(`Unexpected fetch URL in test: ${url}`);
    }
    return new Response(JSON.stringify({
      jobs: [
        {
          id: 201,
          title: 'Platform\u0000Engineer',
          location: { name: 'Remote' },
          absolute_url: 'https://boards.greenhouse.io/nulco/jobs/201',
          content: '<p>Build\u0000 APIs.</p>',
          updated_at: '2026-10-15T12:00:00.000Z',
        },
        {
          id: 202,
          title: 'Product Designer',
          location: { name: 'New York' },
          absolute_url: 'https://boards.greenhouse.io/nulco/jobs/202',
          content: '<p>Design.</p>',
          updated_at: '2026-10-15T13:00:00.000Z',
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function installation(userDataDirectory, fetchImpl) {
  const dataDirectory = path.join(userDataDirectory, 'data');
  const backend = new JobScoutBackend({ dataDirectory, schedulerEnabled: false, fetchImpl });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const career = new CareerBackend({ dataDirectory, databasePath: status.databasePath, sqliteBinaryPath: status.sqliteBinaryPath });
  await career.initialize();
  return { backend, career, dataDirectory, status };
}

async function run() {
  assert.deepEqual(replaceNul('a\u0000b\u0000'), { text: `a${R}b${R}`, replaced: 2 });
  assert.deepEqual(replaceNul('clean'), { text: 'clean', replaced: 0 });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'job-ranger-nul-'));
  try {
    // A listing carrying NUL keeps all of its text, shows U+FFFD, and the run succeeds.
    const scraping = await installation(path.join(root, 'scrape'), greenhouseWithNul());
    const company = await scraping.backend.createCompany({
      name: 'NulCo', url: 'https://boards.greenhouse.io/nulco', frequencyMinutes: 1440, isActive: true,
    });
    const result = await scraping.backend.runCompanyScrape(company.id);
    assert.equal(result.status, 'success');
    const titles = (await scraping.backend.listJobs()).map((job) => job.title).sort();
    assert.deepEqual(titles, [`Platform${R}Engineer`, 'Product Designer']);
    // The snapshot hash is of the text as stored, with U+FFFD.
    const scrapeDb = new SqliteClient(scraping.status.databasePath, scraping.status.sqliteBinaryPath);
    for (const snapshot of await scrapeDb.queryAll('SELECT content_text, content_hash FROM job_source_snapshots;')) {
      assert.equal(snapshot.content_hash, createHash('sha256').update(snapshot.content_text).digest('hex'));
    }

    // A UTF-16 text file read as UTF-8 is full of NUL: the import keeps every character, shows
    // NUL as U+FFFD and says how many were replaced, instead of storing text cut off at the NUL.
    const utf16Path = path.join(root, 'notepad-unicode.txt');
    await fs.writeFile(utf16Path, Buffer.from('Led payroll for 40 staff.', 'utf16le'));
    const imported = await scraping.career.importResumeFile(utf16Path);
    assert.equal(imported.failureCode, null);
    const rawText = imported.extractionSnapshot.rawText;
    assert.equal(rawText, Buffer.from('Led payroll for 40 staff.', 'utf16le').toString('utf8').replace(/\u0000/g, R));
    assert.ok(imported.extractionSnapshot.warnings.some((warning) => /25 characters .* shown as \uFFFD/.test(warning)));
    const scrapedSqlite = new SqliteClient(scraping.status.databasePath, scraping.status.sqliteBinaryPath);
    assert.deepEqual(await findNulText(scrapedSqlite), [], 'no NUL reaches storage');
    await scraping.backend.dispose();

    // A backup whose database holds NUL text is announced before restore and restored with NUL
    // as U+FFFD, keeping the text after it.
    const sourceUserData = path.join(root, 'source');
    const targetUserData = path.join(root, 'target');
    const backupParent = path.join(root, 'backups');
    await fs.mkdir(backupParent, { recursive: true });
    const source = await installation(sourceUserData);
    const sourceSqlite = new SqliteClient(source.status.databasePath, source.status.sqliteBinaryPath);
    // Written as bytes, the way another engine could have stored it: 'before', NUL, 'after', LF.
    await sourceSqlite.exec(`
      INSERT INTO companies (name, url, source_type, frequency_minutes, is_active, last_run_status, created_at, updated_at)
      VALUES (CAST(X'6265666F72650061667465720A' AS TEXT), 'https://example.test/nul', 'generic-html', 60, 1, 'idle',
              '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z');
    `);
    assert.deepEqual(await findNulText(sourceSqlite), [{ table: 'companies', column: 'name', rows: 1 }]);
    const [stored] = await sourceSqlite.queryAll("SELECT name FROM companies WHERE url = 'https://example.test/nul';");
    assert.equal(
      stored.name,
      engine === 'sqlite3-cli' ? 'before' : 'before\u0000after\n',
      'the sqlite3 CLI reads NUL text back cut off at the NUL; WASM reads it exactly',
    );
    const created = await new BackupService({
      dataDirectory: source.dataDirectory, userDataDirectory: sourceUserData,
      databasePath: source.status.databasePath, sqliteBinaryPath: source.status.sqliteBinaryPath, appVersion: 'test-1',
    }).createBackup(backupParent);
    await source.backend.dispose();

    // Startup repairs text stored with NUL before this change, once per database, and reports a
    // value it cannot repair (here the repaired job key would duplicate another) without failing.
    const sourceDb = new SqliteClient(source.status.databasePath, source.status.sqliteBinaryPath);
    await sourceDb.exec('DELETE FROM maintenance_runs;'); // as written by a build before #297
    const [nulCompany] = await sourceDb.queryAll("SELECT id FROM companies WHERE url = 'https://example.test/nul';");
    const jobColumns = 'company_id, source_job_id, source_type, title, location, url, description_snippet, created_at, last_seen_at';
    const jobValues = (key) => `${nulCompany.id}, ${key}, 'generic-html', 'Role', 'Remote', 'https://example.test/j', 'x', '2026-10-15', '2026-10-15'`;
    await sourceDb.exec(`INSERT INTO jobs (${jobColumns}) VALUES (${jobValues("CAST(X'6A00' AS TEXT)")});`);
    await sourceDb.exec(`INSERT INTO jobs (${jobColumns}) VALUES (${jobValues("CAST(X'6AEFBFBD' AS TEXT)")});`);
    const failures = await repairStoredNulTextOnce(sourceDb);
    assert.deepEqual(failures.map(({ table, column }) => `${table}.${column}`), ['jobs.source_job_id']);
    assert.match(failures[0].message, /UNIQUE constraint failed/);
    const [repairedCompany] = await sourceDb.queryAll("SELECT name FROM companies WHERE url = 'https://example.test/nul';");
    assert.equal(repairedCompany.name, `before${R}after
`);
    assert.deepEqual(await findNulText(sourceDb), [{ table: 'jobs', column: 'source_job_id', rows: 1 }]);
    assert.deepEqual(await repairStoredNulTextOnce(sourceDb), [], 'the startup repair runs once');
    const reopened = await installation(sourceUserData); // initialize must not fail on what is left
    await reopened.backend.dispose();

    const target = await installation(targetUserData);
    const targetBackups = new BackupService({
      dataDirectory: target.dataDirectory, userDataDirectory: targetUserData,
      databasePath: target.status.databasePath, sqliteBinaryPath: target.status.sqliteBinaryPath, appVersion: 'test-1',
    });
    const selection = await targetBackups.validateBackup(created.summary.bundlePath);
    assert.ok(
      selection.warnings.some((warning) => /NUL characters \(U\+0000\).*shows as \uFFFD.*companies\.name \(1 value\)/.test(warning)),
      'the restore warns before the person confirms',
    );
    await targetBackups.stageRestore(created.summary.bundlePath);
    await target.backend.dispose();
    assert.equal(await applyPendingRestore({ userDataDirectory: targetUserData, dataDirectory: target.dataDirectory }), true);
    const restored = new SqliteClient(target.status.databasePath, target.status.sqliteBinaryPath);
    const [restoredRow] = await restored.queryAll("SELECT name FROM companies WHERE url = 'https://example.test/nul';");
    assert.equal(restoredRow.name, `before${R}after\n`);
    assert.deepEqual(await findNulText(restored), []);

    console.log(`NUL text test passed on ${engine}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
