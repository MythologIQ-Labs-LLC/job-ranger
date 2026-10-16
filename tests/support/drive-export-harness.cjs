// Shared setup for the Drive export SQLite tests: a real Job Ranger database
// with a resume projection, managed PDF artifacts, and the export service wired
// to the in-process fake Google. No real network.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const { JobScoutBackend } = require("../../electron-runtime/electron/src/backend.cjs");
const { ResumeRepository } = require("../../electron-runtime/electron/src/resume-repository.cjs");
const { SqliteClient, sql } = require("../../electron-runtime/electron/src/sqlite.cjs");
const drive = "../../electron-runtime/electron/src/drive";
const { DriveExportService } = require(`${drive}/drive-export-service.cjs`);
const { DriveTransport } = require(`${drive}/drive-transport.cjs`);
const { GoogleDesktopAuth } = require(`${drive}/google-desktop-auth.cjs`);
const { GoogleTransport } = require(`${drive}/google-transport.cjs`);
const { DriveCredentialStore } = require(`${drive}/drive-credential-store.cjs`);
const { resolveGoogleEndpoints, GOOGLE_DRIVE_FILE_SCOPE } = require(`${drive}/google-config.cjs`);
const { createFakeGoogle } = require("./fake-google-drive.cjs");

const CLIENT = { clientId: "1234567890-abcdef123.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret-value" };
const ACCOUNT_A = { email: "drive-tester@example.test", permissionId: "01234567890123456789" };
const ACCOUNT_B = { email: "second-account@example.test", permissionId: "98765432109876543210" };
const endpoints = resolveGoogleEndpoints({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: "http://127.0.0.1:65001" }, isPackaged: false });
const sessionEncryption = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createDriveHarness(label) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `job-ranger-${label}-`));
  const backend = new JobScoutBackend({
    dataDirectory: tempDir,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error("Drive export tests must not use the job network");
    },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  await backend.dispose();
  const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);
  const repository = new ResumeRepository(sqlite);
  const now = new Date().toISOString();
  await sqlite.exec(sql`
    INSERT INTO resume_projections (id, job_id, context, page_format, status, created_at, updated_at)
    VALUES (${"projection-drive"}, ${null}, ${"private-sector"}, ${"letter"}, ${"finalized"}, ${now}, ${now});
  `);
  const resumeDirectory = path.join(tempDir, "artifacts", "resumes");
  await fs.mkdir(resumeDirectory, { recursive: true });
  let version = 0;
  async function createArtifact() {
    version += 1;
    const bytes = Buffer.from(`%PDF-1.7\n% Job Ranger drive export fixture v${version}\n${"x".repeat(200 + version)}\n%%EOF\n`);
    const managedPath = path.join(resumeDirectory, `projection-drive-v${version}.pdf`);
    await fs.writeFile(managedPath, bytes);
    const artifact = await repository.createArtifact({
      id: `resume-artifact-drive-${version}`,
      projectionId: "projection-drive",
      version,
      format: "pdf",
      managedPath,
      contentHash: sha256(bytes),
      pageCount: 1,
      truthGateResult: null,
      parseabilityResult: JSON.stringify({ passed: true }),
      relevanceReviewResult: null,
      projectionSnapshot: { projection: { contact: { fullName: "Taylor: Example/" } }, statements: [] },
      createdAt: now,
    });
    return { artifact, bytes, managedPath, hash: sha256(bytes) };
  }

  const fake = createFakeGoogle({ clientId: CLIENT.clientId, ...ACCOUNT_A });
  const transport = new GoogleTransport({ fetch: (url, init) => fake.fetch(url, init), allowedOrigins: endpoints.allowedOrigins });
  const store = new DriveCredentialStore(path.join(tempDir, "user-data"), sessionEncryption);
  const auth = new GoogleDesktopAuth({ client: CLIENT, endpoints, transport, store, openExternal: async () => undefined });
  const driveTransport = new DriveTransport({ transport, endpoints, auth, uploadTimeoutMs: 300 });
  const makeService = (overrides = {}) =>
    new DriveExportService({ dataDirectory: tempDir, sqlite, unavailableReason: null, auth, store, drive: driveTransport, ...overrides });
  const service = makeService();
  await service.initialize();

  /** Simulates a completed sign-in as `account` (credential stored, fresh grant at the fake). */
  async function connectAs(account) {
    const refreshToken = `fake-refresh-seeded-${account.permissionId}`;
    fake.state.refreshTokens.set(refreshToken, account.permissionId);
    await store.save({ refreshToken, accountId: account.permissionId, accountEmail: account.email, scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: now });
    auth.invalidateAccessToken();
  }

  return {
    tempDir,
    sqlite,
    sql,
    now,
    fake,
    store,
    auth,
    transport,
    driveTransport,
    service,
    makeService,
    createArtifact,
    connectAs,
    cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
  };
}

async function rejectsWith(assert, promise, code, message) {
  let caught;
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `${message}: got ${error.code} (${error.message})`);
    caught = error;
    return true;
  });
  return caught;
}

module.exports = { createDriveHarness, rejectsWith, sha256, ACCOUNT_A, ACCOUNT_B, CLIENT, endpoints };
