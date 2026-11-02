import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { OPFS_READ_CHUNK_BYTES, readFileInChunks } from "../src/pwa/adapters/opfs-chunks.ts";

test("native OPFS streaming hashes a multi-megabyte file without calling arrayBuffer", async () => {
  const bytes = new Uint8Array(OPFS_READ_CHUNK_BYTES * 5 + 17);
  for (let i = 0; i < bytes.length; i += 4093) bytes[i] = (i / 4093) % 251;
  const blob = new Blob([bytes]);
  const file = {
    arrayBuffer() { throw new Error("full-file arrayBuffer must not be used"); },
    stream() { return blob.stream(); },
  };
  const hash = createHash("sha256");
  let count = 0;
  let chunks = 0;
  for await (const chunk of readFileInChunks(file)) {
    assert.ok(chunk.byteLength > 0 && chunk.byteLength <= OPFS_READ_CHUNK_BYTES);
    hash.update(chunk);
    count += chunk.byteLength;
    chunks++;
  }
  assert.equal(count, bytes.length);
  assert.ok(chunks > 1);
  assert.equal(hash.digest("hex"), createHash("sha256").update(bytes).digest("hex"));
});

test("oversized browser-provided chunks are split into bounded views without copying", async () => {
  const source = new Uint8Array(OPFS_READ_CHUNK_BYTES * 3 + 29);
  source[0] = 11;
  source[source.length - 1] = 77;
  const file = { stream: () => new ReadableStream({
    start(controller) { controller.enqueue(source); controller.close(); },
  }) };
  const offsets = [];
  let total = 0;
  for await (const chunk of readFileInChunks(file)) {
    assert.ok(chunk.byteLength <= OPFS_READ_CHUNK_BYTES);
    assert.strictEqual(chunk.buffer, source.buffer);
    offsets.push(chunk.byteOffset);
    total += chunk.length;
  }
  assert.equal(total, source.length);
  assert.deepEqual(offsets, [0, 1048576, 2097152, 3145728]);
});

test("early consumer exit cancels the underlying browser file reader", async () => {
  let cancelled = 0;
  const file = { stream: () => new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled++; },
  }) };
  for await (const chunk of readFileInChunks(file)) {
    assert.equal(chunk.length, 4);
    break;
  }
  assert.equal(cancelled, 1);
});

test("non-byte streams fail closed rather than producing a false checksum", async () => {
  const file = { stream: () => new ReadableStream({
    start(controller) { controller.enqueue("wrong type"); controller.close(); },
  }) };
  await assert.rejects(async () => {
    for await (const _chunk of readFileInChunks(file)) void _chunk;
  }, /non-byte chunk/);
});
