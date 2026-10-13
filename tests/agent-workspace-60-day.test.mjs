// Agent workspace (#286): two agents work for 60 simulated days while Job Ranger is closed;
// Job Ranger restarts and reconciles deterministically without surrendering authority.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgentExport, evidenceRevision, operationEligibility, reconcileWorkspace as reconcileCore } from "../src/agent-workspace/index.ts";
import { attachmentRef, bytesOf, makeBatch, makeOperation, makeSubmission, WORKSPACE_ID } from "./support/agent-workspace-helpers.mjs";

const reconcileWorkspace = (input) => reconcileCore({ workspaceId: WORKSPACE_ID, ...input });

const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const loadSnapshot = () => JSON.parse(readFileSync(new URL("./fixtures/agent-workspace/canonical-snapshot.synthetic.json", import.meta.url), "utf8"));
const day = (n, hour = 10) => new Date(Date.UTC(2026, 9, 13 + n, hour)).toISOString().replace(".000Z", "Z");

// 1. Day 0: canonical dataset and an immutable, selective export with a local receipt.
const day0 = deepFreeze(loadSnapshot());
const exported = await createAgentExport(day0, {
  exportId: "ex_synthetic_day0",
  workspaceId: WORKSPACE_ID,
  createdAt: day(0),
  build: "test-build-0001",
  scopes: ["tracks", "confirmed_evidence", "selected_opportunities", "selected_resumes", "selected_cover_letters"],
  selectedJobIds: ["job_selected_001"],
  selectedResumeIds: ["resume_ops_001"],
  selectedCoverLetterIds: ["material_cl_001"],
  schemaDocuments: [],
});
const receipts = [exported.receipt];
const src = { exportId: "ex_synthetic_day0", manifestSha256: exported.manifestSha256 };
// Agents cite the evidence revision tokens they read in the export (D07).
const evRev = exported.receipt.record_revisions.ev_confirmed_scheduling;
const insuranceRev = exported.receipt.record_revisions.ev_authored_insurance;
assert.equal(evRev, await evidenceRevision(day0.evidence.find((e) => e.evidence.id === "ev_confirmed_scheduling").evidence));

// 2-10. Days 1-60: Job Ranger is closed. Two agents write append-only batches.
const note1v1 = makeOperation({ operation_id: "op_alpha_note1_v1", record_id: "agent_note_harbor", authored_at: day(2), kind: "workspace_note_version", payload: { title: "Harbor Health research", body: "Initial research. Unverified.", source_links: ["https://example.invalid/harbor"] } });
const annotation = makeOperation({ operation_id: "op_alpha_annot_v1", record_id: "agent_annot_job1", authored_at: day(3), kind: "opportunity_annotation", payload: { opportunity_id: "job_selected_001", title: "Fit notes", notes: "Strong scheduling overlap.", observed_at: day(3) } });
const letter1v1 = makeOperation({ operation_id: "op_alpha_letter_v1", record_id: "agent_letter_harbor", authored_at: day(4), kind: "material_draft_version", payload: { material_kind: "cover_letter", title: "Harbor cover letter", body: "Draft citing scheduling evidence.", source_evidence_refs: [{ record_id: "ev_confirmed_scheduling", revision: evRev }], gate_status: "not_checked" } });
const alpha1 = makeBatch({ ...src, batchId: "batch_alpha_001", actorId: "agent_alpha", createdAt: day(4, 18), operations: [note1v1, annotation, letter1v1] });

