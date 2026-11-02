// Google Drive storage-location routes (#249) layered over #369's fake Google
// (tests/support/fake-google-drive.cjs), which keeps owning OAuth, about, generateIds,
// files.get and alt=media. This adds what a storage folder needs: folder create, the
// parent/appProperties searches, multipart and resumable (308 "Resume Incomplete")
// uploads into app folders, and delete. Files live in the base fake's state.files, so
// metadata and byte readback go through the base routes unchanged.
const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { createFakeGoogle, ROOT_ID } = require("./fake-google-drive.cjs");

const FOLDER_MIME = "application/vnd.google-apps.folder";

function json(status, body, headers = {}) {
  return { status, headers: { "Content-Type": "application/json", ...headers }, body: Buffer.from(JSON.stringify(body)) };
}

function googleError(status, reason) {
  return json(status, { error: { code: status, message: reason, errors: [{ reason, message: reason }] } });
}

function parseMultipart(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(contentType ?? "")[1];
  const headerEnd = (from) => body.indexOf("\r\n\r\n", from) + 4;
  const firstStart = headerEnd(0);
  const secondDelimiter = body.indexOf(`\r\n--${boundary}\r\n`, firstStart);
  const metadata = JSON.parse(body.subarray(firstStart, secondDelimiter).toString("utf8"));
  const bytesStart = headerEnd(secondDelimiter + 2);
  const bytesEnd = body.lastIndexOf(`\r\n--${boundary}--`);
  return { metadata, bytes: Buffer.from(body.subarray(bytesStart, bytesEnd)) };
}

/** Evaluates the small query language subset Sojourner sends. */
function matchesQuery(file, q) {
  if (/trashed = false/.test(q) && file.trashed) return false;
  const parent = /'([^']+)' in parents/.exec(q);
  if (parent) {
    const id = parent[1] === "root" ? ROOT_ID : parent[1];
    if (!file.parents.includes(id)) return false;
  }
  const mime = /mimeType = '([^']+)'/.exec(q);
  if (mime && file.mimeType !== mime[1]) return false;
  const property = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/.exec(q);
  if (property && file.appProperties?.[property[1]] !== property[2]) return false;
  return true;
}

