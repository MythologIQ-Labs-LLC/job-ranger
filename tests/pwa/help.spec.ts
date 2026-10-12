import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("in-app Help works offline and links to real Career Ops routes", async ({ page, context }) => {
  const thirdPartyRequests: string[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(server.url).origin) {
      thirdPartyRequests.push(request.url());
    }
  });

  await context.addInitScript(() => localStorage.setItem("job-ranger.onboarding.dismissed.v1", "true"));
  await page.goto(`${server.url}#/help`);
  await waitForRuntime(page);

  const helpNavigation = page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Help", exact: true });
  await expect(helpNavigation).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /Find a better path/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your workflow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keep control of your work and data" })).toBeVisible();
  await expect(page.getByText(/browser profile and the exact address/i)).toBeVisible();
  await expect(page.getByText(/prepared post is not a published post/i)).toBeVisible();

  // Route transitions reuse the bundled renderer rather than an external help page.
  await page.getByRole("main").getByRole("link", { name: "Open Target Tracks" }).click();
  await expect(page).toHaveURL(/#\/target-tracks$/);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Target Tracks" })).toHaveAttribute("aria-current", "page");

  // Once the application is loaded, its Help page remains navigable without network.
  await context.setOffline(true);
  await helpNavigation.click();
  await expect(page).toHaveURL(/#\/help$/);
  await expect(page.getByRole("heading", { name: /Find a better path/i })).toBeVisible();
  await expect(helpNavigation).toHaveAttribute("aria-current", "page");
  await context.setOffline(false);
  expect(thirdPartyRequests).toEqual([]);
});
