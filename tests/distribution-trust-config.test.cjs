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
      SOJOURNER_REQUIRE_WINDOWS_SIGNING: "0",
      SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR: "",
      SOJOURNER_SIGNTOOL_PATH: "",
      ...env,
    },
    encoding: "utf8",
  });
}

async function run() {
  const tester = runConfig();
  assert.equal(tester.status, 0, tester.stderr);
  assert.equal(tester.stdout, "null", "build-only candidates are never signed");

  const publicMissing = runConfig({ SOJOURNER_REQUIRE_WINDOWS_SIGNING: "1" });
  assert.notEqual(publicMissing.status, 0, "published Windows builds must fail without the signing client");
  assert.match(publicMissing.stderr, /code signing is required/i);

  const badClient = runConfig({ SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR: path.join(repoRoot, "does-not-exist") });
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
      SOJOURNER_REQUIRE_WINDOWS_SIGNING: "1",
      SOJOURNER_WINDOWS_SIGNING_CLIENT_DIR: clientDir,
      SOJOURNER_SIGNTOOL_PATH: fakeSignTool,
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
  assert.deepEqual(signer.signToolArgs("out/Sojourner.exe", "client/dlib.dll", "metadata.json"), [
    "sign", "/v", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256",
    "/dlib", "client/dlib.dll", "/dmdf", "metadata.json", "out/Sojourner.exe",
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
    require: process.env.SOJOURNER_REQUIRE_NOTARIZATION,
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

    process.env.SOJOURNER_REQUIRE_NOTARIZATION = "1";
    await assert.rejects(
      () => notarizeHook({ electronPlatformName: "darwin", appOutDir: "/tmp/unused" }),
      /notarization is required/i,
      "stable public macOS builds must fail before notarization when credentials are absent",
    );

    process.env.SOJOURNER_REQUIRE_NOTARIZATION = "0";
    await notarizeHook({ electronPlatformName: "darwin", appOutDir: "/tmp/unused" });
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("SOJOURNER_REQUIRE_NOTARIZATION", saved.require);
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
    const jobGated =
      /^  [\w-]+:\n    needs: [\w-]+\n    if: (?:github\.event_name == 'push' \|\| inputs\.publish|github\.event_name == 'workflow_dispatch' && inputs\.publish)\n/.test(job);
    for (const step of job.split(/\n(?=      - )/).slice(1)) {
      if (/gh release|gh api[^\n]*releases|action-gh-release|attest|git push|git tag/.test(step)) {
        assert.ok(jobGated || step.includes("\n        if: env.PUBLISH_RELEASE == 'true'\n"), `ungated publishing step:\n${step.slice(0, 200)}`);
        gatedSteps += 1;
      }
      const verifiesPublicSigning = /\n        if: steps\.release_tag\.outputs\.(signed|public) == 'true'\n/.test(step);
      for (const line of step.split("\n")) {
        if (/(secrets|vars)\.(AZURE_|MAC_CSC_|APPLE_|SOJOURNER_WINDOWS_SIGN_)/.test(line)) {
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
  // Sojourner releases (#363): titled Sojourner, alpha/beta/rc tags are GitHub pre-releases, and the
  // signed direct-download installer is Sojourner-v<version>-windows-x64.exe.
  assert.equal((workflow.match(/--title "/g) || []).length, 6, "every release title is the Sojourner one");
  assert.equal((workflow.match(/--title "Sojourner \$tag"/g) || []).length, 6);
  assert.equal(
    (workflow.match(/\n          if \[\[ "\$tag" == \*-alpha\* \|\| "\$tag" == \*-beta\* \|\| "\$tag" == \*-rc\.\* \]\]; then\n            create_args=\(--title "Sojourner \$tag" --generate-notes --prerelease\)\n/g) || []).length,
    2,
    "alpha, beta and rc tags create pre-releases",
  );
  assert.doesNotMatch(workflow, /release\/Job\*windows\*\.exe/);
  assert.match(workflow, /subject-path: release\/Sojourner\*windows\*\.exe\n/);
  // A pushed v* tag never builds or publishes the Microsoft Store package; it stays available
  // through a manual dispatch with platform windows-store only.
  assert.match(workflow, /\n  store-package:\n    if: github\.event_name == 'workflow_dispatch' && inputs\.platform == 'windows-store'\n/);
  assert.match(workflow, /\n  publish-store-package:\n    needs: store-package\n    if: github\.event_name == 'workflow_dispatch' && inputs\.publish\n/);
  assert.match(workflow, /\non:\n  push:\n    tags:\n      - "v\*"\n  workflow_dispatch:\n/, "triggers are unchanged");
  assert.equal((workflow.match(/\n          persist-credentials: false\n/g) || []).length, 2);
  assert.equal((workflow.match(/name: Keep build-only candidate as a workflow artifact\n        if: env\.PUBLISH_RELEASE != 'true'\n/g) || []).length, 2);

  // A pushed v* tag publishes only the signed Windows release, after owner approval: the web/PWA
  // build and its publication run only from a manual dispatch (PWA publication has its own gate).
  assert.match(workflow, /\n  web:\n(?:    #.*\n)*    if: github\.event_name == 'workflow_dispatch' && /);
  assert.match(workflow, /\n  publish-web:\n    needs: web\n    if: github\.event_name == 'workflow_dispatch' && inputs\.publish\n/);

  console.log("Distribution trust configuration tests passed!");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
