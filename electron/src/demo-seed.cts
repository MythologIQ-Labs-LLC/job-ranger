/**
 * Fictional demonstration workspace for the demo flavor of the web app.
 *
 * Seeds a fresh, empty workspace through the real application core: the same
 * boundary validators and backend services the IPC handlers use, the same
 * listing normalizers the source adapters use, the repository write that a
 * source scan performs, and the real requirement extraction and evidence
 * coverage. Nothing is written with ad hoc SQL.
 *
 * Morgan Rivera, Harbor Health and every listing below are fictional (see
 * scripts/demo/fixture.ts). Listing URLs use the reserved, never-resolving
 * `demo-listing.invalid` host, and the demo employer has no monitorable source
 * (no job-board token), so the demo never fetches anything from the network.
 */
import type { CareerProfile, CareerTargetTrackInput, Job, TrackedApplication } from "../../src/shared/contracts.js";
import type { UserAuthoredEvidenceInput } from "../../src/shared/evidence-authoring.js";
import { DEMO_LISTING_ORIGIN, demoListingUrl, isDemoListing } from "../../src/shared/demo-listing.js";
import type { JobScoutBackend } from "./backend.cjs";
import type { CareerBackend } from "./career-backend.cjs";
import type { RequirementBackend } from "./requirement-backend.cjs";
import { JobScoutRepository } from "./repository.cjs";
import { parseSalary, toSnippet, toSourceText } from "./scrapers.cjs";
import { SqliteClient } from "./sqlite.cjs";
import { validateCompanyDraft } from "./validators.cjs";
import {
  validateApplicationUpdate,
  validateCareerProfile,
  validateUserAuthoredEvidenceInput,
} from "./career-validators.cjs";
import { validateCareerTargetTrackInput } from "./target-track-validator.cjs";

export const DEMO_PERSON_NAME = "Morgan Rivera";
export const DEMO_EMPLOYER_NAME = "Harbor Health";
export const DEMO_EMPLOYER_URL = demoListingUrl("harbor-health");
export const DEMO_TARGET_TRACK_NAME = "Practice operations";
export const DEMO_EXTRACTION_VERSION = "job-ranger-demo-fixture-v1";

export const demoProfile: CareerProfile = {
  version: 2,
  fullName: DEMO_PERSON_NAME,
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
};

export const demoTargetTrack: CareerTargetTrackInput = {
  name: DEMO_TARGET_TRACK_NAME,
  relation: "target",
  roleTitles: ["Practice Operations Coordinator", "Clinic Operations Coordinator"],
  seniority: null,
  direction: "Move from the front desk into running practice operations",
  constraints: {
    geography: { locations: ["Baltimore, MD"], radiusMiles: 25, strength: "preferred" },
    workModes: { values: ["hybrid"], strength: "preferred" },
    employmentArrangements: { values: ["full-time"], strength: "required" },
    schedules: { values: ["day"], strength: "preferred" },
    compensation: { floor: 54000, target: 62000, basis: "annual", floorStrength: "required" },
    onCall: { value: "no", strength: "preferred" },
    industries: { values: ["Healthcare"], strength: "preferred" },
  },
  isActive: true,
};

const EVIDENCE_BASE = {
  methodsOrTools: [] as string[],
  scope: [] as string[],
  outcomes: [] as string[],
  metrics: [] as string[],
  credential: null,
  endDate: null as string | null,
};

/** User-authored (therefore confirmed) Career Evidence: two roles, one achievement, one active credential. */
export const demoEvidence: UserAuthoredEvidenceInput[] = [
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
    statement: "Scheduled patients and handled patient intake and insurance questions for a three-chair dental practice.",
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
    credential: {
      issuer: "American Heart Association",
      jurisdiction: null,
      status: "active",
      expirationDate: "2027-02-28",
      credentialId: null,
    },
  },
] as UserAuthoredEvidenceInput[];

export interface DemoListing {
  sourceJobId: string;
  title: string;
  location: string;
  employmentType: string;
  path: string;
  postDate: string;
  /** Listing body as a job board would publish it (HTML). */
  content: string;
}

