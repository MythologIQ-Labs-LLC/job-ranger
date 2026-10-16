import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM_PATTERNS = {
  windows: /^Job.*windows.*\.exe$/i,
  "windows-store": /^Job.*windows-store.*\.appx$/i,
  macos: /^Job.*macos.*\.(?:dmg|zip)$/i,
  // The demo flavor's archive (job-ranger-web-demo-v*.zip) is never the web release artifact.
  web: /^job-ranger-web-v\d[^/\\]*\.zip$/i,
};

function parseBoolean(value) {
  return value === true || value === "true" || value === "1";
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function selectPlatformArtifacts(entries, platform) {
  const pattern = PLATFORM_PATTERNS[platform];
  if (!pattern) throw new Error(`Unsupported release-manifest platform: ${platform}`);
  return entries.filter((entry) => pattern.test(entry)).sort((a, b) => a.localeCompare(b));
}

async function requireEvidenceFile(outputDirectory, fileName, label) {
  const evidencePath = path.join(outputDirectory, path.basename(fileName));
  let evidenceStat;
  try {
    evidenceStat = await stat(evidencePath);
  } catch {
    throw new Error(`Required ${label} evidence was not found: ${evidencePath}`);
  }
  if (!evidenceStat.isFile() || evidenceStat.size === 0) {
    throw new Error(`Required ${label} evidence is empty or not a file: ${evidencePath}`);
  }
  return path.basename(fileName);
}

export async function generateReleaseManifest({
  platform,
  tag,
  publicRelease = false,
  releaseDirectory = "release",
  outputDirectory = "build/trust",
  trustEvidenceFile,
  smokeEvidenceFile,
  generatedAt = new Date().toISOString(),
}) {
  if (!tag || typeof tag !== "string") throw new Error("Release tag is required.");
  if (!trustEvidenceFile || typeof trustEvidenceFile !== "string") {
    throw new Error("Trust evidence filename is required.");
  }
  if (!smokeEvidenceFile || typeof smokeEvidenceFile !== "string") {
    throw new Error("Package smoke evidence filename is required.");
  }

  const entries = await readdir(releaseDirectory);
  const artifactNames = selectPlatformArtifacts(entries, platform);
  if (artifactNames.length === 0) {
    throw new Error(`No ${platform} release artifacts were found in ${releaseDirectory}.`);
  }

  const artifacts = [];
  for (const name of artifactNames) {
    const filePath = path.join(releaseDirectory, name);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) continue;
    artifacts.push({
      name,
      bytes: fileStat.size,
      sha256: await sha256File(filePath),
    });
  }

  if (artifacts.length === 0) {
    throw new Error(`No ${platform} release files remained after validation.`);
  }

  await mkdir(outputDirectory, { recursive: true });
  const trustEvidenceName = await requireEvidenceFile(
    outputDirectory,
    trustEvidenceFile,
    "trust",
  );
  const smokeEvidenceName = await requireEvidenceFile(
    outputDirectory,
    smokeEvidenceFile,
    "package smoke",
  );

  const checksumPath = path.join(outputDirectory, `${platform}-SHA256SUMS.txt`);
  const manifestPath = path.join(outputDirectory, `${platform}-release-manifest.json`);
  const publicFlag = parseBoolean(publicRelease);

  await writeFile(
    checksumPath,
    artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join("\n") + "\n",
    "utf8",
  );

  const manifest = {
    schemaVersion: 2,
    tag,
    platform,
    generatedAt,
    publicRelease: publicFlag,
    testerOnly: !publicFlag,
    trustEvidenceFile: trustEvidenceName,
    packageSmokeEvidenceFile: smokeEvidenceName,
    artifacts,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { manifest, checksumPath, manifestPath };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const platform = args.platform;
  const trustEvidenceFile =
    args["trust-evidence"] ??
    (platform === "windows" ? "windows-signing.json" : "macos-signing.txt");
  const smokeEvidenceFile =
    args["smoke-evidence"] ?? `${platform}-package-smoke.json`;

  generateReleaseManifest({
    platform,
    tag: args.tag,
    publicRelease: args.public,
    releaseDirectory: args["release-dir"] ?? "release",
    outputDirectory: args["output-dir"] ?? "build/trust",
    trustEvidenceFile,
    smokeEvidenceFile,
  })
    .then(({ manifestPath, checksumPath }) => {
      console.log(`Release trust manifest: ${manifestPath}`);
      console.log(`Release checksums: ${checksumPath}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
