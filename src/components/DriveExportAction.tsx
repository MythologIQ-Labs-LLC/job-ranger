import { type ReactNode, useCallback, useEffect, useState } from "react";
import { CloudUpload, ExternalLink, RefreshCw } from "lucide-react";
import { Modal } from "./Modal";
import { getDesktopApi } from "../services/api";
import { formatBytes, needsReconnect, shortSha256, unavailableMessage } from "../services/drive";
import type {
  DriveErrorInfo,
  DriveExportProposal,
  DriveExportReceipt,
  DriveExportRecord,
  DriveResult,
  DriveStatus,
} from "../shared/google-drive";
import type { ResumeArtifactRecord } from "../shared/resume-contracts";

type Phase = "loading" | "review" | "uploading" | "receipt" | "error";

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function rowSummary(records: DriveExportRecord[]): { text: string; tone: "success" | "warning" } | null {
  const latest = records[0];
  if (!latest) return null;
  if (latest.state === "verified") return { text: `Saved to Google Drive ${formatDate(latest.updatedAt)}`, tone: "success" };
  if (latest.state === "failed") return { text: "Last Google Drive upload failed", tone: "warning" };
  return { text: "Google Drive upload not confirmed — open to retry", tone: "warning" };
}

function Detail({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3">
      <dt className="font-medium text-[var(--color-text-primary)]">{label}</dt>
      <dd className="min-w-0 break-words" data-testid={testId}>{children}</dd>
    </div>
  );
}

