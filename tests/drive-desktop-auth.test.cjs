// Windows (Electron) Google Drive authorization, credential custody and egress (#314).
// Runs against the compiled main-process modules (npm run desktop:compile) and the local
// fake Google in tests/support/fake-google-drive.cjs. No real Google endpoint is contacted.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");

const runtime = path.join(__dirname, "..", "electron-runtime", "electron", "src", "drive");
const {
  createPkcePair, pkceChallenge, createOAuthState, startLoopbackReceiver, LOOPBACK_HOST, constantTimeEqual,
} = require(path.join(runtime, "google-loopback.cjs"));
const { GoogleDesktopAuth, buildAuthorizationUrl } = require(path.join(runtime, "google-desktop-auth.cjs"));
const { DriveCredentialStore, DRIVE_CREDENTIAL_FILE } = require(path.join(runtime, "drive-credential-store.cjs"));
const {
  createDriveEgressFetch, allowedDriveRequest, browserAuthorizationUrl,
  DRIVE_JSON_RESPONSE_LIMIT, DRIVE_MEDIA_RESPONSE_LIMIT,
} = require(path.join(runtime, "drive-egress.cjs"));
const {
  resolveGoogleClientConfig, resolveGoogleTestOrigin, validateClientConfig, GOOGLE_DRIVE_FILE_SCOPE,
} = require(path.join(runtime, "google-config.cjs"));
const { createFakeGoogle } = require("./support/fake-google-drive.cjs");

const CLIENT = { clientId: "1234567890-e2edrive.apps.googleusercontent.com", clientSecret: "GOCSPX-not-a-secret" };

/** Reversible stand-in for safeStorage: the plaintext never appears in the stored bytes. */
function fakeEncryption({ available = true, failEncrypt = false, failDecrypt = false } = {}) {
  const key = 0x5a;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => {
      if (failEncrypt) throw new Error("encryption failed");
      return Buffer.concat([Buffer.from("ENC1"), Buffer.from(text, "utf8").map((byte) => byte ^ key)]);
    },
    decryptString: (buffer) => {
      if (failDecrypt || buffer.subarray(0, 4).toString() !== "ENC1") throw new Error("decrypt failed");
      return Buffer.from(buffer.subarray(4).map((byte) => byte ^ key)).toString("utf8");
    },
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sojourner-drive-auth-"));
}

function harness({ encryption = fakeEncryption(), timeoutMs = 5_000, signIn = true } = {}) {
  const google = createFakeGoogle({ clientId: CLIENT.clientId });
  const dir = tempDir();
  const store = new DriveCredentialStore(dir, encryption);
  const opened = [];
  const egress = createDriveEgressFetch({ fetch: google.fetch, timeoutMs: 2_000 });
  const auth = new GoogleDesktopAuth({
    client: CLIENT, store, fetch: egress, authorizationTimeoutMs: timeoutMs,
    openExternal: async (url) => {
      opened.push(url);
      if (signIn) void google.completeBrowserSignIn(url).catch(() => undefined);
    },
  });
  return { google, dir, store, auth, opened, egress };
}

test("PKCE S256 matches RFC 7636 appendix B and fresh pairs are 256-bit", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const a = createPkcePair();
  const b = createPkcePair();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  assert.match(createOAuthState(), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("the authorization URL asks for drive.file only, with S256, state and a 127.0.0.1 redirect", () => {
  const url = new URL(buildAuthorizationUrl({
    clientId: CLIENT.clientId, redirectUri: "http://127.0.0.1:50123", codeChallenge: "challenge", state: "state123",
  }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), GOOGLE_DRIVE_FILE_SCOPE);
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:50123");
  assert.equal(url.searchParams.has("client_secret"), false, "the client secret never goes to the browser");
});

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
}

test("the loopback receiver binds 127.0.0.1 only and ignores callbacks without the exact state", async () => {
  const receiver = await startLoopbackReceiver("expected-state", 5_000);
  const redirect = new URL(receiver.redirectUri);
  assert.equal(redirect.hostname, LOOPBACK_HOST);
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.ok(Number(redirect.port) > 0);
  // Not reachable through another loopback name/interface family.
  await assert.rejects(get(`http://[::1]:${redirect.port}/?state=expected-state&code=x`));
  assert.equal(await get(`${receiver.redirectUri}/?state=wrong-state&code=stolen`), 400);
  assert.equal(await get(`${receiver.redirectUri}/?code=no-state`), 400);
  assert.equal(await get(`${receiver.redirectUri}/other?state=expected-state&code=x`), 404);
  assert.equal(await get(`${receiver.redirectUri}/?state=expected-state&code=real-code`), 200);
  assert.equal(await receiver.code, "real-code");
  // Single use: the receiver is closed after the first decisive callback.
  await assert.rejects(get(`${receiver.redirectUri}/?state=expected-state&code=replayed`));
});

test("the loopback receiver times out and reports it", async () => {
  const receiver = await startLoopbackReceiver(createOAuthState(), 50);
  await assert.rejects(receiver.code, (error) => error.code === "timeout");
});

test("connect: system browser, PKCE exchange, account binding; refresh token stored encrypted only", async () => {
  const { auth, store, dir, opened, google } = harness();
  const account = await auth.connect();
  assert.equal(account.accountId, "permissionTester01");
  assert.equal(account.label, "drive-tester@example.test");
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0]).origin, "https://accounts.google.com");
  assert.equal(google.state.faults.lastAuthorizeParams.code_challenge_method, "S256");
  assert.equal(store.storage(), "encrypted");
  const file = fs.readFileSync(path.join(dir, DRIVE_CREDENTIAL_FILE));
  const [refreshToken] = google.state.refreshTokens.keys();
  assert.ok(refreshToken);
  assert.equal(file.includes(Buffer.from(refreshToken)), false, "no plaintext refresh token on disk");
  assert.equal(file.includes(Buffer.from("refreshToken")), false);
  // A fresh process reads the same credential back through the OS encryption.
  const reloaded = new DriveCredentialStore(dir, fakeEncryption());
  assert.equal((await reloaded.load()).refreshToken, refreshToken);
  // The access token is served from memory without another exchange.
  const token = await auth.getAccessToken();
  assert.ok(google.state.accessTokens.has(token));
  assert.equal(google.state.counts.refreshes, 0);
});

