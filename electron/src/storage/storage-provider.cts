import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { StorageProviderKind, StorageRecordKind } from "../../../src/shared/storage-locations.js";

export type StorageFolder = "Backups" | "Documents";
export const STORAGE_FOLDERS: readonly StorageFolder[] = ["Backups", "Documents"];

/** Names Sojourner writes: no separators, no control characters, no leading dot. */
export const STORAGE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const PARTIAL_PREFIX = ".sojourner-partial-";

export class StorageProviderError extends Error {
  constructor(
    readonly category: "action_needed" | "unavailable" | "invalid" | "quota" | "denied" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "StorageProviderError";
  }
}

export interface RemoteRef {
  remoteId: string | null;
  remotePath: string;
}

export interface RemoteEntry extends RemoteRef {
  remoteId: string;
  name: string;
  size: number;
  createdAt: string | null;
  folder: StorageFolder;
  /** Record id Sojourner attached to the file (Google appProperties), when present. */
  recordMarker: string | null;
}

export interface UploadRequest {
  folder: StorageFolder;
  name: string;
  filePath: string;
  size: number;
  sha256: string;
  kind: StorageRecordKind;
  recordId: string;
  /**
   * Called (and awaited) before any byte that can create a remote file is sent, with
   * the remote reference known at that point, so the record can journal it first.
   */
  beforeSend: (ref: RemoteRef) => Promise<void>;
}

export interface StorageProvider {
  readonly kind: StorageProviderKind;
  /** Local folder path, or the verified account id of the cloud provider. */
  locationKey(): Promise<string>;
  locationLabel(): Promise<string>;
  /** Uploads (or copies) the file; resolves once the provider accepted it. */
  upload(request: UploadRequest): Promise<RemoteRef & { remoteId: string }>;
  /** Byte readback: true only when the stored size and SHA-256 equal the expected ones. */
  verify(ref: RemoteRef, expected: { size: number; sha256: string; recordId?: string }): Promise<boolean>;
  /** Strongly consistent existence check, for crash recovery. */
  probe(ref: RemoteRef): Promise<"found" | "absent" | "unknown">;
  list(folder: StorageFolder): Promise<{ entries: RemoteEntry[]; truncated: boolean }>;
  /** Resolves a renderer handle (folder + key) to an entry at this location, or null. */
  resolve(folder: StorageFolder, key: string): Promise<RemoteEntry | null>;
  /** Streams the file to `destination` (must not exist), capped at `maxBytes`. */
  download(entry: RemoteEntry, destination: string, maxBytes: number): Promise<{ size: number; sha256: string }>;
  /**
   * Deletes a file Sojourner recorded. Refuses ("mismatch") when the stored file is no
   * longer the recorded one (different id or size), so a file someone replaced survives.
   */
  remove(ref: RemoteRef, expected: { size: number; sha256: string }): Promise<"deleted" | "absent" | "mismatch">;
}

export async function hashFile(filePath: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: hash.digest("hex") };
}

/** Reads one chunk of a file (uploads never hold a whole archive in memory). */
export async function readChunk(filePath: string, offset: number, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== length) throw new StorageProviderError("invalid", "The backup file changed while it was being uploaded.");
    return buffer;
  } finally {
    await handle.close();
  }
}

/** Streams a response body to a new file, hashing it, refusing more than `maxBytes`. */
export async function streamToFile(response: Response, destination: string, maxBytes: number): Promise<{ size: number; sha256: string }> {
  if (!response.body) throw new StorageProviderError("invalid", "The storage provider returned an empty file.");
  const hash = createHash("sha256");
  let size = 0;
  const handle = await fs.open(destination, "wx", 0o600);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new StorageProviderError("invalid", "The file at the storage location is larger than Sojourner accepts.");
      }
      hash.update(value);
      await handle.write(value);
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(destination, { force: true });
    throw error;
  }
  await handle.close();
  return { size, sha256: hash.digest("hex") };
}

/** Hashes a response body without keeping it (byte readback verification). */
export async function hashResponse(response: Response, maxBytes: number): Promise<{ size: number; sha256: string }> {
  if (!response.body) return { size: 0, sha256: createHash("sha256").digest("hex") };
  const hash = createHash("sha256");
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new StorageProviderError("invalid", "The stored file is larger than the recorded one.");
    }
    hash.update(value);
  }
  return { size, sha256: hash.digest("hex") };
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { attempts: 4, baseDelayMs: 1_000, maxDelayMs: 30_000 };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response, policy: RetryPolicy, attempt: number): number {
  const header = response.headers.get("retry-after");
  const seconds = header !== null ? Number(header) : Number.NaN;
  const fallback = policy.baseDelayMs * 2 ** attempt;
  const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallback;
  return Math.min(Math.max(delay, 0), policy.maxDelayMs);
}

