const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { BackupService, applyPendingRestore } = require('../electron-runtime/electron/src/backup-service.cjs');
const { migrations } = require('../electron-runtime/electron/src/migrations.cjs');
const { resolveSqliteBinary, SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function seedV112Database(dataDirectory) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const sqliteBinaryPath = await resolveSqliteBinary();
  const databasePath = path.join(dataDirectory, 'sojourner.sqlite3');
  const sqlite = new SqliteClient(databasePath, sqliteBinaryPath);

  for (const migration of migrations.filter((item) => item.version <= 2)) {
    await sqlite.exec(migration.sql);
    await sqlite.exec(sql`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (${migration.version}, ${migration.name}, ${'2026-09-24T12:00:00.000Z'});
    `);
  }

  await sqlite.exec(sql`
    INSERT INTO companies (
      id, name, url, source_type, source_identifier, frequency_minutes,
      is_active, last_run_at, last_run_status, last_error_message,
      created_at, updated_at, consecutive_failures, circuit_open_until
    ) VALUES (
      ${1}, ${'Legacy Employer'}, ${'https://boards.greenhouse.io/legacy-employer'},
      ${'greenhouse'}, ${'legacy-employer'}, ${1440}, ${1},
      ${'2026-09-24T13:00:00.000Z'}, ${'success'}, ${null},
      ${'2026-09-20T12:00:00.000Z'}, ${'2026-09-24T13:00:00.000Z'}, ${0}, ${null}
    );
  `);

  await sqlite.exec(sql`
    INSERT INTO jobs (
      id, company_id, source_job_id, source_type, title, location,
      employment_type, url, description_snippet, salary_min, salary_max,
      salary_currency, salary_text, post_date, created_at, last_seen_at,
      is_active, is_new, matched_filter_count
    ) VALUES (
      ${1}, ${1}, ${'legacy-job-401'}, ${'greenhouse'},
      ${'Operations Coordinator'}, ${'Baltimore, MD'}, ${'full-time'},
      ${'https://boards.greenhouse.io/legacy-employer/jobs/401'},
      ${'Coordinate schedules, vendors, and customer requests.'},
      ${65000}, ${78000}, ${'USD'}, ${'$65,000-$78,000'},
      ${'2026-09-23'}, ${'2026-09-23T12:00:00.000Z'},
      ${'2026-09-24T13:00:00.000Z'}, ${1}, ${0}, ${1}
    );
  `);

  await sqlite.exec(sql`
    INSERT INTO filters (
      id, name, company_id, title_include, title_exclude,
      keywords_include, keywords_exclude, salary_min,
      location_include, location_exclude, is_active, created_at, updated_at
    ) VALUES (
      ${1}, ${'Legacy operations filter'}, ${1}, ${'["Coordinator"]'}, ${'[]'},
      ${'["operations"]'}, ${'[]'}, ${60000}, ${'["Baltimore"]'}, ${'[]'}, ${1},
      ${'2026-09-20T12:00:00.000Z'}, ${'2026-09-24T13:00:00.000Z'}
    );
  `);

  await sqlite.exec(sql`
    INSERT INTO scrape_runs (
      id, company_id, started_at, finished_at, status,
      jobs_found_count, jobs_matched_count, error_message
    ) VALUES (
      ${1}, ${1}, ${'2026-09-24T12:59:00.000Z'}, ${'2026-09-24T13:00:00.000Z'},
      ${'success'}, ${1}, ${1}, ${null}
    );
  `);

  const settings = {
    notificationsEnabled: true,
    notifyOnNewJobs: true,
    notifyOnMatchedJobs: false,
    minimizeToTray: true,
  };
  for (const [key, value] of Object.entries(settings)) {
    await sqlite.exec(sql`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}, ${'2026-09-24T13:00:00.000Z'});
    `);
  }

  return { databasePath, sqliteBinaryPath };
}

function legacyCareerPayload() {
  return {
    profile: {
      version: 2,
      fullName: 'Legacy User',
      homeLocation: 'Annapolis, MD',
      radiusMiles: 35,
      minimumPay: 70000,
      payBasis: 'annual',
      targetTitles: ['Operations Coordinator', 'Program Coordinator'],
      skills: ['Scheduling', 'Vendor coordination'],
      certifications: [],
      sectors: ['Operations'],
      onCallPreference: 'no',
      fullTimeOnly: true,
      updatedAt: '2026-09-24T12:00:00.000Z',
    },
    applications: [
      {
        id: 'application-v112-1',
        jobId: '1',
        title: 'Operations Coordinator',
        companyName: 'Legacy Employer',
        url: 'https://boards.greenhouse.io/legacy-employer/jobs/401',
        status: 'applied',
        notes: 'Preserved from v1.1.2 renderer-local storage.',
        createdAt: '2026-09-24T13:05:00.000Z',
        updatedAt: '2026-09-24T13:05:00.000Z',
      },
    ],
  };
}