/** Three fictional Harbor Health listings: annual and hourly pay, City, ST locations. */
export const demoListings: DemoListing[] = [
  {
    sourceJobId: "demo-practice-operations-coordinator",
    title: "Practice Operations Coordinator",
    location: "Baltimore, MD",
    employmentType: "full-time",
    path: "harbor-health/practice-operations-coordinator",
    postDate: "2026-10-05T09:00:00-04:00",
    content: [
      "<p>Harbor Health is hiring a Practice Operations Coordinator to keep a six-provider outpatient practice running smoothly: scheduling, referrals, insurance verification, and front-office workflow.</p>",
      "<ul>",
      "<li>Required: two or more years of patient scheduling in an outpatient clinic;</li>",
      "<li>Required: insurance verification;</li>",
      "<li>Required: referral coordination for multiple providers;</li>",
      "<li>Required: hands-on Epic EHR experience;</li>",
      "<li>Preferred: current CPR or BLS certification;</li>",
      "<li>Preferred: bachelor's degree in health administration.</li>",
      "</ul>",
      "<p>This is an on-site, full-time role. Salary: $56,000 - $66,000 per year.</p>",
    ].join(""),
  },
  {
    sourceJobId: "demo-patient-access-representative",
    title: "Patient Access Representative",
    location: "Towson, MD",
    employmentType: "full-time",
    path: "harbor-health/patient-access-representative",
    postDate: "2026-10-07T09:00:00-04:00",
    content: [
      "<p>Harbor Health's Towson clinic needs a Patient Access Representative to greet patients, register visits, and confirm coverage before appointments.</p>",
      "<ul>",
      "<li>Required: one year of patient intake or registration experience;</li>",
      "<li>Required: insurance verification;</li>",
      "<li>Preferred: fluency in English and Spanish.</li>",
      "</ul>",
      "<p>Full-time, on-site, day shift. Pay: $21.50 - $25.00 per hour.</p>",
    ].join(""),
  },
  {
    sourceJobId: "demo-clinic-operations-coordinator",
    title: "Clinic Operations Coordinator",
    location: "Columbia, MD",
    employmentType: "full-time",
    path: "harbor-health/clinic-operations-coordinator",
    postDate: "2026-10-01T09:00:00-04:00",
    content: [
      "<p>Coordinate daily operations for a Harbor Health primary care clinic: provider schedules, referral workflow, and front-office process improvement.</p>",
      "<ul>",
      "<li>Required: patient scheduling for multiple providers;</li>",
      "<li>Required: referral coordination;</li>",
      "<li>Required: Microsoft Excel reporting;</li>",
      "<li>Preferred: process improvement experience.</li>",
      "</ul>",
      "<p>Hybrid, full-time role. Salary: $60,000 - $70,000 per year.</p>",
    ].join(""),
  },
];

/** The listing the seeded application tracks. */
export const DEMO_TRACKED_LISTING_ID = "demo-clinic-operations-coordinator";
export const DEMO_APPLICATION_NOTES =
  "Fictional demo application: submitted through the employer's careers page and waiting to hear back. Sample data only.";

export interface DemoSeedOptions {
  backend: JobScoutBackend;
  careerBackend: CareerBackend;
  requirementBackend: RequirementBackend;
  databasePath: string;
  sqliteBinaryPath: string;
  /** The moment the demo listings are recorded as captured (defaults to now). */
  now?: Date;
}

export interface DemoSeedCoverage {
  jobId: string;
  title: string;
  requirements: number;
  supported: number;
  gaps: number;
}

export interface DemoSeedResult {
  status: "seeded" | "already-seeded";
  profileName: string;
  targetTrackId: string | null;
  evidenceIds: string[];
  companyId: string | null;
  jobIds: string[];
  applicationId: string | null;
  coverage: DemoSeedCoverage[];
}

async function seedDirection(careerBackend: CareerBackend): Promise<string> {
  await careerBackend.saveProfile(validateCareerProfile(demoProfile));
  // Saving a profile may derive a target track from it; configure that track as the
  // demo's single Target Track rather than leaving a duplicate beside it.
  const track = validateCareerTargetTrackInput(demoTargetTrack);
  const derived = (await careerBackend.listTargetTracks()).find((candidate) => candidate.origin === "legacy-profile");
  const saved = derived
    ? await careerBackend.updateTargetTrack(derived.id, track)
    : await careerBackend.createTargetTrack(track);
  return saved.id;
}