export function transient(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Runs a provider request with a bearer token: a 401 invalidates the access token and
 * retries once with a refreshed one; 429, 408 and 5xx are retried with backoff (honouring
 * Retry-After). `retryNetwork` allows retrying a thrown network error (only for requests
 * that are safe to repeat). Returns the final response (which may still be an error).
 */
export async function authorizedRequest(input: {
  token: (forceRefresh: boolean) => Promise<string>;
  invalidate: () => void;
  send: (token: string) => Promise<Response>;
  policy?: RetryPolicy;
  retryNetwork?: boolean;
}): Promise<Response> {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = policy.sleep ?? defaultSleep;
  let refreshed = false;
  let token = await input.token(false);
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await input.send(token);
    } catch (error) {
      if (!input.retryNetwork || attempt + 1 >= policy.attempts) throw error;
      await sleep(Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs));
      continue;
    }
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      input.invalidate();
      token = await input.token(true);
      attempt -= 1;
      continue;
    }
    if (transient(response.status) && attempt + 1 < policy.attempts) {
      await sleep(retryAfterMs(response, policy, attempt));
      continue;
    }
    return response;
  }
}

export function providerFailure(provider: string, response: Response, action: string): StorageProviderError {
  if (response.status === 401) return new StorageProviderError("action_needed", `${provider} sign-in expired while ${action}. Connect ${provider} again.`);
  if (response.status === 403) return new StorageProviderError("denied", `${provider} refused ${action} (check its permissions and available storage).`);
  if (response.status === 404) return new StorageProviderError("not_found", `${provider} could not find the file or folder while ${action}.`);
  if (response.status === 409) return new StorageProviderError("conflict", `${provider} already has a file with that name.`);
  if (response.status === 413 || response.status === 507) return new StorageProviderError("quota", `${provider} does not have enough storage for ${action}.`);
  if (response.status === 429) return new StorageProviderError("quota", `${provider} is rate-limiting Sojourner; it will try again later.`);
  return new StorageProviderError("unavailable", `${provider} could not complete ${action} (HTTP ${response.status}). Sojourner will try again later.`);
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The real (native) path of `target`, resolving junctions, links and 8.3 names of its nearest existing ancestor. */
export async function realLocation(target: string): Promise<string> {
  const resolved = path.resolve(target);
  const pending: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return pending.length ? path.join(real, ...pending.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      pending.push(path.basename(current));
      current = parent;
    }
  }
}

function overlaps(a: string, b: string): boolean {
  return inside(a, b) || inside(b, a);
}

/**
 * Validates a folder for "This computer": an absolute, existing (or creatable) real
 * directory that is not inside Sojourner's own user-data folder (and does not contain
 * it), so a restore can never remove the backups it restores from. The check runs on the
 * lexical path and on the native real path (junctions, symbolic links and 8.3 short names
 * resolved) both before the folder is created and after.
 */
export async function validateLocalFolder(folder: string, userDataDirectory: string): Promise<string> {
  if (typeof folder !== "string" || !folder.trim() || !path.isAbsolute(folder) || folder.length > 1024 || /[\x00-\x1f]/.test(folder)) {
    throw new StorageProviderError("invalid", "Choose a folder on this computer.");
  }
  const resolved = path.resolve(folder);
  const refuse = () => new StorageProviderError("invalid", "Choose a folder outside Sojourner's own data folder.");
  const realUserData = await realLocation(userDataDirectory);
  if (overlaps(userDataDirectory, resolved) || overlaps(realUserData, await realLocation(resolved))) throw refuse();
  await fs.mkdir(resolved, { recursive: true });
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new StorageProviderError("invalid", "The storage folder must be a normal folder, not a link.");
  }
  if (overlaps(realUserData, await fs.realpath(resolved))) throw refuse();
  return resolved;
}

/** "This computer": a folder with Backups/ and Documents/ subfolders. */
export class LocalFolderProvider implements StorageProvider {
  readonly kind = "local" as const;

  constructor(private readonly root: string) {}

  async locationKey(): Promise<string> {
    return this.root;
  }

  async locationLabel(): Promise<string> {
    return this.root;
  }

