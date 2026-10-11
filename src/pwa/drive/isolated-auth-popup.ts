/**
 * Browser adapter for the separately hosted Google OAuth helper (#264).
 * Experimental: no app UI or Drive operation is wired to this module.
 * No Google JS is executed on the Job Ranger workspace origin.
 */
import {
  assertIsolatedAuthOrigin,
  ISOLATED_DRIVE_AUTH_PROTOCOL,
  ISOLATED_DRIVE_AUTH_VERSION,
  ISOLATED_DRIVE_SCOPE,
  IsolatedDriveAuthReceiver,
  makeIsolatedAuthAttempt,
  type IsolatedAuthResult,
} from "./isolated-auth-channel.ts";

export const ISOLATED_DRIVE_AUTH_READY = "job-ranger:isolated-drive-auth-ready";
export const ISOLATED_DRIVE_AUTH_INIT = "job-ranger:isolated-drive-auth-init";
export const ISOLATED_DRIVE_AUTH_INITIALIZED = "job-ranger:isolated-drive-auth-initialized";

export type IsolatedDriveAuthView = {
  phase: "not_connected" | "authorizing" | "authorized_unverified" | "action_needed";
  message: string;
  expiresAt: number | null;
};

const INITIAL_VIEW: IsolatedDriveAuthView = {
  phase: "not_connected", message: "Not connected to Google Drive.", expiresAt: null,
};

/**
 * Opens the helper synchronously inside the user's click handler. No awaits.
 * Keeps the returned bearer token in this private object only, not UI state.
 */
export class IsolatedDriveAuthPopup {
  private token: string | null = null;
  private expiry = 0;
  private current: {
    popup: Window;
    receiver: IsolatedDriveAuthReceiver;
    nonce: string;
  } | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private closePoll: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private view: IsolatedDriveAuthView = { ...INITIAL_VIEW };
  private readonly host: Window;
  private readonly helperOrigin: string;
  private readonly onView: (view: IsolatedDriveAuthView) => void;

  constructor(helperOrigin: string, onView: (view: IsolatedDriveAuthView) => void, host: Window = window) {
    this.host = host;
    this.helperOrigin = assertIsolatedAuthOrigin(helperOrigin);
    if (this.helperOrigin === assertIsolatedAuthOrigin(host.location.origin)) {
      throw new Error("OAuth helper must use a separate origin from Career Ops.");
    }
    this.onView = onView;
  }

  snapshot(): IsolatedDriveAuthView {
    if (this.view.phase === "authorized_unverified" && Date.now() >= this.expiry) {
      this.forgetSession("Google authorization expired. Reconnect to continue.");
    }
    return { ...this.view };
  }

  private publish(next: IsolatedDriveAuthView): void {
    this.view = next;
    if (!this.disposed) this.onView({ ...next });
  }