test("a stolen code replayed with another PKCE verifier is refused and nothing is stored", async () => {
  const { auth, store, google } = harness();
  google.state.faults.tamperChallenge = true;
  await assert.rejects(auth.connect(), (error) => error.code === "auth_failed");
  assert.equal(await store.load(), null);
});

test("a denied consent ends the sign-in without storing anything", async () => {
  const { auth, store, google } = harness();
  google.state.faults.denyAuthorization = true;
  await assert.rejects(auth.connect(), (error) => error.code === "auth_cancelled");
  assert.equal(await store.load(), null);
});

test("a grant without drive.file is refused and revoked", async () => {
  const { auth, store, google } = harness();
  google.state.grantedScope = "https://www.googleapis.com/auth/drive.appdata";
  await assert.rejects(auth.connect(), (error) => error.code === "insufficient_scope");
  assert.equal(await store.load(), null);
  assert.equal(google.state.revoked.length, 1);
});

test("an unfinished sign-in times out and a cancel ends only the named flow", async () => {
  const slow = harness({ signIn: false, timeoutMs: 80 });
  await assert.rejects(slow.auth.connect(), (error) => error.code === "timeout");
  const waiting = harness({ signIn: false });
  const pending = waiting.auth.connect("6f1f5e0c-8a55-4a9b-9a0d-0a7b1c2d3e4f");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(waiting.auth.cancelConnect("00000000-0000-4000-8000-000000000000"), false);
  assert.equal(waiting.auth.cancelConnect("6f1f5e0c-8a55-4a9b-9a0d-0a7b1c2d3e4f"), true);
  await assert.rejects(pending, (error) => error.code === "auth_cancelled");
  assert.equal(await waiting.store.load(), null);
});

test("disconnect revokes at Google and deletes the stored sign-in, even when revocation fails", async () => {
  const first = harness();
  await first.auth.connect();
  assert.equal((await first.auth.disconnect()).revoked, true);
  assert.equal(fs.existsSync(path.join(first.dir, DRIVE_CREDENTIAL_FILE)), false);
  assert.equal(first.google.state.refreshTokens.size, 0);
  await assert.rejects(first.auth.getAccessToken(), (error) => error.code === "not_connected");

  const second = harness();
  await second.auth.connect();
  second.google.state.faults.revoke = "status:503";
  assert.equal((await second.auth.disconnect()).revoked, false);
  assert.equal(fs.existsSync(path.join(second.dir, DRIVE_CREDENTIAL_FILE)), false);
  assert.equal(await second.store.load(), null);
});

test("a revoked refresh token clears the stored sign-in and asks to reconnect", async () => {
  const { auth, store, google } = harness();
  await auth.connect();
  auth.invalidateAccessToken();
  google.state.faults.refresh = "invalid_grant";
  await assert.rejects(auth.getAccessToken(), (error) => error.code === "auth_expired");
  assert.equal(await store.load(), null);
});

