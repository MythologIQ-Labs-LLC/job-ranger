import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  GOOGLE_DRIVE_DESTINATION_LABEL,
  type DriveApproveRequest,
  type DriveExportProposal,
  type DriveExportReceipt,
  type DriveExportRecord,
  type DriveExportState,
  type DriveStatus,
  type DriveUnavailableReason,
} from "../../../src/shared/google-drive.js";
import type { ResumeArtifactRecord } from "../../../src/shared/resume-contracts.js";
import { assertManagedArtifactPath } from "../managed-path-policy.cjs";
import { ResumeRepository } from "../resume-repository.cjs";
import { sql, type SqliteClient } from "../sqlite.cjs";
import { DriveError } from "./drive-errors.cjs";
import { DriveExportJournal, type DriveJournalRecord } from "./drive-export-journal.cjs";
import type { DriveTransport } from "./drive-transport.cjs";
import type { DriveAccount, GoogleDesktopAuth } from "./google-desktop-auth.cjs";
import { DriveUploadRunner, receiptFor } from "./drive-upload-runner.cjs";
import type { DriveCredentialStore } from "./drive-credential-store.cjs";

/** Drive's multipart upload is documented for files of 5 MB or less. */
export const MAX_MULTIPART_BYTES = 5 * 1024 * 1024;

interface LocalArtifact {
  artifact: ResumeArtifactRecord;
  bytes: Buffer;
  sha256: string;
  md5: string;
  fileName: string;
}

export interface DriveExportServiceOptions {
  dataDirectory: string;
  sqlite: SqliteClient;
  unavailableReason: DriveUnavailableReason | null;
  auth: GoogleDesktopAuth;
  store: DriveCredentialStore;
  drive: DriveTransport;
}

export function driveFileNameFor(artifact: ResumeArtifactRecord): string {
  const fullName = artifact.projectionSnapshot?.projection?.contact?.fullName ?? "";
  const clean = (value: string) =>
    value.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const owner = clean(fullName);
  return `${owner ? `${owner} - ` : ""}Resume v${artifact.version}.pdf`;
}

const TEMPLATE_LABELS: Record<string, string> = {
  "ats-standard-v1": "ATS-safe standard",
  "ats-compact-v1": "ATS-safe compact",
};
const CONTEXT_LABELS: Record<string, string> = {
  "private-sector": "Private sector",
  hybrid: "Hybrid / career change",
  federal: "Federal",
  academic: "Academic CV",
};

/**
 * ArtifactExport: the explicit, user-approved business action. Nothing is
 * uploaded except from approve()/retry(), each of which is reached only from a
 * button press in the renderer.
 */
export class DriveExportService {
  private readonly journal: DriveExportJournal;
  private readonly repository: ResumeRepository;
  private readonly runner: DriveUploadRunner;
  private readonly busyArtifacts = new Set<string>();

  constructor(private readonly options: DriveExportServiceOptions) {
    this.journal = new DriveExportJournal(options.sqlite);
    this.repository = new ResumeRepository(options.sqlite);
    this.runner = new DriveUploadRunner(this.journal, options.drive);
  }

  async initialize(): Promise<void> {
    await this.journal.initialize();
  }

  async status(): Promise<DriveStatus> {
    const { unavailableReason, auth, store } = this.options;
    if (unavailableReason) {
      return { configured: false, reason: unavailableReason, connected: false, credentialStorage: "none", connecting: false };
    }
    const connected = await auth.isConnected();
    const accountEmail = connected ? await auth.accountEmail() : null;
    return {
      configured: true,
      connected,
      ...(accountEmail ? { accountEmail } : {}),
      credentialStorage: store.storage(),
      connecting: auth.connecting,
      ...(auth.connectFlowId ? { connectFlowId: auth.connectFlowId } : {}),
      ...(store.encryptionAvailable() ? {} : { encryptionUnavailable: true }),
      ...(store.credentialUnavailable() ? { credentialUnavailable: true } : {}),
    };
  }

  /** The connected account every export, receipt and retry is scoped to. */
  private async requireAccount(): Promise<DriveAccount> {
    if (this.options.unavailableReason) {
      throw new DriveError("not_configured", "Google Drive is not set up in this build of Job Ranger.");
    }
    const account = await this.options.auth.account();
    if (!account) {
      throw new DriveError(
        "not_connected",
        this.options.store.credentialUnavailable()
          ? "Job Ranger could not unlock the stored Google sign-in. Try again in a moment, or reconnect Google Drive in Settings."
          : "Connect Google Drive in Settings first.",
      );
    }
    return account;
  }

