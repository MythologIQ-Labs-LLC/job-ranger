import { randomUUID } from "node:crypto";
import { createOAuthState, createPkcePair } from "../drive/google-loopback.cjs";
import {
  GRAPH_APP_ROOT, MICROSOFT_APP_FOLDER_SCOPE, MICROSOFT_AUTHORIZE_ENDPOINT, MICROSOFT_SCOPE_PARAMETER,
  MICROSOFT_TOKEN_ENDPOINT,
} from "./microsoft-config.cjs";
import { ONEDRIVE_ACCOUNT_ID, type MicrosoftCredentialStore } from "./microsoft-credential-store.cjs";
import { StorageAuthError, startOAuthLoopback, type OAuthLoopback } from "./oauth-loopback.cjs";

export const MICROSOFT_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 60_000;
/**
 * The Microsoft identity platform has no endpoint with which a public client can revoke
 * its own refresh token, so disconnecting deletes it locally and points here.
 */
export const MICROSOFT_MANUAL_REVOKE_HINT =
  "To remove Sojourner's access to your OneDrive, visit account.live.com/consent/Manage (personal account) or myapps.microsoft.com (work or school account).";

export interface OneDriveAccount {
  /** OneDrive drive id (parentReference.driveId of the app folder). */
  accountId: string;
  label: string;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
}

interface ValidatedTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
}

export interface MicrosoftAuthOptions {
  clientId: string | null;
  store: MicrosoftCredentialStore;
  /** Storage egress fetch (storage-egress.cts). */
  fetch: typeof fetch;
  openExternal: (url: string) => Promise<void>;
  browserUrl?: (url: string) => string;
  authorizationTimeoutMs?: number;
  now?: () => number;
}

