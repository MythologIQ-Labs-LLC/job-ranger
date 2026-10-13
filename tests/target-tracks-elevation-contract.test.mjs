// #248 Career Direction source contract. Actual browser coverage runs separately.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("src/pages/TargetTracks.tsx", root), "utf8");
const css = readFileSync(new URL("src/index.css", root), "utf8");

test("status overview uses saved target tracks and does not infer career outcomes", () => {
  assert.match(page, /targetTracks\.tracks\.filter\(\(track\) => track\.isActive\)\.length/);
  assert.match(page, /targetTracks\.tracks\.length - activeTrackCount/);
  for (const phrase of ["Saved directions", "Active tracks", "Paused tracks"]) {
    assert.ok(page.includes(phrase), phrase);
  }
});

test("track selection has clear state and uses existing editable lifecycle", () => {
  assert.match(page, /aria-pressed=\{editingId === track.id\}/);
  assert.match(page, /data-selected=\{editingId === track.id\}/);
  assert.ok(page.includes("onClick={() => edit(track)}"));
  for (const existing of ["toTargetTrackInput", "handleSave", "confirmDelete",
    "EconomicPathwayExplorer", "StrengthSelect", "ToggleList", "legacy-default"]) {
    assert.ok(page.includes(existing), existing);
  }
});

test("undefined color tokens were replaced with theme tokens", () => {
  assert.doesNotMatch(page, /--color-primary-soft|--color-surface\)/);
  for (const selector of [".target-tracks-hero", ".target-tracks-summary-card",
    ".target-track-choice", ".target-tracks-editor"]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.ok(css.includes("var(--color-panel-strong)"));
  assert.match(css, /\.target-track-choice:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
