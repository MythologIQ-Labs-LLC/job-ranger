import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type {
  JobRangerArchiveManifest,
  JobRangerArchiveProducer,
} from "../../src/shared/backup.js";
import {
  JOB_RANGER_ARCHIVE_FILE_EXTENSION,
  JOB_RANGER_ARCHIVE_FORMAT,
  JOB_RANGER_ARCHIVE_VERSION,
  JOB_RANGER_BACKUP_FORMAT,
  JOB_RANGER_BACKUP_VERSION,
} from "../../src/shared/backup.js";

/**
 * Job Ranger portable archive (`.jobranger`).
 *
 * A single-file, runtime-neutral container for a validated Job Ranger backup
 * bundle so data can move Electron → PWA, PWA → Electron, and PWA → PWA
 * without either runtime touching the other's live database.
 *
 * Container: a ZIP file using only the STORE method (no compression, no
 * encryption, no ZIP64, no data descriptors). Every entry is CRC-32 verified,
 * every path must be a safe relative path, and the archive manifest pins the
 * SHA-256 of the inner backup manifest, which in turn pins the SHA-256 of the
 * SQLite snapshot and every managed artifact.
 */

export const ARCHIVE_MANIFEST_FILE = "job-ranger-archive.json";
export const BACKUP_MANIFEST_FILE = "manifest.json";
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024 - 1;
export const MAX_ARCHIVE_ENTRIES = 100_010;
const MAX_ARCHIVE_MANIFEST_BYTES = 1024 * 1024;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_NAME_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
// Fixed 1980-01-01 00:00 DOS timestamp keeps archive bytes deterministic for
// identical content; the authoritative creation time lives in the manifests.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export class PortableArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortableArchiveError";
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const CRC32_INITIAL = 0xffffffff;

function crc32Update(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (let index = 0; index < bytes.length; index += 1) {
    next = crcTable[(next ^ bytes[index]) & 0xff] ^ (next >>> 8);
  }
  return next;
}

function crc32Final(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  return crc32Final(crc32Update(CRC32_INITIAL, bytes));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Rejects segments that a file system could alias to a different name:
 * Windows drops trailing dots/spaces, treats `:` as an alternate data stream,
 * and maps device names; control characters are never valid.
 */
function isUnsafeSegment(segment: string): boolean {
  return (
    !segment ||
    segment === "." ||
    segment === ".." ||
    /[\x00-\x1f:<>"|?*]/.test(segment) ||
    /[. ]$/.test(segment) ||
    WINDOWS_RESERVED_NAME.test(segment)
  );
}

/** Case-insensitive file systems (Windows, macOS) treat these as one file. */
function archiveNameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

export function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some(isUnsafeSegment)
  ) {
    throw new PortableArchiveError(`Archive contains an unsafe path: ${value}`);
  }
  return normalized;
}

export interface ArchiveEntryInput {
  name: string;
  bytes: Uint8Array;
}