async function initializeCandidate(userDataDirectory) {
  const dataDirectory = path.join(userDataDirectory, 'data');
  const backend = new SojournerBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error('v1.1.2 upgrade smoke test must not use the network');
    },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const career = new CareerBackend({
    dataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await career.initialize();
  return { backend, career, dataDirectory, status };
}

async function assertUpgradedState(installation) {
  const companies = await installation.backend.listCompanies();
  const jobs = await installation.backend.listJobs();
  const filters = await installation.backend.listFilters();
  const settings = await installation.backend.getSettings();
  const profile = await installation.career.getProfile();
  const applications = await installation.career.listApplications();
  const tracks = await installation.career.listTargetTracks();

  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, 'Legacy Employer');
  assert.equal(companies[0].sourceType, 'greenhouse');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Operations Coordinator');
  assert.equal(filters.length, 1);
  assert.equal(filters[0].name, 'Legacy operations filter');
  assert.equal(settings.notificationsEnabled, true);
  assert.equal(settings.notifyOnMatchedJobs, false);
  assert.equal(settings.minimizeToTray, true);

  assert.equal(profile?.fullName, 'Legacy User');
  assert.deepEqual(profile?.targetTitles, ['Operations Coordinator', 'Program Coordinator']);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].id, 'application-v112-1');
  assert.equal(applications[0].status, 'applied');
  assert.match(applications[0].notes, /v1\.1\.2 renderer-local storage/);

  const bridge = tracks.find((track) => track.id === 'legacy-default');
  assert.ok(bridge, 'legacy Career Profile must produce the migration bridge target track');
  assert.equal(bridge.origin, 'legacy-profile');
  assert.deepEqual(bridge.roleTitles, ['Operations Coordinator', 'Program Coordinator']);

  const sqlite = new SqliteClient(
    installation.status.databasePath,
    installation.status.sqliteBinaryPath,
  );
  const migrationRows = await sqlite.queryAll(
    'SELECT version, name FROM schema_migrations ORDER BY version ASC;',
  );
  const migrationMap = new Map(migrationRows.map((row) => [row.version, row.name]));
  assert.equal(migrationMap.get(1), 'initial_schema');
  assert.equal(migrationMap.get(2), 'circuit_breaker');
  assert.equal(migrationMap.get(3), 'career_intelligence_persistence');
  assert.equal(migrationMap.get(4), 'career_evidence_contracts');
  assert.equal(migrationMap.get(6), 'career_target_tracks');
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-v112-upgrade-'));

  try {
    const sourceUserData = path.join(root, 'source-user-data');
    const sourceData = path.join(sourceUserData, 'data');
    const preUpgradeSnapshot = path.join(root, 'pre-upgrade-v1.1.2.sqlite3');
    const backupParent = path.join(root, 'backups');
    const restoredUserData = path.join(root, 'restored-user-data');

    await fs.mkdir(sourceUserData, { recursive: true });
    await fs.mkdir(backupParent, { recursive: true });
    await fs.mkdir(restoredUserData, { recursive: true });

    const legacy = await seedV112Database(sourceData);
    const legacyBytes = await fs.readFile(legacy.databasePath);
    await fs.copyFile(legacy.databasePath, preUpgradeSnapshot);
    assert.equal(
      sha256(await fs.readFile(preUpgradeSnapshot)),
      sha256(legacyBytes),
      'pre-upgrade v1.1.2 database snapshot must be byte-identical before migration',
    );

    const upgraded = await initializeCandidate(sourceUserData);
    await upgraded.career.migrateLegacy(legacyCareerPayload());
    await assertUpgradedState(upgraded);

    // Migration/import must be safe to retry without duplicating renderer-local state.
    await upgraded.career.migrateLegacy(legacyCareerPayload());
    await assertUpgradedState(upgraded);

    const backupService = new BackupService({
      dataDirectory: upgraded.dataDirectory,
      userDataDirectory: sourceUserData,
      databasePath: upgraded.status.databasePath,
      sqliteBinaryPath: upgraded.status.sqliteBinaryPath,
      appVersion: '1.2.0-upgrade-test',
    });
    const backup = await backupService.createBackup(backupParent);
    await backupService.validateBackup(backup.summary.bundlePath);
    await upgraded.backend.dispose();

    const target = await initializeCandidate(restoredUserData);
    const targetBackupService = new BackupService({
      dataDirectory: target.dataDirectory,
      userDataDirectory: restoredUserData,
      databasePath: target.status.databasePath,
      sqliteBinaryPath: target.status.sqliteBinaryPath,
      appVersion: '1.2.0-upgrade-test',
    });
    await targetBackupService.stageRestore(backup.summary.bundlePath);
    await target.backend.dispose();

    assert.equal(
      await applyPendingRestore({
        userDataDirectory: restoredUserData,
        dataDirectory: path.join(restoredUserData, 'data'),
      }),
      true,
      'upgraded v1.1.2 state should restore into a different installation root',
    );

    const restored = await initializeCandidate(restoredUserData);
    await assertUpgradedState(restored);
    await restored.backend.dispose();

    // The original pre-upgrade snapshot remains available as rollback evidence.
    assert.equal(
      sha256(await fs.readFile(preUpgradeSnapshot)),
      sha256(legacyBytes),
      'upgrade/backup/restore must not mutate the preserved v1.1.2 snapshot',
    );

    console.log('v1.1.2 -> v1.2.0 upgrade and restore smoke passed!');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