const note1alpha2 = makeOperation({ operation_id: "op_alpha_note1_v2", record_id: "agent_note_harbor", previous_operation_id: "op_alpha_note1_v1", authored_at: day(20), kind: "workspace_note_version", payload: { title: "Harbor Health research", body: "Alpha revision: hiring manager is new." } });
const letter1v2 = makeOperation({ operation_id: "op_alpha_letter_v2", record_id: "agent_letter_harbor", previous_operation_id: "op_alpha_letter_v1", authored_at: day(21), kind: "material_draft_version", payload: { material_kind: "cover_letter", title: "Harbor cover letter", body: "Second draft citing scheduling evidence.", source_evidence_refs: [{ record_id: "ev_confirmed_scheduling", revision: evRev }], gate_status: "not_checked" } });
const followUp = makeOperation({ operation_id: "op_alpha_follow_v1", record_id: "agent_followup_harbor", authored_at: day(22), kind: "follow_up_plan", payload: { label: "Check in with recruiter", description: "Suggested follow-up; no contact has occurred.", due_at: day(30) } });
const statusClaim = makeOperation({ operation_id: "op_alpha_status_v1", record_id: "agent_status_harbor", authored_at: day(23), kind: "application_status_claim", payload: { application_id: "app_harbor_001", claimed_status: "submitted", reported_context: "User told the agent they submitted the application." } });
const alpha2 = makeBatch({ ...src, batchId: "batch_alpha_002", actorId: "agent_alpha", createdAt: day(23, 18), previousBatchId: "batch_alpha_001", operations: [note1alpha2, letter1v2, followUp, statusClaim] });

// Alpha's day-45 batch carries a resume draft attachment that is corrupted in storage.
const declaredPdf = bytesOf("%PDF-1.4 synthetic resume draft");
const corruptedPdf = bytesOf("%PDF-1.4 synthetic resume draft (bit rot)");
const resumePath = "workspace/attachments/alpha/resume-draft.pdf";
const resumeDraft = makeOperation({ operation_id: "op_alpha_resume_v1", record_id: "agent_resume_harbor", authored_at: day(45), kind: "material_draft_version", payload: { material_kind: "resume", title: "Harbor resume draft", body: "See attachment.", source_evidence_refs: [{ record_id: "ev_authored_insurance", revision: insuranceRev }], gate_status: "not_checked", attachments: [attachmentRef(resumePath, declaredPdf)] } });
const alpha3 = makeBatch({ ...src, batchId: "batch_alpha_003", actorId: "agent_alpha", createdAt: day(45, 18), previousBatchId: "batch_alpha_002", operations: [resumeDraft] });

// Alpha later revises the resume draft whose base sits in the corrupted batch.
const resumeV2 = makeOperation({ operation_id: "op_alpha_resume_v2", record_id: "agent_resume_harbor", previous_operation_id: "op_alpha_resume_v1", authored_at: day(55), kind: "material_draft_version", payload: { material_kind: "resume", title: "Harbor resume draft", body: "Revision two.", source_evidence_refs: [{ record_id: "ev_authored_insurance", revision: insuranceRev }], gate_status: "not_checked" } });
const alpha4 = makeBatch({ ...src, batchId: "batch_alpha_004", actorId: "agent_alpha", createdAt: day(55, 18), previousBatchId: "batch_alpha_003", operations: [resumeV2] });

// Beta independently revises the same research note from Alpha's v1 (a fork), proposes a
// new qualification and a correction, and replays Alpha's annotation verbatim.
const note1beta2 = makeOperation({ operation_id: "op_beta_note1_v2", record_id: "agent_note_harbor", previous_operation_id: "op_alpha_note1_v1", authored_at: day(19), kind: "workspace_note_version", payload: { title: "Harbor Health research", body: "Beta revision: clinic is expanding." } });
const newQualification = makeOperation({ operation_id: "op_beta_evidence_new", record_id: "agent_proposal_bls", authored_at: day(25), kind: "evidence_change_proposal", payload: { proposal_kind: "new", evidence_id: null, change_reason: "User mentioned holding a BLS certification.", proposed_text: "Holds current BLS certification.", source_evidence_refs: [] } });
const correction = makeOperation({ operation_id: "op_beta_evidence_fix", record_id: "agent_proposal_insurance", base_revision: insuranceRev, authored_at: day(26), kind: "evidence_change_proposal", payload: { proposal_kind: "correction", evidence_id: "ev_authored_insurance", change_reason: "Clarify scope.", proposed_text: "Verified insurance eligibility for about 40 new patients each week.", source_evidence_refs: [{ record_id: "ev_authored_insurance", revision: insuranceRev }] } });
const beta1 = makeBatch({ ...src, batchId: "batch_beta_001", actorId: "agent_beta", createdAt: day(26, 18), operations: [note1beta2, newQualification, correction] });
const beta2 = makeBatch({ ...src, batchId: "batch_beta_002", actorId: "agent_beta", createdAt: day(31, 18), previousBatchId: "batch_beta_001", operations: [annotation] });

