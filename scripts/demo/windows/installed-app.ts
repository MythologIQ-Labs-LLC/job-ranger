// Drives the INSTALLED signed Sojourner Windows app (not the PWA, not a source build) for the
// narrated demo. Playwright launches the installed Sojourner.exe with its own disposable
// --user-data-dir, so the capture never reads or writes a real workspace.
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ONBOARDING_DISMISSED_KEY } from "../../../src/demo/session";
import { greenhouseListing } from "../fixture";

export const INSTALLED_EXE =
  process.env.SOJOURNER_INSTALLED_EXE ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Sojourner", "Sojourner.exe");
export const VIEWPORT = { width: 1600, height: 900 };

export interface InstalledApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  problems: string[];
}

export function watchProblems(page: Page, problems: string[]): void {
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
}

const UNDICI = createRequire(import.meta.url).resolve("undici");

/**
 * The fictional Harbor Health listing reaches the app's real Greenhouse adapter through a local test
 * transport (an undici MockAgent as the main process's global dispatcher), the same idea as the
 * Electron E2E fetch seam. The backend keeps the fetch it started with, so the seam has to sit under
 * it. disableNetConnect refuses every other request: the capture makes no live network calls.
 * Replacing globalThis.fetch as well makes the scraper use that startup fetch rather than its
 * DNS-pinned transport (scrapers.cts contextFetch), so the request reaches the MockAgent.
 */
async function routeListing(app: ElectronApplication): Promise<void> {
  await app.evaluate((_electron, { listing, undiciPath }) => {
    const load = (process as unknown as { mainModule: NodeJS.Module }).mainModule.require.bind(
      (process as unknown as { mainModule: NodeJS.Module }).mainModule,
    );
    const undici = load(undiciPath) as typeof import("undici");
    const agent = new undici.MockAgent();
    agent.disableNetConnect();
    const g = globalThis as unknown as { demoRequests: string[] };
    g.demoRequests = [];
    agent
      .get("https://boards-api.greenhouse.io")
      .intercept({ path: "/v1/boards/harbor-health/jobs?content=true", method: "GET" })
      .reply(() => {
        g.demoRequests.push("mock: GET boards-api.greenhouse.io/v1/boards/harbor-health/jobs?content=true");
        return { statusCode: 200, data: JSON.stringify(listing), responseOptions: { headers: { "content-type": "application/json" } } };
      })
      .persist();
    undici.setGlobalDispatcher(agent);
    const startupFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      g.demoRequests.push(`globalThis.fetch: ${typeof input === "string" ? input : input instanceof URL ? input.href : input.url}`);
      return startupFetch(input, init);
    };
  }, { listing: greenhouseListing, undiciPath: UNDICI });
}

export async function demoRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { demoRequests: string[] }).demoRequests);
}

export async function launchInstalled(options: { userData?: string; recordVideoDir?: string } = {}): Promise<InstalledApp> {
  const userData = options.userData ?? mkdtempSync(path.join(os.tmpdir(), "sojourner-film-"));
  const app = await electron.launch({
    executablePath: INSTALLED_EXE,
    // Keep painting while another window covers this one, so the screencast never freezes.
    args: [`--user-data-dir=${userData}`, "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows"],
    env: { ...process.env, NODE_ENV: "production" },
    timeout: 90_000,
    ...(options.recordVideoDir ? { recordVideo: { dir: options.recordVideoDir, size: VIEWPORT } } : {}),
  });
  const problems: string[] = [];
  await routeListing(app);
  const page = await app.firstWindow();
  watchProblems(page, problems);
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(size.width, size.height);
    window.center();
  }, VIEWPORT);
  await page.waitForLoadState("domcontentloaded");
  // ThemeProvider writes its theme once it has mounted; set Canopy after that, or it is overwritten.
  await expect(page.locator("html")).toHaveAttribute("data-theme", /.+/);
  await page.evaluate((key) => {
    localStorage.setItem("theme", "canopy");
    localStorage.setItem(key, "true");
  }, ONBOARDING_DISMISSED_KEY);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "canopy");
  return { app, page, userData, problems };
}

/** What the running process says it is: the identity the film claims. */
export async function buildIdentity(app: ElectronApplication): Promise<Record<string, unknown>> {
  return app.evaluate(({ app: electronApp }) => ({
    name: electronApp.getName(),
    version: electronApp.getVersion(),
    isPackaged: electronApp.isPackaged,
    execPath: process.execPath,
    appPath: electronApp.getAppPath(),
    userData: electronApp.getPath("userData"),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
}
