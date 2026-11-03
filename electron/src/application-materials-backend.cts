import { randomUUID } from "node:crypto";
import type {
  ApplicationMaterialCreateResult,
  ApplicationMaterialProjection,
  ApplicationMaterialSection,
} from "../../src/shared/application-materials.js";
import type {
  CandidateEvidence,
  EvidenceVerificationState,
} from "../../src/shared/contracts.js";
import { RequirementBackend } from "./requirement-backend.cjs";
import { sql, SqliteClient } from "./sqlite.cjs";
import { FEATURE_MIGRATIONS } from "./feature-migrations.cjs";

const APPLICATION_MATERIALS_MIGRATION_VERSION = FEATURE_MIGRATIONS.applicationMaterials.version;
const APPLICATION_MATERIALS_MIGRATION_NAME = FEATURE_MIGRATIONS.applicationMaterials.name;

const APPLICATION_MATERIALS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS application_materials (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cover-letter')),
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft')),
    sections_json TEXT NOT NULL,
    selected_evidence_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (application_id, kind, version)
  );

  CREATE INDEX IF NOT EXISTS idx_application_materials_application
    ON application_materials(application_id, kind, version DESC);
`;

type ApplicationRow = {
  id: string;
  job_id: string;
  title: string;
  company_name: string;
};

type MaterialRow = {
  id: string;
  application_id: string;
  job_id: string;
  kind: ApplicationMaterialProjection["kind"];
  version: number;
  status: ApplicationMaterialProjection["status"];
  sections_json: string;
  selected_evidence_ids_json: string;
  created_at: string;
  updated_at: string;
};

type EvidenceStateRow = {
  id: string;
  verification_state: EvidenceVerificationState;
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === "string"),
  );
}

function parseSections(value: string): ApplicationMaterialSection[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ApplicationMaterialSection =>
      Boolean(
        item &&
          typeof item.id === "string" &&
          (item.label === "opening" || item.label === "evidence" || item.label === "closing") &&
          typeof item.text === "string" &&
          Array.isArray(item.evidenceIds) &&
          item.evidenceIds.every((id: unknown) => typeof id === "string") &&
          isStringRecord(item.evidenceUpdatedAtById),
      ),
    );
  } catch {
    return [];
  }
}

function sentence(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function isCurrentEvidence(state: EvidenceVerificationState): boolean {
  return state === "user-authored" || state === "user-confirmed";
}

export class ApplicationMaterialsBackend {
  private readonly sqlite: SqliteClient;
  private readonly requirementBackend: RequirementBackend;

  constructor(options: { databasePath: string; sqliteBinaryPath: string }) {
    this.sqlite = new SqliteClient(options.databasePath, options.sqliteBinaryPath);
    this.requirementBackend = new RequirementBackend(options);
  }

  async initialize(): Promise<void> {
    await this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );
    const existing = await this.sqlite.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations
      WHERE version = ${APPLICATION_MATERIALS_MIGRATION_VERSION}
      LIMIT 1;
    `);
    if (existing) return;

    await this.sqlite.exec(APPLICATION_MATERIALS_SCHEMA);
    await this.sqlite.exec(sql`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (
        ${APPLICATION_MATERIALS_MIGRATION_VERSION},
        ${APPLICATION_MATERIALS_MIGRATION_NAME},
        ${new Date().toISOString()}
      );
    `);
  }

  async list(applicationId: string): Promise<ApplicationMaterialProjection[]> {
    await this.assertApplication(applicationId);
    const rows = await this.sqlite.queryAll<MaterialRow>(sql`
      SELECT * FROM application_materials
      WHERE application_id = ${applicationId}
      ORDER BY version DESC, created_at DESC;
    `);
    const evidenceStates = await this.currentEvidenceStates();
    return rows.map((row) => this.mapMaterial(row, evidenceStates));
  }

  async createCoverLetter(applicationId: string): Promise<ApplicationMaterialCreateResult> {
    const application = await this.assertApplication(applicationId);
    const coverage = await this.requirementBackend.getJobEvidenceCoverage(application.job_id);
    const supported = coverage.items
      .filter(
        (item) =>
          (item.mapping.classification === "direct" || item.mapping.classification === "transferable") &&
          Boolean(item.evidence),
      )
      .sort((left, right) => {
        const classification = left.mapping.classification === right.mapping.classification
          ? 0
          : left.mapping.classification === "direct"
            ? -1
            : 1;
        return classification || (right.requirement.importance ?? 0) - (left.requirement.importance ?? 0);
      });

    const chosen: CandidateEvidence[] = [];
    const seen = new Set<string>();
    for (const item of supported) {
      if (!item.evidence || seen.has(item.evidence.id)) continue;
      seen.add(item.evidence.id);
      chosen.push(item.evidence);
      if (chosen.length >= 3) break;
    }

    if (chosen.length === 0) {
      throw new Error(
        "Sojourner cannot create a factual cover letter yet because no confirmed Career Evidence supports the saved job requirements.",
      );
    }

    const profile = await this.sqlite.queryOne<{ full_name: string }>(
      "SELECT full_name FROM career_profile WHERE id = 1 LIMIT 1;",
    );
    const signoff = profile?.full_name?.trim() || "[Your name]";
    const now = new Date().toISOString();
    const id = `application-material-${randomUUID()}`;
    const nextVersion = await this.nextVersion(applicationId, "cover-letter");
    const sections: ApplicationMaterialSection[] = [
      {
        id: `${id}-opening`,
        label: "opening",
        text: `Dear Hiring Team,\n\nI am applying for the ${application.title} role at ${application.company_name}.`,
        evidenceIds: [],
        evidenceUpdatedAtById: {},
      },
      ...chosen.map((evidence, index) => ({
        id: `${id}-evidence-${index + 1}`,
        label: "evidence" as const,
        text: `One relevant example from my confirmed career record: ${sentence(evidence.statement)}`,
        evidenceIds: [evidence.id],
        evidenceUpdatedAtById: { [evidence.id]: evidence.updatedAt },
      })),
      {
        id: `${id}-closing`,
        label: "closing",
        text: `I would welcome the opportunity to discuss how this experience could contribute to the role.\n\nSincerely,\n${signoff}`,
        evidenceIds: [],
        evidenceUpdatedAtById: {},
      },
    ];
    const selectedEvidenceIds = chosen.map((item) => item.id);

    await this.sqlite.exec(sql`
      INSERT INTO application_materials (
        id, application_id, job_id, kind, version, status, sections_json,
        selected_evidence_ids_json, created_at, updated_at
      ) VALUES (
        ${id}, ${applicationId}, ${application.job_id}, 'cover-letter', ${nextVersion}, 'draft',
        ${JSON.stringify(sections)}, ${JSON.stringify(selectedEvidenceIds)}, ${now}, ${now}
      );
    `);

    const row = await this.sqlite.queryOne<MaterialRow>(sql`
      SELECT * FROM application_materials WHERE id = ${id} LIMIT 1;
    `);
    if (!row) throw new Error("Cover-letter projection was not created");

    const warnings: string[] = [];
    if (coverage.gapCount > 0 || coverage.ambiguousCount > 0) {
      warnings.push(
        "The saved job still has unsupported or ambiguous requirements. This draft does not claim those qualifications.",
      );
    }
    if (chosen.length < supported.length) {
      warnings.push(
        "The draft highlights only the strongest distinct confirmed evidence so it stays concise.",
      );
    }

    const evidenceStates = new Map<string, EvidenceStateRow>(
      chosen.map((evidence) => [
        evidence.id,
        {
          id: evidence.id,
          verification_state: evidence.verificationState,
          updated_at: evidence.updatedAt,
        },
      ]),
    );
    return {
      projection: this.mapMaterial(row, evidenceStates),
      warnings,
    };
  }

  async delete(projectionId: string): Promise<void> {
    await this.sqlite.exec(sql`
      DELETE FROM application_materials WHERE id = ${projectionId};
    `);
  }

  private async assertApplication(applicationId: string): Promise<ApplicationRow> {
    const application = await this.sqlite.queryOne<ApplicationRow>(sql`
      SELECT id, job_id, title, company_name
      FROM applications
      WHERE id = ${applicationId}
      LIMIT 1;
    `);
    if (!application) throw new Error(`Application ${applicationId} not found`);
    return application;
  }

  private async nextVersion(
    applicationId: string,
    kind: ApplicationMaterialProjection["kind"],
  ): Promise<number> {
    const row = await this.sqlite.queryOne<{ next_version: number }>(sql`
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM application_materials
      WHERE application_id = ${applicationId} AND kind = ${kind};
    `);
    return row?.next_version ?? 1;
  }

  private async currentEvidenceStates(): Promise<Map<string, EvidenceStateRow>> {
    const rows = await this.sqlite.queryAll<EvidenceStateRow>(`
      SELECT id, verification_state, updated_at FROM candidate_evidence;
    `);
    return new Map(rows.map((row) => [row.id, row]));
  }

  private mapMaterial(
    row: MaterialRow,
    evidenceStates: Map<string, EvidenceStateRow>,
  ): ApplicationMaterialProjection {
    const sections = parseSections(row.sections_json);
    const selectedEvidenceIds = parseStringArray(row.selected_evidence_ids_json);
    const staleEvidenceIds = selectedEvidenceIds.filter((id) => {
      const current = evidenceStates.get(id);
      if (!current || !isCurrentEvidence(current.verification_state)) return true;
      const snapshot = sections.find((section) => section.evidenceIds.includes(id))
        ?.evidenceUpdatedAtById[id];
      return !snapshot || snapshot !== current.updated_at;
    });

    return {
      id: row.id,
      applicationId: row.application_id,
      jobId: row.job_id,
      kind: row.kind,
      version: row.version,
      status: row.status,
      sections,
      selectedEvidenceIds,
      staleEvidenceIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
