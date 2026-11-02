/**
 * Runtime-neutral Google Drive resume-PDF export flow (#314).
 *
 * One implementation of review, approval, journaling, idempotent upload and read-only
 * reconciliation, shared by both runtimes so they cannot drift apart:
 * - the PWA runs it in the page (src/pwa/drive/pwa-drive-port.ts) with a helper-issued
 *   access token, the browser fetch and the IndexedDB journal;
 * - the Windows app runs it in the Electron main process (electron/src/drive/drive-ipc.cts)
 *   with a Desktop OAuth access token, an egress-guarded fetch and the SQLite journal.
 *
 * The state machine and validators are the shared ones in artifact-export-approval.ts and
 * artifact-export-journal.ts; this module only sequences them. It never retries an upload
 * automatically, and it never treats anything but a 404 of a reserved Drive file ID as
 * proof that Drive holds no copy.
 */
import { validateExportProposal, validateApprovedArtifactExport, ExportApprovalLedger } from "../artifact-export-approval.js";
import type { ExportProposal, HumanExportApproval, ExportReceipt, ExportResolution } from "../artifact-export-approval.js";
import { reserveExport, advanceDurableExport, EXPORT_JOURNAL_SCHEMA_VERSION } from "../artifact-export-journal.js";
import type { DurableExportJournalStore, ExportJournalRecord } from "../artifact-export-journal.js";
import { verifyDriveAccount } from "./google-drive-account.js";
import {
  uploadApprovedDriveFile, reserveDriveFileId, inspectReservedDriveFile, findCreatedDriveFile,
  verifyRecoveredDriveFile, DRIVE_FILE_UPLOAD_LIMIT, type DriveUploadOutcome,
} from "./google-drive-transport.js";

/** Durable journal with the per-artifact query the flow needs. */
export interface DriveExportJournal extends DurableExportJournalStore {
  /** Every unresolved row (blocking or prepared) of one verified account and artifact. */
  unresolvedForArtifact(accountId: string, artifactId: string): Promise<ExportJournalRecord[]>;
}

/** What `resume:read-verified-artifact-for-export` returns in both runtimes. */
export interface VerifiedExportArtifact {
  artifactId: string;
  revision: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  bytes: Uint8Array | ArrayLike<number>;
}

export interface DriveExportFlowOptions {
  /** Runs `work` with an access token, only inside an explicit user action. Never logs or persists it. */
  withToken<T>(work: (token: string) => Promise<T>): Promise<T>;
  /** Lazily opened durable journal. */
  journal(): DriveExportJournal;
  readArtifact(artifactId: string): Promise<VerifiedExportArtifact>;
  http?: typeof fetch;
  /** Called when Google refused the create because the access token is no longer accepted. */
  onUploadAuthorizationRejected?(): void;
  now?: () => number;
  randomId?: () => string;
}

/** Display-only review data; the approval binds to `proposalId`, held by the flow. */
export interface DriveExportReview {
  proposalId: string;
  name: string;
  label: string;
  size: number;
  digest: string;
}

export type DriveExportOutcome = Exclude<DriveUploadOutcome, { status: "rejected" }>;

export interface DriveJournalSummary {
  operationId: string;
  fileName: string;
  status: ExportJournalRecord["status"];
}

export interface DriveReconcileResult {
  message: string;
  prepared: DriveJournalSummary[];
  unresolved: DriveJournalSummary[];
}

/** User-facing failure: `message` is safe to show and never contains a token. */
export class DriveExportFlowError extends Error {
  constructor(message: string) { super(message); this.name = "DriveExportFlowError"; }
}

interface PreparedExport {
  proposal: ExportProposal;
  label: string;
  bytes: Blob;
}

const MAX_OPEN_PROPOSALS = 16;
const UNRESOLVED_FOR_ABANDON: ReadonlySet<string> = new Set([
  "uploading", "unknown_remote_outcome", "accepted_unverified", "verification_failed",
]);

