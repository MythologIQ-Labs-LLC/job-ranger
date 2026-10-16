// Deterministic in-process fake of the Google endpoints Job Ranger uses for
// Drive export (#314): OAuth authorize/token/revoke, Drive about, files.list,
// files.generateIds, files.create (folder), multipart upload and files.get.
// Used as an injected fetch by unit tests and as a loopback HTTP server by the
// Electron E2E. It never talks to the real Google network.
//
// Modelled Google behaviour that matters for duplicate safety:
// - files.list is eventually consistent: with `listLag` set, a new file stays
//   invisible to searches for that many list calls; files.get is immediate.
// - a create with an id that already exists fails with 409.
// - revoking any token of a grant revokes the whole grant (all its tokens).
// - files and grants belong to the account that signed in.
const http = require("node:http");
const { createHash, randomBytes } = require("node:crypto");

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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
  const delimiter = Buffer.from(`--${match[1]}`);
  const first = body.indexOf(delimiter);
  const second = body.indexOf(delimiter, first + delimiter.length);
  const closing = body.indexOf(Buffer.from(`\r\n--${match[1]}--`), second + delimiter.length);
  const part = (start, end) => {
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
    return { headers: body.subarray(start, headerEnd).toString("utf8"), data: body.subarray(headerEnd + 4, end) };
  };
  const metadataPart = part(first + delimiter.length, second - 2);
  const filePart = part(second + delimiter.length, closing);
  return { metadata: JSON.parse(metadataPart.data.toString("utf8")), contentHeaders: filePart.headers, bytes: Buffer.from(filePart.data) };
}

