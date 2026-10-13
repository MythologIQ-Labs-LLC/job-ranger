// Lightweight source contract for the bounded #248 Home elevation.
// This is NOT a browser screenshot, a WCAG audit or a full visual test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("src/pages/Dashboard.tsx", root), "utf8");
const css = readFileSync(new URL("src/index.css", root), "utf8");

test("Home elevation retains the existing three actionable stories and their destinations", () => {
  for (const route of ["/jobs", "/companies", "/filters"]) {
    assert.ok(page.includes(route), `preserved route ${route}`);
  }
  for (const label of ["Morning review", "Source coverage", "Signal quality"]) {
    assert.ok(page.includes(label), `preserved real guidance ${label}`);
  }
  assert.ok(page.includes("stories.map("));
  assert.ok(page.includes("stats.map("));
});

test("Dashboard semantic sections have labels and the hero references its heading", () => {
  assert.match(page, /aria-labelledby="dashboard-title"/);
  assert.match(page, /id="dashboard-title"/);
  assert.match(page, /aria-label="Job search overview"/);
  assert.match(page, /aria-label="Recommended next steps"/);
});

test("Status path wraps instead of overflowing, with no invented sync claims", () => {
  assert.match(page, /block break-all font-mono text-xs/);
  assert.ok(!page.includes("Google Drive connected"));
  assert.ok(!page.includes("Agent workspace synced"));
});

test("Dashboard visual uplift inherits theme colors and supports constrained and reduced-motion layouts", () => {
  for (const token of ["--color-primary", "--color-panel", "--color-border", "--color-shadow"]) {
    assert.ok(css.includes(token), `theme token ${token}`);
  }
  for (const selector of [".dashboard-hero", ".dashboard-metric", ".dashboard-action-card", ".dashboard-detail"]) {
    assert.ok(css.includes(selector), `style exists: ${selector}`);
    assert.ok(page.includes(selector.slice(1)), `style used in page: ${selector}`);
  }
  assert.ok(css.includes("@media (max-width: 767px), (max-height: 700px)"));
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
});
