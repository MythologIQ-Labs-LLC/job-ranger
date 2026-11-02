// Deterministic fake of the Microsoft endpoints the Windows OneDrive storage location
// uses (#249): the identity platform (authorize, token with PKCE and rotating refresh
// tokens) and the Microsoft Graph app folder (approot, Backups/ and Documents/ children,
// simple PUT, upload sessions on a content host, downloads on a content host, delete).
// Used as an injected fetch by unit tests and as a loopback HTTP server by the Electron
// E2E. It routes by path only, so requests keep their real Microsoft origins in unit
// tests and arrive on 127.0.0.1 in the E2E. It never talks to the real network.
//
// Modelled behaviour that matters:
// - only the app folder exists for the app (scope Files.ReadWrite.AppFolder);
// - conflictBehavior=fail answers 409 for an existing name;
// - upload sessions take ordered Content-Range chunks and answer 202, then 201 with the item;
// - session and download URLs are pre-authenticated: a request carrying Authorization is refused;
// - refresh tokens rotate; an old one stops working.
const http = require("node:http");
const { createHash, randomBytes } = require("node:crypto");

const APP_SCOPE = "Files.ReadWrite.AppFolder offline_access";
const DRIVE_ID = "fakedrive0123456789";
const CONTENT_UPLOAD = "https://upload.fake.1drv.com";
const CONTENT_DOWNLOAD = "https://download.fake.1drv.com";

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(status, body, headers = {}) {
  return { status, headers: { "Content-Type": "application/json", ...headers }, body: Buffer.from(JSON.stringify(body)) };
}

function graphError(status, code, message = code) {
  return json(status, { error: { code, message } });
}