test("without OS encryption the sign-in is kept for this session only and never written", async () => {
  const { auth, store, dir } = harness({ encryption: fakeEncryption({ available: false }) });
  await auth.connect();
  assert.equal(store.storage(), "session");
  assert.equal(fs.existsSync(path.join(dir, DRIVE_CREDENTIAL_FILE)), false);
  assert.equal(await new DriveCredentialStore(dir, fakeEncryption({ available: false })).load(), null);

  const failing = harness({ encryption: fakeEncryption({ failEncrypt: true }) });
  await failing.auth.connect();
  assert.equal(failing.store.storage(), "session");
  assert.deepEqual(fs.readdirSync(failing.dir), [], "never falls back to plaintext on disk");
});

test("an undecryptable stored sign-in is kept and reported, not silently discarded", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, DRIVE_CREDENTIAL_FILE), Buffer.from("ENC1garbage"));
  const store = new DriveCredentialStore(dir, fakeEncryption({ failDecrypt: true }));
  assert.equal(await store.load(), null);
  assert.equal(store.credentialUnavailable(), true);
  assert.equal(fs.existsSync(path.join(dir, DRIVE_CREDENTIAL_FILE)), true);
  await store.clear();
  assert.equal(fs.existsSync(path.join(dir, DRIVE_CREDENTIAL_FILE)), false);
});

test("egress is limited to the token/revoke endpoints and the two Drive v3 API paths", () => {
  const allowed = (url, method = "GET") => allowedDriveRequest(new URL(url), method);
  assert.equal(allowed("https://oauth2.googleapis.com/token", "POST"), true);
  assert.equal(allowed("https://oauth2.googleapis.com/revoke", "POST"), true);
  assert.equal(allowed("https://www.googleapis.com/drive/v3/about?fields=user"), true);
  assert.equal(allowed("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", "POST"), true);
  for (const [url, method] of [
    ["https://accounts.google.com/o/oauth2/v2/auth", "GET"],
    ["https://oauth2.googleapis.com/token", "GET"],
    ["https://oauth2.googleapis.com/tokeninfo", "POST"],
    ["https://www.googleapis.com/oauth2/v3/userinfo", "GET"],
    ["https://www.googleapis.com/drive/v2/files", "GET"],
    ["https://www.googleapis.com/upload/drive/v3/files", "GET"],
    ["http://www.googleapis.com/drive/v3/about", "GET"],
    ["https://www.googleapis.com.evil.example/drive/v3/about", "GET"],
    ["https://user:pass@www.googleapis.com/drive/v3/about", "GET"],
    ["https://example.com/drive/v3/about", "GET"],
  ]) {
    assert.equal(allowed(url, method), false, `${method} ${url} must be refused`);
  }
});

test("egress refuses before any network call, never follows redirects and caps response sizes", async () => {
  const calls = [];
  const respond = (response) => createDriveEgressFetch({
    fetch: async (url, init) => { calls.push({ url, init }); return typeof response === "function" ? response() : response; },
    timeoutMs: 200,
  });
  await assert.rejects(respond(new Response("{}"))("https://evil.example/x"), /refused to contact/);
  assert.equal(calls.length, 0);

  const ok = await respond(new Response('{"ok":true}', { status: 200 }))("https://www.googleapis.com/drive/v3/about");
  assert.deepEqual(await ok.json(), { ok: true });
  assert.equal(calls[0].init.redirect, "error");

  await assert.rejects(respond(new Response(null, { status: 302, headers: { Location: "https://evil.example" } }))(
    "https://www.googleapis.com/drive/v3/about"), /redirect/);
  await assert.rejects(respond(() => new Response(Buffer.alloc(DRIVE_JSON_RESPONSE_LIMIT + 1)))(
    "https://www.googleapis.com/drive/v3/files/abc"), /larger response/);
  await assert.rejects(respond(() => new Response(Buffer.alloc(DRIVE_MEDIA_RESPONSE_LIMIT + 1)))(
    "https://www.googleapis.com/drive/v3/files/abc?alt=media"), /larger response/);
  const media = await respond(() => new Response(Buffer.alloc(DRIVE_JSON_RESPONSE_LIMIT + 1)))(
    "https://www.googleapis.com/drive/v3/files/abc?alt=media");
  assert.equal((await media.arrayBuffer()).byteLength, DRIVE_JSON_RESPONSE_LIMIT + 1);

  const hanging = createDriveEgressFetch({
    fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    timeoutMs: 50,
  });
  const started = Date.now();
  await assert.rejects(hanging("https://www.googleapis.com/drive/v3/about"));
  assert.ok(Date.now() - started < 2_000);
});

