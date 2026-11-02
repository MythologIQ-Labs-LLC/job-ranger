import { randomUUID } from "node:crypto";
import { verifyDriveAccount, type DriveAccount } from "../../../src/shared/drive/google-drive-account.js";
import { GOOGLE_AUTHORIZE_ENDPOINT, GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_REVOKE_ENDPOINT, GOOGLE_TOKEN_ENDPOINT,
  type GoogleClientConfig } from "./google-config.cjs";
import { createOAuthState, createPkcePair, DriveAuthError, startLoopbackReceiver,
  type LoopbackReceiver } from "./google-loopback.cjs";
import type { DriveCredentialStore } from "./drive-credential-store.cjs";

export const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 60_000;
export const MANUAL_REVOKE_HINT = "You can remove Sojourner's access at myaccount.google.com/permissions.";

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
}

interface AccessToken {
  token: string;
  expiresAt: number;
  /** The account the token was issued for; never used for another account. */
  accountId: string;
}

interface ValidatedTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
}

export interface GoogleDesktopAuthOptions {
  client: GoogleClientConfig | null;
  store: DriveCredentialStore;
  /** Egress-guarded fetch (drive-egress.cts). */
  fetch: typeof fetch;
  /** Opens the authorization URL in the system browser (shell.openExternal). */
  openExternal: (url: string) => Promise<void>;
  /** Maps the real Google authorize URL for the system browser (identity outside E2E). */
  browserUrl?: (url: string) => string;
  authorizationTimeoutMs?: number;
  now?: () => number;
}

export function grantedScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_FILE_SCOPE);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/**
 * DriveAuthorization for the Windows app: system-browser OAuth with authorization code,
 * PKCE (S256), an independent single-use state and a one-shot 127.0.0.1 loopback receiver
 * (RFC 8252). Scope drive.file only. The access token lives only in this process's memory;
 * the refresh token goes to the credential store (Windows safeStorage, or session-only).
 */
