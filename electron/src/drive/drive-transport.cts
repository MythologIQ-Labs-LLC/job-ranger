import { randomUUID } from "node:crypto";
import { DriveError } from "./drive-errors.cjs";
import type { GoogleEndpoints } from "./google-config.cjs";
import type { GoogleTransport } from "./google-transport.cjs";

export const DRIVE_FOLDER_NAME = "Job Ranger";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,size,md5Checksum,sha256Checksum,webViewLink,appProperties,trashed";
const DRIVE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export interface DriveFileMetadata {
  id: string;
  name: string;
  size: number | null;
  md5Checksum: string | null;
  sha256Checksum: string | null;
  webViewLink: string | null;
  appProperties: Record<string, string>;
  trashed: boolean;
}

export interface DriveTokenSource {
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  invalidateAccessToken(): void;
}

export interface DriveUploadInput {
  /** Id reserved with files.generateIds; the create is idempotent on it. */
  fileId: string;
  name: string;
  bytes: Uint8Array;
  folderId: string;
  operationId: string;
  artifactId: string;
  sha256: string;
}

export interface DriveTransportOptions {
  transport: GoogleTransport;
  endpoints: GoogleEndpoints;
  auth: DriveTokenSource;
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
}

/** Only links that open Google Drive itself are exposed to the renderer. */
export function safeWebViewLink(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("https://drive.google.com/")) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "drive.google.com" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseFile(value: unknown): DriveFileMetadata {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (typeof raw.id !== "string" || !DRIVE_ID.test(raw.id)) {
    throw new DriveError("invalid_response", "Google Drive returned a file without a usable id.");
  }
  const size = typeof raw.size === "string" && /^\d+$/.test(raw.size) ? Number(raw.size) : null;
  const checksum = (field: unknown, length: number) =>
    typeof field === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "i").test(field) ? field.toLowerCase() : null;
  const props = raw.appProperties && typeof raw.appProperties === "object" ? (raw.appProperties as Record<string, unknown>) : {};
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "",
    size,
    md5Checksum: checksum(raw.md5Checksum, 32),
    sha256Checksum: checksum(raw.sha256Checksum, 64),
    webViewLink: safeWebViewLink(raw.webViewLink),
    appProperties: Object.fromEntries(Object.entries(props).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    trashed: raw.trashed === true,
  };
}

function queryLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Verifies Drive's copy against the local bytes: size, then SHA-256 when Drive
 * reports it, otherwise MD5. A missing checksum is not treated as a match.
 */
export function verifyRemoteFile(
  file: DriveFileMetadata,
  expected: { sizeBytes: number; sha256: string; md5: string },
): void {
  const fail = (detail: string) => {
    throw new DriveError("verification_failed", `The file in Google Drive does not match the local PDF (${detail}).`);
  };
  if (file.size !== expected.sizeBytes) fail("size differs");
  if (file.sha256Checksum) {
    if (file.sha256Checksum !== expected.sha256.toLowerCase()) fail("SHA-256 differs");
    return;
  }
  if (!file.md5Checksum) fail("Drive reported no checksum");
  if (file.md5Checksum !== expected.md5.toLowerCase()) fail("MD5 differs");
}

/** DriveTransport: the least-privilege Drive v3 calls Job Ranger needs under drive.file. */
export class DriveTransport {
  private folder: { accountId: string; id: string } | null = null;
  private folderPending: Promise<string> | null = null;

  constructor(private readonly options: DriveTransportOptions) {}

