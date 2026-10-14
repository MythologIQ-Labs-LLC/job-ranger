/**
 * Expose a freshly read, worker-owned file as transferable bytes.
 *
 * OPFS readFile() returns a new, dedicated ArrayBuffer. Transferring that
 * buffer to the page detaches it from the worker without duplicating it.
 * Shared/offset views may refer to unrelated content, so those still get
 * a new exact-sized copy. Callers must not use their source bytes afterward.
 *
 * This removes one avoidable full-file copy from the PWA download bridge.
 * It does not make backup ZIP assembly or the browser Blob streaming.
 */
export function fileBytesForTransfer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}
