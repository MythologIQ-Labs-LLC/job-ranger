import { randomUUID } from "node:crypto";
import { DriveError, toDriveError } from "./drive-errors.cjs";
import { GOOGLE_DRIVE_FILE_SCOPE, type GoogleClientConfig, type GoogleEndpoints } from "./google-config.cjs";
import { FORM_HEADERS, formBody, type GoogleTransport } from "./google-transport.cjs";
import { createOAuthState, createPkcePair, startLoopbackReceiver, type LoopbackReceiver } from "./google-loopback.cjs";
import type { DriveCredentialStore } from "./drive-credential-store.cjs";

export const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

interface AccessToken {
  token: string;
  expiresAt: number;
}

export interface GoogleDesktopAuthOptions {
  client: GoogleClientConfig | null;
  endpoints: GoogleEndpoints;
  transport: GoogleTransport;
  store: DriveCredentialStore;
  /** Opens the authorization URL in the system browser. */
  openExternal: (url: string) => Promise<void>;
  authorizationTimeoutMs?: number;
  now?: () => number;
}

export function grantedScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
}

export function buildAuthorizationUrl(input: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  promptConsent: boolean;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_FILE_SCOPE);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "offline");
  if (input.promptConsent) url.searchParams.set("prompt", "consent");
  return url.toString();
}

export interface DriveAccount {
  /** Drive `about.user.permissionId`: stable per Google account. */
  id: string;
  email: string | null;
}

interface ValidatedTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
}