  private stopPending(closePopup: boolean): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    if (this.closePoll !== null) clearInterval(this.closePoll);
    this.deadline = null;
    this.closePoll = null;
    if (this.current) {
      this.current.receiver.cancel();
      if (closePopup) {
        try { this.current.popup.close(); } catch { /* Window may have navigated. */ }
      }
    }
    this.current = null;
    this.host.removeEventListener("message", this.handleMessage);
  }

  private fail(message: string): void {
    this.stopPending(true);
    this.token = null;
    this.expiry = 0;
    this.publish({ phase: "action_needed", message, expiresAt: null });
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const current = this.current;
    if (!current || event.origin !== this.helperOrigin || event.source !== current.popup) return;
    const raw: unknown = event.data;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const data = raw as Record<string, unknown>;
      if (data.protocol === ISOLATED_DRIVE_AUTH_READY && data.version === ISOLATED_DRIVE_AUTH_VERSION) {
        // The nonce never enters the popup's URL or browser history.
        try {
          current.popup.postMessage({
            protocol: ISOLATED_DRIVE_AUTH_INIT,
            version: ISOLATED_DRIVE_AUTH_VERSION,
            nonce: current.nonce,
            requestingOrigin: this.host.location.origin,
            scope: ISOLATED_DRIVE_SCOPE,
          }, this.helperOrigin);
        } catch {
          // A cross-origin navigation or changed opener boundary can revoke
          // access to the popup. Fail now rather than leaving a false spinner.
          this.fail("The authorization window lost its secure connection. Close it and retry.");
        }
        return;
      }
      if (data.protocol === ISOLATED_DRIVE_AUTH_INITIALIZED &&
          data.version === ISOLATED_DRIVE_AUTH_VERSION && data.nonce === current.nonce) {
        this.publish({ phase: "authorizing", message: "Continue authorization in the separate Google window.", expiresAt: null });
        return;
      }
      if (data.protocol !== ISOLATED_DRIVE_AUTH_PROTOCOL) return;
    }
    const result: IsolatedAuthResult | null = current.receiver.take(event);
    if (!result) return;
    if (result.status === "authorized_unverified") {
      this.stopPending(true);
      this.token = result.token;
      this.expiry = result.expiresAt;
      this.publish({
        phase: "authorized_unverified",
        message: "Google authorized Drive access for this browser session. No files were uploaded.",
        expiresAt: result.expiresAt,
      });
    } else {
      const messages: Record<string, string> = {
        denied: "Google Drive permission was denied.",
        cancelled: "Google Drive authorization was cancelled.",
        provider_error: "Google Drive authorization could not complete.",
        invalid_message: "The Google authorization response failed security validation.",
        timeout: "Google Drive authorization timed out.",
      };
      this.fail(messages[result.reason]);
    }
  };

  /** Invoke directly from a trusted user click, with no preceding await. */
  connectFromUserClick(): void {
    if (this.disposed) throw new Error("OAuth session is disposed.");
    if (this.current) return;
    this.token = null;
    this.expiry = 0;
    this.host.addEventListener("message", this.handleMessage);
    // No noopener: the two-origin, exact-source messaging contract needs
    // the WindowProxy. COOP must be deliberately reviewed in both origins.
    let popup: Window | null;
    try {
      popup = this.host.open(this.helperOrigin + "/", "_blank", "popup,width=500,height=680");
    } catch {
      // Browser policies may throw, not merely return null. Listener and
      // pending credentials must be cleaned up on either failure mode.
      this.fail("The browser could not open the authorization window. Check popup permissions and retry.");
      return;
    }
    if (!popup) {
      this.fail("The browser blocked the authorization window. Allow popups and retry.");
      return;
    }
    try {
      const attempt = makeIsolatedAuthAttempt({
        appOrigin: this.host.location.origin,
        helperOrigin: this.helperOrigin,
        popup: { identity: popup },
        openedAt: Date.now(),
      });
      this.current = { popup, receiver: new IsolatedDriveAuthReceiver(attempt), nonce: attempt.nonce };
      this.publish({ phase: "authorizing", message: "Open the Google Drive authorization window to continue.", expiresAt: null });
      this.deadline = setTimeout(() => this.fail("Google authorization timed out."), 3 * 60_000);
      this.closePoll = setInterval(() => {
        try {
          if (popup.closed) this.fail("The Google authorization window was closed.");
        } catch {
          this.fail("The Google authorization window is no longer accessible.");
        }
      }, 500);
    } catch {
      try { popup.close(); } catch { /* Browser has already closed it. */ }
      this.fail("The isolated authorization window could not start.");
    }
  }

  forgetSession(message = "This browser session's Google token was discarded."): void {
    this.stopPending(true);
    this.token = null;
    this.expiry = 0;
    this.publish({ phase: "action_needed", message, expiresAt: null });
  }

  /** No caller exists yet; upload consent will be governed separately in #257. */
  async withTokenForUserAction<T>(action: (token: string) => Promise<T>): Promise<T> {
    if (this.snapshot().phase !== "authorized_unverified" || !this.token) {
      throw new Error("Authorize Google Drive before this user-controlled action.");
    }
    return action(this.token);
  }

  dispose(): void {
    this.stopPending(true);
    this.token = null;
    this.expiry = 0;
    this.disposed = true;
  }
}
