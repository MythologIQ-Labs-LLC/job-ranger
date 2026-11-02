import assert from "node:assert/strict";
import { test } from "node:test";
import { createStdioLineFramer } from "../mcp/stdio-line-framer.mjs";
const MAX = 128 * 1024;
function fixture(maxLineBytes = MAX) {
  const lines = [];
  let oversize = 0;
  return { lines, get oversize() { return oversize; }, feed: createStdioLineFramer({
    maxLineBytes,
    onLine: line => lines.push(line),
    onOversize: () => oversize++,
  }) };
}

test("3,300 individually valid requests delivered in one oversized pipe chunk survive", () => {
  const f = fixture();
  const requests = Array.from({ length: 3300 }, (_, i) =>
    JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "ping" }));
  const burst = requests.join("\n") + "\n";
  assert.ok(Buffer.byteLength(burst) > MAX);
  assert.ok(requests.every(line => Buffer.byteLength(line) < MAX));
  f.feed(burst);
  assert.deepEqual(f.lines, requests);
  assert.equal(f.oversize, 0);
});

test("a single oversized frame is discarded without corrupting the next frame", () => {
  const f = fixture(32);
  f.feed("x".repeat(33));
  assert.equal(f.oversize, 1);
  f.feed('{"jsonrpc":"2.0","id":1}'); // continuation, not a new JSON-RPC request
  assert.deepEqual(f.lines, []);
  f.feed("\nOK\n");
  assert.deepEqual(f.lines, ["OK"]);
  assert.equal(f.oversize, 1);
});

test("oversized terminated frame rejects only that frame in a combined chunk", () => {
  const f = fixture(12);
  f.feed("good\n" + "x".repeat(40) + "\ngood2\n");
  assert.deepEqual(f.lines, ["good", "good2"]);
  assert.equal(f.oversize, 1);
});

test("UTF-8 encoded byte size, not JS code units, sets the cap", () => {
  const f = fixture(7);
  f.feed("éééé\nok\n");
  assert.deepEqual(f.lines, ["ok"]);
  assert.equal(f.oversize, 1);
});

test("frames split across calls retain exact contents", () => {
  const f = fixture(24);
  f.feed('{"id":1');
  f.feed(',"method":"ping"}\n');
  f.feed("\nsecond\nthird");
  f.feed("-part\n");
  assert.deepEqual(f.lines, ['{"id":1,"method":"ping"}', "", "second", "third-part"]);
  assert.equal(f.oversize, 0);
});

test("oversize continuation containing a newline does not corrupt following same-chunk frame", () => {
  const f = fixture(8);
  f.feed("x".repeat(9));
  f.feed("suffix\nokay\n");
  assert.deepEqual(f.lines, ["okay"]);
  assert.equal(f.oversize, 1);
});

test("invalid framing configuration is rejected", () => {
  assert.throws(() => createStdioLineFramer({ maxLineBytes: 0, onLine() {}, onOversize() {} }));
  assert.throws(() => createStdioLineFramer({ maxLineBytes: 12, onLine: null, onOversize() {} }));
});