function createFakeGoogle(options = {}) {
  const state = {
    clientId: options.clientId ?? null,
    grantedScope: options.grantedScope ?? DRIVE_FILE_SCOPE,
    /** The account the next sign-in completes as. */
    account: { email: options.email ?? "drive-tester@example.test", permissionId: options.permissionId ?? "01234567890123456789" },
    codes: new Map(),
    /** token -> permissionId */
    accessTokens: new Map(),
    refreshTokens: new Map(),
    revoked: [],
    files: new Map(),
    reservedIds: new Set(),
    lateCommits: [],
    requests: [],
    /** files.list calls that miss a newly created file (eventual consistency). */
    listLag: 0,
    counts: { uploadPosts: 0, folderCreates: 0, tokenExchanges: 0, refreshes: 0, lists: 0, gets: 0, generateIds: 0, conflicts: 0 },
    faults: {
      nextUpload: null,
      omitSha256: false,
      corruptNextUploadSize: false,
      corruptNextUploadSha256: false,
      refresh: null,
      rotateRefreshToken: false,
      omitRefreshToken: false,
      tokenType: null,
      denyAuthorization: false,
      authorizeError: null,
      tamperChallenge: false,
      redirectMismatch: false,
      token: null,
      lastAuthorizeParams: null,
    },
  };
  let nextId = 1;

  function issueAccessToken(permissionId) {
    const token = `fake-access-${base64Url(randomBytes(9))}`;
    state.accessTokens.set(token, permissionId);
    return token;
  }

  function issueRefreshToken(permissionId) {
    const token = `fake-refresh-${base64Url(randomBytes(9))}`;
    state.refreshTokens.set(token, permissionId);
    return token;
  }

  function caller(headers) {
    const header = headers.authorization ?? headers.Authorization ?? "";
    return state.accessTokens.get(header.replace(/^Bearer /, "")) ?? null;
  }

  function publicFile(file, fields) {
    const view = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.mimeType.endsWith("folder") ? undefined : String(file.size),
      md5Checksum: file.md5,
      sha256Checksum: state.faults.omitSha256 ? undefined : file.sha256,
      webViewLink: `https://drive.google.com/file/d/${file.id}/view`,
      appProperties: file.appProperties,
      trashed: file.trashed,
    };
    if (!fields) return view;
    const wanted = fields.replace(/^files\(|\)$/g, "").split(",");
    return Object.fromEntries(Object.entries(view).filter(([key, value]) => wanted.includes(key) && value !== undefined));
  }

  function matchesQuery(file, q) {
    if (/trashed=false/.test(q) && file.trashed) return false;
    for (const match of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']*)' \}/g)) {
      if (file.appProperties?.[match[1]] !== match[2]) return false;
    }
    const mime = /mimeType='([^']+)'/.exec(q);
    return !mime || file.mimeType === mime[1];
  }

  function createFile(metadata, bytes, owner) {
    const id = metadata.id ?? `fakefile${String(nextId++).padStart(4, "0")}`;
    const file = {
      id,
      owner,
      name: metadata.name,
      mimeType: metadata.mimeType,
      parents: metadata.parents ?? [],
      appProperties: metadata.appProperties ?? {},
      bytes,
      size: bytes ? bytes.length : 0,
      md5: bytes ? createHash("md5").update(bytes).digest("hex") : undefined,
      sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : undefined,
      trashed: false,
      visibleAtList: state.counts.lists + state.listLag,
    };
    state.files.set(id, file);
    return file;
  }

  /** Commits uploads that Google accepted after the client had already given up. */
  function commitLate() {
    for (const pending of state.lateCommits.splice(0)) {
      if (!state.files.has(pending.metadata.id)) createFile(pending.metadata, pending.bytes, pending.owner);
    }
  }

  /** Returns { status, headers, body } or { fault: 'hang' | 'drop', ... } for the transport to act on. */
  function handle(method, rawUrl, headers, body) {
    const url = new URL(rawUrl);
    state.requests.push({ method, path: url.pathname });
    const form = () => new URLSearchParams(body.toString("utf8"));

    if (method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
      const params = Object.fromEntries(url.searchParams);
      state.faults.lastAuthorizeParams = params;
      const redirect = new URL(params.redirect_uri);
      if (state.faults.denyAuthorization || state.faults.authorizeError) {
        redirect.searchParams.set("error", state.faults.authorizeError ?? "access_denied");
      } else {
        if (params.response_type !== "code" || params.code_challenge_method !== "S256" || params.scope !== DRIVE_FILE_SCOPE) {
          return json(400, { error: "invalid_request" });
        }
        const code = `fake-code-${base64Url(randomBytes(9))}`;
        state.codes.set(code, {
          // Faults model a stolen code replayed with another verifier or redirect URI.
          challenge: state.faults.tamperChallenge ? base64Url(createHash("sha256").update("other-verifier").digest()) : params.code_challenge,
          redirectUri: state.faults.redirectMismatch ? "http://127.0.0.1:1" : params.redirect_uri,
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
      const tokenFault = state.faults.token;
      state.faults.token = null;
      if (tokenFault === "malformed") return { status: 200, headers: { "Content-Type": "application/json" }, body: Buffer.from("{not json") };
      if (tokenFault && tokenFault.startsWith("status:")) return json(Number(tokenFault.slice(7)), { error: "server_error" });
      if (state.clientId && values.get("client_id") !== state.clientId) return json(401, { error: "invalid_client" });
      const tokenType = state.faults.tokenType ?? "Bearer";
      if (values.get("grant_type") === "authorization_code") {
        state.counts.tokenExchanges += 1;
        const entry = state.codes.get(values.get("code"));
        state.codes.delete(values.get("code"));
        const verifier = values.get("code_verifier") ?? "";
        const challenge = base64Url(createHash("sha256").update(verifier).digest());
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== values.get("redirect_uri")) {
          return json(400, { error: "invalid_grant", error_description: "Bad code or verifier" });
        }
        return json(200, {
          access_token: issueAccessToken(entry.permissionId),
          expires_in: 3599,
          ...(state.faults.omitRefreshToken ? {} : { refresh_token: issueRefreshToken(entry.permissionId) }),
          scope: state.grantedScope,
          token_type: tokenType,
        });
      }
      if (values.get("grant_type") === "refresh_token") {
        state.counts.refreshes += 1;
        const owner = state.refreshTokens.get(values.get("refresh_token"));
        if (state.faults.refresh === "invalid_grant" || !owner) {
          return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        }
        const rotated = state.faults.rotateRefreshToken ? { refresh_token: issueRefreshToken(owner) } : {};
        if (state.faults.rotateRefreshToken) {
          state.faults.rotateRefreshToken = false;
          state.refreshTokens.delete(values.get("refresh_token"));
        }
        return json(200, { access_token: issueAccessToken(owner), expires_in: 3599, scope: state.grantedScope, token_type: tokenType, ...rotated });
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    if (method === "POST" && url.pathname === "/revoke") {
      const token = form().get("token");
      state.revoked.push(token);
      // Revoking any token ends the whole grant for that account.
      const owner = state.refreshTokens.get(token) ?? state.accessTokens.get(token);
      for (const map of [state.refreshTokens, state.accessTokens]) {
        for (const [key, value] of map) if (key === token || (owner && value === owner)) map.delete(key);
      }
      return { status: 200, headers: {}, body: Buffer.alloc(0) };
    }

    let owner = null;
    if (url.pathname.startsWith("/drive/v3") || url.pathname.startsWith("/upload/drive/v3")) {
      owner = caller(headers);
      if (!owner) return googleError(401, "authError", "Invalid Credentials");
    }

    if (method === "GET" && url.pathname === "/drive/v3/about") {
      const email = owner === state.account.permissionId ? state.account.email : `${owner}@example.test`;
      return json(200, { user: { emailAddress: email, displayName: "Drive Tester", permissionId: owner } });
    }

    if (method === "GET" && url.pathname === "/drive/v3/files/generateIds") {
      state.counts.generateIds += 1;
      const id = `reserved${base64Url(randomBytes(12))}`;
      state.reservedIds.add(id);
      return json(200, { kind: "drive#generatedIds", space: "drive", ids: [id] });
    }

    if (method === "GET" && url.pathname === "/drive/v3/files") {
      state.counts.lists += 1;
      const q = url.searchParams.get("q") ?? "";
      const files = [...state.files.values()].filter(
        (file) => file.owner === owner && state.counts.lists > file.visibleAtList && matchesQuery(file, q),
      );
      return json(200, { files: files.map((file) => publicFile(file, url.searchParams.get("fields"))) });
    }

    if (method === "POST" && url.pathname === "/drive/v3/files") {
      state.counts.folderCreates += 1;
      return json(200, publicFile(createFile(JSON.parse(body.toString("utf8")), null, owner), "id"));
    }

    if (method === "POST" && url.pathname === "/upload/drive/v3/files") {
      state.counts.uploadPosts += 1;
      commitLate();
      const fault = state.faults.nextUpload;
      state.faults.nextUpload = null;
      if (fault && fault.startsWith("status:")) {
        const [, status, reason] = fault.split(":");
        return googleError(Number(status), reason ?? "backendError");
      }
      if (fault === "reset-before-store") return { fault: "drop" };
      const { metadata, bytes } = parseMultipart(headers["content-type"] ?? headers["Content-Type"], body);
      if (metadata.id && state.files.has(metadata.id)) {
        state.counts.conflicts += 1;
        return googleError(409, "duplicate", "A file already exists with the provided ID.");
      }
      if (metadata.id && !state.reservedIds.has(metadata.id)) return googleError(400, "invalid", "The provided file ID is not usable.");
      const parent = metadata.parents?.[0];
      if (parent && !state.files.has(parent)) return googleError(404, "notFound", "File not found: parent.");
      if (fault === "commit-late") {
        // Google accepts the request but commits it only after the client gave up.
        state.lateCommits.push({ metadata, bytes, owner });
        return { fault: "hang" };
      }
      const file = createFile(metadata, bytes, owner);
      if (state.faults.corruptNextUploadSize) {
        state.faults.corruptNextUploadSize = false;
        file.size += 1;
      }
      if (state.faults.corruptNextUploadSha256) {
        state.faults.corruptNextUploadSha256 = false;
        file.sha256 = "0".repeat(64);
      }
      if (fault === "hang" || fault === "drop") return { fault, file };
      // Drive committed the file but the response reported a server error.
      if (fault === "5xx-after-commit") return googleError(503, "backendError");
      if (fault === "malformed") return { status: 200, headers: { "Content-Type": "application/json" }, body: Buffer.from("{\"id\": ") };
      if (fault === "missing-id") return json(200, { name: file.name });
      return json(200, publicFile(file, url.searchParams.get("fields")));
    }

    const fileMatch = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (method === "GET" && fileMatch) {
      state.counts.gets += 1;
      const file = state.files.get(fileMatch[1]);
      return file && file.owner === owner ? json(200, publicFile(file, url.searchParams.get("fields"))) : googleError(404, "notFound");
    }

    return json(404, { error: "not_found" });
  }

  function headerObject(headers) {
    if (!headers) return {};
    if (typeof headers.forEach === "function" && !Array.isArray(headers)) {
      const result = {};
      headers.forEach((value, key) => {
        result[key.toLowerCase()] = value;
      });
      return result;
    }
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  }

  /** fetch-compatible adapter for unit tests. */
  async function fakeFetch(input, init = {}) {
    const body = init.body ? Buffer.from(typeof init.body === "string" ? init.body : init.body) : Buffer.alloc(0);
    const result = handle(init.method ?? "GET", String(input), headerObject(init.headers), body);
    if (result.fault === "drop") throw new TypeError("fetch failed");
    if (result.fault === "hang") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(result.status === 302 || result.body.length === 0 ? null : result.body, { status: result.status, headers: result.headers });
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
      close: () =>
        new Promise((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    };
  }

  /** Switches which Google account the next sign-in completes as. */
  function signInAs(email, permissionId) {
    state.account = { email, permissionId };
  }

  return {
    state,
    handle,
    fetch: fakeFetch,
    listen,
    signInAs,
    uploadedFiles: () => [...state.files.values()].filter((file) => file.bytes),
  };
}

module.exports = { createFakeGoogle, DRIVE_FILE_SCOPE };
