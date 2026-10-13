// Agent workspace (#285): canonical snapshots are gathered through read-only service calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgentExport, gatherCanonicalSnapshot } from "../src/agent-workspace/index.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const calls = [];
const record = (name, value) => (...args) => { calls.push(name); return Promise.resolve(structuredClone(value(...args))); };
// Any other property access (create/update/delete/save...) throws, proving read-only use.
const readOnly = (name, methods) => new Proxy(methods, {
  get(target, prop) {
    if (prop in target) return target[prop];
    throw new Error(`snapshot used non-read method ${name}.${String(prop)}`);
  },
});
const reader = {
  career: readOnly("career", {
    getProfile: record("career.getProfile", () => fixture.profile),
    listTargetTracks: record("career.listTargetTracks", () => fixture.tracks),
    listEvidence: record("career.listEvidence", () => fixture.evidence),
  }),
  jobs: readOnly("jobs", { list: record("jobs.list", () => fixture.jobs) }),
  applications: readOnly("applications", { list: record("applications.list", () => fixture.applications) }),
  resume: readOnly("resume", {
    list: record("resume.list", () => fixture.resumes.map((r) => r.projection)),
    get: record("resume.get", (id) => {
      const r = fixture.resumes.find((x) => x.projection.id === id);
      return { projection: r.projection, statements: r.statements, evidence: [], truthGate: r.truthGate, artifacts: [
        { id: "artifact_old", projectionId: id, version: 1, format: "pdf", managedPath: "x", contentHash: "h", pageCount: 1, truthGateResult: null, parseabilityResult: "legacy-label", relevanceReviewResult: null, createdAt: "2026-09-26T12:00:00.000Z" },
        { id: "artifact_new", projectionId: id, version: 2, format: "pdf", managedPath: "y", contentHash: "h2", pageCount: 1, truthGateResult: null, parseabilityResult: JSON.stringify(r.parseability), relevanceReviewResult: null, createdAt: "2026-09-27T12:05:00.000Z" },
      ] };
    }),
  }),
  applicationMaterials: readOnly("applicationMaterials", { list: record("applicationMaterials.list", (applicationId) => fixture.coverLetters.filter((c) => c.applicationId === applicationId)) }),
};

const first = await gatherCanonicalSnapshot(reader);
const second = await gatherCanonicalSnapshot(reader);
assert.match(first.sourceRevision, /^sha256:[a-f0-9]{64}$/);
assert.equal(first.sourceRevision, second.sourceRevision, "same canonical content, same revision");
assert.deepEqual(first.evidence, fixture.evidence);
assert.deepEqual(first.coverLetters, fixture.coverLetters);
assert.deepEqual(first.resumes[0].parseability, fixture.resumes[0].parseability, "newest structured parseability report is used");
assert.ok(calls.every((c) => /\.(get|list)[A-Za-z]*$/.test(c)), `only read methods: ${[...new Set(calls)].join(", ")}`);

const changed = structuredClone(fixture);
changed.evidence[0].evidence.updatedAt = "2026-12-01T00:00:00.000Z";
const changedReader = { ...reader, career: { ...reader.career, listEvidence: () => Promise.resolve(changed.evidence) } };
assert.notEqual((await gatherCanonicalSnapshot(changedReader)).sourceRevision, first.sourceRevision, "a canonical change changes the revision");

const exported = await createAgentExport(first, { exportId: "ex_from_services", createdAt: "2026-10-13T16:30:00Z", build: "test", scopes: ["confirmed_evidence"], selectedJobIds: [], selectedResumeIds: [], selectedCoverLetterIds: [], schemaDocuments: [] });
assert.equal(exported.receipt.source_revision, first.sourceRevision);

console.log("agent-workspace snapshot tests passed");
