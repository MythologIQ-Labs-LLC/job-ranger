// Deterministic bytes and digests for agent workspace files (#285/#286).
// Uses Web Crypto so the same code runs in Electron, the PWA worker and Node tests.

const encoder = new TextEncoder();

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) sorted[key] = sortKeys(child);
    }
    return sorted;
  }
  return value;
}

/** Sorted keys, two-space indentation, LF line endings and a trailing newline. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value));
}

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text.replace(/\r\n?/g, "\n"));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into an ArrayBuffer-backed view; Web Crypto does not accept shared buffers.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
