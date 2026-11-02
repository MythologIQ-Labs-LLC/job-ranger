/**
 * PWA implementation of the Drive export port (#314): the isolated OAuth helper
 * (#264, volatile access token in this page only), the IndexedDB journal, and the
 * shared DriveExportFlow with the browser fetch. Behaviour is unchanged from the
 * original in-component implementation (PRs #315 and #356).
 */
import { getDesktopApi } from "../../services/api";
import type { DriveExportPort, DriveExportPortLabels } from "../../services/drive-export-port";
import { DriveExportFlow } from "../../shared/drive/drive-export-flow";
import type { DriveExportOutcome, DriveExportReview, DriveReconcileResult } from "../../shared/drive/drive-export-flow";
import type { DriveAuthView } from "./drive-auth-view";
import { BrowserDriveExportJournal } from "./drive-journal-idb";
import { IsolatedDriveAuthorization } from "./isolated-drive-auth";

const INIT: DriveAuthView = { phase: "not_connected", message: "Google Drive is not connected in this browser session.", expiresAt: null };

export class PwaDriveExportPort implements DriveExportPort {
  readonly labels: DriveExportPortLabels = {
    authorize: "Authorize Drive",
    authorizing: "Waiting for Google…",
    forget: "Forget authorization",
  };
  private session: IsolatedDriveAuthorization | null = null;
  private journal: BrowserDriveExportJournal | null = null;
  private view: DriveAuthView = INIT;
  private readonly listeners = new Set<(view: DriveAuthView | null) => void>();
  private readonly flow: DriveExportFlow;

  constructor(private readonly helperOrigin: string) {
    this.flow = new DriveExportFlow({
      withToken: (work) => {
        if (!this.session) throw new Error("Authorize Google Drive first.");
        return this.session.withTokenForUserAction(work);
      },
      journal: () => (this.journal ??= new BrowserDriveExportJournal()),
      readArtifact: (artifactId) => getDesktopApi().resume.readVerifiedArtifactForExport(artifactId),
      onUploadAuthorizationRejected: () => this.session?.forgetSession(),
    });
  }

  private publish(view: DriveAuthView): void {
    this.view = view;
    for (const listener of this.listeners) listener(view);
  }

  subscribe(listener: (view: DriveAuthView | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => { this.listeners.delete(listener); };
  }

  /** Must run directly in the click handler (popup), never after an await. */
  authorize(): void {
    this.session ??= new IsolatedDriveAuthorization(this.helperOrigin, (view) => this.publish(view));
    this.session.authorize();
  }

  forget(): void {
    this.session?.forgetSession();
    this.flow.discardAll();
  }

  refresh(): void {
    this.session?.snapshot();
  }

  prepare(artifactId: string, version: number): Promise<DriveExportReview> {
    return this.flow.prepare(artifactId, version);
  }

  discard(proposalId: string): void {
    this.flow.discard(proposalId);
  }

  confirm(proposalId: string): Promise<DriveExportOutcome> {
    return this.flow.confirm(proposalId);
  }

  reconcile(artifactId: string): Promise<DriveReconcileResult> {
    return this.flow.reconcile(artifactId);
  }

  cancelPrepared(artifactId: string, operationId: string): Promise<string> {
    return this.flow.cancelPrepared(artifactId, operationId);
  }

  abandon(artifactId: string, operationId: string): Promise<string> {
    return this.flow.abandon(artifactId, operationId);
  }

  /** The access token never outlives the panel. */
  release(): void {
    this.session?.dispose();
    this.session = null;
    this.flow.discardAll();
    this.view = INIT;
  }
}
