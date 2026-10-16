import assert from "node:assert/strict";
import { test } from "node:test";
import { fileBytesForTransfer } from "../src/pwa/runtime/transfer-file-bytes.ts";

test("full, privately owned file buffers cross the worker boundary without a second copy", () => {
  const file = new Uint8Array(16 * 1024 * 1024);
  for (let index = 0; index < file.length; index += 4096) file[index] = index / 4096 % 251;
  const original = file.buffer;
  const transferable = fileBytesForTransfer(file);
  assert.strictEqual(transferable, original, "an exact owned buffer should be reused");
  const sent = structuredClone({ bytes: transferable }, { transfer: [transferable] });
  assert.equal(original.byteLength, 0, "the worker relinquishes its transferred buffer");
  assert.equal(sent.bytes.byteLength, 16 * 1024 * 1024);
  const receiver = new Uint8Array(sent.bytes);
  for (let index = 0; index < receiver.length; index += 4096) {
    assert.equal(receiver[index], index / 4096 % 251);
  }
});

test("offset or partial views are copied exactly rather than detaching unrelated bytes", () => {
  const owner = Uint8Array.from([33, 11, 22, 33, 44, 55]);
  const fragment = owner.subarray(1, 4);
  const copied = fileBytesForTransfer(fragment);
  assert.notStrictEqual(copied, owner.buffer);
  assert.equal(copied.byteLength, 3);
  assert.deepEqual([...new Uint8Array(copied)], [11, 22, 33]);
  structuredClone({ bytes: copied }, { transfer: [copied] });
  assert.deepEqual([...owner], [33, 11, 22, 33, 44, 55], "source remains usable");
});

test("shared buffers are copied to avoid attempting a forbidden transfer", () => {
  if (typeof SharedArrayBuffer === "undefined") return;
  const shared = new SharedArrayBuffer(6);
  const file = new Uint8Array(shared);
  file.set([9, 8, 7, 6, 5, 4]);
  const transferable = fileBytesForTransfer(file);
  assert.ok(transferable instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(transferable)], [9, 8, 7, 6, 5, 4]);
  assert.deepEqual([...new Uint8Array(shared)], [9, 8, 7, 6, 5, 4]);
});
