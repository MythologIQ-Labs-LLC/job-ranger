/**
 * Read an OPFS-backed File as bounded chunks without calling arrayBuffer().
 *
 * `File.stream()` is a native browser file stream. Keeping this boundary in
 * one helper makes the memory behavior testable independently of the OPFS
 * directory adapter and lets hash/copy consumers release chunks promptly.
 */
export const OPFS_READ_CHUNK_BYTES = 1024 * 1024;

export async function* readFileInChunks(
  file: Pick<File, "stream">,
): AsyncGenerator<Uint8Array, void, unknown> {
  const reader = file.stream().getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      if (!(value instanceof Uint8Array)) {
        throw new Error("OPFS file stream returned a non-byte chunk.");
      }
      // A browser is free to choose stream chunk sizes. Don't forward one
      // oversized chunk to the application as if it were our chosen budget.
      for (let start = 0; start < value.byteLength; start += OPFS_READ_CHUNK_BYTES) {
        yield value.subarray(start, start + OPFS_READ_CHUNK_BYTES);
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
