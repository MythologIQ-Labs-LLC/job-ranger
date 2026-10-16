// sqlite3 CLIs before 3.48 write control characters in -json output without the escaping
// backslash (0x1A comes out as the text "u001a"; DEL raw), so text read through -json is altered
// (#321). Their `-header -quote` output is exact: text is written raw between single quotes with
// quotes doubled, NULL as NULL, numbers as written and blobs as X'..'. This parses that output into
// the same row objects -json would give.

function blobAsText(hex: string): string {
  // -json renders a blob as a string with one character per byte; match it.
  let text = "";
  for (let index = 0; index < hex.length; index += 2) {
    text += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return text;
}

/**
 * Parses `sqlite3 -header -quote` output into row objects. Supports exactly one result set per
 * call, as SqliteClient.queryAll does: a second row-returning statement would print another
 * header that reads as a data row (where -json would fail to parse).
 */
export function parseQuoteOutput(output: string): Record<string, unknown>[] {
  const lines: unknown[][] = [];
  let row: unknown[] = [];
  let position = 0;
  const length = output.length;
  while (position < length) {
    const character = output[position];
    let value: unknown;
    if (character === "'") {
      let text = "";
      position += 1;
      for (;;) {
        const end = output.indexOf("'", position);
        if (end < 0) throw new Error("sqlite3 quote output ended inside a text value");
        text += output.slice(position, end);
        if (output[end + 1] === "'") {
          text += "'";
          position = end + 2;
          continue;
        }
        position = end + 1;
        break;
      }
      value = text;
    } else if ((character === "X" || character === "x") && output[position + 1] === "'") {
      const end = output.indexOf("'", position + 2);
      if (end < 0) throw new Error("sqlite3 quote output ended inside a blob value");
      value = blobAsText(output.slice(position + 2, end));
      position = end + 1;
    } else {
      let end = position;
      while (end < length && output[end] !== "," && output[end] !== "\n" && output[end] !== "\r") end += 1;
      const token = output.slice(position, end);
      position = end;
      if (token === "NULL") {
        value = null;
      } else if (token === "Inf" || token === "-Inf") {
        // Old CLIs print overflowed reals this way; their -json gave Infinity via 9.0e+999.
        value = token === "Inf" ? Infinity : -Infinity;
      } else {
        value = Number(token);
        if (token === "" || Number.isNaN(value)) {
          throw new Error(`Unexpected value in sqlite3 quote output: ${token.slice(0, 40)}`);
        }
      }
    }
    row.push(value);
    if (output[position] === ",") {
      position += 1;
      continue;
    }
    if (output[position] === "\r") position += 1;
    if (position >= length || output[position] === "\n") {
      position += 1;
      lines.push(row);
      row = [];
      continue;
    }
    throw new Error("Unexpected character in sqlite3 quote output");
  }
  if (lines.length === 0) return [];
  const [header, ...rows] = lines;
  return rows.map((values) => {
    if (values.length !== header.length) throw new Error("sqlite3 quote output row does not match its header");
    return Object.fromEntries(header.map((name, index) => [String(name), values[index]]));
  });
}

/** Whether this sqlite3 CLI version escapes control characters correctly in -json output. */
export function jsonEscapesControlCharacters(versionOutput: string): boolean {
  const [major, minor] = versionOutput.trim().split(" ")[0].split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return true;
  return major > 3 || (major === 3 && minor >= 48);
}
