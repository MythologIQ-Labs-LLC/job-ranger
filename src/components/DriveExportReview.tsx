import type { ReactNode } from "react";
import { CloudUpload, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { formatBytes, shortSha256 } from "../services/drive";
import type { DriveExportProposal, DriveExportReceipt, DriveExportRecord } from "../shared/google-drive";

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function Detail({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3">
      <dt className="font-medium text-[var(--color-text-primary)]">{label}</dt>
      <dd className="min-w-0 break-words" data-testid={testId}>{children}</dd>
    </div>
  );
}

const ABANDON_COPY =
  "Abandoning keeps this record and lets you upload again. If the earlier upload did reach Google Drive, you may end up with two copies.";

interface ReviewProps {
  proposal: DriveExportProposal;
  onApprove: (saveAnotherCopy: boolean) => void;
  onRetry: (operationId: string) => void;
  onAbandon: (operationId: string) => void;
  onOpen: (link: string) => void;
  onCancel: () => void;
}

function OtherAccountExport({ record, onAbandon, onOpen }: { record: DriveExportRecord; onAbandon: (id: string) => void; onOpen: (link: string) => void }) {
  const who = record.accountEmail ?? "another Google account";
  if (record.state === "verified") {
    return (
      <li>
        Saved to {who} on {formatDate(record.updatedAt)}.
        {record.webViewLink && (
          <button type="button" className="surface-link-button ml-2 font-semibold text-[var(--color-primary)]" onClick={() => onOpen(record.webViewLink!)}>
            Open
          </button>
        )}
      </li>
    );
  }
  return (
    <li>
      An upload to {who} was not confirmed. Connect {who} to retry it, or abandon it. {ABANDON_COPY}
      <button type="button" className="surface-link-button ml-2 font-semibold text-[var(--color-primary)]" onClick={() => onAbandon(record.operationId)}>
        Abandon this attempt
      </button>
    </li>
  );
}

/** The review step: exactly what will be uploaded, and the decisions earlier attempts require. */
export function DriveExportReview({ proposal, onApprove, onRetry, onAbandon, onOpen, onCancel }: ReviewProps) {
  const verified = proposal.verifiedExports[0] ?? null;
  const mismatched = proposal.mismatchedCopies;
  return (
    <div className="space-y-5 text-sm text-[var(--color-text-secondary)]">
      <p>Review exactly what will be uploaded. Nothing is sent to Google until you approve.</p>
      <dl className="space-y-2" aria-label="File to upload">
        <Detail label="File name" testId="drive-file-name">{proposal.fileName}</Detail>
        <Detail label="Format">{proposal.formatLabel} · version {proposal.artifactVersion}</Detail>
        <Detail label="Size" testId="drive-file-size">{formatBytes(proposal.sizeBytes)}</Detail>
        <Detail label="Pages">{proposal.pageCount ?? "Unknown"}</Detail>
        <Detail label="Generated for" testId="drive-generated-for">{proposal.generatedFor}</Detail>
        <Detail label="SHA-256" testId="drive-sha256"><span title={proposal.sha256} className="font-mono">{shortSha256(proposal.sha256)}</span></Detail>
        <Detail label="Destination" testId="drive-destination">{proposal.destination}</Detail>
        <Detail label="Google account" testId="drive-review-account">{proposal.accountEmail ?? "Connected account"}</Detail>
      </dl>

      {proposal.otherAccountExports.length > 0 && (
        <ul className="support-note list-none space-y-2 px-4 py-3" aria-label="Uploads to other Google accounts">
          {proposal.otherAccountExports.map((record) => (
            <OtherAccountExport key={record.operationId} record={record} onAbandon={onAbandon} onOpen={onOpen} />
          ))}
        </ul>
      )}

      {proposal.pendingExport ? (
        <div className="support-note space-y-3 px-4 py-3" role="status">
          {proposal.pendingExport.state === "failed" ? (
            <p data-testid="drive-pending-reason">{proposal.pendingExport.errorMessage}</p>
          ) : (
            <p>
              An earlier upload of this PDF was not confirmed. Retry first looks in Google Drive for the exact file reserved for that upload,
              so it does not create a second copy.
            </p>
          )}
          <p>{ABANDON_COPY}</p>
          <div className="flex flex-wrap gap-3">
            {proposal.pendingExport.errorCode !== "reserved_id_rejected" && (
              <button type="button" className="primary-button" onClick={() => onRetry(proposal.pendingExport!.operationId)}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry upload
              </button>
            )}
            <button type="button" className="secondary-button" onClick={() => onAbandon(proposal.pendingExport!.operationId)}>
              <XCircle className="h-4 w-4" aria-hidden="true" /> Abandon this attempt
            </button>
          </div>
        </div>
      ) : verified || mismatched.length > 0 ? (
        <div className="support-note space-y-3 px-4 py-3">
          {verified && <p>Already saved to Drive on {formatDate(verified.updatedAt)}.</p>}
          {mismatched.length > 0 && (
            <p data-testid="drive-mismatched-copy">
              An earlier upload left a copy in Google Drive that does not match this PDF. It was never marked as saved; you may want to remove it.
              {mismatched[0].webViewLink && (
                <button type="button" className="surface-link-button ml-2 font-semibold text-[var(--color-primary)]" onClick={() => onOpen(mismatched[0].webViewLink!)}>
                  Open that copy
                </button>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {verified?.webViewLink && (
              <button type="button" className="secondary-button" onClick={() => onOpen(verified.webViewLink!)}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Google Drive
              </button>
            )}
            <button type="button" className="primary-button" onClick={() => onApprove(true)}>
              <CloudUpload className="h-4 w-4" aria-hidden="true" /> {verified ? "Save another copy" : "Upload a new copy"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="primary-button" onClick={() => onApprove(false)}>
            <CloudUpload className="h-4 w-4" aria-hidden="true" /> Approve and upload
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export function DriveExportReceiptView({ receipt, onOpen, onDone }: { receipt: DriveExportReceipt; onOpen: (link: string) => void; onDone: () => void }) {
  return (
    <div className="space-y-4 text-sm text-[var(--color-text-secondary)]">
      <p className="font-semibold text-[var(--color-success)]" role="status">Saved to Google Drive and verified.</p>
      <dl className="space-y-2" aria-label="Google Drive receipt">
        <Detail label="File name" testId="drive-receipt-name">{receipt.fileName}</Detail>
        <Detail label="Drive file ID" testId="drive-receipt-id"><span className="font-mono">{receipt.driveFileId}</span></Detail>
        <Detail label="Verified" testId="drive-receipt-verified">{formatDate(receipt.verifiedAt)}</Detail>
        <Detail label="SHA-256"><span title={receipt.sha256} className="font-mono">{shortSha256(receipt.sha256)}</span></Detail>
        <Detail label="Destination">{receipt.destination}</Detail>
        {receipt.accountEmail && <Detail label="Google account">{receipt.accountEmail}</Detail>}
      </dl>
      <div className="flex flex-wrap gap-3">
        {receipt.webViewLink && (
          <button type="button" className="primary-button" onClick={() => onOpen(receipt.webViewLink!)}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Google Drive
          </button>
        )}
        <button type="button" className="secondary-button" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