/** True when the granted scopes include the app-folder scope (with or without the Graph prefix). */
export function grantsAppFolder(scope: unknown): boolean {
  if (typeof scope !== "string") return false;
  return scope.split(/\s+/).some((entry) => {
    const name = entry.replace(/^https:\/\/graph\.microsoft\.com\//i, "");
    return name.toLowerCase() === MICROSOFT_APP_FOLDER_SCOPE.toLowerCase();
  });
}

export function buildMicrosoftAuthorizationUrl(input: {
  clientId: string; redirectUri: string; codeChallenge: string; state: string;
}): string {
  const url = new URL(MICROSOFT_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPE_PARAMETER);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Identifies the OneDrive account from the app folder (no profile or identity scope). */
export async function verifyOneDriveAccount(accessToken: string, http: typeof fetch): Promise<OneDriveAccount> {
  let response: Response;
  try {
    response = await http(GRAPH_APP_ROOT, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new StorageAuthError("auth_failed", "Sojourner could not reach OneDrive to verify the account.");
  }
  if (!response.ok) {
    throw new StorageAuthError(response.status === 401 || response.status === 403 ? "insufficient_scope" : "invalid_response",
      "OneDrive did not open Sojourner's app folder for this account.");
  }
  let body: { parentReference?: { driveId?: unknown; driveType?: unknown } } | null;
  try { body = await response.json() as typeof body; } catch { body = null; }
  const driveId = body?.parentReference?.driveId;
  if (typeof driveId !== "string" || !ONEDRIVE_ACCOUNT_ID.test(driveId)) {
    throw new StorageAuthError("invalid_response", "OneDrive did not identify the connected account.");
  }
  const driveType = body?.parentReference?.driveType;
  const label = driveType === "personal" ? "OneDrive (personal account)"
    : driveType === "business" ? "OneDrive (work or school account)" : "OneDrive account";
  return { accountId: driveId, label };
}

/**
 * OneDrive authorization for the Windows app: Microsoft identity platform public client,
 * system browser, authorization code with PKCE (S256), an independent single-use state
 * and a one-shot loopback receiver; tenant `common`; scopes Files.ReadWrite.AppFolder and
 * offline_access only. The access token lives in this process's memory; the refresh token
 * goes to the credential store (Windows safeStorage, or session-only).
 */
export class MicrosoftAuth {
  private flow: OAuthLoopback | null = null;
  private connectInFlight = false;
  private flowId: string | null = null;
  private generation = 0;
  private access: { token: string; expiresAt: number; accountId: string } | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: MicrosoftAuthOptions) {
    this.now = options.now ?? Date.now;
  }

  get configured(): boolean {
    return this.options.clientId !== null;
  }

  get connecting(): boolean {
    return this.connectInFlight;
  }

  private requireClient(): string {
    if (!this.options.clientId) {
      throw new StorageAuthError("not_configured", "OneDrive is not set up in this build of Sojourner.");
    }
    return this.options.clientId;
  }

  async connect(flowId: string = randomUUID()): Promise<OneDriveAccount> {
    const clientId = this.requireClient();
    if (this.connectInFlight) {
      throw new StorageAuthError("auth_in_progress", "A Microsoft sign-in is already waiting in your browser. Finish or cancel it first.");
    }
    this.connectInFlight = true;
    this.flowId = flowId;
    const generation = this.generation;
    const cancelled = () => new StorageAuthError("auth_cancelled", "OneDrive sign-in was cancelled.");
    let flow: OAuthLoopback | null = null;
    try {
      const pkce = createPkcePair();
      const state = createOAuthState();
      flow = await startOAuthLoopback({
        expectedState: state,
        timeoutMs: this.options.authorizationTimeoutMs ?? MICROSOFT_AUTHORIZATION_TIMEOUT_MS,
        providerName: "OneDrive",
      });
      this.flow = flow;
      if (generation !== this.generation) throw cancelled();
      const url = buildMicrosoftAuthorizationUrl({
        clientId, redirectUri: flow.redirectUri, codeChallenge: pkce.challenge, state,
      });
      try {
        await this.options.openExternal(this.options.browserUrl ? this.options.browserUrl(url) : url);
      } catch {
        throw new StorageAuthError("auth_failed", "Sojourner could not open your browser for Microsoft sign-in.");
      }
      const code = await flow.code;
      const tokens = await this.postToken({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: pkce.verifier,
        scope: MICROSOFT_SCOPE_PARAMETER,
      }).catch((error: unknown) => {
        if (error instanceof StorageAuthError && error.code === "auth_expired") {
          throw new StorageAuthError("auth_failed", "Microsoft rejected the sign-in exchange. Try connecting again.");
        }
        throw error;
      });
      if (!tokens.refreshToken) {
        throw new StorageAuthError("auth_failed", "Microsoft did not grant lasting access to Sojourner's OneDrive folder. Connect again.");
      }
      const account = await verifyOneDriveAccount(tokens.accessToken, this.options.fetch);
      if (generation !== this.generation) throw cancelled();
      const previous = await this.options.store.load();
      if (previous) await this.options.store.clear();
      await this.options.store.save({
        refreshToken: tokens.refreshToken,
        accountId: account.accountId,
        accountLabel: account.label,
        scope: MICROSOFT_SCOPE_PARAMETER,
        savedAt: new Date(this.now()).toISOString(),
      });
      if (generation !== this.generation) {
        await this.options.store.clear();
        throw cancelled();
      }
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

  cancelConnect(flowId?: string): boolean {
    if (!this.connectInFlight) return false;
    if (flowId !== undefined && flowId !== this.flowId) return false;
    this.generation += 1;
    this.flow?.cancel();
    return true;
  }

  private async postToken(form: Record<string, string>): Promise<ValidatedTokens> {
    let response: Response;
    try {
      response = await this.options.fetch(MICROSOFT_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new StorageAuthError("auth_failed", "Sojourner could not reach Microsoft to finish signing in. Check your connection, then retry.");
    }
    let body: TokenResponse | null = null;
    try { body = await response.json() as TokenResponse; } catch { body = null; }
    if (!response.ok) {
      if (body?.error === "invalid_grant" || body?.error === "interaction_required") {
        throw new StorageAuthError("auth_expired", "Microsoft access for Sojourner expired or was revoked. Connect OneDrive again.");
      }
      if (body?.error === "invalid_client" || body?.error === "unauthorized_client") {
        throw new StorageAuthError("not_configured", "Microsoft rejected this build's sign-in configuration.");
      }
      throw new StorageAuthError("auth_failed", "Microsoft could not complete the sign-in. Try again in a moment.");
    }
    if (!body || typeof body.access_token !== "string" || !body.access_token || body.access_token.length > 16_384 ||
        /[\r\n]/.test(body.access_token) || typeof body.expires_in !== "number" || !(body.expires_in > 0) ||
        typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer") {
      throw new StorageAuthError("invalid_response", "Microsoft returned an unexpected sign-in response.");
    }
    if (!grantsAppFolder(body.scope)) {
      throw new StorageAuthError("insufficient_scope",
        "Microsoft did not grant access to Sojourner's OneDrive app folder. Connect again and accept that permission.");
    }
    const refreshToken = typeof body.refresh_token === "string" && body.refresh_token && body.refresh_token.length <= 16_384
      ? body.refresh_token : null;
    return { accessToken: body.access_token, expiresAt: this.now() + body.expires_in * 1000, refreshToken };
  }

  async account(): Promise<{ accountId: string; label: string } | null> {
    const credential = await this.options.store.load();
    return credential ? { accountId: credential.accountId, label: credential.accountLabel } : null;
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    this.requireClient();
    const credential = await this.options.store.load();
    if (!credential) {
      this.access = null;
      throw new StorageAuthError("not_connected", "Connect OneDrive first.");
    }
    if (this.access && this.access.accountId !== credential.accountId) this.access = null;
    if (!forceRefresh && this.access && this.access.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.access.token;
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const clientId = this.requireClient();
    const credential = await this.options.store.load();
    if (!credential) throw new StorageAuthError("not_connected", "Connect OneDrive first.");
    const generation = this.generation;
    let tokens: ValidatedTokens;
    try {
      tokens = await this.postToken({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
        scope: MICROSOFT_SCOPE_PARAMETER,
      });
    } catch (error) {
      if ((await this.options.store.load())?.refreshToken !== credential.refreshToken) {
        throw new StorageAuthError("not_connected", "OneDrive was disconnected.");
      }
      if (error instanceof StorageAuthError && (error.code === "auth_expired" || error.code === "insufficient_scope")) {
        this.access = null;
        await this.options.store.clear();
      }
      throw error;
    }
    if (generation !== this.generation || (await this.options.store.load())?.refreshToken !== credential.refreshToken) {
      throw new StorageAuthError("not_connected", "OneDrive was disconnected.");
    }
    if (tokens.refreshToken && tokens.refreshToken !== credential.refreshToken) {
      // Microsoft rotates refresh tokens; keep the newest one.
      await this.options.store.save({ ...credential, refreshToken: tokens.refreshToken, savedAt: new Date(this.now()).toISOString() });
    }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt, accountId: credential.accountId };
    return tokens.accessToken;
  }

  invalidateAccessToken(): void {
    this.access = null;
  }

  /** Deletes the stored sign-in. Microsoft offers public clients no revocation endpoint. */
  async disconnect(): Promise<{ revoked: false }> {
    this.cancelConnect();
    this.generation += 1;
    this.access = null;
    await this.options.store.clear();
    return { revoked: false };
  }
}
