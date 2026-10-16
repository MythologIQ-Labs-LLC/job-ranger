// Desktop Google OAuth for Drive export (#314): PKCE, loopback receiver,
// scope enforcement, credential custody, refresh/revocation, egress allowlist
// and client configuration. Uses an in-process fake Google; no real network.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const runtime = "../electron-runtime/electron/src/drive";
const { pkceChallenge, createPkcePair, constantTimeEqual, startLoopbackReceiver } = require(`${runtime}/google-loopback.cjs`);
const { GoogleDesktopAuth, buildAuthorizationUrl } = require(`${runtime}/google-desktop-auth.cjs`);
const { GoogleTransport } = require(`${runtime}/google-transport.cjs`);
const { DriveCredentialStore, DRIVE_CREDENTIAL_FILE } = require(`${runtime}/drive-credential-store.cjs`);
const {
  GOOGLE_DRIVE_FILE_SCOPE,
  resolveGoogleClientConfig,
  resolveGoogleEndpoints,
  resolveTestTimeoutMs,
} = require(`${runtime}/google-config.cjs`);
const { classifyGoogleResponse } = require(`${runtime}/drive-errors.cjs`);
const { createFakeGoogle } = require("./support/fake-google-drive.cjs");

const CLIENT = { clientId: "1234567890-abcdef123.apps.googleusercontent.com", clientSecret: "GOCSPX-test-secret-value" };
const TEST_BASE = "http://127.0.0.1:65000";

