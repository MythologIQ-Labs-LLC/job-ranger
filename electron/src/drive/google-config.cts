import path from "node:path";
import { readFileSync } from "node:fs";

/** The only Google scope Sojourner requests: files it creates, nothing else. */
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const GOOGLE_CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Generated at package time by scripts/write-google-oauth-client.mjs from the
 * SOJOURNER_GOOGLE_DESKTOP_CLIENT_ID/_SECRET repository variables (release-build.yml)
 * and copied into resources by electron-builder.json.
 */
export const PACKAGED_CLIENT_CONFIG_RELATIVE_PATH = path.join("google-oauth", "google-desktop-client.json");

/**
 * A Google "Desktop app" OAuth client. Its secret ships inside every installed copy, so
 * it is distributed configuration, not a confidential credential (RFC 8252 section 8.5):
 * security rests on PKCE, the loopback redirect, the state check and the person's consent.
 */
export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

export type GoogleClientConfigResult =
  | { configured: true; client: GoogleClientConfig }
  | { configured: false; reason: "missing-client-config" | "invalid-client-config" };

export interface GoogleRuntimeEnvironment {
  env: Record<string, string | undefined>;
  isPackaged: boolean;
  resourcesPath?: string | null;
  readTextFile?: (target: string) => string;
}

export function validateClientConfig(clientId: unknown, clientSecret: unknown): GoogleClientConfigResult {
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    return { configured: false, reason: "missing-client-config" };
  }
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id && !secret) return { configured: false, reason: "missing-client-config" };
  if (!GOOGLE_CLIENT_ID_PATTERN.test(id) || !GOOGLE_CLIENT_SECRET_PATTERN.test(secret)) {
    return { configured: false, reason: "invalid-client-config" };
  }
  return { configured: true, client: { clientId: id, clientSecret: secret } };
}

/**
 * Packaged builds read only the JSON generated into resources at package time, so a
 * build without the repository variables ships with Drive export hidden. Development
 * (non-packaged) runs may supply the pair through the environment instead. Missing or
 * malformed configuration disables the feature; it never throws.
 */
export function resolveGoogleClientConfig(runtime: GoogleRuntimeEnvironment): GoogleClientConfigResult {
  if (!runtime.isPackaged) {
    const id = runtime.env.SOJOURNER_GOOGLE_DESKTOP_CLIENT_ID;
    const secret = runtime.env.SOJOURNER_GOOGLE_DESKTOP_CLIENT_SECRET;
    if (id || secret) return validateClientConfig(id ?? "", secret ?? "");
  }
  if (!runtime.resourcesPath) return { configured: false, reason: "missing-client-config" };
  const read = runtime.readTextFile ?? ((target: string) => readFileSync(target, "utf8"));
  let raw: string;
  try {
    raw = read(path.join(runtime.resourcesPath, PACKAGED_CLIENT_CONFIG_RELATIVE_PATH));
  } catch {
    return { configured: false, reason: "missing-client-config" };
  }
  try {
    const parsed = JSON.parse(raw) as { clientId?: unknown; clientSecret?: unknown };
    return validateClientConfig(parsed.clientId, parsed.clientSecret);
  } catch {
    return { configured: false, reason: "invalid-client-config" };
  }
}

export const GOOGLE_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * Loopback http origin of a local fake Google, honoured ONLY by a non-packaged build
 * (Electron E2E). A packaged build always talks to Google and ignores the variable.
 */
export function resolveGoogleTestOrigin(runtime: Pick<GoogleRuntimeEnvironment, "env" | "isPackaged">): string | null {
  if (runtime.isPackaged) return null;
  const raw = runtime.env.SOJOURNER_GOOGLE_TEST_BASE_URL;
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port ||
      parsed.username || parsed.password) return null;
  return parsed.origin;
}

/** Test-only shorter timeouts, honoured only alongside the test origin override. */
export function resolveTestTimeoutMs(runtime: Pick<GoogleRuntimeEnvironment, "env" | "isPackaged">): number | null {
  if (!resolveGoogleTestOrigin(runtime)) return null;
  const value = Number(runtime.env.SOJOURNER_GOOGLE_TEST_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 100 && value <= 600_000 ? value : null;
}
