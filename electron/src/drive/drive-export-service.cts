import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  GOOGLE_DRIVE_DESTINATION_LABEL,
  type DriveApproveRequest,
  type DriveExportProposal,
  type DriveExportReceipt,
  type DriveExportRecord,
  type DriveStatus,
  type DriveUnavailableReason,
} from "../../../src/shared/google-drive.js";
import type { ResumeArtifactRecord } from "../../../src/shared/resume-contracts.js";
import { assertManagedArtifactPath } from "../managed-path-policy.cjs";
import { ResumeRepository } from "../resume-repository.cjs";
import { sql, type SqliteClient } from "../sqlite.cjs";
import { DriveError, isAmbiguousUploadFailure, toDriveError } from "./drive-errors.cjs";
import { DriveExportJournal } from "./drive-export-journal.cjs";
import { verifyRemoteFile, type DriveFileMetadata, type DriveTransport } from "./drive-transport.cjs";
import type { GoogleDesktopAuth } from "./google-desktop-auth.cjs";
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
  private readonly busyArtifacts = new Set<string>();

  constructor(private readonly options: DriveExportServiceOptions) {
    this.journal = new DriveExportJournal(options.sqlite);
    this.repository = new ResumeRepository(options.sqlite);
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
      ...(store.encryptionAvailable() ? {} : { encryptionUnavailable: true }),
    };
  }

  private async requireReady(): Promise<void> {
    if (this.options.unavailableReason) {
      throw new DriveError("not_configured", "Google Drive is not set up in this build of Job Ranger.");
    }
    if (!(await this.options.auth.isConnected())) {
      throw new DriveError("not_connected", "Connect Google Drive in Settings first.");
    }
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

  private static pending(records: DriveExportRecord[]): DriveExportRecord | null {
    return records.find((record) => record.state === "approved" || record.state === "uploading" || record.state === "unknown_remote_outcome") ?? null;
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
    await this.requireReady();
    const local = await this.loadLocal(artifactId);
    const records = await this.journal.listForArtifact(artifactId);
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
      accountEmail: await this.options.auth.accountEmail(),
      verifiedExports: records.filter((record) => record.state === "verified"),
      pendingExport: DriveExportService.pending(records),
    };
  }

  async approve(request: DriveApproveRequest): Promise<DriveExportReceipt> {
    return this.withArtifactLock(request.artifactId, async () => {
      await this.requireReady();
      const local = await this.loadLocal(request.artifactId);
      if (local.sha256 !== request.expectedSha256.toLowerCase()) {
        throw new DriveError("file_changed", "The PDF changed after you reviewed it, so it was not uploaded. Review it again.");
      }
      const records = await this.journal.listForArtifact(request.artifactId);
      const pending = DriveExportService.pending(records);
      if (pending) {
        const error = new DriveError("export_in_progress", "An earlier upload of this PDF was not confirmed. Use Retry so Job Ranger checks Drive before uploading again.");
        error.operationId = pending.operationId;
        throw error;
      }
      if (records.some((record) => record.state === "verified") && request.saveAnotherCopy !== true) {
        throw new DriveError("already_exported", "This PDF is already saved in Google Drive. Choose Save another copy to upload it again.");
      }
      const record = await this.journal.insertApproved({
        operationId: randomUUID(),
        artifactId: request.artifactId,
        contentSha256: local.sha256,
        fileName: local.fileName,
        sizeBytes: local.bytes.length,
      });
      return this.upload(record, local);
    });
  }

  async retry(operationId: string): Promise<DriveExportReceipt> {
    const record = await this.journal.get(operationId);
    if (!record) throw new DriveError("invalid_request", "That Drive export record no longer exists.");
    return this.withArtifactLock(record.artifactId, async () => {
      const current = (await this.journal.get(operationId))!;
      if (current.state === "verified" && current.driveFileId) return this.receipt(current);
      await this.requireReady();
      const local = await this.loadLocal(current.artifactId);
      if (local.sha256 !== current.contentSha256) {
        throw new DriveError("file_changed", "The PDF changed since this upload was approved, so it was not retried.");
      }
      return this.upload(current, local);
    });
  }

  listExports(artifactId: string): Promise<DriveExportRecord[]> {
    return this.journal.listForArtifact(artifactId);
  }

  /**
   * Upload state machine. A fresh operation is known to be absent remotely; any
   * earlier attempt is looked up by operation id first, so a retry never
   * creates a second file. Failures after the POST started that may have
   * reached Drive are recorded as unknown_remote_outcome.
   */
  private async upload(record: DriveExportRecord, local: LocalArtifact): Promise<DriveExportReceipt> {
    const { drive } = this.options;
    const operationId = record.operationId;
    let remoteKnownAbsent = record.state === "approved";
    let posted = false;
    let createdId: string | null = null;
    try {
      await this.journal.update(operationId, { state: "uploading" });
      if (!remoteKnownAbsent) {
        const existing = await drive.findByOperationId(operationId);
        if (existing) return await this.verifyAndRecord(operationId, existing, local);
        remoteKnownAbsent = true;
      }
      const folderId = await drive.ensureFolder();
      posted = true;
      const created = await drive.uploadPdf({
        name: record.fileName,
        bytes: local.bytes,
        folderId,
        operationId,
        artifactId: record.artifactId,
        sha256: local.sha256,
      });
      createdId = created.id;
      return await this.verifyAndRecord(operationId, await drive.getFile(created.id), local);
    } catch (caught) {
      const error = toDriveError(caught);
      const ambiguous = posted ? isAmbiguousUploadFailure(error) || createdId !== null : !remoteKnownAbsent;
      const state = error.code === "verification_failed" ? "failed" : ambiguous ? "unknown_remote_outcome" : "failed";
      await this.journal.update(operationId, {
        state,
        driveFileId: createdId,
        errorCode: error.code,
        errorMessage: error.message,
      });
      error.operationId = operationId;
      throw error;
    }
  }

  private async verifyAndRecord(operationId: string, remote: DriveFileMetadata, local: LocalArtifact): Promise<DriveExportReceipt> {
    if (remote.appProperties.jobRangerOperationId !== operationId) {
      throw new DriveError("verification_failed", "Google Drive returned a different file than the one Job Ranger uploaded.");
    }
    verifyRemoteFile(remote, { sizeBytes: local.bytes.length, sha256: local.sha256, md5: local.md5 });
    const verified = await this.journal.update(operationId, {
      state: "verified",
      driveFileId: remote.id,
      webViewLink: remote.webViewLink,
    });
    return this.receipt(verified);
  }

  private receipt(record: DriveExportRecord): DriveExportReceipt {
    return {
      operationId: record.operationId,
      artifactId: record.artifactId,
      fileName: record.fileName,
      sizeBytes: record.sizeBytes,
      sha256: record.contentSha256,
      driveFileId: record.driveFileId ?? "",
      webViewLink: record.webViewLink,
      verifiedAt: record.updatedAt,
      destination: GOOGLE_DRIVE_DESTINATION_LABEL,
    };
  }
}