/** "Save to Google Drive" for one verified resume PDF: review, explicit approval, receipt, retry (#314). */
export function DriveExportAction({
  artifact,
  status,
  onStatusChange,
}: {
  artifact: ResumeArtifactRecord;
  status: DriveStatus;
  onStatusChange: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [records, setRecords] = useState<DriveExportRecord[]>([]);
  const [proposal, setProposal] = useState<DriveExportProposal | null>(null);
  const [receipt, setReceipt] = useState<DriveExportReceipt | null>(null);
  const [error, setError] = useState<DriveErrorInfo | null>(null);

  const loadRecords = useCallback(async () => {
    if (!status.configured) return;
    try {
      setRecords(await getDesktopApi().drive.listExports(artifact.id));
    } catch {
      // The row still works without journal history.
    }
  }, [artifact.id, status.configured]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const settle = async (result: DriveResult<DriveExportReceipt>) => {
    if (result.ok) {
      setReceipt(result.value);
      setPhase("receipt");
    } else {
      setError(result.error);
      setPhase("error");
    }
    await loadRecords();
  };

  const review = async () => {
    setOpen(true);
    setPhase("loading");
    setError(null);
    setReceipt(null);
    const result = await getDesktopApi().drive.prepareExport(artifact.id);
    if (result.ok) {
      setProposal(result.value);
      setPhase("review");
    } else {
      setError(result.error);
      setPhase("error");
    }
  };

  const approve = async (saveAnotherCopy: boolean) => {
    if (!proposal) return;
    setPhase("uploading");
    await settle(await getDesktopApi().drive.approveExport({ artifactId: artifact.id, expectedSha256: proposal.sha256, saveAnotherCopy }));
  };

  const retry = async (operationId: string) => {
    setPhase("uploading");
    setError(null);
    await settle(await getDesktopApi().drive.retryExport(operationId));
  };

  const reconnect = async () => {
    setPhase("loading");
    const result = await getDesktopApi().drive.connect();
    await onStatusChange();
    if (result.ok) await review();
    else {
      setError(result.error);
      setPhase("error");
    }
  };

  const openInDrive = (link: string) => void getDesktopApi().openExternal(link);

  if (status.reason === "desktop-only") return null;
  const summary = rowSummary(records);
  const verified = proposal?.verifiedExports[0] ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {summary && (
          <span className={`text-xs ${summary.tone === "success" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`} data-testid="drive-row-status">
            {summary.text}
          </span>
        )}
        <button
          type="button"
          className="surface-link-button font-semibold text-[var(--color-primary)] disabled:opacity-60"
          disabled={!status.configured}
          title={status.configured ? undefined : unavailableMessage(status)}
          onClick={() => void review()}
        >
          <CloudUpload className="mr-1 inline h-4 w-4" aria-hidden="true" />
          Save to Google Drive
        </button>
      </div>

      <Modal open={open} onClose={() => phase !== "uploading" && setOpen(false)} title="Save to Google Drive" size="lg">
        {phase === "loading" && <p className="text-sm text-[var(--color-text-secondary)]" role="status">Checking the PDF…</p>}

        {phase === "review" && proposal && (
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
            {proposal.pendingExport ? (
              <div className="support-note space-y-3 px-4 py-3" role="status">
                <p>An earlier upload of this PDF was not confirmed. Retry checks Google Drive for that upload first, so it never creates a second copy.</p>
                <button type="button" className="primary-button" onClick={() => void retry(proposal.pendingExport!.operationId)}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry upload
                </button>
              </div>
            ) : verified ? (
              <div className="support-note space-y-3 px-4 py-3">
                <p>Already saved to Drive on {formatDate(verified.updatedAt)}.</p>
                <div className="flex flex-wrap gap-3">
                  {verified.webViewLink && (
                    <button type="button" className="secondary-button" onClick={() => openInDrive(verified.webViewLink!)}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Google Drive
                    </button>
                  )}
                  <button type="button" className="primary-button" onClick={() => void approve(true)}>
                    <CloudUpload className="h-4 w-4" aria-hidden="true" /> Save another copy
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button type="button" className="primary-button" onClick={() => void approve(false)}>
                  <CloudUpload className="h-4 w-4" aria-hidden="true" /> Approve and upload
                </button>
                <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {phase === "uploading" && (
          <p className="text-sm text-[var(--color-text-secondary)]" role="status">Uploading and verifying the copy in Google Drive…</p>
        )}

        {phase === "receipt" && receipt && (
          <div className="space-y-4 text-sm text-[var(--color-text-secondary)]">
            <p className="font-semibold text-[var(--color-success)]" role="status">Saved to Google Drive and verified.</p>
            <dl className="space-y-2" aria-label="Google Drive receipt">
              <Detail label="File name" testId="drive-receipt-name">{receipt.fileName}</Detail>
              <Detail label="Drive file ID" testId="drive-receipt-id"><span className="font-mono">{receipt.driveFileId}</span></Detail>
              <Detail label="Verified" testId="drive-receipt-verified">{formatDate(receipt.verifiedAt)}</Detail>
              <Detail label="SHA-256"><span title={receipt.sha256} className="font-mono">{shortSha256(receipt.sha256)}</span></Detail>
              <Detail label="Destination">{receipt.destination}</Detail>
            </dl>
            <div className="flex flex-wrap gap-3">
              {receipt.webViewLink && (
                <button type="button" className="primary-button" onClick={() => openInDrive(receipt.webViewLink!)}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Google Drive
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        )}

        {phase === "error" && error && (
          <div className="space-y-4 text-sm">
            <p className="text-[var(--color-danger)]" role="alert" data-testid="drive-error">{error.message}</p>
            {error.operationId && !needsReconnect(error) && error.code !== "file_changed" && (
              <p className="text-[var(--color-text-secondary)]">Your local PDF is unchanged. Retry checks Google Drive before uploading again, so it will not create a duplicate.</p>
            )}
            <div className="flex flex-wrap gap-3">
              {needsReconnect(error) && (
                <button type="button" className="primary-button" onClick={() => void reconnect()}>Reconnect Google Drive</button>
              )}
              {error.operationId && error.retryable && !needsReconnect(error) && error.code !== "file_changed" && (
                <button type="button" className="primary-button" onClick={() => void retry(error.operationId!)}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
                </button>
              )}
              {(error.code === "file_changed" || error.code === "export_in_progress" || error.code === "already_exported") && (
                <button type="button" className="secondary-button" onClick={() => void review()}>Review again</button>
              )}
              <button type="button" className="secondary-button" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
