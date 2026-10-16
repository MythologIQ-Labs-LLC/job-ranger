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

/**
 * DriveAuthorization for the desktop runtime: system-browser OAuth with
 * authorization code + PKCE (S256) + a one-shot 127.0.0.1 loopback receiver.
 * The access token lives only in memory; the refresh token is handed to the
 * credential store.
 */
export class GoogleDesktopAuth {
  private flow: LoopbackReceiver | null = null;
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
    return this.flow !== null;
  }

  private requireClient(): GoogleClientConfig {
    if (!this.options.client) {
      throw new DriveError("not_configured", "Google Drive is not set up in this build of Job Ranger.");
    }
    return this.options.client;
  }

  async connect(): Promise<void> {
    const client = this.requireClient();
    if (this.flow) throw new DriveError("auth_in_progress", "A Google sign-in is already waiting in your browser. Finish or cancel it first.");
    const existing = await this.options.store.load();
    const pkce = createPkcePair();
    const state = createOAuthState();
    const flow = await startLoopbackReceiver(state, this.options.authorizationTimeoutMs ?? AUTHORIZATION_TIMEOUT_MS);
    this.flow = flow;
    try {
      const url = buildAuthorizationUrl({
        endpoint: this.options.endpoints.authorize,
        clientId: client.clientId,
        redirectUri: flow.redirectUri,
        codeChallenge: pkce.challenge,
        state,
        promptConsent: !existing,
      });
      this.options.transport.assertAllowed(url);
      try {
        await this.options.openExternal(url);
      } catch {
        throw new DriveError("auth_failed", "Job Ranger could not open your browser for Google sign-in.");
      }
      const code = await flow.code;
      const tokens = await this.requestTokens({
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
      const refreshToken = typeof tokens.refresh_token === "string" && tokens.refresh_token
        ? tokens.refresh_token
        : existing?.refreshToken;
      if (!refreshToken) {
        throw new DriveError("auth_failed", "Google did not grant lasting access. Disconnect, then connect again.");
      }
      const accountEmail = await this.fetchAccountEmail();
      await this.options.store.save({
        refreshToken,
        accountEmail,
        scope: GOOGLE_DRIVE_FILE_SCOPE,
        savedAt: new Date(this.now()).toISOString(),
      });
    } finally {
      flow.cancel();
      if (this.flow === flow) this.flow = null;
    }
  }

  cancelConnect(): void {
    this.flow?.cancel();
  }

  /** Validates a token response; a grant without drive.file is refused and revoked. */
  private async requestTokens(form: Record<string, string>): Promise<TokenResponse> {
    const { body } = await this.options.transport.request<TokenResponse>(this.options.endpoints.token, {
      method: "POST",
      headers: FORM_HEADERS,
      body: formBody(form),
    });
    if (typeof body?.access_token !== "string" || !body.access_token || typeof body.expires_in !== "number") {
      throw new DriveError("invalid_response", "Google returned an unexpected sign-in response.");
    }
    const scopes = grantedScopes(body.scope);
    if ((form.grant_type === "authorization_code" || body.scope !== undefined) && !scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) {
      await this.revokeToken(typeof body.refresh_token === "string" ? body.refresh_token : body.access_token);
      throw new DriveError(
        "insufficient_scope",
        "Google did not grant access to files Job Ranger creates. Connect again and leave that permission selected.",
      );
    }
    this.access = { token: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return body;
  }

  private async fetchAccountEmail(): Promise<string | null> {
    try {
      const token = await this.getAccessToken();
      const { body } = await this.options.transport.request<{ user?: { emailAddress?: unknown } }>(
        `${this.options.endpoints.driveApi}/about?fields=${encodeURIComponent("user(emailAddress,displayName)")}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const email = body?.user?.emailAddress;
      return typeof email === "string" && email.length <= 320 ? email : null;
    } catch {
      return null;
    }
  }

  async isConnected(): Promise<boolean> {
    return (await this.options.store.load()) !== null;
  }

  async accountEmail(): Promise<string | null> {
    return (await this.options.store.load())?.accountEmail ?? null;
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
    try {
      await this.requestTokens({
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
    return this.access!.token;
  }

  /** Drops the cached access token (after a 401) so the next call refreshes. */
  invalidateAccessToken(): void {
    this.access = null;
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
    const credential = await this.options.store.load();
    const token = credential?.refreshToken ?? this.access?.token ?? null;
    const revoked = token && this.options.client ? await this.revokeToken(token) : false;
    this.access = null;
    await this.options.store.clear();
    return { revoked };
  }
}
