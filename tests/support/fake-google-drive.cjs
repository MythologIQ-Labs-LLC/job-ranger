// Deterministic fake of the Google endpoints the Windows (Electron) Drive export uses
// (#314): OAuth authorize/token/revoke and the Drive v3 subset of the shared transport
// (about, files.generateIds, files.get root, multipart files.create with a reserved id,
// files.get metadata and alt=media, and the schema-v1 appProperties search).
// Used as an injected fetch by unit tests and as a loopback HTTP server by the Electron
// E2E. It never talks to the real Google network. Adapted from closed PR #334.
//
// Modelled Google behaviour that matters for duplicate safety:
// - a create with an id that already exists fails with 409;
// - files.get of an id that was never created answers 404;
// - revoking any token of a grant revokes the whole grant;
// - files belong to the account that created them.
const http = require("node:http");
const { createHash, randomBytes } = require("node:crypto");

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const ROOT_ID = "fakeRootFolder0001";
const OPERATION_PROPERTY = "sojournerExportOperation";

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(status, body) {
  return { status, headers: { "Content-Type": "application/json" }, body: Buffer.from(JSON.stringify(body)) };
}

function googleError(status, reason, message = reason) {
  return json(status, { error: { code: status, message, errors: [{ reason, message }] } });
}

function parseMultipart(contentType, body) {
  const match = /boundary=([^;]+)/.exec(contentType ?? "");
  if (!match) throw new Error("multipart boundary missing");
  const boundary = match[1];
  const headerEnd = (from) => body.indexOf("\r\n\r\n", from) + 4;
  const firstStart = headerEnd(0);
  const secondDelimiter = body.indexOf(`\r\n--${boundary}\r\n`, firstStart);
  const metadata = JSON.parse(body.subarray(firstStart, secondDelimiter).toString("utf8"));
  const bytesStart = headerEnd(secondDelimiter + 2);
  const bytesEnd = body.lastIndexOf(`\r\n--${boundary}--`);
  return { metadata, bytes: Buffer.from(body.subarray(bytesStart, bytesEnd)) };
}

