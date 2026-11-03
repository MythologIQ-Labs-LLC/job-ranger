// Portable `.sojourner` archive + Store legacy-install import smoke test.
// Runs on the Electron sqlite3 CLI engine (npm test) and on the web runtime's
// SQLite WASM engine (tests/run-wasm-engine-parity.mjs).
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SojournerBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { CareerBackend } = require('../electron-runtime/electron/src/career-backend.cjs');
const { BackupService, applyPendingRestore } = require('../electron-runtime/electron/src/backup-service.cjs');
const archive = require('../electron-runtime/electron/src/portable-archive.cjs');
const legacy = require('../electron-runtime/electron/src/legacy-install-ipc.cjs');
const distribution = require('../electron-runtime/electron/src/distribution.cjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function openInstallation(userDataDirectory) {
  const dataDirectory = path.join(userDataDirectory, 'data');
  const backend = new SojournerBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => { throw new Error('archive smoke test must not use the network'); },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const career = new CareerBackend({
    dataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await career.initialize();
  const backups = new BackupService({
    dataDirectory,
    userDataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
    appVersion: 'test-2',
  });
  return { backend, career, backups, dataDirectory, status };
}

const profile = (fullName) => ({
  version: 2,
  fullName,
  homeLocation: 'Tacoma, WA',
  radiusMiles: 20,
  minimumPay: 60000,
  payBasis: 'annual',
  targetTitles: ['Logistics Coordinator'],
  skills: ['Inventory control'],
  certifications: [],
  sectors: ['Logistics'],
  onCallPreference: 'either',
  fullTimeOnly: true,
});

async function seed(installation, fullName) {
  await installation.career.saveProfile(profile(fullName));
  await installation.career.createUserEvidence({
    subjectType: 'role',
    organization: 'Puget Sound Freight',
    titleOrName: 'Warehouse Lead',
    startDate: '2021-03',
    endDate: null,
    statement: 'Led inventory cycle counts and inbound freight scheduling for a regional warehouse.',
    skills: ['Inventory control', 'Freight scheduling'],
    methodsOrTools: [],
    scope: [],
    outcomes: [],
    metrics: [],
    credential: null,
  });
  return installation.career.importPastedText({
    label: 'Warehouse background',
    text: 'Warehouse Lead, Puget Sound Freight\nLed inventory cycle counts and inbound freight scheduling.',
  });
}

async function expectRejects(promiseFactory, pattern, label) {
  await assert.rejects(promiseFactory, (error) => {
    assert.match(error.message, pattern, `${label}: ${error.message}`);
    return true;
  });
}

function rewriteEntries(bytes, mutate) {
  const entries = archive.decodeStoreZip(bytes).map((entry) => ({ name: entry.name, bytes: new Uint8Array(entry.bytes) }));
  return archive.encodeStoreZip(mutate(entries));
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sojourner-archive-'));
  try {
    // --- Archive round trip (Electron → web semantics, any runtime pair) ---
    const sourceUserData = path.join(root, 'source');
    const source = await openInstallation(sourceUserData);
    const imported = await seed(source, 'Archive Person');
    const artifactHash = imported.artifact.contentHash;

    const archivePath = path.join(root, 'exports', 'career.sojourner');
    const created = await source.backups.createArchive(archivePath, {
      runtime: 'web',
      channel: 'web',
      appVersion: 'test-2',
      buildId: 'pwa-test-build',
    });
    const archiveBytes = await fs.readFile(archivePath);
    assert.equal(created.archive.sha256, sha256(archiveBytes));
    assert.equal(created.archive.bytes, archiveBytes.length);
    assert.equal(created.summary.artifactFileCount, 1);
    const leftovers = (await fs.readdir(sourceUserData)).filter((name) => name.startsWith('.sojourner-archive-work-'));
    assert.deepEqual(leftovers, [], 'archive work directories are removed');
    await source.backend.dispose();

    const entries = archive.decodeStoreZip(archiveBytes);
    assert.equal(entries[0].name, 'sojourner-archive.json');
    assert.ok(entries.some((entry) => entry.name === 'manifest.json'));
    assert.ok(entries.some((entry) => entry.name === 'sojourner.sqlite3'));

    // Deterministic container: identical content yields identical bytes.
    const again = archive.encodeStoreZip(entries.map((entry) => ({ name: entry.name, bytes: entry.bytes })));
    assert.equal(sha256(again), sha256(archiveBytes));

    const targetUserData = path.join(root, 'target');
    const target = await openInstallation(targetUserData);
    await target.career.saveProfile(profile('Replace Me'));
    const selection = await target.backups.validateRestoreSource(archivePath);
    assert.equal(selection.archive.producer.runtime, 'web');
    assert.ok(selection.warnings.some((warning) => warning.includes('web app')));
    await target.backups.stageRestore(selection.bundlePath);
    await assert.rejects(fs.access(selection.bundlePath), 'extracted archive work directory removed after staging');
    await target.backend.dispose();
    assert.equal(
      await applyPendingRestore({ userDataDirectory: targetUserData, dataDirectory: target.dataDirectory }),
      true,
    );

    const restored = await openInstallation(targetUserData);
    assert.equal((await restored.career.getProfile()).fullName, 'Archive Person');
    const evidence = await restored.career.listEvidence();
    assert.ok(evidence.some((item) => item.evidence.titleOrName === 'Warehouse Lead'));
    const artifacts = await restored.career.listSourceArtifacts();
    const restoredArtifact = artifacts.find((item) => item.contentHash === artifactHash);
    assert.ok(restoredArtifact, 'source artifact provenance survives the archive');
    assert.ok(restoredArtifact.managedPath.startsWith(restored.dataDirectory), 'managed path rebased');
    assert.equal(sha256(await fs.readFile(restoredArtifact.managedPath)), artifactHash);

    // --- Older directory bundles remain restorable via their manifest.json ---
    const bundleParent = path.join(root, 'bundles');
    await fs.mkdir(bundleParent, { recursive: true });
    const directoryBundle = await restored.backups.createBackup(bundleParent);
    const directorySelection = await restored.backups.validateRestoreSource(
      path.join(directoryBundle.summary.bundlePath, 'manifest.json'),
    );
    assert.equal(directorySelection.archive, undefined);
    assert.equal(directorySelection.summary.artifactFileCount, 1);

    // --- LEGACY .jobranger archives (Job Ranger, and Sojourner before the rename) still restore ---
    assert.equal(archive.isArchiveFileName('backup.sojourner'), true);
    assert.equal(archive.isArchiveFileName('BACKUP.JOBRANGER'), true);
    assert.equal(archive.isArchiveFileName('backup.zip'), false);
    let legacyBackupManifestBytes = null;
    const legacyEntries = (items) => {
      const out = items.map((entry) => {
        if (entry.name === 'manifest.json') {
          const manifest = JSON.parse(Buffer.from(entry.bytes).toString('utf8'));
          assert.equal(manifest.format, 'sojourner-backup');
          manifest.format = 'job-ranger-backup';
          manifest.database.path = 'jobscout.sqlite3';
          legacyBackupManifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
          return { name: 'manifest.json', bytes: legacyBackupManifestBytes };
        }
        if (entry.name === 'sojourner.sqlite3') return { name: 'jobscout.sqlite3', bytes: entry.bytes };
        return entry;
      });
      return out.map((entry) => {
        if (entry.name !== 'sojourner-archive.json') return entry;
        const manifest = JSON.parse(Buffer.from(entry.bytes).toString('utf8'));
        assert.equal(manifest.format, 'sojourner-portable-archive');
        manifest.format = 'job-ranger-portable-archive';
        manifest.content.format = 'job-ranger-backup';
        manifest.backupManifest.sha256 = sha256(legacyBackupManifestBytes);
        manifest.backupManifest.bytes = legacyBackupManifestBytes.length;
        return { name: 'job-ranger-archive.json', bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
      });
    };
    const legacyArchivePath = path.join(root, 'exports', 'older.jobranger');
    await fs.writeFile(legacyArchivePath, rewriteEntries(archiveBytes, legacyEntries));
    const legacyTargetUserData = path.join(root, 'legacy-target');
    const legacyTarget = await openInstallation(legacyTargetUserData);
    const legacySelection = await legacyTarget.backups.validateRestoreSource(legacyArchivePath);
    assert.equal(legacySelection.archive.format, 'sojourner-portable-archive', 'legacy archive manifests are normalized');
    assert.equal(legacySelection.manifest.database.path, 'jobscout.sqlite3');
    await legacyTarget.backups.stageRestore(legacySelection.bundlePath);
    await legacyTarget.backend.dispose();
    assert.equal(await applyPendingRestore({ userDataDirectory: legacyTargetUserData, dataDirectory: legacyTarget.dataDirectory }), true);
    const legacyRestored = await openInstallation(legacyTargetUserData);
    assert.equal((await legacyRestored.career.getProfile()).fullName, 'Archive Person');
    assert.equal(path.basename(legacyRestored.status.databasePath), 'sojourner.sqlite3', 'a restored legacy backup opens under the current name');
    await legacyRestored.backend.dispose();

    // --- Hostile / corrupted / unsupported archives fail closed ---
    const writeVariant = async (name, bytes) => {
      const variantPath = path.join(root, 'variants', name);
      await fs.mkdir(path.dirname(variantPath), { recursive: true });
      await fs.writeFile(variantPath, bytes);
      return variantPath;
    };
    const flipped = Buffer.from(archiveBytes);
    const databaseEntry = entries.find((entry) => entry.name === 'sojourner.sqlite3');
    const databaseOffset = archiveBytes.indexOf(Buffer.from(databaseEntry.bytes.subarray(0, 64)));
    flipped[databaseOffset + 200] ^= 0xff;
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('crc.sojourner', flipped)),
      /CRC-32/,
      'bit flip',
    );
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('not-zip.sojourner', Buffer.from('hello'))),
      /not a Sojourner archive/,
      'not an archive',
    );
    assert.throws(
      () => archive.encodeStoreZip([{ name: '../escape.txt', bytes: new Uint8Array([1]) }]),
      /unsafe path/,
    );
    for (const aliased of ['manifest.json.', 'manifest.json ', 'manifest.json:stream', 'artifacts/CON.txt', 'artifacts/nul', 'a\u0001b']) {
      assert.throws(
        () => archive.encodeStoreZip([{ name: aliased, bytes: new Uint8Array([1]) }]),
        /unsafe path/,
        `file-system alias ${JSON.stringify(aliased)} must be rejected`,
      );
    }
    assert.throws(
      () =>
        archive.encodeStoreZip([
          { name: 'manifest.json', bytes: new Uint8Array([1]) },
          { name: 'MANIFEST.JSON', bytes: new Uint8Array([2]) },
        ]),
      /repeats/,
      'names that collide on case-insensitive file systems must be rejected',
    );
    const traversal = Buffer.from(rewriteEntries(archiveBytes, (items) => [...items, { name: 'artifacts/x.txt', bytes: new Uint8Array([1]) }]));
    const traversalName = Buffer.from('artifacts/x.txt');
    for (let index = traversal.indexOf(traversalName); index >= 0; index = traversal.indexOf(traversalName, index + 1)) {
      Buffer.from('../../../x.txt').copy(traversal, index);
    }
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('traversal.sojourner', traversal)),
      /unsafe path/,
      'path traversal',
    );
    const newer = rewriteEntries(archiveBytes, (items) =>
      items.map((entry) => {
        if (entry.name !== 'sojourner-archive.json') return entry;
        const manifest = JSON.parse(Buffer.from(entry.bytes).toString('utf8'));
        manifest.archiveVersion = 99;
        return { name: entry.name, bytes: Buffer.from(JSON.stringify(manifest)) };
      }),
    );
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('newer.sojourner', newer)),
      /newer Sojourner/,
      'newer archive',
    );
    const tamperedManifest = rewriteEntries(archiveBytes, (items) =>
      items.map((entry) => {
        if (entry.name !== 'manifest.json') return entry;
        const manifest = JSON.parse(Buffer.from(entry.bytes).toString('utf8'));
        manifest.appVersion = 'tampered';
        return { name: entry.name, bytes: Buffer.from(JSON.stringify(manifest)) };
      }),
    );
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('manifest.sojourner', tamperedManifest)),
      /integrity/,
      'tampered backup manifest',
    );
    const tamperedDatabase = rewriteEntries(archiveBytes, (items) =>
      items.map((entry) => {
        if (entry.name !== 'sojourner.sqlite3') return entry;
        const bytes = new Uint8Array(entry.bytes);
        bytes[bytes.length - 1] ^= 0x01;
        return { name: entry.name, bytes };
      }),
    );
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('database.sojourner', tamperedDatabase)),
      /integrity verification/,
      'tampered database with valid CRC',
    );
    const recompressed = Buffer.from(archiveBytes);
    const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const centralOffset = recompressed.indexOf(centralSignature);
    recompressed.writeUInt16LE(8, centralOffset + 10);
    await expectRejects(
      async () => restored.backups.validateRestoreSource(await writeVariant('deflate.sojourner', recompressed)),
      /re-compressed/,
      'compressed entry',
    );
    const workLeftovers = (await fs.readdir(targetUserData)).filter((name) => name.startsWith('.sojourner-archive-work-'));
    assert.deepEqual(workLeftovers, [], 'failed archive validations leave no extracted data behind');
    await restored.backend.dispose();

    // --- Microsoft Store coexistence: explicit, read-only legacy import ---
    const appData = path.join(root, 'AppData', 'Roaming');
    const legacyUserData = distribution.resolveLegacyDirectUserDataDirectory(appData);
    const storeUserData = distribution.resolveStoreUserDataDirectory(appData);
    assert.notEqual(legacyUserData, storeUserData, 'Store data root is isolated from NSIS data root');
    const legacyInstall = await openInstallation(legacyUserData);
    await seed(legacyInstall, 'Legacy Desktop Person');
    await legacyInstall.backend.dispose();
    // The LEGACY folder (%APPDATA%\job-ranger) holds the database under its LEGACY name.
    const legacyDatabase = path.join(legacyUserData, 'data', 'jobscout.sqlite3');
    await fs.rename(path.join(legacyUserData, 'data', 'sojourner.sqlite3'), legacyDatabase);
    const legacyHashBefore = sha256(await fs.readFile(legacyDatabase));

    const store = await openInstallation(storeUserData);
    await store.backend.dispose();
    assert.equal(path.basename(store.status.databasePath), 'sojourner.sqlite3');
    const options = {
      channel: 'microsoft-store',
      appDataDirectory: appData,
      userDataDirectory: storeUserData,
      dataDirectory: store.dataDirectory,
      databasePath: store.status.databasePath,
      sqliteBinaryPath: store.status.sqliteBinaryPath,
      appVersion: 'test-2',
    };
    const notStore = await legacy.detectLegacyInstall({ ...options, channel: 'direct-download' });
    assert.equal(notStore.applicable, false, 'legacy import only applies to Store installs');
    const detected = await legacy.detectLegacyInstall(options);
    assert.equal(detected.found, true);
    assert.ok(detected.databaseBytes > 0);
    await legacy.stageLegacyImport(options);
    assert.equal(
      await applyPendingRestore({ userDataDirectory: storeUserData, dataDirectory: store.dataDirectory }),
      true,
    );
    const migratedStore = await openInstallation(storeUserData);
    assert.equal((await migratedStore.career.getProfile()).fullName, 'Legacy Desktop Person');
    const migratedArtifacts = await migratedStore.career.listSourceArtifacts();
    assert.ok(migratedArtifacts.every((item) => item.managedPath.startsWith(migratedStore.dataDirectory)));
    await migratedStore.backend.dispose();
    assert.equal(sha256(await fs.readFile(legacyDatabase)), legacyHashBefore, 'legacy data is never modified');

    // A migrated direct-download folder (%APPDATA%\Sojourner) is preferred over the legacy one.
    const directUserData = distribution.resolveDirectUserDataDirectory(appData);
    const directInstall = await openInstallation(directUserData);
    await seed(directInstall, 'Current Desktop Person');
    await directInstall.backend.dispose();
    const preferred = await legacy.detectLegacyInstall(options);
    assert.equal(preferred.dataDirectory, path.join(directUserData, 'data'));
    await legacy.stageLegacyImport(options);
    assert.equal(
      await applyPendingRestore({ userDataDirectory: storeUserData, dataDirectory: store.dataDirectory }),
      true,
    );
    const currentStore = await openInstallation(storeUserData);
    assert.equal((await currentStore.career.getProfile()).fullName, 'Current Desktop Person');
    await currentStore.backend.dispose();

    assert.equal(
      distribution.detectDistributionChannel({ windowsStore: true, isPackaged: true, env: {} }),
      'microsoft-store',
    );
    assert.equal(
      distribution.detectDistributionChannel({ windowsStore: undefined, isPackaged: true, env: { SOJOURNER_DISTRIBUTION_CHANNEL_OVERRIDE: 'microsoft-store' } }),
      'direct-download',
      'packaged direct builds cannot be relabeled as Store builds',
    );

    console.log('Portable archive and Store legacy-import smoke passed!');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
