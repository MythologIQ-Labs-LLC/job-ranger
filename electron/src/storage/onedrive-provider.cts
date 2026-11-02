import { GRAPH_APP_ROOT } from "./microsoft-config.cjs";
import type { StorageEgress } from "./storage-egress.cjs";
import {
  authorizedRequest, DEFAULT_RETRY_POLICY, hashResponse, providerFailure, readChunk, STORAGE_FILE_NAME,
  StorageProviderError, streamToFile, transient,
  type RemoteEntry, type RemoteRef, type RetryPolicy, type StorageFolder, type StorageProvider, type UploadRequest,
} from "./storage-provider.cjs";

/** Simple PUT up to this size; larger files use an upload session. */
export const ONEDRIVE_SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
/** Upload-session chunks must be multiples of 320 KiB: 16 x 320 KiB = 5 MiB. */
export const ONEDRIVE_CHUNK_BYTES = 16 * 320 * 1024;
const ITEM_ID = /^[A-Za-z0-9!_.-]{1,200}$/;

interface GraphItem {
  id?: unknown;
  name?: unknown;
  size?: unknown;
  createdDateTime?: unknown;
  file?: unknown;
  folder?: unknown;
  deleted?: unknown;
  "@microsoft.graph.downloadUrl"?: unknown;
}

export interface OneDriveStorageOptions {
  token: (forceRefresh: boolean) => Promise<string>;
  invalidate: () => void;
  accountId: string;
  accountLabel: string;
  egress: StorageEgress;
  retry?: RetryPolicy;
}

function itemPath(folder: StorageFolder, name?: string): string {
  if (name !== undefined && !STORAGE_FILE_NAME.test(name)) throw new StorageProviderError("invalid", "Invalid storage file name.");
  return `${GRAPH_APP_ROOT}:/${folder}${name === undefined ? "" : `/${name}`}`;
}

function splitPath(remotePath: string): { folder: StorageFolder; name: string } {
  const [folder, name, ...rest] = remotePath.split("/");
  if (rest.length || (folder !== "Backups" && folder !== "Documents") || !STORAGE_FILE_NAME.test(name ?? "")) {
    throw new StorageProviderError("invalid", "Invalid storage file reference.");
  }
  return { folder, name };
}

/**
 * OneDrive storage location: Microsoft Graph's app folder (/me/drive/special/approot,
 * shown to the person as Apps/Sojourner) with Backups/ and Documents/, and nothing else
 * (scope Files.ReadWrite.AppFolder). Small files use one PUT; larger ones an upload
 * session in 5 MiB chunks. Names are unique and created with conflictBehavior=fail, so a
 * retried upload never replaces another file. Every upload is verified by comparing the
 * size and the SHA-256 of a byte readback.
 */
export class OneDriveProvider implements StorageProvider {
  readonly kind = "onedrive" as const;
  private foldersReady = false;

  constructor(private readonly options: OneDriveStorageOptions) {}

  async locationKey(): Promise<string> {
    return this.options.accountId;
  }

  async locationLabel(): Promise<string> {
    return `${this.options.accountLabel} > Apps > Sojourner`;
  }

  private request(send: (token: string) => Promise<Response>, retryNetwork = true): Promise<Response> {
    return authorizedRequest({ token: this.options.token, invalidate: this.options.invalidate, send,
      policy: this.options.retry, retryNetwork });
  }

  private call(url: string, init: RequestInit = {}, retryNetwork = true): Promise<Response> {
    return this.request((token) => this.options.egress.fetch(url, {
      ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    }), retryNetwork);
  }

  private async json<T>(response: Response, action: string): Promise<T> {
    if (!response.ok) throw providerFailure("OneDrive", response, action);
    try {
      return await response.json() as T;
    } catch {
      throw new StorageProviderError("invalid", `OneDrive returned an invalid answer while ${action}.`);
    }
  }