  private async folderPath(folder: StorageFolder): Promise<string> {
    const target = path.join(this.root, folder);
    await fs.mkdir(target, { recursive: true });
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new StorageProviderError("invalid", `${folder} in the storage folder is not a normal folder.`);
    }
    return target;
  }

  private filePath(ref: RemoteRef): string {
    const [folder, name, ...rest] = ref.remotePath.split("/");
    if (rest.length || !STORAGE_FOLDERS.includes(folder as StorageFolder) || !STORAGE_FILE_NAME.test(name ?? "")) {
      throw new StorageProviderError("invalid", "Invalid storage file reference.");
    }
    return path.join(this.root, folder, name);
  }

  async upload(request: UploadRequest): Promise<RemoteRef & { remoteId: string }> {
    if (!STORAGE_FILE_NAME.test(request.name)) throw new StorageProviderError("invalid", "Invalid storage file name.");
    const directory = await this.folderPath(request.folder);
    const ref = { remoteId: request.name, remotePath: `${request.folder}/${request.name}` };
    const finalPath = path.join(directory, request.name);
    const partialPath = path.join(directory, `${PARTIAL_PREFIX}${randomUUID()}`);
    await request.beforeSend(ref);
    const hash = createHash("sha256");
    let size = 0;
    const handle = await fs.open(partialPath, "wx", 0o600);
    try {
      for await (const chunk of createReadStream(request.filePath, { highWaterMark: 1024 * 1024 })) {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
        await handle.write(chunk as Buffer);
      }
      await handle.sync();
      await handle.close();
      if (size !== request.size || hash.digest("hex") !== request.sha256) {
        throw new StorageProviderError("invalid", "The backup changed while it was being copied.");
      }
      try {
        await fs.access(finalPath);
        throw new StorageProviderError("conflict", `${request.name} already exists in the storage folder.`);
      } catch (error) {
        if (error instanceof StorageProviderError) throw error;
      }
      await fs.rename(partialPath, finalPath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.rm(partialPath, { force: true });
      throw error;
    }
    return ref;
  }

  async verify(ref: RemoteRef, expected: { size: number; sha256: string }): Promise<boolean> {
    try {
      const target = this.filePath(ref);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size) return false;
      const observed = await hashFile(target);
      return observed.size === expected.size && observed.sha256 === expected.sha256;
    } catch {
      return false;
    }
  }

  async probe(ref: RemoteRef): Promise<"found" | "absent" | "unknown"> {
    try {
      await fs.lstat(this.filePath(ref));
      return "found";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown";
    }
  }

  async list(folder: StorageFolder): Promise<{ entries: RemoteEntry[]; truncated: boolean }> {
    const directory = await this.folderPath(folder);
    const names = (await fs.readdir(directory)).filter((name) => STORAGE_FILE_NAME.test(name)).sort().reverse();
    const entries: RemoteEntry[] = [];
    for (const name of names.slice(0, 500)) {
      const stat = await fs.lstat(path.join(directory, name)).catch(() => null);
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) continue;
      entries.push({ remoteId: name, remotePath: `${folder}/${name}`, name, size: stat.size,
        createdAt: stat.mtime.toISOString(), folder, recordMarker: null });
    }
    return { entries, truncated: names.length > 500 };
  }

  async resolve(folder: StorageFolder, key: string): Promise<RemoteEntry | null> {
    if (!STORAGE_FILE_NAME.test(key)) return null;
    const target = path.join(await this.folderPath(folder), key);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) return null;
    return { remoteId: key, remotePath: `${folder}/${key}`, name: key, size: stat.size,
      createdAt: stat.mtime.toISOString(), folder, recordMarker: null };
  }

  /** The absolute path of a resolved entry (for opening a document in place). */
  absolutePath(entry: RemoteEntry): string {
    return this.filePath(entry);
  }

  async download(entry: RemoteEntry, destination: string, maxBytes: number): Promise<{ size: number; sha256: string }> {
    const source = this.filePath(entry);
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      throw new StorageProviderError("invalid", "The file in the storage folder is not a regular file Sojourner accepts.");
    }
    const hash = createHash("sha256");
    let size = 0;
    const handle = await fs.open(destination, "wx", 0o600);
    try {
      for await (const chunk of createReadStream(source, { highWaterMark: 1024 * 1024 })) {
        size += (chunk as Buffer).length;
        if (size > maxBytes) throw new StorageProviderError("invalid", "The file grew while Sojourner read it.");
        hash.update(chunk as Buffer);
        await handle.write(chunk as Buffer);
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.rm(destination, { force: true });
      throw error;
    }
    await handle.close();
    return { size, sha256: hash.digest("hex") };
  }

  async remove(ref: RemoteRef, expected: { size: number; sha256: string }): Promise<"deleted" | "absent" | "mismatch"> {
    const target = this.filePath(ref);
    const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return "absent";
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size) return "mismatch";
    if ((await hashFile(target)).sha256 !== expected.sha256) return "mismatch";
    await fs.rm(target);
    return "deleted";
  }

  /** Removes partial copies an interrupted run left behind. */
  async removePartials(): Promise<void> {
    for (const folder of STORAGE_FOLDERS) {
      const directory = path.join(this.root, folder);
      const names = await fs.readdir(directory).catch(() => [] as string[]);
      for (const name of names) {
        if (name.startsWith(PARTIAL_PREFIX)) await fs.rm(path.join(directory, name), { force: true });
      }
    }
  }
}
