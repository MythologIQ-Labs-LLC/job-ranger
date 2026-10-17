/**
 * Browser runtime adapter for the subset of `node:fs` used by the shared
 * Job Ranger core, backed by the Origin Private File System (OPFS).
 *
 * Paths are POSIX paths in a virtual namespace whose root is the origin's
 * OPFS root directory. Files are written through `createWritable()`, whose
 * contents are committed atomically when the stream closes, so a crash never
 * leaves a half-written managed artifact or SQLite snapshot in place.
 *
 * Storage failures are never swallowed: quota exhaustion and unavailable
 * storage surface as `JobRangerStorageError` with a user-actionable message,
 * and are reported to the runtime's storage-health listener.
 */
import { basename, dirname, join, resolve } from "./node-path";
import { readFileInChunks } from "./opfs-chunks";

type DirectoryHandle = FileSystemDirectoryHandle & {
  keys(): AsyncIterableIterator<string>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export class JobRangerStorageError extends Error {
  readonly code: string;
  constructor(message: string, code = "EJOBRANGERSTORAGE", options?: { cause?: unknown }) {
    super(message);
    this.name = "JobRangerStorageError";
    this.code = code;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

type StorageListener = (error: JobRangerStorageError) => void;
const storageListeners = new Set<StorageListener>();

export function onStorageFailure(listener: StorageListener): () => void {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

function fsError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

function wrapStorageError(error: unknown, action: string): never {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    if (code.startsWith("E") && code !== "EJOBRANGERSTORAGE") throw error;
  }
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  let wrapped: JobRangerStorageError;
  if (name === "QuotaExceededError") {
    wrapped = new JobRangerStorageError(
      `Browser storage is full, so Job Ranger could not ${action}. Your previous saved data is unchanged. Export a backup, free browser storage for this site, then retry.`,
      "EQUOTA",
      { cause: error },
    );
  } else if (name === "NotFoundError") {
    throw fsError("ENOENT", action);
  } else if (name === "TypeMismatchError") {
    throw fsError("ENOTDIR", action);
  } else if (name === "NoModificationAllowedError" || name === "InvalidStateError") {
    wrapped = new JobRangerStorageError(
      `Browser storage is locked or unavailable, so Job Ranger could not ${action}. Close other Job Ranger tabs and reload.`,
      "ELOCKED",
      { cause: error },
    );
  } else if (error instanceof JobRangerStorageError) {
    wrapped = error;
  } else {
    wrapped = new JobRangerStorageError(
      `Browser storage failed while Job Ranger tried to ${action}: ${error instanceof Error ? error.message : String(error)}`,
      "EIO",
      { cause: error },
    );
  }
  for (const listener of storageListeners) listener(wrapped);
  throw wrapped;
}

let rootPromise: Promise<DirectoryHandle> | null = null;

async function storageRoot(): Promise<DirectoryHandle> {
  if (!rootPromise) {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      throw new JobRangerStorageError(
        "This browser does not provide the Origin Private File System that Job Ranger needs for durable local storage.",
        "EUNSUPPORTED",
      );
    }
    rootPromise = navigator.storage.getDirectory() as Promise<DirectoryHandle>;
  }
  return rootPromise;
}

function segmentsOf(target: string): string[] {
  return resolve(String(target)).split("/").filter(Boolean);
}

async function directoryAt(segments: string[], create = false): Promise<DirectoryHandle> {
  let current = await storageRoot();
  for (const segment of segments) {
    try {
      current = (await current.getDirectoryHandle(segment, { create })) as DirectoryHandle;
    } catch (error) {
      wrapStorageError(error, `open folder ${segments.join("/")}`);
    }
  }
  return current;
}

async function parentAndName(target: string, createParents = false) {
  const segments = segmentsOf(target);
  if (segments.length === 0) throw fsError("EISDIR", "the storage root cannot be used as a file");
  const name = segments[segments.length - 1];
  const parent = await directoryAt(segments.slice(0, -1), createParents);
  return { parent, name, segments };
}

type EntryKind = "file" | "directory";

async function lookup(target: string): Promise<{ kind: EntryKind; handle: FileSystemHandle } | null> {
  const segments = segmentsOf(target);
  if (segments.length === 0) return { kind: "directory", handle: await storageRoot() };
  let parent: DirectoryHandle;
  try {
    parent = await directoryAt(segments.slice(0, -1));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT" || (error as { code?: string }).code === "ENOTDIR") return null;
    throw error;
  }
  const name = segments[segments.length - 1];
  try {
    return { kind: "file", handle: await parent.getFileHandle(name) };
  } catch {
    // fall through to directory lookup
  }
  try {
    return { kind: "directory", handle: await parent.getDirectoryHandle(name) };
  } catch {
    return null;
  }
}

/** Bytes returned by readFile keep a Buffer-compatible `toString(encoding)`. */
export class FsBytes extends Uint8Array {
  override toString(encoding: string = "utf8"): string {
    const normalized = encoding.toLowerCase();
    if (normalized === "utf8" || normalized === "utf-8") return new TextDecoder().decode(this);
    if (normalized === "latin1" || normalized === "binary") return new TextDecoder("latin1").decode(this);
    if (normalized === "hex") return Array.from(this, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (normalized === "base64") {
      let binary = "";
      for (const byte of this) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

type ChunkSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
type WriteData = string | Uint8Array | ArrayBuffer | ChunkSource;

/** Like Node, writeFile also takes an (async) iterable of byte chunks. */
function isChunkSource(data: WriteData): data is ChunkSource {
  return (
    typeof data === "object" &&
    !(data instanceof Uint8Array) &&
    !(data instanceof ArrayBuffer) &&
    (Symbol.asyncIterator in data || Symbol.iterator in data)
  );
}

/** Marks a failure of the data being written, which is not a storage failure. */
class ChunkSourceError {
  constructor(readonly error: unknown) {}
}

async function* sourceChunks(data: ChunkSource): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of data) yield chunk;
  } catch (error) {
    throw new ChunkSourceError(error);
  }
}

function toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

class Stats {
  constructor(
    private readonly kind: EntryKind,
    readonly size: number,
    readonly mtimeMs: number,
  ) {}
  get mtime(): Date {
    return new Date(this.mtimeMs);
  }
  isFile(): boolean {
    return this.kind === "file";
  }
  isDirectory(): boolean {
    return this.kind === "directory";
  }
  isSymbolicLink(): boolean {
    return false;
  }
}

async function stat(target: string): Promise<Stats> {
  const entry = await lookup(target);
  if (!entry) throw fsError("ENOENT", `no such file or directory, stat '${target}'`);
  if (entry.kind === "directory") return new Stats("directory", 0, 0);
  try {
    const file = await (entry.handle as FileSystemFileHandle).getFile();
    return new Stats("file", file.size, file.lastModified);
  } catch (error) {
    return wrapStorageError(error, `read ${basename(target)}`);
  }
}

async function readFile(target: string, options?: string | { encoding?: string | null }) {
  const encoding = typeof options === "string" ? options : options?.encoding ?? null;
  const entry = await lookup(target);
  if (!entry) throw fsError("ENOENT", `no such file or directory, open '${target}'`);
  if (entry.kind !== "file") throw fsError("EISDIR", `illegal operation on a directory, read '${target}'`);
  let buffer: ArrayBuffer;
  try {
    buffer = await (await (entry.handle as FileSystemFileHandle).getFile()).arrayBuffer();
  } catch (error) {
    return wrapStorageError(error, `read ${basename(target)}`);
  }
  const bytes = new FsBytes(buffer);
  return encoding ? bytes.toString(encoding) : bytes;
}

async function writeFile(
  target: string,
  data: WriteData,
  _options?: unknown,
): Promise<void> {
  const parentEntry = await lookup(dirname(resolve(target)));
  if (!parentEntry || parentEntry.kind !== "directory") {
    throw fsError("ENOENT", `no such file or directory, open '${target}'`);
  }
  const { parent, name } = await parentAndName(target);
  try {
    const handle = await parent.getFileHandle(name, { create: true });
    const writable = await (handle as FileSystemFileHandle & {
      createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
    }).createWritable({ keepExistingData: false });
    try {
      if (isChunkSource(data)) {
        for await (const chunk of sourceChunks(data)) await writable.write(chunk as BufferSource);
      } else {
        await writable.write(toBytes(data) as BufferSource);
      }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    // The data's own failure (for example a file that changed while being archived) is rethrown
    // as is; the uncommitted write was already discarded.
    if (error instanceof ChunkSourceError) throw error.error;
    wrapStorageError(error, `save ${name}`);
  }
}

async function mkdir(target: string, options?: { recursive?: boolean }): Promise<string | undefined> {
  const segments = segmentsOf(target);
  if (options?.recursive) {
    await directoryAt(segments, true);
    return undefined;
  }
  const existing = await lookup(target);
  if (existing) throw fsError("EEXIST", `file already exists, mkdir '${target}'`);
  const parentEntry = await lookup(dirname(resolve(target)));
  if (!parentEntry || parentEntry.kind !== "directory") {
    throw fsError("ENOENT", `no such file or directory, mkdir '${target}'`);
  }
  await directoryAt(segments, true);
  return undefined;
}

async function readdir(target: string): Promise<string[]> {
  const entry = await lookup(target);
  if (!entry) throw fsError("ENOENT", `no such file or directory, scandir '${target}'`);
  if (entry.kind !== "directory") throw fsError("ENOTDIR", `not a directory, scandir '${target}'`);
  const names: string[] = [];
  for await (const name of (entry.handle as DirectoryHandle).keys()) names.push(name);
  return names.sort();
}

async function rm(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
  const segments = segmentsOf(target);
  if (segments.length === 0) throw fsError("EPERM", "refusing to remove the storage root");
  const entry = await lookup(target);
  if (!entry) {
    if (options?.force) return;
    throw fsError("ENOENT", `no such file or directory, rm '${target}'`);
  }
  if (entry.kind === "directory" && !options?.recursive) {
    throw fsError("EISDIR", `path is a directory, rm '${target}'`);
  }
  const { parent, name } = await parentAndName(target);
  try {
    await parent.removeEntry(name, { recursive: entry.kind === "directory" });
  } catch (error) {
    wrapStorageError(error, `remove ${name}`);
  }
}

async function copyFile(source: string, destination: string): Promise<void> {
  const bytes = (await readFile(source)) as Uint8Array;
  await writeFile(destination, bytes);
}

async function copyTree(source: string, destination: string): Promise<void> {
  const entry = await lookup(source);
  if (!entry) throw fsError("ENOENT", `no such file or directory, rename '${source}'`);
  if (entry.kind === "file") {
    await copyFile(source, destination);
    return;
  }
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source)) {
    await copyTree(join(source, name), join(destination, name));
  }
}

/**
 * OPFS has no portable atomic rename for directories, so rename is a verified
 * copy followed by removal of the source. Callers in the shared core (backup
 * staging/restore) already tolerate interruption by re-validating hashes and
 * keeping the previous data as a rollback candidate until the swap completes.
 */
async function rename(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination)) return;
  const entry = await lookup(source);
  if (!entry) throw fsError("ENOENT", `no such file or directory, rename '${source}'`);
  const existing = await lookup(destination);
  if (existing) {
    if (existing.kind === "directory") {
      if ((await readdir(destination)).length > 0) {
        throw fsError("ENOTEMPTY", `directory not empty, rename '${source}' -> '${destination}'`);
      }
      await rm(destination, { recursive: true });
    } else if (entry.kind === "directory") {
      throw fsError("ENOTDIR", `not a directory, rename '${source}' -> '${destination}'`);
    }
  }
  const destinationParent = await lookup(dirname(resolve(destination)));
  if (!destinationParent || destinationParent.kind !== "directory") {
    throw fsError("ENOENT", `no such file or directory, rename '${source}' -> '${destination}'`);
  }
  await copyTree(source, destination);
  await rm(source, { recursive: true, force: true });
}

async function access(target: string): Promise<void> {
  if (!(await lookup(target))) throw fsError("ENOENT", `no such file or directory, access '${target}'`);
}

function createReadStream(target: string): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const entry = await lookup(target);
      if (!entry) throw fsError("ENOENT", `no such file or directory, open '${target}'`);
      if (entry.kind !== "file") {
        throw fsError("EISDIR", `illegal operation on a directory, read '${target}'`);
      }
      try {
        const file = await (entry.handle as FileSystemFileHandle).getFile();
        // Unlike readFile(), this never constructs a full-file ArrayBuffer.
        // Backup hash verification and other stream consumers can process
        // large artifacts with bounded transient read buffers.
        for await (const chunk of readFileInChunks(file)) yield chunk;
      } catch (error) {
        wrapStorageError(error, `stream ${basename(target)}`);
      }
    },
  };
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

export const promises = {
  access,
  copyFile,
  lstat: stat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
};

export { createReadStream };

export default { promises, constants, createReadStream };
