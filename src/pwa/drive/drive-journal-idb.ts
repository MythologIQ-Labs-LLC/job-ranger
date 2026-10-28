/**
 * Sojourner's local-only durable artifact-export receipt journal.
 * No access tokens, refresh tokens or document bytes are stored here.
 * IndexedDB enforces unique operation and approval IDs transactionally.
 * Compatibility name is intentionally stable across the Job Ranger rebrand.
 */
import { blocksFreshArtifactExport, validateJournalRecord } from "../../shared/artifact-export-journal.ts";
import type { DurableExportJournalStore, ExportJournalRecord } from "../../shared/artifact-export-journal.ts";
import type { ExportStatus } from "../../shared/artifact-export-approval.ts";

const DB_NAME = "job-ranger.drive-artifact-export-journal.v1";
const STORE = "exports";
const VERSION = 1;
const ERROR = "Sojourner could not safely save the Google Drive export receipt. No upload is authorized.";

function sameIdentity(left: ExportJournalRecord, right: ExportJournalRecord): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.operationId === right.operationId && left.approvalId === right.approvalId &&
    left.accountId === right.accountId && left.destinationId === right.destinationId &&
    left.artifactId === right.artifactId && left.artifactRevision === right.artifactRevision &&
    left.bytesSha256 === right.bytesSha256 && left.fileName === right.fileName &&
    left.mimeType === right.mimeType;
}

export class BrowserDriveExportJournal implements DurableExportJournalStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try { request = this.factory.open(DB_NAME, VERSION); }
      catch { reject(new Error(ERROR)); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const objectStore = database.createObjectStore(STORE, { keyPath: "operationId" });
          objectStore.createIndex("approvalId", "approvalId", { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(ERROR));
      request.onblocked = () => reject(new Error("Close other Sojourner tabs before managing Google Drive export receipts."));
    }).catch((error: unknown) => {
      this.db = null;
      throw error;
    });
    return this.db;
  }

  private async transaction<T>(
    mode: IDBTransactionMode, action: (store: IDBObjectStore, done: (result: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(STORE, mode); }
      catch { reject(new Error(ERROR)); return; }
      let completed = false;
      let result: T | undefined;
      const done = (value: T) => { completed = true; result = value; };
      tx.oncomplete = () => completed ? resolve(result as T) : reject(new Error(ERROR));
      tx.onerror = () => reject(new Error(ERROR));
      tx.onabort = () => reject(new Error(ERROR));
      try { action(tx.objectStore(STORE), done); }
      catch { try { tx.abort(); } catch { /* already aborted */ } reject(new Error(ERROR)); }
    });
  }

  /**
   * Fail closed before a new explicit upload if an earlier operation for this
   * account and artifact may already have produced a remote file. Do not infer
   * nonexistence from a different new approval/operation ID.
   * A bounded scan avoids unbounded memory consumption in a corrupted journal.
   */
  async hasUnresolvedForArtifact(accountId: string, artifactId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_:-]{1,160}$/.test(accountId) ||
        !/^[A-Za-z0-9_:-]{1,160}$/.test(artifactId)) {
      throw new Error("Invalid Drive journal lookup.");
    }
    return this.transaction<boolean>("readonly", (store, done) => {
      const request = store.getAll(undefined, 10_001);
      request.onsuccess = () => {
        if (request.result.length > 10_000) {
          store.transaction.abort();
          return;
        }
        done(request.result.some((entry: ExportJournalRecord) =>
          blocksFreshArtifactExport(entry, accountId, artifactId)));
      };
    });
  }

  async insertIfAbsent(record: ExportJournalRecord): Promise<boolean> {
    validateJournalRecord(record);
    if (record.status !== "prepared" || record.remoteId || record.verifiedSha256) {
      throw new Error("Only an unused prepared export can be journaled.");
    }
    return this.transaction<boolean>("readwrite", (store, done) => {
      const request = store.add(record);
      request.onsuccess = () => done(true);
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") {
          // Duplicate operation or approval ID. Keep the transaction alive and return false.
          event.preventDefault();
          event.stopPropagation();
          done(false);
        }
      };
    });
  }

  async compareAndSwap(operationId: string, expected: ExportStatus, next: ExportJournalRecord): Promise<boolean> {
    validateJournalRecord(next);
    if (next.operationId !== operationId || next.status === expected) return false;
    return this.transaction<boolean>("readwrite", (store, done) => {
      const request = store.get(operationId);
      request.onsuccess = () => {
        const previous = request.result as ExportJournalRecord | undefined;
        if (!previous || previous.status !== expected || !sameIdentity(previous, next) ||
            Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) {
          done(false);
          return;
        }
        const update = store.put(next);
        update.onsuccess = () => done(true);
      };
    });
  }

  async findOperation(operationId: string): Promise<ExportJournalRecord | null> {
    return this.transaction<ExportJournalRecord | null>("readonly", (store, done) => {
      const request = store.get(operationId);
      request.onsuccess = () => done((request.result as ExportJournalRecord | undefined) ?? null);
    });
  }

  async findApproval(approvalId: string): Promise<ExportJournalRecord | null> {
    return this.transaction<ExportJournalRecord | null>("readonly", (store, done) => {
      const request = store.index("approvalId").get(approvalId);
      request.onsuccess = () => done((request.result as ExportJournalRecord | undefined) ?? null);
    });
  }
}
