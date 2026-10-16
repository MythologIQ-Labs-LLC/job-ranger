import path from "node:path";
import { readFileSync } from "node:fs";
import type { DriveUnavailableReason } from "../../../src/shared/google-drive.js";

/** The only Google scope Job Ranger requests: files it creates, nothing else. */
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/** Generated at package time by scripts/write-google-oauth-client.mjs. */
export const PACKAGED_CLIENT_CONFIG_RELATIVE_PATH = path.join("google-oauth", "google-desktop-client.json");

export const GOOGLE_PRODUCTION_ORIGINS = [
  "https://accounts.google.com",
  "https://oauth2.googleapis.com",
  "https://www.googleapis.com",
] as const;

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

export type GoogleClientConfigResult =
  | { configured: true; client: GoogleClientConfig }
  | { configured: false; reason: DriveUnavailableReason };

export interface GoogleEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  driveApi: string;
  driveUpload: string;
  allowedOrigins: readonly string[];
  /** True only for non-packaged E2E runs against a local fake Google server. */
  testOverride: boolean;
}

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
  if (!GOOGLE_CLIENT_ID_PATTERN.test(id) || !/^[A-Za-z0-9_-]{8,128}$/.test(secret)) {
    return { configured: false, reason: "invalid-client-config" };
  }
  return { configured: true, client: { clientId: id, clientSecret: secret } };
}

/**
 * Development runs read the Desktop-app OAuth client from the environment.
 * Packaged builds read only the JSON generated into resources at package time.
 * Missing configuration disables the feature; it never throws.
 */
export function resolveGoogleClientConfig(runtime: GoogleRuntimeEnvironment): GoogleClientConfigResult {
  if (!runtime.isPackaged) {
    const id = runtime.env.JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID;
    const secret = runtime.env.JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET;
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

function loopbackTestOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "http:" || !loopback || !parsed.port) return null;
  return parsed.origin;
}

/**
 * Google endpoints. JOB_RANGER_GOOGLE_TEST_BASE_URL redirects every Google
 * request to a local fake server, but only in a non-packaged build and only for
 * a loopback http origin; packaged builds always talk to Google.
 */
export function resolveGoogleEndpoints(runtime: Pick<GoogleRuntimeEnvironment, "env" | "isPackaged">): GoogleEndpoints {
  const testOrigin = runtime.isPackaged ? null : loopbackTestOrigin(runtime.env.JOB_RANGER_GOOGLE_TEST_BASE_URL);
  const accounts = testOrigin ?? "https://accounts.google.com";
  const oauth = testOrigin ?? "https://oauth2.googleapis.com";
  const api = testOrigin ?? "https://www.googleapis.com";
  return {
    authorize: `${accounts}/o/oauth2/v2/auth`,
    token: `${oauth}/token`,
    revoke: `${oauth}/revoke`,
    driveApi: `${api}/drive/v3`,
    driveUpload: `${api}/upload/drive/v3/files`,
    allowedOrigins: testOrigin ? [testOrigin] : [...GOOGLE_PRODUCTION_ORIGINS],
    testOverride: Boolean(testOrigin),
  };
}

/** Test-only shorter request timeout, honored only alongside the test endpoint override. */
export function resolveTestTimeoutMs(runtime: Pick<GoogleRuntimeEnvironment, "env" | "isPackaged">): number | null {
  if (!resolveGoogleEndpoints(runtime).testOverride) return null;
  const value = Number(runtime.env.JOB_RANGER_GOOGLE_TEST_TIMEOUT_MS);
  return Number.isInteger(value) && value >= 100 && value <= 120_000 ? value : null;
}
