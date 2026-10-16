const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function runConfig(env = {}) {
  const script = `
    const config = require('./electron-builder.windows.cjs');
    process.stdout.write(JSON.stringify(config.win.azureSignOptions || null));
  `;
  return spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JOB_RANGER_REQUIRE_WINDOWS_SIGNING: "0",
      AZURE_TENANT_ID: "",
      AZURE_CLIENT_ID: "",
      AZURE_CLIENT_SECRET: "",
      JOB_RANGER_WINDOWS_SIGN_ENDPOINT: "",
      JOB_RANGER_WINDOWS_SIGN_ACCOUNT: "",
      JOB_RANGER_WINDOWS_SIGN_PROFILE: "",
      JOB_RANGER_WINDOWS_SIGN_PUBLISHER: "",
      ...env,
    },
    encoding: "utf8",
  });
}

async function run() {
  const tester = runConfig();
  assert.equal(tester.status, 0, tester.stderr);
  assert.equal(tester.stdout, "null", "tester builds may omit Windows signing configuration");

  const publicMissing = runConfig({ JOB_RANGER_REQUIRE_WINDOWS_SIGNING: "1" });
  assert.notEqual(publicMissing.status, 0, "stable public Windows builds must fail without signing configuration");
  assert.match(publicMissing.stderr, /code signing is required/i);

  const complete = runConfig({
    JOB_RANGER_REQUIRE_WINDOWS_SIGNING: "1",
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "secret",
    JOB_RANGER_WINDOWS_SIGN_ENDPOINT: "https://example.codesigning.azure.net/",
    JOB_RANGER_WINDOWS_SIGN_ACCOUNT: "job-ranger-signing",
    JOB_RANGER_WINDOWS_SIGN_PROFILE: "public-release",
    JOB_RANGER_WINDOWS_SIGN_PUBLISHER: "Job Ranger",
  });
  assert.equal(complete.status, 0, complete.stderr);
  const azure = JSON.parse(complete.stdout);
  assert.deepEqual(azure, {
    endpoint: "https://example.codesigning.azure.net/",
    codeSigningAccountName: "job-ranger-signing",
    certificateProfileName: "public-release",
    publisherName: "Job Ranger",
  });

  const notarizeHook = require("../scripts/notarize.cjs").default;
  const saved = {
    require: process.env.JOB_RANGER_REQUIRE_NOTARIZATION,
    id: process.env.APPLE_ID,
    appPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    legacyPassword: process.env.APPLE_ID_PASSWORD,
    team: process.env.APPLE_TEAM_ID,
  };

  try {
    delete process.env.APPLE_ID;
    delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
    delete process.env.APPLE_ID_PASSWORD;
    delete process.env.APPLE_TEAM_ID;

    process.env.JOB_RANGER_REQUIRE_NOTARIZATION = "1";
    await assert.rejects(
      () => notarizeHook({ electronPlatformName: "darwin", appOutDir: "/tmp/unused" }),
      /notarization is required/i,
      "stable public macOS builds must fail before notarization when credentials are absent",
    );

    process.env.JOB_RANGER_REQUIRE_NOTARIZATION = "0";
    await notarizeHook({ electronPlatformName: "darwin", appOutDir: "/tmp/unused" });
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("JOB_RANGER_REQUIRE_NOTARIZATION", saved.require);
    restore("APPLE_ID", saved.id);
    restore("APPLE_APP_SPECIFIC_PASSWORD", saved.appPassword);
    restore("APPLE_ID_PASSWORD", saved.legacyPassword);
    restore("APPLE_TEAM_ID", saved.team);
  }

  // A manual release build publishes nothing unless the dispatcher turns publish on: every step that
  // writes to a GitHub release, pushes, or writes a public provenance attestation is gated, and a
  // build-only run never receives the production signing identity.
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/release-build.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /\n      publish:\n(?:        .*\n)*?        default: false\n/);
  assert.match(workflow, /\n  PUBLISH_RELEASE: \$\{\{ \(github\.event_name == 'push' \|\| inputs\.publish\) && 'true' \|\| 'false' \}\}\n/);
  assert.equal((workflow.match(/PUBLISH_RELEASE\s*:/g) || []).length, 1, "PUBLISH_RELEASE must be defined only once, at workflow level");
  const jobs = workflow.split(/\n(?=  [a-z][\w-]*:\n)/);
  let gatedSteps = 0;
  let signingLines = 0;
  for (const job of jobs) {
    const jobGated = /^  [\w-]+:\n    needs: [\w-]+\n    if: github\.event_name == 'push' \|\| inputs\.publish\n/.test(job);
    for (const step of job.split(/\n(?=      - )/).slice(1)) {
      if (/gh release|gh api[^\n]*releases|action-gh-release|attest|git push|git tag/.test(step)) {
        assert.ok(jobGated || step.includes("\n        if: env.PUBLISH_RELEASE == 'true'\n"), `ungated publishing step:\n${step.slice(0, 200)}`);
        gatedSteps += 1;
      }
      const verifiesPublicSigning = /\n        if: steps\.release_tag\.outputs\.(signed|public) == 'true'\n/.test(step);
      for (const line of step.split("\n")) {
        if (/(secrets|vars)\.(AZURE_|MAC_CSC_|APPLE_|JOB_RANGER_WINDOWS_SIGN_)/.test(line)) {
          assert.ok(verifiesPublicSigning || line.includes("${{ env.PUBLISH_RELEASE == 'true' && "), `signing credential reaches a build-only run: ${line.trim()}`);
          signingLines += 1;
        }
      }
    }
  }
  assert.ok(gatedSteps >= 9, `expected to find every publishing step, found ${gatedSteps}`);
  assert.ok(signingLines >= 12, `expected to find the signing credentials, found ${signingLines}`);
  assert.match(workflow, /JOB_RANGER_REQUIRE_WINDOWS_SIGNING \}\}" == "1" && "\$PUBLISH_RELEASE" == "true" \]\]/);
  assert.match(workflow, /\[0-9\]\+\$ && "\$PUBLISH_RELEASE" == "true" \]\]/);
  assert.equal((workflow.match(/\n          persist-credentials: false\n/g) || []).length, 2);
  assert.equal((workflow.match(/name: Keep build-only candidate as a workflow artifact\n        if: env\.PUBLISH_RELEASE != 'true'\n/g) || []).length, 2);

  console.log("Distribution trust configuration tests passed!");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
