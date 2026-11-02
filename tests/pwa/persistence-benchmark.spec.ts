import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, projectRoot, waitForRuntime } from "./support/fixtures";

// #303 measurement (opt-in, not part of the regular suite): grows a real browser workspace with
// synthetic, non-personal listings through the app's own scrape path, then times small writes,
// a cold start and storage use in Chromium with real OPFS.
//
//   SOJOURNER_PERSISTENCE_BENCH=1 SOJOURNER_BENCH_MIB=1,10,100 \
//     npx playwright test --config playwright.pwa.config.ts tests/pwa/persistence-benchmark.spec.ts
//
// Results: test-results/persistence-benchmark.json. The engine writes the whole database image on
// every write (wasm-sqlite-engine.ts), so each small write costs O(database size).

test.skip(!process.env.SOJOURNER_PERSISTENCE_BENCH, "set SOJOURNER_PERSISTENCE_BENCH=1 to run");
test.setTimeout(30 * 60_000);

const targets = (process.env.SOJOURNER_BENCH_MIB ?? "1,10,100").split(",").map(Number);
const WORDS = "patient scheduling referral coordination insurance verification clinic operations front desk records billing intake triage compliance audit inventory logistics warehouse dispatch routing vendor procurement payroll onboarding training safety maintenance".split(" ");
const MiB = 1024 * 1024;

/** Deterministic, non-sensitive listing text of roughly `bytes` characters. */
function description(seed: number, bytes: number): string {
  let value = seed;
  const words: string[] = [];
  let length = 0;
  while (length < bytes) {
    value = (value * 1103515245 + 12345) >>> 0;
    const word = WORDS[value % WORDS.length];
    words.push(word);
    length += word.length + 1;
  }
  return `&lt;p&gt;${words.join(" ")}.&lt;/p&gt;`;
}

function listings(count: number, bytesEach: number, offset: number) {
  return {
    jobs: Array.from({ length: count }, (_, index) => ({
      id: 9_000_000 + offset + index,
      title: `Synthetic Coordinator ${offset + index}`,
      absolute_url: `https://boards.greenhouse.io/synthetic-bench/jobs/${9_000_000 + offset + index}`,
      location: { name: "Baltimore, MD" },
      updated_at: "2026-10-01T12:00:00-04:00",
      content: description(offset + index + 1, bytesEach),
    })),
  };
}

async function databaseBytes(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { databasePath } = await window.electronAPI.system.getStatus();
    let dir = await navigator.storage.getDirectory();
    const parts = databasePath.split("/").filter(Boolean);
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).size;
  });
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))];

let server: PwaServer;
test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});
test.afterAll(async () => {
  await server.close();
});

test("persistence cost by workspace size", async () => {
  const results: Record<string, unknown>[] = [];
  for (const targetMiB of targets) {
    const profile = mkdtempSync(path.join(os.tmpdir(), `sojourner-bench-${targetMiB}-`));
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined,
    });
    try {
      await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
      const page = context.pages()[0] ?? (await context.newPage());
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(server.url);
      await waitForRuntime(page);
      await page.evaluate((profileValue) => window.electronAPI.career.saveProfile(profileValue as never), healthcareProfile);

      // Grow the database with scrapes of 200 listings of ~20 KB until it reaches the target.
      const batch = 200;
      const bytesEach = 20_000;
      let offset = 0;
      let scrapeMs = 0;
      // One synthetic source per batch: a source is not rescraped immediately after a run.
      while ((await databaseBytes(page)) < targetMiB * MiB) {
        const source = await page.evaluate((slug) =>
          window.electronAPI.companies.create({ name: `Synthetic Bench ${slug}`, url: `https://boards.greenhouse.io/synthetic-bench-${slug}`, frequencyMinutes: 1440, isActive: false }),
        offset);
        const body = JSON.stringify(listings(batch, bytesEach, offset));
        await context.unroute("https://boards-api.greenhouse.io/**");
        await context.route("https://boards-api.greenhouse.io/**", (route) =>
          route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body }),
        );
        const started = Date.now();
        const run = await page.evaluate((id) => window.electronAPI.companies.runScrape(id), source.id);
        scrapeMs += Date.now() - started;
        expect(run.status).toBe("success");
        offset += batch;
        console.log(`BATCH ${JSON.stringify({ targetMiB, listings: offset, databaseMiB: +((await databaseBytes(page)) / MiB).toFixed(1), scrapeSeconds: +((Date.now() - started) / 1000).toFixed(1) })}`);
      }
      const dbBytes = await databaseBytes(page);

      // Small writes: one profile field change each (about 1 KB of logical change).
      const writeMs: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const started = performance.now();
        await page.evaluate(([base, name]) => window.electronAPI.career.saveProfile({ ...(base as object), fullName: name } as never), [healthcareProfile, `Bench ${index}`] as const);
        writeMs.push(performance.now() - started);
      }
      // A comparable read for scale.
      const readMs: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const started = performance.now();
        await page.evaluate(() => window.electronAPI.career.getProfile());
        readMs.push(performance.now() - started);
      }
      const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);

      // Cold start: a reload reads and deserializes the whole image before the app is usable.
      const coldStarted = Date.now();
      await page.reload();
      await waitForRuntime(page);
      await page.evaluate(() => window.electronAPI.career.getProfile());
      const coldStartMs = Date.now() - coldStarted;
      const profileAfter = await page.evaluate(() => window.electronAPI.career.getProfile());
      expect(profileAfter?.fullName).toBe("Bench 19");
      const jobs = await page.evaluate(async () => (await window.electronAPI.jobs.list()).length);

      results.push({
        targetMiB,
        databaseMiB: +(dbBytes / MiB).toFixed(1),
        listings: jobs,
        seedScrapeSeconds: +(scrapeMs / 1000).toFixed(1),
        smallWriteMs: { median: Math.round(median(writeMs)), p95: Math.round(p95(writeMs)), max: Math.round(Math.max(...writeMs)) },
        readMs: { median: Math.round(median(readMs)) },
        bytesWrittenPerSmallWriteMiB: +(dbBytes / MiB).toFixed(1),
        storageUsageMiB: +(usage / MiB).toFixed(1),
        coldStartMs,
        pageErrors: errors,
      });
      console.log(`BENCH ${JSON.stringify(results[results.length - 1])}`);
    } finally {
      await context.close();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Windows may hold the browser log.
      }
    }
  }
  const out = path.join(projectRoot, "test-results");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "persistence-benchmark.json"), `${JSON.stringify({ browser: "chromium", results }, null, 2)}\n`);
});
