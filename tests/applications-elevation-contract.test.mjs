// #248 Applications visual contract. This is not a browser or accessibility PASS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("src/pages/Applications.tsx", root), "utf8");
const css = readFileSync(new URL("src/index.css", root), "utf8");

test("stage overview derives counts from stored application status only", () => {
  for (const stage of ["interested", "applied", "interview", "offer", "rejected", "withdrawn"]) {
    assert.ok(page.includes(`status: "${stage}"`));
  }
  assert.match(page, /application\.status === stage\.status/);
  assert.match(page, /data-status=\{stage\.status\}/);
  assert.match(page, /locally recorded statuses/);
});

test("existing editors, lifecycle and destructive guards remain in place", () => {
  for (const component of ["ApplicationStatusEditor", "ApplicationNotesEditor",
    "ApplicationLifecyclePanel", "ApplicationInsightsPanel",
    "ApplicationMaterialsPanel", "InterviewPrepPanel"]) {
    assert.ok(page.includes(`<${component}`), `retained ${component}`);
  }
  assert.ok(page.includes("useBlocker("));
  assert.ok(page.includes("useBeforeUnload("));
  assert.ok(page.includes('open={Boolean(deleteApplication)}'));
  assert.ok(page.includes("await remove(deleteApplication.id)"));
});

test("empty state has a genuine destination and does not imply auto-applying", () => {
  assert.match(page, /to="\/jobs"/);
  assert.match(page, /Find jobs to track/);
  assert.match(page, /does not submit applications for you/);
  assert.ok(page.includes("getDesktopApi().openExternal(application.url)"));
});

test("Applications styles use theme tokens and keep responsive / reduced-motion coverage", () => {
  for (const selector of [".applications-hero", ".applications-stage-grid",
    ".applications-stage", ".applications-card", ".applications-find-link"]) {
    assert.ok(css.includes(selector), `CSS selector ${selector}`);
  }
  assert.ok(css.includes("@media (max-width: 767px), (max-height: 700px)"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
  for (const token of ["var(--color-panel-strong)", "var(--color-primary)", "var(--color-border)"]) {
    assert.ok(css.includes(token));
  }
});
