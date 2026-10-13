import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictAgentJson } from './support/strict-json-contract-parser.mjs';

const reject = (input, pattern) => assert.throws(() => parseStrictAgentJson(input), pattern);

test('accepts a valid nested contract object, arrays and Unicode', () => {
  const a = parseStrictAgentJson(Buffer.from('{"format":"jr-agent-operation-batch","payload":{"notes":["résumé","🎓"],"count":3,"active":false,"nullable":null}}'));
  assert.deepEqual(a.payload.notes, ['résumé', '🎓']);
  assert.equal(a.payload.count, 3);
});
test('rejects duplicate top-level keys conventional JSON.parse silently overwrites', () => {
  assert.deepEqual(JSON.parse('{"status":"proposed","status":"confirmed"}'), { status: 'confirmed' });
  reject('{"status":"proposed","status":"confirmed"}', /Duplicate JSON object key/);
});
test('rejects duplicate nested keys', () => {
  reject('{"agent":{"status":"proposed","status":"approved"}}', /Duplicate JSON object key/);
});
test('detects escaped duplicate key equivalence', () => {
  reject('{"status":"proposed","st\\u0061tus":"approved"}', /Duplicate JSON object key/);
});
test('allows same key in independent array objects', () => {
  assert.deepEqual(parseStrictAgentJson('[{"id":1},{"id":2}]'), [{ id: 1 }, { id: 2 }]);
});
test('rejects prototype-oriented keys even with escape encoding', () => {
  reject('{"\\u005f_proto__":{"approved":true}}', /Forbidden JSON property/);
  reject('{"constructor":true}', /Forbidden JSON property/);
});
test('rejects malformed JSON, trailing commas and comments', () => {
  reject('{"x":1,}', /SyntaxError/);
  reject('{"x":1 /*x*/}', /SyntaxError/);
});
test('rejects BOM and invalid UTF-8 bytes', () => {
  reject(Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d]), /BOM/);
  reject(Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d]), /valid for encoding|encoded|UTF-8/i);
});
test('rejects lone surrogate escapes, accepts paired surrogate', () => {
  reject('"\\ud800"', /Unpaired high surrogate/);
  reject('"\\udc00"', /Unpaired low surrogate/);
  assert.equal(parseStrictAgentJson('"\\ud83c\\udf93"'), '🎓');
});
test('enforces byte and nesting bounds', () => {
  assert.throws(() => parseStrictAgentJson('\"' + 'x'.repeat(300) + '\"', { maxBytes: 100 }), /limit/i);
  reject('['.repeat(65) + '0' + ']'.repeat(65), /nesting exceeds limit/);
});

test('rejects JSON numbers outside safe finite bounds', () => {
  reject('{"bytes":1e400}', /numeric value is unsafe/);
  reject('{"bytes":9007199254740993}', /numeric value is unsafe/);
});
test('deterministic differential fuzz preserves 1,500 valid nested JSON objects', () => {
  let state = 0x12345678;
  const rnd = () => ((state ^= state << 13, state ^= state >>> 17,
    state ^= state << 5) >>> 0) / 4294967296;
  const chars = ['abc', '"', '\\', '\n', '🌐', '💼', 'é', '✓', '/', '\t', '\b', '\r', '\0', '123', 'alpha'];
  const randomString = () => {
    let result = '';
    for (let i = 0, count = Math.floor(rnd() * 12); i < count; i++) {
      result += chars[Math.floor(rnd() * chars.length)];
    }
    return result;
  };
  function value(depth) {
    if (depth > 5) return rnd() > 0.5 ? randomString() : Math.floor(rnd() * 10000);
    switch (Math.floor(rnd() * 6)) {
      case 0: return rnd() > 0.5;
      case 1: return null;
      case 2: return Math.floor(rnd() * 100000);
      case 3: return randomString();
      case 4: return Array.from({ length: Math.floor(rnd() * 6) }, () => value(depth + 1));
      default: {
        const object = {};
        for (let i = 0, count = Math.floor(rnd() * 7); i < count; i++) {
          object['key' + i + randomString()] = value(depth + 1);
        }
        return object;
      }
    }
  }
  for (let i = 0; i < 1500; i++) {
    const json = JSON.stringify(value(0));
    assert.deepEqual(parseStrictAgentJson(json), JSON.parse(json), 'case ' + i);
  }
});
