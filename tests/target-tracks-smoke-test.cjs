const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SojournerBackend } = require("../electron-runtime/electron/src/backend.cjs");
const { CareerBackend } = require("../electron-runtime/electron/src/career-backend.cjs");
const { SqliteClient } = require("../electron-runtime/electron/src/sqlite.cjs");

async function createCareer(jobBackend, dataDirectory) {
  const status = await jobBackend.getSystemStatus(process.platform);
  const career = new CareerBackend({
    dataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await career.initialize();
  return { career, status };
}

async function readLegacyTrack(sqlite) {
  return sqlite.queryOne(
    "SELECT * FROM career_target_tracks WHERE id = 'legacy-default' LIMIT 1;",
  );
}

function trackInput(overrides = {}) {
  return {
    name: "Hourly local operations",
    relation: "target",
    roleTitles: ["Operations Coordinator"],
    seniority: null,
    direction: null,
    constraints: {
      geography: {
        locations: ["Annapolis, MD"],
        radiusMiles: 20,
        strength: "required",
      },
      workModes: {
        values: ["on-site", "hybrid"],
        strength: "required",
      },
      employmentArrangements: {
        values: ["full-time", "part-time"],
        strength: "preferred",
      },
      compensation: {
        floor: 32,
        target: 38,
        basis: "hourly",
        floorStrength: "required",
      },
      onCall: {
        value: "no",
        strength: "preferred",
      },
      industries: {
        values: ["Operations"],
        strength: "preferred",
      },
    },
    isActive: true,
    ...overrides,
  };
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sojourner-target-tracks-"));

  try {
    const backend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("target-track smoke test must not use the network");
      },
    });
    await backend.initialize();
    const { career, status } = await createCareer(backend, tempDir);
    const sqlite = new SqliteClient(status.databasePath, status.sqliteBinaryPath);

    const migrationRows = await sqlite.queryAll(
      "SELECT version, name FROM schema_migrations ORDER BY version ASC;",
    );
    assert.equal(
      new Map(migrationRows.map((row) => [row.version, row.name])).get(6),
      "career_target_tracks",
      "target-track migration must be applied",
    );

    const first = await career.saveProfile({
      version: 2,
      fullName: "Taylor Example",
      homeLocation: "Annapolis, MD",
      radiusMiles: 30,
      minimumPay: 42,
      payBasis: "hourly",
      targetTitles: ["Operations Coordinator", "Project Coordinator"],
      skills: ["Scheduling"],
      certifications: [],
      sectors: ["Operations"],
      onCallPreference: "no",
      fullTimeOnly: true,
      updatedAt: null,
    });
    assert.ok(first.updatedAt);

    let row = await readLegacyTrack(sqlite);
    assert.ok(row, "saving a legacy Career Profile must create its bridge target track");
    assert.equal(row.origin, "legacy-profile");
    assert.equal(row.relation, "target");
    assert.deepEqual(JSON.parse(row.role_titles_json), [
      "Operations Coordinator",
      "Project Coordinator",
    ]);

    const constraints = JSON.parse(row.constraints_json);
    assert.deepEqual(constraints.geography, {
      locations: ["Annapolis, MD"],
      radiusMiles: 30,
      strength: "unspecified",
    });
    assert.deepEqual(constraints.compensation, {
      floor: 42,
      target: null,
      basis: "hourly",
      floorStrength: "unspecified",
    });
    assert.deepEqual(constraints.employmentArrangements, {
      values: ["full-time"],
      strength: "unspecified",
    });
    assert.equal(
      constraints.onCall.strength,
      "unspecified",
      "migration must not invent required/preferred semantics",
    );

    await assert.rejects(
      () => career.deleteTargetTrack("legacy-default"),
      /cannot be deleted/i,
      "the migration bridge must remain reserved while Career Profile can recreate it",
    );

    const legacyTrack = (await career.listTargetTracks()).find(
      (track) => track.id === "legacy-default",
    );
    assert.ok(legacyTrack);
    const renamedOnly = await career.updateTargetTrack("legacy-default", {
      name: "Primary local search",
      relation: legacyTrack.relation,
      roleTitles: [...legacyTrack.roleTitles],
      seniority: legacyTrack.seniority,
      direction: legacyTrack.direction,
      constraints: legacyTrack.constraints,
      isActive: legacyTrack.isActive,
    });
    assert.equal(renamedOnly.origin, "user");
    assert.equal(
      renamedOnly.constraints.geography.strength,
      "unspecified",
      "promoting a legacy track must not silently invent preference semantics",
    );
    assert.equal(renamedOnly.constraints.compensation.floorStrength, "unspecified");

    const promoted = await career.updateTargetTrack(
      "legacy-default",
      trackInput({
        name: "Primary local search",
        roleTitles: ["Program Coordinator"],
      }),
    );
    assert.equal(promoted.id, "legacy-default");
    assert.equal(promoted.origin, "user", "editing the bridge must promote it to user authority");
    assert.deepEqual(promoted.roleTitles, ["Program Coordinator"]);
    assert.equal(promoted.constraints.workModes.strength, "required");

    await assert.rejects(
      () => career.deleteTargetTrack("legacy-default"),
      /cannot be deleted/i,
      "promotion must not make the reserved bridge deletable before legacy retirement",
    );

    await assert.rejects(
      () =>
        career.createTargetTrack({
          ...trackInput(),
          constraints: {
            ...trackInput().constraints,
            geography: {
              ...trackInput().constraints.geography,
              strength: "unspecified",
            },
          },
        }),
      /must use explicit required, preferred, or target strengths/i,
      "new user-authored tracks must not use migration-only unspecified semantics",
    );

    await career.saveProfile({
      ...first,
      homeLocation: "Baltimore, MD",
      targetTitles: ["Should Not Replace Promoted Track"],
      minimumPay: 90000,
      payBasis: "annual",
    });

    row = await readLegacyTrack(sqlite);
    assert.equal(row.origin, "user");
    assert.deepEqual(
      JSON.parse(row.role_titles_json),
      ["Program Coordinator"],
      "legacy profile synchronization must stop after promotion",
    );
    assert.equal(JSON.parse(row.constraints_json).compensation.basis, "hourly");

    const contractTrack = await career.createTargetTrack(
      trackInput({
        name: "Contract delivery",
        relation: "adjacent",
        roleTitles: ["Implementation Consultant"],
        constraints: {
          ...trackInput().constraints,
          workModes: { values: ["remote"], strength: "preferred" },
          employmentArrangements: {
            values: ["contract", "freelance"],
            strength: "required",
          },
          compensation: {
            floor: 65,
            target: 85,
            basis: "hourly",
            floorStrength: "required",
          },
        },
      }),
    );
    assert.match(contractTrack.id, /^track-/);
    assert.equal(contractTrack.origin, "user");

    let listed = await career.listTargetTracks();
    assert.equal(listed.length, 2);
    assert.equal(listed.some((track) => track.name === "Contract delivery"), true);

    await assert.rejects(
      () => career.deleteTargetTrack("missing-track"),
      /not found/i,
    );

    await backend.dispose();

    const reloadedBackend = new SojournerBackend({
      dataDirectory: tempDir,
      schedulerEnabled: false,
      fetchImpl: async () => {
        throw new Error("target-track smoke test must not use the network");
      },
    });
    await reloadedBackend.initialize();
    const { career: reloadedCareer } = await createCareer(reloadedBackend, tempDir);

    listed = await reloadedCareer.listTargetTracks();
    assert.equal(listed.length, 2, "user tracks and promoted bridge must survive restart");
    const persistedPromoted = listed.find((track) => track.id === "legacy-default");
    assert.ok(persistedPromoted);
    assert.equal(persistedPromoted.origin, "user");
    assert.deepEqual(persistedPromoted.roleTitles, ["Program Coordinator"]);

    const persistedContract = listed.find((track) => track.id === contractTrack.id);
    assert.ok(persistedContract);
    assert.deepEqual(persistedContract.constraints.employmentArrangements.values, [
      "contract",
      "freelance",
    ]);

    await reloadedCareer.deleteTargetTrack(contractTrack.id);
    listed = await reloadedCareer.listTargetTracks();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "legacy-default");

    await reloadedBackend.dispose();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