async function seedListings(options: DemoSeedOptions, companyId: string): Promise<Job[]> {
  const repository = new JobScoutRepository(new SqliteClient(options.databasePath, options.sqliteBinaryPath));
  const capturedAt = (options.now ?? new Date()).getTime();
  const jobs: Job[] = [];
  // The same normalization a job-board adapter applies to a published listing. Each
  // listing is recorded one minute apart, so Find Jobs (newest first) lists them in
  // this order, starting with the primary listing.
  for (const [index, listing] of demoListings.entries()) {
    const descriptionText = toSourceText(listing.content);
    const salary = parseSalary(listing.content);
    jobs.push(
      await repository.upsertJob({
        companyId,
        sourceJobId: listing.sourceJobId,
        sourceType: "unsupported",
        title: listing.title,
        location: listing.location,
        employmentType: listing.employmentType,
        url: demoListingUrl(listing.path),
        descriptionSnippet: toSnippet(listing.content),
        descriptionText,
        sourceCompleteness: "full",
        extractionVersion: DEMO_EXTRACTION_VERSION,
        salaryMin: salary?.min ?? null,
        salaryMax: salary?.max ?? null,
        salaryCurrency: salary?.currency ?? null,
        salaryText: salary?.text ?? null,
        postDate: listing.postDate,
        lastSeenAt: new Date(capturedAt - index * 60_000).toISOString(),
        matchedFilterCount: 0,
      }),
    );
  }
  return jobs;
}

/**
 * Seeds the fictional demo workspace. Idempotent-safe: if the demo employer is
 * already present nothing is written again. Fails closed (throws) if the core
 * would make the demo employer monitorable or the assessment would not show
 * both supported and unsupported requirements.
 */
export async function seedDemoWorkspace(options: DemoSeedOptions): Promise<DemoSeedResult> {
  const existing = (await options.backend.listCompanies()).find((company) => isDemoListing(company.url));
  if (existing) {
    return {
      status: "already-seeded",
      profileName: (await options.careerBackend.getProfile())?.fullName ?? "",
      targetTrackId: null,
      evidenceIds: [],
      companyId: existing.id,
      jobIds: [],
      applicationId: null,
      coverage: [],
    };
  }

  const targetTrackId = await seedDirection(options.careerBackend);

  const evidenceIds: string[] = [];
  for (const record of demoEvidence) {
    const created = await options.careerBackend.createUserEvidence(validateUserAuthoredEvidenceInput(record));
    evidenceIds.push(created.id);
  }

  const company = await options.backend.createCompany(
    validateCompanyDraft({ name: DEMO_EMPLOYER_NAME, url: DEMO_EMPLOYER_URL, frequencyMinutes: 1440, isActive: false }),
  );
  if (!company.url.startsWith(DEMO_LISTING_ORIGIN) || company.sourceType !== "unsupported" || company.sourceIdentifier !== null || company.isActive) {
    throw new Error("Demo seed: the fictional employer must not be a monitorable job source");
  }

  const jobs = await seedListings(options, company.id);

  const coverage: DemoSeedCoverage[] = [];
  for (const job of jobs) {
    const result = await options.requirementBackend.getJobEvidenceCoverage(job.id);
    coverage.push({ jobId: job.id, title: job.title, requirements: result.totalCount, supported: result.supportedCount, gaps: result.gapCount });
  }
  const primary = coverage[0];
  if (!primary || primary.supported === 0 || primary.gaps === 0) {
    throw new Error("Demo seed: the primary listing must show both supported and unsupported requirements");
  }

  const tracked = jobs.find((job) => job.sourceJobId === DEMO_TRACKED_LISTING_ID);
  if (!tracked) throw new Error("Demo seed: tracked listing is missing");
  const application: TrackedApplication = await options.careerBackend.trackApplication(tracked.id);
  await options.careerBackend.updateApplication(
    application.id,
    validateApplicationUpdate({ status: "applied", notes: DEMO_APPLICATION_NOTES }),
  );

  return {
    status: "seeded",
    profileName: DEMO_PERSON_NAME,
    targetTrackId,
    evidenceIds,
    companyId: company.id,
    jobIds: jobs.map((job) => job.id),
    applicationId: application.id,
    coverage,
  };
}
