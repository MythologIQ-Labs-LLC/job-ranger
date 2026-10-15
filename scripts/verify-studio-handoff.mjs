/**
 * Local/remote opt-in verification. Never enables Studio publication.
 *
 * node scripts/verify-studio-handoff.mjs --site dist-pwa [--build-id VERSION+SHA]
 * node scripts/verify-studio-handoff.mjs --origin https://jobs.example.org --build-id VERSION+SHA --build-info-sha256 APPROVED_DIGEST
 */
import { inspectStudioPwaBuild, inspectLiveStudioPwa } from "./studio-handoff.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function run(args = process.argv.slice(2)) {
  let site = null;
  let origin = null;
  let buildId = null;
  let approvedDigest = null;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || !["--site", "--origin", "--build-id", "--build-info-sha256"].includes(flag)) {
      throw new Error("Usage: --site DIR [--build-id ID] OR --origin HTTPS_ORIGIN --build-id ID --build-info-sha256 APPROVED_DIGEST");
    }
    if (flag === "--site") site = value;
    if (flag === "--origin") origin = value;
    if (flag === "--build-id") buildId = value;
    if (flag === "--build-info-sha256") approvedDigest = value;
  }
  if (Boolean(site) === Boolean(origin) || (origin && (!buildId || !approvedDigest))) {
    throw new Error("Exactly one of --site and --origin is required; --origin also requires a pinned build ID and approved build-info SHA-256");
  }
  const result = site
    ? await inspectStudioPwaBuild(site, buildId ?? undefined)
    : await inspectLiveStudioPwa(origin, buildId, approvedDigest);
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