// A malicious / invalid batch: self-asserted approvals, a Truth Gate PASS and an unknown kind.
const malicious = makeBatch({ ...src, batchId: "batch_beta_003", actorId: "agent_beta", createdAt: day(40, 18), previousBatchId: "batch_beta_002", operations: [
  { ...makeOperation({ operation_id: "op_beta_evil_1", record_id: "ev_confirmed_scheduling", authored_at: day(40), kind: "material_draft_version", payload: { material_kind: "resume", title: "x", body: "x", source_evidence_refs: [], gate_status: "PASS" } }), approved: true },
] });

// 7. Day 50: the user corrects Career Evidence locally, making older drafts stale.
const day60 = loadSnapshot();
day60.evidence[0].evidence.statement = "Coordinated scheduling and referrals across seven providers.";
day60.evidence[0].evidence.updatedAt = "2026-12-02T12:00:00.000Z";
day60.sourceRevision = "local-rev-2026-12-02-0007";
deepFreeze(day60);
const canonicalBefore = JSON.stringify(day60);

const submissions = [
  makeSubmission(alpha1),
  makeSubmission(alpha2),
  makeSubmission(alpha3, { attachments: { [resumePath]: { declared: declaredPdf, actual: corruptedPdf } } }),
  makeSubmission(alpha4),
  makeSubmission(beta1),
  makeSubmission(beta2),
  makeSubmission(malicious),
];
const policy = { autoImportKinds: ["workspace_note_version", "opportunity_annotation", "follow_up_plan", "material_draft_version"] };

// 11-12. Job Ranger restarts and reconciles.
const run1 = await reconcileWorkspace({ receipts, canonical: day60, policy, ledger: null, submissions });
assert.equal(JSON.stringify(day60), canonicalBefore, "reconciliation never mutates canonical data");

const outcome = (id) => run1.report.operations.find((o) => o.operation_id === id);
const batchStatus = (id) => run1.report.batches.find((b) => b.batch_id === id);

// Useful non-conflicting agent work is kept (imported into the isolated draft namespace).
assert.equal(outcome("op_alpha_annot_v1").outcome, "imported_draft");
assert.equal(outcome("op_alpha_follow_v1").outcome, "imported_draft");
assert.equal(outcome("op_alpha_note1_v1").outcome, "imported_draft");
assert.ok(run1.drafts.every((d) => d.authority === "agent_draft" && d.gate_status === "not_checked"));

// Forks: two agents revised the same note from the same predecessor; both kept, neither wins.
for (const id of ["op_alpha_note1_v2", "op_beta_note1_v2"]) {
  assert.equal(outcome(id).outcome, "staged_draft");
  assert.ok(outcome(id).flags.includes("fork"));
}
assert.deepEqual(run1.report.records.agent_note_harbor.heads, ["op_alpha_note1_v2", "op_beta_note1_v2"]);
assert.equal(run1.report.records.agent_note_harbor.fork, true);
assert.ok(run1.staged.some((s) => s.operation_id === "op_beta_note1_v2" && s.payload.body.includes("expanding")), "fork text preserved");

