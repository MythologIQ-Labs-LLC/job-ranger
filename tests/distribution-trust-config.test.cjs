const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function runConfig(env = {}) {
  const script = `
    const config = require('./electron-builder.windows.cjs');
    process.stdout.write(JSON.stringify(config.win.signtoolOptions || null));
  `;
  return spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JOB_RANGER_REQUIRE_WINDOWS_SIGNING: "0",
      JOB_RANGER_WINDOWS_SIGNING_CLIENT_DIR: "",
      JOB_RANGER_SIGNTOOL_PATH: "",
      ...env,
    },
    encoding: "utf8",
  });
}

async function run() {
  const tester = runConfig();
  assert.equal(tester.status, 0, tester.stderr);
  assert.equal(tester.stdout, "null", "build-only candidates are never signed");

  const publicMissing = runConfig({ JOB_RANGER_REQUIRE_WINDOWS_SIGNING: "1" });
  assert.notEqual(publicMissing.status, 0, "published Windows builds must fail without the signing client");
  assert.match(publicMissing.stderr, /code signing is required/i);

  const badClient = runConfig({ JOB_RANGER_WINDOWS_SIGNING_CLIENT_DIR: path.join(repoRoot, "does-not-exist") });
  assert.notEqual(badClient.status, 0, "a configured but missing signing client fails closed");
  assert.match(badClient.stderr, /Artifact Signing client not found/);

  // A complete signing setup: a fake client folder and SignTool path.
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), "sojourner-signing-client-"));
  fs.mkdirSync(path.join(clientDir, "bin", "x64"), { recursive: true });
  fs.writeFileSync(path.join(clientDir, "bin", "x64", "Azure.CodeSigning.Dlib.dll"), "");
  const fakeSignTool = path.join(clientDir, "signtool.exe");
  fs.writeFileSync(fakeSignTool, "");
  try {
    const complete = runConfig({
      JOB_RANGER_REQUIRE_WINDOWS_SIGNING: "1",
      JOB_RANGER_WINDOWS_SIGNING_CLIENT_DIR: clientDir,
      JOB_RANGER_SIGNTOOL_PATH: fakeSignTool,
    });
    assert.equal(complete.status, 0, complete.stderr);
    assert.deepEqual(JSON.parse(complete.stdout), {
      sign: path.join(repoRoot, "scripts", "windows-sign.cjs"),
      signingHashAlgorithms: ["sha256"],
    });
  } finally {
    fs.rmSync(clientDir, { recursive: true, force: true });
  }

  // The signer follows the Windows code signing standard: the organization's profile, SHA-256,
  // RFC 3161 timestamping, and the Azure CLI credential only (GitHub OIDC or `az login`, no secret).
  const signer = require("../scripts/windows-sign.cjs");
  assert.equal(typeof signer, "function", "electron-builder loads the module as its sign hook");
  assert.deepEqual(
    { ...signer.ARTIFACT_SIGNING, ExcludeCredentials: undefined },
    {
      Endpoint: "https://eus.codesigning.azure.net/",
      CodeSigningAccountName: "MythologIQ-Labs-Signing",
      CertificateProfileName: "mythologiq-labs-public-release",
      ExcludeCredentials: undefined,
    },
  );
  for (const credential of ["EnvironmentCredential", "ManagedIdentityCredential", "InteractiveBrowserCredential"]) {
    assert.ok(signer.ARTIFACT_SIGNING.ExcludeCredentials.includes(credential), `${credential} is excluded`);
  }
  assert.ok(!signer.ARTIFACT_SIGNING.ExcludeCredentials.includes("AzureCliCredential"), "the Azure CLI credential stays allowed");
  assert.deepEqual(signer.signToolArgs("out/Job Ranger.exe", "client/dlib.dll", "metadata.json"), [
    "sign", "/v", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256",
    "/dlib", "client/dlib.dll", "/dmdf", "metadata.json", "out/Job Ranger.exe",
  ]);
  assert.equal(signer.resolveSigning({}), null);
  assert.throws(() => signer.signFile("x.exe", {}), /not configured/);
  for (const forbidden of ["AZURE_CLIENT_SECRET", "azureSignOptions"]) {
    for (const file of ["electron-builder.windows.cjs", "scripts/windows-sign.cjs", ".github/workflows/release-build.yml"]) {
      assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, file), "utf8"), new RegExp(forbidden), `${file} uses no ${forbidden}`);
    }
  }

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
  assert.ok(signingLines >= 13, `expected to find the signing credentials, found ${signingLines}`);
  // Every published Windows installer is signed; only publishing runs enter the release environment,
  // which holds the owner-approved GitHub OIDC sign-in.
  assert.match(workflow, /\n          # Every published Windows installer is signed; a build-only candidate never is\.\n          if \[\[ "\$PUBLISH_RELEASE" == "true" \]\]; then\n            echo "signed=true"/);
  assert.match(workflow, /\n  build-windows:\n(?:    .*\n)*?    environment: \$\{\{ \(github\.event_name == 'push' \|\| inputs\.publish\) && 'release' \|\| '' \}\}\n/);
  assert.equal((workflow.match(/\n    environment: /g) || []).length, 1, "only the Windows signing job uses an environment");
  assert.match(workflow, /uses: azure\/login@v2\n        with:\n          client-id: \$\{\{ vars\.AZURE_CLIENT_ID \}\}/);
  assert.match(workflow, /node scripts\/windows-sign\.cjs build\/sqlite\/sqlite3\.exe/);
  assert.match(workflow, /verify-windows-distribution\.ps1 -RequireSigned:\$requireSigned/);
  assert.match(workflow, /\[0-9\]\+\$ && "\$PUBLISH_RELEASE" == "true" \]\]/);
  assert.equal((workflow.match(/\n          persist-credentials: false\n/g) || []).length, 2);
  assert.equal((workflow.match(/name: Keep build-only candidate as a workflow artifact\n        if: env\.PUBLISH_RELEASE != 'true'\n/g) || []).length, 2);

  console.log("Distribution trust configuration tests passed!");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
