import { useEffect, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { getDesktopApi } from "../services/api";
import { IS_DEMO_FLAVOR } from "../demo/flavor";
import { IsolatedDriveAuthorization } from "../pwa/drive/isolated-drive-auth";
import type { DriveAuthView } from "../pwa/drive/drive-auth-view";
import { verifyDriveAccount } from "../pwa/drive/google-drive-account";
import {
  uploadApprovedDriveFile, reserveDriveFileId, inspectReservedDriveFile, findCreatedDriveFile,
  verifyRecoveredDriveFile, type DriveUploadOutcome,
} from "../pwa/drive/google-drive-transport";
import { BrowserDriveExportJournal } from "../pwa/drive/drive-journal-idb";
import { validateExportProposal, validateApprovedArtifactExport, ExportApprovalLedger } from "../shared/artifact-export-approval";
import type { ExportProposal, HumanExportApproval, ExportReceipt, ExportResolution } from "../shared/artifact-export-approval";
import { reserveExport, advanceDurableExport, EXPORT_JOURNAL_SCHEMA_VERSION } from "../shared/artifact-export-journal";
import type { ExportJournalRecord } from "../shared/artifact-export-journal";

declare const __SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN__: string | undefined;
// Google authorization runs ONLY on this separately hosted helper origin (#264);
// Google's sign-in script is never loaded next to Career Ops data.
const HELPER_ORIGIN = typeof __SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN__ === "string"
  ? __SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN__.trim() : "";
const INIT: DriveAuthView = { phase: "not_connected", message: "Google Drive is not connected in this browser session.", expiresAt: null };

const STATUS_LABEL: Partial<Record<ExportJournalRecord["status"], string>> = {
  uploading: "upload started; outcome unknown",
  unknown_remote_outcome: "outcome unknown",
  accepted_unverified: "uploaded; not verified",
  verification_failed: "Drive copy did not match the approved PDF",
};

interface PreparedExport {
  proposal: ExportProposal;
  label: string;
  bytes: Blob;
}

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

export function GoogleDriveResumeExport({ artifactId, version }: { artifactId: string; version: number }) {
  const [view, setView] = useState<DriveAuthView>(INIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ name: string; label: string; size: number; digest: string } | null>(null);
  const [result, setResult] = useState<DriveUploadOutcome | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [preparedPending, setPreparedPending] = useState<ExportJournalRecord[]>([]);
  const [unresolved, setUnresolved] = useState<ExportJournalRecord[]>([]);
  const [abandonTarget, setAbandonTarget] = useState<string | null>(null);
  const session = useRef<IsolatedDriveAuthorization | null>(null);
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
  if (!HELPER_ORIGIN || IS_DEMO_FLAVOR) return null;

  const resetReview = () => {
    prepared.current = null;
    setReview(null);
    setResult(null);
  };
  const clearRecovery = () => {
    setPreparedPending([]);
    setUnresolved([]);
    setAbandonTarget(null);
  };
  const authorize = () => {
    resetReview();
    clearRecovery();
    // Must run directly in the click handler (popup), never after an await.
    session.current ??= new IsolatedDriveAuthorization(HELPER_ORIGIN, setView);
    session.current.authorize();
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
      const pending = await journal.current.unresolvedForArtifact(account.accountId, artifactId);
      if (pending.length > 0) {
        throw new Error(pending.every(record => record.status === "prepared")
          ? "An unused Drive export reservation from an earlier attempt is still saved. Nothing was " +
            "uploaded for it. Select 'Check prior Drive exports' to cancel it, then review the PDF again."
          : "An earlier Drive export for this resume is still unresolved and may already exist in Google " +
            "Drive. Select 'Check prior Drive exports' to reconcile it before creating another copy.");
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

  /**
   * Read-only reconciliation of earlier operations; NEVER uploads. An operation with a
   * reserved Drive file ID is resolved by a strongly consistent files.get of that ID:
   * found -> verify metadata and bytes; 404 -> it provably never reached Drive (failed).
   * Schema-v1 rows without a reserved ID fall back to the eventually consistent
   * appProperties search, whose empty result never clears anything.
   */
  const reconcile = async () => {
    if (!session.current || busy) return;
    setBusy(true);
    setError(null);
    setRecoveryMessage(null);
    clearRecovery();
    resetReview();
    try {
      await session.current.withTokenForUserAction(async token => {
        const account = await verifyDriveAccount(token);
        journal.current ??= new BrowserDriveExportJournal();
        const store = journal.current;
        // Only rows journaled for THIS verified account: a 404 is only meaningful
        // when asked with the same account that reserved the file ID.
        const pending = await store.unresolvedForArtifact(account.accountId, artifactId);
        if (pending.length === 0) {
          setRecoveryMessage("No unresolved exports for this resume in the authorized Google account.");
          return;
        }
        let verified = 0;
        let absent = 0;
        for (const original of pending) {
          if (original.status === "prepared") continue;
          const knownId = original.reservedFileId ?? original.remoteId;
          let foundId: string | null = null;
          if (knownId) {
            const probe = await inspectReservedDriveFile(token, knownId);
            if (probe === "absent") {
              if (original.reservedFileId &&
                  (original.status === "uploading" || original.status === "unknown_remote_outcome")) {
                await advanceDurableExport(store, original,
                  receiptFor(original, "failed", null, null, "reserved_id_absent"), new Date().toISOString());
                absent++;
              }
              continue;
            }
            if (probe !== "found") continue;
            foundId = knownId;
          } else {
            // v1 fallback. Never clear an ambiguous POST from an empty search result.
            const found = await findCreatedDriveFile(token, original.operationId);
            if (found.status !== "found") continue;
            foundId = found.remoteId;
          }
          if (original.remoteId && original.remoteId !== foundId) continue;
          const matches = await verifyRecoveredDriveFile(token, {
            operationId: original.operationId, remoteId: foundId,
            name: original.fileName, mimeType: original.mimeType,
            destinationId: original.destinationId, approvedSha256: original.bytesSha256,
          });
          if (!matches) continue;
          let current = original;
          if (current.status === "uploading" || current.status === "unknown_remote_outcome") {
            current = await advanceDurableExport(store, current,
              receiptFor(current, "accepted_unverified", foundId), new Date().toISOString());
          }
          await advanceDurableExport(store, current,
            receiptFor(current, "verified", foundId, original.bytesSha256), new Date().toISOString());
          verified++;
        }
        const remaining = await store.unresolvedForArtifact(account.accountId, artifactId);
        const blocked = remaining.filter(record => record.status !== "prepared");
        setPreparedPending(remaining.filter(record => record.status === "prepared"));
        setUnresolved(blocked);
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
        setRecoveryMessage(parts.length > 0 ? parts.join(" ")
          : "No unresolved exports for this resume in the authorized Google account.");
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
        await advanceDurableExport(journal.current, existing,
          receiptFor(existing, "cancelled", null), new Date().toISOString());
        setPreparedPending(prior => prior.filter(item => item.operationId !== operationId));
        setRecoveryMessage("Unused reservation cancelled. Re-review the PDF before any new upload.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reservation cannot be safely cancelled.");
    } finally { setBusy(false); }
  };

  /**
   * Explicit, warned user decision only: stop tracking an attempt Sojourner cannot
   * resolve. The receipt is kept as "abandoned"; nothing in Drive is deleted, and
   * Sojourner never claims that Drive holds no copy.
   */
  const abandonUnresolved = async (operationId: string) => {
    if (!session.current || busy || abandonTarget !== operationId) return;
    setBusy(true);
    setError(null);
    try {
      await session.current.withTokenForUserAction(async token => {
        const account = await verifyDriveAccount(token);
        journal.current ??= new BrowserDriveExportJournal();
        const existing = await journal.current.findOperation(operationId);
        if (!existing || existing.accountId !== account.accountId || existing.artifactId !== artifactId ||
            !["uploading", "unknown_remote_outcome", "accepted_unverified", "verification_failed"].includes(existing.status)) {
          throw new Error("This export is no longer unresolved. Recheck prior Drive exports.");
        }
        await advanceDurableExport(journal.current, existing,
          receiptFor(existing, "abandoned", existing.remoteId, null, "user_abandoned"), new Date().toISOString());
        setUnresolved(prior => prior.filter(item => item.operationId !== operationId));
        setAbandonTarget(null);
        setRecoveryMessage("Attempt abandoned. Its receipt is kept on this device. If Google Drive already holds a copy, a new export will create a second one.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export could not be safely abandoned.");
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
        // Reserve the Drive file ID first (read-only; nothing is created), and journal it
        // with the approval BEFORE the uploading state can be committed.
        const reservedFileId = await reserveDriveFileId(token);
        const reservation: ExportJournalRecord = {
          schemaVersion: EXPORT_JOURNAL_SCHEMA_VERSION, operationId, approvalId: approval.approvalId,
          accountId: currentAccount.accountId,
          destinationId: selected.proposal.approvedDestinationId,
          artifactId, artifactRevision: selected.proposal.artifactRevision,
          bytesSha256: selected.proposal.bytesSha256, fileName: selected.proposal.fileName,
          mimeType: selected.proposal.mimeType, status: "prepared", reservedFileId,
          remoteId: null, verifiedSha256: null, resolution: null, updatedAt: new Date().toISOString(),
        };
        await reserveExport(journal.current, reservation);
        // Only advertise a cancellable reservation after durable insertion succeeds.
        journalRecord.current = reservation;
        return uploadApprovedDriveFile({
          accessToken: token, operationId, name: selected.proposal.fileName,
          mimeType: selected.proposal.mimeType, destinationId: selected.proposal.approvedDestinationId,
          bytes: freshBytes, approvedSha256: selected.proposal.bytesSha256, reservedFileId,
        }, fetch, async () => {
          // No POST can begin until this write commits. Preflight errors leave
          // the reservation prepared and safely cancellable by the user.
          journalRecord.current = await advanceDurableExport(journal.current!, journalRecord.current!,
            receiptFor(journalRecord.current!, "uploading", null), new Date().toISOString());
        });
      });
      if (!journalRecord.current || !journal.current) throw new Error("The export receipt was not saved.");
      const advance = async (status: ExportReceipt["status"], remoteId: string | null,
        sha256: string | null = null, resolution: ExportResolution | null = null) => {
        journalRecord.current = await advanceDurableExport(journal.current!, journalRecord.current!,
          receiptFor(journalRecord.current!, status, remoteId, sha256, resolution), new Date().toISOString());
      };
      if (output.status === "rejected") {
        // Google created nothing: close this attempt as failed so it never blocks a new approval.
        await advance("failed", null, null, "provider_rejected");
        if (output.category === "action_needed") session.current?.forgetSession();
        setError(output.reason);
        return;
      }
      if (output.status === "unknown_remote_outcome") {
        await advance("unknown_remote_outcome", output.remoteId);
      } else {
        await advance("accepted_unverified", output.remoteId);
        await advance(output.status === "verified" ? "verified" : "verification_failed",
          output.remoteId, output.status === "verified" ? output.sha256 : null);
      }
      setResult(output);
    } catch (cause) {
      // Any failure after a remote POST might have created a file. Never offer an automatic retry.
      setError(journalRecord.current?.status === "uploading" || journalRecord.current?.status === "accepted_unverified"
        ? "The Drive export may already exist. Select 'Check prior Drive exports' before approving a new upload."
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
        <button type="button" className="secondary-button"
          disabled={busy || view.phase === "authorizing"} onClick={authorize}>
          {view.phase === "authorizing" ? "Waiting for Google…" : "Authorize Drive"}
        </button>
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
        {view.phase !== "not_connected" && (
          <button type="button" className="surface-link-button" disabled={busy} onClick={() => {
            session.current?.forgetSession(); resetReview(); clearRecovery();
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
      {unresolved.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3" data-testid="drive-unresolved-recovery">
          <p>
            Sojourner could not confirm whether these earlier uploads reached Google Drive. They keep blocking
            new uploads of this resume so that a second copy is never created silently.
          </p>
          {unresolved.map(item => (
            <div key={item.operationId} className="mt-2 flex items-center justify-between gap-3">
              <span className="break-all">{item.fileName} ({STATUS_LABEL[item.status] ?? item.status})</span>
              <button type="button" className="secondary-button" disabled={busy}
                onClick={() => setAbandonTarget(item.operationId)}>Abandon this attempt…</button>
            </div>
          ))}
          {abandonTarget && unresolved.some(item => item.operationId === abandonTarget) && (
            <div className="mt-3 rounded-lg border border-[var(--color-error)] p-3" data-testid="drive-abandon-warning">
              <p>
                <strong>Warning:</strong> Sojourner cannot tell whether Google Drive already holds a copy from this
                attempt. Abandoning only stops tracking it on this device: nothing in Google Drive is deleted, the
                receipt is kept, and a new export may create a second copy. Check My Drive before you continue.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="primary-button" disabled={busy}
                  onClick={() => void abandonUnresolved(abandonTarget)}>Abandon attempt</button>
                <button type="button" className="secondary-button" disabled={busy}
                  onClick={() => setAbandonTarget(null)}>Keep it blocked</button>
              </div>
            </div>
          )}
        </div>
      )}
      {recoveryMessage && <p role="status" className="mt-3">{recoveryMessage}</p>}
      {error && <p role="alert" className="mt-3 text-[var(--color-error)]">{error}</p>}
    </div>
  );
}
