import type { ResumeArtifactSnapshot } from "../../src/shared/resume-contracts.js";
import type {
  InterviewPrepRequirement,
  InterviewPrepResult,
  InterviewPrepSubmissionRelation,
  InterviewPrepSubmittedResume,
} from "../../src/shared/interview-prep.js";
import type { RequirementCoverageItem } from "../../src/shared/requirement-coverage.js";
import { RequirementBackend } from "./requirement-backend.cjs";
import { sql, SqliteClient } from "./sqlite.cjs";

interface InterviewPrepBackendOptions {
  databasePath: string;
  sqliteBinaryPath: string;
}

type ApplicationRow = {
  id: string;
  job_id: string;
  title: string;
  company_name: string;
  url: string;
  status: string;
};

type JobRow = {
  location: string;
  employment_type: string | null;
  description_snippet: string;
};

type SubmittedArtifactRow = {
  artifact_id: string;
  projection_id: string;
  version: number;
  artifact_created_at: string;
  recorded_at: string;
  projection_snapshot_json: string;
};

type LineageRow = {
  predecessor_evidence_id: string;
  successor_evidence_id: string;
};

type SubmissionContext = {
  relation: InterviewPrepSubmissionRelation;
  statementTexts: string[];
};

function clip(value: string, max = 170): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3).trimEnd()}...`;
}

function parseSnapshot(value: string): ResumeArtifactSnapshot | null {
  try {
    const parsed = JSON.parse(value) as ResumeArtifactSnapshot;
    if (!parsed || !parsed.projection || !Array.isArray(parsed.statements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function predecessorMap(rows: LineageRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.successor_evidence_id) ?? [];
    existing.push(row.predecessor_evidence_id);
    map.set(row.successor_evidence_id, existing);
  }
  return map;
}

function ancestorEvidenceIds(
  evidenceId: string,
  predecessorsBySuccessor: Map<string, string[]>,
): Set<string> {
  const ancestors = new Set<string>();
  const pending = [...(predecessorsBySuccessor.get(evidenceId) ?? [])];
  while (pending.length > 0) {
    const predecessor = pending.pop();
    if (!predecessor || ancestors.has(predecessor)) continue;
    ancestors.add(predecessor);
    pending.push(...(predecessorsBySuccessor.get(predecessor) ?? []));
  }
  return ancestors;
}

function submissionContext(
  evidenceId: string | null,
  submittedResume: InterviewPrepSubmittedResume | null,
  predecessorsBySuccessor: Map<string, string[]>,
): SubmissionContext {
  if (!evidenceId || !submittedResume) {
    return { relation: "none", statementTexts: [] };
  }

  const exactStatements = submittedResume.statements.filter((statement) =>
    statement.evidenceIds.includes(evidenceId),
  );
  if (exactStatements.length > 0) {
    return {
      relation: "exact",
      statementTexts: exactStatements.map((statement) => statement.text),
    };
  }

  const ancestors = ancestorEvidenceIds(evidenceId, predecessorsBySuccessor);
  if (ancestors.size === 0) {
    return { relation: "none", statementTexts: [] };
  }

  const predecessorStatements = submittedResume.statements.filter((statement) =>
    statement.evidenceIds.some((id) => ancestors.has(id)),
  );
  if (predecessorStatements.length === 0) {
    return { relation: "none", statementTexts: [] };
  }

  return {
    relation: "superseded",
    statementTexts: predecessorStatements.map((statement) => statement.text),
  };
}

function buildPrompt(
  item: RequirementCoverageItem,
  submissionRelation: InterviewPrepSubmissionRelation,
): string {
  const requirement = clip(item.requirement.text, 150);
  const evidence = item.evidence ? clip(item.evidence.statement, 170) : null;
  const changedSinceSubmission = submissionRelation === "superseded";

  switch (item.mapping.classification) {
    case "direct":
      if (submissionRelation === "exact") {
        return `Be ready to expand on the submitted evidence that supports “${requirement}”: ${evidence}.`;
      }
      if (changedSinceSubmission) {
        return `An earlier evidence-linked claim for “${requirement}” appeared on the submitted resume, but your current confirmed record has since changed. Prepare to explain the current record accurately and distinguish it from the wording the employer saw: ${evidence}.`;
      }
      return `You have confirmed evidence for “${requirement},” but it was not in the submitted resume. Use it as additional context if asked, without implying the employer already saw it: ${evidence}.`;
    case "transferable":
      if (submissionRelation === "exact") {
        return `Prepare a concise explanation connecting this submitted transferable evidence to “${requirement}”: ${evidence}.`;
      }
      if (changedSinceSubmission) {
        return `The submitted resume contained an earlier evidence-linked claim related to “${requirement},” and the current transferable evidence has since changed. Explain the current record accurately and be clear about what wording the employer originally saw: ${evidence}.`;
      }
      return `Prepare to connect this confirmed transferable evidence to “${requirement}.” It was not in the submitted resume, so present it as additional context: ${evidence}.`;
    case "ambiguous":
      if (changedSinceSubmission) {
        return `The submitted resume contained an earlier related claim for “${requirement},” but the current evidence is ambiguous and has since changed. Prepare an honest clarification of the current record and what was originally submitted.`;
      }
      return evidence
        ? `The current evidence is ambiguous for “${requirement}.” Prepare an honest clarification of what you did and did not do: ${evidence}.`
        : `The current evidence is ambiguous for “${requirement}.” Prepare to clarify your actual experience without stretching the claim.`;
    case "gap":
      return `No confirmed Career Evidence currently supports “${requirement}.” Decide how you will address the gap directly without inventing experience.`;
  }
}

function requirementPrep(
  item: RequirementCoverageItem,
  submittedResume: InterviewPrepSubmittedResume | null,
  predecessorsBySuccessor: Map<string, string[]>,
): InterviewPrepRequirement {
  const evidenceId = item.evidence?.id ?? null;
  const submitted = submissionContext(
    evidenceId,
    submittedResume,
    predecessorsBySuccessor,
  );

  return {
    requirementId: item.requirement.id,
    kind: item.requirement.kind,
    text: item.requirement.text,
    importance: item.requirement.importance,
    classification: item.mapping.classification,
    explanation: item.mapping.explanation,
    evidenceId,
    evidenceStatement: item.evidence?.statement ?? null,
    evidenceWasSubmitted: submitted.relation === "exact",
    submissionRelation: submitted.relation,
    submittedStatementTexts: submitted.statementTexts,
    preparationPrompt: buildPrompt(item, submitted.relation),
  };
}

export class InterviewPrepBackend {
  private readonly sqlite: SqliteClient;
  private readonly requirementBackend: RequirementBackend;

  constructor(options: InterviewPrepBackendOptions) {
    this.sqlite = new SqliteClient(options.databasePath, options.sqliteBinaryPath);
    this.requirementBackend = new RequirementBackend(options);
  }

  async get(applicationId: string): Promise<InterviewPrepResult> {
    const application = await this.sqlite.queryOne<ApplicationRow>(sql`
      SELECT id, job_id, title, company_name, url, status
      FROM applications
      WHERE id = ${applicationId}
      LIMIT 1;
    `);
    if (!application) throw new Error(`Application ${applicationId} not found`);

    const warnings: string[] = [];
    const job = await this.sqlite.queryOne<JobRow>(sql`
      SELECT location, employment_type, description_snippet
      FROM jobs
      WHERE id = ${application.job_id}
      LIMIT 1;
    `);
    if (!job) {
      warnings.push(
        "The original tracked job record is no longer available, so requirement-specific preparation cannot be rebuilt from the listing.",
      );
    }

    const artifact = await this.sqlite.queryOne<SubmittedArtifactRow>(sql`
      SELECT
        artifacts.id AS artifact_id,
        artifacts.projection_id AS projection_id,
        artifacts.version AS version,
        artifacts.created_at AS artifact_created_at,
        links.recorded_at AS recorded_at,
        snapshots.projection_snapshot_json AS projection_snapshot_json
      FROM application_artifact_links AS links
      JOIN resume_artifacts AS artifacts ON artifacts.id = links.resume_artifact_id
      JOIN resume_artifact_snapshots AS snapshots ON snapshots.artifact_id = artifacts.id
      WHERE links.application_id = ${applicationId}
        AND links.purpose = 'submitted'
      ORDER BY
        links.recorded_at DESC,
        artifacts.version DESC,
        artifacts.created_at DESC,
        artifacts.id DESC
      LIMIT 1;
    `);

    let submittedResume: InterviewPrepSubmittedResume | null = null;
    if (!artifact) {
      warnings.push(
        "No exact submitted resume is recorded for this application. Prep can use confirmed Career Evidence, but it cannot tell you which claims the employer already saw.",
      );
    } else {
      const snapshot = parseSnapshot(artifact.projection_snapshot_json);
      if (!snapshot) {
        warnings.push(
          "The submitted resume snapshot could not be read, so Sojourner will not guess what the employer saw.",
        );
      } else {
        submittedResume = {
          artifactId: artifact.artifact_id,
          projectionId: artifact.projection_id,
          version: artifact.version,
          recordedAt: artifact.recorded_at,
          artifactCreatedAt: artifact.artifact_created_at,
          statements: snapshot.statements.map((statement) => ({
            id: statement.id,
            section: statement.section,
            text: statement.text,
            evidenceIds: [...statement.evidenceIds],
          })),
        };
      }
    }

    const lineageRows = submittedResume
      ? await this.sqlite.queryAll<LineageRow>(`
          SELECT predecessor_evidence_id, successor_evidence_id
          FROM evidence_lineage
          WHERE relation = 'supersedes';
        `)
      : [];
    const predecessorsBySuccessor = predecessorMap(lineageRows);

    let requirements: InterviewPrepRequirement[] = [];
    if (job) {
      try {
        const coverage = await this.requirementBackend.getJobEvidenceCoverage(application.job_id);
        requirements = coverage.items.map((item) =>
          requirementPrep(item, submittedResume, predecessorsBySuccessor),
        );
        if (coverage.totalCount === 0) {
          warnings.push(
            "No explicit job requirements could be extracted from the saved listing text. Use the job context and submitted resume, but treat requirement coverage as unknown.",
          );
        }
      } catch (error) {
        warnings.push(
          `Requirement coverage could not be rebuilt: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const gaps = requirements.filter(
      (item) => item.classification === "gap" || item.classification === "ambiguous",
    );
    const suggestedQuestions = [
      `Why are you interested in ${application.title} at ${application.company_name}?`,
      submittedResume
        ? "Which claim on the resume you submitted is most relevant to this role, and what evidence supports it now?"
        : "Which confirmed Career Evidence example best demonstrates your fit for this role?",
      ...(requirements.some((item) => item.submissionRelation === "superseded")
        ? ["Has any evidence-linked claim changed since you submitted the resume, and how will you explain the current record accurately?"]
        : []),
      ...(gaps.length > 0
        ? ["How will you address requirements that are gaps or ambiguous without overstating your experience?"]
        : []),
      "What do you want to learn from the interviewer about the role, team, expectations, or working environment?",
    ];

    return {
      generatedAt: new Date().toISOString(),
      application: {
        applicationId: application.id,
        jobId: application.job_id,
        title: application.title,
        companyName: application.company_name,
        url: application.url,
        status: application.status,
      },
      job: job
        ? {
            location: job.location || null,
            employmentType: job.employment_type,
            descriptionSnippet: job.description_snippet || null,
          }
        : null,
      submittedResume,
      requirements,
      warnings,
      suggestedQuestions,
    };
  }
}