  /** Sends an authorized request; one 401 drops the cached token and retries after a refresh. */
  private async authorized<T>(url: string, init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string | Uint8Array; timeoutMs?: number } = {}): Promise<T> {
    const send = async (token: string) =>
      (await this.options.transport.request<T>(url, {
        ...init,
        timeoutMs: init.timeoutMs ?? this.options.requestTimeoutMs,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      })).body;
    try {
      return await send(await this.options.auth.getAccessToken());
    } catch (error) {
      if (!(error instanceof DriveError) || error.httpStatus !== 401) throw error;
      this.options.auth.invalidateAccessToken();
      return send(await this.options.auth.getAccessToken(true));
    }
  }

  private async listFiles(q: string): Promise<DriveFileMetadata[]> {
    const params = new URLSearchParams({ q, spaces: "drive", pageSize: "10", fields: `files(${FILE_FIELDS})` });
    const body = await this.authorized<{ files?: unknown[] }>(`${this.options.endpoints.driveApi}/files?${params.toString()}`);
    if (!Array.isArray(body?.files)) throw new DriveError("invalid_response", "Google Drive returned an unexpected file list.");
    return body.files.map(parseFile);
  }

  /**
   * Finds (or creates once) the app-owned "Job Ranger" folder in My Drive.
   * Serialized per process and cached per account, so parallel uploads cannot
   * create two folders; a cached folder is re-read (strongly consistent) and
   * forgotten when it is gone or trashed.
   */
  ensureFolder(accountId: string): Promise<string> {
    if (!this.folderPending) {
      this.folderPending = this.resolveFolder(accountId).finally(() => {
        this.folderPending = null;
      });
    }
    return this.folderPending;
  }

  invalidateFolder(): void {
    this.folder = null;
  }

  private async resolveFolder(accountId: string): Promise<string> {
    if (this.folder?.accountId === accountId) {
      const cached = await this.findFile(this.folder.id);
      if (cached && !cached.trashed) return cached.id;
    }
    this.folder = null;
    const id = await this.findOrCreateFolder();
    this.folder = { accountId, id };
    return id;
  }

  private async findOrCreateFolder(): Promise<string> {
    const existing = await this.listFiles(
      `appProperties has { key='jobRanger' and value='folder' } and mimeType=${queryLiteral(FOLDER_MIME)} and trashed=false`,
    );
    if (existing[0]) return existing[0].id;
    const created = await this.authorized<unknown>(`${this.options.endpoints.driveApi}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { jobRanger: "folder" } }),
    });
    return parseFile(created).id;
  }

  async findByOperationId(operationId: string): Promise<DriveFileMetadata | null> {
    const files = await this.listFiles(
      `appProperties has { key='jobRangerOperationId' and value=${queryLiteral(operationId)} } and trashed=false`,
    );
    return files.find((file) => file.appProperties.jobRangerOperationId === operationId) ?? null;
  }

  async getFile(fileId: string): Promise<DriveFileMetadata> {
    if (!DRIVE_ID.test(fileId)) throw new DriveError("invalid_request", "Invalid Drive file id.");
    return parseFile(await this.authorized<unknown>(`${this.options.endpoints.driveApi}/files/${fileId}?fields=${FILE_FIELDS}`));
  }

  /** files.get by id (strongly consistent): the file, or null when Drive answers 404. */
  async findFile(fileId: string): Promise<DriveFileMetadata | null> {
    try {
      return await this.getFile(fileId);
    } catch (error) {
      if (error instanceof DriveError && error.httpStatus === 404) return null;
      throw error;
    }
  }

  /** Reserves one Drive file id (files.generateIds) to make the later create idempotent. */
  async generateFileId(): Promise<string> {
    const body = await this.authorized<{ ids?: unknown }>(
      `${this.options.endpoints.driveApi}/files/generateIds?count=1&space=drive&type=files`,
    );
    const id = Array.isArray(body?.ids) ? body.ids[0] : null;
    if (typeof id !== "string" || !DRIVE_ID.test(id)) {
      throw new DriveError("invalid_response", "Google Drive did not reserve a file id.");
    }
    return id;
  }

  /**
   * One multipart create with the reserved id. Drive refuses a second create
   * with the same id (409), so a repeated POST cannot make a second file. The
   * operation id also rides in appProperties as a secondary lookup.
   */
  async uploadPdf(input: DriveUploadInput): Promise<DriveFileMetadata> {
    const boundary = `job-ranger-${randomUUID()}`;
    const metadata = JSON.stringify({
      id: input.fileId,
      name: input.name,
      mimeType: "application/pdf",
      parents: [input.folderId],
      appProperties: {
        jobRangerOperationId: input.operationId,
        jobRangerArtifactId: input.artifactId,
        jobRangerSha256: input.sha256,
      },
    });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, "utf8"),
      Buffer.from(input.bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    const fields = "id,name,size,md5Checksum,sha256Checksum,webViewLink";
    return parseFile(
      await this.authorized<unknown>(`${this.options.endpoints.driveUpload}?uploadType=multipart&fields=${fields}`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
        timeoutMs: this.options.uploadTimeoutMs ?? 120_000,
      }),
    );
  }
}
