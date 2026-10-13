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
