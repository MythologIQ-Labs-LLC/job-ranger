// Builds the standard PWA with Google Drive export CONFIGURED, for
// tests/pwa/drive-export-component.spec.ts only.
//
//   node scripts/build-pwa-drive-e2e.mjs  -> dist-pwa-drive-e2e/
//
// The default dist-pwa/ build stays unconfigured (tests/pwa/drive-default.spec.ts).
// The helper origin is the reserved, never-resolvable "https://helper.test" and the
// client ID is a dummy: the spec routes the helper popup and every googleapis.com
// request, so no real Google endpoint is ever contacted. Never deploy this output.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PWA_FLAVOR_ENV } from "./pwa-flavor.mjs";

const DRIVE_E2E_HELPER_ORIGIN = "https://helper.test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

const env = {
  ...process.env,
  [PWA_FLAVOR_ENV]: "standard",
  SOJOURNER_PWA_TEST_OUT_DIR: "dist-pwa-drive-e2e",
  VITE_SOJOURNER_GOOGLE_OAUTH_HELPER_ORIGIN: DRIVE_E2E_HELPER_ORIGIN,
  VITE_SOJOURNER_GOOGLE_WEB_CLIENT_ID: "sojourner-drive-e2e.apps.googleusercontent.com",
};
const result = spawnSync(process.execPath, [viteBin, "build", "--config", "vite.pwa.config.ts"], {
  cwd: root, stdio: "inherit", env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
