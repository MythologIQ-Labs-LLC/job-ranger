/**
 * Exported documents (resume PDFs, JSON Resume files) announce themselves here so the
 * Windows storage location can copy them (#249). Export modules call
 * `notifyDocumentExported` after a successful export; nothing listens unless a storage
 * location is set up, and a listener failure never affects the export itself.
 */
export type DocumentExportListener = (filePath: string, displayName: string) => void;

const listeners = new Set<DocumentExportListener>();

export function onDocumentExported(listener: DocumentExportListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDocumentExported(filePath: string, displayName: string): void {
  for (const listener of listeners) {
    try {
      listener(filePath, displayName);
    } catch {
      // A storage copy problem is reported by the storage location, never by the export.
    }
  }
}
