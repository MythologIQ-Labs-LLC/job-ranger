// #248 Find Jobs source contract. Runtime and screenshot checks are separate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("src/pages/Jobs.tsx", root), "utf8");
const css = readFileSync(new URL("src/index.css", root), "utf8");

test("filters remain local list filters, not fabricated fit scores", () => {
  for (const name of ["searchTerm", "locationTerm", "companyFilter", "filteredJobs", "clearFilters"]) {
    assert.ok(page.includes(name), name);
  }
  assert.match(page, /job\.title\.toLowerCase\(\)\.includes\(query\)/);
  assert.match(page, /job\.location\.toLowerCase\(\)\.includes\(location\)/);
  assert.match(page, /job\.companyId === companyFilter/);
  assert.match(page, /The target track changes assessment context, not which jobs appear/);
});

test("source completeness, evidence comparison and actions stay visible", () => {
  for (const claim of ["Full source text", "Partial source text", "Listing-only source",
    "JobEvidenceCoveragePanel", "markJobAsSeen(job.id)", "trackJob(job)",
    "getDesktopApi().openExternal(job.url)", "currentSourceSnapshotId"]) {
    assert.ok(page.includes(claim), claim);
  }
  assert.match(page, /aria-label="Job search results"/);
  assert.match(page, /Showing \$\{filteredJobs.length\} of \$\{jobs.length\}/);
});

test("empty, loading and filter-empty states have distinct honest recovery paths", () => {
  for (const phrase of ["No collected jobs yet.", "No jobs match these filters.",
    "Loading jobs...", "Add a job source", "Show all collected jobs"]) {
    assert.ok(page.includes(phrase), phrase);
  }
  assert.match(page, /onClick=\{\(\) => navigate\("\/companies"\)\}/);
  assert.match(page, /onClick=\{clearFilters\}/);
});

test("visible filter icons cannot overlap text, themes and focus remain intact", () => {
  for (const selector of [".jobs-filter-control", ".jobs-filter-field",
    ".jobs-opportunity-card", ".jobs-opportunity-title", ".jobs-hero"]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /padding-inline-start: 2\.85rem/);
  assert.match(css, /\.jobs-opportunity-title:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(page, /sr-only">Filter by company/);
  assert.match(page, /sr-only">Search job title or description/);
  assert.ok(css.includes("var(--color-panel-strong)"));
});
