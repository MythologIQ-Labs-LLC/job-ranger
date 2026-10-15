import test from "node:test";
import assert from "node:assert/strict";
import { auditRepository } from "../scripts/repo-hygiene-audit.mjs";
const snap = {
  issues: [
    { number: 1, labels: [], assignees: [] },
    { number: 2, labels: [{ name: "area:ux" }, { name: "status:active" }], assignees: ["owner"] },
    { number: 3, labels: ["status:ready", "status:blocked"], assignees: [] },
    { number: 4, state: "CLOSED", labels: [], assignees: [] },
  ],
  prs: [
    { number: 5, isDraft: true, headRefName: "same", updatedAt: "2026-09-01T00:00:00Z", labels: [] },
    { number: 6, isDraft: false, headRefName: "same", labels: ["status:active"], author: { login: "owner" } },
    { number: 7, isDraft: false, headRefName: "bot", labels: [], author: { login: "dependabot[bot]" } },
    { number: 8, state: "CLOSED", headRefName: "same", labels: [] },
  ],
};
test("open record counts and hygiene signals stay accurate", () => {
  const r = auditRepository(snap, { asOf: "2026-10-15T00:00:00Z" });
  assert.deepEqual(r.counts, { issues: 3, prs: 3, drafts: 1, nonDraftHumanPrs: 1, activePrs: 1 });
  assert.deepEqual(r.issuesMissingTriage[0], { number: 1, missing: ["status", "area", "owner"] });
  assert.deepEqual(r.conflictingStatus, [3]);
  assert.deepEqual(r.duplicateHeads, [{ head: "same", numbers: [5, 6] }]);
  assert.deepEqual(r.staleDrafts.map(x => x.number), [5]);
  assert.deepEqual(r.prsMissingStatus, [5, 7]);
});
test("active cap applies only to explicitly active PRs", () => {
  const extra = [9, 10, 11].map(n => ({ number: n, headRefName: "feature-" + n, labels: ["status:active"] }));
  const r = auditRepository({ issues: [], prs: [...snap.prs, ...extra] });
  assert.equal(r.counts.activePrs, 4);
  assert.equal(r.activeLimitExceeded, true);
});
test("malformed snapshots fail safely", () => {
  assert.throws(() => auditRepository({ issues: {}, prs: [] }), /arrays/);
  assert.throws(() => auditRepository({ issues: [], prs: [] }, { staleDays: 0 }), /Invalid/);
  assert.throws(() => auditRepository({ issues: [], prs: [] }, { asOf: "bad date" }), /Invalid/);
});