async function hash(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function receiptFor(
  record: ExportJournalRecord, status: ExportReceipt["status"], remoteId: string | null,
  verifiedSha256: string | null = null, resolution: ExportResolution | null = null,
): ExportReceipt {
  return { operationId: record.operationId, proposalId: record.approvalId, status,
    bytesSha256: record.bytesSha256, remoteId, verifiedSha256, resolution };
}

function summary(record: ExportJournalRecord): DriveJournalSummary {
  return { operationId: record.operationId, fileName: record.fileName, status: record.status };
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function pdfBlob(bytes: Uint8Array | ArrayLike<number>): Blob {
  return new Blob([new Uint8Array(bytes as ArrayLike<number>)], { type: "application/pdf" });
}

export class DriveExportFlow {
  private readonly proposals = new Map<string, PreparedExport>();
  private readonly ledger = new ExportApprovalLedger();
  private readonly http: typeof fetch;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(private readonly options: DriveExportFlowOptions) {
    this.http = options.http ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
  }

  /** Forgets a reviewed proposal (Cancel export). Nothing was journaled or sent for it. */
  discard(proposalId: string): void {
    this.proposals.delete(proposalId);
  }

  /** Drops every pending review, for example after a disconnect or an account change. */
  discardAll(): void {
    this.proposals.clear();
  }

  private pruneProposals(): void {
    const now = this.now();
    for (const [id, prepared] of this.proposals) {
      if (Date.parse(prepared.proposal.expiresAt) <= now) this.proposals.delete(id);
    }
    while (this.proposals.size >= MAX_OPEN_PROPOSALS) {
      const oldest = this.proposals.keys().next().value;
      if (oldest === undefined) break;
      this.proposals.delete(oldest);
    }
  }

  /** Reads and verifies the artifact, binds it to the verified account, and returns the review. */
  async prepare(artifactId: string, version: number): Promise<DriveExportReview> {
    try {
      const { proposal, bytes, label } = await this.options.withToken(async token => {
        const account = await verifyDriveAccount(token, this.http);
        // A prior POST may have succeeded even when its response was lost. A new
        // approval must not silently create a second Drive copy after reload.
        const pending = await this.options.journal().unresolvedForArtifact(account.accountId, artifactId);
        if (pending.length > 0) {
          throw new DriveExportFlowError(pending.every(record => record.status === "prepared")
            ? "An unused Drive export reservation from an earlier attempt is still saved. Nothing was " +
              "uploaded for it. Select 'Check prior Drive exports' to cancel it, then review the PDF again."
            : "An earlier Drive export for this resume is still unresolved and may already exist in Google " +
              "Drive. Select 'Check prior Drive exports' to reconcile it before creating another copy.");
        }
        const artifact = await this.options.readArtifact(artifactId);
        if (artifact.artifactId !== artifactId || artifact.revision !== String(version) ||
            artifact.mimeType !== "application/pdf") {
          throw new DriveExportFlowError("The saved resume changed. Review its latest verified version.");
        }
        const blob = pdfBlob(artifact.bytes);
        if (blob.size > DRIVE_FILE_UPLOAD_LIMIT || await hash(blob) !== artifact.contentHash) {
          throw new DriveExportFlowError("The resume content is too large or no longer matches its verified digest.");
        }
        const candidate: ExportProposal = {
          proposalId: this.randomId(), artifactId, artifactRevision: artifact.revision,
          fileName: artifact.fileName, mimeType: artifact.mimeType,
          bytesSha256: artifact.contentHash, byteLength: blob.size, providerId: "google-drive",
          accountId: account.accountId, approvedDestinationId: "root",
          destinationLabel: "My Drive (top level)",
          expiresAt: new Date(this.now() + 4 * 60_000).toISOString(),
        };
        validateExportProposal(candidate, this.now());
        return { proposal: candidate, bytes: blob, label: account.label };
      });
      this.pruneProposals();
      this.proposals.set(proposal.proposalId, { proposal, bytes, label });
      return { proposalId: proposal.proposalId, name: proposal.fileName, label,
        size: proposal.byteLength, digest: proposal.bytesSha256 };
    } catch (cause) {
      throw new DriveExportFlowError(messageOf(cause, "The resume could not be prepared for Drive."));
    }
  }

  /**
   * The user's one-click approval of exactly the reviewed PDF, account and destination.
   * Throws a DriveExportFlowError for every outcome in which Drive provably holds no file
   * or the upload never began; returns the provider outcome otherwise.
   */
  async confirm(proposalId: string): Promise<DriveExportOutcome> {
    const selected = this.proposals.get(proposalId);
    if (!selected) {
      throw new DriveExportFlowError("This export review is no longer available. Review the PDF again.");
    }
    this.proposals.delete(proposalId);
    const approval: HumanExportApproval = {
      kind: "explicit_export_artifact", approvalId: this.randomId(),
      proposalId: selected.proposal.proposalId, confirmedAt: new Date(this.now()).toISOString(),
      approvedDigest: selected.proposal.bytesSha256,
      approvedAccountId: selected.proposal.accountId,
      approvedDestinationId: selected.proposal.approvedDestinationId,
    };
    const operationId = this.randomId();
    const artifactId = selected.proposal.artifactId;
    const journalRecord: { current: ExportJournalRecord | null } = { current: null };
    let journal: DriveExportJournal | null = null;
    try {
      this.ledger.consume(approval);
      const output = await this.options.withToken(async token => {
        const currentAccount = await verifyDriveAccount(token, this.http);
        if (currentAccount.accountId !== selected.proposal.accountId) {
          throw new DriveExportFlowError("Google account changed after the export preview. Review the destination again.");
        }
        const fresh = await this.options.readArtifact(artifactId);
        const freshBytes = pdfBlob(fresh.bytes);
        if (fresh.artifactId !== selected.proposal.artifactId ||
            fresh.revision !== selected.proposal.artifactRevision) {
          throw new DriveExportFlowError("The verified resume was replaced after review.");
        }
        await validateApprovedArtifactExport(selected.proposal, approval, freshBytes, this.now(), hash);
        journal = this.options.journal();
        // Reserve the Drive file ID first (read-only; nothing is created), and journal it
        // with the approval BEFORE the uploading state can be committed.
        const reservedFileId = await reserveDriveFileId(token, this.http);
        const reservation: ExportJournalRecord = {
          schemaVersion: EXPORT_JOURNAL_SCHEMA_VERSION, operationId, approvalId: approval.approvalId,
          accountId: currentAccount.accountId,
          destinationId: selected.proposal.approvedDestinationId,
          artifactId, artifactRevision: selected.proposal.artifactRevision,
          bytesSha256: selected.proposal.bytesSha256, fileName: selected.proposal.fileName,
          mimeType: selected.proposal.mimeType, status: "prepared", reservedFileId,
          remoteId: null, verifiedSha256: null, resolution: null, updatedAt: new Date(this.now()).toISOString(),
        };
        await reserveExport(journal, reservation);
        // Only advertise a cancellable reservation after durable insertion succeeds.
        journalRecord.current = reservation;
        const store = journal;
        return uploadApprovedDriveFile({
          accessToken: token, operationId, name: selected.proposal.fileName,
          mimeType: selected.proposal.mimeType, destinationId: selected.proposal.approvedDestinationId,
          bytes: freshBytes, approvedSha256: selected.proposal.bytesSha256, reservedFileId,
        }, this.http, async () => {
          // No POST can begin until this write commits. Preflight errors leave
          // the reservation prepared and safely cancellable by the user.
          journalRecord.current = await advanceDurableExport(store, journalRecord.current!,
            receiptFor(journalRecord.current!, "uploading", null), new Date(this.now()).toISOString());
        });
      });
      const store = journal as DriveExportJournal | null;
      if (!journalRecord.current || !store) throw new DriveExportFlowError("The export receipt was not saved.");
      const advance = async (status: ExportReceipt["status"], remoteId: string | null,
        sha256: string | null = null, resolution: ExportResolution | null = null) => {
        journalRecord.current = await advanceDurableExport(store, journalRecord.current!,
          receiptFor(journalRecord.current!, status, remoteId, sha256, resolution), new Date(this.now()).toISOString());
      };
      if (output.status === "rejected") {
        // Google created nothing: close this attempt as failed so it never blocks a new approval.
        await advance("failed", null, null, "provider_rejected");
        if (output.category === "action_needed") this.options.onUploadAuthorizationRejected?.();
        throw new DriveExportFlowError(output.reason);
      }
      if (output.status === "unknown_remote_outcome") {
        await advance("unknown_remote_outcome", output.remoteId);
      } else {
        await advance("accepted_unverified", output.remoteId);
        await advance(output.status === "verified" ? "verified" : "verification_failed",
          output.remoteId, output.status === "verified" ? output.sha256 : null);
      }
      return output;
    } catch (cause) {
      if (cause instanceof DriveExportFlowError && journalRecord.current?.status === "failed") throw cause;
      // Any failure after a remote POST might have created a file. Never offer an automatic retry.
      throw new DriveExportFlowError(
        journalRecord.current?.status === "uploading" || journalRecord.current?.status === "accepted_unverified"
          ? "The Drive export may already exist. Select 'Check prior Drive exports' before approving a new upload."
          : journalRecord.current?.status === "prepared"
            ? "The upload did not begin. The unused reservation remains saved. Select 'Check prior Drive exports' and cancel that reservation before reviewing another upload."
            : messageOf(cause, "Drive export could not be completed. Your local resume is unchanged."));
    }
  }

  /**
   * Read-only reconciliation of earlier operations; NEVER uploads. An operation with a
   * reserved Drive file ID is resolved by a strongly consistent files.get of that ID:
   * found -> verify metadata and bytes; 404 -> it provably never reached Drive (failed).
   * Schema-v1 rows without a reserved ID fall back to the eventually consistent
   * appProperties search, whose empty result never clears anything.
   */
  async reconcile(artifactId: string): Promise<DriveReconcileResult> {
    try {
      return await this.options.withToken(async token => {
        const account = await verifyDriveAccount(token, this.http);
        const store = this.options.journal();
        // Only rows journaled for THIS verified account: a 404 is only meaningful
        // when asked with the same account that reserved the file ID.
        const pending = await store.unresolvedForArtifact(account.accountId, artifactId);
        if (pending.length === 0) {
          return { message: "No unresolved exports for this resume in the authorized Google account.",
            prepared: [], unresolved: [] };
        }
        let verified = 0;
        let absent = 0;
        for (const original of pending) {
          if (original.status === "prepared") continue;
          const knownId = original.reservedFileId ?? original.remoteId;
          let foundId: string | null = null;
          if (knownId) {
            const probe = await inspectReservedDriveFile(token, knownId, this.http);
            if (probe === "absent") {
              if (original.reservedFileId &&
                  (original.status === "uploading" || original.status === "unknown_remote_outcome")) {
                await advanceDurableExport(store, original,
                  receiptFor(original, "failed", null, null, "reserved_id_absent"), new Date(this.now()).toISOString());
                absent++;
              }
              continue;
            }
            if (probe !== "found") continue;
            foundId = knownId;
          } else {
            // v1 fallback. Never clear an ambiguous POST from an empty search result.
            const found = await findCreatedDriveFile(token, original.operationId, this.http);
            if (found.status !== "found") continue;
            foundId = found.remoteId;
          }
          if (original.remoteId && original.remoteId !== foundId) continue;
          const matches = await verifyRecoveredDriveFile(token, {
            operationId: original.operationId, remoteId: foundId,
            name: original.fileName, mimeType: original.mimeType,
            destinationId: original.destinationId, approvedSha256: original.bytesSha256,
          }, this.http);
          if (!matches) continue;
          let current = original;
          if (current.status === "uploading" || current.status === "unknown_remote_outcome") {
            current = await advanceDurableExport(store, current,
              receiptFor(current, "accepted_unverified", foundId), new Date(this.now()).toISOString());
          }
          await advanceDurableExport(store, current,
            receiptFor(current, "verified", foundId, original.bytesSha256), new Date(this.now()).toISOString());
          verified++;
        }
        const remaining = await store.unresolvedForArtifact(account.accountId, artifactId);
        const blocked = remaining.filter(record => record.status !== "prepared");
        const parts: string[] = [];
        if (verified > 0) parts.push(`Verified ${verified} prior Drive export(s).`);
        if (absent > 0) {
          parts.push(`Confirmed that ${absent} interrupted export(s) never reached Google Drive; they no longer block a new export.`);
        }
        if (blocked.length > 0) {
          parts.push(`${blocked.length} uncertain operation(s) remain blocked. Check Google Drive; if one cannot be resolved you may abandon it below.`);
        }
        if (remaining.some(record => record.status === "prepared")) {
          parts.push("Unused, pre-upload reservations can be cancelled below; no upload was started for them.");
        }
        return {
          message: parts.length > 0 ? parts.join(" ")
            : "No unresolved exports for this resume in the authorized Google account.",
          prepared: remaining.filter(record => record.status === "prepared").map(summary),
          unresolved: blocked.map(summary),
        };
      });
    } catch (cause) {
      throw new DriveExportFlowError(messageOf(cause, "Could not safely reconcile the previous Drive export."));
    }
  }

  /**
   * A prepared receipt has not crossed the durable uploading boundary. The
   * compare-and-swap refuses cancellation if another tab already began upload.
   */
  async cancelPrepared(artifactId: string, operationId: string): Promise<string> {
    try {
      return await this.options.withToken(async token => {
        const account = await verifyDriveAccount(token, this.http);
        const store = this.options.journal();
        const existing = await store.findOperation(operationId);
        if (!existing || existing.accountId !== account.accountId ||
            existing.artifactId !== artifactId || existing.status !== "prepared") {
          throw new DriveExportFlowError("This reservation is no longer cancellable. Recheck prior Drive exports.");
        }
        await advanceDurableExport(store, existing,
          receiptFor(existing, "cancelled", null), new Date(this.now()).toISOString());
        return "Unused reservation cancelled. Re-review the PDF before any new upload.";
      });
    } catch (cause) {
      throw new DriveExportFlowError(messageOf(cause, "Reservation cannot be safely cancelled."));
    }
  }

  /**
   * Explicit, warned user decision only: stop tracking an attempt Sojourner cannot
   * resolve. The receipt is kept as "abandoned"; nothing in Drive is deleted, and
   * Sojourner never claims that Drive holds no copy.
   */
  async abandon(artifactId: string, operationId: string): Promise<string> {
    try {
      return await this.options.withToken(async token => {
        const account = await verifyDriveAccount(token, this.http);
        const store = this.options.journal();
        const existing = await store.findOperation(operationId);
        if (!existing || existing.accountId !== account.accountId || existing.artifactId !== artifactId ||
            !UNRESOLVED_FOR_ABANDON.has(existing.status)) {
          throw new DriveExportFlowError("This export is no longer unresolved. Recheck prior Drive exports.");
        }
        await advanceDurableExport(store, existing,
          receiptFor(existing, "abandoned", existing.remoteId, null, "user_abandoned"), new Date(this.now()).toISOString());
        return "Attempt abandoned. Its receipt is kept on this device. If Google Drive already holds a copy, a new export will create a second one.";
      });
    } catch (cause) {
      throw new DriveExportFlowError(messageOf(cause, "The export could not be safely abandoned."));
    }
  }
}
