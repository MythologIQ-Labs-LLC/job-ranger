import path from "node:path";
import { readFileSync } from "node:fs";

/**
 * Microsoft identity platform configuration for OneDrive storage (#249).
 *
 * Sojourner is a PUBLIC client (no secret): authorization code + PKCE (S256) through the
 * system browser and a loopback `http://localhost` redirect, tenant `common` (personal
 * and work or school accounts), and exactly these delegated scopes.
 */
export const MICROSOFT_SCOPES = ["Files.ReadWrite.AppFolder", "offline_access"] as const;
export const MICROSOFT_SCOPE_PARAMETER = MICROSOFT_SCOPES.join(" ");
export const MICROSOFT_APP_FOLDER_SCOPE = "Files.ReadWrite.AppFolder";

export const MICROSOFT_AUTHORIZE_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const MICROSOFT_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const GRAPH_APP_ROOT = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

/** Application (client) ids are GUIDs. */
export const MICROSOFT_CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generated at package time by scripts/write-microsoft-oauth-client.mjs from the
 * SOJOURNER_MICROSOFT_CLIENT_ID repository variable (release-build.yml) and copied into
 * resources by electron-builder.json.
 */
export const PACKAGED_MICROSOFT_CONFIG_RELATIVE_PATH = path.join("microsoft-oauth", "microsoft-client.json");

export type MicrosoftClientConfigResult =
  | { configured: true; clientId: string }
  | { configured: false; reason: "missing-client-config" | "invalid-client-config" };

export interface MicrosoftRuntimeEnvironment {
  env: Record<string, string | undefined>;
  isPackaged: boolean;
  resourcesPath?: string | null;
  readTextFile?: (target: string) => string;
}

export function validateMicrosoftClientId(value: unknown): MicrosoftClientConfigResult {
  if (typeof value !== "string" || !value.trim()) return { configured: false, reason: "missing-client-config" };
  const id = value.trim().toLowerCase();
  if (!MICROSOFT_CLIENT_ID_PATTERN.test(id)) return { configured: false, reason: "invalid-client-config" };
  return { configured: true, clientId: id };
}

/**
 * Packaged builds read only the JSON generated into resources at package time; a build
 * without the variable ships with OneDrive disabled. Development (non-packaged) runs may
 * supply the id through the environment. Missing or malformed configuration disables
 * the choice; it never throws.
 */
export function resolveMicrosoftClientConfig(runtime: MicrosoftRuntimeEnvironment): MicrosoftClientConfigResult {
  if (!runtime.isPackaged && runtime.env.SOJOURNER_MICROSOFT_CLIENT_ID !== undefined) {
    return validateMicrosoftClientId(runtime.env.SOJOURNER_MICROSOFT_CLIENT_ID);
  }
  if (!runtime.resourcesPath) return { configured: false, reason: "missing-client-config" };
  const read = runtime.readTextFile ?? ((target: string) => readFileSync(target, "utf8"));
  let raw: string;
  try {
    raw = read(path.join(runtime.resourcesPath, PACKAGED_MICROSOFT_CONFIG_RELATIVE_PATH));
  } catch {
    return { configured: false, reason: "missing-client-config" };
  }
  try {
    return validateMicrosoftClientId((JSON.parse(raw) as { clientId?: unknown }).clientId);
  } catch {
    return { configured: false, reason: "invalid-client-config" };
  }
}

function loopbackOrigin(raw: string | undefined): string | null {
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

/**
 * Loopback origin of a local fake Microsoft identity platform and Graph, honoured ONLY by
 * a non-packaged build (Electron E2E). A packaged build ignores the variable.
 */
export function resolveMicrosoftTestOrigin(runtime: Pick<MicrosoftRuntimeEnvironment, "env" | "isPackaged">): string | null {
  return runtime.isPackaged ? null : loopbackOrigin(runtime.env.SOJOURNER_MICROSOFT_TEST_BASE_URL);
}

function testNumber(runtime: Pick<MicrosoftRuntimeEnvironment, "env" | "isPackaged">, name: string,
  min: number, max: number): number | null {
  if (runtime.isPackaged) return null;
  const value = Number(runtime.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Non-packaged test timings for the backup scheduler (packaged builds use the defaults). */
export function resolveStorageTestTimings(runtime: Pick<MicrosoftRuntimeEnvironment, "env" | "isPackaged">): {
  debounceMs: number | null; retryBaseMs: number | null; pollMs: number | null; timeoutMs: number | null;
} {
  return {
    debounceMs: testNumber(runtime, "SOJOURNER_STORAGE_TEST_DEBOUNCE_MS", 50, 3_600_000),
    retryBaseMs: testNumber(runtime, "SOJOURNER_STORAGE_TEST_RETRY_MS", 50, 3_600_000),
    pollMs: testNumber(runtime, "SOJOURNER_STORAGE_TEST_POLL_MS", 50, 60_000),
    timeoutMs: testNumber(runtime, "SOJOURNER_STORAGE_TEST_TIMEOUT_MS", 100, 600_000),
  };
}
