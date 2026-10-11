/**
 * UNWIRED SECURITY SPIKE (#264). Browser-only, two-origin Google OAuth
 * message validation. There is intentionally NO popup opener, GIS loader,
 * Drive API call, app state update, service worker, or token persistence here.
 *
 * The PWA's high-sensitivity Career Ops origin must never execute Google's
 * third-party script. Only a separately hosted helper origin may use GIS.
 *
 * This pure receiver verifies a returned result, NOT human export consent.
 */
export const ISOLATED_DRIVE_AUTH_PROTOCOL = "job-ranger:isolated-drive-auth-result";
export const ISOLATED_DRIVE_AUTH_VERSION = 1;
export const ISOLATED_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const ISOLATED_DRIVE_ATTEMPT_MS = 3 * 60_000;
const MAX_PROVIDER_TOKEN_SECONDS = 7200;
const EXPIRY_SKEW_MS = 30_000;

export type IsolatedAuthResult =
  | { status: "authorized_unverified"; token: string; expiresAt: number }
  | { status: "action_needed"; reason: "denied" | "cancelled" | "provider_error" | "invalid_message" | "timeout" };

export interface AuthWindowReference {
  /** The exact WindowProxy returned by the one user-initiated window.open call. */
  readonly identity: object;
}

export interface IsolatedAuthAttempt {
  readonly helperOrigin: string;
  readonly appOrigin: string;
  readonly popup: AuthWindowReference;
  readonly nonce: string;
  readonly expiresAt: number;
}

export interface AuthMessageEvent {
  readonly origin: string;
  readonly source: object | null;
  readonly data: unknown;
}

/**
 * Enforce HTTPS for remote auth helpers. Locally, only loopback hostnames
 * may use HTTP. A path (including /), credentials, query, or fragment is NOT
 * part of an origin configuration and must not sneak into the origin policy.
 */
export function assertIsolatedAuthOrigin(raw: string): string {
  const value = new URL(raw);
  const allowedHttp =
    value.protocol === "http:" && (value.hostname === "localhost" || value.hostname === "127.0.0.1" || value.hostname === "[::1]");
  if (!allowedHttp && value.protocol !== "https:") {
    throw new Error("Google auth helper requires HTTPS or local loopback HTTP.");
  }
  if (value.username || value.password || value.pathname !== "/" || value.search || value.hash ||
      value.origin !== raw) {
    throw new Error("Use an exact origin without path, query, hash or credentials.");
  }
  return value.origin;
}

function isExactNonce(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{48}$/.test(value);
}

function isPlainMessage(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Cryptographically independent for each popup attempt, never from Math.random. */
export function newIsolatedAuthNonce(random: Pick<Crypto, "getRandomValues"> = crypto): string {
  const bytes = new Uint8Array(24);
  random.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function makeIsolatedAuthAttempt(input: {
  helperOrigin: string;
  appOrigin: string;
  popup: AuthWindowReference;
  openedAt: number;
}, random: Pick<Crypto, "getRandomValues"> = crypto): IsolatedAuthAttempt {
  const helperOrigin = assertIsolatedAuthOrigin(input.helperOrigin);
  const appOrigin = assertIsolatedAuthOrigin(input.appOrigin);
  if (helperOrigin === appOrigin) {
    throw new Error("Google auth helper must be isolated from the Career Ops origin.");
  }
  if (!input.popup?.identity || !Number.isFinite(input.openedAt)) {
    throw new Error("Missing browser popup identity or start time.");
  }
  // The caller cannot supply a reused/low-entropy nonce. Production always
  // uses Web Crypto; injecting a randomness source is for deterministic tests.
  const nonce = newIsolatedAuthNonce(random);
  if (!isExactNonce(nonce)) throw new Error("Invalid generated nonce.");
  return Object.freeze({
    helperOrigin, appOrigin, popup: Object.freeze({ identity: input.popup.identity }), nonce,
    expiresAt: input.openedAt + ISOLATED_DRIVE_ATTEMPT_MS,
  });
}

/**
 * A single-use message receiver. On valid provider success the token is
 * returned exactly once. Callers may keep it only in a private in-memory
 * auth session, never in URLs, logs, persisted stores or UI state.
 *
 * A message from a different source/origin is ignored. A message from the
 * actual helper window with an invalid protocol/nonce consumes the attempt
 * as a security error, preventing replay or downgrade. The trusted opener
 * MUST show a fresh human action before any archive upload.
 */
export class IsolatedDriveAuthReceiver {
  private consumed = false;

  private readonly attempt: IsolatedAuthAttempt;
  private readonly now: () => number;

  constructor(attempt: IsolatedAuthAttempt, now: () => number = Date.now) {
    this.attempt = attempt;
    this.now = now;
  }

  get finished(): boolean {
    return this.consumed;
  }

  take(event: AuthMessageEvent): IsolatedAuthResult | null {
    if (this.consumed) return null;
    if (this.now() >= this.attempt.expiresAt) {
      this.consumed = true;
      return { status: "action_needed", reason: "timeout" };
    }
    if (event.origin !== this.attempt.helperOrigin || event.source !== this.attempt.popup.identity) {
      return null;
    }

    this.consumed = true;
    const data = event.data;
    if (!isPlainMessage(data) ||
        data.protocol !== ISOLATED_DRIVE_AUTH_PROTOCOL ||
        data.version !== ISOLATED_DRIVE_AUTH_VERSION ||
        data.nonce !== this.attempt.nonce ||
        data.requestingOrigin !== this.attempt.appOrigin) {
      return { status: "action_needed", reason: "invalid_message" };
    }
    if (data.kind === "denied" || data.kind === "cancelled" || data.kind === "provider_error") {
      return { status: "action_needed", reason: data.kind };
    }
    if (data.kind !== "authorized" ||
        typeof data.token !== "string" || !data.token.trim() ||
        typeof data.scope !== "string" ||
        data.scope !== ISOLATED_DRIVE_SCOPE ||
        typeof data.expiresInSeconds !== "number" ||
        !Number.isFinite(data.expiresInSeconds) ||
        data.expiresInSeconds <= 30 ||
        data.expiresInSeconds > MAX_PROVIDER_TOKEN_SECONDS) {
      return { status: "action_needed", reason: "invalid_message" };
    }
    return {
      status: "authorized_unverified",
      token: data.token,
      expiresAt: this.now() + data.expiresInSeconds * 1000 - EXPIRY_SKEW_MS,
    };
  }

  cancel(): void {
    this.consumed = true;
  }
}