test("the fake-Google origin override is honoured only by non-packaged builds and loopback http", () => {
  const env = { SOJOURNER_GOOGLE_TEST_BASE_URL: "http://127.0.0.1:4567" };
  assert.equal(resolveGoogleTestOrigin({ env, isPackaged: false }), "http://127.0.0.1:4567");
  assert.equal(resolveGoogleTestOrigin({ env, isPackaged: true }), null);
  assert.equal(resolveGoogleTestOrigin({ env: { SOJOURNER_GOOGLE_TEST_BASE_URL: "https://127.0.0.1:4567" }, isPackaged: false }), null);
  assert.equal(resolveGoogleTestOrigin({ env: { SOJOURNER_GOOGLE_TEST_BASE_URL: "http://example.com:80" }, isPackaged: false }), null);
  assert.equal(browserAuthorizationUrl("https://accounts.google.com/o/oauth2/v2/auth?a=1", "http://127.0.0.1:4567"),
    "http://127.0.0.1:4567/o/oauth2/v2/auth?a=1");
  assert.equal(browserAuthorizationUrl("https://accounts.google.com/o/oauth2/v2/auth?a=1", null),
    "https://accounts.google.com/o/oauth2/v2/auth?a=1");
});

test("Drive stays off without a valid Desktop client; packaged builds read only the generated resource", () => {
  assert.deepEqual(resolveGoogleClientConfig({ env: {}, isPackaged: true, resourcesPath: null }),
    { configured: false, reason: "missing-client-config" });
  assert.equal(validateClientConfig("not-a-client", "GOCSPX-abcdefgh").configured, false);
  const packaged = resolveGoogleClientConfig({
    env: { SOJOURNER_GOOGLE_DESKTOP_CLIENT_ID: "ignored-in-packaged-builds" }, isPackaged: true, resourcesPath: "C:/res",
    readTextFile: (target) => {
      assert.match(target.replace(/\\/g, "/"), /C:\/res\/google-oauth\/google-desktop-client\.json$/);
      return JSON.stringify(CLIENT);
    },
  });
  assert.deepEqual(packaged, { configured: true, client: CLIENT });
  assert.equal(resolveGoogleClientConfig({ env: {}, isPackaged: true, resourcesPath: "C:/res",
    readTextFile: () => { throw new Error("ENOENT"); } }).configured, false);
  assert.deepEqual(resolveGoogleClientConfig({ env: {
    SOJOURNER_GOOGLE_DESKTOP_CLIENT_ID: CLIENT.clientId, SOJOURNER_GOOGLE_DESKTOP_CLIENT_SECRET: CLIENT.clientSecret,
  }, isPackaged: false }), { configured: true, client: CLIENT });
});

// Review findings on #369 (2026-11-02).
function rawRequest(port, requestLine) {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(`${requestLine}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let data = "";
    socket.setTimeout(2_000, () => { socket.destroy(); reject(new Error("no response")); });
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data.split("\r\n")[0]));
    socket.on("error", reject);
  });
}

test("a malformed request-target gets 400 and never throws in the main process; sign-in still completes", async () => {
  const receiver = await startLoopbackReceiver("expected-state", 5_000);
  const port = Number(new URL(receiver.redirectUri).port);
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    for (const target of ["http://a:99999/", "http://[/"]) {
      const status = await rawRequest(port, `GET ${target} HTTP/1.1`);
      assert.match(status, /^HTTP\/1\.1 400 /, `${target} answered ${status}`);
    }
  } finally {
    process.off("uncaughtException", onUncaught);
  }
  assert.equal(uncaught.length, 0);
  assert.equal(await get(`${receiver.redirectUri}/?state=expected-state&code=real-code`), 200);
  assert.equal(await receiver.code, "real-code");
});

test("a grant broader than drive.file is refused and revoked, not silently accepted", async () => {
  const { auth, store, google } = harness();
  google.state.grantedScope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive";
  await assert.rejects(auth.connect(), (error) => error.code === "insufficient_scope");
  assert.equal(await store.load(), null);
  assert.equal(google.state.revoked.length, 1);
});

test("Drive IPC answers only Sojourner's own top-level page", () => {
  const { isAppFrame } = require(path.join(runtime, "drive-sender.cjs"));
  const main = { url: "file:///C:/Program%20Files/Sojourner/resources/app.asar/dist/index.html" };
  const ok = { senderFrame: main, sender: { mainFrame: main } };
  assert.equal(isAppFrame(ok, false), true);
  const child = { url: main.url };
  assert.equal(isAppFrame({ senderFrame: child, sender: { mainFrame: main } }, false), false, "subframes are refused");
  const remote = { url: "https://example.com/" };
  assert.equal(isAppFrame({ senderFrame: remote, sender: { mainFrame: remote } }, false), false, "remote pages are refused");
  const dev = { url: "http://localhost:5173/#/resume" };
  assert.equal(isAppFrame({ senderFrame: dev, sender: { mainFrame: dev } }, false), false);
  assert.equal(isAppFrame({ senderFrame: dev, sender: { mainFrame: dev } }, true), true, "the Vite dev server only in development");
  assert.equal(isAppFrame({ senderFrame: null, sender: { mainFrame: main } }, false), false);
});