function createFakeGoogle(options = {}) {
  const state = {
    clientId: options.clientId ?? null,
    grantedScope: options.grantedScope ?? DRIVE_FILE_SCOPE,
    /** The account the next sign-in completes as. */
    account: { email: options.email ?? "drive-tester@example.test", permissionId: options.permissionId ?? "permissionTester01" },
    codes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    revoked: [],
    files: new Map(),
    reservedIds: new Set(),
    requests: [],
    counts: { uploadPosts: 0, tokenExchanges: 0, refreshes: 0, gets: 0, generateIds: 0, conflicts: 0, abouts: 0 },
    faults: {
      /** "status:<code>" | "drop-before-store" | "drop-after-store" | "hang" | "corrupt-bytes" */
      nextUpload: null,
      /** "status:<code>" for every files.get of a file id (not root) while set */
      get: null,
      /** "oversized" makes the next alt=media readback larger than any approved PDF */
      nextMedia: null,
      /** "status:<code>" for files.get of the root folder while set (no upload is attempted then) */
      root: null,
      refresh: null,
      omitRefreshToken: false,
      denyAuthorization: false,
      tamperChallenge: false,
      revoke: null,
      lastAuthorizeParams: null,
    },
  };

  function issue(map, prefix, permissionId) {
    const token = `${prefix}-${base64Url(randomBytes(12))}`;
    map.set(token, permissionId);
    return token;
  }

  function caller(headers) {
    const header = headers.authorization ?? "";
    return state.accessTokens.get(header.replace(/^Bearer /, "")) ?? null;
  }

  function emailOf(owner) {
    return owner === state.account.permissionId ? state.account.email : `${owner}@example.test`;
  }

  /** Returns { status, headers, body } or { fault: "hang" | "drop" }. */
  function handle(method, rawUrl, headers, body) {
    const url = new URL(rawUrl);
    state.requests.push({ method, path: url.pathname, search: url.search });
    const form = () => new URLSearchParams(body.toString("utf8"));

    if (method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
      const params = Object.fromEntries(url.searchParams);
      state.faults.lastAuthorizeParams = params;
      const redirect = new URL(params.redirect_uri);
      if (state.faults.denyAuthorization) {
        redirect.searchParams.set("error", "access_denied");
      } else {
        if (params.response_type !== "code" || params.code_challenge_method !== "S256" || params.scope !== DRIVE_FILE_SCOPE) {
          return json(400, { error: "invalid_request" });
        }
        const code = `fake-code-${base64Url(randomBytes(9))}`;
        state.codes.set(code, {
          challenge: state.faults.tamperChallenge ? base64Url(createHash("sha256").update("other-verifier").digest()) : params.code_challenge,
          redirectUri: params.redirect_uri,
          clientId: params.client_id,
          permissionId: state.account.permissionId,
        });
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("scope", state.grantedScope);
      }
      redirect.searchParams.set("state", params.state);
      return { status: 302, headers: { Location: redirect.toString() }, body: Buffer.alloc(0) };
    }

    if (method === "POST" && url.pathname === "/token") {
      const values = form();
      if (state.clientId && values.get("client_id") !== state.clientId) return json(401, { error: "invalid_client" });
      if (values.get("grant_type") === "authorization_code") {
        state.counts.tokenExchanges += 1;
        const entry = state.codes.get(values.get("code"));
        state.codes.delete(values.get("code"));
        const challenge = base64Url(createHash("sha256").update(values.get("code_verifier") ?? "").digest());
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== values.get("redirect_uri")) {
          return json(400, { error: "invalid_grant", error_description: "Bad code or verifier" });
        }
        return json(200, {
          access_token: issue(state.accessTokens, "fake-access", entry.permissionId),
          expires_in: 3599,
          ...(state.faults.omitRefreshToken ? {} : { refresh_token: issue(state.refreshTokens, "fake-refresh", entry.permissionId) }),
          scope: state.grantedScope,
          token_type: "Bearer",
        });
      }
      if (values.get("grant_type") === "refresh_token") {
        state.counts.refreshes += 1;
        const owner = state.refreshTokens.get(values.get("refresh_token"));
        if (state.faults.refresh === "invalid_grant" || !owner) {
          return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        }
        return json(200, { access_token: issue(state.accessTokens, "fake-access", owner), expires_in: 3599,
          scope: state.grantedScope, token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    if (method === "POST" && url.pathname === "/revoke") {
      if (state.faults.revoke) return json(Number(state.faults.revoke.slice(7)), { error: "server_error" });
      const token = form().get("token");
      state.revoked.push(token);
      const owner = state.refreshTokens.get(token) ?? state.accessTokens.get(token);
      for (const map of [state.refreshTokens, state.accessTokens]) {
        for (const [key, value] of map) if (key === token || (owner && value === owner)) map.delete(key);
      }
      return { status: 200, headers: {}, body: Buffer.alloc(0) };
    }

    const owner = caller(headers);
    if (url.pathname.startsWith("/drive/v3") || url.pathname.startsWith("/upload/drive/v3")) {
      if (!owner) return googleError(401, "authError", "Invalid Credentials");
    }

    if (method === "GET" && url.pathname === "/drive/v3/about") {
      state.counts.abouts += 1;
      return json(200, { user: { emailAddress: emailOf(owner), displayName: "Drive Tester", permissionId: owner, me: true } });
    }

    if (method === "GET" && url.pathname === "/drive/v3/files/generateIds") {
      if (url.searchParams.get("count") !== "1" || url.searchParams.get("space") !== "drive" || url.searchParams.get("type") !== "files") {
        return json(400, { error: "bad generateIds request" });
      }
      state.counts.generateIds += 1;
      const id = `reserved${base64Url(randomBytes(12))}`;
      state.reservedIds.add(id);
      return json(200, { kind: "drive#generatedIds", space: "drive", ids: [id] });
    }

    if (method === "GET" && url.pathname === "/drive/v3/files/root") {
      if (state.faults.root) return googleError(Number(state.faults.root.slice(7)), "forbidden");
      return json(200, { id: ROOT_ID, mimeType: "application/vnd.google-apps.folder" });
    }

    if (method === "GET" && url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const files = [...state.files.values()].filter((file) => file.owner === owner &&
        q.includes(`value='${file.appProperties[OPERATION_PROPERTY]}'`));
      return json(200, { files: files.map((file) => ({ id: file.id, appProperties: file.appProperties })) });
    }

    if (method === "POST" && url.pathname === "/upload/drive/v3/files") {
      state.counts.uploadPosts += 1;
      const fault = state.faults.nextUpload;
      state.faults.nextUpload = null;
      if (fault && fault.startsWith("status:")) return googleError(Number(fault.slice(7)), "backendError");
      if (fault === "drop-before-store") return { fault: "drop" };
      const { metadata, bytes } = parseMultipart(headers["content-type"], body);
      if (typeof metadata.id !== "string" || !state.reservedIds.has(metadata.id)) {
        return googleError(400, "invalid", "The provided file ID is not usable.");
      }
      if (state.files.has(metadata.id)) {
        state.counts.conflicts += 1;
        return googleError(409, "duplicate", "A file already exists with the provided ID.");
      }
      const parents = (metadata.parents ?? []).map((parent) => (parent === "root" ? ROOT_ID : parent));
      if (!parents.includes(ROOT_ID)) return googleError(404, "notFound", "File not found: parent.");
      const stored = fault === "corrupt-bytes" ? Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from("x")]) : bytes;
      state.files.set(metadata.id, { id: metadata.id, owner, name: metadata.name, mimeType: metadata.mimeType,
        parents, appProperties: metadata.appProperties ?? {}, bytes: stored });
      if (fault === "drop-after-store") return { fault: "drop" };
      if (fault === "hang") return { fault: "hang" };
      return json(200, { id: metadata.id, name: metadata.name });
    }

    const fileMatch = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (method === "GET" && fileMatch) {
      state.counts.gets += 1;
      if (state.faults.get) return googleError(Number(state.faults.get.slice(7)), "backendError");
      const file = state.files.get(fileMatch[1]);
      if (!file || file.owner !== owner) return googleError(404, "notFound", "File not found.");
      if (url.searchParams.get("alt") === "media") {
        if (state.faults.nextMedia === "oversized") {
          state.faults.nextMedia = null;
          return { status: 200, headers: { "Content-Type": file.mimeType }, body: Buffer.alloc(6 * 1024 * 1024, 1) };
        }
        return { status: 200, headers: { "Content-Type": file.mimeType }, body: file.bytes };
      }
      return json(200, { id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents,
        size: String(file.bytes.length), appProperties: file.appProperties });
    }

    return json(404, { error: "not_found" });
  }

  function headerObject(headers) {
    if (!headers) return {};
    if (typeof headers.forEach === "function" && !Array.isArray(headers)) {
      const result = {};
      headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
      return result;
    }
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  }

  async function bodyBuffer(body) {
    if (!body) return Buffer.alloc(0);
    if (typeof body === "string") return Buffer.from(body);
    if (typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
    return Buffer.from(body);
  }

  /** fetch-compatible adapter for unit tests. */
  async function fakeFetch(input, init = {}) {
    const body = await bodyBuffer(init.body);
    const result = handle(init.method ?? "GET", String(input), headerObject(init.headers), body);
    if (result.fault === "drop") throw new TypeError("fetch failed");
    if (result.fault === "hang") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(result.body.length === 0 ? null : result.body, { status: result.status, headers: result.headers });
  }

  /** Loopback HTTP server for the Electron E2E. */
  async function listen() {
    const sockets = new Set();
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const result = handle(request.method, `http://127.0.0.1${request.url}`, headerObject(request.headers), Buffer.concat(chunks));
        if (result.fault === "drop") return request.socket.destroy();
        if (result.fault === "hang") return undefined;
        response.writeHead(result.status, result.headers);
        response.end(result.body);
      });
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
    };
  }

  /**
   * Plays the system browser for a sign-in URL: asks the fake authorize endpoint, then
   * follows its redirect to the app's loopback receiver with a real HTTP request.
   */
  async function completeBrowserSignIn(authorizeUrl) {
    const result = handle("GET", authorizeUrl, {}, Buffer.alloc(0));
    if (result.status !== 302) return result.status;
    const response = await fetch(result.headers.Location);
    await response.text();
    return response.status;
  }

  function signInAs(email, permissionId) {
    state.account = { email, permissionId };
  }

  return {
    state,
    handle,
    fetch: fakeFetch,
    listen,
    signInAs,
    completeBrowserSignIn,
    uploadedFiles: () => [...state.files.values()],
  };
}

module.exports = { createFakeGoogle, DRIVE_FILE_SCOPE, ROOT_ID, OPERATION_PROPERTY };