function createFakeGoogleStorage(options = {}) {
  const google = createFakeGoogle(options);
  const { state } = google;
  const sessions = new Map();
  state.storage = {
    counts: { folderCreates: 0, multipart: 0, resumableStarts: 0, chunks: 0, deletes: 0, lists: 0 },
    faults: { /** Queue of "status:<code>" for the next storage upload request. */ upload: [], nextUpload: null },
  };

  function owner(headers) {
    const token = (headers.authorization ?? "").replace(/^Bearer /, "");
    return state.accessTokens.get(token) ?? null;
  }

  function put(fileOwner, metadata, bytes) {
    if (typeof metadata.id !== "string" || !state.reservedIds.has(metadata.id)) return googleError(400, "invalid id");
    if (state.files.has(metadata.id)) return googleError(409, "duplicate");
    const parents = (metadata.parents ?? []).map((id) => (id === "root" ? ROOT_ID : id));
    if (!parents.every((id) => id === ROOT_ID || state.files.get(id)?.mimeType === FOLDER_MIME)) return googleError(404, "parent not found");
    const corrupt = state.storage.faults.nextUpload === "corrupt";
    state.storage.faults.nextUpload = null;
    const stored = corrupt ? Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from("x")]) : bytes;
    state.files.set(metadata.id, { id: metadata.id, owner: fileOwner, name: metadata.name, mimeType: metadata.mimeType,
      parents, appProperties: metadata.appProperties ?? {}, bytes: stored, createdTime: new Date(Date.now() + state.files.size).toISOString() });
    return json(200, { id: metadata.id });
  }

  function handle(method, rawUrl, headers, body) {
    const url = new URL(rawUrl);
    const path = url.pathname;
    const caller = owner(headers);
    const storageRoute = (method === "POST" && path === "/drive/v3/files") ||
      (method === "GET" && path === "/drive/v3/files" && /in parents|sojournerStorage/.test(url.searchParams.get("q") ?? "")) ||
      (method === "DELETE" && path.startsWith("/drive/v3/files/")) ||
      (path === "/upload/drive/v3/files" && (url.searchParams.get("uploadType") === "resumable" || method === "PUT")) ||
      (method === "POST" && path === "/upload/drive/v3/files" && /sojournerStorageRecord/.test(body.toString("latin1")));
    if (!storageRoute) return google.handle(method, rawUrl, headers, body);
    state.requests.push({ method, path, search: url.search });
    if (!caller) return googleError(401, "authError");

    if (path.startsWith("/upload/")) {
      const fault = state.storage.faults.upload.shift();
      if (fault) return googleError(Number(fault.slice(7)), "backendError");
    }

    if (method === "POST" && path === "/drive/v3/files") {
      const metadata = JSON.parse(body.toString("utf8"));
      if (metadata.mimeType !== FOLDER_MIME) return googleError(400, "only folders are created here");
      state.storage.counts.folderCreates += 1;
      const id = `folder${randomBytes(9).toString("hex")}`;
      const parents = (metadata.parents ?? ["root"]).map((parent) => (parent === "root" ? ROOT_ID : parent));
      state.files.set(id, { id, owner: caller, name: metadata.name, mimeType: FOLDER_MIME, parents,
        appProperties: metadata.appProperties ?? {}, bytes: Buffer.alloc(0), createdTime: new Date().toISOString() });
      return json(200, { id, mimeType: FOLDER_MIME });
    }

    if (method === "GET" && path === "/drive/v3/files") {
      state.storage.counts.lists += 1;
      const q = url.searchParams.get("q") ?? "";
      const files = [...state.files.values()].filter((file) => file.owner === caller && matchesQuery(file, q))
        .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""));
      return json(200, { files: files.map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType,
        size: file.mimeType === FOLDER_MIME ? undefined : String(file.bytes.length), parents: file.parents,
        createdTime: file.createdTime, appProperties: file.appProperties })) });
    }

    if (method === "DELETE") {
      state.storage.counts.deletes += 1;
      const id = path.slice("/drive/v3/files/".length);
      const file = state.files.get(id);
      if (!file || file.owner !== caller) return googleError(404, "notFound");
      state.files.delete(id);
      return { status: 204, headers: {}, body: Buffer.alloc(0) };
    }

    if (method === "POST" && url.searchParams.get("uploadType") === "multipart") {
      state.storage.counts.multipart += 1;
      const { metadata, bytes } = parseMultipart(headers["content-type"], body);
      return put(caller, metadata, bytes);
    }

    if (method === "POST" && url.searchParams.get("uploadType") === "resumable") {
      state.storage.counts.resumableStarts += 1;
      const metadata = JSON.parse(body.toString("utf8"));
      if (state.files.has(metadata.id)) return googleError(409, "duplicate");
      const uploadId = randomBytes(12).toString("hex");
      sessions.set(uploadId, { metadata, owner: caller, size: Number(headers["x-upload-content-length"]), received: Buffer.alloc(0) });
      return { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}` }, body: Buffer.alloc(0) };
    }

    if (method === "PUT") {
      state.storage.counts.chunks += 1;
      const session = sessions.get(url.searchParams.get("upload_id"));
      if (!session) return googleError(404, "session not found");
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers["content-range"] ?? "");
      if (!range || Number(range[1]) !== session.received.length || Number(range[3]) !== session.size) return googleError(400, "bad range");
      session.received = Buffer.concat([session.received, body]);
      if (session.received.length < session.size) {
        return { status: 308, headers: { Range: `bytes=0-${session.received.length - 1}` }, body: Buffer.alloc(0) };
      }
      sessions.delete(url.searchParams.get("upload_id"));
      return put(session.owner, session.metadata, session.received);
    }
    return googleError(400, "unexpected storage request");
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

  async function fakeFetch(input, init = {}) {
    const result = handle(init.method ?? "GET", String(input), headerObject(init.headers), await bodyBuffer(init.body));
    if (result.fault === "drop") throw new TypeError("fetch failed");
    if (result.fault === "hang") return new Promise(() => undefined);
    return new Response(result.body.length === 0 || result.status === 204 ? null : result.body, { status: result.status, headers: result.headers });
  }

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

  return {
    ...google,
    handle,
    fetch: fakeFetch,
    listen,
    storageFiles: (folderName) => {
      const folder = [...state.files.values()].find((file) => file.mimeType === FOLDER_MIME && file.name === folderName);
      return folder ? [...state.files.values()].filter((file) => file.parents.includes(folder.id)) : [];
    },
  };
}

module.exports = { createFakeGoogleStorage, FOLDER_MIME };