/** Reversible stand-in for safeStorage (the real one is OS-backed). */
function fakeEncryption(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text, "utf8").toString("base64")}`),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("not encrypted by this fake");
      return Buffer.from(text.slice(4), "base64").toString("utf8");
    },
  };
}

function endpoints() {
  return resolveGoogleEndpoints({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: TEST_BASE }, isPackaged: false });
}

async function harness(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-drive-auth-"));
  const fake = createFakeGoogle({ clientId: CLIENT.clientId, ...options.fake });
  const store = new DriveCredentialStore(directory, fakeEncryption(options.encryption ?? true));
  const transport = new GoogleTransport({ fetch: (url, init) => fake.fetch(url.replace(TEST_BASE, "http://fake.test"), init), allowedOrigins: endpoints().allowedOrigins });
  const opened = [];
  // Plays the system browser: asks the fake authorize endpoint, then follows its redirect to the loopback.
  const browser = async (url) => {
    opened.push(url);
    if (options.browser) return options.browser(url);
    const result = fake.handle("GET", url.replace(TEST_BASE, "http://fake.test"), {}, Buffer.alloc(0));
    await fetch(result.headers.Location);
  };
  const auth = new GoogleDesktopAuth({
    client: options.client === undefined ? CLIENT : options.client,
    endpoints: endpoints(),
    transport,
    store,
    openExternal: browser,
    authorizationTimeoutMs: options.timeoutMs,
  });
  return { directory, fake, store, auth, opened, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}

async function testPkceAndState() {
  // RFC 7636 Appendix B vector.
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const pair = createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(pair.challenge, pkceChallenge(pair.verifier));
  assert.notEqual(createPkcePair().verifier, pair.verifier);
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);

  const url = new URL(buildAuthorizationUrl({
    endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: CLIENT.clientId,
    redirectUri: "http://127.0.0.1:5555",
    codeChallenge: pair.challenge,
    state: "state-value",
    promptConsent: true,
  }));
  assert.equal(url.searchParams.get("scope"), GOOGLE_DRIVE_FILE_SCOPE, "only drive.file is requested");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.has("include_granted_scopes"), false);
}

async function testLoopbackReceiver() {
  const receiver = await startLoopbackReceiver("expected-state", 10_000);
  assert.match(receiver.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  const other = await fetch(`${receiver.redirectUri}/favicon.ico`);
  assert.equal(other.status, 404, "only the exact callback path is served");
  const post = await fetch(`${receiver.redirectUri}/?state=expected-state&code=x`, { method: "POST" });
  assert.equal(post.status, 405, "only GET is accepted");
  const empty = await fetch(`${receiver.redirectUri}/`);
  assert.equal(empty.status, 400, "a stray request does not end the flow");
  const noState = await fetch(`${receiver.redirectUri}/?code=injected`);
  assert.equal(noState.status, 400, "a callback without state is refused without ending the flow");
  const noStateError = await fetch(`${receiver.redirectUri}/?error=access_denied`);
  assert.equal(noStateError.status, 400);
  const favicon = await fetch(`${receiver.redirectUri}/favicon.ico`);
  assert.equal(favicon.status, 404);
  const ok = await fetch(`${receiver.redirectUri}/?state=expected-state&code=the-code&scope=x&reflect=%3Cscript%3E`);
  assert.equal(ok.status, 200);
  const page = await ok.text();
  assert.match(page, /You can close this tab and return to Job Ranger/);
  assert.doesNotMatch(page, /the-code|script|reflect/, "no query parameter is reflected");
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(await receiver.code, "the-code");
  // Replay after completion: the receiver is closed, so the code cannot be delivered twice.
  await assert.rejects(() => fetch(`${receiver.redirectUri}/?state=expected-state&code=again`), "server closes after the callback");

  const serverError = await startLoopbackReceiver("s", 10_000);
  await fetch(`${serverError.redirectUri}/?state=s&error=server_error`);
  await assert.rejects(serverError.code, (error) => error.code === "auth_failed");
  const missingCode = await startLoopbackReceiver("s", 10_000);
  assert.equal((await fetch(`${missingCode.redirectUri}/?state=s`)).status, 400);
  await assert.rejects(missingCode.code, (error) => error.code === "auth_failed");

  const mismatch = await startLoopbackReceiver("expected-state", 10_000);
  const bad = await fetch(`${mismatch.redirectUri}/?state=attacker-state&code=stolen`);
  assert.equal(bad.status, 400);
  await assert.rejects(mismatch.code, (error) => error.code === "auth_failed");

  const denied = await startLoopbackReceiver("s", 10_000);
  await fetch(`${denied.redirectUri}/?state=s&error=access_denied`);
  await assert.rejects(denied.code, (error) => error.code === "auth_cancelled");

  const slow = await startLoopbackReceiver("s", 150);
  await assert.rejects(slow.code, (error) => error.code === "timeout");
  await assert.rejects(() => fetch(`${slow.redirectUri}/?state=s&code=late`), "timed-out receiver is closed");

  const cancelled = await startLoopbackReceiver("s", 10_000);
  cancelled.cancel();
  await assert.rejects(cancelled.code, (error) => error.code === "auth_cancelled");
}

async function testConnectFlow() {
  const h = await harness();
  try {
    assert.equal(await h.auth.isConnected(), false);
    await h.auth.connect();
    const authorizeParams = h.fake.state.faults.lastAuthorizeParams;
    assert.equal(authorizeParams.scope, GOOGLE_DRIVE_FILE_SCOPE);
    assert.equal(authorizeParams.prompt, "consent", "first connection asks for consent so a refresh token is issued");
    assert.equal(h.fake.state.counts.tokenExchanges, 1, "PKCE verifier matched the challenge");
    assert.equal(await h.auth.isConnected(), true);
    assert.equal(await h.auth.accountEmail(), "drive-tester@example.test");
    assert.equal(h.store.storage(), "encrypted");
    const raw = await fs.readFile(path.join(h.directory, DRIVE_CREDENTIAL_FILE));
    assert.doesNotMatch(raw.toString("utf8"), /fake-refresh/, "refresh token is not written in plain text");
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(path.join(h.directory, DRIVE_CREDENTIAL_FILE))).mode & 0o777, 0o600);
    }

    // A fresh store (app restart) decrypts the credential and refreshes for an access token.
    const restarted = new GoogleDesktopAuth({ client: CLIENT, endpoints: endpoints(), transport: new GoogleTransport({ fetch: (url, init) => h.fake.fetch(url.replace(TEST_BASE, "http://fake.test"), init), allowedOrigins: endpoints().allowedOrigins }), store: new DriveCredentialStore(h.directory, fakeEncryption()), openExternal: async () => undefined });
    assert.match(await restarted.getAccessToken(), /^fake-access-/);
    assert.equal(h.fake.state.counts.refreshes, 1);

    // Reconnecting while a refresh token is stored does not force the consent prompt.
    await h.auth.connect();
    assert.equal(h.fake.state.faults.lastAuthorizeParams.prompt, undefined);

    // Disconnect revokes at Google and deletes the stored credential.
    const { revoked } = await h.auth.disconnect();
    assert.equal(revoked, true);
    assert.equal(h.fake.state.revoked.length, 1);
    assert.match(h.fake.state.revoked[0], /^fake-refresh-/);
    await assert.rejects(() => fs.access(path.join(h.directory, DRIVE_CREDENTIAL_FILE)));
    assert.equal(await h.auth.isConnected(), false);
    await assert.rejects(() => h.auth.getAccessToken(), (error) => error.code === "not_connected");

    // Re-authentication after disconnect asks for consent again and stores a new credential.
    await h.auth.connect();
    assert.equal(h.fake.state.faults.lastAuthorizeParams.prompt, "consent");
    assert.equal(await h.auth.isConnected(), true);
  } finally {
    await h.cleanup();
  }
}

async function testOneFlowAtATimeAndCancel() {
  let release;
  const h = await harness({ browser: () => new Promise((resolve) => { release = resolve; }) });
  try {
    const first = h.auth.connect();
    first.catch(() => undefined);
    while (!h.auth.connecting) await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(() => h.auth.connect(), (error) => error.code === "auth_in_progress");
    h.auth.cancelConnect();
    release();
    await assert.rejects(first, (error) => error.code === "auth_cancelled");
    assert.equal(h.auth.connecting, false);
    assert.equal(await h.auth.isConnected(), false);
  } finally {
    await h.cleanup();
  }

  const timeout = await harness({ timeoutMs: 100, browser: async () => undefined });
  try {
    await assert.rejects(() => timeout.auth.connect(), (error) => error.code === "timeout");
    assert.equal(timeout.auth.connecting, false);
  } finally {
    await timeout.cleanup();
  }

  const denied = await harness({ fake: {} });
  denied.fake.state.faults.denyAuthorization = true;
  try {
    await assert.rejects(() => denied.auth.connect(), (error) => error.code === "auth_cancelled");
    assert.equal(denied.fake.state.counts.tokenExchanges, 0);
  } finally {
    await denied.cleanup();
  }
}

async function testTokenExchangeFailures() {
  const cases = [
    ["PKCE verifier does not match the challenge", (fake) => { fake.state.faults.tamperChallenge = true; }, "auth_failed"],
    ["redirect_uri differs from the authorization request", (fake) => { fake.state.faults.redirectMismatch = true; }, "auth_failed"],
    ["authorization server error", (fake) => { fake.state.faults.authorizeError = "server_error"; }, "auth_failed"],
    ["token endpoint 500", (fake) => { fake.state.faults.token = "status:500"; }, "server"],
    ["token endpoint 400", (fake) => { fake.state.faults.token = "status:400"; }, "remote_rejected"],
    ["token endpoint malformed JSON", (fake) => { fake.state.faults.token = "malformed"; }, "invalid_response"],
  ];
  for (const [label, arrange, code] of cases) {
    const h = await harness();
    try {
      arrange(h.fake);
      await assert.rejects(() => h.auth.connect(), (error) => {
        assert.equal(error.code, code, label);
        return true;
      });
      assert.equal(await h.auth.isConnected(), false, `${label}: nothing is stored`);
      assert.equal(h.auth.connecting, false, `${label}: the flow ended`);
      await assert.rejects(() => fs.access(path.join(h.directory, DRIVE_CREDENTIAL_FILE)), label);
    } finally {
      await h.cleanup();
    }
  }
}

async function testEncryptionFailures() {
  // safeStorage unavailable: connected for this session only, nothing on disk.
  const unavailable = await harness({ encryption: false });
  try {
    await unavailable.auth.connect();
    assert.equal(unavailable.store.storage(), "session");
    assert.deepEqual(await fs.readdir(unavailable.directory), []);
  } finally {
    await unavailable.cleanup();
  }
  // safeStorage throws while encrypting: fail safe, never plaintext.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-drive-throw-"));
  try {
    const throwing = { ...fakeEncryption(true), encryptString: () => { throw new Error("keychain locked"); } };
    const store = new DriveCredentialStore(directory, throwing);
    assert.equal(await store.save({ refreshToken: "secret-refresh", accountEmail: null, scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: "x" }), "session");
    assert.equal(store.storage(), "session");
    assert.deepEqual(await fs.readdir(directory), [], "no credential file, temporary or plaintext");
    const throwingDecrypt = { ...fakeEncryption(true), decryptString: () => { throw new Error("cannot decrypt"); } };
    await new DriveCredentialStore(directory, fakeEncryption(true)).save({ refreshToken: "r", accountEmail: null, scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: "x" });
    assert.equal(await new DriveCredentialStore(directory, throwingDecrypt).load(), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function testScopeEnforcement() {
  const h = await harness({ fake: { grantedScope: "openid https://www.googleapis.com/auth/userinfo.email" } });
  try {
    await assert.rejects(() => h.auth.connect(), (error) => error.code === "insufficient_scope");
    assert.equal(await h.auth.isConnected(), false, "a grant without drive.file is not stored");
    assert.equal(h.fake.state.revoked.length, 1, "the unusable grant is revoked");
  } finally {
    await h.cleanup();
  }
  const withOpenId = await harness({ fake: { grantedScope: `openid ${GOOGLE_DRIVE_FILE_SCOPE}` } });
  try {
    await withOpenId.auth.connect();
    assert.equal(await withOpenId.auth.isConnected(), true, "openid alongside drive.file is ignored");
  } finally {
    await withOpenId.cleanup();
  }
}

async function testRefreshInvalidGrant() {
  const h = await harness();
  try {
    await h.auth.connect();
    h.fake.state.faults.refresh = "invalid_grant";
    await assert.rejects(() => h.auth.getAccessToken(true), (error) => error.code === "auth_expired" && /Reconnect/.test(error.message));
    assert.equal(await h.auth.isConnected(), false, "invalid_grant clears the stored credential");
    await assert.rejects(() => fs.access(path.join(h.directory, DRIVE_CREDENTIAL_FILE)));
  } finally {
    await h.cleanup();
  }
}

async function testCredentialStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-drive-store-"));
  try {
    const credential = { refreshToken: "secret-refresh", accountEmail: "a@example.test", scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: "2026-10-15T00:00:00.000Z" };
    const encrypted = new DriveCredentialStore(directory, fakeEncryption(true));
    assert.equal(await encrypted.save(credential), "encrypted");
    assert.deepEqual(await new DriveCredentialStore(directory, fakeEncryption(true)).load(), credential);

    // Without OS encryption the token stays in memory for the session only.
    const sessionDirectory = path.join(directory, "session");
    const session = new DriveCredentialStore(sessionDirectory, fakeEncryption(false));
    assert.equal(await session.save(credential), "session");
    assert.equal(session.storage(), "session");
    assert.deepEqual(await session.load(), credential);
    await assert.rejects(() => fs.access(path.join(sessionDirectory, DRIVE_CREDENTIAL_FILE)), "nothing is written without encryption");
    assert.equal(await new DriveCredentialStore(sessionDirectory, fakeEncryption(false)).load(), null);

    // An undecryptable file (another OS account) is removed, not trusted.
    await fs.writeFile(path.join(directory, DRIVE_CREDENTIAL_FILE), "garbage");
    assert.equal(await new DriveCredentialStore(directory, fakeEncryption(true)).load(), null);
    await assert.rejects(() => fs.access(path.join(directory, DRIVE_CREDENTIAL_FILE)));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function testTransportAllowlist() {
  const calls = [];
  const transport = new GoogleTransport({
    fetch: async (url) => {
      calls.push(url);
      return new Response("{}", { status: 200 });
    },
    allowedOrigins: resolveGoogleEndpoints({ env: {}, isPackaged: true }).allowedOrigins,
  });
  for (const url of [
    "https://evil.example.com/token",
    "http://oauth2.googleapis.com/token",
    "https://oauth2.googleapis.com.evil.test/token",
    "https://user:pass@www.googleapis.com/drive/v3/about",
    "not a url",
  ]) {
    await assert.rejects(() => transport.request(url), (error) => error.code === "invalid_request", url);
  }
  assert.equal(calls.length, 0, "refused requests never reach fetch");
  await transport.request("https://www.googleapis.com/drive/v3/about");
  assert.equal(calls.length, 1);

  const slow = new GoogleTransport({
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    allowedOrigins: ["https://www.googleapis.com"],
    defaultTimeoutMs: 50,
  });
  await assert.rejects(() => slow.request("https://www.googleapis.com/drive/v3/about"), (error) => error.code === "timeout");
  const offline = new GoogleTransport({ fetch: async () => { throw new TypeError("fetch failed"); }, allowedOrigins: ["https://www.googleapis.com"] });
  await assert.rejects(() => offline.request("https://www.googleapis.com/drive/v3/about"), (error) => error.code === "network");

  // Classification of Google error responses.
  const reason = (status, name) => classifyGoogleResponse(status, { error: { code: status, errors: [{ reason: name }] } }).code;
  assert.equal(reason(401, "authError"), "auth_expired");
  assert.equal(reason(403, "insufficientPermissions"), "insufficient_scope");
  assert.equal(reason(403, "rateLimitExceeded"), "rate_limited");
  assert.equal(reason(403, "userRateLimitExceeded"), "rate_limited");
  assert.equal(reason(429, "rateLimitExceeded"), "rate_limited");
  assert.equal(reason(403, "storageQuotaExceeded"), "storage_quota");
  assert.equal(reason(500, "backendError"), "server");
  assert.equal(reason(503, "backendError"), "server");
  assert.equal(reason(400, "badRequest"), "remote_rejected");
  assert.equal(classifyGoogleResponse(400, { error: "invalid_grant" }).code, "auth_expired");
  assert.equal(classifyGoogleResponse(401, { error: "invalid_client" }).code, "not_configured");
}

async function testClientConfiguration() {
  assert.deepEqual(resolveGoogleClientConfig({ env: {}, isPackaged: false, resourcesPath: null }), { configured: false, reason: "missing-client-config" });
  const fromEnv = resolveGoogleClientConfig({ env: { JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: CLIENT.clientId, JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: CLIENT.clientSecret }, isPackaged: false });
  assert.deepEqual(fromEnv, { configured: true, client: CLIENT });
  assert.deepEqual(
    resolveGoogleClientConfig({ env: { JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: "not-a-client-id", JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: "secret-value-1" }, isPackaged: false }),
    { configured: false, reason: "invalid-client-config" },
  );
  // Packaged builds ignore the environment and read only the generated resource file.
  const packagedEnv = { env: { JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID: CLIENT.clientId, JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET: CLIENT.clientSecret }, isPackaged: true, resourcesPath: "/resources", readTextFile: () => { throw new Error("ENOENT"); } };
  assert.deepEqual(resolveGoogleClientConfig(packagedEnv), { configured: false, reason: "missing-client-config" });
  const packaged = resolveGoogleClientConfig({ env: {}, isPackaged: true, resourcesPath: "/resources", readTextFile: (target) => {
    assert.match(target.replace(/\\/g, "/"), /\/resources\/google-oauth\/google-desktop-client\.json$/);
    return JSON.stringify(CLIENT);
  } });
  assert.deepEqual(packaged, { configured: true, client: CLIENT });
  assert.equal(resolveGoogleClientConfig({ env: {}, isPackaged: true, resourcesPath: "/r", readTextFile: () => "{" }).configured, false);

  // An unconfigured build reports cleanly instead of throwing at startup.
  const h = await harness({ client: null });
  try {
    assert.equal(h.auth.configured, false);
    await assert.rejects(() => h.auth.connect(), (error) => error.code === "not_configured");
    assert.equal(h.opened.length, 0);
  } finally {
    await h.cleanup();
  }

  // The test endpoint override is honoured only for non-packaged loopback http origins.
  const production = resolveGoogleEndpoints({ env: {}, isPackaged: false });
  assert.deepEqual(production.allowedOrigins, ["https://accounts.google.com", "https://oauth2.googleapis.com", "https://www.googleapis.com"]);
  assert.equal(production.token, "https://oauth2.googleapis.com/token");
  assert.equal(production.driveUpload, "https://www.googleapis.com/upload/drive/v3/files");
  const overridden = resolveGoogleEndpoints({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: TEST_BASE }, isPackaged: false });
  assert.deepEqual(overridden.allowedOrigins, [TEST_BASE]);
  assert.equal(overridden.testOverride, true);
  assert.equal(resolveGoogleEndpoints({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: TEST_BASE }, isPackaged: true }).testOverride, false, "packaged builds ignore the override");
  assert.equal(resolveGoogleEndpoints({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: "https://evil.example.com:8443" }, isPackaged: false }).testOverride, false, "non-loopback overrides are ignored");
  assert.equal(resolveTestTimeoutMs({ env: { JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS: "500" }, isPackaged: false }), null, "timeout override needs the endpoint override");
  assert.equal(resolveTestTimeoutMs({ env: { JOB_RANGER_GOOGLE_TEST_BASE_URL: TEST_BASE, JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS: "500" }, isPackaged: false }), 500);
}

async function run() {
  await testPkceAndState();
  await testLoopbackReceiver();
  await testConnectFlow();
  await testOneFlowAtATimeAndCancel();
  await testTokenExchangeFailures();
  await testEncryptionFailures();
  await testScopeEnforcement();
  await testRefreshInvalidGrant();
  await testCredentialStore();
  await testTransportAllowlist();
  await testClientConfiguration();
  console.log("Google Drive desktop auth tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
