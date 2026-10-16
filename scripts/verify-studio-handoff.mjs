/**
 * Local/remote opt-in verification. Never enables Studio publication.
 *
 * node scripts/verify-studio-handoff.mjs --site dist-pwa --flavor standard [--build-id VERSION+SHA]
 * node scripts/verify-studio-handoff.mjs --origin https://jobs.example.org --build-id VERSION+SHA --build-info-sha256 APPROVED_DIGEST --flavor standard
 *
 * --flavor is REQUIRED: it pins the expected build flavor (the demo flavor's
 * build ID ends in ".demo"), so a demo artifact is never accepted where the
 * standard workspace is expected, or the reverse. A build made before flavors
 * existed (no `flavor` in build-info.json) verifies only as `standard`, and only
 * if its build ID has no ".demo" suffix.
 */
import { inspectStudioPwaBuild, inspectLiveStudioPwa } from "./studio-handoff.mjs";
import { parsePwaFlavor } from "./pwa-flavor.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const USAGE = "Usage: --site DIR --flavor standard|demo [--build-id ID] OR --origin HTTPS_ORIGIN --build-id ID --build-info-sha256 APPROVED_DIGEST --flavor standard|demo";

export async function run(args = process.argv.slice(2)) {
  let site = null;
  let origin = null;
  let buildId = null;
  let approvedDigest = null;
  let flavor = null;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || !["--site", "--origin", "--build-id", "--build-info-sha256", "--flavor"].includes(flag)) {
      throw new Error(USAGE);
    }
    if (flag === "--site") site = value;
    if (flag === "--origin") origin = value;
    if (flag === "--build-id") buildId = value;
    if (flag === "--build-info-sha256") approvedDigest = value;
    if (flag === "--flavor") flavor = parsePwaFlavor(value);
  }
  if (Boolean(site) === Boolean(origin) || (origin && (!buildId || !approvedDigest))) {
    throw new Error("Exactly one of --site and --origin is required; --origin also requires a pinned build ID and approved build-info SHA-256");
  }
  if (!flavor) throw new Error("--flavor standard|demo is required. " + USAGE);
  const result = site
    ? await inspectStudioPwaBuild(site, buildId ?? undefined, flavor)
    : await inspectLiveStudioPwa(origin, buildId, approvedDigest, flavor);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run()
    .then((value) => console.log(JSON.stringify(value, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
