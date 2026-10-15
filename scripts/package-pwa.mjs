// Packages the production web/PWA build (dist-pwa/) into a deterministic,
// provenance-friendly release archive: release/job-ranger-web-v<version>.zip
// plus build/trust/web-build-info.json (build identity, CSP, asset SHA-256s).
// Source maps are excluded from the deployable archive.
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { inspectStudioPwaBuild } from "./studio-handoff.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist-pwa");
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
  if (!files.includes(required)) throw new Error(`dist-pwa is missing ${required}; run npm run build:pwa`);
}
// Refuse to package a partial, tampered or mismatched Studio-facing PWA.
const handoffValidation = await inspectStudioPwaBuild(dist, buildInfo.buildId);
console.log(`Studio handoff contract verified for ${handoffValidation.buildId}`);
const fixedTime = new Date("2000-01-01T00:00:00Z");
const entries = {};
for (const file of files) {
  entries[file] = [new Uint8Array(await readFile(path.join(dist, file))), { mtime: fixedTime, level: 6 }];
}
const zip = zipSync(entries);
await mkdir(path.join(root, "release"), { recursive: true });
await mkdir(path.join(root, "build", "trust"), { recursive: true });
const zipName = `job-ranger-web-v${version}.zip`;
await writeFile(path.join(root, "release", zipName), zip);
await writeFile(
  path.join(root, "build", "trust", "web-build-info.json"),
  `${JSON.stringify({ ...buildInfo, archive: { name: zipName, sha256: createHash("sha256").update(zip).digest("hex"), bytes: zip.length } }, null, 2)}\n`,
);
console.log(`Packaged ${files.length} files into release/${zipName} (build ${buildInfo.buildId})`);
