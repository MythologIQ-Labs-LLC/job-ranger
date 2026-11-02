import {
  authorizedRequest, hashResponse, providerFailure, readChunk, STORAGE_FILE_NAME, StorageProviderError, streamToFile,
  type RemoteEntry, type RemoteRef, type RetryPolicy, type StorageFolder, type StorageProvider, type UploadRequest,
} from "./storage-provider.cjs";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ARCHIVE_MIME = "application/octet-stream";
const ID = /^[A-Za-z0-9_-]{1,160}$/;
/** Multipart (one request) up to this size; larger files use a resumable session. */
export const GOOGLE_MULTIPART_LIMIT = 5 * 1024 * 1024;
/** Resumable chunks must be multiples of 256 KiB. */
export const GOOGLE_CHUNK_BYTES = 8 * 1024 * 1024;
export const GOOGLE_STORAGE_PROPERTY = "sojournerStorage";
export const GOOGLE_RECORD_PROPERTY = "sojournerStorageRecord";
export const GOOGLE_KIND_PROPERTY = "sojournerStorageKind";
export const GOOGLE_ROOT_FOLDER_NAME = "Sojourner";

export interface GoogleFolderIds {
  accountId: string;
  rootId: string;
  Backups: string;
  Documents: string;
}

export interface GoogleStorageOptions {
  /** Access token from #369's GoogleDesktopAuth (drive.file). */
  token: (forceRefresh: boolean) => Promise<string>;
  invalidate: () => void;
  accountId: string;
  accountLabel: string;
  /** Storage egress fetch. */
  fetch: typeof fetch;
  folders: GoogleFolderIds | null;
  saveFolders: (folders: GoogleFolderIds) => Promise<void>;
  retry?: RetryPolicy;
}

interface DriveFile {
  id?: unknown;
  name?: unknown;
  size?: unknown;
  mimeType?: unknown;
  parents?: unknown;
  trashed?: unknown;
  createdTime?: unknown;
  appProperties?: Record<string, unknown> | null;
}

const FILE_FIELDS = "id,name,size,mimeType,parents,trashed,createdTime,appProperties";

function quote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Google Drive storage location: a "Sojourner" folder the app creates (drive.file sees
 * only files Sojourner created), with Backups/ and Documents/. Uploads reserve a file id
 * (files.generateIds) that is journaled before any byte is sent, so a retried or
 * interrupted create can never duplicate and files.get on the id proves the outcome;
 * every upload is verified by metadata and a SHA-256 byte readback, as #369 does.
 */
export class GoogleStorageProvider implements StorageProvider {
  readonly kind = "google" as const;
  private folders: GoogleFolderIds | null;

  constructor(private readonly options: GoogleStorageOptions) {
    this.folders = options.folders && options.folders.accountId === options.accountId ? options.folders : null;
  }

  async locationKey(): Promise<string> {
    return this.options.accountId;
  }

  async locationLabel(): Promise<string> {
    return `Google Drive (${this.options.accountLabel}) > ${GOOGLE_ROOT_FOLDER_NAME}`;
  }

  private request(send: (token: string) => Promise<Response>, retryNetwork = true): Promise<Response> {
    return authorizedRequest({ token: this.options.token, invalidate: this.options.invalidate, send,
      policy: this.options.retry, retryNetwork });
  }

  private get(url: string): Promise<Response> {
    return this.request((token) => this.options.fetch(url, { headers: { Authorization: `Bearer ${token}` } }));
  }

  private async json<T>(response: Response, action: string): Promise<T> {
    if (!response.ok) throw providerFailure("Google Drive", response, action);
    try {
      return await response.json() as T;
    } catch {
      throw new StorageProviderError("invalid", `Google Drive returned an invalid answer while ${action}.`);
    }
  }

  private async fileMetadata(id: string): Promise<DriveFile | null> {
    const response = await this.get(`${FILES}/${encodeURIComponent(id)}?fields=${FILE_FIELDS}&supportsAllDrives=false`);
    if (response.status === 404) return null;
    return this.json<DriveFile>(response, "reading file details");
  }

  private async usableFolder(id: string | undefined, marker: string): Promise<boolean> {
    if (!id || !ID.test(id)) return false;
    const file = await this.fileMetadata(id);
    return !!file && file.id === id && file.mimeType === FOLDER_MIME && file.trashed !== true &&
      file.appProperties?.[GOOGLE_STORAGE_PROPERTY] === marker;
  }

