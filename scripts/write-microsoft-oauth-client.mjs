// Generates the Microsoft identity platform client configuration that a packaged
// Sojourner (Windows) reads from resources/microsoft-oauth/microsoft-client.json for the
// OneDrive storage location (#249). Runs before electron-builder in the electron:build,
// electron:build:win and electron:pack scripts; electron-builder.json copies the file
// into resources (Windows). release-build.yml passes the repository variable.
//
// Input (environment: the release-build.yml repository variable; never committed):
//   SOJOURNER_MICROSOFT_CLIENT_ID          the app registration's Application (client) ID
//   SOJOURNER_REQUIRE_MICROSOFT_CLIENT=1   fail when it is absent
//
// The registration is a PUBLIC client: no secret exists or is needed. Security rests on
// PKCE, the loopback redirect and the person's own consent. Without the id the build
// still succeeds and the app shows OneDrive as not set up.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function microsoftClientConfigFromEnv(env) {
  const clientId = env.SOJOURNER_MICROSOFT_CLIENT_ID?.trim() ?? "";
  if (!clientId) {
    if (env.SOJOURNER_REQUIRE_MICROSOFT_CLIENT === "1") {
      throw new Error("SOJOURNER_REQUIRE_MICROSOFT_CLIENT=1 but no Microsoft client id was provided.");
    }
    return null;
  }
  if (!CLIENT_ID.test(clientId)) throw new Error("SOJOURNER_MICROSOFT_CLIENT_ID is not a Microsoft application (client) id.");
  return { clientId: clientId.toLowerCase() };
}

export function writeMicrosoftClientConfig(outputDirectory, env) {
  const config = microsoftClientConfigFromEnv(env);
  mkdirSync(outputDirectory, { recursive: true });
  const target = path.join(outputDirectory, "microsoft-client.json");
  rmSync(target, { force: true });
  if (config) writeFileSync(target, `${JSON.stringify(config)}\n`, { mode: 0o644 });
  return config ? target : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const written = writeMicrosoftClientConfig(path.join(root, "build", "microsoft-oauth"), process.env);
    console.log(
      written
        ? "OneDrive: packaged Microsoft client configuration written to build/microsoft-oauth/."
        : "OneDrive: no Microsoft client configured; the OneDrive storage location is shown as not set up in this build.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
