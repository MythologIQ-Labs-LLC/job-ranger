import { GOOGLE_DRIVE_DESTINATION_LABEL, type DriveExportReceipt } from "../../../src/shared/google-drive.js";
import { DriveError, isAmbiguousUploadFailure, toDriveError } from "./drive-errors.cjs";
import type { DriveExportJournal, DriveJournalRecord } from "./drive-export-journal.cjs";
import { verifyRemoteFile, type DriveFileMetadata, type DriveTransport } from "./drive-transport.cjs";
import type { DriveAccount } from "./google-desktop-auth.cjs";

export interface LocalUploadBytes {
  bytes: Buffer;
  sha256: string;
  md5: string;
}

export function receiptFor(record: DriveJournalRecord): DriveExportReceipt {
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
    accountEmail: record.accountEmail,
  };
}

/**
 * Upload state machine for one journal operation.
 *
 * 1. Reserve a Drive file id (files.generateIds) and persist it before any
 *    upload. A row that already has one is resolved by files.get on that id,
 *    which is strongly consistent (unlike a files.list search): 200 means the
 *    earlier attempt landed and is verified without uploading; 404 means it is
 *    safe to upload with the same id.
 * 2. Create with that id. Drive refuses a second create with the same id
 *    (409), which is treated as "it already exists" and verified, so even a
 *    late-committing earlier request cannot produce a second file.
 * 3. Read the file back and verify size and digest before reporting success.
 *
 * A failure that may have reached Drive leaves the row unknown_remote_outcome.
 */
export class DriveUploadRunner {
  constructor(
    private readonly journal: DriveExportJournal,
    private readonly drive: DriveTransport,
  ) {}

  async run(record: DriveJournalRecord, local: LocalUploadBytes, account: DriveAccount): Promise<DriveExportReceipt> {
    const operationId = record.operationId;
    // An earlier attempt may have reached Drive; never downgrade that knowledge on a later pre-upload failure.
    const mayExistRemotely = record.state === "uploading" || record.state === "unknown_remote_outcome";
    let posted = false;
    let reservedId = record.reservedFileId;
    try {
      if (reservedId) {
        const existing = await this.drive.findFile(reservedId);
        if (existing) return await this.verifyAndRecord(operationId, reservedId, existing, local);
      } else {
        if (mayExistRemotely) {
          // Rows without a reservation (none are written any more): secondary, eventually consistent lookup.
          const found = await this.drive.findByOperationId(operationId);
          if (found) return await this.verifyAndRecord(operationId, found.id, found, local);
        }
        reservedId = await this.drive.generateFileId();
        await this.journal.reserveFileId(operationId, reservedId);
      }
      await this.journal.update(operationId, { state: "uploading" });
      posted = true;
      // Whether this request created the file or Drive reported the id as taken (an earlier
      // attempt landed), the file under the reserved id is read back and verified.
      await this.create(record, reservedId, local, account);
      return await this.verifyAndRecord(operationId, reservedId, await this.drive.getFile(reservedId), local);
    } catch (caught) {
      const error = toDriveError(caught);
      // These were already recorded with the remote file's id and link.
      if (error.code !== "verification_failed" && error.code !== "remote_trashed") {
        const ambiguous = mayExistRemotely || (posted && isAmbiguousUploadFailure(error));
        await this.journal.update(operationId, {
          state: ambiguous ? "unknown_remote_outcome" : "failed",
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
      error.operationId = operationId;
      throw error;
    }
  }

  /** Creates the file with the reserved id; a 409 (id already exists) is not an error. */
  private async create(record: DriveJournalRecord, fileId: string, local: LocalUploadBytes, account: DriveAccount): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const folderId = await this.drive.ensureFolder(account.id);
      try {
        await this.drive.uploadPdf({
          fileId,
          name: record.fileName,
          bytes: local.bytes,
          folderId,
          operationId: record.operationId,
          artifactId: record.artifactId,
          sha256: local.sha256,
        });
        return;
      } catch (error) {
        if (error instanceof DriveError && error.httpStatus === 409) return;
        // 404: the cached folder vanished; nothing was created, so rebuild it and try once more.
        if (error instanceof DriveError && error.httpStatus === 404 && attempt === 0) {
          this.drive.invalidateFolder();
          continue;
        }
        throw error;
      }
    }
  }

  private async verifyAndRecord(
    operationId: string,
    expectedId: string,
    remote: DriveFileMetadata,
    local: LocalUploadBytes,
  ): Promise<DriveExportReceipt> {
    if (remote.trashed) {
      // The upload landed but the file is in Drive's trash: not saved, but restorable.
      const message = "The uploaded file is in Google Drive's trash, so it is not counted as saved. Restore it in Drive and choose Retry, or abandon this attempt and upload a new copy.";
      await this.journal.update(operationId, {
        state: "failed",
        driveFileId: remote.id,
        webViewLink: remote.webViewLink,
        errorCode: "remote_trashed",
        errorMessage: message,
      });
      throw new DriveError("remote_trashed", message);
    }
    try {
      if (remote.id !== expectedId || remote.appProperties.jobRangerOperationId !== operationId) {
        throw new DriveError("verification_failed", "Google Drive returned a different file than the one Job Ranger uploaded.");
      }
      verifyRemoteFile(remote, { sizeBytes: local.bytes.length, sha256: local.sha256, md5: local.md5 });
    } catch (caught) {
      const error = toDriveError(caught);
      const message = `${error.message} A copy that does not match your PDF exists in Google Drive; it was not marked as saved. Remove it in Drive, or upload a new copy.`;
      await this.journal.update(operationId, {
        state: "failed",
        driveFileId: remote.id,
        webViewLink: remote.webViewLink,
        errorCode: "verification_failed",
        errorMessage: message,
      });
      throw new DriveError("verification_failed", message);
    }
    const verified = await this.journal.update(operationId, {
      state: "verified",
      driveFileId: remote.id,
      webViewLink: remote.webViewLink,
    });
    return receiptFor(verified);
  }
}
