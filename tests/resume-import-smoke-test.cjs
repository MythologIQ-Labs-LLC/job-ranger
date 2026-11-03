const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron/backend.cjs");
const { CareerBackend } = require("../electron/career-backend.cjs");
const {
  canEvidenceSupportFactualClaim,
} = require("../electron/career-contracts.cjs");

async function createCareerBackend(jobBackend, dataDirectory) {
  const status = await jobBackend.getSystemStatus(process.platform);
  const career = new CareerBackend({
    dataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await career.initialize();
  return career;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-resume-import-"));

  try {
    const jobBackend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
    });
    await jobBackend.initialize();
    const career = await createCareerBackend(jobBackend, tempDir);

    const sourceText = [
      "# Professional Experience",
      "Operations Coordinator at Northstar Distribution | 2022 - Present",
      "- Coordinated vendor schedules across 12 regional locations.",
      "- Created weekly operational reports in Excel.",
      "# Skills",
      "Scheduling, Vendor coordination, Excel",
      "# Certifications",
      "OSHA 10 certification",
    ].join("\n");

    const imported = await career.importPastedText({
      label: "Synthetic operations resume",
      text: sourceText,
    });

    assert.equal(imported.duplicate, false);
    assert.equal(imported.failureCode, null);
    assert.equal(imported.artifact.extractionState, "review-required");
    assert.equal(imported.artifact.parserId, "sojourner/native-text");
    assert.equal(imported.artifact.parserVersion, "1");
    assert.ok(imported.extractionSnapshot, "extraction snapshot should exist");
    assert.equal(imported.extractionSnapshot.parserId, "sojourner/native-text");
    assert.equal(imported.extractionSnapshot.rawText, sourceText);
    assert.ok(imported.proposedEvidence.length >= 5, "expected reviewable evidence proposals");
    assert.equal(
      imported.proposedEvidence.every((item) => item.verificationState === "imported"),
      true,
      "imports must remain unconfirmed until review",
    );
    assert.equal(
      imported.proposedEvidence.some((item) => canEvidenceSupportFactualClaim(item)),
      false,
      "unreviewed imported evidence must not support factual claims",
    );

    const preservedBytes = await fs.readFile(imported.artifact.managedPath);
    assert.equal(preservedBytes.toString("utf8"), sourceText);
    assert.equal(imported.artifact.contentHash, sha256(preservedBytes));
    assert.match(
      imported.artifact.managedPath,
      /artifacts[\\/]sources[\\/]artifact-/,
      "source must live in managed artifact storage",
    );

    const duplicate = await career.importPastedText({
      label: "Same source imported again",
      text: sourceText,
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.artifact.id, imported.artifact.id);
    assert.equal(
      (await career.listSourceArtifacts()).length,
      1,
      "duplicate bytes must not create another source artifact",
    );

    const reviewItems = await career.listEvidence();
    const achievement = reviewItems.find(
      ({ evidence }) =>
        evidence.statement === "Coordinated vendor schedules across 12 regional locations.",
    );
    assert.ok(achievement, "expected extracted achievement evidence");
    assert.equal(achievement.sources.length, 1);
    assert.equal(achievement.sources[0].sourceArtifactId, imported.artifact.id);
    assert.match(achievement.sources[0].sourceLocator ?? "", /^line:/);

    const confirmed = await career.reviewEvidence(achievement.evidence.id, {
      action: "confirm",
    });
    assert.equal(confirmed.verificationState, "user-confirmed");
    assert.equal(canEvidenceSupportFactualClaim(confirmed), true);

    const excel = reviewItems.find(
      ({ evidence }) => evidence.statement === "Excel",
    );
    assert.ok(excel, "expected extracted skill evidence");
    const edited = await career.reviewEvidence(excel.evidence.id, {
      action: "edit",
      subjectType: "skill",
      statement: "Microsoft Excel",
    });
    assert.equal(edited.statement, "Microsoft Excel");
    assert.equal(edited.subjectType, "skill");
    assert.equal(edited.verificationState, "user-confirmed");

    const certification = reviewItems.find(
      ({ evidence }) => evidence.statement === "OSHA 10 certification",
    );
    assert.ok(certification, "expected credential proposal");
    const rejected = await career.reviewEvidence(certification.evidence.id, {
      action: "reject",
    });
    assert.equal(rejected.verificationState, "rejected");
    assert.equal(canEvidenceSupportFactualClaim(rejected), false);

    const secondText = [
      "# Experience",
      "Operations Coordinator at Northstar Distribution | 2022 - Present",
      "- Coordinated vendor schedules across 12 regional locations.",
      "- Prepared quarterly inventory reconciliation summaries.",
    ].join("\n");
    const secondImport = await career.importPastedText({
      label: "Second source",
      text: secondText,
    });
    assert.equal(secondImport.duplicate, false);

    const afterSecondImport = await career.listEvidence();
    const duplicateAchievement = afterSecondImport.find(
      ({ evidence }) =>
        evidence.id !== confirmed.id &&
        evidence.verificationState === "imported" &&
        evidence.statement === confirmed.statement,
    );
    assert.ok(duplicateAchievement, "expected duplicate proposal from second source");

    const merged = await career.mergeEvidence(
      duplicateAchievement.evidence.id,
      confirmed.id,
    );
    assert.equal(merged.id, confirmed.id);
    assert.equal(merged.verificationState, "user-confirmed");

    const finalItems = await career.listEvidence();
    const mergedTarget = finalItems.find(({ evidence }) => evidence.id === confirmed.id);
    const mergedSource = finalItems.find(
      ({ evidence }) => evidence.id === duplicateAchievement.evidence.id,
    );
    assert.ok(mergedTarget);
    assert.ok(mergedSource);
    assert.equal(mergedSource.evidence.verificationState, "rejected");
    assert.equal(
      mergedTarget.sources.some(
        (source) => source.sourceArtifactId === secondImport.artifact.id,
      ),
      true,
      "merge must retain provenance from the additional source",
    );

    await jobBackend.dispose();

    const reloadedJobBackend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
    });
    await reloadedJobBackend.initialize();
    const reloadedCareer = await createCareerBackend(reloadedJobBackend, tempDir);
    const persistedArtifacts = await reloadedCareer.listSourceArtifacts();
    const persistedEvidence = await reloadedCareer.listEvidence();

    assert.equal(persistedArtifacts.length, 2);
    assert.equal(
      persistedEvidence.some(
        ({ evidence }) =>
          evidence.id === confirmed.id && evidence.verificationState === "user-confirmed",
      ),
      true,
      "confirmed evidence must survive backend restart",
    );

    await reloadedJobBackend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
