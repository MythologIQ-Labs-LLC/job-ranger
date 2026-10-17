// #302: the web runtime's fs adapter accepts chunked data in writeFile (as Node does), so the
// archive pack can stream to OPFS. All chunks go through one writable, so the file is committed
// on close or discarded on abort; a failure of the data itself is not reported as a storage fault.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

// Same extensionless-import hook as tests/pwa-opfs-read-stream.test.mjs (CI runs Node 22.12).
const extensionlessTs = `
export async function resolve(specifier, context, nextResolve) {
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith(".ts")) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(extensionlessTs)}`);

function notFound() {
  return Object.assign(new Error("not found"), { name: "NotFoundError" });
}

// The adapter caches the OPFS root, so one fake root is shared and its state reset per test.
const state = { committed: new Map(), log: { writes: [], closed: 0, aborted: 0 }, failWriteAt: 0, refuseWholeReads: false, failStreamOf: null };

/** Resets the fake OPFS root: writables commit on close and discard on abort. */
function fakeOpfs({ failWriteAt = 0, refuseWholeReads = false } = {}) {
  state.committed = new Map();
  state.log = { writes: [], closed: 0, aborted: 0 };
  state.failWriteAt = failWriteAt;
  state.refuseWholeReads = refuseWholeReads;
  state.failStreamOf = null;
  return state;
}

