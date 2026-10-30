/**
 * Proposed cross-origin Google OAuth helper response validator (#264).
 * Pure, opt-in protocol primitive. NOT wired into the production PWA.
 * The caller must open a distinct-origin helper using an actual user gesture,
 * retain the exact WindowProxy, and never persist the resulting access token.
 */
export const DRIVE_HELPER_PROTOCOL = 1;
export const DRIVE_HELPER_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_HELPER_RESPONSE = "sojourner.drive-oauth.response";
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const TOKEN_LIMIT = 8192;

export interface DriveHelperReply {
  version: number;
  type: string;
  nonce: string;
  scope: string;
  accessToken: string;
  expiresIn: number;
}

export interface DriveHelperMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

export class DriveHelperResponseGate {
  private consumed = false;
  constructor(
    private readonly helperOrigin: string,
    private readonly helperWindow: object,
    private readonly nonce: string,
    private readonly deadline: number,
    private readonly now: () => number = Date.now,
  ) {
    const url = new URL(helperOrigin);
    if (url.origin !== helperOrigin || url.protocol !== "https:" ||
        url.username || url.password || url.pathname !== "/" ||
        url.search || url.hash || !NONCE.test(nonce) ||
        !helperWindow || typeof helperWindow !== "object" ||
        !Number.isFinite(deadline) || deadline <= now()) {
      throw new Error("Invalid isolated OAuth response gate configuration.");
    }
  }

  /** Returns a token once, for the expected response only. Never logs or stores it. */
  accept(event: DriveHelperMessage): { accessToken: string; expiresAt: number } | null {
    if (this.consumed || this.now() >= this.deadline ||
        event.origin !== this.helperOrigin || event.source !== this.helperWindow) return null;
    const data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const reply = data as Partial<DriveHelperReply>;
    if (reply.version !== DRIVE_HELPER_PROTOCOL ||
        reply.type !== DRIVE_HELPER_RESPONSE || reply.nonce !== this.nonce ||
        reply.scope !== DRIVE_HELPER_SCOPE ||
        typeof reply.accessToken !== "string" || !reply.accessToken.trim() ||
        reply.accessToken.length > TOKEN_LIMIT || /[\r\n]/.test(reply.accessToken) ||
        typeof reply.expiresIn !== "number" || !Number.isFinite(reply.expiresIn) ||
        reply.expiresIn <= 30 || reply.expiresIn > 3600) return null;
    this.consumed = true;
    return { accessToken: reply.accessToken, expiresAt: this.now() + reply.expiresIn * 1000 };
  }

  invalidate(): void { this.consumed = true; }
}