// Stale evidence: drafts based on the old evidence revision need rebase but keep their text.
for (const id of ["op_alpha_letter_v1", "op_alpha_letter_v2"]) {
  assert.equal(outcome(id).outcome, "needs_rebase");
  assert.ok(outcome(id).flags.includes("stale_evidence"));
}
assert.ok(run1.staged.some((s) => s.operation_id === "op_alpha_letter_v2" && s.payload.body === "Second draft citing scheduling evidence."));

// Consequential proposals are staged for review and never change canonical state.
assert.equal(outcome("op_alpha_status_v1").outcome, "staged_for_review");
assert.ok(outcome("op_alpha_status_v1").flags.includes("claim_differs_from_canonical"));
assert.equal(day60.applications[0].status, "interested");
assert.equal(outcome("op_beta_evidence_new").outcome, "staged_for_review");
assert.deepEqual(outcome("op_beta_evidence_new").flags, [], "a new qualification is an explicit proposal, not a fabricated ID");
assert.equal(outcome("op_beta_evidence_fix").outcome, "staged_for_review");
assert.ok(!day60.evidence.some((e) => e.evidence.id === "ev_proposed_bls_cert"));

// Replay: Beta's verbatim copy of Alpha's annotation is recognised, never accepted twice.
assert.equal(run1.report.operations.filter((o) => o.operation_id === "op_alpha_annot_v1").length, 1);
assert.ok(run1.report.duplicates.some((d) => d.operation_id === "op_alpha_annot_v1" && d.batch_id === "batch_beta_002"));
assert.equal(run1.drafts.filter((d) => d.operation_id === "op_alpha_annot_v1").length, 1);

// Corrupted attachment: the whole batch is incomplete; its bytes are preserved, nothing imported.
assert.equal(batchStatus("batch_alpha_003").status, "incomplete");
assert.ok(batchStatus("batch_alpha_003").reasons.includes("attachment_digest_mismatch"));
assert.equal(outcome("op_alpha_resume_v1"), undefined);
assert.ok(run1.quarantine.some((q) => q.batch_id === "batch_alpha_003" && q.bytes.length > 0));
// ...and Alpha's next batch waits for it (D13) instead of importing out of causal order.
assert.equal(batchStatus("batch_alpha_004").status, "incomplete");
assert.deepEqual(batchStatus("batch_alpha_004").reasons, ["previous_batch_unavailable"]);
assert.equal(outcome("op_alpha_resume_v2"), undefined);
assert.ok(run1.quarantine.some((q) => q.batch_id === "batch_alpha_004" && q.bytes.length > 0), "the waiting batch is preserved");

// Malicious batch: rejected with diagnostics, quarantined read-only, nothing applied.
assert.equal(batchStatus("batch_beta_003").status, "rejected");
assert.ok(batchStatus("batch_beta_003").reasons.includes("unknown_field"));
assert.equal(outcome("op_beta_evil_1"), undefined);
assert.ok(run1.quarantine.some((q) => q.batch_id === "batch_beta_003"));

// No agent-written content establishes confirmed evidence or a verified submission.
const allOutputs = JSON.stringify({ drafts: run1.drafts, staged: run1.staged });
assert.ok(!/"authority"\s*:\s*"(confirmed|approved|submitted|verified)"/.test(allOutputs));
assert.equal(day60.evidence.filter((e) => e.evidence.verificationState === "user-confirmed").length, 1);

// Activity history is reconstructed causally (times are display-only).
const historyIds = run1.history.map((h) => h.operation_id);
assert.ok(historyIds.indexOf("op_alpha_note1_v1") < historyIds.indexOf("op_beta_note1_v2"));
assert.ok(historyIds.indexOf("op_alpha_letter_v1") < historyIds.indexOf("op_alpha_letter_v2"));

// Determinism: discovery order does not change the result.
const shuffled = await reconcileWorkspace({ receipts, canonical: day60, policy, ledger: null, submissions: [...submissions].reverse() });
assert.deepEqual(shuffled.report, run1.report);

