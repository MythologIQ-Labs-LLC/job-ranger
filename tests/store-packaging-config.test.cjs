// Microsoft Store packaging + Store-mode runtime tests that run on any OS.
// (Building and installing the AppX itself runs on Windows in
// .github/workflows/windows-store-package.yml.)
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const { resolveStoreIdentity, VALIDATION_IDENTITY } = require('../scripts/store-identity.cjs');
const distribution = require('../electron-runtime/electron/src/distribution.cjs');
const { JobScoutBackend } = require('../electron-runtime/electron/src/backend.cjs');
const { SqliteClient } = require('../electron-runtime/electron/src/sqlite.cjs');
const { FEATURE_MIGRATIONS } = require('../electron-runtime/electron/src/feature-migrations.cjs');

const storeEnv = {
  JOB_RANGER_STORE_IDENTITY_NAME: '12345JobRanger.JobRanger',
  JOB_RANGER_STORE_PUBLISHER: 'CN=11111111-2222-3333-4444-555555555555',
  JOB_RANGER_STORE_PUBLISHER_DISPLAY_NAME: 'Job Ranger',
};

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `${file} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function loadStoreConfig(env) {
  const script = "process.stdout.write(JSON.stringify(require('./electron-builder.store.cjs')))";
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('JOB_RANGER_STORE_') && key !== 'JOB_RANGER_REQUIRE_STORE_IDENTITY'));
  return spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...clean, ...env }, encoding: 'utf8' });
}

async function run() {
  // --- Package identity is configuration, never source ---
  assert.deepEqual(resolveStoreIdentity({}), { ...VALIDATION_IDENTITY, kind: 'validation' });
  assert.throws(() => resolveStoreIdentity({ JOB_RANGER_REQUIRE_STORE_IDENTITY: '1' }), /requires the Partner Center identity/);
  assert.throws(() => resolveStoreIdentity({ JOB_RANGER_STORE_IDENTITY_NAME: 'x.y.z' }), /partially configured/);
  assert.throws(() => resolveStoreIdentity({ ...storeEnv, JOB_RANGER_STORE_PUBLISHER: 'Job Ranger' }), /CN=/);
  assert.throws(() => resolveStoreIdentity({ ...storeEnv, JOB_RANGER_STORE_IDENTITY_NAME: 'bad name!' }), /3-50 characters/);
  const store = resolveStoreIdentity({ ...storeEnv, JOB_RANGER_REQUIRE_STORE_IDENTITY: '1' });
  assert.equal(store.kind, 'store');
  assert.equal(store.displayName, 'Job Ranger');
  const source = fs.readFileSync(path.join(repoRoot, 'electron-builder.store.cjs'), 'utf8');
  assert.doesNotMatch(source, /CN=[0-9A-F]{8}-/i, 'no Partner Center publisher hard-coded in source');

  // --- Configs pass electron-builder's own schema validation ---
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
  const { DebugLogger } = require('builder-util');
  for (const env of [{}, storeEnv]) {
    const loaded = loadStoreConfig(env);
    assert.equal(loaded.status, 0, loaded.stderr);
    const config = JSON.parse(loaded.stdout);
    await validateConfiguration(config, new DebugLogger(false));
    assert.deepEqual(config.win.target, [{ target: 'appx', arch: ['x64'] }]);
    assert.equal(config.win.azureSignOptions, undefined, 'Store packages are signed by Microsoft, not Azure Artifact Signing');
    assert.match(config.win.artifactName, env === storeEnv ? /windows-store-\$/ : /windows-store-validation-/);
  }
  const nsis = require('../electron-builder.windows.cjs');
  assert.equal(nsis.win.target[0].target, 'nsis', 'historical direct-download build is unchanged');

  // --- Rendered AppxManifest: narrow capabilities, no extensions, canonical tiles ---
  const config = JSON.parse(loadStoreConfig({}).stdout);
  const AppXTarget = require('app-builder-lib/out/targets/AppxTarget').default;
  const { Arch } = require('builder-util');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const target = Object.create(AppXTarget.prototype);
  target.options = { ...config.win, ...config.appx };
  target.packager = {
    appInfo: {
      productFilename: 'Job Ranger',
      productName: config.productName,
      description: pkg.description,
      companyName: pkg.author,
      name: pkg.name,
      getVersionInWeirdWindowsForm: () => `${pkg.version}.0`,
    },
    getResource: async (name) => (name ? path.join(repoRoot, 'build', name) : null),
    config,
    platformSpecificBuildOptions: config.win,
    info: { metadata: { dependencies: pkg.dependencies ?? {} }, appDir: repoRoot },
  };
  const manifestPath = path.join(os.tmpdir(), `job-ranger-appx-${process.pid}.xml`);
  await target.writeManifest(manifestPath, Arch.x64, config.appx.publisher, fs.readdirSync(path.join(repoRoot, 'build', 'appx')));
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  fs.rmSync(manifestPath);
  const capabilities = Array.from(manifest.matchAll(/<(?:\w+:)?Capability\b[^>]*Name="([^"]+)"/g), (match) => match[1]).sort();
  assert.deepEqual(capabilities, ['internetClient', 'runFullTrust']);
  assert.doesNotMatch(manifest, /<Extensions>|startupTask|windows\.protocol|fileTypeAssociation/);
  assert.match(manifest, /EntryPoint="Windows\.FullTrustApplication"/);
  assert.match(manifest, /Executable="app\\Job Ranger\.exe"/);
  assert.match(manifest, new RegExp(`Version="${pkg.version.replace(/\./g, '\\.')}\\.0"`));
  assert.match(manifest, /MinVersion="10\.0\.17763\.0"/);
  assert.match(manifest, /Square310x310Logo="assets\\LargeTile\.png"/);
  assert.match(manifest, /<DisplayName>Job Ranger \(validation\)<\/DisplayName>/);
  assert.match(manifest, /Publisher='CN=Job Ranger Package Validation'/);

  // --- Canonical-derived assets with Store/PWA-required dimensions ---
  const expectedAssets = {
    'build/appx/StoreLogo.png': [50, 50],
    'build/appx/Square44x44Logo.png': [44, 44],
    'build/appx/SmallTile.png': [71, 71],
    'build/appx/Square150x150Logo.png': [150, 150],
    'build/appx/LargeTile.png': [310, 310],
    'build/appx/Wide310x150Logo.png': [310, 150],
    'public/pwa/icon-192.png': [192, 192],
    'public/pwa/icon-512.png': [512, 512],
    'public/pwa/icon-maskable-512.png': [512, 512],
    'public/pwa/apple-touch-icon.png': [180, 180],
  };
  for (const [file, size] of Object.entries(expectedAssets)) {
    assert.deepEqual(pngSize(path.join(repoRoot, file)), size, file);
  }

  // --- Store builds never fight Store servicing: no app-managed updater ---
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const updater of ['electron-updater', 'update-electron-app', 'electron-squirrel-startup']) {
    assert.equal(allDeps[updater], undefined, `${updater} must not be added without a Store-aware design`);
  }
  for (const file of fs.readdirSync(path.join(repoRoot, 'electron', 'src')).filter((name) => name.endsWith('.cts'))) {
    const text = fs.readFileSync(path.join(repoRoot, 'electron', 'src', file), 'utf8');
    assert.doesNotMatch(text, /autoUpdater|electron-updater/, `${file} must not start an app-managed updater`);
  }

  // --- Store-mode path handling (AppX file-system virtualization) ---
  const execPath = 'C:\\Program Files\\WindowsApps\\12345JobRanger.JobRanger_1.3.0.0_x64__8wekyb3d8bbwe\\app\\Job Ranger.exe';
  assert.equal(distribution.packageFamilyNameFromExecPath(execPath), '12345JobRanger.JobRanger_8wekyb3d8bbwe');
  assert.equal(distribution.packageFamilyNameFromExecPath('C:\\Users\\a\\AppData\\Local\\Programs\\Job Ranger\\Job Ranger.exe'), null);
  assert.equal(
    distribution.storeHostPath('C:\\Users\\a\\AppData\\Roaming\\Job Ranger Store\\data\\artifacts\\resumes\\r.pdf', {
      appDataDirectory: 'C:\\Users\\a\\AppData\\Roaming',
      localAppDataDirectory: 'C:\\Users\\a\\AppData\\Local',
      packageFamilyName: '12345JobRanger.JobRanger_8wekyb3d8bbwe',
    }),
    'C:\\Users\\a\\AppData\\Local\\Packages\\12345JobRanger.JobRanger_8wekyb3d8bbwe\\LocalCache\\Roaming\\Job Ranger Store\\data\\artifacts\\resumes\\r.pdf',
  );
  assert.equal(
    distribution.storeHostPath('D:\\exports\\backup.jobranger', {
      appDataDirectory: 'C:\\Users\\a\\AppData\\Roaming',
      localAppDataDirectory: 'C:\\Users\\a\\AppData\\Local',
      packageFamilyName: 'x_y',
    }),
    'D:\\exports\\backup.jobranger',
  );
  const info = distribution.electronRuntimeInfo({
    channel: 'microsoft-store',
    appVersion: '1.3.0',
    platform: 'win32',
    userDataDirectory: 'C:\\x',
    sqliteBinaryPath: 'C:\\x\\sqlite3.exe',
  });
  assert.equal(info.capabilities.appManagedUpdates, false);
  assert.ok(info.storage.warnings.some((warning) => /Uninstalling the Store app removes that data/.test(warning)));

  // --- Schema downgrade guard + feature-migration registry ---
  for (const file of fs.readdirSync(path.join(repoRoot, 'electron', 'src')).filter((name) => name.endsWith('.cts'))) {
    const text = fs.readFileSync(path.join(repoRoot, 'electron', 'src', file), 'utf8');
    assert.doesNotMatch(text, /_MIGRATION_VERSION\s*=\s*\d+/, `${file} must take its migration version from feature-migrations.cts`);
  }
  assert.deepEqual(Object.values(FEATURE_MIGRATIONS).map((item) => item.version), [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'job-ranger-downgrade-'));
  try {
    const backend = new JobScoutBackend({ dataDirectory: root, schedulerEnabled: false });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    await backend.dispose();
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
    await sqlite.exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1001, 'application_lifecycle_foundation', '2026-01-01');");
    const reopened = new JobScoutBackend({ dataDirectory: root, schedulerEnabled: false });
    await reopened.initialize();
    await reopened.dispose();
    await sqlite.exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (4242, 'future', '2027-01-01');");
    const newer = new JobScoutBackend({ dataDirectory: root, schedulerEnabled: false });
    await assert.rejects(newer.initialize(), /upgraded by a newer version \(database schema 4242\)/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }

  console.log('Store packaging and Store-mode runtime tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
