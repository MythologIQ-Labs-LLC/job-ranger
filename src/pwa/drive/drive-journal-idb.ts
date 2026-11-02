/**
 * Sojourner's local-only durable artifact-export receipt journal.
 * No access tokens, refresh tokens or document bytes are stored here.
 * IndexedDB enforces unique operation and approval IDs transactionally.
 * Compatibility name is intentionally stable across the Job Ranger rebrand.
 *
 * Record schema v2 (reserved Drive file ID, terminal resolution) needs no
 * IndexedDB object-store change, so the database version stays 1 and other open
 * tabs are never blocked by an upgrade. Every read passes through
 * upgradeJournalRecord, so v1 rows still load; a v1 row is rewritten as v2 on its
 * next legal transition.
 */
import { blocksFreshArtifactExport, checkJournalTransition, upgradeJournalRecord, validateJournalRecord } from "../../shared/artifact-export-journal.ts";
import type { DurableExportJournalStore, ExportJournalRecord } from "../../shared/artifact-export-journal.ts";
import type { ExportStatus } from "../../shared/artifact-export-approval.ts";

const DB_NAME = "job-ranger.drive-artifact-export-journal.v1";
const STORE = "exports";
const VERSION = 1;
const ERROR = "Sojourner could not safely save the Google Drive export receipt. No upload is authorized.";
const ID = /^[A-Za-z0-9_:-]{1,160}$/;

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
        // A corrupt row throws here, aborting the transaction: fail closed.
        done(request.result.some((entry: unknown) =>
          blocksFreshArtifactExport(upgradeJournalRecord(entry), accountId, artifactId)));
      };
    });
  }

  /** Read only the unresolved receipts for one authenticated account and artifact. */
  async unresolvedForArtifact(accountId: string, artifactId: string): Promise<ExportJournalRecord[]> {
    if (!/^[A-Za-z0-9_:-]{1,160}$/.test(accountId) ||
        !/^[A-Za-z0-9_:-]{1,160}$/.test(artifactId)) {
      throw new Error("Invalid Drive journal lookup.");
    }
    return this.transaction<ExportJournalRecord[]>("readonly", (store, done) => {
      const request = store.getAll(undefined, 10_001);
      request.onsuccess = () => {
        if (request.result.length > 10_000) { store.transaction.abort(); return; }
        done((request.result as unknown[]).map(upgradeJournalRecord).filter(entry =>
          blocksFreshArtifactExport(entry, accountId, artifactId)));
      };
    });
  }

  async insertIfAbsent(record: ExportJournalRecord): Promise<boolean> {
    validateJournalRecord(record);
    if (record.status !== "prepared" || record.remoteId || record.verifiedSha256 ||
        !record.reservedFileId || record.resolution !== null) {
      throw new Error("Only an unused prepared export with a reserved Drive file ID can be journaled.");
    }
    return this.transaction<boolean>("readwrite", (store, done) => {
      // Read and reserve in ONE IndexedDB readwrite transaction. Such transactions
      // serialize across tabs, unlike an earlier UI-only pending-status check.
      const scan = store.getAll(undefined, 10_001);
      scan.onsuccess = () => {
        if (scan.result.length > 10_000) {
          store.transaction.abort(); // Fail closed if the journal is too large.
          return;
        }
        if (scan.result.some((prior: unknown) =>
          blocksFreshArtifactExport(upgradeJournalRecord(prior), record.accountId, record.artifactId))) {
          done(false);
          return;
        }
        const request = store.add(record);
        request.onsuccess = () => done(true);
        request.onerror = (event) => {
          if (request.error?.name === "ConstraintError") {
            // Duplicate operation/approval. Keep the transaction alive.
            event.preventDefault();
            event.stopPropagation();
            done(false);
          }
        };
      };
    });
  }

  async compareAndSwap(operationId: string, expected: ExportStatus, next: ExportJournalRecord): Promise<boolean> {
    validateJournalRecord(next);
    if (next.operationId !== operationId || next.status === expected) return false;
    return this.transaction<boolean>("readwrite", (store, done) => {
      const request = store.get(operationId);
      request.onsuccess = () => {
        let previous: ExportJournalRecord | null = null;
        try {
          previous = request.result === undefined ? null : upgradeJournalRecord(request.result);
        } catch { previous = null; }
        if (!previous || previous.status !== expected) {
          done(false);
          return;
        }
        // Storage must independently reject forged status jumps, not just rely
        // on callers using advanceDurableExport. Never allow remote uncertainty
        // to be erased by a direct compareAndSwap invocation: "failed" needs
        // provider or reserved-ID evidence, "abandoned" an explicit user resolution,
        // and no upload may start without a journaled reserved Drive file ID.
        try { checkJournalTransition(previous, next); }
        catch {
          done(false);
          return;
        }
        const update = store.put(next);
        update.onsuccess = () => done(true);
      };
    });
  }

  async findOperation(operationId: string): Promise<ExportJournalRecord | null> {
    if (!ID.test(operationId)) throw new Error("Invalid Drive journal lookup.");
    return this.transaction<ExportJournalRecord | null>("readonly", (store, done) => {
      const request = store.get(operationId);
      request.onsuccess = () => done(request.result === undefined ? null : upgradeJournalRecord(request.result));
    });
  }

  async findApproval(approvalId: string): Promise<ExportJournalRecord | null> {
    if (!ID.test(approvalId)) throw new Error("Invalid Drive journal lookup.");
    return this.transaction<ExportJournalRecord | null>("readonly", (store, done) => {
      const request = store.index("approvalId").get(approvalId);
      request.onsuccess = () => done(request.result === undefined ? null : upgradeJournalRecord(request.result));
    });
  }
}
