import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, RefreshCw, X } from "lucide-react";
import { Modal } from "./Modal";
import { DriveExportReceiptView, DriveExportReview, formatDate } from "./DriveExportReview";
import { getDesktopApi } from "../services/api";
import { needsReconnect, unavailableMessage } from "../services/drive";
import type {
  DriveErrorInfo,
  DriveExportProposal,
  DriveExportReceipt,
  DriveExportRecord,
  DriveResult,
  DriveStatus,
} from "../shared/google-drive";
import type { ResumeArtifactRecord } from "../shared/resume-contracts";

type Phase = "loading" | "review" | "connecting" | "uploading" | "receipt" | "error";

function rowSummary(records: DriveExportRecord[], accountEmail: string | undefined): { text: string; tone: "success" | "warning" } | null {
  const latest = records.find((record) => record.state !== "abandoned");
  if (!latest) return null;
  const elsewhere = latest.accountEmail && latest.accountEmail !== accountEmail ? ` (${latest.accountEmail})` : "";
  if (latest.state === "verified") return { text: `Saved to Google Drive${elsewhere} ${formatDate(latest.updatedAt)}`, tone: "success" };
  if (latest.state === "failed") return { text: `Last Google Drive upload failed${elsewhere}`, tone: "warning" };
  return { text: `Google Drive upload not confirmed${elsewhere} — open to retry or abandon`, tone: "warning" };
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
  const signingIn = useRef(false);
  /** The sign-in this dialog started, so Cancel and close only end that one. */
  const flowId = useRef<string | undefined>(undefined);

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

  const fail = (next: DriveErrorInfo) => {
    setError(next);
    setPhase("error");
  };

  const settle = async (result: DriveResult<DriveExportReceipt>) => {
    if (result.ok) {
      setReceipt(result.value);
      setPhase("receipt");
    } else {
      fail(result.error);
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
      fail(result.error);
    }
  };

  const approve = async (saveAnotherCopy: boolean) => {
    if (!proposal) return;
    setPhase("uploading");
    await settle(await getDesktopApi().drive.approveExport({
      artifactId: artifact.id,
      expectedSha256: proposal.sha256,
      expectedAccountId: proposal.accountId,
      saveAnotherCopy,
    }));
  };

  const retry = async (operationId: string) => {
    setPhase("uploading");
    setError(null);
    await settle(await getDesktopApi().drive.retryExport(operationId));
  };

  const abandon = async (operationId: string) => {
    const result = await getDesktopApi().drive.abandonExport(operationId);
    await loadRecords();
    if (result.ok) await review();
    else fail(result.error);
  };

  const reconnect = async () => {
    setPhase("connecting");
    signingIn.current = true;
    flowId.current = undefined;
    const pending = getDesktopApi().drive.connect();
    const timer = window.setInterval(() => {
      void getDesktopApi().drive.status().then((next) => {
        if (signingIn.current && next.connectFlowId) flowId.current = next.connectFlowId;
      });
      void onStatusChange();
    }, 300);
    const result = await pending.finally(() => {
      window.clearInterval(timer);
      signingIn.current = false;
      flowId.current = undefined;
    });
    await onStatusChange();
    if (result.ok) await review();
    else fail(result.error);
  };

  const cancelSignIn = async () => {
    await getDesktopApi().drive.cancelConnect(flowId.current);
    await onStatusChange();
  };

  const close = () => {
    if (phase === "uploading") return;
    // Closing the dialog ends a sign-in it started; Settings can start a new one.
    if (signingIn.current) void cancelSignIn();
    setOpen(false);
  };

  const openInDrive = (link: string) => void getDesktopApi().openExternal(link);

  if (status.reason === "desktop-only") return null;
  const summary = rowSummary(records, status.accountEmail);
  const canRetry = error?.operationId && error.retryable;
  const canAbandon = error?.operationId && (error.code === "account_mismatch" || error.code === "export_in_progress" || error.retryable);

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

      <Modal open={open} onClose={close} title="Save to Google Drive" size="lg">
        {phase === "loading" && <p className="text-sm text-[var(--color-text-secondary)]" role="status">Checking the PDF…</p>}

        {phase === "review" && proposal && (
          <DriveExportReview
            proposal={proposal}
            onApprove={(another) => void approve(another)}
            onRetry={(id) => void retry(id)}
            onAbandon={(id) => void abandon(id)}
            onOpen={openInDrive}
            onCancel={() => setOpen(false)}
          />
        )}

        {phase === "connecting" && (
          <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <p role="status">Waiting for you to finish signing in to Google in your browser…</p>
            <button type="button" className="secondary-button" onClick={() => void cancelSignIn()}>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel sign-in
            </button>
          </div>
        )}

        {phase === "uploading" && (
          <p className="text-sm text-[var(--color-text-secondary)]" role="status">Uploading and verifying the copy in Google Drive…</p>
        )}

        {phase === "receipt" && receipt && <DriveExportReceiptView receipt={receipt} onOpen={openInDrive} onDone={() => setOpen(false)} />}

        {phase === "error" && error && (
          <div className="space-y-4 text-sm">
            <p className="text-[var(--color-danger)]" role="alert" data-testid="drive-error">{error.message}</p>
            {canRetry && (
              <p className="text-[var(--color-text-secondary)]">
                Your local PDF is unchanged. Retry first looks in Google Drive for the exact file reserved for this upload, so it does not create a second copy.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {needsReconnect(error) && (
                <button type="button" className="primary-button" onClick={() => void reconnect()}>Reconnect Google Drive</button>
              )}
              {canRetry && (
                <button type="button" className="primary-button" onClick={() => void retry(error.operationId!)}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
                </button>
              )}
              {canAbandon && (
                <button type="button" className="secondary-button" onClick={() => void abandon(error.operationId!)}>Abandon this attempt</button>
              )}
              {(error.code === "file_changed" || error.code === "export_in_progress" || error.code === "already_exported" || error.code === "verification_failed") && (
                <button type="button" className="secondary-button" onClick={() => void review()}>Review again</button>
              )}
              <button type="button" className="secondary-button" onClick={close}>Close</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