  private async loadLocal(artifactId: string): Promise<LocalArtifact> {
    const artifact = await this.repository.getArtifact(artifactId);
    if (!artifact) throw new DriveError("invalid_request", "This resume version no longer exists.");
    if (artifact.format !== "pdf") throw new DriveError("invalid_request", "Only verified PDF exports can be saved to Google Drive.");
    const managedPath = assertManagedArtifactPath(artifact.managedPath, path.join(this.options.dataDirectory, "artifacts"));
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(managedPath);
    } catch {
      throw new DriveError("file_changed", "The exported PDF is missing from Job Ranger's managed files. Export the resume again.");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== artifact.contentHash.toLowerCase()) {
      throw new DriveError("file_changed", "The PDF on disk no longer matches the verified export, so it was not uploaded. Export the resume again.");
    }
    if (bytes.length > MAX_MULTIPART_BYTES) {
      throw new DriveError("invalid_request", "This PDF is larger than 5 MB, which this export does not support.");
    }
    return { artifact, bytes, sha256, md5: createHash("md5").update(bytes).digest("hex"), fileName: driveFileNameFor(artifact) };
  }

  private async withArtifactLock<T>(artifactId: string, work: () => Promise<T>): Promise<T> {
    if (this.busyArtifacts.has(artifactId)) {
      throw new DriveError("export_in_progress", "This PDF is already being saved to Google Drive.");
    }
    this.busyArtifacts.add(artifactId);
    try {
      return await work();
    } finally {
      this.busyArtifacts.delete(artifactId);
    }
  }


  /** Names the target job (when the draft was tailored) or the general draft's template and format. */
  private async generatedFor(artifact: ResumeArtifactRecord): Promise<string> {
    const projection = artifact.projectionSnapshot?.projection;
    const jobId = projection?.jobId ?? null;
    if (jobId && /^\d+$/.test(jobId)) {
      const job = await this.options.sqlite.queryOne<{ title: string; company: string | null }>(sql`
        SELECT j.title AS title, c.name AS company FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.id = ${Number(jobId)} LIMIT 1;
      `);
      if (job) return `Tailored for ${job.title}${job.company ? ` at ${job.company}` : ""}`;
    }
    if (jobId) return `Tailored for tracked job ${jobId}`;
    const template = TEMPLATE_LABELS[projection?.templateId ?? ""] ?? "Resume";
    const context = CONTEXT_LABELS[projection?.context ?? ""];
    return `General resume · ${template}${context ? ` · ${context}` : ""}`;
  }

  async prepare(artifactId: string): Promise<DriveExportProposal> {
    const account = await this.requireAccount();
    const local = await this.loadLocal(artifactId);
    const records = await this.journal.listForArtifact(artifactId);
    const mine = records.filter((record) => record.accountId === account.id);
    const others = records.filter((record) => record.accountId !== account.id);
    return {
      artifactId,
      fileName: local.fileName,
      mimeType: "application/pdf",
      formatLabel: "PDF",
      artifactVersion: local.artifact.version,
      pageCount: local.artifact.pageCount,
      generatedFor: await this.generatedFor(local.artifact),
      sizeBytes: local.bytes.length,
      sha256: local.sha256,
      destination: GOOGLE_DRIVE_DESTINATION_LABEL,
      accountId: account.id,
      accountEmail: account.email,
      verifiedExports: mine.filter((record) => record.state === "verified").map(publicRecord),
      mismatchedCopies: mine.filter(isMismatchedCopy).map(publicRecord),
      pendingExport: maybePublic(mine.find(isPending)),
      otherAccountExports: others.filter((record) => record.state === "verified" || isPending(record)).map(publicRecord),
    };
  }

  async approve(request: DriveApproveRequest): Promise<DriveExportReceipt> {
    return this.withArtifactLock(request.artifactId, async () => {
      const account = await this.requireAccount();
      if (request.expectedAccountId !== undefined && request.expectedAccountId !== account.id) {
        // A stale approval from a review made while another account was connected.
        throw new DriveError("account_mismatch", "The connected Google account changed since you reviewed this upload, so nothing was uploaded. Review it again.");
      }
      const local = await this.loadLocal(request.artifactId);
      if (local.sha256 !== request.expectedSha256.toLowerCase()) {
        throw new DriveError("file_changed", "The PDF changed after you reviewed it, so it was not uploaded. Review it again.");
      }
      const mine = (await this.journal.listForArtifact(request.artifactId)).filter((record) => record.accountId === account.id);
      const pending = mine.find(isPending);
      if (pending) {
        const error = new DriveError("export_in_progress", "An earlier upload of this PDF was not confirmed. Retry it, which checks Drive for that exact file first, or abandon it.");
        error.operationId = pending.operationId;
        throw error;
      }
      if (request.saveAnotherCopy !== true) {
        if (mine.some((record) => record.state === "verified")) {
          throw new DriveError("already_exported", "This PDF is already saved in this Google Drive. Choose Save another copy to upload it again.");
        }
        if (mine.some(isMismatchedCopy)) {
          throw new DriveError("already_exported", "An earlier upload left a non-matching copy in this Google Drive. Choose Upload a new copy to upload again.");
        }
      }
      const record = await this.journal.insertApproved({
        operationId: randomUUID(),
        artifactId: request.artifactId,
        contentSha256: local.sha256,
        fileName: local.fileName,
        sizeBytes: local.bytes.length,
        accountId: account.id,
        accountEmail: account.email,
      });
      return this.runner.run(record, local, account);
    });
  }

  async retry(operationId: string): Promise<DriveExportReceipt> {
    const record = await this.journal.get(operationId);
    if (!record) throw new DriveError("invalid_request", "That Drive export record no longer exists.");
    return this.withArtifactLock(record.artifactId, async () => {
      const current = (await this.journal.get(operationId))!;
      const account = await this.requireAccount();
      if (current.accountId !== account.id) {
        throw new DriveError(
          "account_mismatch",
          `This upload was approved for ${current.accountEmail ?? "another Google account"}. Connect that account to retry it, or abandon the attempt.`,
        );
      }
      if (current.state === "verified" && current.driveFileId) return receiptFor(current);
      if (current.state === "abandoned") throw new DriveError("invalid_request", "This upload attempt was abandoned. Start a new upload instead.");
      if (isMismatchedCopy(current)) {
        throw new DriveError("verification_failed", current.errorMessage ?? "A non-matching copy exists in Google Drive. Upload a new copy instead.");
      }
      const local = await this.loadLocal(current.artifactId);
      if (local.sha256 !== current.contentSha256) {
        throw new DriveError("file_changed", "The PDF changed since this upload was approved, so it was not retried.");
      }
      return this.runner.run(current, local, account);
    });
  }

  /**
   * Gives up on an unresolved attempt so the PDF can be uploaded again. The
   * record is kept (state abandoned); a copy may still exist in Drive.
   */
  async abandon(operationId: string): Promise<DriveExportRecord> {
    const record = await this.journal.get(operationId);
    if (!record) throw new DriveError("invalid_request", "That Drive export record no longer exists.");
    return this.withArtifactLock(record.artifactId, async () => {
      const current = (await this.journal.get(operationId))!;
      if (current.state === "verified" || current.state === "abandoned") {
        throw new DriveError("invalid_request", "Only an unfinished upload attempt can be abandoned.");
      }
      return publicRecord(await this.journal.update(operationId, {
        state: "abandoned",
        errorCode: current.errorCode,
        errorMessage: current.errorMessage,
      }));
    });
  }

  async listExports(artifactId: string): Promise<DriveExportRecord[]> {
    return (await this.journal.listForArtifact(artifactId)).map(publicRecord);
  }
}

const PENDING_STATES: ReadonlySet<DriveExportState> = new Set<DriveExportState>(["approved", "uploading", "unknown_remote_outcome"]);

function isPending(record: DriveExportRecord): boolean {
  return PENDING_STATES.has(record.state);
}

function isMismatchedCopy(record: DriveExportRecord): boolean {
  return record.state === "failed" && record.errorCode === "verification_failed" && record.driveFileId !== null;
}

/** Strips journal-internal fields (the reserved id) before a record leaves the main process. */
function publicRecord(record: DriveJournalRecord): DriveExportRecord {
  const { reservedFileId: _reserved, ...rest } = record;
  return rest;
}

function maybePublic(record: DriveJournalRecord | undefined): DriveExportRecord | null {
  return record ? publicRecord(record) : null;
}
