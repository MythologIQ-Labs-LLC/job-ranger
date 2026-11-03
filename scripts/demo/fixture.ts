// Deterministic fictional demo fixture. Morgan Rivera and Harbor Health are
// fictional; no real person's career data is used.
import type { BrowserContext, Page } from "@playwright/test";
import { ONBOARDING_DISMISSED_KEY } from "../../src/demo/session";

export const DEMO_JOB_TITLE = "Practice Operations Coordinator";
export const DEMO_EMPLOYER = "Harbor Health";
export const TARGET_TRACK = "Practice operations";

export const demoProfile = {
  version: 2,
  fullName: "Morgan Rivera",
  homeLocation: "Baltimore, MD",
  radiusMiles: 25,
  minimumPay: 54000,
  payBasis: "annual",
  targetTitles: ["Practice Operations Coordinator", "Clinic Operations Coordinator"],
  skills: ["Patient scheduling", "Insurance verification", "Referral coordination"],
  certifications: ["CPR/BLS"],
  sectors: ["Healthcare"],
  onCallPreference: "no",
  fullTimeOnly: true,
  updatedAt: null,
} as const;

// Listing served through the Greenhouse API boundary (routed in the browser; no live network).
export const greenhouseListing = {
  jobs: [
    {
      id: 4100777,
      title: DEMO_JOB_TITLE,
      absolute_url: "https://boards.greenhouse.io/harbor-health/jobs/4100777",
      location: { name: "Baltimore, MD" },
      updated_at: "2026-10-05T09:00:00-04:00",
      content: [
        "&lt;p&gt;Harbor Health is hiring a Practice Operations Coordinator to keep a six-provider outpatient practice running smoothly: scheduling, referrals, insurance verification, and front-office workflow.&lt;/p&gt;",
        "&lt;ul&gt;",
        "&lt;li&gt;Required: two or more years of patient scheduling in an outpatient clinic;&lt;/li&gt;",
        "&lt;li&gt;Required: insurance verification;&lt;/li&gt;",
        "&lt;li&gt;Required: referral coordination for multiple providers;&lt;/li&gt;",
        "&lt;li&gt;Required: hands-on Epic EHR experience;&lt;/li&gt;",
        "&lt;li&gt;Preferred: current CPR or BLS certification;&lt;/li&gt;",
        "&lt;li&gt;Preferred: bachelor's degree in health administration.&lt;/li&gt;",
        "&lt;/ul&gt;",
        "&lt;p&gt;This is an on-site, full-time role. Salary: $56,000 - $66,000 per year.&lt;/p&gt;",
      ].join(""),
    },
  ],
};

async function call<T>(page: Page, fn: (arg: never) => Promise<T>, arg?: unknown): Promise<T> {
  return page.evaluate(fn as never, arg as never) as Promise<T>;
}

/** Morgan's profile and two Target Tracks: the current role and the target direction. */
const SHARED_CONSTRAINTS = {
  geography: { locations: ["Baltimore, MD"], radiusMiles: 25, strength: "preferred" },
  schedules: { values: ["day"], strength: "preferred" },
  onCall: { value: "no", strength: "preferred" },
  industries: { values: ["Healthcare"], strength: "preferred" },
};

/** Where Morgan is going (the target) and where Morgan works today (current). */
export const demoTracks = {
  target: {
    name: TARGET_TRACK,
    relation: "target",
    roleTitles: ["Practice Operations Coordinator", "Clinic Operations Coordinator"],
    seniority: null,
    direction: "Move from the front desk into running practice operations",
    constraints: {
      ...SHARED_CONSTRAINTS,
      workModes: { values: ["hybrid"], strength: "preferred" },
      employmentArrangements: { values: ["full-time"], strength: "required" },
      compensation: { floor: 54000, target: 62000, basis: "annual", floorStrength: "required" },
    },
    isActive: true,
  },
  current: {
    name: "Patient services (current)",
    relation: "current",
    roleTitles: ["Patient Services Coordinator", "Front Desk Coordinator"],
    seniority: null,
    direction: "Where Morgan works today",
    constraints: {
      ...SHARED_CONSTRAINTS,
      workModes: { values: ["on-site"], strength: "preferred" },
      employmentArrangements: { values: ["full-time"], strength: "preferred" },
      compensation: { floor: 48000, target: 52000, basis: "annual", floorStrength: "preferred" },
    },
    isActive: false,
  },
};

