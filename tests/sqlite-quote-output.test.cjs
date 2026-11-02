// sqlite3 CLIs before 3.48 alter control characters in -json output, so SqliteClient reads them
// through `-header -quote` output instead (#321). The parser must return what -json would.
const assert = require('node:assert/strict');
const { parseQuoteOutput, jsonEscapesControlCharacters } = require('../electron-runtime/electron/src/sqlite-quote-output.cjs');

const BS = String.fromCharCode(92);
const ctrl = (code) => String.fromCharCode(code);

// Header names and text keep commas, doubled quotes, raw newlines and raw control characters.
const text = `a${ctrl(0x1a)}b${ctrl(7)}${ctrl(0x1b)}${ctrl(0x7f)}${ctrl(0x1f)}\r\n,'x`;
for (const eol of ['\n', '\r\n']) {
  const output = [
    `'we,ird','n','i','z','b','u','big'`,
    `'${text.replace(/'/g, "''")}',1.5,-3,NULL,X'00ff','é😀',9007199254740993`,
    `'',0.1000000000000000055,9.99999999999999955e-08,NULL,X'',' ',100.0`,
  ].join(eol) + eol;
  assert.deepEqual(parseQuoteOutput(output), [
    { 'we,ird': text, n: 1.5, i: -3, z: null, b: `${ctrl(0)}${ctrl(0xff)}`, u: 'é😀', big: 9007199254740993 },
    { 'we,ird': '', n: 0.1, i: 1e-7, z: null, b: '', u: ' ', big: 100 },
  ], `rows parse exactly with ${JSON.stringify(eol)} line ends`);
}

// A value made only of a quote, a backslash and a lone LF; the last row needs no line end.
assert.deepEqual(parseQuoteOutput(`'v'\n'''${BS}\nend'`), [{ v: `'${BS}\nend` }]);
// Overflowed reals: old CLIs print Inf / -Inf in quote mode (their -json gave Infinity).
assert.deepEqual(parseQuoteOutput(["'p','n'", 'Inf,-Inf', ''].join('\n')), [{ p: Infinity, n: -Infinity }]);
// No rows: the CLI prints nothing, not even the header.
assert.deepEqual(parseQuoteOutput(''), []);
// A header with no rows (never printed by the CLI, but harmless).
assert.deepEqual(parseQuoteOutput("'a'\n"), []);

// Malformed output fails loudly instead of returning altered rows.
assert.throws(() => parseQuoteOutput("'a'\n'unterminated\n"), /ended inside a text value/);
assert.throws(() => parseQuoteOutput("'a'\nbogus\n"), /Unexpected value/);
assert.throws(() => parseQuoteOutput("'a','b'\n1\n"), /does not match its header/);

// Version gate: -json is exact from 3.48.0.
assert.equal(jsonEscapesControlCharacters('3.45.1 2024-01-30 16:01:20 e876e51a...'), false);
assert.equal(jsonEscapesControlCharacters('3.47.2 2024-12-07'), false);
assert.equal(jsonEscapesControlCharacters('3.48.0 2025-01-14'), true);
assert.equal(jsonEscapesControlCharacters('3.53.4 2026-07-24 19:02:57 bf7c (64-bit)'), true);
assert.equal(jsonEscapesControlCharacters('4.0.0'), true);
assert.equal(jsonEscapesControlCharacters('garbled'), true);

console.log('sqlite3 quote output parser test passed');
