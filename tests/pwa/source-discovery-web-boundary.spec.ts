import { expect, test, type BrowserContext } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;

test.beforeAll(async () => {
  server = await startPwaServer(distPwa);
});

test.afterAll(async () => {
  await server.close();
});

const roleGoal = "Customer Success Manager";
// Mirrors HIMALAYAS_WEB_WARNING in electron/src/source-discovery.cts.
const himalayasWebWarning =
  "Himalayas was skipped: the web app cannot reach its public API because Himalayas does not allow browser cross-origin requests (CORS). No proxy or credential workaround is used.";

const remoteOkRows = [
  { legal: "fixture metadata row" },
  {
    id: 8601,
    company: "Web Discovery Co",
    position: roleGoal,
    location: "Remote",
    description: "<p>Guide customers through onboarding.</p>",
    date: "2026-10-03T00:00:00Z",
    url: "https://remoteok.com/remote-jobs/8601",
  },
];

/** Serve the two browser-reachable public feeds and record every other off-origin request. */
async function routePublicFeeds(context: BrowserContext): Promise<string[]> {
  const outbound: string[] = [];
  const fulfill = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
  await context.route("https://remoteok.com/**", (route) => route.fulfill(fulfill(remoteOkRows)));
  await context.route("https://www.arbeitnow.com/**", (route) => route.fulfill(fulfill({ data: [] })));
  context.on("request", (request) => {
    const url = new URL(request.url());
    const isFixtureFeed = url.protocol === "https:" &&
      (url.hostname === "remoteok.com" || url.hostname === "www.arbeitnow.com");
    if (url.origin !== new URL(server.url).origin && !isFixtureFeed) {
      outbound.push(request.method() + " " + request.url());
    }
  });
  return outbound;
}

/**
 * The web app runs the same discovery core as the desktop app, but Himalayas
 * does not allow browser cross-origin requests. Discovery must skip it with an
 * honest warning instead of failing silently or attempting a workaround.
 */
test("web discovery skips Himalayas with an honest warning and never contacts it", async ({ page, context }) => {
  const outbound = await routePublicFeeds(context);

  await page.goto(server.url + "#/onboarding");
  await waitForRuntime(page);
  await page.getByRole("textbox", { name: "Work I want to pursue" }).fill(roleGoal);
  await page.getByRole("button", { name: "Save goals and continue" }).click();
  await expect(page.getByRole("heading", { name: "Your next steps" })).toBeVisible();

  await page.goto(server.url + "#/companies");
  await waitForRuntime(page);
  await page.getByRole("button", { name: "Find opportunities", exact: true }).click();
  await expect(page.getByText("Partial coverage", { exact: true })).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText(himalayasWebWarning, { exact: true })).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Web Discovery Co" })).toBeVisible();
  await expect(page.getByText("Found via Himalayas", { exact: true })).toHaveCount(0);

  const himalayasRequests = outbound.filter((entry) => {
    const host = new URL(entry.split(" ")[1]).hostname;
    return host === "himalayas.app" || host === "www.himalayas.app";
  });
  expect(himalayasRequests).toEqual([]);
  expect(outbound).toEqual([]);
});
