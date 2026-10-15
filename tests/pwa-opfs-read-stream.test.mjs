// #302: the web runtime's fs adapter must stream OPFS files to its consumers (backup hashing,
// copies) instead of reading a whole file into one ArrayBuffer, and both download paths must hand
// the worker's bytes over without a second full copy. The helpers have their own tests; these
// check that the adapter and the workers actually use them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test } from "node:test";

// The adapter imports siblings without an extension, as Vite resolves them. module.register
// (async hooks) is used because CI runs Node 22.12, which has no module.registerHooks.
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

/** A minimal OPFS root whose files refuse whole-file reads. */
function fakeOpfs(files) {
  const fileHandle = (bytes) => ({
    kind: "file",
    async getFile() {
      const blob = new Blob([bytes]);
      return {
        size: bytes.byteLength,
        arrayBuffer() { throw new Error("createReadStream must not read the whole file into one ArrayBuffer"); },
        stream() { return blob.stream(); },
      };
    },
  });
  const root = {
    kind: "directory",
    async getDirectoryHandle() { throw notFound(); },
    async getFileHandle(name) {
      if (!(name in files)) throw notFound();
      return fileHandle(files[name]);
    },
  };
  return { storage: { getDirectory: async () => root } };
}

test("createReadStream streams an OPFS file in bounded chunks without a whole-file read", async () => {
  const { OPFS_READ_CHUNK_BYTES } = await import("../src/pwa/adapters/opfs-chunks.ts");
  const bytes = new Uint8Array(OPFS_READ_CHUNK_BYTES * 3 + 5);
  for (let index = 0; index < bytes.length; index += 997) bytes[index] = index % 253;
  Object.defineProperty(globalThis, "navigator", { value: fakeOpfs({ "artifact.bin": bytes }), configurable: true });

  const { createReadStream } = await import("../src/pwa/adapters/node-fs.ts");
  const hash = createHash("sha256");
  let total = 0;
  let chunks = 0;
  for await (const chunk of createReadStream("/artifact.bin")) {
    assert.ok(chunk.byteLength <= OPFS_READ_CHUNK_BYTES);
    hash.update(chunk);
    total += chunk.byteLength;
    chunks += 1;
  }
  assert.equal(total, bytes.byteLength);
  assert.ok(chunks > 1);
  assert.equal(hash.digest("hex"), createHash("sha256").update(bytes).digest("hex"));
});

test("both worker download paths hand bytes over through fileBytesForTransfer", () => {
  for (const file of ["src/pwa/runtime/worker-main.ts", "src/pwa/adapters/electron-worker.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /bytes: fileBytesForTransfer\(bytes\)/, `${file} must transfer download bytes without a second copy`);
  }
});