  async ensureFolders(): Promise<void> {
    if (this.foldersReady) return;
    await this.json<GraphItem>(await this.call(GRAPH_APP_ROOT), "opening Sojourner's app folder");
    for (const folder of ["Backups", "Documents"] as const) {
      const existing = await this.call(itemPath(folder));
      if (existing.ok) {
        const item = await this.json<GraphItem>(existing, "opening a folder");
        if (!item.folder) throw new StorageProviderError("invalid", `${folder} in Sojourner's OneDrive folder is not a folder.`);
        continue;
      }
      if (existing.status !== 404) throw providerFailure("OneDrive", existing, "opening a folder");
      const created = await this.call(`${GRAPH_APP_ROOT}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folder, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      if (!created.ok && created.status !== 409) throw providerFailure("OneDrive", created, "creating a folder");
    }
    this.foldersReady = true;
  }

  private async metadata(folder: StorageFolder, name: string): Promise<GraphItem | null> {
    const response = await this.call(itemPath(folder, name));
    if (response.status === 404) return null;
    return this.json<GraphItem>(response, "reading file details");
  }

  async upload(request: UploadRequest): Promise<RemoteRef & { remoteId: string }> {
    await this.ensureFolders();
    const remotePath = `${request.folder}/${request.name}`;
    await request.beforeSend({ remoteId: null, remotePath });
    let item: GraphItem | null;
    if (request.size <= ONEDRIVE_SIMPLE_UPLOAD_LIMIT) {
      const bytes = await readChunk(request.filePath, 0, request.size);
      const response = await this.call(`${itemPath(request.folder, request.name)}:/content?@microsoft.graph.conflictBehavior=fail`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
      });
      // 409: the unique name already exists, i.e. an earlier attempt landed; verify decides.
      item = response.status === 409 ? await this.metadata(request.folder, request.name)
        : await this.json<GraphItem>(response, "uploading");
    } else {
      item = await this.uploadSession(request);
    }
    if (!item || typeof item.id !== "string" || !ITEM_ID.test(item.id)) {
      throw new StorageProviderError("invalid", "OneDrive did not confirm the uploaded file.");
    }
    return { remoteId: item.id, remotePath };
  }

  private async uploadSession(request: UploadRequest): Promise<GraphItem | null> {
    const session = await this.call(`${itemPath(request.folder, request.name)}:/createUploadSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name: request.name } }),
    });
    if (session.status === 409) return this.metadata(request.folder, request.name);
    const body = await this.json<{ uploadUrl?: unknown }>(session, "starting an upload");
    if (typeof body.uploadUrl !== "string") throw new StorageProviderError("invalid", "OneDrive did not return an upload session.");
    const uploadUrl = body.uploadUrl;
    const chunks = Math.ceil(request.size / ONEDRIVE_CHUNK_BYTES);
    const policy = this.options.retry ?? DEFAULT_RETRY_POLICY;
    this.options.egress.grant(uploadUrl, "PUT", chunks * policy.attempts);
    const sleep = policy.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    try {
      let offset = 0;
      while (offset < request.size) {
        const length = Math.min(ONEDRIVE_CHUNK_BYTES, request.size - offset);
        const chunk = await readChunk(request.filePath, offset, length);
        let response: Response | null = null;
        for (let attempt = 0; attempt < policy.attempts; attempt += 1) {
          try {
            // The session URL is pre-authenticated: no Authorization header (Graph requirement).
            response = await this.options.egress.fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Length": String(length), "Content-Range": `bytes ${offset}-${offset + length - 1}/${request.size}` },
              body: chunk,
            });
          } catch (error) {
            if (attempt + 1 >= policy.attempts) throw error;
            response = null;
          }
          if (response && !transient(response.status)) break;
          if (attempt + 1 < policy.attempts) await sleep(Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs));
        }
        if (!response) throw new StorageProviderError("unavailable", "The OneDrive upload was interrupted. Sojourner will try again later.");
        if (response.status === 202) {
          offset += length;
          continue;
        }
        if (response.status === 200 || response.status === 201) {
          offset += length;
          if (offset < request.size) throw new StorageProviderError("invalid", "OneDrive finished the upload early.");
          return this.json<GraphItem>(response, "uploading");
        }
        if (response.status === 409) return this.metadata(request.folder, request.name);
        throw providerFailure("OneDrive", response, "uploading");
      }
      throw new StorageProviderError("invalid", "OneDrive did not confirm the end of the upload.");
    } finally {
      this.options.egress.revoke(uploadUrl);
    }
  }

  private async readback(item: GraphItem, maxBytes: number): Promise<Response> {
    const downloadUrl = item["@microsoft.graph.downloadUrl"];
    if (typeof downloadUrl !== "string") throw new StorageProviderError("invalid", "OneDrive did not offer the file for download.");
    this.options.egress.grant(downloadUrl, "GET", 1, 10 * 60_000);
    const response = await this.options.egress.fetch(downloadUrl);
    if (!response.ok) throw providerFailure("OneDrive", response, "downloading the file");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new StorageProviderError("invalid", "The file in OneDrive is larger than Sojourner accepts.");
    }
    return response;
  }

  async verify(ref: RemoteRef, expected: { size: number; sha256: string }): Promise<boolean> {
    try {
      const { folder, name } = splitPath(ref.remotePath);
      const item = await this.metadata(folder, name);
      if (!item || (ref.remoteId && item.id !== ref.remoteId) || Number(item.size) !== expected.size || !item.file) return false;
      const observed = await hashResponse(await this.readback(item, expected.size), expected.size);
      return observed.size === expected.size && observed.sha256 === expected.sha256;
    } catch {
      return false;
    }
  }

  async probe(ref: RemoteRef): Promise<"found" | "absent" | "unknown"> {
    try {
      const { folder, name } = splitPath(ref.remotePath);
      const response = await this.call(itemPath(folder, name));
      if (response.status === 404) return "absent";
      return response.ok ? "found" : "unknown";
    } catch {
      return "unknown";
    }
  }

  private entry(item: GraphItem, folder: StorageFolder): RemoteEntry | null {
    if (typeof item.id !== "string" || !ITEM_ID.test(item.id) || typeof item.name !== "string" ||
        !STORAGE_FILE_NAME.test(item.name) || !item.file || item.deleted) return null;
    const size = Number(item.size);
    if (!Number.isSafeInteger(size) || size < 0) return null;
    return { remoteId: item.id, remotePath: `${folder}/${item.name}`, name: item.name, size,
      createdAt: typeof item.createdDateTime === "string" ? item.createdDateTime : null, folder, recordMarker: null };
  }

  async list(folder: StorageFolder): Promise<{ entries: RemoteEntry[]; truncated: boolean }> {
    await this.ensureFolders();
    const response = await this.call(`${itemPath(folder)}:/children?$top=200&$select=id,name,size,createdDateTime,file`);
    const body = await this.json<{ value?: GraphItem[]; "@odata.nextLink"?: unknown }>(response, "listing files");
    const entries = (body.value ?? []).map((item) => this.entry(item, folder)).filter((item): item is RemoteEntry => item !== null);
    entries.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    // Further pages are not followed: their links are outside the app-folder egress allowlist.
    return { entries, truncated: typeof body["@odata.nextLink"] === "string" };
  }

  async resolve(folder: StorageFolder, key: string): Promise<RemoteEntry | null> {
    if (!STORAGE_FILE_NAME.test(key)) return null;
    const item = await this.metadata(folder, key);
    return item ? this.entry(item, folder) : null;
  }

  async download(entry: RemoteEntry, destination: string, maxBytes: number): Promise<{ size: number; sha256: string }> {
    const item = await this.metadata(entry.folder, entry.name);
    if (!item || item.id !== entry.remoteId) throw new StorageProviderError("not_found", "The file is no longer in OneDrive.");
    if (Number(item.size) > maxBytes) throw new StorageProviderError("invalid", "The file in OneDrive is larger than Sojourner accepts.");
    return streamToFile(await this.readback(item, maxBytes), destination, maxBytes);
  }

  async remove(ref: RemoteRef, expected: { size: number; sha256: string }): Promise<"deleted" | "absent" | "mismatch"> {
    const { folder, name } = splitPath(ref.remotePath);
    const item = await this.metadata(folder, name);
    if (!item) return "absent";
    if ((ref.remoteId && item.id !== ref.remoteId) || Number(item.size) !== expected.size) return "mismatch";
    const response = await this.call(itemPath(folder, name), { method: "DELETE" });
    if (response.status === 404) return "absent";
    if (!response.ok) throw providerFailure("OneDrive", response, "removing an old automatic backup");
    return "deleted";
  }
}
