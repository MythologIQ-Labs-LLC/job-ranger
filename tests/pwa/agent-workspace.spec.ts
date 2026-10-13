// Agent workspace G3 (#286, #289): a real review-screen journey in the PWA runtime.
// Export from the UI, let two synthetic agents write a workspace folder, sync it through the
// folder picker, review and act through the governed paths, restart, then discover a late
// operation-ID conflict that must downgrade the earlier imported draft.
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, greenhouseFixture, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

function writeBatch(root: string, batch: Record<string, unknown>, attachments: { path: string; declared: Uint8Array; actual: Uint8Array | null }[] = []) {
  const actor = (batch.actor_claim as { actor_id: string }).actor_id;
  const dir = join(root, "workspace", "agents", actor, "batches");
  mkdirSync(dir, { recursive: true });
  const raw = bytesOf(batch);
  writeFileSync(join(dir, `${batch.batch_id}.json`), raw);
  for (const a of attachments) {
    if (!a.actual) continue;
    mkdirSync(dirname(join(root, a.path)), { recursive: true });
    writeFileSync(join(root, a.path), a.actual);
  }
  writeFileSync(join(dir, `${batch.batch_id}.commit.json`), bytesOf({
    format: "jr-agent-batch-commit", schema_version: 1, batch_id: batch.batch_id, batch_sha256: sha256(raw), batch_bytes: raw.length,
    attachments: attachments.map((a) => ({ path: a.path, media_type: "application/pdf", bytes: a.declared.length, sha256: sha256(a.declared) })),
  }));
}

async function seedApplication(page: Page) {
  await page.context().addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.route("https://boards-api.greenhouse.io/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(greenhouseFixture),
  }));
  await page.goto(server.url);
  await waitForRuntime(page);
  return page.evaluate(async () => {
    const api = window.electronAPI;
    const source = await api.companies.create({ name: "Harbor Health", url: "https://boards.greenhouse.io/harbor-health", frequencyMinutes: 1440, isActive: false });
    const result = await api.companies.runScrape(source.id);
    if (result.status !== "success") throw new Error("Fixture scrape failed");
    const [job] = await api.jobs.list();
    const app = await api.applications.track(job.id);
    return { applicationId: app.id, jobId: job.id, title: app.title };
  });
}

