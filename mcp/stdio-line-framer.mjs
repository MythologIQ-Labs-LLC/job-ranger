/**
 * Byte-bounded, newline-delimited JSON-RPC request framing.
 * Each request has its own limit. TCP/pipe chunk boundaries are never authority
 * boundaries: a chunk can contain many small requests or part of one request.
 * Once an oversized unterminated line is observed, discard all its remaining
 * fragments until the next newline. Never treat a suffix as a new request.
 */
export function createStdioLineFramer({ maxLineBytes, onLine, onOversize }) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 ||
      typeof onLine !== "function" || typeof onOversize !== "function") {
    throw new TypeError("Invalid stdio framing configuration.");
  }
  let pending = "";
  let discardUntilNewline = false;

  return function acceptChunk(chunk) {
    if (typeof chunk !== "string") throw new TypeError("Expected decoded stdin text.");
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf("\n", offset);
      if (discardUntilNewline) {
        if (end === -1) return;
        discardUntilNewline = false;
        offset = end + 1;
        continue;
      }
      if (end === -1) {
        const suffix = chunk.slice(offset);
        if (Buffer.byteLength(pending, "utf8") + Buffer.byteLength(suffix, "utf8") > maxLineBytes) {
          pending = "";
          discardUntilNewline = true;
          onOversize();
        } else {
          pending += suffix;
        }
        return;
      }
      const line = pending + chunk.slice(offset, end);
      pending = "";
      offset = end + 1;
      if (Buffer.byteLength(line, "utf8") > maxLineBytes) onOversize();
      else onLine(line);
    }
  };
}