  private async findOrCreateFolder(name: string, marker: string, parent: string): Promise<string> {
    const query = `mimeType = '${FOLDER_MIME}' and trashed = false and '${quote(parent)}' in parents and ` +
      `appProperties has { key='${GOOGLE_STORAGE_PROPERTY}' and value='${quote(marker)}' }`;
    const url = new URL(FILES);
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "files(id,name,appProperties)");
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("orderBy", "createdTime");
    const found = await this.json<{ files?: DriveFile[] }>(await this.get(url.toString()), "finding the Sojourner folder");
    const existing = (found.files ?? []).find((file) => typeof file.id === "string" && ID.test(file.id) &&
      file.appProperties?.[GOOGLE_STORAGE_PROPERTY] === marker);
    if (existing) return existing.id as string;
    const created = await this.json<DriveFile>(await this.request((token) => this.options.fetch(`${FILES}?fields=id,mimeType`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties: { [GOOGLE_STORAGE_PROPERTY]: marker } }),
    }), false), "creating the Sojourner folder");
    if (typeof created.id !== "string" || !ID.test(created.id) || created.mimeType !== FOLDER_MIME) {
      throw new StorageProviderError("invalid", "Google Drive did not confirm the new Sojourner folder.");
    }
    return created.id;
  }

  /** Finds or creates Sojourner/, Sojourner/Backups/ and Sojourner/Documents/. */
  async ensureFolders(): Promise<GoogleFolderIds> {
    const cached = this.folders;
    if (cached && await this.usableFolder(cached.rootId, "root") &&
        await this.usableFolder(cached.Backups, "Backups") && await this.usableFolder(cached.Documents, "Documents")) {
      return cached;
    }
    const rootId = cached && await this.usableFolder(cached.rootId, "root")
      ? cached.rootId : await this.findOrCreateFolder(GOOGLE_ROOT_FOLDER_NAME, "root", "root");
    const folders: GoogleFolderIds = {
      accountId: this.options.accountId,
      rootId,
      Backups: await this.findOrCreateFolder("Backups", "Backups", rootId),
      Documents: await this.findOrCreateFolder("Documents", "Documents", rootId),
    };
    this.folders = folders;
    await this.options.saveFolders(folders);
    return folders;
  }

  private async reserveId(): Promise<string> {
    const body = await this.json<{ ids?: unknown }>(
      await this.get(`${FILES}/generateIds?count=1&space=drive&type=files`), "reserving a file");
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string" || !ID.test(ids[0])) {
      throw new StorageProviderError("invalid", "Google Drive returned an invalid file reservation.");
    }
    return ids[0];
  }

  async upload(request: UploadRequest): Promise<RemoteRef & { remoteId: string }> {
    if (!STORAGE_FILE_NAME.test(request.name)) throw new StorageProviderError("invalid", "Invalid storage file name.");
    const folders = await this.ensureFolders();
    const remoteId = await this.reserveId();
    const ref = { remoteId, remotePath: `${request.folder}/${request.name}` };
    await request.beforeSend(ref);
    const metadata = {
      id: remoteId,
      name: request.name,
      mimeType: ARCHIVE_MIME,
      parents: [folders[request.folder]],
      appProperties: { [GOOGLE_RECORD_PROPERTY]: request.recordId, [GOOGLE_KIND_PROPERTY]: request.kind },
    };
    const status = request.size <= GOOGLE_MULTIPART_LIMIT
      ? await this.multipart(metadata, request)
      : await this.resumable(metadata, request);
    // 409: the reserved id already exists, i.e. an earlier attempt of this upload landed.
    if (status !== 200 && status !== 201 && status !== 409) {
      throw new StorageProviderError(status === 429 ? "quota" : "unavailable",
        `Google Drive did not accept the upload (HTTP ${status}). Sojourner will try again later.`);
    }
    return ref;
  }

  private async multipart(metadata: Record<string, unknown>, request: UploadRequest): Promise<number> {
    const bytes = await readChunk(request.filePath, 0, request.size);
    const boundary = `sojourner_${crypto.randomUUID().replaceAll("-", "")}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${ARCHIVE_MIME}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    // A repeated create with the reserved id cannot duplicate (Google answers 409).
    const response = await this.request((token) => this.options.fetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }));
    return response.status;
  }

  private async resumable(metadata: Record<string, unknown>, request: UploadRequest): Promise<number> {
    const start = await this.request((token) => this.options.fetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": ARCHIVE_MIME,
        "X-Upload-Content-Length": String(request.size),
      },
      body: JSON.stringify(metadata),
    }));
    if (start.status === 409) return 409;
    if (!start.ok) return start.status;
    const location = start.headers.get("location");
    let session: URL;
    try {
      session = new URL(location ?? "");
    } catch {
      throw new StorageProviderError("invalid", "Google Drive did not return an upload session.");
    }
    if (session.origin !== "https://www.googleapis.com" || session.pathname !== "/upload/drive/v3/files" ||
        !session.searchParams.get("upload_id")) {
      throw new StorageProviderError("invalid", "Google Drive returned an upload session outside its upload service.");
    }
    let offset = 0;
    let last = 0;
    while (offset < request.size) {
      const length = Math.min(GOOGLE_CHUNK_BYTES, request.size - offset);
      const chunk = await readChunk(request.filePath, offset, length);
      const range = `bytes ${offset}-${offset + length - 1}/${request.size}`;
      const response = await this.request((token) => this.options.fetch(session.href, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Length": String(length), "Content-Range": range },
        body: chunk,
      }));
      last = response.status;
      if (response.status === 308) {
        const confirmed = /bytes=0-(\d+)/.exec(response.headers.get("range") ?? "");
        const next = confirmed ? Number(confirmed[1]) + 1 : 0;
        if (next <= offset || next > offset + length) {
          throw new StorageProviderError("unavailable", "Google Drive did not confirm the uploaded part. Sojourner will try again later.");
        }
        offset = next;
        continue;
      }
      if (response.ok || response.status === 409) return response.status;
      return response.status;
    }
    return last;
  }

  private matches(file: DriveFile | null, ref: RemoteRef, expected: { size: number; recordId?: string }): boolean {
    if (!file || file.id !== ref.remoteId || file.trashed === true || Number(file.size) !== expected.size) return false;
    const [folder, name] = ref.remotePath.split("/");
    const folderId = this.folders?.[folder as StorageFolder];
    if (file.name !== name || !Array.isArray(file.parents) || !folderId || !file.parents.includes(folderId)) return false;
    return expected.recordId === undefined || file.appProperties?.[GOOGLE_RECORD_PROPERTY] === expected.recordId;
  }

  async verify(ref: RemoteRef, expected: { size: number; sha256: string; recordId?: string }): Promise<boolean> {
    if (!ref.remoteId || !ID.test(ref.remoteId)) return false;
    try {
      await this.ensureFolders();
      if (!this.matches(await this.fileMetadata(ref.remoteId), ref, expected)) return false;
      const media = await this.get(`${FILES}/${encodeURIComponent(ref.remoteId)}?alt=media`);
      if (!media.ok) return false;
      const observed = await hashResponse(media, expected.size);
      return observed.size === expected.size && observed.sha256 === expected.sha256;
    } catch {
      return false;
    }
  }

  async probe(ref: RemoteRef): Promise<"found" | "absent" | "unknown"> {
    if (!ref.remoteId || !ID.test(ref.remoteId)) return "unknown";
    try {
      const response = await this.get(`${FILES}/${encodeURIComponent(ref.remoteId)}?fields=id`);
      if (response.status === 404) return "absent";
      return response.ok ? "found" : "unknown";
    } catch {
      return "unknown";
    }
  }

  private entry(file: DriveFile, folder: StorageFolder): RemoteEntry | null {
    if (typeof file.id !== "string" || !ID.test(file.id) || typeof file.name !== "string" ||
        !STORAGE_FILE_NAME.test(file.name) || file.mimeType === FOLDER_MIME || file.trashed === true) return null;
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size < 0) return null;
    const marker = file.appProperties?.[GOOGLE_RECORD_PROPERTY];
    return { remoteId: file.id, remotePath: `${folder}/${file.name}`, name: file.name, size,
      createdAt: typeof file.createdTime === "string" ? file.createdTime : null, folder,
      recordMarker: typeof marker === "string" ? marker : null };
  }

  async list(folder: StorageFolder): Promise<{ entries: RemoteEntry[]; truncated: boolean }> {
    const folders = await this.ensureFolders();
    const entries: RemoteEntry[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const url = new URL(FILES);
      url.searchParams.set("q", `'${quote(folders[folder])}' in parents and trashed = false`);
      url.searchParams.set("fields", `nextPageToken,files(${FILE_FIELDS})`);
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("orderBy", "createdTime desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = await this.json<{ files?: DriveFile[]; nextPageToken?: unknown }>(await this.get(url.toString()), "listing files");
      for (const file of body.files ?? []) {
        const item = this.entry(file, folder);
        if (item) entries.push(item);
      }
      pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : null;
      if (!pageToken) return { entries, truncated: false };
    }
    return { entries, truncated: true };
  }

  async resolve(folder: StorageFolder, key: string): Promise<RemoteEntry | null> {
    if (!ID.test(key)) return null;
    const folders = await this.ensureFolders();
    const file = await this.fileMetadata(key);
    if (!file || !Array.isArray(file.parents) || !file.parents.includes(folders[folder])) return null;
    return this.entry(file, folder);
  }

  async download(entry: RemoteEntry, destination: string, maxBytes: number): Promise<{ size: number; sha256: string }> {
    if (entry.size > maxBytes) throw new StorageProviderError("invalid", "The file in Google Drive is larger than Sojourner accepts.");
    const response = await this.get(`${FILES}/${encodeURIComponent(entry.remoteId)}?alt=media`);
    if (!response.ok) throw providerFailure("Google Drive", response, "downloading the file");
    return streamToFile(response, destination, maxBytes);
  }

  async remove(ref: RemoteRef, expected: { size: number; sha256: string }): Promise<"deleted" | "absent" | "mismatch"> {
    if (!ref.remoteId || !ID.test(ref.remoteId)) return "mismatch";
    await this.ensureFolders();
    const file = await this.fileMetadata(ref.remoteId);
    if (!file || file.trashed === true) return "absent";
    if (!this.matches(file, ref, { size: expected.size })) return "mismatch";
    const response = await this.request((token) => this.options.fetch(`${FILES}/${encodeURIComponent(ref.remoteId as string)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    }));
    if (response.status === 404) return "absent";
    if (!response.ok) throw providerFailure("Google Drive", response, "removing an old automatic backup");
    return "deleted";
  }
}
