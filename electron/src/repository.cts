import { createHash } from "node:crypto";
import type {
  Company,
  CompanyDraft,
  CompanyRunStatus,
  CompanyUpdate,
  Filter,
  FilterDraft,
  FilterUpdate,
  Job,
  JobSourceSnapshot,
  ScrapeRun,
  ScrapeRunStatus,
  SourceContentCompleteness,
  SourceDiagnosticCode,
  Settings,
  SettingsUpdate,
} from "../../src/shared/contracts.js";
import { sql, SqliteClient, toSqlLiteral } from "./sqlite.cjs";
import { replaceNul } from "./nul-text.cjs";

type CompanyRow = {
  id: number;
  name: string;
  url: string;
  source_type: Company["sourceType"];
  source_identifier: string | null;
  frequency_minutes: number;
  is_active: number;
  last_run_at: string | null;
  last_run_status: CompanyRunStatus;
  last_error_message: string | null;
  consecutive_failures: number;
  circuit_open_until: string | null;
  created_at: string;
  updated_at: string;
};

type JobRow = {
  id: number;
  company_id: number;
  source_job_id: string;
  source_type: Job["sourceType"];
  title: string;
  location: string;
  employment_type: string | null;
  url: string;
  description_snippet: string;
  current_source_snapshot_id: string | null;
  source_completeness: SourceContentCompleteness;
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

type FilterRow = {
  id: number;
  name: string;
  company_id: number | null;
  title_include: string;
  title_exclude: string;
  keywords_include: string;
  keywords_exclude: string;
  salary_min: number | null;
  location_include: string;
  location_exclude: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type ScrapeRunRow = {
  id: number;
  company_id: number;
  started_at: string;
  finished_at: string | null;
  status: ScrapeRunStatus;
  jobs_found_count: number;
  jobs_matched_count: number;
  diagnostic_code: SourceDiagnosticCode | null;
  diagnostic_message: string | null;
  error_message: string | null;
};

type JobSourceSnapshotRow = {
  id: string;
  job_id: number;
  source_type: Job["sourceType"];
  source_url: string;
  retrieved_at: string;
  extraction_version: string;
  completeness: SourceContentCompleteness;
  content_text: string;
  content_hash: string;
};

type SettingRow = {
  key: keyof Settings;
  value_json: string;
};

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: String(row.id),
    name: row.name,
    url: row.url,
    sourceType: row.source_type,
    sourceIdentifier: row.source_identifier,
    frequencyMinutes: row.frequency_minutes,
    isActive: Boolean(row.is_active),
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    lastErrorMessage: row.last_error_message,
    consecutiveFailures: row.consecutive_failures ?? 0,
    circuitOpenUntil: row.circuit_open_until ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function mapFilter(row: FilterRow): Filter {
  return {
    id: String(row.id),
    name: row.name,
    companyId: row.company_id ? String(row.company_id) : null,
    titleInclude: parseJsonArray(row.title_include),
    titleExclude: parseJsonArray(row.title_exclude),
    keywordsInclude: parseJsonArray(row.keywords_include),
    keywordsExclude: parseJsonArray(row.keywords_exclude),
    salaryMin: row.salary_min,
    locationInclude: parseJsonArray(row.location_include),
    locationExclude: parseJsonArray(row.location_exclude),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScrapeRun(row: ScrapeRunRow): ScrapeRun {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    jobsFoundCount: row.jobs_found_count,
    jobsMatchedCount: row.jobs_matched_count,
    diagnosticCode: row.diagnostic_code ?? null,
    diagnosticMessage: row.diagnostic_message ?? null,
    errorMessage: row.error_message,
  };
}

function mapJobSourceSnapshot(row: JobSourceSnapshotRow): JobSourceSnapshot {
  return {
    id: row.id,
    jobId: String(row.job_id),
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    retrievedAt: row.retrieved_at,
    extractionVersion: row.extraction_version,
    completeness: row.completeness,
    contentText: row.content_text,
    contentHash: row.content_hash,
  };
}

function stableSnapshotId(jobId: string, contentHash: string): string {
  return "snapshot-" + createHash("sha256").update(jobId + "\n" + contentHash).digest("hex").slice(0, 24);
}

function serializeArray(value: string[]): string {
  return JSON.stringify(value.filter(Boolean));
}

export class JobScoutRepository {
  constructor(private readonly sqlite: SqliteClient) {}

  async listCompanies(): Promise<Company[]> {
    const rows = await this.sqlite.queryAll<CompanyRow>(
      "SELECT * FROM companies ORDER BY name COLLATE NOCASE ASC;",
    );
    return rows.map(mapCompany);
  }

  async getCompanyById(id: string): Promise<Company | null> {
    const row = await this.sqlite.queryOne<CompanyRow>(
      sql`SELECT * FROM companies WHERE id = ${id} LIMIT 1;`,
    );
    return row ? mapCompany(row) : null;
  }

  async createCompany(
    draft: CompanyDraft,
    sourceType: Company["sourceType"],
    sourceIdentifier: string | null,
  ): Promise<Company> {
    const now = new Date().toISOString();
    const row = await this.sqlite.queryOne<CompanyRow>(
      sql`
        INSERT INTO companies (
          name,
          url,
          source_type,
          source_identifier,
          frequency_minutes,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${draft.name.trim()},
          ${draft.url.trim()},
          ${sourceType},
          ${sourceIdentifier},
          ${draft.frequencyMinutes},
          ${draft.isActive},
          ${now},
          ${now}
        )
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error("Failed to create company");
    }

    return mapCompany(row);
  }

  async updateCompany(
    id: string,
    update: CompanyUpdate,
    sourceType: Company["sourceType"],
    sourceIdentifier: string | null,
  ): Promise<Company> {
    const existing = await this.getCompanyById(id);
    if (!existing) {
      throw new Error(`Company ${id} not found`);
    }

    const row = await this.sqlite.queryOne<CompanyRow>(
      sql`
        UPDATE companies
        SET
          name = ${update.name?.trim() ?? existing.name},
          url = ${update.url?.trim() ?? existing.url},
          source_type = ${sourceType},
          source_identifier = ${sourceIdentifier},
          frequency_minutes = ${update.frequencyMinutes ?? existing.frequencyMinutes},
          is_active = ${update.isActive ?? existing.isActive},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${id}
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error(`Failed to update company ${id}`);
    }

    return mapCompany(row);
  }

  async setCompanyRunState(
    id: string,
    status: CompanyRunStatus,
    lastRunAt: string,
    errorMessage: string | null,
  ): Promise<void> {
    await this.sqlite.exec(
      sql`
        UPDATE companies
        SET
          last_run_at = ${lastRunAt},
          last_run_status = ${status},
          last_error_message = ${errorMessage},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${id};
      `,
    );
  }

  async deleteCompany(id: string): Promise<void> {
    await this.sqlite.exec(sql`DELETE FROM companies WHERE id = ${id};`);
  }

  async incrementFailures(companyId: string): Promise<void> {
    await this.sqlite.exec(sql`
      UPDATE companies
      SET consecutive_failures = consecutive_failures + 1
      WHERE id = ${companyId};
    `);
  }

  async resetFailures(companyId: string): Promise<void> {
    await this.sqlite.exec(sql`
      UPDATE companies
      SET consecutive_failures = 0, circuit_open_until = NULL
      WHERE id = ${companyId};
    `);
  }

  async openCircuit(companyId: string, until: string): Promise<void> {
    await this.sqlite.exec(sql`
      UPDATE companies
      SET circuit_open_until = ${until}
      WHERE id = ${companyId};
    `);
  }

  async listJobs(): Promise<Job[]> {
    const rows = await this.sqlite.queryAll<JobRow>(
      "SELECT * FROM jobs ORDER BY is_new DESC, last_seen_at DESC, title COLLATE NOCASE ASC;",
    );
    return rows.map(mapJob);
  }

  async markJobSeen(id: string): Promise<Job> {
    const row = await this.sqlite.queryOne<JobRow>(
      sql`
        UPDATE jobs
        SET is_new = 0
        WHERE id = ${id}
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error(`Job ${id} not found`);
    }

    return mapJob(row);
  }

  async upsertJob(input: {
    companyId: string;
    sourceJobId: string;
    sourceType: Job["sourceType"];
    title: string;
    location: string;
    employmentType: string | null;
    url: string;
    descriptionSnippet: string;
    descriptionText: string;
    sourceCompleteness: SourceContentCompleteness;
    extractionVersion: string;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryText: string | null;
    postDate: string | null;
    lastSeenAt: string;
    matchedFilterCount: number;
  }): Promise<Job> {
    const row = await this.sqlite.queryOne<JobRow>(
      sql`
        INSERT INTO jobs (
          company_id,
          source_job_id,
          source_type,
          title,
          location,
          employment_type,
          url,
          description_snippet,
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
        ) VALUES (
          ${input.companyId},
          ${input.sourceJobId},
          ${input.sourceType},
          ${input.title},
          ${input.location},
          ${input.employmentType},
          ${input.url},
          ${input.descriptionSnippet},
          ${input.sourceCompleteness},
          ${input.salaryMin},
          ${input.salaryMax},
          ${input.salaryCurrency},
          ${input.salaryText},
          ${input.postDate},
          ${input.lastSeenAt},
          ${input.lastSeenAt},
          1,
          1,
          ${input.matchedFilterCount}
        )
        ON CONFLICT (company_id, source_job_id) DO UPDATE SET
          source_type = excluded.source_type,
          title = excluded.title,
          location = excluded.location,
          employment_type = excluded.employment_type,
          url = excluded.url,
          description_snippet = excluded.description_snippet,
          source_completeness = excluded.source_completeness,
          salary_min = excluded.salary_min,
          salary_max = excluded.salary_max,
          salary_currency = excluded.salary_currency,
          salary_text = excluded.salary_text,
          post_date = excluded.post_date,
          last_seen_at = excluded.last_seen_at,
          is_active = 1,
          matched_filter_count = excluded.matched_filter_count
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error(`Failed to upsert job ${input.sourceJobId}`);
    }

    // Hash the text as it is stored: SQL literals store NUL as U+FFFD (#297).
    const contentText = replaceNul(input.descriptionText.trim() || input.descriptionSnippet.trim() || input.title.trim()).text;
    const contentHash = createHash("sha256").update(contentText).digest("hex");
    const snapshotId = stableSnapshotId(String(row.id), contentHash);
    await this.sqlite.exec(sql`
      INSERT INTO job_source_snapshots (
        id, job_id, source_type, source_url, retrieved_at, extraction_version,
        completeness, content_text, content_hash
      ) VALUES (
        ${snapshotId}, ${row.id}, ${input.sourceType}, ${input.url}, ${input.lastSeenAt},
        ${input.extractionVersion}, ${input.sourceCompleteness}, ${contentText}, ${contentHash}
      )
      ON CONFLICT(job_id, content_hash) DO UPDATE SET
        retrieved_at = excluded.retrieved_at,
        source_url = excluded.source_url,
        extraction_version = excluded.extraction_version,
        completeness = excluded.completeness;
    `);
    await this.sqlite.exec(sql`
      UPDATE jobs
      SET current_source_snapshot_id = ${snapshotId}, source_completeness = ${input.sourceCompleteness}
      WHERE id = ${row.id};
    `);
    const updatedRow = await this.sqlite.queryOne<JobRow>(sql`SELECT * FROM jobs WHERE id = ${row.id} LIMIT 1;`);
    return mapJob(updatedRow ?? row);
  }

  async listJobSourceSnapshots(jobId: string): Promise<JobSourceSnapshot[]> {
    const rows = await this.sqlite.queryAll<JobSourceSnapshotRow>(sql`
      SELECT * FROM job_source_snapshots
      WHERE job_id = ${jobId}
      ORDER BY retrieved_at DESC;
    `);
    return rows.map(mapJobSourceSnapshot);
  }

  async deactivateMissingJobs(companyId: string, sourceJobIds: string[]): Promise<void> {
    if (sourceJobIds.length === 0) {
      await this.sqlite.exec(
        sql`UPDATE jobs SET is_active = 0 WHERE company_id = ${companyId};`,
      );
      return;
    }

    const idsClause = sourceJobIds.map((id) => toSqlLiteral(id)).join(", ");
    await this.sqlite.exec(
      `UPDATE jobs SET is_active = 0 WHERE company_id = ${toSqlLiteral(companyId)} AND source_job_id NOT IN (${idsClause});`,
    );
  }

  async listFilters(): Promise<Filter[]> {
    const rows = await this.sqlite.queryAll<FilterRow>(
      "SELECT * FROM filters ORDER BY is_active DESC, name COLLATE NOCASE ASC;",
    );
    return rows.map(mapFilter);
  }

  async createFilter(draft: FilterDraft): Promise<Filter> {
    const now = new Date().toISOString();
    const row = await this.sqlite.queryOne<FilterRow>(
      sql`
        INSERT INTO filters (
          name,
          company_id,
          title_include,
          title_exclude,
          keywords_include,
          keywords_exclude,
          salary_min,
          location_include,
          location_exclude,
          is_active,
          created_at,
          updated_at
        ) VALUES (
          ${draft.name.trim()},
          ${draft.companyId},
          ${serializeArray(draft.titleInclude)},
          ${serializeArray(draft.titleExclude)},
          ${serializeArray(draft.keywordsInclude)},
          ${serializeArray(draft.keywordsExclude)},
          ${draft.salaryMin},
          ${serializeArray(draft.locationInclude)},
          ${serializeArray(draft.locationExclude)},
          ${draft.isActive},
          ${now},
          ${now}
        )
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error("Failed to create filter");
    }

    return mapFilter(row);
  }

  async updateFilter(id: string, update: FilterUpdate): Promise<Filter> {
    const current = (await this.listFilters()).find((filter) => filter.id === id);
    if (!current) {
      throw new Error(`Filter ${id} not found`);
    }

    const row = await this.sqlite.queryOne<FilterRow>(
      sql`
        UPDATE filters
        SET
          name = ${update.name?.trim() ?? current.name},
          company_id = ${update.companyId === undefined ? current.companyId : update.companyId},
          title_include = ${serializeArray(update.titleInclude ?? current.titleInclude)},
          title_exclude = ${serializeArray(update.titleExclude ?? current.titleExclude)},
          keywords_include = ${serializeArray(update.keywordsInclude ?? current.keywordsInclude)},
          keywords_exclude = ${serializeArray(update.keywordsExclude ?? current.keywordsExclude)},
          salary_min = ${update.salaryMin === undefined ? current.salaryMin : update.salaryMin},
          location_include = ${serializeArray(update.locationInclude ?? current.locationInclude)},
          location_exclude = ${serializeArray(update.locationExclude ?? current.locationExclude)},
          is_active = ${update.isActive ?? current.isActive},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${id}
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error(`Failed to update filter ${id}`);
    }

    return mapFilter(row);
  }

  async deleteFilter(id: string): Promise<void> {
    await this.sqlite.exec(sql`DELETE FROM filters WHERE id = ${id};`);
  }

  async createScrapeRun(companyId: string): Promise<ScrapeRun> {
    const row = await this.sqlite.queryOne<ScrapeRunRow>(
      sql`
        INSERT INTO scrape_runs (company_id, started_at, status)
        VALUES (${companyId}, ${new Date().toISOString()}, ${"running"})
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error(`Failed to create scrape run for company ${companyId}`);
    }

    return mapScrapeRun(row);
  }

  async finalizeScrapeRun(
    id: string,
    status: ScrapeRunStatus,
    jobsFoundCount: number,
    jobsMatchedCount: number,
    diagnosticCode: SourceDiagnosticCode | null,
    diagnosticMessage: string | null,
    errorMessage: string | null,
  ): Promise<ScrapeRun> {
    const row = await this.sqlite.queryOne<ScrapeRunRow>(
      sql`
        UPDATE scrape_runs
        SET
          finished_at = ${new Date().toISOString()},
          status = ${status},
          jobs_found_count = ${jobsFoundCount},
          jobs_matched_count = ${jobsMatchedCount},
          diagnostic_code = ${diagnosticCode},
          diagnostic_message = ${diagnosticMessage},
          error_message = ${errorMessage}
        WHERE id = ${id}
        RETURNING *;
      `,
    );

    if (!row) {
      throw new Error(`Failed to finalize scrape run ${id}`);
    }

    return mapScrapeRun(row);
  }

  async listRecentScrapeRuns(limit = 10): Promise<ScrapeRun[]> {
    const rows = await this.sqlite.queryAll<ScrapeRunRow>(
      `SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT ${Math.max(1, Math.floor(limit))};`,
    );
    return rows.map(mapScrapeRun);
  }

  async getSettings(defaultSettings: Settings): Promise<Settings> {
    const rows = await this.sqlite.queryAll<SettingRow>(
      "SELECT key, value_json FROM settings;",
    );

    const settings = { ...defaultSettings };
    for (const row of rows) {
      settings[row.key] = JSON.parse(row.value_json) as never;
    }

    return settings;
  }

  async updateSettings(defaultSettings: Settings, update: SettingsUpdate): Promise<Settings> {
    const nextSettings = { ...(await this.getSettings(defaultSettings)), ...update };
    const updatedAt = new Date().toISOString();

    for (const [key, value] of Object.entries(nextSettings)) {
      await this.sqlite.exec(
        sql`
          INSERT INTO settings (key, value_json, updated_at)
          VALUES (${key}, ${JSON.stringify(value)}, ${updatedAt})
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at;
        `,
      );
    }

    return nextSettings;
  }
}