const fileHandle = (name) => ({
  kind: "file",
  async createWritable() {
    const pending = [];
    return {
      async write(chunk) {
        if (state.failWriteAt && state.log.writes.length + 1 === state.failWriteAt) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        pending.push(Buffer.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
        state.log.writes.push(chunk.byteLength);
      },
      async close() {
        state.log.closed += 1;
        state.committed.set(name, Buffer.concat(pending));
      },
      async abort() {
        state.log.aborted += 1;
      },
    };
  },
  async getFile() {
    const bytes = state.committed.get(name) ?? Buffer.alloc(0);
    return {
      size: bytes.byteLength,
      lastModified: 0,
      async arrayBuffer() {
        if (state.refuseWholeReads) throw new Error(`whole-file read of ${name}`);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      stream() {
        if (state.failStreamOf !== name) return new Blob([bytes]).stream();
        // One chunk, then the browser reports the file unreadable.
        let sent = false;
        return new ReadableStream({
          pull(controller) {
            if (sent) controller.error(new DOMException("unreadable", "NotReadableError"));
            else { sent = true; controller.enqueue(bytes.subarray(0, 16)); }
          },
        });
      },
    };
  },
});

const root = {
  kind: "directory",
  async getDirectoryHandle() { throw notFound(); },
  async removeEntry(name) {
    if (!state.committed.delete(name)) throw notFound();
  },
  async getFileHandle(name, options) {
    if (!state.committed.has(name)) {
      if (!options?.create) throw notFound();
      state.committed.set(name, undefined);
    }
    return fileHandle(name);
  },
};
Object.defineProperty(globalThis, "navigator", {
  value: { storage: { getDirectory: async () => root } },
  configurable: true,
});

const { promises: fs, onStorageFailure, JobRangerStorageError } = await import("../src/pwa/adapters/node-fs.ts");
const storageFailures = [];
onStorageFailure((error) => storageFailures.push(error));

function chunks(count, size) {
  return Array.from({ length: count }, (_, index) => new Uint8Array(size).fill(index + 1));
}

test("writeFile streams an async iterable through one writable and commits it on close", async () => {
  const { committed, log } = fakeOpfs();
  const parts = chunks(5, 1024);
  await fs.writeFile("/archive.jobranger.partial", (async function* () { yield* parts; })());
  assert.deepEqual(log.writes, [1024, 1024, 1024, 1024, 1024]);
  assert.equal(log.closed, 1);
  assert.equal(log.aborted, 0);
  assert.deepEqual(new Uint8Array(committed.get("archive.jobranger.partial")), new Uint8Array(Buffer.concat(parts)));
});

test("a Uint8Array is still written once, not iterated byte by byte", async () => {
  const { log } = fakeOpfs();
  await fs.writeFile("/single.bin", new Uint8Array(4096));
  assert.deepEqual(log.writes, [4096]);
});

test("a failure of the data aborts the write and is rethrown unchanged, not as a storage fault", async () => {
  const { committed, log } = fakeOpfs();
  const failure = new Error("artifact changed while the backup archive was being written");
  const before = storageFailures.length;
  await assert.rejects(
    fs.writeFile("/archive.jobranger.partial", (async function* () {
      yield new Uint8Array(10);
      throw failure;
    })()),
    (error) => error === failure,
  );
  assert.equal(log.aborted, 1);
  assert.equal(log.closed, 0);
  assert.equal(committed.has("archive.jobranger.partial"), false, "the file this call created is removed");
  assert.equal(storageFailures.length, before);
});

test("quota exhaustion mid-stream aborts, stops reading the source and reports storage full", async () => {
  const { committed, log } = fakeOpfs({ failWriteAt: 3 });
  let produced = 0;
  let sourceClosed = false;
  const before = storageFailures.length;
  await assert.rejects(
    fs.writeFile("/archive.jobranger.partial", (async function* () {
      try {
        for (const chunk of chunks(10, 64)) {
          produced += 1;
          yield chunk;
        }
      } finally {
        sourceClosed = true;
      }
    })()),
    (error) => error instanceof JobRangerStorageError && error.code === "EQUOTA",
  );
  assert.equal(produced, 3);
  assert.equal(sourceClosed, true, "source iterator released");
  assert.equal(log.aborted, 1);
  assert.equal(log.closed, 0);
  assert.equal(committed.has("archive.jobranger.partial"), false);
  assert.equal(storageFailures.length, before + 1);
});

test("other typed arrays are written as their bytes, not iterated as numbers", async () => {
  const { committed, log } = fakeOpfs();
  const words = new Uint16Array([0x0102, 0x0304]);
  await fs.writeFile("/words.bin", words);
  assert.deepEqual(log.writes, [4]);
  assert.deepEqual(new Uint8Array(committed.get("words.bin")), new Uint8Array(words.buffer));
});

test("rename (a copy on OPFS) streams the file instead of reading it whole", async () => {
  const { OPFS_READ_CHUNK_BYTES } = await import("../src/pwa/adapters/opfs-chunks.ts");
  const { committed, log } = fakeOpfs();
  const bytes = new Uint8Array(OPFS_READ_CHUNK_BYTES * 2 + 9);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  await fs.writeFile("/backup.jobranger.partial", bytes);
  state.refuseWholeReads = true;
  log.writes = [];
  await fs.rename("/backup.jobranger.partial", "/backup.jobranger");
  assert.ok(log.writes.length > 1, "copied in more than one write");
  assert.ok(Math.max(...log.writes) <= OPFS_READ_CHUNK_BYTES);
  assert.deepEqual(new Uint8Array(committed.get("backup.jobranger")), bytes);
  assert.equal(committed.has("backup.jobranger.partial"), false);
});

test("copying a missing file fails without creating the destination", async () => {
  const { committed } = fakeOpfs();
  await assert.rejects(fs.copyFile("/missing.bin", "/copy.bin"), (error) => error.code === "ENOENT");
  assert.equal(committed.has("copy.bin"), false);
});

test("a copy whose source fails mid-read leaves no new file and reports storage once", async () => {
  const { committed } = fakeOpfs();
  await fs.writeFile("/source.bin", new Uint8Array(64).fill(3));
  state.failStreamOf = "source.bin";
  const before = storageFailures.length;
  await assert.rejects(fs.copyFile("/source.bin", "/copy.bin"), (error) => error instanceof JobRangerStorageError && error.code === "EIO");
  assert.equal(committed.has("copy.bin"), false);
  assert.equal(storageFailures.length, before + 1);
});

test("a failed write over an existing file keeps the file and its previous contents", async () => {
  const { committed } = fakeOpfs();
  await fs.writeFile("/marker.json", "old");
  await assert.rejects(fs.writeFile("/marker.json", (async function* () {
    yield new Uint8Array([1]);
    throw new Error("source failed");
  })()), /source failed/);
  assert.equal(committed.get("marker.json").toString(), "old");
});