function createFakeOneDrive(options = {}) {
  const state = {
    clientId: options.clientId ?? null,
    grantedScope: options.grantedScope ?? "https://graph.microsoft.com/Files.ReadWrite.AppFolder",
    driveType: options.driveType ?? "personal",
    codes: new Map(),
    accessTokens: new Set(),
    refreshTokens: new Set(),
    /** folder name -> Map(name -> item) */
    folders: new Map(),
    sessions: new Map(),
    downloads: new Map(),
    requests: [],
    counts: { tokenExchanges: 0, refreshes: 0, simplePuts: 0, sessions: 0, chunks: 0, downloads: 0, deletes: 0, unauthorized: 0 },
    faults: {
      /** Queue of "status:<code>" answers for the next Graph (graph.microsoft.com) requests. */
      graph: [],
      /** "corrupt" stores different bytes than were sent for the next completed upload. */
      nextUpload: null,
      /** Queue of "status:<code>" answers for the next upload-session chunk PUTs. */
      chunk: [],
      /** Expire every access token (the next Graph call answers 401). */
      expireAccess: false,
      denyAuthorization: false,
      refresh: null,
      lastAuthorizeParams: null,
    },
  };
  let nextId = 1;

  function issue(set, prefix) {
    const token = `${prefix}-${base64Url(randomBytes(12))}`;
    set.add(token);
    return token;
  }

  function authorized(headers) {
    const token = (headers.authorization ?? "").replace(/^Bearer /, "");
    if (state.faults.expireAccess) {
      state.faults.expireAccess = false;
      state.accessTokens.clear();
    }
    return state.accessTokens.has(token);
  }

  function folderItems(name) {
    if (!state.folders.has(name)) return null;
    return state.folders.get(name);
  }

  function itemView(folder, item, baseUrl) {
    const token = base64Url(randomBytes(9));
    state.downloads.set(token, { folder, name: item.name });
    return {
      id: item.id, name: item.name, size: item.bytes.length, createdDateTime: item.createdDateTime,
      file: { mimeType: "application/octet-stream", hashes: { quickXorHash: "fake" } },
      parentReference: { driveId: DRIVE_ID, path: `/drive/root:/Apps/Sojourner/${folder}` },
      "@microsoft.graph.downloadUrl": `${baseUrl ?? CONTENT_DOWNLOAD}/dl/${token}`,
    };
  }

  function store(folder, name, bytes) {
    const items = folderItems(folder);
    const corrupt = state.faults.nextUpload === "corrupt";
    state.faults.nextUpload = null;
    const stored = corrupt ? Buffer.concat([bytes.subarray(0, Math.max(0, bytes.length - 1)), Buffer.from("x")]) : bytes;
    const item = { id: `item${String(nextId++).padStart(6, "0")}`, name, bytes: stored, createdDateTime: new Date(Date.now() + nextId).toISOString() };
    items.set(name, item);
    return item;
  }

  /** Returns { status, headers, body } or { fault: "drop" }. */
  function handle(method, rawUrl, headers, body) {
    const url = new URL(rawUrl);
    const path = decodeURIComponent(url.pathname);
    state.requests.push({ method, path, search: url.search, authorization: Boolean(headers.authorization) });
    const form = () => new URLSearchParams(body.toString("utf8"));

    if (method === "GET" && path === "/common/oauth2/v2.0/authorize") {
      const params = Object.fromEntries(url.searchParams);
      state.faults.lastAuthorizeParams = params;
      const redirect = new URL(params.redirect_uri);
      if (state.faults.denyAuthorization) {
        redirect.searchParams.set("error", "access_denied");
      } else {
        if (params.response_type !== "code" || params.code_challenge_method !== "S256" || params.scope !== APP_SCOPE ||
            redirect.protocol !== "http:" || redirect.hostname !== "localhost") {
          return json(400, { error: "invalid_request" });
        }
        const code = `fake-ms-code-${base64Url(randomBytes(9))}`;
        state.codes.set(code, { challenge: params.code_challenge, redirectUri: params.redirect_uri, clientId: params.client_id });
        redirect.searchParams.set("code", code);
      }
      redirect.searchParams.set("state", params.state);
      return { status: 302, headers: { Location: redirect.toString() }, body: Buffer.alloc(0) };
    }

    if (method === "POST" && path === "/common/oauth2/v2.0/token") {
      const values = form();
      if (headers.origin) return json(400, { error: "invalid_request", error_description: "AADSTS9002327 cross-origin" });
      if (state.clientId && values.get("client_id") !== state.clientId) return json(400, { error: "invalid_client" });
      if (values.get("client_secret")) return json(400, { error: "invalid_request", error_description: "public client" });
      if (values.get("scope") !== APP_SCOPE) return json(400, { error: "invalid_scope" });
      if (values.get("grant_type") === "authorization_code") {
        state.counts.tokenExchanges += 1;
        const entry = state.codes.get(values.get("code"));
        state.codes.delete(values.get("code"));
        const challenge = base64Url(createHash("sha256").update(values.get("code_verifier") ?? "").digest());
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== values.get("redirect_uri")) {
          return json(400, { error: "invalid_grant" });
        }
      } else if (values.get("grant_type") === "refresh_token") {
        state.counts.refreshes += 1;
        const token = values.get("refresh_token");
        if (state.faults.refresh === "invalid_grant" || !state.refreshTokens.has(token)) return json(400, { error: "invalid_grant" });
        state.refreshTokens.delete(token);
      } else {
        return json(400, { error: "unsupported_grant_type" });
      }
      return json(200, {
        token_type: "Bearer", scope: state.grantedScope, expires_in: 3600, ext_expires_in: 3600,
        access_token: issue(state.accessTokens, "fake-ms-access"), refresh_token: issue(state.refreshTokens, "fake-ms-refresh"),
      });
    }

    const upload = /^\/up\/([A-Za-z0-9_-]+)$/.exec(path);
    if (method === "PUT" && upload) {
      if (headers.authorization) return graphError(401, "unauthenticated", "Do not send Authorization to the upload URL");
      const session = state.sessions.get(upload[1]);
      if (!session) return graphError(404, "itemNotFound", "Upload session expired");
      state.counts.chunks += 1;
      const fault = state.faults.chunk.shift();
      if (fault) return graphError(Number(fault.slice(7)), "serviceNotAvailable");
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers["content-range"] ?? "");
      if (!range || Number(range[1]) !== session.received.length || Number(range[3]) !== session.size ||
          Number(range[2]) - Number(range[1]) + 1 !== body.length) {
        return graphError(416, "invalidRange");
      }
      session.received = Buffer.concat([session.received, body]);
      if (session.received.length < session.size) {
        return json(202, { nextExpectedRanges: [`${session.received.length}-`] });
      }
      state.sessions.delete(upload[1]);
      if (folderItems(session.folder).has(session.name)) return graphError(409, "nameAlreadyExists");
      return json(201, itemView(session.folder, store(session.folder, session.name, session.received), session.baseUrl));
    }

    const download = /^\/dl\/([A-Za-z0-9_-]+)$/.exec(path);
    if (method === "GET" && download) {
      if (headers.authorization) return graphError(401, "unauthenticated");
      const target = state.downloads.get(download[1]);
      state.downloads.delete(download[1]);
      const item = target && folderItems(target.folder)?.get(target.name);
      if (!item) return graphError(404, "itemNotFound");
      state.counts.downloads += 1;
      return { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Length": String(item.bytes.length) }, body: item.bytes };
    }

    if (!path.startsWith("/v1.0/")) return json(404, { error: "not_found" });
    if (!authorized(headers)) {
      state.counts.unauthorized += 1;
      return graphError(401, "InvalidAuthenticationToken");
    }
    const fault = state.faults.graph.shift();
    if (fault) {
      const status = Number(fault.slice(7));
      return graphError(status, status === 429 ? "activityLimitReached" : "serviceNotAvailable", "fault", );
    }

    const root = "/v1.0/me/drive/special/approot";
    if (method === "GET" && path === root) {
      return json(200, { id: "approotitem", name: "Sojourner", folder: { childCount: state.folders.size },
        parentReference: { driveId: DRIVE_ID, driveType: state.driveType } });
    }
    if (method === "POST" && path === `${root}/children`) {
      const request = JSON.parse(body.toString("utf8"));
      if (state.folders.has(request.name)) return graphError(409, "nameAlreadyExists");
      state.folders.set(request.name, new Map());
      return json(201, { id: `folder-${request.name}`, name: request.name, folder: { childCount: 0 } });
    }
    const match = /^\/v1\.0\/me\/drive\/special\/approot:\/(Backups|Documents)(?:\/([^/:]+))?(?::\/(children|content|createUploadSession))?$/.exec(path);
    if (!match) return graphError(400, "invalidRequest", `unexpected ${method} ${path}`);
    const [, folder, name, action] = match;
    const items = folderItems(folder);
    if (!name) {
      if (!items) return graphError(404, "itemNotFound");
      if (method === "GET" && !action) return json(200, { id: `folder-${folder}`, name: folder, folder: { childCount: items.size } });
      if (method === "GET" && action === "children") {
        return json(200, { value: [...items.values()].map((item) => itemView(folder, item, options.contentBaseUrl)) });
      }
      return graphError(400, "invalidRequest");
    }
    if (!items) return graphError(404, "itemNotFound", "parent missing");
    if (method === "GET" && !action) {
      const item = items.get(name);
      return item ? json(200, itemView(folder, item, options.contentBaseUrl)) : graphError(404, "itemNotFound");
    }
    if (method === "DELETE" && !action) {
      state.counts.deletes += 1;
      if (!items.delete(name)) return graphError(404, "itemNotFound");
      return { status: 204, headers: {}, body: Buffer.alloc(0) };
    }
    if (method === "PUT" && action === "content") {
      state.counts.simplePuts += 1;
      if (url.searchParams.get("@microsoft.graph.conflictBehavior") === "fail" && items.has(name)) return graphError(409, "nameAlreadyExists");
      return json(201, itemView(folder, store(folder, name, body), options.contentBaseUrl));
    }
    if (method === "POST" && action === "createUploadSession") {
      state.counts.sessions += 1;
      if (items.has(name)) return graphError(409, "nameAlreadyExists");
      const id = base64Url(randomBytes(12));
      state.sessions.set(id, { folder, name, size: Number(headers["x-expected-size"] ?? 0) || null, received: Buffer.alloc(0), baseUrl: options.contentBaseUrl });
      return json(200, { uploadUrl: `${options.uploadBaseUrl ?? CONTENT_UPLOAD}/up/${id}`, expirationDateTime: new Date(Date.now() + 3_600_000).toISOString() });
    }
    return graphError(400, "invalidRequest");
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

  /** The upload session learns its total size from the first Content-Range. */
  function withSessionSize(method, rawUrl, headers) {
    const match = /\/up\/([A-Za-z0-9_-]+)$/.exec(new URL(rawUrl).pathname);
    const session = match && state.sessions.get(match[1]);
    if (method === "PUT" && session && session.size === null) {
      const range = /\/(\d+)$/.exec(headers["content-range"] ?? "");
      if (range) session.size = Number(range[1]);
    }
  }

  async function fakeFetch(input, init = {}) {
    const body = await bodyBuffer(init.body);
    const headers = headerObject(init.headers);
    withSessionSize(init.method ?? "GET", String(input), headers);
    const result = handle(init.method ?? "GET", String(input), headers, body);
    if (result.fault === "drop") throw new TypeError("fetch failed");
    return new Response(result.body.length === 0 ? null : result.body, { status: result.status, headers: result.headers });
  }

  async function listen() {
    const sockets = new Set();
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const headers = headerObject(request.headers);
        const target = `http://127.0.0.1${request.url}`;
        withSessionSize(request.method, target, headers);
        const result = handle(request.method, target, headers, Buffer.concat(chunks));
        if (result.fault === "drop") return request.socket.destroy();
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

  /** Plays the system browser: asks the fake authorize endpoint, then follows its redirect to the loopback receiver. */
  async function completeBrowserSignIn(authorizeUrl) {
    const result = handle("GET", authorizeUrl, {}, Buffer.alloc(0));
    if (result.status !== 302) return result.status;
    const response = await fetch(result.headers.Location);
    await response.text();
    return response.status;
  }

  return {
    state, handle, fetch: fakeFetch, listen, completeBrowserSignIn,
    files: (folder) => [...(state.folders.get(folder)?.values() ?? [])],
  };
}

module.exports = { createFakeOneDrive, APP_SCOPE, DRIVE_ID };
