/**
 * Scoped Google Drive v3 transport for explicitly user-approved Sojourner artifacts.
 * No OAuth, permission to upload, local journal, persistence or automatic retries here.
 * Caller MUST consume an approval and durably reserve an operation before calling.
 * Network and provider outcomes are never silently retried after an ambiguous POST.
 */
export const DRIVE_FILE_UPLOAD_LIMIT = 5 * 1024 * 1024;
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,size,appProperties,webViewLink";
const FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const OPERATION = /^[A-Za-z0-9_-]{1,100}$/;
const HASH = /^[0-9a-f]{64}$/;
const MIME = new Map([
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["text/markdown", ".md"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
]);
export const DRIVE_OPERATION_PROPERTY = "sojournerExportOperation";

export class DriveTransportError extends Error {
  readonly category: "invalid" | "action_needed" | "quota" | "denied";
  constructor(category: "invalid" | "action_needed" | "quota" | "denied", message: string) {
    super(message);
    this.name = "DriveTransportError";
    this.category = category;
  }
}

export interface ApprovedDriveFile {
  /** Obtained only inside an explicit browser-authenticated user action. Never persist or log. */
  accessToken: string;
  operationId: string;
  name: string;
  mimeType: string;
  destinationId: string;
  bytes: Blob;
  approvedSha256: string;
}

export type DriveUploadOutcome =
  | { status: "verified"; remoteId: string; name: string; sha256: string; openUrl: string }
  | { status: "verification_failed"; remoteId: string; reason: string }
  | { status: "unknown_remote_outcome"; remoteId: string | null; reason: string };

type Fetch = typeof fetch;

async function sha256(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function validate(input: ApprovedDriveFile): void {
  const ext = MIME.get(input.mimeType);
  if (!input.accessToken || /[\r\n]/.test(input.accessToken) || input.accessToken.length > 8192 ||
      !OPERATION.test(input.operationId) || !ID.test(input.destinationId) ||
      !ext || typeof input.name !== "string" || input.name.length < 4 ||
      input.name.length > 180 || input.name.trim() !== input.name ||
      !input.name.toLowerCase().endsWith(ext) || /[\\/\x00-\x1f\x7f]/.test(input.name) ||
      !(input.bytes instanceof Blob) || input.bytes.size === 0 ||
      input.bytes.size > DRIVE_FILE_UPLOAD_LIMIT || !HASH.test(input.approvedSha256)) {
    throw new DriveTransportError("invalid", "The approved Drive export is invalid or exceeds the 5 MB upload limit.");
  }
}
function outcomeForPostStatus(status: number): never {
  if (status === 401) throw new DriveTransportError("action_needed", "Google Drive authorization expired. Reconnect before a new user-approved export.");
  if (status === 403) throw new DriveTransportError("denied", "Google Drive rejected this upload. Check Drive permissions or available storage.");
  if (status === 429) throw new DriveTransportError("quota", "Google Drive is rate-limiting uploads. No automatic retry was attempted.");
  throw new DriveTransportError("invalid", "Google Drive rejected the upload request. Your local document is unchanged.");
}
function safeOpenUrl(id: string): string {
  if (!ID.test(id)) throw new DriveTransportError("invalid", "Google Drive returned an invalid file identifier.");
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

/** A single Drive files.create POST followed by provider metadata and byte readback. */
export async function uploadApprovedDriveFile(
  input: ApprovedDriveFile, http: Fetch = fetch,
): Promise<DriveUploadOutcome> {
  validate(input);
  if (await sha256(input.bytes) !== input.approvedSha256) {
    throw new DriveTransportError("invalid", "The document changed after the user approved the exact export.");
  }

  // Google accepts the "root" alias on create, but returns its opaque folder ID
  // in files.get. Resolve it before sending any bytes so readback can verify the
  // *actual* destination instead of falsely comparing an opaque ID with "root".
  let destinationId = input.destinationId;
  if (destinationId === "root") {
    let response: Response;
    try {
      response = await http(`${FILES_ENDPOINT}/root?fields=id,mimeType`, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
        cache: "no-store", redirect: "error",
      });
    } catch {
      throw new DriveTransportError("invalid", "My Drive destination could not be verified. No upload was attempted.");
    }
    if (!response.ok) {
      throw new DriveTransportError("action_needed", "Google did not authorize reading the My Drive destination. No upload was attempted.");
    }
    let root: { id?: unknown; mimeType?: unknown };
    try { root = await response.json(); } catch {
      throw new DriveTransportError("invalid", "My Drive returned invalid destination metadata. No upload was attempted.");
    }
    if (!root || typeof root.id !== "string" || !ID.test(root.id) ||
        root.mimeType !== "application/vnd.google-apps.folder") {
      throw new DriveTransportError("invalid", "Google did not verify My Drive's root folder. No upload was attempted.");
    }
    destinationId = root.id;
  }
  const boundary = `sojourner_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = {
    name: input.name,
    mimeType: input.mimeType,
    parents: [destinationId],
    appProperties: { [DRIVE_OPERATION_PROPERTY]: input.operationId },
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    input.bytes,
    `\r\n--${boundary}--\r\n`,
  ]);
  const auth = { Authorization: `Bearer ${input.accessToken}` };
  let created: Response;
  try {
    created = await http(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    // Browser/network errors after sending bytes cannot prove Google did not create a file.
    return { status: "unknown_remote_outcome", remoteId: null,
      reason: "The upload connection was interrupted. Check Drive before approving another export." };
  }
  if (!created.ok) {
    if (created.status >= 500 || created.status === 408) {
      return { status: "unknown_remote_outcome", remoteId: null,
        reason: "Google Drive did not confirm whether it created the file. Check Drive before another export." };
    }
    outcomeForPostStatus(created.status);
  }
  let file: { id?: unknown };
  try { file = await created.json(); } catch {
    return { status: "unknown_remote_outcome", remoteId: null,
      reason: "Google accepted the request but returned no usable file receipt. Do not automatically upload again." };
  }
  if (!file || typeof file.id !== "string" || !ID.test(file.id)) {
    return { status: "unknown_remote_outcome", remoteId: null,
      reason: "Google did not return a valid file identifier. Do not automatically upload again." };
  }
  const remoteId = file.id;
  const url = `${FILES_ENDPOINT}/${encodeURIComponent(remoteId)}`;
  let details: Response;
  try {
    details = await http(`${url}?fields=id,name,mimeType,parents,size,appProperties&supportsAllDrives=false`, {
      headers: auth, cache: "no-store", redirect: "error",
    });
  } catch {
    return { status: "verification_failed", remoteId, reason: "Drive created a file, but metadata verification was interrupted." };
  }
  if (!details.ok) {
    return { status: "verification_failed", remoteId, reason: "Drive created a file, but its metadata could not be verified." };
  }
  let data: { id?: unknown; name?: unknown; mimeType?: unknown; parents?: unknown;
    size?: unknown; appProperties?: Record<string, unknown> };
  try { data = await details.json(); } catch {
    return { status: "verification_failed", remoteId, reason: "Drive returned invalid file metadata." };
  }
  if (!data || data.id !== remoteId || data.name !== input.name ||
      data.mimeType !== input.mimeType || !Array.isArray(data.parents) ||
      !data.parents.includes(destinationId) ||
      data.appProperties?.[DRIVE_OPERATION_PROPERTY] !== input.operationId ||
      Number(data.size) !== input.bytes.size) {
    return { status: "verification_failed", remoteId, reason: "Drive file metadata did not match the approved destination and document." };
  }
  try {
    const readback = await http(`${url}?alt=media`, {
      headers: auth, cache: "no-store", redirect: "error",
    });
    if (!readback.ok) {
      return { status: "verification_failed", remoteId, reason: "Drive did not permit document readback." };
    }
    const observed = await sha256(await readback.blob());
    if (observed !== input.approvedSha256) {
      return { status: "verification_failed", remoteId, reason: "Drive document bytes did not match the approved document." };
    }
  } catch {
    return { status: "verification_failed", remoteId, reason: "Drive document readback was interrupted." };
  }
  return { status: "verified", remoteId, name: input.name, sha256: input.approvedSha256, openUrl: safeOpenUrl(remoteId) };
}

/**
 * Reconcile an ambiguous POST using the app-private operation marker.
 * A zero-result search cannot prove that an earlier upload never completed;
 * NEVER use this result to launch an automatic second POST.
 */
export async function findCreatedDriveFile(
  accessToken: string, operationId: string, http: Fetch = fetch,
): Promise<{ status: "found"; remoteId: string } | { status: "not_confirmed" | "ambiguous" }> {
  if (!accessToken || /[\r\n]/.test(accessToken) || !OPERATION.test(operationId)) {
    throw new DriveTransportError("invalid", "Invalid Drive export reconciliation request.");
  }
  const query = `trashed = false and appProperties has { key='${DRIVE_OPERATION_PROPERTY}' and value='${operationId}' }`;
  const url = new URL(FILES_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,appProperties)");
  url.searchParams.set("pageSize", "10");
  let response: Response;
  try {
    response = await http(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", redirect: "error",
    });
  } catch { return { status: "not_confirmed" }; }
  if (!response.ok) return { status: "not_confirmed" };
  let result: { files?: Array<{ id?: unknown; appProperties?: Record<string, unknown> }>;
    nextPageToken?: unknown; incompleteSearch?: unknown };
  try { result = await response.json(); } catch { return { status: "not_confirmed" }; }
  if (!Array.isArray(result?.files) || result.nextPageToken || result.incompleteSearch) {
    return { status: "ambiguous" };
  }
  const matches = result.files.filter(x => x && typeof x === "object" &&
    x.appProperties?.[DRIVE_OPERATION_PROPERTY] === operationId &&
    typeof x.id === "string" && ID.test(x.id));
  return matches.length === 1 && result.files.length === 1
    ? { status: "found", remoteId: matches[0].id as string }
    : matches.length > 1 || result.files.length !== matches.length
      ? { status: "ambiguous" }
      : { status: "not_confirmed" };
}

/** Read-only recovery of one prior operation; NEVER submits files.create. */
export async function verifyRecoveredDriveFile(
  accessToken: string,
  expected: { operationId: string; remoteId: string; name: string; mimeType: string;
    destinationId: string; approvedSha256: string },
  http: Fetch = fetch,
): Promise<boolean> {
  if (typeof accessToken !== "string" || !accessToken || accessToken.length > 8192 ||
      /[\r\n]/.test(accessToken) || typeof expected.operationId !== "string" ||
      !OPERATION.test(expected.operationId) ||
      typeof expected.remoteId !== "string" || !ID.test(expected.remoteId) ||
      typeof expected.destinationId !== "string" || !ID.test(expected.destinationId) ||
      typeof expected.approvedSha256 !== "string" || !HASH.test(expected.approvedSha256) ||
      expected.mimeType !== "application/pdf" || typeof expected.name !== "string" ||
      expected.name.length < 4 || expected.name.length > 180 ||
      !expected.name.toLowerCase().endsWith(".pdf") ||
      /[\\/\x00-\x1f\x7f]/.test(expected.name) || expected.name.trim() !== expected.name) return false;
  const auth = { Authorization: `Bearer ${accessToken}` };
  try {
    let destinationId = expected.destinationId;
    if (destinationId === "root") {
      const root = await http(`${FILES_ENDPOINT}/root?fields=id,mimeType`, {
        headers: auth, cache: "no-store", redirect: "error",
      });
      if (!root.ok) return false;
      const rootData = await root.json();
      if (!rootData || typeof rootData.id !== "string" || !ID.test(rootData.id) ||
          rootData.mimeType !== "application/vnd.google-apps.folder") return false;
      destinationId = rootData.id;
    }
    const base = `${FILES_ENDPOINT}/${encodeURIComponent(expected.remoteId)}`;
    const metadata = await http(`${base}?fields=id,name,mimeType,parents,size,appProperties&supportsAllDrives=false`, {
      headers: auth, cache: "no-store", redirect: "error",
    });
    if (!metadata.ok) return false;
    const data = await metadata.json();
    if (!data || data.id !== expected.remoteId || data.name !== expected.name ||
        data.mimeType !== expected.mimeType || !Array.isArray(data.parents) ||
        !data.parents.includes(destinationId) ||
        data.appProperties?.[DRIVE_OPERATION_PROPERTY] !== expected.operationId ||
        !Number.isSafeInteger(Number(data.size)) ||
        Number(data.size) < 1 || Number(data.size) > DRIVE_FILE_UPLOAD_LIMIT) return false;
    const readback = await http(`${base}?alt=media`, {
      headers: auth, cache: "no-store", redirect: "error",
    });
    if (!readback.ok) return false;
    const bytes = await readback.blob();
    return bytes.size === Number(data.size) &&
      bytes.size <= DRIVE_FILE_UPLOAD_LIMIT &&
      await sha256(bytes) === expected.approvedSha256;
  } catch { return false; }
}