/**
 * DriveAuthorization for the desktop runtime: system-browser OAuth with
 * authorization code + PKCE (S256) + a one-shot 127.0.0.1 loopback receiver.
 * Every connection asks for consent and must yield a refresh token bound to
 * the account that granted it. The access token lives only in memory; the
 * refresh token is handed to the credential store.
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

  /** Id of the sign-in in progress, if any. */
  get connectFlowId(): string | null {
    return this.flowId;
  }

  private requireClient(): GoogleClientConfig {
    if (!this.options.client) {
      throw new DriveError("not_configured", "Google Drive is not set up in this build of Job Ranger.");
    }
    return this.options.client;
  }

  async connect(): Promise<DriveAccount> {
    const client = this.requireClient();
    // Claimed synchronously, before any await, so a second call cannot start a parallel flow.
    if (this.connectInFlight) {
      throw new DriveError("auth_in_progress", "A Google sign-in is already waiting in your browser. Finish or cancel it first.");
    }
    this.connectInFlight = true;
    this.flowId = randomUUID();
    const generation = this.generation;
    const cancelled = () => new DriveError("auth_cancelled", "Google Drive sign-in was cancelled.");
    let flow: LoopbackReceiver | null = null;
    try {
      const pkce = createPkcePair();
      const state = createOAuthState();
      flow = await startLoopbackReceiver(state, this.options.authorizationTimeoutMs ?? AUTHORIZATION_TIMEOUT_MS);
      this.flow = flow;
      if (generation !== this.generation) throw cancelled();
      const url = buildAuthorizationUrl({
        endpoint: this.options.endpoints.authorize,
        clientId: client.clientId,
        redirectUri: flow.redirectUri,
        codeChallenge: pkce.challenge,
        state,
        promptConsent: true,
      });
      this.options.transport.assertAllowed(url);
      try {
        await this.options.openExternal(url);
      } catch {
        throw new DriveError("auth_failed", "Job Ranger could not open your browser for Google sign-in.");
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
        const driveError = toDriveError(error);
        // invalid_grant here means the code, PKCE verifier or redirect URI was rejected, not an expired grant.
        if (driveError.code === "auth_expired") {
          throw new DriveError("auth_failed", "Google rejected the sign-in exchange. Try connecting again.", driveError.httpStatus);
        }
        throw driveError;
      });
      if (!tokens.refreshToken) {
        await this.discardNewGrant(tokens.accessToken, null);
        throw new DriveError(
          "auth_failed",
          "Google did not grant lasting access. Remove Job Ranger at myaccount.google.com/permissions, then connect again.",
        );
      }
      let account: DriveAccount;
      try {
        account = await this.fetchAccount(tokens.accessToken);
      } catch (error) {
        await this.discardNewGrant(tokens.refreshToken, null);
        throw error;
      }
      if (generation !== this.generation) {
        // Cancelled or disconnected while the exchange ran: never resurrect the credential.
        await this.discardNewGrant(tokens.refreshToken, account.id);
        throw cancelled();
      }
      const previous = await this.options.store.load();
      if (previous && previous.accountId !== account.id) {
        // A different Google account replaces the old one: end the old grant first.
        await this.revokeToken(previous.refreshToken);
      }
      if (previous) await this.options.store.clear();
      this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
      await this.options.store.save({
        refreshToken: tokens.refreshToken,
        accountId: account.id,
        accountEmail: account.email,
        scope: GOOGLE_DRIVE_FILE_SCOPE,
        savedAt: new Date(this.now()).toISOString(),
      });
      return account;
    } finally {
      flow?.cancel();
      this.flow = null;
      this.connectInFlight = false;
      this.flowId = null;
    }
  }

  /**
   * Cancels the sign-in in progress. With a flow id, only that sign-in is
   * cancelled: a stale request (for a flow that already ended) returns false
   * and cannot cancel a newer one.
   */
  cancelConnect(flowId?: string): boolean {
    if (!this.connectInFlight) return false;
    if (flowId !== undefined && flowId !== this.flowId) return false;
    this.generation += 1;
    this.flow?.cancel();
    return true;
  }

  /** Validates a token response: Bearer type, expiry, and a drive.file grant (else refused and revoked). */
  private async postToken(form: Record<string, string>): Promise<ValidatedTokens> {
    const { body } = await this.options.transport.request<TokenResponse>(this.options.endpoints.token, {
      method: "POST",
      headers: FORM_HEADERS,
      body: formBody(form),
    });
    if (
      typeof body?.access_token !== "string" || !body.access_token ||
      typeof body.expires_in !== "number" ||
      typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer"
    ) {
      throw new DriveError("invalid_response", "Google returned an unexpected sign-in response.");
    }
    const refreshToken = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null;
    const scopes = grantedScopes(body.scope);
    if ((form.grant_type === "authorization_code" || body.scope !== undefined) && !scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) {
      await this.revokeToken(refreshToken ?? body.access_token);
      throw new DriveError(
        "insufficient_scope",
        "Google did not grant access to files Job Ranger creates. Connect again and leave that permission selected.",
      );
    }
    return { accessToken: body.access_token, expiresAt: this.now() + body.expires_in * 1000, refreshToken };
  }

  private async fetchAccount(accessToken: string): Promise<DriveAccount> {
    const { body } = await this.options.transport.request<{ user?: { emailAddress?: unknown; permissionId?: unknown } }>(
      `${this.options.endpoints.driveApi}/about?fields=${encodeURIComponent("user(emailAddress,displayName,permissionId)")}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const id = body?.user?.permissionId;
    const email = body?.user?.emailAddress;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new DriveError("invalid_response", "Google did not identify the connected account. Try connecting again.");
    }
    return { id, email: typeof email === "string" && email.length <= 320 ? email : null };
  }

  async isConnected(): Promise<boolean> {
    return (await this.options.store.load()) !== null;
  }

  async account(): Promise<DriveAccount | null> {
    const credential = await this.options.store.load();
    return credential ? { id: credential.accountId, email: credential.accountEmail } : null;
  }

  async accountEmail(): Promise<string | null> {
    return (await this.account())?.email ?? null;
  }

  /** Returns a valid access token, refreshing it when needed. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    this.requireClient();
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
      throw new DriveError("not_connected", "Connect Google Drive in Settings first.");
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
      const driveError = toDriveError(error);
      if (driveError.code === "auth_expired" || driveError.code === "insufficient_scope") {
        // invalid_grant: revoked, expired (7 days in Testing mode), or password reset.
        this.access = null;
        await this.options.store.clear();
        if (driveError.code === "auth_expired") {
          throw new DriveError("auth_expired", "Google access for Job Ranger expired or was revoked. Reconnect Google Drive in Settings.", driveError.httpStatus);
        }
      }
      throw driveError;
    }
    if (generation !== this.generation) throw new DriveError("not_connected", "Google Drive was disconnected.");
    if (tokens.refreshToken && tokens.refreshToken !== credential.refreshToken) {
      // Google rotated the refresh token; the old one may stop working.
      await this.options.store.save({ ...credential, refreshToken: tokens.refreshToken, savedAt: new Date(this.now()).toISOString() });
    }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    return tokens.accessToken;
  }

  /** Drops the cached access token (after a 401) so the next call refreshes. */
  invalidateAccessToken(): void {
    this.access = null;
  }

  /**
   * Revokes a grant obtained by an abandoned sign-in, unless it may belong to
   * the account already stored: Google revokes a whole grant (all its tokens)
   * at once, so revoking would also end the still-valid stored connection.
   */
  private async discardNewGrant(token: string, accountId: string | null): Promise<void> {
    const previous = await this.options.store.load();
    if (!previous || (accountId !== null && previous.accountId !== accountId)) await this.revokeToken(token);
  }

  private async revokeToken(token: string): Promise<boolean> {
    try {
      await this.options.transport.request(this.options.endpoints.revoke, {
        method: "POST",
        headers: FORM_HEADERS,
        body: formBody({ token }),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Revokes the grant at Google (best effort) and always deletes the stored credential. */
  async disconnect(): Promise<{ revoked: boolean }> {
    this.cancelConnect();
    this.generation += 1;
    const credential = await this.options.store.load();
    const token = credential?.refreshToken ?? this.access?.token ?? null;
    this.access = null;
    const revoked = token && this.options.client ? await this.revokeToken(token) : false;
    await this.options.store.clear();
    return { revoked };
  }
}
