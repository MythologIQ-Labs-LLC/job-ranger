// Agent workspace G3 (#286, #289) in the Electron runtime: sync a local workspace folder from
// the review screen, quit, relaunch with the same user data, and discover a late conflict.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { navigateTo } from "./electron-app";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "production" },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => window.localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => page.evaluate(() => Boolean(window.electronAPI?.agentWorkspace)), { timeout: 30_000 }).toBe(true);
  return { app, page };
}

function writeBatch(root: string, batch: Record<string, unknown>) {
  const actor = (batch.actor_claim as { actor_id: string }).actor_id;
  const dir = path.join(root, "workspace", "agents", actor, "batches");
  mkdirSync(dir, { recursive: true });
  const raw = bytesOf(batch);
  writeFileSync(path.join(dir, `${batch.batch_id}.json`), raw);
  writeFileSync(path.join(dir, `${batch.batch_id}.commit.json`), bytesOf({ format: "jr-agent-batch-commit", schema_version: 1, batch_id: batch.batch_id, batch_sha256: sha256(raw), batch_bytes: raw.length, attachments: [] }));
}

test("Electron persists agent workspace state across a relaunch and downgrades a late conflict", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "job-ranger-e2e-agent-"));
  const folder = mkdtempSync(path.join(tmpdir(), "job-ranger-agent-folder-"));
  let app: ElectronApplication | null = null;
  try {
    let page: Page;
    ({ app, page } = await launch(userData));
    await navigateTo(page, "/agent-workspace");
    await expect(page.getByRole("heading", { level: 1, name: /Review what your agents worked on/ })).toBeVisible();

    // A locally trusted receipt, as Job Ranger records when it exports.
    const state = await page.evaluate(() => window.electronAPI.agentWorkspace.getState());
    const manifestSha256 = "c".repeat(64);
    await page.evaluate((receipt) => window.electronAPI.agentWorkspace.recordExport(receipt), {
      format: "jr-agent-export-receipt", schema_version: 2, export_id: "ex_electron_e2e", workspace_id: state.workspaceId,
      created_at: "2026-10-13T16:30:00Z", job_ranger_build: "e2e", source_revision: "sha256:e2e", manifest_sha256: manifestSha256, manifest_bytes: 900,
      scopes: ["confirmed_evidence"], files: [{ path: "materials/agent-guide.md", sha256: "d".repeat(64), bytes: 100 }], record_revisions: {},
    });
    await page.getByRole("checkbox", { name: "Research note" }).check();
    await page.getByRole("button", { name: "Save import setting" }).click();

    const base = { format: "jr-agent-operation-batch", schema_version: 2, workspace_id: state.workspaceId, source_export_id: "ex_electron_e2e", source_manifest_sha256: manifestSha256 };
    const note = (body: string) => ({ operation_id: "op_electron_note", record_id: "agent_electron_note", base_revision: null, previous_operation_id: null, authored_at: "2026-11-01T09:00:00Z", kind: "workspace_note_version", payload: { title: "Electron research note", body } });
    writeBatch(folder, { ...base, batch_id: "batch_electron_alpha", actor_claim: { actor_id: "agent_electron_alpha", display_name: "Alpha" }, created_at: "2026-11-01T10:00:00Z", previous_batch_id: null, operations: [note("Version A.")] });
    await page.getByTestId("agent-folder-input").setInputFiles(folder);
    await expect(page.getByTestId("agent-sync-result")).toContainText("1 imported");

    // Quit and relaunch with the same user data: state is in the local database.
    await app.close();
    app = null;
    ({ app, page } = await launch(userData));
    await navigateTo(page, "/agent-workspace");
    await page.getByRole("button", { name: /^Drafts/ }).click();
    await expect(page.getByTestId("agent-items")).toContainText("Electron research note");
    expect((await page.evaluate(() => window.electronAPI.agentWorkspace.getState())).workspaceId).toBe(state.workspaceId);

    // A second agent reuses the operation ID with different content (#289).
    writeBatch(folder, { ...base, batch_id: "batch_electron_beta", actor_claim: { actor_id: "agent_electron_beta", display_name: "Beta" }, created_at: "2026-12-01T10:00:00Z", previous_batch_id: null, operations: [note("Version B.")] });
    await page.getByTestId("agent-folder-input").setInputFiles(folder);
    await expect(page.getByTestId("agent-sync-result")).toContainText("1 earlier drafts are now in conflict");
    await page.getByRole("button", { name: /^Needs review/ }).click();
    await expect(page.getByTestId("agent-items").locator("li").filter({ hasText: "Conflicting versions" })).toHaveCount(2);
    const items = await page.evaluate(() => window.electronAPI.agentWorkspace.listItems({ limit: 10 }));
    expect(items.rows.every((i) => !i.eligible)).toBe(true);
  } finally {
    if (app) await app.close();
    rmSync(folder, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
});
