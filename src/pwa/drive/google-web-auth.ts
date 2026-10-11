/**
 * Browser-only, user-present Google Drive authorization.
 *
 * This is an auth-only prototype: authorization is not proof of Drive readiness
 * or permission to upload Career Ops data. No token is written to storage,
 * transmitted to an app backend, returned in a UI snapshot, or logged.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type DriveAuthPhase =
  | "not_connected"
  | "authorizing"
  | "authorized_unverified"
  | "action_needed";

export interface DriveAuthView {
  phase: DriveAuthPhase;
  message: string;
  expiresAt: number | null;
}

export interface GoogleTokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number | string;
  error?: string;
}

export interface GooglePopupError {
  type?: string;
}

export interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

export interface GoogleOAuthTokenApi {
  initTokenClient(options: {
    client_id: string;
    scope: string;
    // Google GIS defaults to true, which can attach unrelated past grants.
    include_granted_scopes: false;
    callback: (response: GoogleTokenResponse) => void;
    error_callback: (error: GooglePopupError) => void;
  }): GoogleTokenClient;
  revoke?(token: string, callback: (result: { successful?: boolean }) => void): void;
}

const RESPONSE_TIMEOUT_MS = 3 * 60 * 1000;
const EXPIRY_SKEW_MS = 30 * 1000;

export class DriveWebAuthorization {
  private accessToken: string | null = null;
  private expiry = 0;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private view: DriveAuthView = {
    phase: "not_connected",
    message: "Not connected to Google Drive.",
    expiresAt: null,
  };

  private readonly clientId: string;
  private readonly onChange: (view: DriveAuthView) => void;
  private readonly now: () => number;

  constructor(
    clientId: string,
    onChange: (view: DriveAuthView) => void = () => {},
    now: () => number = Date.now,
  ) {
    this.clientId = clientId;
    this.onChange = onChange;
    this.now = now;
  }

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

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private reset(message: string): void {
    this.clearTimer();
    this.attempt += 1; // Discard callbacks from an earlier/closed popup.
    this.accessToken = null;
    this.expiry = 0;
    this.publish({ phase: "action_needed", message, expiresAt: null });
  }

  /** Must be called directly in the click handler, not after an await. */
  authorize(google: GoogleOAuthTokenApi): void {
    if (this.disposed) throw new Error("Authorization session is closed.");
    if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(this.clientId)) {
      this.reset("Google Drive authorization is not configured.");
      return;
    }
    if (this.view.phase === "authorizing") return;

    this.clearTimer();
    this.accessToken = null;
    this.expiry = 0;
    const id = ++this.attempt;
    this.publish({
      phase: "authorizing",
      message: "Complete or cancel authorization in the Google popup.",
      expiresAt: null,
    });

    const isCurrent = () => !this.disposed && this.attempt === id;
    const fail = (message: string) => { if (isCurrent()) this.reset(message); };

    try {
      const client = google.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_FILE_SCOPE,
        include_granted_scopes: false,
        callback: (response) => {
          if (!isCurrent()) return;
          if (response.error) {
            fail(response.error === "access_denied"
              ? "Google Drive permission was denied. Your local data is unchanged."
              : "Google authorization was not completed.");
            return;
          }
          // Fail closed: unexpected additional scopes cannot silently expand our permissions.
          const granted = (response.scope ?? "").trim().split(/\s+/).filter(Boolean);
          const rawExpiry = Number(response.expires_in);
          if (granted.length !== 1 || granted[0] !== DRIVE_FILE_SCOPE ||
              typeof response.access_token !== "string" || !response.access_token.trim() ||
              !Number.isFinite(rawExpiry) || rawExpiry <= 30) {
            fail("Google did not return the expected Drive-only authorization.");
            return;
          }
          this.clearTimer();
          this.accessToken = response.access_token;
          this.expiry = this.now() + rawExpiry * 1000 - EXPIRY_SKEW_MS;
          this.publish({
            phase: "authorized_unverified",
            message: "Google authorized Drive access for this session. No files were uploaded.",
            expiresAt: this.expiry,
          });
        },
        error_callback: (error) => {
          fail(error.type === "popup_closed"
            ? "Google authorization was cancelled. Your local data is unchanged."
            : error.type === "popup_failed_to_open"
              ? "The browser blocked the Google popup. Allow popups and try again."
              : "Google authorization could not open. Try again.");
        },
      });
      this.timer = setTimeout(() => fail("Google authorization timed out. Try again."), RESPONSE_TIMEOUT_MS);
      client.requestAccessToken();
    } catch {
      fail("Google authorization could not start. Try again.");
    }
  }

  /** Local only. This does not claim that Google's stored grant is revoked. */
  forgetSession(): void {
    if (this.disposed) return;
    this.reset("This browser session's Google token was discarded. Google account permissions may remain.");
  }

  /**
   * Token is only exposed to an explicit, future user-approved Drive operation.
   * Never copy to React state, persistent storage, logs or agent responses.
   */
  async withTokenForUserAction<T>(action: (token: string) => Promise<T>): Promise<T> {
    const state = this.snapshot();
    if (state.phase !== "authorized_unverified" || !this.accessToken) {
      throw new Error("Authorize Google Drive before this action.");
    }
    return action(this.accessToken);
  }

  dispose(): void {
    this.clearTimer();
    this.attempt += 1;
    this.accessToken = null;
    this.expiry = 0;
    this.disposed = true;
  }
}
