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
  const transport = new GoogleTransport({
    fetch: async (url, init) => {
      if (options.fetchGate) await options.fetchGate(url);
      return fake.fetch(url.replace(TEST_BASE, "http://fake.test"), init);
    },
    allowedOrigins: endpoints().allowedOrigins,
  });
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
  // A wrong state, or the right state without a code or error, is refused but does
  // not end the flow: a stray or forged request cannot cancel a real sign-in.
  const mismatch = await startLoopbackReceiver("expected-state", 10_000);
  assert.equal((await fetch(`${mismatch.redirectUri}/?state=attacker-state&code=stolen`)).status, 400);
  assert.equal((await fetch(`${mismatch.redirectUri}/?state=attacker-state&error=access_denied`)).status, 400);
  assert.equal((await fetch(`${mismatch.redirectUri}/?state=expected-state`)).status, 400);
  const genuine = await fetch(`${mismatch.redirectUri}/?state=expected-state&code=real-code`);
  assert.equal(genuine.status, 200);
  assert.equal(await mismatch.code, "real-code", "the genuine callback still completes after forged ones");

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

    // Reconnecting always asks for consent (so a refresh token for the chosen account is
    // issued) and, for the same account, does not revoke the grant it replaces.
    await h.auth.connect();
    assert.equal(h.fake.state.faults.lastAuthorizeParams.prompt, "consent");
    assert.equal(h.fake.state.revoked.length, 0, "same-account reconnect keeps the grant");
    assert.match(await h.auth.getAccessToken(true), /^fake-access-/);

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
    // Cancel while the browser sign-in is open.
    while (h.opened.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(() => h.auth.connect(), (error) => error.code === "auth_in_progress");
    h.auth.cancelConnect();
    release?.();
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

async function testConcurrentConnectAndDisconnectRace() {
  // Minor 1: a second connect issued synchronously, before any await, is refused.
  let release;
  const h = await harness({ browser: () => new Promise((resolve) => { release = resolve; }) });
  try {
    const first = h.auth.connect();
    first.catch(() => undefined);
    await assert.rejects(() => h.auth.connect(), (error) => error.code === "auth_in_progress");
    assert.equal(h.auth.connecting, true);
    h.auth.cancelConnect();
    release?.();
    await assert.rejects(first, (error) => error.code === "auth_cancelled");
  } finally {
    await h.cleanup();
  }

  // Minor 2: disconnect while the token exchange is running cannot be undone by it.
  let releaseToken;
  const gate = new Promise((resolve) => { releaseToken = resolve; });
  let exchangeStarted = false;
  const raced = await harness({
    fetchGate: async (url) => {
      if (url.endsWith("/token") && !exchangeStarted) {
        exchangeStarted = true;
        await gate;
      }
    },
  });
  try {
    const connecting = raced.auth.connect();
    connecting.catch(() => undefined);
    while (!exchangeStarted) await new Promise((resolve) => setTimeout(resolve, 5));
    await raced.auth.disconnect();
    releaseToken();
    await assert.rejects(connecting, (error) => error.code === "auth_cancelled");
    assert.equal(await raced.auth.isConnected(), false, "the late exchange did not resurrect the credential");
    await assert.rejects(() => fs.access(path.join(raced.directory, DRIVE_CREDENTIAL_FILE)));
    assert.equal(raced.fake.state.refreshTokens.size, 0, "the orphaned grant was revoked");
  } finally {
    await raced.cleanup();
  }
}

async function testStaleCancel() {
  // A cancel aimed at a finished sign-in must not cancel a newer one.
  let release;
  const h = await harness({
    browser: async (url) => {
      if (!release) {
        const result = h.fake.handle("GET", url.replace(TEST_BASE, "http://fake.test"), {}, Buffer.alloc(0));
        await fetch(result.headers.Location);
        return;
      }
      await new Promise((resolve) => { release = resolve; });
    },
  });
  try {
    let firstFlow;
    const first = h.auth.connect();
    firstFlow = h.auth.connectFlowId;
    await first;
    assert.equal(h.auth.connectFlowId, null);
    release = () => undefined;
    const second = h.auth.connect();
    second.catch(() => undefined);
    const secondFlow = h.auth.connectFlowId;
    assert.notEqual(secondFlow, firstFlow);
    assert.equal(h.auth.cancelConnect(firstFlow), false, "a stale cancel is refused");
    assert.equal(h.auth.connecting, true, "the newer sign-in keeps running");
    assert.equal(h.auth.cancelConnect(secondFlow), true);
    await assert.rejects(second, (error) => error.code === "auth_cancelled");
    assert.equal(h.auth.cancelConnect(secondFlow), false, "nothing left to cancel");
  } finally {
    await h.cleanup();
  }
}

async function testAccountBinding() {
  const h = await harness();
  try {
    await h.auth.connect();
    const first = await h.auth.account();
    assert.deepEqual(first, { id: "01234567890123456789", email: "drive-tester@example.test" });
    const firstRefresh = [...h.fake.state.refreshTokens.keys()][0];

    // M1: switching to another Google account stores B's own token and ends A's grant.
    h.fake.signInAs("second@example.test", "99999999999999999999");
    await h.auth.connect();
    assert.deepEqual(await h.auth.account(), { id: "99999999999999999999", email: "second@example.test" });
    assert.ok(h.fake.state.revoked.includes(firstRefresh), "the previous account's grant was revoked");
    const reloaded = await new DriveCredentialStore(h.directory, fakeEncryption()).load();
    assert.equal(reloaded.accountId, "99999999999999999999");
    assert.notEqual(reloaded.refreshToken, firstRefresh, "B is never stored with A's refresh token");
    assert.equal(h.fake.state.refreshTokens.get(reloaded.refreshToken), "99999999999999999999");
  } finally {
    await h.cleanup();
  }

  // A consent without a refresh token is refused instead of reusing a stored one.
  const noRefresh = await harness();
  try {
    await noRefresh.auth.connect();
    noRefresh.fake.state.faults.omitRefreshToken = true;
    noRefresh.fake.signInAs("second@example.test", "99999999999999999999");
    await assert.rejects(() => noRefresh.auth.connect(), (error) => error.code === "auth_failed" && /lasting access/.test(error.message));
    assert.equal((await noRefresh.auth.account()).id, "01234567890123456789", "the existing connection is unchanged");
  } finally {
    await noRefresh.cleanup();
  }
}

async function testTokenResponseRules() {
  // Minor 4: token_type must be Bearer (any case).
  const wrongType = await harness();
  try {
    wrongType.fake.state.faults.tokenType = "mac";
    await assert.rejects(() => wrongType.auth.connect(), (error) => error.code === "invalid_response");
    assert.equal(await wrongType.auth.isConnected(), false);
  } finally {
    await wrongType.cleanup();
  }
  const lowercase = await harness();
  try {
    lowercase.fake.state.faults.tokenType = "bearer";
    await lowercase.auth.connect();
    assert.equal(await lowercase.auth.isConnected(), true);
  } finally {
    await lowercase.cleanup();
  }

  // Minor 4: a rotated refresh token is persisted and keeps working after a restart.
  const rotating = await harness();
  try {
    await rotating.auth.connect();
    const original = [...rotating.fake.state.refreshTokens.keys()][0];
    rotating.fake.state.faults.rotateRefreshToken = true;
    await rotating.auth.getAccessToken(true);
    const stored = await new DriveCredentialStore(rotating.directory, fakeEncryption()).load();
    assert.notEqual(stored.refreshToken, original);
    assert.equal(rotating.fake.state.refreshTokens.has(original), false, "the old token no longer works at Google");
    const restarted = new GoogleDesktopAuth({
      client: CLIENT,
      endpoints: endpoints(),
      transport: new GoogleTransport({ fetch: (url, init) => rotating.fake.fetch(url, init), allowedOrigins: endpoints().allowedOrigins }),
      store: new DriveCredentialStore(rotating.directory, fakeEncryption()),
      openExternal: async () => undefined,
    });
    assert.match(await restarted.getAccessToken(), /^fake-access-/);
  } finally {
    await rotating.cleanup();
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
    assert.equal(await store.save({ refreshToken: "secret-refresh", accountId: "1", accountEmail: null, scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: "x" }), "session");
    assert.equal(store.storage(), "session");
    assert.deepEqual(await fs.readdir(directory), [], "no credential file, temporary or plaintext");
    const throwingDecrypt = { ...fakeEncryption(true), decryptString: () => { throw new Error("cannot decrypt"); } };
    const saved = { refreshToken: "r", accountId: "1", accountEmail: null, scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: "x" };
    await new DriveCredentialStore(directory, fakeEncryption(true)).save(saved);
    // Minor 5: a decrypt failure (e.g. a locked keychain) keeps the file and reports it; a later load succeeds.
    let locked = true;
    const flaky = { ...fakeEncryption(true), decryptString: (buffer) => { if (locked) throw new Error("cannot decrypt"); return fakeEncryption(true).decryptString(buffer); } };
    const flakyStore = new DriveCredentialStore(directory, flaky);
    assert.equal(await flakyStore.load(), null);
    assert.equal(flakyStore.credentialUnavailable(), true);
    await fs.access(path.join(directory, DRIVE_CREDENTIAL_FILE));
    locked = false;
    assert.deepEqual(await flakyStore.load(), saved);
    assert.equal(flakyStore.credentialUnavailable(), false);
    assert.equal(await new DriveCredentialStore(directory, throwingDecrypt).load(), null);
    await fs.access(path.join(directory, DRIVE_CREDENTIAL_FILE));
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
    const credential = { refreshToken: "secret-refresh", accountId: "42", accountEmail: "a@example.test", scope: GOOGLE_DRIVE_FILE_SCOPE, savedAt: "2026-10-15T00:00:00.000Z" };
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

    // A file that decrypts but is not a credential (corrupt, or missing its account) is removed.
    for (const text of ["not json", JSON.stringify({ refreshToken: "r" })]) {
      await fs.writeFile(path.join(directory, DRIVE_CREDENTIAL_FILE), fakeEncryption(true).encryptString(text));
      assert.equal(await new DriveCredentialStore(directory, fakeEncryption(true)).load(), null);
      await assert.rejects(() => fs.access(path.join(directory, DRIVE_CREDENTIAL_FILE)), text);
    }
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
  await testConcurrentConnectAndDisconnectRace();
  await testStaleCancel();
  await testAccountBinding();
  await testTokenResponseRules();
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
