// Generates the Google Drive Desktop-app OAuth client configuration that a
// packaged Job Ranger reads from resources/google-oauth/google-desktop-client.json
// (#314). Runs before electron-builder in the electron:build* / electron:pack
// scripts; electron-builder.json copies the file into resources.
//
// Inputs (environment, e.g. CI secrets/variables; never committed):
//   JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID      e.g. 123456789012-abc123.apps.googleusercontent.com
//   JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET  Google's Desktop-app client "secret"
//   JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT=1 fail when the pair is absent
//
// A Desktop-app client secret is not confidential: it ships inside every copy
// of the app. Security rests on PKCE, the loopback redirect and the person's
// own consent, not on this value. Without the pair the build still succeeds
// and the app shows Google Drive as "not configured".
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[A-Za-z0-9_-]{8,128}$/;

export function googleClientConfigFromEnv(env) {
  const clientId = env.JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET?.trim() ?? "";
  if (!clientId && !clientSecret) {
    if (env.JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT === "1") {
      throw new Error("JOB_RANGER_REQUIRE_GOOGLE_DRIVE_CLIENT=1 but no Google Desktop OAuth client was provided.");
    }
    return null;
  }
  if (!clientId || !clientSecret) {
    throw new Error("Google Drive client is partially configured. Provide JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID and JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET together.");
  }
  if (!CLIENT_ID.test(clientId)) throw new Error("JOB_RANGER_GOOGLE_DESKTOP_CLIENT_ID is not a Google OAuth client id.");
  if (!CLIENT_SECRET.test(clientSecret)) throw new Error("JOB_RANGER_GOOGLE_DESKTOP_CLIENT_SECRET has an unexpected format.");
  return { clientId, clientSecret };
}

export function writeGoogleClientConfig(outputDirectory, env) {
  const config = googleClientConfigFromEnv(env);
  mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, "google-desktop-client.json");
  rmSync(target, { force: true });
  if (config) writeFileSync(target, `${JSON.stringify(config)}\n`, { mode: 0o644 });
  return config ? target : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const written = writeGoogleClientConfig(path.join(root, "build", "google-oauth"), process.env);
    console.log(
      written
        ? "Google Drive: packaged Desktop OAuth client configuration written to build/google-oauth/."
        : "Google Drive: no Desktop OAuth client configured; this build will show Google Drive as not configured.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