export class GoogleDesktopAuth {
  private flow: LoopbackReceiver | null = null;
  private connectInFlight = false;
  private flowId: string | null = null;
  /** Incremented by cancel and disconnect so an in-flight sign-in cannot save afterwards. */
  private generation = 0;
  private access: AccessToken | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: GoogleDesktopAuthOptions) {
    this.now = options.now ?? Date.now;
  }

  get configured(): boolean {
    return this.options.client !== null;
  }

  get connecting(): boolean {
    return this.connectInFlight;
  }

  private requireClient(): GoogleClientConfig {
    if (!this.options.client) {
      throw new DriveAuthError("not_configured", "Google Drive is not set up in this build of Sojourner.");
    }
    return this.options.client;
  }

  /** @param flowId caller-chosen id of this sign-in; only a cancel naming it can end it. */
  async connect(flowId: string = randomUUID()): Promise<DriveAccount> {
    const client = this.requireClient();
    // Claimed synchronously, before any await, so a second call cannot start a parallel flow.
    if (this.connectInFlight) {
      throw new DriveAuthError("auth_in_progress", "A Google sign-in is already waiting in your browser. Finish or cancel it first.");
    }
    this.connectInFlight = true;
    this.flowId = flowId;
    const generation = this.generation;
    const cancelled = () => new DriveAuthError("auth_cancelled", "Google Drive sign-in was cancelled.");
    let flow: LoopbackReceiver | null = null;
    try {
      const pkce = createPkcePair();
      const state = createOAuthState();
      flow = await startLoopbackReceiver(state, this.options.authorizationTimeoutMs ?? AUTHORIZATION_TIMEOUT_MS);
      this.flow = flow;
      if (generation !== this.generation) throw cancelled();
      const url = buildAuthorizationUrl({
        clientId: client.clientId, redirectUri: flow.redirectUri, codeChallenge: pkce.challenge, state,
      });
      try {
        await this.options.openExternal(this.options.browserUrl ? this.options.browserUrl(url) : url);
      } catch {
        throw new DriveAuthError("auth_failed", "Sojourner could not open your browser for Google sign-in.");
      }
      const code = await flow.code;
      const tokens = await this.postToken({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        code_verifier: pkce.verifier,
        redirect_uri: flow.redirectUri,
        grant_type: "authorization_code",
      }).catch((error: unknown) => {
        // invalid_grant here means the code, PKCE verifier or redirect URI was rejected.
        if (error instanceof DriveAuthError && error.code === "auth_expired") {
          throw new DriveAuthError("auth_failed", "Google rejected the sign-in exchange. Try connecting again.");
        }
        throw error;
      });
      if (!tokens.refreshToken) {
        await this.discardNewGrant(tokens.accessToken, null);
        throw new DriveAuthError("auth_failed",
          `Google did not grant lasting access. ${MANUAL_REVOKE_HINT} Then connect again.`);
      }
      let account: DriveAccount;
      try {
        account = await verifyDriveAccount(tokens.accessToken, this.options.fetch);
      } catch (error) {
        await this.discardNewGrant(tokens.refreshToken, null);
        throw new DriveAuthError("invalid_response",
          error instanceof Error ? error.message : "Google did not identify the connected account.");
      }
      if (generation !== this.generation) {
        // Cancelled or disconnected while the exchange ran: never resurrect the credential.
        await this.discardNewGrant(tokens.refreshToken, account.accountId);
        throw cancelled();
      }
      const previous = await this.options.store.load();
      if (previous && previous.accountId !== account.accountId) {
        // A different Google account replaces the old one: end the old grant first (best effort).
        await this.revokeToken(previous.refreshToken);
      }
      if (generation !== this.generation) {
        await this.discardNewGrant(tokens.refreshToken, account.accountId);
        throw cancelled();
      }
      if (previous) await this.options.store.clear();
      await this.options.store.save({
        refreshToken: tokens.refreshToken,
        accountId: account.accountId,
        accountLabel: account.label,
        scope: GOOGLE_DRIVE_FILE_SCOPE,
        savedAt: new Date(this.now()).toISOString(),
      });
      if (generation !== this.generation) {
        // Disconnected while the credential was being written: undo it.
        await this.options.store.clear();
        await this.revokeToken(tokens.refreshToken);
        throw cancelled();
      }
      // A new credential invalidates any refresh still running for the previous one.
      this.generation += 1;
      this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt, accountId: account.accountId };
      return account;
    } finally {
      flow?.cancel();
      this.flow = null;
      this.connectInFlight = false;
      this.flowId = null;
    }
  }

  /**
   * Cancels the sign-in in progress. With a flow id, only that sign-in is cancelled:
   * a stale request (for a flow that already ended) returns false.
   */
  cancelConnect(flowId?: string): boolean {
    if (!this.connectInFlight) return false;
    if (flowId !== undefined && flowId !== this.flowId) return false;
    this.generation += 1;
    this.flow?.cancel();
    return true;
  }

  /** Validates a token response: Bearer type, expiry and a drive.file grant (else refused and revoked). */
  private async postToken(form: Record<string, string>): Promise<ValidatedTokens> {
    let response: Response;
    try {
      response = await this.options.fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new DriveAuthError("auth_failed", "Sojourner could not reach Google to finish signing in. Check your connection, then retry.");
    }
    let body: TokenResponse | null = null;
    try { body = await response.json() as TokenResponse; } catch { body = null; }
    if (!response.ok) {
      if (body?.error === "invalid_grant") {
        throw new DriveAuthError("auth_expired", "Google access for Sojourner expired or was revoked. Connect Google Drive again.");
      }
      if (body?.error === "invalid_client" || body?.error === "unauthorized_client") {
        throw new DriveAuthError("not_configured", "Google rejected this build's sign-in configuration.");
      }
      throw new DriveAuthError("auth_failed", "Google could not complete the sign-in. Try again in a moment.");
    }
    if (!body || typeof body.access_token !== "string" || !body.access_token || body.access_token.length > 8192 ||
        /[\r\n]/.test(body.access_token) ||
        typeof body.expires_in !== "number" || !(body.expires_in > 0) ||
        typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer") {
      throw new DriveAuthError("invalid_response", "Google returned an unexpected sign-in response.");
    }
    const refreshToken = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null;
    const scopes = grantedScopes(body.scope);
    // drive.file only: a grant that is missing it, or that carries any broader scope, is refused and revoked.
    if ((form.grant_type === "authorization_code" || body.scope !== undefined) &&
        (!scopes.includes(GOOGLE_DRIVE_FILE_SCOPE) || scopes.some((scope) => scope !== GOOGLE_DRIVE_FILE_SCOPE))) {
      await this.revokeToken(refreshToken ?? body.access_token);
      throw new DriveAuthError("insufficient_scope",
        "Google did not grant access to files Sojourner creates. Connect again and leave that permission selected.");
    }
    return { accessToken: body.access_token, expiresAt: this.now() + body.expires_in * 1000, refreshToken };
  }

  /** The stored account (no network). */
  async account(): Promise<{ accountId: string; label: string } | null> {
    const credential = await this.options.store.load();
    return credential ? { accountId: credential.accountId, label: credential.accountLabel } : null;
  }

  /** Returns a valid access token for the stored account, refreshing it when needed. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    this.requireClient();
    const credential = await this.options.store.load();
    if (!credential) {
      this.access = null;
      throw new DriveAuthError("not_connected", "Connect Google Drive first.");
    }
    if (this.access && this.access.accountId !== credential.accountId) this.access = null;
    if (!forceRefresh && this.access && this.access.expiresAt - REFRESH_MARGIN_MS > this.now()) {
      return this.access.token;
    }
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const client = this.requireClient();
    const credential = await this.options.store.load();
    if (!credential) {
      this.access = null;
      throw new DriveAuthError("not_connected", "Connect Google Drive first.");
    }
    const generation = this.generation;
    let tokens: ValidatedTokens;
    try {
      tokens = await this.postToken({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: credential.refreshToken,
        grant_type: "refresh_token",
      });
    } catch (error) {
      if (!(await this.stillStored(credential.refreshToken))) {
        throw new DriveAuthError("not_connected", "Google Drive was disconnected.");
      }
      if (error instanceof DriveAuthError && (error.code === "auth_expired" || error.code === "insufficient_scope")) {
        // invalid_grant: revoked, expired or password reset. The stored sign-in is useless.
        this.access = null;
        await this.options.store.clear();
      }
      throw error;
    }
    if (generation !== this.generation || !(await this.stillStored(credential.refreshToken))) {
      // Disconnected or switched accounts while refreshing: this token belongs to the old grant.
      throw new DriveAuthError("not_connected", "Google Drive was disconnected.");
    }
    if (tokens.refreshToken && tokens.refreshToken !== credential.refreshToken) {
      // Google rotated the refresh token; the old one may stop working.
      await this.options.store.save({ ...credential, refreshToken: tokens.refreshToken, savedAt: new Date(this.now()).toISOString() });
    }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt, accountId: credential.accountId };
    return tokens.accessToken;
  }

  private async stillStored(refreshToken: string): Promise<boolean> {
    return (await this.options.store.load())?.refreshToken === refreshToken;
  }

  /** Drops the cached access token (after Google refused it) so the next call refreshes. */
  invalidateAccessToken(): void {
    this.access = null;
  }

  /**
   * Revokes a grant obtained by an abandoned sign-in, unless it may belong to the account
   * already stored: Google revokes a whole grant at once, which would also end the
   * still-valid stored connection.
   */
  private async discardNewGrant(token: string, accountId: string | null): Promise<void> {
    const previous = await this.options.store.load();
    if (!previous || (accountId !== null && previous.accountId !== accountId)) await this.revokeToken(token);
  }

  private async revokeToken(token: string): Promise<boolean> {
    try {
      const response = await this.options.fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Revokes the grant at Google (best effort) and always deletes the stored sign-in. */
  async disconnect(): Promise<{ revoked: boolean }> {
    this.cancelConnect();
    this.generation += 1;
    const credential = await this.options.store.load();
    const token = credential?.refreshToken ?? this.access?.token ?? null;
    this.access = null;
    let revoked = false;
    try {
      revoked = token && this.options.client ? await this.revokeToken(token) : false;
    } finally {
      await this.options.store.clear();
    }
    return { revoked };
  }
}
