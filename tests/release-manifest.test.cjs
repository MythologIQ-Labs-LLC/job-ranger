const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function run() {
  const { generateReleaseManifest, selectPlatformArtifacts } = await import(
    "../scripts/generate-release-manifest.mjs"
  );

  assert.deepEqual(
    selectPlatformArtifacts(
      [
        "Job.Ranger-v1.2.0-windows-x64.exe.blockmap",
        "Job.Ranger-v1.2.0-windows-x64.exe",
        "latest.yml",
      ],
      "windows",
    ),
    ["Job.Ranger-v1.2.0-windows-x64.exe"],
  );
  assert.deepEqual(
    selectPlatformArtifacts(
      [
        "Job.Ranger-v1.2.0-macos-x64.zip",
        "Job.Ranger-v1.2.0-macos-arm64.dmg",
        "Job.Ranger-v1.2.0-windows-x64.exe",
      ],
      "macos",
    ),
    ["Job.Ranger-v1.2.0-macos-arm64.dmg", "Job.Ranger-v1.2.0-macos-x64.zip"],
  );
  assert.deepEqual(
    selectPlatformArtifacts(
      [
        "Job Ranger-v1.3.0-windows-store-x64.appx",
        "Job Ranger-v1.3.0-windows-x64.exe",
        "job-ranger-web-v1.3.0.zip",
      ],
      "windows-store",
    ),
    ["Job Ranger-v1.3.0-windows-store-x64.appx"],
  );
  assert.deepEqual(
    selectPlatformArtifacts(["job-ranger-web-v1.3.0.zip", "Job Ranger-v1.3.0-windows-x64.exe"], "web"),
    ["job-ranger-web-v1.3.0.zip"],
  );
  // The demo flavor archive is never mistaken for the standard web release.
  assert.deepEqual(
    selectPlatformArtifacts(["job-ranger-web-demo-v1.3.0.zip", "job-ranger-web-v1.3.0.zip"], "web"),
    ["job-ranger-web-v1.3.0.zip"],
  );
  assert.throws(() => selectPlatformArtifacts([], "linux"), /Unsupported release-manifest platform/);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "job-ranger-release-manifest-"));
  const releaseDirectory = path.join(root, "release");
  const outputDirectory = path.join(root, "trust");

  try {
    await fs.mkdir(releaseDirectory, { recursive: true });
    await fs.mkdir(outputDirectory, { recursive: true });
    const installerName = "Job.Ranger-v1.2.0-rc.4-windows-x64.exe";
    const installerBytes = Buffer.from("job-ranger-test-installer");
    await fs.writeFile(path.join(releaseDirectory, installerName), installerBytes);
    await fs.writeFile(
      path.join(releaseDirectory, `${installerName}.blockmap`),
      Buffer.from("ignored-blockmap"),
    );

    await assert.rejects(
      () =>
        generateReleaseManifest({
          platform: "windows",
          tag: "v1.2.0-rc.4",
          publicRelease: false,
          releaseDirectory,
          outputDirectory,
          trustEvidenceFile: "windows-signing.json",
          smokeEvidenceFile: "windows-package-smoke.json",
          generatedAt: "2026-10-04T23:00:00.000Z",
        }),
      /Required trust evidence was not found/,
    );

    await fs.writeFile(
      path.join(outputDirectory, "windows-signing.json"),
      `${JSON.stringify({ requireSigned: false, artifacts: [] })}\n`,
    );

    await assert.rejects(
      () =>
        generateReleaseManifest({
          platform: "windows",
          tag: "v1.2.0-rc.4",
          publicRelease: false,
          releaseDirectory,
          outputDirectory,
          trustEvidenceFile: "windows-signing.json",
          smokeEvidenceFile: "windows-package-smoke.json",
          generatedAt: "2026-10-04T23:00:00.000Z",
        }),
      /Required package smoke evidence was not found/,
    );

    await fs.writeFile(
      path.join(outputDirectory, "windows-package-smoke.json"),
      `${JSON.stringify({ schemaVersion: 1, status: "passed" })}\n`,
    );

    const { manifest, checksumPath, manifestPath } = await generateReleaseManifest({
      platform: "windows",
      tag: "v1.2.0-rc.4",
      publicRelease: false,
      releaseDirectory,
      outputDirectory,
      trustEvidenceFile: "windows-signing.json",
      smokeEvidenceFile: "windows-package-smoke.json",
      generatedAt: "2026-10-04T23:00:00.000Z",
    });

    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.tag, "v1.2.0-rc.4");
    assert.equal(manifest.platform, "windows");
    assert.equal(manifest.publicRelease, false);
    assert.equal(manifest.testerOnly, true);
    assert.equal(manifest.trustEvidenceFile, "windows-signing.json");
    assert.equal(manifest.packageSmokeEvidenceFile, "windows-package-smoke.json");
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].name, installerName);
    assert.equal(manifest.artifacts[0].bytes, installerBytes.length);
    assert.equal(manifest.artifacts[0].sha256, sha256(installerBytes));

    const checksums = await fs.readFile(checksumPath, "utf8");
    assert.equal(checksums, `${sha256(installerBytes)}  ${installerName}\n`);

    const persistedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.deepEqual(persistedManifest, manifest);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log("Release manifest tests passed!");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
