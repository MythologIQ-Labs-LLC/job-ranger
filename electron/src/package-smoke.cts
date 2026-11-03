import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SojournerBackend } from "./backend.cjs";
import type { CareerBackend } from "./career-backend.cjs";
import type { RequirementBackend } from "./requirement-backend.cjs";
import { BackupService } from "./backup-service.cjs";
import { JsonResumeAdapter } from "./json-resume-adapter.cjs";
import { SqliteClient, sql } from "./sqlite.cjs";

export interface PackageSmokeOptions {
  backend: SojournerBackend;
  careerBackend: CareerBackend;
  requirementBackend: RequirementBackend;
  userDataDirectory: string;
  dataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
  appVersion: string;
  platform: string;
  reportPath: string;
}

export interface PackageSmokeReport {
  schemaVersion: 1;
  status: "passed" | "failed";
  generatedAt: string;
  appVersion: string;
  platform: string;
  scenario: "healthcare-operations";
  checks: Record<string, boolean | number | string>;
  error?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function writePackageSmokeReport(
  reportPath: string,
  report: PackageSmokeReport,
): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function insertSyntheticHealthcareJob(
  sqlite: SqliteClient,
  companyId: string,
): Promise<{ jobId: string; snapshotId: string }> {
  const now = new Date().toISOString();
  const sourceJobId = "package-smoke-healthcare-job";
  const sourceUrl = "https://boards.greenhouse.io/sojourner-package-smoke/jobs/healthcare-001";
  const sourceText = [
    "Medical Office Coordinator",
    "Coordinate patient scheduling, referrals, insurance verification, and front-desk workflows for a multi-provider clinic.",
    "At least two years of patient scheduling experience is required.",
    "Experience with insurance verification is required.",
    "Working knowledge of HIPAA privacy practices is required.",
    "Current CPR or BLS certification is preferred.",
  ].join("\n");

  await sqlite.exec(sql`
    INSERT INTO jobs (
      company_id, source_job_id, source_type, title, location,
      employment_type, url, description_snippet, salary_min, salary_max,
      salary_currency, salary_text, post_date, created_at, last_seen_at,
      is_active, is_new, matched_filter_count, source_completeness
    ) VALUES (
      ${companyId}, ${sourceJobId}, ${"greenhouse"}, ${"Medical Office Coordinator"},
      ${"Baltimore, MD"}, ${"full-time"}, ${sourceUrl},
      ${"Coordinate patient scheduling, referrals, and insurance verification."},
      ${52000}, ${68000}, ${"USD"}, ${"$52,000-$68,000"}, ${null},
      ${now}, ${now}, ${1}, ${1}, ${0}, ${"full"}
    );
  `);

  const row = await sqlite.queryOne<{ id: number }>(sql`
    SELECT id FROM jobs
    WHERE company_id = ${companyId} AND source_job_id = ${sourceJobId}
    LIMIT 1;
  `);
  if (!row) throw new Error("Package smoke job was not persisted");

  const jobId = String(row.id);
  const snapshotId = `package-smoke-snapshot-${jobId}`;
  await sqlite.exec(sql`
    INSERT INTO job_source_snapshots (
      id, job_id, source_type, source_url, retrieved_at,
      extraction_version, completeness, content_text, content_hash
    ) VALUES (
      ${snapshotId}, ${row.id}, ${"greenhouse"}, ${sourceUrl}, ${now},
      ${"package-smoke/1"}, ${"full"}, ${sourceText}, ${sha256(sourceText)}
    );
  `);
  await sqlite.exec(sql`
    UPDATE jobs
    SET current_source_snapshot_id = ${snapshotId}, source_completeness = ${"full"}
    WHERE id = ${row.id};
  `);

  return { jobId, snapshotId };
}

export async function runPackagedSmoke(
  options: PackageSmokeOptions,
): Promise<PackageSmokeReport> {
  const generatedAt = new Date().toISOString();
  const checks: Record<string, boolean | number | string> = {};

  try {
    const profile = await options.careerBackend.saveProfile({
      version: 2,
      fullName: "Morgan Rivera",
      homeLocation: "Baltimore, MD",
      radiusMiles: 30,
      minimumPay: 52000,
      payBasis: "annual",
      targetTitles: ["Medical Office Coordinator", "Patient Services Coordinator"],
      skills: ["Patient scheduling", "Insurance verification", "HIPAA workflows"],
      certifications: ["CPR/BLS"],
      sectors: ["Healthcare"],
      onCallPreference: "no",
      fullTimeOnly: true,
      updatedAt: null,
    });
    checks.profileSaved = profile.fullName === "Morgan Rivera";

    const track = await options.careerBackend.createTargetTrack({
      name: "Healthcare operations",
      relation: "target",
      roleTitles: ["Medical Office Coordinator", "Patient Services Coordinator"],
      seniority: null,
      direction: "Patient-facing healthcare operations",
      constraints: {
        geography: {
          locations: ["Baltimore, MD"],
          radiusMiles: 30,
          strength: "preferred",
        },
        workModes: {
          values: ["on-site", "hybrid"],
          strength: "preferred",
        },
        employmentArrangements: {
          values: ["full-time"],
          strength: "required",
        },
        schedules: {
          values: ["day"],
          strength: "preferred",
        },
        compensation: {
          floor: 52000,
          target: 62000,
          basis: "annual",
          floorStrength: "required",
        },
        onCall: {
          value: "no",
          strength: "preferred",
        },
        industries: {
          values: ["Healthcare"],
          strength: "preferred",
        },
      },
      isActive: true,
    });
    checks.targetTrackCreated = track.name === "Healthcare operations";

    const roleEvidence = await options.careerBackend.createUserEvidence({
      subjectType: "role",
      organization: "Harbor Family Clinic",
      titleOrName: "Patient Services Coordinator",
      startDate: "2023-01",
      endDate: null,
      statement:
        "Coordinated patient scheduling, referrals, insurance verification, and front-desk workflows for a multi-provider clinic.",
      skills: ["Patient scheduling", "Insurance verification", "HIPAA workflows"],
      methodsOrTools: [],
      scope: ["Multi-provider outpatient clinic"],
      outcomes: ["Maintained accurate scheduling and referral workflows"],
      metrics: [],
      credential: null,
    });
    const credentialEvidence = await options.careerBackend.createUserEvidence({
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
    });
    checks.userEvidenceCreated =
      roleEvidence.verificationState === "user-authored" &&
      credentialEvidence.verificationState === "user-authored";

    const pastedImport = await options.careerBackend.importPastedText({
      label: "Healthcare operations background",
      text: [
        "Morgan Rivera",
        "Patient Services Coordinator, Harbor Family Clinic",
        "Coordinated patient scheduling, referrals, and insurance verification.",
        "Maintained HIPAA-aware front-desk workflows and patient communications.",
      ].join("\n"),
    });
    checks.pastedEvidenceImported =
      pastedImport.artifact.byteSize > 0 && pastedImport.extractionSnapshot !== null;

    const company = await options.backend.createCompany({
      name: "Package Smoke Healthcare Employer",
      url: "https://boards.greenhouse.io/sojourner-package-smoke",
      frequencyMinutes: 1440,
      isActive: false,
    });
    checks.companyAdded = company.sourceType === "greenhouse";

    const filter = await options.backend.createFilter({
      name: "Healthcare coordinator roles",
      companyId: company.id,
      titleInclude: ["coordinator"],
      titleExclude: [],
      keywordsInclude: ["patient", "scheduling"],
      keywordsExclude: [],
      salaryMin: 52000,
      locationInclude: ["Baltimore"],
      locationExclude: [],
      isActive: true,
    });
    checks.filterAdded = filter.name === "Healthcare coordinator roles";

    const sqlite = new SqliteClient(options.databasePath, options.sqliteBinaryPath);
    const synthetic = await insertSyntheticHealthcareJob(sqlite, company.id);
    checks.syntheticJobPersisted = Boolean(synthetic.jobId);
    checks.sourceSnapshotPersisted = Boolean(synthetic.snapshotId);

    const coverage = await options.requirementBackend.getJobEvidenceCoverage(
      synthetic.jobId,
    );
    checks.requirementsExtracted = coverage.items.length;
    checks.requirementsSupported = coverage.supportedCount;
    if (coverage.items.length === 0) {
      throw new Error("Package smoke did not extract requirements from the preserved source snapshot");
    }

    const application = await options.careerBackend.trackApplication(synthetic.jobId);
    const applied = await options.careerBackend.updateApplication(application.id, {
      status: "applied",
      notes: "Package smoke application lifecycle validation.",
    });
    checks.applicationTracked = applied.status === "applied";

    const jsonResumePath = path.join(
      options.userDataDirectory,
      "package-smoke-json-resume.json",
    );
    const jsonResume = new JsonResumeAdapter({
      dataDirectory: options.dataDirectory,
      databasePath: options.databasePath,
      sqliteBinaryPath: options.sqliteBinaryPath,
    });
    const exportResult = await jsonResume.exportFile(jsonResumePath);
    const jsonResumeStat = await fs.stat(jsonResumePath);
    checks.jsonResumeExported =
      jsonResumeStat.isFile() &&
      jsonResumeStat.size > 0 &&
      exportResult.exportedEvidenceCount >= 2;

    const backupParent = path.join(options.userDataDirectory, "package-smoke-backups");
    await fs.mkdir(backupParent, { recursive: true });
    const backupService = new BackupService({
      dataDirectory: options.dataDirectory,
      userDataDirectory: options.userDataDirectory,
      databasePath: options.databasePath,
      sqliteBinaryPath: options.sqliteBinaryPath,
      appVersion: options.appVersion,
    });
    const backup = await backupService.createBackup(backupParent);
    const validatedBackup = await backupService.validateBackup(backup.summary.bundlePath);
    checks.backupValidated = validatedBackup.summary.totalBytes > 0;
    checks.backupArtifactFiles = validatedBackup.summary.artifactFileCount;

    const [companies, jobs, filters, tracks, evidence, applications] = await Promise.all([
      options.backend.listCompanies(),
      options.backend.listJobs(),
      options.backend.listFilters(),
      options.careerBackend.listTargetTracks(),
      options.careerBackend.listEvidence(),
      options.careerBackend.listApplications(),
    ]);
    checks.persistedCompanies = companies.length;
    checks.persistedJobs = jobs.length;
    checks.persistedFilters = filters.length;
    checks.persistedTargetTracks = tracks.length;
    checks.persistedEvidence = evidence.length;
    checks.persistedApplications = applications.length;

    const requiredBooleans = [
      "profileSaved",
      "targetTrackCreated",
      "userEvidenceCreated",
      "pastedEvidenceImported",
      "companyAdded",
      "filterAdded",
      "syntheticJobPersisted",
      "sourceSnapshotPersisted",
      "applicationTracked",
      "jsonResumeExported",
      "backupValidated",
    ];
    for (const check of requiredBooleans) {
      if (checks[check] !== true) {
        throw new Error(`Package smoke check failed: ${check}`);
      }
    }

    const report: PackageSmokeReport = {
      schemaVersion: 1,
      status: "passed",
      generatedAt,
      appVersion: options.appVersion,
      platform: options.platform,
      scenario: "healthcare-operations",
      checks,
    };
    await writePackageSmokeReport(options.reportPath, report);
    return report;
  } catch (error) {
    const report: PackageSmokeReport = {
      schemaVersion: 1,
      status: "failed",
      generatedAt,
      appVersion: options.appVersion,
      platform: options.platform,
      scenario: "healthcare-operations",
      checks,
      error: error instanceof Error ? error.message : String(error),
    };
    await writePackageSmokeReport(options.reportPath, report);
    throw error;
  }
}