export function encodeStoreZip(entries: readonly ArchiveEntryInput[]): Uint8Array {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new PortableArchiveError("Too many files for a Job Ranger archive");
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const prepared = entries.map((entry) => {
    const name = normalizeArchivePath(entry.name);
    if (seen.has(archiveNameKey(name))) throw new PortableArchiveError(`Archive repeats ${name}`);
    seen.add(archiveNameKey(name));
    return { name: encoder.encode(name), bytes: entry.bytes, crc: crc32(entry.bytes) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const entry of prepared) {
    localSize += 30 + entry.name.length + entry.bytes.length;
    centralSize += 46 + entry.name.length;
  }
  const totalSize = localSize + centralSize + 22;
  if (totalSize > MAX_ARCHIVE_BYTES || totalSize > 0xffffffff) {
    throw new PortableArchiveError("Job Ranger archive exceeds the supported 2 GB size");
  }

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  let offset = 0;
  const localOffsets: number[] = [];

  for (const entry of prepared) {
    localOffsets.push(offset);
    view.setUint32(offset, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_NAME_FLAG, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, DOS_TIME, true);
    view.setUint16(offset + 12, DOS_DATE, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.bytes.length, true);
    view.setUint32(offset + 22, entry.bytes.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(entry.name, offset + 30);
    output.set(entry.bytes, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.bytes.length;
  }

  const centralOffset = offset;
  prepared.forEach((entry, index) => {
    view.setUint32(offset, CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_NAME_FLAG, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, DOS_TIME, true);
    view.setUint16(offset + 14, DOS_DATE, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.bytes.length, true);
    view.setUint32(offset + 24, entry.bytes.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    output.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });

  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, offset - centralOffset, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}

export interface DecodedArchiveEntry {
  name: string;
  bytes: Uint8Array;
}

export function decodeStoreZip(archive: Uint8Array): DecodedArchiveEntry[] {
  if (archive.length < 22) throw new PortableArchiveError("This file is not a Job Ranger archive");
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new PortableArchiveError("Job Ranger archive exceeds the supported 2 GB size");
  }
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  const searchFloor = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= searchFloor; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new PortableArchiveError("This file is not a Job Ranger archive");

  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new PortableArchiveError("Multi-part archives are not supported");
  }
  if (totalEntries === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new PortableArchiveError("ZIP64 archives are not supported");
  }
  if (centralOffset + centralSize > eocd) {
    throw new PortableArchiveError("Archive directory is corrupt");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: DecodedArchiveEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let declaredBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new PortableArchiveError("Archive directory is corrupt");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength > eocd) throw new PortableArchiveError("Archive directory is corrupt");
    let rawName: string;
    try {
      rawName = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw new PortableArchiveError("Archive contains a file name that is not valid UTF-8");
    }
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & ENCRYPTED_FLAG) throw new PortableArchiveError("Encrypted archives are not supported");
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new PortableArchiveError(`Archive contains a symbolic link: ${rawName}`);
    }
    if (rawName.endsWith("/")) {
      if (size !== 0) throw new PortableArchiveError(`Archive directory entry has content: ${rawName}`);
      continue;
    }
    if (method !== 0 || compressedSize !== size) {
      throw new PortableArchiveError(
        "This archive was re-compressed or modified by another tool. Use the original .jobranger file exported by Job Ranger.",
      );
    }
    const name = normalizeArchivePath(rawName);
    if (names.has(archiveNameKey(name))) throw new PortableArchiveError(`Archive repeats ${name}`);
    names.add(archiveNameKey(name));
    declaredBytes += size;
    if (declaredBytes > archive.length) throw new PortableArchiveError("Archive sizes are inconsistent");

    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new PortableArchiveError(`Archive entry header is corrupt: ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > centralOffset) throw new PortableArchiveError(`Archive entry data is truncated: ${name}`);
    const bytes = archive.subarray(dataStart, dataEnd);
    if (crc32(bytes) !== crc) {
      throw new PortableArchiveError(`Archive entry failed its CRC-32 check: ${name}`);
    }
    entries.push({ name, bytes });
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new PortableArchiveError("Archive contains too many files");
  return entries;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseArchiveManifest(value: unknown): JobRangerArchiveManifest {
  if (!isObject(value) || value.format !== JOB_RANGER_ARCHIVE_FORMAT) {
    throw new PortableArchiveError("This file is not a Job Ranger archive");
  }
  if (typeof value.archiveVersion !== "number" || !Number.isInteger(value.archiveVersion)) {
    throw new PortableArchiveError("Job Ranger archive version is invalid");
  }
  if (value.archiveVersion > JOB_RANGER_ARCHIVE_VERSION) {
    throw new PortableArchiveError(
      `This archive was created by a newer Job Ranger (archive format v${value.archiveVersion}). Update Job Ranger before restoring it.`,
    );
  }
  if (value.archiveVersion < 1) throw new PortableArchiveError("Job Ranger archive version is invalid");
  const producer = value.producer;
  const content = value.content;
  const backupManifest = value.backupManifest;
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !isObject(producer) ||
    (producer.runtime !== "electron" && producer.runtime !== "web") ||
    typeof producer.channel !== "string" ||
    typeof producer.appVersion !== "string" ||
    typeof producer.buildId !== "string" ||
    !isObject(content) ||
    content.format !== JOB_RANGER_BACKUP_FORMAT ||
    typeof content.version !== "number" ||
    !isObject(backupManifest) ||
    backupManifest.path !== BACKUP_MANIFEST_FILE ||
    typeof backupManifest.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(backupManifest.sha256) ||
    typeof backupManifest.bytes !== "number"
  ) {
    throw new PortableArchiveError("Job Ranger archive manifest is invalid");
  }
  if (content.version !== JOB_RANGER_BACKUP_VERSION) {
    throw new PortableArchiveError(
      `This archive contains backup format v${content.version}, which this Job Ranger version cannot restore.`,
    );
  }
  return {
    format: JOB_RANGER_ARCHIVE_FORMAT,
    archiveVersion: JOB_RANGER_ARCHIVE_VERSION,
    createdAt: value.createdAt,
    producer: {
      runtime: producer.runtime,
      channel: producer.channel,
      appVersion: producer.appVersion,
      buildId: producer.buildId,
    },
    content: { format: JOB_RANGER_BACKUP_FORMAT, version: JOB_RANGER_BACKUP_VERSION },
    backupManifest: {
      path: BACKUP_MANIFEST_FILE,
      sha256: backupManifest.sha256,
      bytes: backupManifest.bytes,
    },
  };
}

/** An archive entry whose bytes are either small and in memory or streamed from a file. */
interface StreamedEntry {
  name: string;
  encodedName: Uint8Array;
  size: number;
  crc: number;
  bytes?: Uint8Array;
  sourcePath?: string;
}

async function* entryChunks(entry: StreamedEntry): AsyncGenerator<Uint8Array> {
  if (entry.bytes) {
    yield entry.bytes;
    return;
  }
  for await (const chunk of createReadStream(entry.sourcePath as string)) yield chunk as Uint8Array;
}

/** CRC-32 and length of a file, read in bounded chunks. */
async function measureFile(sourcePath: string): Promise<{ crc: number; size: number }> {
  let crc = CRC32_INITIAL;
  let size = 0;
  for await (const chunk of createReadStream(sourcePath)) {
    crc = crc32Update(crc, chunk as Uint8Array);
    size += (chunk as Uint8Array).length;
  }
  return { crc: crc32Final(crc), size };
}

function entryArchiveBytes(entry: { encodedName: Uint8Array }, size: number): number {
  return 30 + 46 + 2 * entry.encodedName.length + size;
}

// Same layout as encodeStoreZip (kept as the in-memory reference), one header at a time.
function localHeader(entry: StreamedEntry): Uint8Array {
  const header = new Uint8Array(30 + entry.encodedName.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_NAME_FLAG, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.encodedName.length, true);
  view.setUint16(28, 0, true);
  header.set(entry.encodedName, 30);
  return header;
}

function centralDirectory(
  entries: readonly StreamedEntry[],
  localOffsets: readonly number[],
  centralOffset: number,
): Uint8Array {
  let centralSize = 0;
  for (const entry of entries) centralSize += 46 + entry.encodedName.length;
  const output = new Uint8Array(centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  entries.forEach((entry, index) => {
    view.setUint32(offset, CENTRAL_HEADER_SIGNATURE, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_NAME_FLAG, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, DOS_TIME, true);
    view.setUint16(offset + 14, DOS_DATE, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.size, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, entry.encodedName.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    output.set(entry.encodedName, offset + 46);
    offset += 46 + entry.encodedName.length;
  });
  view.setUint32(offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}

/**
 * Yields the bytes encodeStoreZip would produce for these entries, reading each file again in
 * bounded chunks. A file whose length or CRC-32 differs from the first pass fails the archive.
 */
async function* storeZipChunks(entries: readonly StreamedEntry[]): AsyncGenerator<Uint8Array> {
  const localOffsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    localOffsets.push(offset);
    const header = localHeader(entry);
    yield header;
    let crc = CRC32_INITIAL;
    let size = 0;
    for await (const chunk of entryChunks(entry)) {
      crc = crc32Update(crc, chunk);
      size += chunk.length;
      if (size > entry.size) break;
      yield chunk;
    }
    if (size !== entry.size || crc32Final(crc) !== entry.crc) {
      throw new PortableArchiveError(`${entry.name} changed while the backup archive was being written`);
    }
    offset += header.length + entry.size;
  }
  yield centralDirectory(entries, localOffsets, offset);
}

/**
 * Lists the archive entries for a bundle: the two manifests in memory, every other file by path
 * with its length and CRC-32 (first pass). Applies the same name, count and size rules as
 * encodeStoreZip before anything is written.
 */
async function prepareBundleEntries(
  bundleDirectory: string,
  archiveManifestFor: (backupManifestBytes: Uint8Array) => Uint8Array,
): Promise<StreamedEntry[]> {
  const manifestBytes = await fs.readFile(path.join(bundleDirectory, BACKUP_MANIFEST_FILE));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    database: { path: string };
    artifactFiles: Array<{ path: string }>;
  };
  const relativePaths = [manifest.database.path, ...manifest.artifactFiles.map((file) => file.path)];
  if (relativePaths.length + 2 > MAX_ARCHIVE_ENTRIES) {
    throw new PortableArchiveError("Too many files for a Job Ranger archive");
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const named = (name: string) => {
    const safe = normalizeArchivePath(name);
    if (seen.has(archiveNameKey(safe))) throw new PortableArchiveError(`Archive repeats ${safe}`);
    seen.add(archiveNameKey(safe));
    return { name: safe, encodedName: encoder.encode(safe) };
  };
  const inMemory = (name: string, bytes: Uint8Array): StreamedEntry => ({
    ...named(name),
    bytes,
    size: bytes.length,
    crc: crc32(bytes),
  });
  const entries = [
    inMemory(ARCHIVE_MANIFEST_FILE, archiveManifestFor(manifestBytes)),
    inMemory(BACKUP_MANIFEST_FILE, manifestBytes),
  ];
  const tooLarge = () => new PortableArchiveError("Job Ranger archive exceeds the supported 2 GB size");
  let totalSize = 22 + entries.reduce((sum, entry) => sum + entryArchiveBytes(entry, entry.size), 0);
  for (const relativePath of relativePaths) {
    const entry = named(relativePath);
    const sourcePath = path.join(bundleDirectory, ...entry.name.split("/"));
    const stat = await fs.lstat(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new PortableArchiveError(`Backup file is not a regular file: ${entry.name}`);
    }
    // Refuse before reading a byte when the files alone are already too large.
    if (totalSize + entryArchiveBytes(entry, stat.size) > MAX_ARCHIVE_BYTES) throw tooLarge();
    const measured = await measureFile(sourcePath);
    totalSize += entryArchiveBytes(entry, measured.size);
    if (totalSize > MAX_ARCHIVE_BYTES) throw tooLarge();
    entries.push({ ...entry, sourcePath, ...measured });
  }
  return entries;
}

/**
 * Packs a backup bundle directory (already integrity-validated by
 * BackupService) into a single `.jobranger` archive file.
 *
 * The archive is streamed to disk: each file is read twice in bounded chunks
 * (once for its CRC-32, once to write it) instead of holding every file plus a
 * full archive copy in memory. The bytes are identical to encodeStoreZip's.
 */
export async function packBackupBundle(input: {
  bundleDirectory: string;
  archivePath: string;
  producer: JobRangerArchiveProducer;
  createdAt?: string;
}): Promise<{ manifest: JobRangerArchiveManifest; bytes: number; sha256: string }> {
  let manifest: JobRangerArchiveManifest | undefined;
  const entries = await prepareBundleEntries(input.bundleDirectory, (backupManifestBytes) => {
    manifest = {
      format: JOB_RANGER_ARCHIVE_FORMAT,
      archiveVersion: JOB_RANGER_ARCHIVE_VERSION,
      createdAt: input.createdAt ?? new Date().toISOString(),
      producer: input.producer,
      content: { format: JOB_RANGER_BACKUP_FORMAT, version: JOB_RANGER_BACKUP_VERSION },
      backupManifest: {
        path: BACKUP_MANIFEST_FILE,
        sha256: sha256Hex(backupManifestBytes),
        bytes: backupManifestBytes.length,
      },
    };
    return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  });
  const hash = createHash("sha256");
  let bytes = 0;
  async function* hashedChunks(): AsyncGenerator<Uint8Array> {
    for await (const chunk of storeZipChunks(entries)) {
      hash.update(chunk);
      bytes += chunk.length;
      yield chunk;
    }
  }
  const temporaryPath = `${input.archivePath}.partial`;
  await fs.mkdir(path.dirname(input.archivePath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, hashedChunks());
    await fs.rename(temporaryPath, input.archivePath);
  } catch (error) {
    // Never leave a partial archive behind, whether a file changed, storage filled up or a write failed.
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { manifest: manifest as JobRangerArchiveManifest, bytes, sha256: hash.digest("hex") };
}

/**
 * Validates the archive container and writes its backup bundle into
 * `destinationDirectory` (which must not already exist). The extracted bundle
 * must still be validated by BackupService before it can be restored.
 */
export async function extractArchiveToBundle(
  archivePath: string,
  destinationDirectory: string,
): Promise<JobRangerArchiveManifest> {
  const stat = await fs.lstat(archivePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PortableArchiveError("Select a Job Ranger archive file");
  }
  if (stat.size > MAX_ARCHIVE_BYTES) {
    throw new PortableArchiveError("Job Ranger archive exceeds the supported 2 GB size");
  }
  const entries = decodeStoreZip(await fs.readFile(archivePath));
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get(ARCHIVE_MANIFEST_FILE);
  if (!manifestEntry || manifestEntry.bytes.length > MAX_ARCHIVE_MANIFEST_BYTES) {
    throw new PortableArchiveError("This file is not a Job Ranger archive");
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  } catch {
    throw new PortableArchiveError("Job Ranger archive manifest is not valid JSON");
  }
  const manifest = parseArchiveManifest(manifestJson);
  const backupManifest = byName.get(BACKUP_MANIFEST_FILE);
  if (
    !backupManifest ||
    backupManifest.bytes.length !== manifest.backupManifest.bytes ||
    sha256Hex(backupManifest.bytes) !== manifest.backupManifest.sha256
  ) {
    throw new PortableArchiveError("Job Ranger archive backup manifest failed integrity verification");
  }

  await fs.mkdir(destinationDirectory, { recursive: false });
  for (const entry of entries) {
    if (entry.name === ARCHIVE_MANIFEST_FILE) continue;
    const target = path.join(destinationDirectory, ...entry.name.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.bytes);
  }
  return manifest;
}

export function isArchiveFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(JOB_RANGER_ARCHIVE_FILE_EXTENSION);
}