/**
 * Saving the profile creates a profile-derived track; it is configured as the
 * target direction (which promotes it to a user track) rather than left as a
 * third, duplicate track.
 */
async function seedDirection(page: Page): Promise<void> {
  await call(page, (profile) => window.electronAPI.career.saveProfile(profile as never), demoProfile);
  await page.evaluate(async (tracks) => {
    const api = window.electronAPI.career;
    const [derived] = (await api.listTargetTracks()).filter((track) => track.origin === "legacy-profile");
    if (!derived) throw new Error("expected the profile-derived target track");
    await api.updateTargetTrack(derived.id, tracks.target as never);
    await api.createTargetTrack(tracks.current as never);
  }, demoTracks);
}

const EVIDENCE_BASE = { methodsOrTools: [], scope: [], outcomes: [], metrics: [], credential: null, endDate: null };

/** User-authored Career Evidence: two roles, one achievement, one active credential. */
export const demoEvidence = [
  {
    ...EVIDENCE_BASE,
    subjectType: "role",
    organization: "Harbor Family Clinic",
    titleOrName: "Patient Services Coordinator",
    startDate: "2023-01",
    statement:
      "Coordinated patient scheduling, referral coordination, and insurance verification for six providers at an outpatient clinic.",
    skills: ["Patient scheduling", "Referral coordination", "Insurance verification"],
    scope: ["Six-provider outpatient clinic"],
  },
  {
    ...EVIDENCE_BASE,
    subjectType: "achievement",
    organization: "Harbor Family Clinic",
    titleOrName: "Referral backlog cleanup",
    startDate: "2024-03",
    statement:
      "Rebuilt the referral queue so each request was paired with insurance verification, cutting the backlog from weeks to days.",
    skills: ["Referral coordination", "Process improvement"],
    outcomes: ["Referral backlog reduced from weeks to days"],
  },
  {
    ...EVIDENCE_BASE,
    subjectType: "role",
    organization: "Chesapeake Family Dental",
    titleOrName: "Front Desk Coordinator",
    startDate: "2020-06",
    endDate: "2022-12",
    statement: "Scheduled patients and handled intake and insurance questions for a three-chair dental practice.",
    skills: ["Patient scheduling", "Patient intake"],
  },
  {
    ...EVIDENCE_BASE,
    subjectType: "credential",
    organization: "American Heart Association",
    titleOrName: "BLS Provider",
    startDate: "2025-02",
    statement: "Current Basic Life Support (CPR/BLS) certification.",
    skills: ["CPR", "BLS"],
    credential: { issuer: "American Heart Association", jurisdiction: null, status: "active", expirationDate: "2027-02-28", credentialId: null },
  },
];

async function seedEvidence(page: Page): Promise<void> {
  await page.evaluate(async (records) => {
    for (const record of records) await window.electronAPI.career.createUserEvidence(record as never);
  }, demoEvidence);
}

/** One monitored Greenhouse source, scraped once through the routed listing. */
async function seedSource(page: Page): Promise<void> {
  const company = await page.evaluate(() =>
    window.electronAPI.companies.create({
      name: "Harbor Health",
      url: "https://boards.greenhouse.io/harbor-health",
      frequencyMinutes: 1440,
      isActive: false,
    }),
  );
  const run = await page.evaluate((id) => window.electronAPI.companies.runScrape(id), company.id);
  if (run.status !== "success") throw new Error(`demo source scrape failed: ${run.status}`);
}

/** Seeds Morgan's direction, Career Evidence, and one monitored source. */
export async function seedDemo(page: Page): Promise<void> {
  await seedDirection(page);
  await seedEvidence(page);
  await seedSource(page);
}

/** Shared by the recorded story and the screenshot pass: routed listing, Canopy, onboarding dismissed. */
export async function prepareDemoContext(context: BrowserContext): Promise<void> {
  await context.route("https://boards-api.greenhouse.io/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(greenhouseListing) }),
  );
  await context.addInitScript((onboardingDismissedKey) => {
    localStorage.setItem("theme", "canopy");
    localStorage.setItem(onboardingDismissedKey, "true");
  }, ONBOARDING_DISMISSED_KEY);
}
