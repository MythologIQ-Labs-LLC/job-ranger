import { useEffect, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { getDesktopApi } from "../services/api";
import { IS_DEMO_FLAVOR } from "../demo/flavor";
import { loadGoogleDriveSdk } from "../pwa/drive/gis-sdk";
import { DriveWebAuthorization, type DriveAuthView, type GoogleOAuthTokenApi } from "../pwa/drive/google-web-auth";
import { verifyDriveAccount } from "../pwa/drive/google-drive-account";
import { uploadApprovedDriveFile, findCreatedDriveFile, verifyRecoveredDriveFile, type DriveUploadOutcome } from "../pwa/drive/google-drive-transport";
import { BrowserDriveExportJournal } from "../pwa/drive/drive-journal-idb";
import { validateExportProposal, validateApprovedArtifactExport, ExportApprovalLedger } from "../shared/artifact-export-approval";
import type { ExportProposal, HumanExportApproval, ExportReceipt } from "../shared/artifact-export-approval";
import { reserveExport, advanceDurableExport } from "../shared/artifact-export-journal";
import type { ExportJournalRecord } from "../shared/artifact-export-journal";

declare const __JOB_RANGER_GOOGLE_WEB_CLIENT_ID__: string | undefined;
const CLIENT_ID = typeof __JOB_RANGER_GOOGLE_WEB_CLIENT_ID__ === "string"
  ? __JOB_RANGER_GOOGLE_WEB_CLIENT_ID__.trim() : "";
const INIT: DriveAuthView = { phase: "not_connected", message: "Google Drive is not connected in this browser session.", expiresAt: null };

interface PreparedExport {
  proposal: ExportProposal;
  label: string;
  bytes: Blob;
}

async function hash(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function GoogleDriveResumeExport({ artifactId, version }: { artifactId: string; version: number }) {
  const [view, setView] = useState<DriveAuthView>(INIT);
  const [sdk, setSdk] = useState<GoogleOAuthTokenApi | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ name: string; label: string; size: number; digest: string } | null>(null);
  const [result, setResult] = useState<DriveUploadOutcome | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [preparedPending, setPreparedPending] = useState<ExportJournalRecord[]>([]);
  const session = useRef<DriveWebAuthorization | null>(null);
  const prepared = useRef<PreparedExport | null>(null);
  const journal = useRef<BrowserDriveExportJournal | null>(null);
  const ledger = useRef(new ExportApprovalLedger());

  useEffect(() => {
    const timer = window.setInterval(() => session.current?.snapshot(), 10_000);
    return () => {
      window.clearInterval(timer);
      session.current?.dispose();
      session.current = null;
    };
  }, []);

  // Unconfigured releases and the fictional demo must not advertise or contact Google.
  if (!CLIENT_ID || IS_DEMO_FLAVOR) return null;

  const resetReview = () => {
    prepared.current = null;
    setReview(null);
    setResult(null);
  };
  const load = async () => {
    setBusy(true);
    setError(null);
    try { setSdk(await loadGoogleDriveSdk()); }
    catch { setError("Google authorization could not load. Check the browser connection and try again."); }
    finally { setBusy(false); }
  };
  const authorize = () => {
    if (!sdk) return;
    resetReview();
    // Direct click, never await before Google's popup request.
    session.current ??= new DriveWebAuthorization(CLIENT_ID, setView);
    session.current.authorize(sdk);
  };
  const prepare = async () => {
    setError(null);
    resetReview();
    setBusy(true);
    try {
      if (!session.current) throw new Error("Authorize Google Drive first.");
      const account = await session.current.withTokenForUserAction(token => verifyDriveAccount(token));
      journal.current ??= new BrowserDriveExportJournal();
      // A prior POST may have succeeded even when its response was lost. A new
      // approval must not silently create a second Drive copy after reload.
      if (await journal.current.hasUnresolvedForArtifact(account.accountId, artifactId)) {
        throw new Error(
          "An earlier Drive export for this resume is still unresolved. Check Google Drive before " +
          "creating another copy. A new upload is blocked until the previous result is reconciled.",
        );
      }
      const artifact = await getDesktopApi().resume.readVerifiedArtifactForExport(artifactId);
      if (artifact.artifactId !== artifactId || artifact.revision !== String(version) ||
          artifact.mimeType !== "application/pdf") {
        throw new Error("The saved resume changed. Review its latest verified version.");
      }
      const bytes = new Blob([new Uint8Array(artifact.bytes)], { type: "application/pdf" });
      if (bytes.size > 5 * 1024 * 1024 || await hash(bytes) !== artifact.contentHash) {
        throw new Error("The resume content is too large or no longer matches its verified digest.");
      }
      const proposal: ExportProposal = {
        proposalId: crypto.randomUUID(), artifactId, artifactRevision: artifact.revision,
        fileName: artifact.fileName, mimeType: artifact.mimeType,
        bytesSha256: artifact.contentHash, byteLength: bytes.size, providerId: "google-drive",
        accountId: account.accountId, approvedDestinationId: "root",
        destinationLabel: "My Drive (top level)",
        expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
      };
      validateExportProposal(proposal, Date.now());
      prepared.current = { proposal, bytes, label: account.label };
      setReview({ name: proposal.fileName, label: account.label,
        size: proposal.byteLength, digest: proposal.bytesSha256 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The resume could not be prepared for Drive.");
    } finally { setBusy(false); }
  };

  const reconcile = async () => {
    if (!session.current || busy) return;
    setBusy(true);
    setError(null);
    setRecoveryMessage(null);
    setPreparedPending([]);
    resetReview();
    try {
      await session.current.withTokenForUserAction(async token => {
        const account = await verifyDriveAccount(token);
        journal.current ??= new BrowserDriveExportJournal();
        const pending = await journal.current.unresolvedForArtifact(account.accountId, artifactId);
        setPreparedPending(pending.filter(record => record.status === "prepared"));
        if (pending.length === 0) {
          setRecoveryMessage("No unresolved exports for this resume in the authorized Google account.");
          return;
        }
        let recovered = 0;
        for (const original of pending) {
          // Never clear an ambiguous POST from an empty search result.
          if (original.status === "prepared") continue;
          const found = await findCreatedDriveFile(token, original.operationId);
          if (found.status !== "found" ||
              (original.remoteId && original.remoteId !== found.remoteId)) continue;
          const verified = await verifyRecoveredDriveFile(token, {
            operationId: original.operationId, remoteId: found.remoteId,
            name: original.fileName, mimeType: original.mimeType,
            destinationId: original.destinationId, approvedSha256: original.bytesSha256,
          });
          if (!verified) continue;
          let current = original;
          const move = async (status: ExportReceipt["status"], remoteId: string, digest: string | null) => {
            const receipt: ExportReceipt = {
              operationId: original.operationId, proposalId: original.approvalId,
              status, bytesSha256: original.bytesSha256,
              remoteId, verifiedSha256: digest,
            };
            current = await advanceDurableExport(journal.current!, current, receipt, new Date().toISOString());
          };
          if (current.status === "uploading" || current.status === "unknown_remote_outcome") {
            await move("accepted_unverified", found.remoteId, null);
          }
          await move("verified", found.remoteId, original.bytesSha256);
          recovered++;
        }
        setRecoveryMessage(recovered > 0
          ? `Verified ${recovered} prior Drive export(s). Remaining ambiguous operations stay blocked.`
          : "No prior upload could be verified. The duplicate-upload protection remains active. Check the Google account and Drive before further action.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not safely reconcile the previous Drive export.");
    } finally { setBusy(false); }
  };

  // A prepared receipt has not crossed the durable uploading boundary. The
  // compare-and-swap refuses cancellation if another tab already began upload.
  const cancelPrepared = async (operationId: string) => {
    if (!session.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.current.withTokenForUserAction(async token => {
        const account = await verifyDriveAccount(token);
        journal.current ??= new BrowserDriveExportJournal();
        const existing = await journal.current.findOperation(operationId);
        if (!existing || existing.accountId !== account.accountId ||
            existing.artifactId !== artifactId || existing.status !== "prepared") {
          throw new Error("This reservation is no longer cancellable. Recheck prior Drive exports.");
        }
        await advanceDurableExport(journal.current, existing, {
          operationId, proposalId: existing.approvalId, status: "cancelled",
          bytesSha256: existing.bytesSha256, remoteId: null, verifiedSha256: null,
        }, new Date().toISOString());
        setPreparedPending(prior => prior.filter(item => item.operationId !== operationId));
        setRecoveryMessage("Unused reservation cancelled. Re-review the PDF before any new upload.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reservation cannot be safely cancelled.");
    } finally { setBusy(false); }
  };

  const confirmUpload = async () => {
    if (!prepared.current || !session.current || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const selected = prepared.current;
    prepared.current = null;
    setReview(null);
    const approval: HumanExportApproval = {
      kind: "explicit_export_artifact", approvalId: crypto.randomUUID(),
      proposalId: selected.proposal.proposalId, confirmedAt: new Date().toISOString(),
      approvedDigest: selected.proposal.bytesSha256,
      approvedAccountId: selected.proposal.accountId,
      approvedDestinationId: selected.proposal.approvedDestinationId,
    };
    const operationId = crypto.randomUUID();
    const journalRecord: { current: ExportJournalRecord | null } = { current: null };
    try {
      ledger.current.consume(approval);
      const output = await session.current.withTokenForUserAction(async token => {
        const currentAccount = await verifyDriveAccount(token);
        if (currentAccount.accountId !== selected.proposal.accountId) {
          throw new Error("Google account changed after the export preview. Review the destination again.");
        }
        const fresh = await getDesktopApi().resume.readVerifiedArtifactForExport(artifactId);
        const freshBytes = new Blob([new Uint8Array(fresh.bytes)], { type: "application/pdf" });
        if (fresh.artifactId !== selected.proposal.artifactId ||
            fresh.revision !== selected.proposal.artifactRevision) {
          throw new Error("The verified resume was replaced after review.");
        }
        await validateApprovedArtifactExport(selected.proposal, approval, freshBytes, Date.now(), hash);
        journal.current ??= new BrowserDriveExportJournal();
        journalRecord.current = {
          schemaVersion: 1, operationId, approvalId: approval.approvalId,
          accountId: currentAccount.accountId,
          destinationId: selected.proposal.approvedDestinationId,
          artifactId, artifactRevision: selected.proposal.artifactRevision,
          bytesSha256: selected.proposal.bytesSha256, fileName: selected.proposal.fileName,
          mimeType: selected.proposal.mimeType, status: "prepared",
          remoteId: null, verifiedSha256: null, updatedAt: new Date().toISOString(),
        };
        await reserveExport(journal.current, journalRecord.current);
        const uploading: ExportReceipt = {
          operationId, proposalId: selected.proposal.proposalId, status: "uploading",
          bytesSha256: selected.proposal.bytesSha256, remoteId: null, verifiedSha256: null,
        };
        return uploadApprovedDriveFile({
          accessToken: token, operationId, name: selected.proposal.fileName,
          mimeType: selected.proposal.mimeType, destinationId: selected.proposal.approvedDestinationId,
          bytes: freshBytes, approvedSha256: selected.proposal.bytesSha256,
        }, fetch, async () => {
          // No POST can begin until this write commits. Preflight errors leave
          // the reservation prepared and safely cancellable by the user.
          journalRecord.current = await advanceDurableExport(
            journal.current!, journalRecord.current!, uploading, new Date().toISOString());
        });
      });
      if (!journalRecord.current || !journal.current) throw new Error("The export receipt was not saved.");
      const receipt = (status: ExportReceipt["status"], remoteId: string | null, sha256: string | null): ExportReceipt =>
        ({ operationId, proposalId: selected.proposal.proposalId, status,
          bytesSha256: selected.proposal.bytesSha256, remoteId, verifiedSha256: sha256 });
      if (output.status === "unknown_remote_outcome") {
        journalRecord.current = await advanceDurableExport(journal.current, journalRecord.current,
          receipt("unknown_remote_outcome", output.remoteId, null), new Date().toISOString());
      } else {
        journalRecord.current = await advanceDurableExport(journal.current, journalRecord.current,
          receipt("accepted_unverified", output.remoteId, null), new Date().toISOString());
        journalRecord.current = await advanceDurableExport(journal.current, journalRecord.current,
          receipt(output.status === "verified" ? "verified" : "verification_failed",
            output.remoteId, output.status === "verified" ? output.sha256 : null), new Date().toISOString());
      }
      setResult(output);
    } catch (cause) {
      // Any failure after a remote POST might have created a file. Never offer an automatic retry.
      setError(journalRecord.current?.status === "uploading" || journalRecord.current?.status === "accepted_unverified"
        ? "The Drive export may already exist. Check Google Drive before approving a new upload."
        : journalRecord.current?.status === "prepared"
          ? "The upload did not begin. The unused reservation remains saved. Select 'Check prior Drive exports' and cancel that reservation before reviewing another upload."
          : cause instanceof Error ? cause.message : "Drive export could not be completed. Your local resume is unchanged.");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--color-border)] p-3 text-sm" data-testid="drive-resume-export">
      <div className="flex items-center gap-2 font-semibold"><CloudUpload className="h-4 w-4" /> Save PDF v{version} to Google Drive</div>
      <p className="mt-1 text-[var(--color-text-secondary)]">
        Optional. You approve one verified PDF and its destination. Your local workspace remains unchanged.
        Google receives the document only after confirmation. Files are saved to the top level of My Drive.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!sdk ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>
            Load Google authorization
          </button>
        ) : (
          <button type="button" className="secondary-button"
            disabled={busy || view.phase === "authorizing"} onClick={authorize}>
            {view.phase === "authorizing" ? "Waiting for Google…" : "Authorize Drive"}
          </button>
        )}
        {view.phase === "authorized_unverified" && !review && !result && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void prepare()}>
            Review PDF for Drive
          </button>
        )}
        {view.phase === "authorized_unverified" && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void reconcile()}>
            Check prior Drive exports
          </button>
        )}
        {sdk && view.phase !== "not_connected" && (
          <button type="button" className="surface-link-button" disabled={busy} onClick={() => {
            session.current?.forgetSession(); resetReview();
          }}>Forget authorization</button>
        )}
      </div>
      <p role="status" className="mt-2 text-[var(--color-text-secondary)]">{view.message}</p>
      {review && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3" data-testid="drive-export-review">
          <p><strong>Document:</strong> {review.name} ({review.size.toLocaleString()} bytes)</p>
          <p><strong>Google account:</strong> {review.label}</p>
          <p><strong>Destination:</strong> My Drive (top level)</p>
          <p className="mt-1 break-all text-xs"><strong>Approved SHA-256:</strong> {review.digest}</p>
          <p className="mt-2">This resume may contain sensitive contact, career and employment information.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button" disabled={busy} onClick={() => void confirmUpload()}>
              {busy ? "Uploading…" : "Confirm and upload this PDF"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={resetReview}>Cancel export</button>
          </div>
        </div>
      )}
      {result?.status === "verified" && (
        <p role="status" className="mt-3 text-[var(--color-success)]">
          Drive document verified against the approved bytes.{" "}
          <a href={result.openUrl} target="_blank" rel="noopener noreferrer" className="underline">Open in Google Drive</a>
        </p>
      )}
      {result && result.status !== "verified" && (
        <p role="alert" className="mt-3">The upload is not verified. {result.reason} Your local resume is unchanged.</p>
      )}
      {preparedPending.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3" data-testid="drive-prepared-recovery">
          <p>These reserved exports have not entered the uploading state. You may cancel an unused reservation.</p>
          {preparedPending.map(item => (
            <div key={item.operationId} className="mt-2 flex items-center justify-between gap-3">
              <span className="break-all">{item.fileName}</span>
              <button type="button" className="secondary-button" disabled={busy}
                onClick={() => void cancelPrepared(item.operationId)}>Cancel unused reservation</button>
            </div>
          ))}
        </div>
      )}
      {recoveryMessage && <p role="status" className="mt-3">{recoveryMessage}</p>}
      {error && <p role="alert" className="mt-3 text-[var(--color-error)]">{error}</p>}
    </div>
  );
}
