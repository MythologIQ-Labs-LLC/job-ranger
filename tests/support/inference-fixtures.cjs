// Synthetic, deterministic fixtures for inference Slice A tests. Every record
// is fictional; no real person's career data is used.
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const { ResumeService } = require("../../electron-runtime/electron/src/resume-service.cjs");

const FIXED = "2026-01-01T00:00:00.000Z";
const TEST_HMAC_KEY = "slice-a-synthetic-test-key";

function evidence(id, fields = {}) {
  return {
    id,
    subjectType: "achievement",
    organization: null,
    titleOrName: null,
    startDate: null,
    endDate: null,
    statement: "",
    action: null,
    context: null,
    skills: [],
    methodsOrTools: [],
    scope: [],
    outcomes: [],
    metrics: [],
    credential: null,
    verificationState: "user-confirmed",
    confidence: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    ...fields,
  };
}

function statement(id, text, evidenceIds, fields = {}) {
  return {
    id,
    projectionId: "projection-synthetic",
    section: "experience",
    order: 0,
    text,
    evidenceIds,
    generationMode: "deterministic",
    userEdited: false,
    ...fields,
  };
}

/** Standard synthetic world used by the conformance suite. */
function standardWorld() {
  const records = [
    evidence("evidence-scheduling", {
      statement: "Coordinated scheduling for regional field teams.",
      skills: ["Scheduling"],
      scope: ["Regional field teams"],
    }),
    evidence("evidence-budget", {
      statement: "Never approved the vendor budget; reviewed vendor budget drafts.",
      skills: ["Budget review"],
    }),
    evidence("evidence-audit", {
      statement: "Supported the lead analyst on supplier audits.",
      skills: ["Supplier audits"],
    }),
    evidence("evidence-other", { statement: "Maintained inventory records for a warehouse." }),
    evidence("evidence-unconfirmed", {
      statement: "Imported claim awaiting review.",
      verificationState: "imported",
    }),
  ];
  const statements = [
    statement("statement-scheduling", records[0].statement, ["evidence-scheduling"]),
    statement("statement-budget", records[1].statement, ["evidence-budget"], { order: 1 }),
    statement("statement-audit", records[2].statement, ["evidence-audit"], { order: 2 }),
  ];
  const requirement = {
    id: "requirement-scheduling",
    kind: "must-have",
    sourceText: "Experience coordinating field schedules.",
  };
  return { records, statements, requirement };
}

/** In-memory canonical reader with explicit mutation helpers for staleness tests. */
function createMemoryReader(world) {
  const evidenceById = new Map(world.records.map((item) => [item.id, { ...item }]));
  const statements = world.statements.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds] }));
  return {
    async readStatements(projectionId) {
      return statements.filter((item) => item.projectionId === projectionId).map((item) => ({ ...item }));
    },
    async readEvidence(ids) {
      return ids.map((id) => evidenceById.get(id)).filter(Boolean).map((item) => ({ ...item }));
    },
    touchEvidence(id) {
      const item = evidenceById.get(id);
      evidenceById.set(id, { ...item, updatedAt: "2026-02-02T00:00:00.000Z" });
    },
    editStatement(id, text) {
      statements.find((item) => item.id === id).text = text;
    },
    deleteEvidence(id) {
      evidenceById.delete(id);
    },
    deleteStatement(id) {
      statements.splice(statements.findIndex((item) => item.id === id), 1);
    },
    snapshotState() {
      return JSON.stringify({ statements, evidence: Array.from(evidenceById.values()) });
    },
  };
}

/** The existing deterministic Truth Gate, unchanged; evaluateTruth needs no SQLite. */
function createTruthGate() {
  const unused = path.join(os.tmpdir(), "sojourner-inference-gate-unused");
  const service = new ResumeService({
    dataDirectory: unused,
    databasePath: path.join(unused, "unused.sqlite"),
    sqliteBinaryPath: "sqlite3",
  });
  return (statements, records) => service.evaluateTruth({}, statements, records);
}

function testHmac(data) {
  return crypto.createHmac("sha256", TEST_HMAC_KEY).update(data).digest("hex");
}

let sequence = 0;
function nextRequestId() {
  sequence += 1;
  return `request-${String(sequence).padStart(4, "0")}`;
}

module.exports = {
  FIXED,
  createMemoryReader,
  createTruthGate,
  evidence,
  nextRequestId,
  standardWorld,
  statement,
  testHmac,
};
