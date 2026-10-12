import { test, expect } from "@playwright/test";
import type { CareerTargetTrackInput } from "../../src/shared/target-track-input";
import {
  closeElectronApp,
  launchElectronApp,
  navigateTo,
  type ElectronAppFixture,
} from "./electron-app";

let fixture: ElectronAppFixture;
let trackId = "";

const targetTrackInput: CareerTargetTrackInput = {
  name: "Customer success search",
  relation: "target",
  roleTitles: ["Customer Success Manager"],
  seniority: null,
  direction: null,
  constraints: {
    geography: {
      locations: ["Baltimore, MD"],
      radiusMiles: 40,
      strength: "preferred",
    },
    workModes: { values: ["remote"], strength: "preferred" },
    employmentArrangements: {
      values: ["full-time"],
      strength: "preferred",
    },
    schedules: { values: [], strength: "preferred" },
    compensation: {
      floor: null,
      target: null,
      basis: "annual",
      floorStrength: "preferred",
    },
    onCall: { value: "either", strength: "preferred" },
    industries: { values: [], strength: "preferred" },
  },
  isActive: true,
};

test.beforeAll(async () => {
  fixture = await launchElectronApp();

  await fixture.electronApp.evaluate(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const remoteOkRows = [
      { legal: "fixture metadata row" },
      {
        id: 8501,
        company: "Acme Discovery",
        position: "Customer Success Manager",
        location: "Remote",
        description: "<p>Own customer onboarding and adoption outcomes.</p>",
        date: "2026-10-03T00:00:00Z",
        url: "https://remoteok.com/remote-jobs/8501",
        apply_url: "https://boards.greenhouse.io/acme-discovery/jobs/8501",
      },
    ];
    const arbeitnowRows = {
      data: [
        {
          slug: "beta-customer-success",
          company_name: "Beta Discovery",
          title: "Customer Success Specialist",
          description: "Support customers across implementation and adoption.",
          remote: true,
          url: "https://www.arbeitnow.com/jobs/beta-customer-success",
          tags: ["customer success"],
          job_types: ["Full-time"],
          location: "Remote",
          created_at: 1790985600,
        },
      ],
    };

    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "https://remoteok.com/api") {
        return new Response(JSON.stringify(remoteOkRows), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://www.arbeitnow.com/api/job-board-api?page=1") {
        return new Response(JSON.stringify(arbeitnowRows), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://himalayas.app/jobs/api/search?")) {
        return new Response(JSON.stringify({
          jobs: [{
            guid: "h-e2e-1",
            companyName: "Himalayas Discovery",
            title: "Customer Success Manager",
            applicationLink: "https://himalayas.app/jobs/h-e2e-1",
            locationRestrictions: ["United States"],
            timezoneRestrictions: ["UTC-05:00"],
            employmentType: "Full Time",
            excerpt: "Help enterprise customers reach successful outcomes.",
            pubDate: 1791504000000,
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });

  trackId = await fixture.page.evaluate(async (input) => {
    const track = await window.electronAPI.career.createTargetTrack(input);
    return track.id;
  }, targetTrackInput);
});

test.afterAll(async () => {
  await closeElectronApp(fixture);
});

test("discovers opportunities, dismisses a lead, and approves a monitorable employer source", async () => {
  const { page } = fixture;
  await navigateTo(page, "/companies");

  await expect(
    page.getByRole("heading", {
      name: "Find places to look, then choose what Job Ranger should monitor.",
      exact: true,
    }),
  ).toBeVisible();

  const trackSelect = page.getByRole("combobox", {
    name: "Discovery target track",
    exact: true,
  });
  await expect(trackSelect).toHaveValue(trackId);
  await expect(page.getByText("Baltimore, MD", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Find opportunities", exact: true }).click();
  await expect(page.getByText("Partial coverage", { exact: true })).toBeVisible();

  const monitorableCard = page.locator("article").filter({ hasText: "Acme Discovery" });
  await expect(monitorableCard).toBeVisible();
  await expect(monitorableCard.getByText("Remote OK", { exact: false })).toBeVisible();
  await expect(
    monitorableCard.getByText("Monitorable employer source found", { exact: true }),
  ).toBeVisible();

  const opportunityOnlyCard = page.locator("article").filter({ hasText: "Beta Discovery" });
  await expect(opportunityOnlyCard).toBeVisible();
  await expect(opportunityOnlyCard.getByText("Arbeitnow", { exact: false })).toBeVisible();
  await expect(opportunityOnlyCard.getByText("Opportunity only", { exact: true })).toBeVisible();

  const himalayasCard = page.locator("article").filter({ hasText: "Himalayas Discovery" });
  await expect(himalayasCard).toBeVisible();
  await expect(himalayasCard.getByText("Found via Himalayas", { exact: true })).toBeVisible();
  await expect(himalayasCard.getByText("Remote · United States · UTC-05:00 time zone", { exact: true })).toBeVisible();
  await expect(himalayasCard.getByText("Opportunity only", { exact: true })).toBeVisible();
  await expect(himalayasCard.getByRole("button", { name: "Approve & monitor source" })).toHaveCount(0);

  await opportunityOnlyCard
    .getByRole("button", {
      name: "Dismiss Customer Success Specialist at Beta Discovery",
      exact: true,
    })
    .click();
  await expect(opportunityOnlyCard).toHaveCount(0);
  await expect(page.getByText("1 dismissed this run", { exact: true })).toBeVisible();

  await monitorableCard
    .getByRole("button", { name: "Approve & monitor source", exact: true })
    .click();
  await expect(
    monitorableCard.getByText("Approved for monitoring", { exact: true }),
  ).toBeVisible();

  const companies = await page.evaluate(() => window.electronAPI.companies.list());
  const approved = companies.find((company) => company.name === "Acme Discovery");
  expect(approved).toBeTruthy();
  expect(approved?.sourceType).toBe("greenhouse");
  expect(approved?.sourceIdentifier).toBe("acme-discovery");
  expect(approved?.url).toBe("https://boards.greenhouse.io/acme-discovery");
  expect(approved?.isActive).toBe(true);

  await page.getByRole("button", { name: "Find opportunities", exact: true }).click();
  const rediscovered = page.locator("article").filter({ hasText: "Acme Discovery" });
  await expect(rediscovered).toBeVisible();
  await expect(rediscovered.getByText("Already monitored", { exact: true })).toBeVisible();
  await expect(
    rediscovered.getByRole("button", { name: "Approve & monitor source", exact: true }),
  ).toHaveCount(0);
});
