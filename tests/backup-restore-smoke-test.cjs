const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { BackupService, applyPendingRestore } = require('../electron-runtime/electron/src/backup-service.cjs');
const { SqliteClient, sql } = require('../electron-runtime/electron/src/sqlite.cjs');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function initializeInstallation(userDataDirectory) {
  const dataDirectory = path.join(userDataDirectory, 'data');
  const backend = new SojournerBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => { throw new Error('backup smoke test must not use the network'); },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  return { backend, dataDirectory, status };
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-backup-'));
  try {
    const sourceUserData = path.join(root, 'source-user-data');
    const targetUserData = path.join(root, 'target-user-data');
    const backupParent = path.join(root, 'backups');
    await fs.mkdir(sourceUserData, { recursive: true });
    await fs.mkdir(targetUserData, { recursive: true });
    await fs.mkdir(backupParent, { recursive: true });

    const source = await initializeInstallation(sourceUserData);
    const sourceCareer = new CareerBackend({
      dataDirectory: source.dataDirectory,
      databasePath: source.status.databasePath,
      sqliteBinaryPath: source.status.sqliteBinaryPath,
    });
    await sourceCareer.initialize();
    await sourceCareer.saveProfile({
      version: 2,
      fullName: 'Portable Person',
      homeLocation: 'Annapolis, MD',
      radiusMiles: 25,
      minimumPay: 90000,
      payBasis: 'annual',
      targetTitles: ['Program Manager'],
      skills: [],
      certifications: [],
      sectors: [],
      onCallPreference: 'either',
      fullTimeOnly: true,
    });

    const sourceSqlite = new SqliteClient(source.status.databasePath, source.status.sqliteBinaryPath);
    const artifactBytes = Buffer.from('portable career source artifact\n', 'utf8');
    const sourceArtifactPath = path.join(
      source.dataDirectory,
      'artifacts',
      'sources',
      'portable-source',
      'source.txt',
    );
    await fs.mkdir(path.dirname(sourceArtifactPath), { recursive: true });
    await fs.writeFile(sourceArtifactPath, artifactBytes);
    await sourceSqlite.exec(sql`
      INSERT INTO source_artifacts (
        id, kind, original_name, media_type, detected_format, content_hash,
        managed_path, byte_size, imported_at, parser_id, parser_version,
        extraction_state, warnings_json
      ) VALUES (
        ${'portable-source'}, ${'resume'}, ${'career.txt'}, ${'text/plain'}, ${'txt'},
        ${sha256(artifactBytes)}, ${sourceArtifactPath}, ${artifactBytes.byteLength},
        ${'2026-10-03T18:00:00.000Z'}, ${null}, ${null}, ${'preserved'}, ${'[]'}
      );
    `);

    const sourceBackupService = new BackupService({
      dataDirectory: source.dataDirectory,
      userDataDirectory: sourceUserData,
      databasePath: source.status.databasePath,
      sqliteBinaryPath: source.status.sqliteBinaryPath,
      appVersion: 'test-1',
    });
    const created = await sourceBackupService.createBackup(backupParent);
    assert.equal(created.manifest.version, 1);
    assert.equal(created.summary.artifactFileCount, 1);
    assert.ok(created.manifest.managedPaths.some((item) => item.id === 'portable-source'));
    await source.backend.dispose();

    const target = await initializeInstallation(targetUserData);
    const targetCareer = new CareerBackend({
      dataDirectory: target.dataDirectory,
      databasePath: target.status.databasePath,
      sqliteBinaryPath: target.status.sqliteBinaryPath,
    });
    await targetCareer.initialize();
    await targetCareer.saveProfile({
      version: 2,
      fullName: 'Replace Me',
      homeLocation: '',
      radiusMiles: null,
      minimumPay: null,
      payBasis: 'annual',
      targetTitles: [],
      skills: [],
      certifications: [],
      sectors: [],
      onCallPreference: 'either',
      fullTimeOnly: false,
    });

    const targetBackupService = new BackupService({
      dataDirectory: target.dataDirectory,
      userDataDirectory: targetUserData,
      databasePath: target.status.databasePath,
      sqliteBinaryPath: target.status.sqliteBinaryPath,
      appVersion: 'test-1',
    });
    const validated = await targetBackupService.validateBackup(created.summary.bundlePath);
    assert.equal(validated.summary.artifactFileCount, 1);
    await targetBackupService.stageRestore(created.summary.bundlePath);
    await target.backend.dispose();

    assert.equal(
      await applyPendingRestore({
        userDataDirectory: targetUserData,
        dataDirectory: target.dataDirectory,
      }),
      true,
      'a staged restore should atomically replace the target data directory',
    );

    const restored = await initializeInstallation(targetUserData);
    const restoredSqlite = new SqliteClient(restored.status.databasePath, restored.status.sqliteBinaryPath);
    const profile = await restoredSqlite.queryOne("SELECT full_name FROM career_profile WHERE id = 1;");
    assert.equal(profile?.full_name, 'Portable Person');

    const restoredArtifact = await restoredSqlite.queryOne(
      "SELECT managed_path, content_hash FROM source_artifacts WHERE id = 'portable-source';",
    );
    assert.ok(restoredArtifact);
    const expectedRestoredPath = path.join(
      target.dataDirectory,
      'artifacts',
      'sources',
      'portable-source',
      'source.txt',
    );
    assert.equal(
      path.resolve(restoredArtifact.managed_path),
      path.resolve(expectedRestoredPath),
      'restore must rebase managed artifact paths to the new installation root',
    );
    assert.equal(
      await fs.readFile(expectedRestoredPath, 'utf8'),
      'portable career source artifact\n',
    );
    assert.equal(restoredArtifact.content_hash, sha256(artifactBytes));
    assert.equal(
      await applyPendingRestore({
        userDataDirectory: targetUserData,
        dataDirectory: target.dataDirectory,
      }),
      false,
      'restore marker must be consumed exactly once',
    );

    await restored.backend.dispose();

    const corruptBundle = path.join(root, 'corrupt-backup.sojourner-backup');
    await fs.cp(created.summary.bundlePath, corruptBundle, { recursive: true });
    const corruptArtifact = path.join(
      corruptBundle,
      'artifacts',
      'sources',
      'portable-source',
      'source.txt',
    );
    await fs.writeFile(corruptArtifact, 'tampered\n', 'utf8');

    const finalInstall = await initializeInstallation(path.join(root, 'validator-user-data'));
    const validator = new BackupService({
      dataDirectory: finalInstall.dataDirectory,
      userDataDirectory: path.join(root, 'validator-user-data'),
      databasePath: finalInstall.status.databasePath,
      sqliteBinaryPath: finalInstall.status.sqliteBinaryPath,
      appVersion: 'test-1',
    });
    await assert.rejects(
      validator.validateBackup(corruptBundle),
      /integrity verification/i,
      'tampered artifacts must be rejected before restore staging',
    );

    // Web runtimes move directories by copy-then-delete. Simulate an
    // interruption after the staged data was copied into place but while the
    // stage copy was being removed: startup must finish the restore instead of
    // failing on the half-deleted stage forever.
    const validatorUserData = path.join(root, 'validator-user-data');
    await validator.stageRestore(created.summary.bundlePath);
    await finalInstall.backend.dispose();
    const marker = JSON.parse(await fs.readFile(path.join(validatorUserData, 'pending-restore.json'), 'utf8'));
    const stagePath = path.join(validatorUserData, marker.stageDirectory);
    await fs.rm(finalInstall.dataDirectory, { recursive: true, force: true });
    await fs.cp(stagePath, finalInstall.dataDirectory, { recursive: true });
    await fs.rm(path.join(stagePath, 'sojourner.sqlite3'));
    assert.equal(
      await applyPendingRestore({ userDataDirectory: validatorUserData, dataDirectory: finalInstall.dataDirectory }),
      true,
      'an interrupted copy-then-delete swap must complete from verified live data',
    );
    assert.equal(fsSync.existsSync(path.join(validatorUserData, 'pending-restore.json')), false);
    assert.equal(fsSync.existsSync(stagePath), false, 'the half-deleted stage must be removed');
    assert.equal(
      fsSync.existsSync(path.join(finalInstall.dataDirectory, '.sojourner-restore-state.json')),
      false,
    );

    // A damaged stage without a verified swap in place is still refused.
    const refusing = await initializeInstallation(validatorUserData);
    const refusingService = new BackupService({
      dataDirectory: refusing.dataDirectory,
      userDataDirectory: validatorUserData,
      databasePath: refusing.status.databasePath,
      sqliteBinaryPath: refusing.status.sqliteBinaryPath,
      appVersion: 'test-1',
    });
    await refusingService.stageRestore(created.summary.bundlePath);
    await refusing.backend.dispose();
    const refusingMarker = JSON.parse(await fs.readFile(path.join(validatorUserData, 'pending-restore.json'), 'utf8'));
    await fs.writeFile(path.join(validatorUserData, refusingMarker.stageDirectory, 'sojourner.sqlite3'), 'tampered');
    await assert.rejects(
      applyPendingRestore({ userDataDirectory: validatorUserData, dataDirectory: refusing.dataDirectory }),
      /changed after validation/i,
      'a tampered stage must not be applied',
    );

    // LEGACY: a restore staged before the rename (Job Ranger, or Sojourner before
    // 2026-11-02) with its job-ranger marker, stage folder, state file and
    // jobscout.sqlite3 is still applied after the upgrade, and the workspace opens.
    const legacyStageUserData = path.join(root, 'legacy-stage-user-data');
    const legacyStaged = await initializeInstallation(legacyStageUserData);
    await new BackupService({
      dataDirectory: legacyStaged.dataDirectory,
      userDataDirectory: legacyStageUserData,
      databasePath: legacyStaged.status.databasePath,
      sqliteBinaryPath: legacyStaged.status.sqliteBinaryPath,
      appVersion: 'test-1',
    }).stageRestore(created.summary.bundlePath);
    await legacyStaged.backend.dispose();
    const markerPath = path.join(legacyStageUserData, 'pending-restore.json');
    const currentMarker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    const legacyStageName = currentMarker.stageDirectory.replace('.sojourner-restore-stage-', '.job-ranger-restore-stage-');
    const legacyStagePath = path.join(legacyStageUserData, legacyStageName);
    await fs.rename(path.join(legacyStageUserData, currentMarker.stageDirectory), legacyStagePath);
    await fs.rename(path.join(legacyStagePath, 'sojourner.sqlite3'), path.join(legacyStagePath, 'jobscout.sqlite3'));
    const currentState = JSON.parse(await fs.readFile(path.join(legacyStagePath, '.sojourner-restore-state.json'), 'utf8'));
    assert.equal(currentState.databaseFile, 'sojourner.sqlite3');
    const { databaseFile: _databaseFile, ...legacyState } = { ...currentState, format: 'job-ranger-staged-restore' };
    await fs.rm(path.join(legacyStagePath, '.sojourner-restore-state.json'));
    await fs.writeFile(path.join(legacyStagePath, '.job-ranger-restore-state.json'), JSON.stringify(legacyState));
    await fs.writeFile(markerPath, JSON.stringify({ ...currentMarker, format: 'job-ranger-pending-restore', stageDirectory: legacyStageName }));
    assert.equal(
      await applyPendingRestore({ userDataDirectory: legacyStageUserData, dataDirectory: legacyStaged.dataDirectory }),
      true,
      'a restore staged before the rename is applied',
    );
    assert.equal(fsSync.existsSync(path.join(legacyStaged.dataDirectory, '.job-ranger-restore-state.json')), false);
    const afterLegacy = await initializeInstallation(legacyStageUserData);
    assert.equal(path.basename(afterLegacy.status.databasePath), 'jobscout.sqlite3', 'the restored legacy database opens under its name');
    const afterLegacyCareer = new CareerBackend({
      dataDirectory: afterLegacy.dataDirectory,
      databasePath: afterLegacy.status.databasePath,
      sqliteBinaryPath: afterLegacy.status.sqliteBinaryPath,
    });
    await afterLegacyCareer.initialize();
    assert.equal((await afterLegacyCareer.getProfile()).fullName, 'Portable Person');
    await afterLegacy.backend.dispose();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
