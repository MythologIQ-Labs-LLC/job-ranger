// Packages the production web/PWA build (dist-pwa/) into a deterministic,
// provenance-friendly release archive: release/job-ranger-web-v<version>.zip
// plus build/trust/web-build-info.json (build identity, CSP, asset SHA-256s).
// Source maps are excluded from the deployable archive.
//
// The demo flavor (`--flavor demo` or JOB_RANGER_PWA_FLAVOR=demo) packages
// dist-pwa-demo/ into the deliberately distinct
// release/job-ranger-web-demo-v<version>.zip + build/trust/web-demo-build-info.json,
// and refuses a build whose recorded flavor differs from the requested one.
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { inspectStudioPwaBuild } from "./studio-handoff.mjs";
import { PWA_FLAVOR_ENV, parsePwaFlavor, pwaArchiveName, pwaOutDirName, pwaTrustFileName } from "./pwa-flavor.mjs";

function requestedFlavor(args) {
  const index = args.indexOf("--flavor");
  if (index >= 0) return parsePwaFlavor(args[index + 1] ?? "invalid: missing value");
  if (args.length > 0) throw new Error("Usage: node scripts/package-pwa.mjs [--flavor standard|demo]");
  return parsePwaFlavor(process.env[PWA_FLAVOR_ENV]);
}

const flavor = requestedFlavor(process.argv.slice(2));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distName = pwaOutDirName(flavor);
const dist = path.join(root, distName);
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const buildInfo = JSON.parse(await readFile(path.join(dist, "build-info.json"), "utf8"));

async function list(directory, base = directory) {
  const output = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name);
    if ((await stat(full)).isDirectory()) output.push(...(await list(full, base)));
    else output.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return output;
}

const files = (await list(dist)).filter((file) => !file.endsWith(".map"));
for (const required of ["index.html", "sw.js", "_headers", "manifest.webmanifest", "build-info.json", "studio-handoff.json"]) {
  if (!files.includes(required)) {
    throw new Error(`${distName} is missing ${required}; run ${flavor === "demo" ? "npm run build:pwa:demo" : "npm run build:pwa"}`);
  }
}
// Refuse to package a partial, tampered, mismatched or wrong-flavor Studio-facing PWA.
const handoffValidation = await inspectStudioPwaBuild(dist, buildInfo.buildId, flavor);
console.log(`Studio handoff contract verified for ${handoffValidation.buildId}`);
const fixedTime = new Date("2000-01-01T00:00:00Z");
const entries = {};
for (const file of files) {
  entries[file] = [new Uint8Array(await readFile(path.join(dist, file))), { mtime: fixedTime, level: 6 }];
}
const zip = zipSync(entries);
await mkdir(path.join(root, "release"), { recursive: true });
await mkdir(path.join(root, "build", "trust"), { recursive: true });
const zipName = pwaArchiveName(version, flavor);
await writeFile(path.join(root, "release", zipName), zip);
await writeFile(
  path.join(root, "build", "trust", pwaTrustFileName(flavor)),
  `${JSON.stringify({ ...buildInfo, archive: { name: zipName, sha256: createHash("sha256").update(zip).digest("hex"), bytes: zip.length } }, null, 2)}\n`,
);
console.log(`Packaged ${files.length} files into release/${zipName} (${flavor} flavor, build ${buildInfo.buildId})`);