test("agents' long-gap work is synced, reviewed and governed through the UI, and survives restart", async ({ page }) => {
  const seeded = await seedApplication(page);
  const folder = mkdtempSync(join(tmpdir(), "jr-agent-ui-"));
  try {
    // Reach the screen from the navigation.
    await page.goto(`${server.url}#/`);
    await waitForRuntime(page);
    const myCareer = page.getByRole("button", { name: /My Career/ });
    if ((await myCareer.getAttribute("aria-expanded")) !== "true") await myCareer.click();
    await page.getByRole("link", { name: "Agent Workspace" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Review what your agents worked on/ })).toBeVisible();
    await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();

    // Standing policy: research notes and job annotations import as drafts.
    await page.getByRole("checkbox", { name: "Research note" }).check();
    await page.getByRole("checkbox", { name: "Job annotation" }).check();
    await page.getByRole("button", { name: "Save import setting" }).click();
    await expect.poll(async () => (await page.evaluate(() => window.electronAPI.agentWorkspace.getState())).policy.autoImportKinds).toEqual(["opportunity_annotation", "workspace_note_version"]);

    // Export the selected application; the receipt is stored locally, the ZIP is downloaded.
    await page.getByRole("checkbox", { name: /Selected applications/ }).check();
    await page.getByRole("checkbox", { name: new RegExp(seeded.title) }).first().check();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Create export ZIP" }).click()]);
    const zipPath = join(folder, "export.zip");
    await download.saveAs(zipPath);
    const entries = unzipSync(new Uint8Array(await (await import("node:fs/promises")).readFile(zipPath)));
    const manifestName = Object.keys(entries).find((name) => name.endsWith("/manifest.json"))!;
    const manifestBytes = entries[manifestName];
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const exportId = manifest.export_id as string;
    expect(manifest.selection.scopes).toContain("selected_applications");
    const exportedApps = JSON.parse(new TextDecoder().decode(entries[`${exportId}/data/selected-applications.json`]));
    expect(exportedApps.records.map((r: { record_id: string }) => r.record_id)).toEqual([seeded.applicationId]);
    expect(JSON.stringify(exportedApps)).not.toContain("notes");
    const state = await page.evaluate(() => window.electronAPI.agentWorkspace.getState());
    expect(state.receiptCount).toBe(1);
    expect(manifest.workspace_id).toBe(state.workspaceId);

    // Two agents work for 60 days while Job Ranger is closed.
    const base = { format: "jr-agent-operation-batch", schema_version: 2, workspace_id: state.workspaceId, source_export_id: exportId, source_manifest_sha256: sha256(manifestBytes) };
    const op = (id: string, kind: string, record: string, payload: Record<string, unknown>, prev: string | null = null) => ({ operation_id: id, record_id: record, base_revision: null, previous_operation_id: prev, authored_at: "2026-11-01T09:00:00Z", kind, payload });
    const note = op("op_ui_note_1", "workspace_note_version", "agent_ui_note", { title: "Harbor Health hiring notes", body: "Research while you were away. <script>alert(1)</script> stays text." });
    writeBatch(folder, { ...base, batch_id: "batch_ui_alpha_1", actor_claim: { actor_id: "agent_ui_alpha", display_name: "Alpha" }, created_at: "2026-11-01T10:00:00Z", previous_batch_id: null, operations: [
      note,
      op("op_ui_claim_1", "application_status_claim", "agent_ui_claim", { application_id: seeded.applicationId, claimed_status: "submitted", reported_context: "The user said they applied on day 12." }),
    ] });
    const pdf = new TextEncoder().encode("%PDF-1.4 resume draft");
    writeBatch(folder, { ...base, batch_id: "batch_ui_alpha_2", actor_claim: { actor_id: "agent_ui_alpha", display_name: "Alpha" }, created_at: "2026-11-20T10:00:00Z", previous_batch_id: "batch_ui_alpha_1", operations: [
      op("op_ui_resume_1", "material_draft_version", "agent_ui_resume", { material_kind: "resume", title: "Resume draft", body: "See attachment.", source_evidence_refs: [], gate_status: "not_checked", attachments: [{ path: "workspace/attachments/alpha/resume.pdf", media_type: "application/pdf", bytes: pdf.length, sha256: sha256(pdf) }] }),
    ] }, [{ path: "workspace/attachments/alpha/resume.pdf", declared: pdf, actual: new TextEncoder().encode("%PDF-1.4 corrupted") }]);

    // Sync through the folder picker.
    await page.getByTestId("agent-folder-input").setInputFiles(folder);
    await expect(page.getByTestId("agent-sync-result")).toContainText("1 imported");
    await expect(page.getByTestId("agent-sync-result")).toContainText("1 to review");

    // The status claim waits for review; changing status goes through the existing workflow.
    const claimCard = page.getByTestId("agent-items").locator("li").filter({ hasText: "Application status claim" });
    await expect(claimCard).toContainText("Waiting for your review");
    await claimCard.getByRole("button", { name: /Review/ }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("A claim is not proof");
    await expect(dialog.getByText("Interested", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Change status to Applied…" }).click();
    const confirm = page.getByRole("dialog", { name: "Change application status?" });
    await confirm.getByRole("button", { name: "Change to Applied" }).click();
    await expect(dialog.getByRole("status")).toContainText("Status changed by you and recorded.");
    expect((await page.evaluate(() => window.electronAPI.applications.list())).find((a) => a.id === seeded.applicationId)?.status).toBe("applied");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The imported research note is an eligible draft; its markup is shown as text.
    await page.getByRole("button", { name: /^Drafts/ }).click();
    const noteCard = page.getByTestId("agent-items").locator("li").filter({ hasText: "Harbor Health hiring notes" });
    await expect(noteCard).toContainText("Imported draft");
    await noteCard.getByRole("button", { name: /Review/ }).click();
    await expect(page.getByRole("dialog")).toContainText("<script>alert(1)</script> stays text.");
    await page.keyboard.press("Escape");

    // The corrupted upload is held, with its reason explained.
    await page.getByRole("button", { name: /^Problems/ }).click();
    await expect(page.getByTestId("agent-problems")).toContainText("don't match the completion marker");

    // Restart the runtime: everything persisted.
    await page.reload();
    await waitForRuntime(page);
    await page.getByRole("button", { name: /^Drafts/ }).click();
    await expect(page.getByTestId("agent-items")).toContainText("Harbor Health hiring notes");
    await page.getByRole("button", { name: /^History/ }).click();
    await expect(page.getByTestId("agent-items")).toContainText("Status changed by you");

    // Day 60: a second agent reuses the note's operation ID with different content (#289).
    writeBatch(folder, { ...base, batch_id: "batch_ui_beta_1", actor_claim: { actor_id: "agent_ui_beta", display_name: "Beta" }, created_at: "2026-12-10T10:00:00Z", previous_batch_id: null, operations: [
      op("op_ui_note_1", "workspace_note_version", "agent_ui_note", { title: "Harbor Health hiring notes", body: "Different content under the same ID." }),
    ] });
    await page.getByTestId("agent-folder-input").setInputFiles(folder);
    await expect(page.getByTestId("agent-sync-result")).toContainText("1 earlier drafts are now in conflict");
    await page.getByRole("button", { name: /^Needs review/ }).click();
    const contested = page.getByTestId("agent-items").locator("li").filter({ hasText: "Conflicting versions" });
    await expect(contested).toHaveCount(2);
    await page.getByRole("button", { name: /^Drafts/ }).click();
    await expect(page.getByText("No agent drafts yet.")).toBeVisible();

    // Keeping one version requires reviewing the alternatives.
    await page.getByRole("button", { name: /^Needs review/ }).click();
    await contested.first().getByRole("button", { name: /Review/ }).click();
    const review = page.getByRole("dialog");
    await expect(review).toContainText("Other versions with the same operation ID");
    await expect(review.getByRole("button", { name: "Keep as draft" })).toBeDisabled();
    await review.getByRole("checkbox", { name: /reviewed every version/ }).check();
    await review.getByRole("button", { name: "Keep as draft" }).click();
    await expect(review.getByRole("status")).toContainText("Kept as an agent draft");

    // A further identical sync changes nothing and never overrides the decision.
    const before = await page.evaluate(() => window.electronAPI.agentWorkspace.listItems({ limit: 100 }));
    await page.keyboard.press("Escape");
    await page.getByTestId("agent-folder-input").setInputFiles(folder);
    await expect(page.getByTestId("agent-sync-result")).toContainText("0 imported");
    const after = await page.evaluate(() => window.electronAPI.agentWorkspace.listItems({ limit: 100 }));
    const strip = (rows: { lastSeenRun: number; updatedAt: string }[]) => rows.map(({ lastSeenRun: _l, updatedAt: _u, ...rest }) => rest);
    expect(strip(after.rows)).toEqual(strip(before.rows));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
