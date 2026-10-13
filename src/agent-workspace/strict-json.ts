// Strict JSON for untrusted agent workspace files (#285/#286).
// JSON.parse silently keeps the last duplicate key and accepts lone surrogates, so
// machine-readable agent input is read with this small, bounded parser instead.

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}

export class AgentWorkspaceError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, message: string, path = "$") {
    super(message);
    this.name = "AgentWorkspaceError";
    this.code = code;
    this.path = path;
  }

  toDiagnostic(): Diagnostic {
    return { code: this.code, path: this.path, message: this.message };
  }
}

export const JSON_LIMITS = {
  maxDepth: 32,
  maxStringLength: 200_000,
} as const;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Decodes UTF-8 without a byte-order mark, rejecting malformed sequences. */
export function decodeStrictUtf8(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new AgentWorkspaceError("bom_present", "UTF-8 byte-order mark is not allowed.");
  }
  try {
    return utf8.decode(bytes);
  } catch {
    throw new AgentWorkspaceError("invalid_utf8", "File is not valid UTF-8.");
  }
}

/**
 * Parses RFC 8259 JSON. Objects are created without a prototype, duplicate keys,
 * non-safe integers, lone surrogates and excessive nesting are rejected.
 */
export function parseStrictJson(text: string): unknown {
  const parser = new Parser(text);
  parser.skipWhitespace();
  const value = parser.parseValue("$", 0);
  parser.skipWhitespace();
  if (parser.index !== text.length) parser.fail("invalid_json", "Unexpected content after the JSON value.", "$");
  return value;
}

class Parser {
  index = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  fail(code: string, message: string, path: string): never {
    throw new AgentWorkspaceError(code, `${message} (offset ${this.index})`, path);
  }

  skipWhitespace(): void {
    while (this.index < this.text.length) {
      const c = this.text.charCodeAt(this.index);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.index += 1;
      else break;
    }
  }

  parseValue(path: string, depth: number): unknown {
    if (depth > JSON_LIMITS.maxDepth) this.fail("depth_exceeded", `Nesting deeper than ${JSON_LIMITS.maxDepth} levels.`, path);
    const c = this.text[this.index];
    if (c === "{") return this.parseObject(path, depth + 1);
    if (c === "[") return this.parseArray(path, depth + 1);
    if (c === '"') return this.parseString(path);
    if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber(path);
    if (this.text.startsWith("true", this.index)) { this.index += 4; return true; }
    if (this.text.startsWith("false", this.index)) { this.index += 5; return false; }
    if (this.text.startsWith("null", this.index)) { this.index += 4; return null; }
    return this.fail("invalid_json", "Expected a JSON value.", path);
  }

  parseObject(path: string, depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null);
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "}") { this.index += 1; return result; }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("invalid_json", "Expected an object key.", path);
      const key = this.parseString(path);
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        this.fail("duplicate_key", `Duplicate key "${key.slice(0, 64)}".`, `${path}.${key.slice(0, 64)}`);
      }
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("invalid_json", "Expected ':' after an object key.", path);
      this.index += 1;
      this.skipWhitespace();
      Object.defineProperty(result, key, {
        value: this.parseValue(`${path}.${key.slice(0, 64)}`, depth),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === "}") return result;
      if (next !== ",") this.fail("invalid_json", "Expected ',' or '}' in an object.", path);
    }
  }

  parseArray(path: string, depth: number): unknown[] {
    const result: unknown[] = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "]") { this.index += 1; return result; }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue(`${path}[${result.length}]`, depth));
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === "]") return result;
      if (next !== ",") this.fail("invalid_json", "Expected ',' or ']' in an array.", path);
    }
  }

  parseString(path: string): string {
    let out = "";
    this.index += 1;
    for (;;) {
      if (this.index >= this.text.length) this.fail("invalid_json", "Unterminated string.", path);
      const c = this.text.charCodeAt(this.index);
      if (c === 0x22) { this.index += 1; break; }
      if (c < 0x20) this.fail("invalid_json", "Unescaped control character in a string.", path);
      if (c === 0x5c) {
        const e = this.text[this.index + 1];
        this.index += 2;
        if (e === "u") {
          const unit = this.readHex4(path);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            if (this.text[this.index] !== "\\" || this.text[this.index + 1] !== "u") this.fail("invalid_string", "Lone high surrogate.", path);
            this.index += 2;
            const low = this.readHex4(path);
            if (low < 0xdc00 || low > 0xdfff) this.fail("invalid_string", "Invalid surrogate pair.", path);
            out += String.fromCharCode(unit, low);
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            this.fail("invalid_string", "Lone low surrogate.", path);
          } else {
            out += String.fromCharCode(unit);
          }
        } else {
          const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!Object.prototype.hasOwnProperty.call(simple, e)) this.fail("invalid_json", "Invalid escape sequence.", path);
          out += simple[e];
        }
      } else {
        out += this.text[this.index];
        this.index += 1;
      }
      if (out.length > JSON_LIMITS.maxStringLength) this.fail("too_long", "String exceeds the parser limit.", path);
    }
    return out;
  }

  readHex4(path: string): number {
    const hex = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("invalid_json", "Invalid \\u escape.", path);
    this.index += 4;
    return parseInt(hex, 16);
  }

  parseNumber(path: string): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index, this.index + 64));
    if (!match) this.fail("invalid_json", "Invalid number.", path);
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("number_out_of_range", "Number is not finite.", path);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) this.fail("number_out_of_range", "Integer outside the safe range.", path);
    return value;
  }
}
