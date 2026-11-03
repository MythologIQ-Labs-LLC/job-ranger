const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerBackend } = require("../electron-runtime/electron/src/career-backend.cjs");

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-authored-evidence-"));

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("user-authored evidence smoke test must not use the network");
      },
    });
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const career = new CareerBackend({
      dataDirectory: tempDir,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await career.initialize();

    const created = await career.createUserEvidence({
      subjectType: "project",
      statement: "Built a volunteer scheduling tool for a community food pantry.",
      organization: "Harbor Food Pantry",
      titleOrName: "Volunteer scheduling tool",
      startDate: "2025",
      skills: ["TypeScript", "Scheduling", "TypeScript"],
    });

    assert.match(created.id, /^evidence-/);
    assert.equal(created.verificationState, "user-authored");
    assert.equal(created.confidence, null);
    assert.equal(created.organization, "Harbor Food Pantry");
    assert.deepEqual(created.skills, ["TypeScript", "Scheduling"]);
    assert.equal(created.credential, null);

    const credential = await career.createUserEvidence({
      subjectType: "credential",
      statement: "Active Maryland Registered Nurse license.",
      titleOrName: "Registered Nurse License",
      skills: ["registered nursing"],
      credential: {
        issuer: "Maryland Board of Nursing",
        jurisdiction: "Maryland",
        status: "active",
        expirationDate: "2027-12-31",
        credentialId: "RN-EXAMPLE-001",
      },
    });
    assert.equal(credential.verificationState, "user-authored");
    assert.deepEqual(credential.credential, {
      issuer: "Maryland Board of Nursing",
      jurisdiction: "Maryland",
      status: "active",
      expirationDate: "2027-12-31",
      credentialId: "RN-EXAMPLE-001",
    });

    const listed = await career.listEvidence();
    const item = listed.find(({ evidence }) => evidence.id === created.id);
    assert.ok(item, "user-authored evidence must participate in the canonical evidence list");
    assert.deepEqual(item.sources, [], "user-authored evidence must not invent a source artifact");
    const credentialItem = listed.find(({ evidence }) => evidence.id === credential.id);
    assert.ok(credentialItem, "credential evidence must participate in the canonical evidence list");
    assert.deepEqual(credentialItem.sources, [], "direct credential evidence must not invent a source artifact");

    const edited = await career.reviewEvidence(created.id, {
      action: "edit",
      statement: "Built and maintained a volunteer scheduling tool for a community food pantry.",
      subjectType: "project",
    });
    assert.equal(
      edited.verificationState,
      "user-authored",
      "editing direct evidence must preserve user-authored authority",
    );

    await backend.dispose();

    const reloadedBackend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("user-authored evidence smoke test must not use the network");
      },
    });
    await reloadedBackend.initialize();
    const reloadedStatus = await reloadedBackend.getSystemStatus(process.platform);
    const reloadedCareer = new CareerBackend({
      dataDirectory: tempDir,
      databasePath: reloadedStatus.databasePath,
      sqliteBinaryPath: reloadedStatus.sqliteBinaryPath,
    });
    await reloadedCareer.initialize();
    const reloadedEvidence = await reloadedCareer.listEvidence();
    const persisted = reloadedEvidence.find(
      ({ evidence }) => evidence.id === created.id,
    );
    assert.ok(persisted, "user-authored evidence must survive restart");
    assert.equal(persisted.evidence.verificationState, "user-authored");
    assert.match(persisted.evidence.statement, /Built and maintained/);

    const persistedCredential = reloadedEvidence.find(
      ({ evidence }) => evidence.id === credential.id,
    );
    assert.ok(persistedCredential, "structured credential evidence must survive restart");
    assert.equal(persistedCredential.evidence.verificationState, "user-authored");
    assert.deepEqual(persistedCredential.evidence.credential, credential.credential);

    const retyped = await reloadedCareer.reviewEvidence(credential.id, {
      action: "edit",
      statement: "Completed RN preparation coursework.",
      subjectType: "education",
    });
    assert.equal(retyped.credential, null, "changing a fact away from credential must clear credential-only structure");

    await reloadedBackend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
