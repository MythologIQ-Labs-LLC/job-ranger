/**
 * Explicit user-initiated isolated Google Drive OAuth bridge (#264).
 * This module NEVER loads GIS. The remote helper must use its own HTTPS origin,
 * and tokens exist only in this browser session's private fields.
 */
import { DriveHelperResponseGate } from "./oauth-helper-response-contract.ts";
import type { DriveAuthView } from "./google-web-auth";

const EXPIRY_SKEW = 30_000;
const RESPONSE_TIMEOUT = 180_000;

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function validHelperOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.origin === origin &&
      url.pathname === "/" && !url.search && !url.hash &&
      !url.username && !url.password && origin !== window.location.origin;
  } catch { return false; }
}

export class IsolatedDriveAuthorization {
  private accessToken: string | null = null;
  private expiry = 0;
  private disposed = false;
  private popup: Window | null = null;
  private gate: DriveHelperResponseGate | null = null;
  private listener: ((event: MessageEvent) => void) | null = null;
  private timeout: number | null = null;
  private closedCheck: number | null = null;
  /** Discards the token the moment it expires, not only when the next status check runs. */
  private expiryTimer: number | null = null;
  private view: DriveAuthView = {
    phase: "not_connected", message: "Google Drive is not connected.", expiresAt: null,
  };

  constructor(
    private readonly helperOrigin: string,
    private readonly onChange: (view: DriveAuthView) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  snapshot(): DriveAuthView {
    if (this.view.phase === "authorized_unverified" && this.now() >= this.expiry) {
      this.reset("Google authorization expired. Authorize again to continue.");
    }
    return { ...this.view };
  }

  private publish(view: DriveAuthView): void {
    this.view = view;
    if (!this.disposed) this.onChange({ ...view });
  }

  private clearAttempt(closePopup = true): void {
    if (this.listener) window.removeEventListener("message", this.listener);
    if (this.timeout !== null) window.clearTimeout(this.timeout);
    if (this.closedCheck !== null) window.clearInterval(this.closedCheck);
    this.gate?.invalidate();
    if (closePopup && this.popup) {
      try { this.popup.close(); } catch { /* window was already closed */ }
    }
    this.popup = null;
    this.gate = null;
    this.listener = null;
    this.timeout = null;
    this.closedCheck = null;
  }

  private clearExpiry(): void {
    if (this.expiryTimer !== null) window.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private reset(message: string): void {
    this.clearAttempt();
    this.clearExpiry();
    this.accessToken = null;
    this.expiry = 0;
    this.publish({ phase: "action_needed", message, expiresAt: null });
  }

  /** Must run synchronously in the user's button click, before any await. */
  authorize(): void {
    if (this.disposed) throw new Error("Authorization session is closed.");
    if (this.view.phase === "authorizing") return;
    if (!validHelperOrigin(this.helperOrigin)) {
      this.reset("Google authorization helper is not configured on a distinct HTTPS origin.");
      return;
    }
    this.clearAttempt();
    this.clearExpiry();
    this.accessToken = null;
    this.expiry = 0;
    const id = nonce();
    let popup: Window | null;
    try {
      popup = window.open(`${this.helperOrigin}/#nonce=${id}`, "_blank", "popup,width=520,height=640");
    } catch {
      popup = null;
    }
    if (!popup) {
      this.reset("The browser blocked the Google authorization window. Allow popups and retry.");
      return;
    }
    this.popup = popup;
    this.gate = new DriveHelperResponseGate(
      this.helperOrigin, popup, id, this.now() + RESPONSE_TIMEOUT, this.now,
    );
    this.publish({
      phase: "authorizing",
      message: "In the separate authorization window, select Continue with Google.",
      expiresAt: null,
    });
    this.listener = event => {
      const accepted = this.gate?.accept(event) ?? null;
      if (!accepted) return;
      this.clearAttempt();
      this.accessToken = accepted.accessToken;
      this.expiry = accepted.expiresAt - EXPIRY_SKEW;
      this.publish({
        phase: "authorized_unverified",
        message: "Google Drive access authorized. No document was uploaded.",
        expiresAt: this.expiry,
      });
      this.expiryTimer = window.setTimeout(() => {
        this.expiryTimer = null;
        if (this.view.phase === "authorized_unverified") this.reset("Google authorization expired. Authorize again to continue.");
      }, Math.max(0, this.expiry - this.now()));
    };
    window.addEventListener("message", this.listener);
    this.timeout = window.setTimeout(() => {
      this.reset("Google authorization timed out. Try again.");
    }, RESPONSE_TIMEOUT);
    this.closedCheck = window.setInterval(() => {
      if (this.popup?.closed) this.reset("Google authorization window was closed before completion.");
    }, 500);
  }

  forgetSession(): void {
    if (!this.disposed) this.reset("This browser session's Google token was discarded.");
  }

  async withTokenForUserAction<T>(action: (token: string) => Promise<T>): Promise<T> {
    if (this.snapshot().phase !== "authorized_unverified" || !this.accessToken) {
      throw new Error("Authorize Google Drive before this action.");
    }
    return action(this.accessToken);
  }

  dispose(): void {
    this.clearAttempt();
    this.clearExpiry();
    this.accessToken = null;
    this.expiry = 0;
    this.disposed = true;
  }
}
