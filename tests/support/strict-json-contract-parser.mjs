// TEST-ONLY reference parser for Job Ranger's proposed agent JSON contract.
// This is deliberately separate from application ingestion. Production must
// independently enforce the entire versioned schema, provenance and consent.
import { TextDecoder } from 'node:util';

const SCANNER_LIMIT_BYTES = 2 * 1024 * 1024;
const SCANNER_LIMIT_DEPTH = 64;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function wellFormedUnicode(value) {
  for (let j = 0; j < value.length; j++) {
    const code = value.charCodeAt(j);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(++j);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new SyntaxError('Unpaired high surrogate in JSON string');
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new SyntaxError('Unpaired low surrogate in JSON string');
    }
  }
}

export function parseStrictAgentJson(input, { maxBytes = SCANNER_LIMIT_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > SCANNER_LIMIT_BYTES) {
    throw new RangeError('Invalid agent JSON limit');
  }
  let source;
  if (typeof input === 'string') {
    source = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > maxBytes) throw new RangeError('Agent JSON exceeds limit');
    if (input[0] === 0xEF && input[1] === 0xBB && input[2] === 0xBF) {
      throw new SyntaxError('UTF-8 BOM not allowed');
    }
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  } else {
    throw new TypeError('Expected UTF-8 bytes or JSON text');
  }
  if (Buffer.byteLength(source, 'utf8') > maxBytes) {
    throw new RangeError('Agent JSON exceeds limit');
  }
  if (source.charCodeAt(0) === 0xFEFF) throw new SyntaxError('JSON BOM not allowed');

  // JSON.parse is intentionally used only for syntactic conformance. It does
  // NOT reject duplicate object keys or unpaired escaped UTF-16 surrogates.
  const parsed = JSON.parse(source);
  let i = 0;
  const isWhitespace = c => c === ' ' || c === '\r' || c === '\n' || c === '\t';
  const ws = () => { while (i < source.length && isWhitespace(source[i])) i++; };
  const readString = () => {
    if (source[i] !== '"') throw new SyntaxError('JSON string expected');
    const start = i++;
    while (i < source.length) {
      const ch = source[i++];
      if (ch === '\\') {
        if (source[i] === 'u') i += 5;
        else i++;
      } else if (ch === '"') {
        const decoded = JSON.parse(source.slice(start, i));
        wellFormedUnicode(decoded);
        return decoded;
      }
    }
    throw new SyntaxError('Unterminated JSON string');
  };
  function readValue(depth) {
    if (depth > SCANNER_LIMIT_DEPTH) throw new RangeError('Agent JSON nesting exceeds limit');
    ws();
    const ch = source[i];
    if (ch === '"') { readString(); return; }
    if (ch === '{') {
      i++; ws();
      const names = new Set();
      if (source[i] === '}') { i++; return; }
      while (i < source.length) {
        ws();
        const name = readString();
        if (names.has(name)) throw new SyntaxError('Duplicate JSON object key: ' + name);
        if (FORBIDDEN_KEYS.has(name)) throw new SyntaxError('Forbidden JSON property: ' + name);
        names.add(name);
        ws();
        if (source[i++] !== ':') throw new SyntaxError('Expected colon');
        readValue(depth + 1);
        ws();
        if (source[i] === '}') { i++; return; }
        if (source[i++] !== ',') throw new SyntaxError('Expected comma');
      }
      throw new SyntaxError('Unterminated JSON object');
    }
    if (ch === '[') {
      i++; ws();
      if (source[i] === ']') { i++; return; }
      while (i < source.length) {
        readValue(depth + 1); ws();
        if (source[i] === ']') { i++; return; }
        if (source[i++] !== ',') throw new SyntaxError('Expected array comma');
      }
      throw new SyntaxError('Unterminated JSON array');
    }
    for (const keyword of ['true', 'false', 'null']) {
      if (source.startsWith(keyword, i)) { i += keyword.length; return; }
    }
    numberToken.lastIndex = i;
    const match = numberToken.exec(source);
    if (match) { i = numberToken.lastIndex; return; }
    throw new SyntaxError('Unexpected JSON token');
  }
  readValue(0);
  ws();
  if (i !== source.length) throw new SyntaxError('Unexpected JSON content');
  return parsed;
}
