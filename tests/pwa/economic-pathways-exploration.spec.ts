import { expect, test } from "@playwright/test";
import { startPwaServer, type PwaServer } from "./support/server";
import { distPwa, waitForRuntime } from "./support/fixtures";

let server: PwaServer;
test.beforeAll(async () => { server = await startPwaServer(distPwa); });
test.afterAll(async () => { await server.close(); });

test("user-directed economic comparison preserves unknowns and never becomes a Target Track or a forecast", async ({ page }) => {
  await page.goto(server.url + "#/target-tracks");
  await waitForRuntime(page);
  await expect(page.getByRole("heading", { name: "Keep different career directions separate." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore other ways to earn" })).toBeVisible();
  await expect(page.getByText(/Not saved: navigating away or reloading/)).toBeVisible();
  await page.getByText("Open pathway comparison").click();

  const a = page.getByRole("article", { name: "Path A comparison" });
  const b = page.getByRole("article", { name: "Path B comparison" });
  await expect(a.getByText("Monthly net estimate:")).toContainText("Unknown");
  await expect(a.getByText("Difference from monthly minimum:")).toContainText("Unknown");
  await expect(a.getByText("Still unknown")).toBeVisible();
  await expect(a.getByText(/Verify that the role, pay, and benefits/)).toBeVisible();

  await page.getByRole("combobox", { name: "Comparison currency" }).selectOption("USD");
  await page.getByRole("spinbutton", { name: "Minimum sustainable monthly income" }).fill("4000");
  await page.getByRole("spinbutton", { name: "Evaluation horizon in months" }).fill("3");
  await a.getByRole("textbox", { name: "Path A name" }).fill("Immediate paid work");
  await a.getByRole("spinbutton", { name: "Path A monthly gross income" }).fill("4700");
  await a.getByRole("spinbutton", { name: "Path A monthly costs" }).fill("650");
  await a.getByRole("spinbutton", { name: "Path A upfront costs" }).fill("0");
  await a.getByRole("spinbutton", { name: "Path A months to first income" }).fill("1");
  await expect(a.getByText("Monthly net estimate:")).toContainText("4,050");
  await expect(a.getByText("Difference from monthly minimum:")).toContainText("+");
  await expect(a.getByText("Difference from monthly minimum:")).toContainText("50");
  await expect(a.getByText("Income starts inside your chosen horizon:")).toContainText("Yes, based on your estimate");

  await b.getByRole("combobox", { name: "Path B type" }).selectOption("self-employment");
  await b.getByRole("spinbutton", { name: "Path B monthly gross income" }).fill("6200");
  await b.getByRole("spinbutton", { name: "Path B monthly costs" }).fill("1800");
  await b.getByRole("spinbutton", { name: "Path B upfront costs" }).fill("5500");
  await b.getByRole("spinbutton", { name: "Path B months to first income" }).fill("8");
  await expect(b.getByText("Monthly net estimate:")).toContainText("4,400");
  await expect(b.getByText("Income starts inside your chosen horizon:")).toContainText("Not on your timeline");
  await expect(b.getByText(/Validate paying customer demand/)).toBeVisible();

  await b.getByRole("spinbutton", { name: "Path B monthly costs" }).fill("");
  await expect(b.getByText("Monthly net estimate:")).toContainText("Unknown");
  await expect(b.getByText("Still unknown")).toBeVisible();
  await expect(b.getByText("Costs, taxes and benefits allowance")).toBeVisible();
  await b.getByRole("spinbutton", { name: "Path B monthly gross income" }).fill("-1");
  await expect(page.getByRole("alert")).toContainText("finite, nonnegative");
  await b.getByRole("spinbutton", { name: "Path B monthly gross income" }).fill("");
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Existing canonical Target Track editing must remain separate and durable.
  await page.getByRole("textbox", { name: "Track name" }).fill("Healthcare employment");
  await page.getByRole("textbox", { name: "Roles in this track" }).fill("Patient Services Coordinator");
  await page.getByRole("button", { name: "Save target track" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await waitForRuntime(page);
  await expect(page.getByText("Healthcare employment", { exact: true }).first()).toBeVisible();
  await page.getByText("Open pathway comparison").click();
  await expect(page.getByRole("combobox", { name: "Comparison currency" })).toHaveValue("");
  await expect(page.getByRole("spinbutton", { name: "Minimum sustainable monthly income" })).toHaveValue("");
  await expect(a.getByRole("spinbutton", { name: "Path A monthly gross income" })).toHaveValue("");
  await expect(a.getByText("Monthly net estimate:")).toContainText("Unknown");
});