// 13. A second run over the same inputs accepts nothing new and overwrites nothing.
const run2 = await reconcileWorkspace({ receipts, canonical: day60, policy, ledger: run1.ledger, submissions });
assert.equal(run2.report.counts.imported_draft, 0);
assert.ok(run2.report.operations.filter((o) => o.outcome !== "pending_predecessor").every((o) => o.outcome === "already_reconciled"));
assert.deepEqual(run2.ledger, run1.ledger);
assert.equal(JSON.stringify(day60), canonicalBefore);

// A later replay of an operation ID with different content is a conflict, never an overwrite:
// both versions are contested and the earlier imported draft loses eligibility (#289).
assert.equal(operationEligibility(run2.ledger, "op_alpha_note1_v1").eligible, true);
const hijack = makeBatch({ ...src, batchId: "batch_beta_004", actorId: "agent_beta", createdAt: day(61, 18), previousBatchId: "batch_beta_002", operations: [
  makeOperation({ ...note1v1, payload: { title: "Harbor Health research", body: "Overwritten by beta." } }),
] });
const run3 = await reconcileWorkspace({ receipts, canonical: day60, policy, ledger: run2.ledger, submissions: [...submissions, makeSubmission(hijack)] });
const hijacked = run3.report.operations.find((o) => o.operation_id === "op_alpha_note1_v1" && o.batch_id === "batch_beta_004");
assert.equal(hijacked.outcome, "contested");
assert.ok(hijacked.flags.includes("operation_id_conflict"));
assert.equal(run3.report.counts.imported_draft, 0);
assert.equal(operationEligibility(run3.ledger, "op_alpha_note1_v1").eligible, false);
assert.ok(run3.downgrades.some((d) => d.operation_id === "op_alpha_note1_v1" && d.previous_outcome === "imported_draft"));
assert.ok(run3.contested.some((c) => c.operation.payload.body === "Overwritten by beta."));
assert.ok(run3.contested.some((c) => c.operation.payload.body === "Initial research. Unverified."));

// Once the user re-uploads the attachment intact, the held revision chain completes.
const repaired = submissions.map((s) => (s.location.endsWith("batch_alpha_003.json")
  ? makeSubmission(alpha3, { attachments: { [resumePath]: { declared: declaredPdf, actual: declaredPdf } } })
  : s));
const run4 = await reconcileWorkspace({ receipts, canonical: day60, policy, ledger: run2.ledger, submissions: repaired });
assert.equal(run4.report.operations.find((o) => o.operation_id === "op_alpha_resume_v1").outcome, "imported_draft");
assert.equal(run4.report.operations.find((o) => o.operation_id === "op_alpha_resume_v2").outcome, "imported_draft");

// An unknown export (no local receipt) is not trusted even if its manifest digest "matches".
const foreign = makeBatch({ exportId: "ex_foreign_device", manifestSha256: exported.manifestSha256, batchId: "batch_foreign_001", actorId: "agent_gamma", createdAt: day(60), operations: [note1v1] });
const run5 = await reconcileWorkspace({ receipts, canonical: day60, policy, ledger: null, submissions: [makeSubmission(foreign)] });
assert.equal(run5.report.batches[0].status, "rejected");
assert.ok(run5.report.batches[0].reasons.includes("unknown_source_export"));

// Without a standing permission, valid agent work is staged rather than imported.
const run6 = await reconcileWorkspace({ receipts, canonical: day60, policy: { autoImportKinds: [] }, ledger: null, submissions });
assert.equal(run6.report.counts.imported_draft, 0);
assert.equal(run6.report.operations.find((o) => o.operation_id === "op_alpha_annot_v1").outcome, "staged_draft");

console.log("agent-workspace 60-day scenario passed", JSON.stringify(run1.report.counts));
