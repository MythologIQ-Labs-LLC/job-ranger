import { useEffect, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { IS_DEMO_FLAVOR } from "../demo/flavor";
import type { DriveAuthView } from "../pwa/drive/drive-auth-view";
import { PwaDriveExportPort } from "../pwa/drive/pwa-drive-port";
import { ElectronDriveExportPort, type DriveExportPort } from "../services/drive-export-port";
import type { DriveExportOutcome, DriveJournalSummary } from "../shared/drive/drive-export-flow";
import type { RuntimeKind } from "../shared/runtime";

declare const __SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN__: string | undefined;
// PWA: Google authorization runs ONLY on this separately hosted helper origin (#264);
// Google's sign-in script is never loaded next to Career Ops data.
const HELPER_ORIGIN = typeof __SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN__ === "string"
  ? __SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN__.trim() : "";

const STATUS_LABEL: Partial<Record<DriveJournalSummary["status"], string>> = {
  uploading: "upload started; outcome unknown",
  unknown_remote_outcome: "outcome unknown",
  accepted_unverified: "uploaded; not verified",
  verification_failed: "Drive copy did not match the approved PDF",
};

/**
 * The runtime's Drive port, or null where Drive must not exist: an unconfigured PWA
 * build and the fictional demo never advertise or contact Google, and the Windows app
 * hides the panel when its build has no Google Desktop OAuth client.
 */
function createDrivePort(runtimeKind: RuntimeKind): DriveExportPort | null {
  if (IS_DEMO_FLAVOR) return null;
  if (runtimeKind === "electron") return new ElectronDriveExportPort();
  return HELPER_ORIGIN ? new PwaDriveExportPort(HELPER_ORIGIN) : null;
}

interface Review { proposalId: string; name: string; label: string; size: number; digest: string }

export function GoogleDriveResumeExport({ artifactId, version, runtimeKind = "web" }: {
  artifactId: string; version: number; runtimeKind?: RuntimeKind;
}) {
  const portRef = useRef<DriveExportPort | null | undefined>(undefined);
  if (portRef.current === undefined) portRef.current = createDrivePort(runtimeKind);
  const port = portRef.current;
  const [view, setView] = useState<DriveAuthView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<DriveExportOutcome | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [preparedPending, setPreparedPending] = useState<DriveJournalSummary[]>([]);
  const [unresolved, setUnresolved] = useState<DriveJournalSummary[]>([]);
  const [abandonTarget, setAbandonTarget] = useState<string | null>(null);
  /** The proposal the user is reviewing; only its exact bytes, account and destination can be approved. */
  const reviewed = useRef<string | null>(null);

  useEffect(() => {
    if (!port) return;
    const unsubscribe = port.subscribe(setView);
    const timer = window.setInterval(() => port.refresh(), 10_000);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      port.release();
    };
  }, [port]);

  if (!port || !view) return null;

  const resetReview = () => {
    if (reviewed.current) port.discard(reviewed.current);
    reviewed.current = null;
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
    // Must run directly in the click handler (PWA popup), never after an await.
    port.authorize();
  };
  const prepare = async () => {
    setError(null);
    resetReview();
    setBusy(true);
    try {
      const prepared = await port.prepare(artifactId, version);
      reviewed.current = prepared.proposalId;
      setReview(prepared);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The resume could not be prepared for Drive.");
    } finally { setBusy(false); }
  };

  /** Read-only reconciliation of earlier operations; NEVER uploads (DriveExportFlow.reconcile). */
  const reconcile = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRecoveryMessage(null);
    clearRecovery();
    resetReview();
    try {
      const outcome = await port.reconcile(artifactId);
      setPreparedPending(outcome.prepared);
      setUnresolved(outcome.unresolved);
      setRecoveryMessage(outcome.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not safely reconcile the previous Drive export.");
    } finally { setBusy(false); }
  };

  // A prepared receipt has not crossed the durable uploading boundary. The
  // compare-and-swap refuses cancellation if another tab already began upload.
  const cancelPrepared = async (operationId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await port.cancelPrepared(artifactId, operationId);
      setPreparedPending(prior => prior.filter(item => item.operationId !== operationId));
      setRecoveryMessage(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reservation cannot be safely cancelled.");
    } finally { setBusy(false); }
  };

  /**
   * Explicit, warned user decision only: stop tracking an attempt Sojourner cannot
   * resolve. The receipt is kept as "abandoned"; nothing in Drive is deleted.
   */
  const abandonUnresolved = async (operationId: string) => {
    if (busy || abandonTarget !== operationId) return;
    setBusy(true);
    setError(null);
    try {
      const message = await port.abandon(artifactId, operationId);
      setUnresolved(prior => prior.filter(item => item.operationId !== operationId));
      setAbandonTarget(null);
      setRecoveryMessage(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export could not be safely abandoned.");
    } finally { setBusy(false); }
  };

  const confirmUpload = async () => {
    const proposalId = reviewed.current;
    if (!proposalId || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    reviewed.current = null;
    setReview(null);
    try {
      setResult(await port.confirm(proposalId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Drive export could not be completed. Your local resume is unchanged.");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--color-border)] p-3 text-sm" data-testid="drive-resume-export">
      <div className="flex items-center gap-2 font-semibold"><CloudUpload className="h-4 w-4" /> Save PDF v{version} to Google Drive</div>
      <p className="mt-1 text-[var(--color-text-secondary)]">
        Optional. You approve one verified PDF and its destination. Your local workspace remains unchanged.
        Google receives the document only after confirmation. Files are saved to the top level of My Drive.
      </p>
      {port.labels.note && <p className="mt-1 text-[var(--color-text-secondary)]">{port.labels.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="secondary-button"
          disabled={busy || view.phase === "authorizing"} onClick={authorize}>
          {view.phase === "authorizing" ? port.labels.authorizing : port.labels.authorize}
        </button>
        {view.phase === "authorizing" && port.labels.cancelAuthorization && (
          <button type="button" className="surface-link-button" onClick={() => port.cancelAuthorization?.()}>
            {port.labels.cancelAuthorization}
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
        {view.phase !== "not_connected" && (
          <button type="button" className="surface-link-button" disabled={busy} onClick={() => {
            port.forget(); resetReview(); clearRecovery();
          }}>{port.labels.forget}</button>
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
