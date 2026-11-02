import type {
  CandidateEvidence,
  Job,
  JobRequirement,
  RequirementEvidenceMap,
} from "../../src/shared/contracts.js";
import type { JobEvidenceCoverage } from "../../src/shared/requirement-coverage.js";
import { sql, SqliteClient } from "./sqlite.cjs";

type JobRow = {
  id: string;
  company_id: string;
  source_job_id: string;
  source_type: Job["sourceType"];
  title: string;
  location: string;
  employment_type: string | null;
  url: string;
  description_snippet: string;
  current_source_snapshot_id: string | null;
  source_completeness: Job["sourceCompleteness"];
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_text: string | null;
  post_date: string | null;
  created_at: string;
  last_seen_at: string;
  is_active: number;
  is_new: number;
  matched_filter_count: number;
};

type EvidenceRow = {
  id: string;
  subject_type: CandidateEvidence["subjectType"];
  organization: string | null;
  title_or_name: string | null;
  start_date: string | null;
  end_date: string | null;
  statement: string;
  action: string | null;
  context: string | null;
  skills_json: string;
  methods_or_tools_json: string;
  scope_json: string;
  outcomes_json: string;
  metrics_json: string;
  verification_state: CandidateEvidence["verificationState"];
  confidence: number | null;
  created_at: string;
  updated_at: string;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapJob(row: JobRow): Job {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    sourceJobId: row.source_job_id,
    sourceType: row.source_type,
    title: row.title,
    location: row.location,
    employmentType: row.employment_type,
    url: row.url,
    descriptionSnippet: row.description_snippet,
    currentSourceSnapshotId: row.current_source_snapshot_id ?? null,
    sourceCompleteness: row.source_completeness ?? "listing-only",
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryText: row.salary_text,
    postDate: row.post_date,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    isActive: Boolean(row.is_active),
    isNew: Boolean(row.is_new),
    matchedFilterCount: row.matched_filter_count,
  };
}

function mapEvidence(row: EvidenceRow): CandidateEvidence {
  return {
    id: row.id,
    subjectType: row.subject_type,
    organization: row.organization,
    titleOrName: row.title_or_name,
    startDate: row.start_date,
    endDate: row.end_date,
    statement: row.statement,
    action: row.action,
    context: row.context,
    skills: parseStringArray(row.skills_json),
    methodsOrTools: parseStringArray(row.methods_or_tools_json),
    scope: parseStringArray(row.scope_json),
    outcomes: parseStringArray(row.outcomes_json),
    metrics: parseStringArray(row.metrics_json),
    verificationState: row.verification_state,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RequirementRepository {
  constructor(private readonly sqlite: SqliteClient) {}

  async getJob(jobId: string): Promise<Job | null> {
    const row = await this.sqlite.queryOne<JobRow>(sql`
      SELECT
        CAST(id AS TEXT) AS id,
        CAST(company_id AS TEXT) AS company_id,
        source_job_id,
        source_type,
        title,
        location,
        employment_type,
        url,
        description_snippet,
        current_source_snapshot_id,
        source_completeness,
        salary_min,
        salary_max,
        salary_currency,
        salary_text,
        post_date,
        created_at,
        last_seen_at,
        is_active,
        is_new,
        matched_filter_count
      FROM jobs
      WHERE id = ${jobId}
      LIMIT 1;
    `);
    return row ? mapJob(row) : null;
  }

  async getCurrentSourceSnapshot(jobId: string): Promise<{ id: string; contentText: string; completeness: string } | null> {
    const row = await this.sqlite.queryOne<{ id: string; content_text: string; completeness: string }>(sql`
      SELECT snapshot.id, snapshot.content_text, snapshot.completeness
      FROM jobs job
      JOIN job_source_snapshots snapshot ON snapshot.id = job.current_source_snapshot_id
      WHERE job.id = ${jobId}
      LIMIT 1;
    `);
    return row ? { id: row.id, contentText: row.content_text, completeness: row.completeness } : null;
  }

  async listCareerEvidence(): Promise<CandidateEvidence[]> {
    const rows = await this.sqlite.queryAll<EvidenceRow>(`
      SELECT *
      FROM candidate_evidence
      WHERE verification_state != 'rejected'
      ORDER BY updated_at DESC;
    `);
    return rows.map(mapEvidence);
  }

  /**
   * Replace a job's stored coverage in one sqlite3 transaction.
   *
   * Coverage is recomputed on read, so two callers can rewrite the same job at
   * once (the Resume page loads coverage while a tailoring preview recomputes
   * it). Requirement and mapping ids are deterministic, so interleaving a
   * separate delete with per-row inserts made one caller fail with a UNIQUE or
   * FOREIGN KEY error. A single BEGIN IMMEDIATE invocation serializes them.
   */
  async replaceCoverage(coverage: JobEvidenceCoverage, sourceSnapshotId: string | null = null): Promise<void> {
    await this.sqlite.transaction([
      sql`
        DELETE FROM requirement_evidence_maps
        WHERE job_requirement_id IN (
          SELECT id FROM job_requirements WHERE job_id = ${coverage.jobId}
        );
      `,
      sql`DELETE FROM job_requirements WHERE job_id = ${coverage.jobId};`,
      ...coverage.items.flatMap((item) => [
        insertRequirementSql(item.requirement, sourceSnapshotId),
        insertMappingSql(item.mapping),
      ]),
    ]);
  }
}

function insertRequirementSql(requirement: JobRequirement, sourceSnapshotId: string | null): string {
  return sql`
    INSERT INTO job_requirements (
      id, job_id, kind, text, normalized_term, importance, source_text, source_snapshot_id, created_at
    ) VALUES (
      ${requirement.id}, ${requirement.jobId}, ${requirement.kind}, ${requirement.text},
      ${requirement.normalizedTerm}, ${requirement.importance}, ${requirement.sourceText},
      ${sourceSnapshotId}, ${requirement.createdAt}
    );
  `;
}

function insertMappingSql(mapping: RequirementEvidenceMap): string {
  return sql`
    INSERT INTO requirement_evidence_maps (
      id, job_requirement_id, evidence_id, classification, explanation,
      created_by, user_confirmed, created_at, updated_at
    ) VALUES (
      ${mapping.id}, ${mapping.jobRequirementId}, ${mapping.evidenceId},
      ${mapping.classification}, ${mapping.explanation}, ${mapping.createdBy},
      ${mapping.userConfirmed}, ${mapping.createdAt}, ${mapping.updatedAt}
    );
  `;
}
