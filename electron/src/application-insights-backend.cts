import type {
  ApplicationInsightDetail,
  ApplicationOffer,
  ApplicationOfferInput,
  ApplicationSearchContext,
  LearningGroupDimension,
  OutcomeGroup,
  RecurringGapSignal,
  SearchLearningSnapshot,
  SearchLearningTotals,
  StrategySignal,
} from "../../src/shared/application-insights.js";
import { sql, SqliteClient } from "./sqlite.cjs";
import { FEATURE_MIGRATIONS } from "./feature-migrations.cjs";

const APPLICATION_INSIGHTS_MIGRATION_VERSION = FEATURE_MIGRATIONS.applicationInsights.version;
const APPLICATION_INSIGHTS_MIGRATION_NAME = FEATURE_MIGRATIONS.applicationInsights.name;

const APPLICATION_INSIGHTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS application_search_context (
    application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
    target_track_id TEXT REFERENCES career_target_tracks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_application_search_context_track
    ON application_search_context(target_track_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS application_offers (
    application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('active', 'accepted', 'declined', 'withdrawn', 'expired')),
    base_pay REAL,
    pay_basis TEXT NOT NULL CHECK (pay_basis IN ('annual', 'hourly', 'other')),
    currency TEXT NOT NULL DEFAULT 'USD',
    bonus_notes TEXT NOT NULL DEFAULT '',
    equity_notes TEXT NOT NULL DEFAULT '',
    benefits_notes TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    response_deadline TEXT,
    negotiation_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

type SearchContextRow = {
  application_id: string;
  target_track_id: string | null;
  target_track_name: string | null;
  updated_at: string | null;
};

type OfferRow = {
  application_id: string;
  status: ApplicationOffer["status"];
  base_pay: number | null;
  pay_basis: ApplicationOffer["payBasis"];
  currency: string;
  bonus_notes: string;
  equity_notes: string;
  benefits_notes: string;
  start_date: string | null;
  response_deadline: string | null;
  negotiation_notes: string;
  created_at: string;
  updated_at: string;
};

type ApplicationLearningRow = {
  application_id: string;
  status: string;
  title: string;
  source_type: string | null;
  employment_type: string | null;
  target_track_id: string | null;
  target_track_name: string | null;
  interview_events: number;
  offer_events: number;
  has_offer_record: number;
};

type GapRow = {
  application_id: string;
  application_title: string;
  requirement_id: string;
  kind: string;
  requirement_text: string;
  normalized_term: string | null;
  supported: number;
};

function mapOffer(row: OfferRow): ApplicationOffer {
  return {
    applicationId: row.application_id,
    status: row.status,
    basePay: row.base_pay,
    payBasis: row.pay_basis,
    currency: row.currency,
    bonusNotes: row.bonus_notes,
    equityNotes: row.equity_notes,
    benefitsNotes: row.benefits_notes,
    startDate: row.start_date,
    responseDeadline: row.response_deadline,
    negotiationNotes: row.negotiation_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSearchContext(applicationId: string, row: SearchContextRow | null): ApplicationSearchContext {
  return {
    applicationId,
    targetTrackId: row?.target_track_id ?? null,
    targetTrackName: row?.target_track_name ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

function sourceClass(sourceType: string | null): string {
  if (!sourceType) return "Unknown source";
  if (["greenhouse", "lever", "smartrecruiters", "ashby"].includes(sourceType)) {
    return "Structured ATS";
  }
  if (["workday", "icims", "bamboohr", "taleo", "oracle", "microsoft"].includes(sourceType)) {
    return "Career portal";
  }
  if (sourceType === "browser-required") return "Browser-required source";
  if (sourceType === "generic-html") return "Generic employer site";
  return "Other/manual source";
}

function sourceLabel(sourceType: string | null): string {
  if (!sourceType) return "Unknown source";
  const labels: Record<string, string> = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    workday: "Workday",
    icims: "iCIMS",
    smartrecruiters: "SmartRecruiters",
    ashby: "Ashby",
    bamboohr: "BambooHR",
    taleo: "Taleo",
    oracle: "Oracle",
    microsoft: "Microsoft",
    "generic-html": "Generic employer site",
    "browser-required": "Browser-required source",
    unsupported: "Unsupported/manual source",
  };
  return labels[sourceType] ?? sourceType;
}

function normalizeGapKey(row: GapRow): { key: string; label: string } {
  const normalized = row.normalized_term?.trim().toLowerCase();
  if (normalized) return { key: `${row.kind}:${normalized}`, label: row.normalized_term!.trim() };
  const compact = row.requirement_text.replace(/\s+/g, " ").trim();
  const label = compact.length > 100 ? `${compact.slice(0, 97)}...` : compact;
  return { key: `${row.kind}:${label.toLowerCase()}`, label };
}

function observedInterview(row: ApplicationLearningRow): boolean {
  return row.status === "interview" || row.status === "offer" || row.interview_events > 0;
}

function observedOffer(row: ApplicationLearningRow): boolean {
  return row.status === "offer" || row.offer_events > 0 || row.has_offer_record > 0;
}

function emptyTotals(): SearchLearningTotals {
  return {
    tracked: 0,
    applied: 0,
    interviews: 0,
    offers: 0,
    rejections: 0,
    withdrawals: 0,
  };
}

function addRowToTotals(totals: SearchLearningTotals, row: ApplicationLearningRow): void {
  totals.tracked += 1;
  if (row.status === "applied") totals.applied += 1;
  if (observedInterview(row)) totals.interviews += 1;
  if (observedOffer(row)) totals.offers += 1;
  if (row.status === "rejected") totals.rejections += 1;
  if (row.status === "withdrawn") totals.withdrawals += 1;
}

function groupRows(
  rows: ApplicationLearningRow[],
  dimension: LearningGroupDimension,
  selector: (row: ApplicationLearningRow) => { key: string; label: string } | null,
): OutcomeGroup[] {
  const groups = new Map<string, OutcomeGroup>();
  for (const row of rows) {
    const selected = selector(row);
    if (!selected) continue;
    const current = groups.get(selected.key) ?? {
      dimension,
      key: selected.key,
      label: selected.label,
      tracked: 0,
      applied: 0,
      interviews: 0,
      offers: 0,
      rejections: 0,
      withdrawals: 0,
    };
    const totals: SearchLearningTotals = {
      tracked: current.tracked,
      applied: current.applied,
      interviews: current.interviews,
      offers: current.offers,
      rejections: current.rejections,
      withdrawals: current.withdrawals,
    };
    addRowToTotals(totals, row);
    Object.assign(current, totals);
    groups.set(selected.key, current);
  }
  return Array.from(groups.values()).sort((left, right) =>
    right.tracked - left.tracked || left.label.localeCompare(right.label),
  );
}

function strategySignals(
  totals: SearchLearningTotals,
  repeatedGaps: RecurringGapSignal[],
  groups: OutcomeGroup[],
): StrategySignal[] {
  const signals: StrategySignal[] = [];
  const caveat = "This is an observation from your saved Sojourner history, not proof of causation or a hiring-market benchmark.";

  if (totals.tracked < 3) {
    signals.push({
      id: "insufficient-history",
      kind: "insufficient-data",
      sampleSize: totals.tracked,
      observation: `Sojourner has only ${totals.tracked} tracked application${totals.tracked === 1 ? "" : "s"}, so outcome patterns would be fragile.`,
      recommendation: null,
      caveat,
    });
    return signals;
  }

  if (totals.tracked >= 5 && totals.interviews === 0) {
    signals.push({
      id: "no-recorded-interviews",
      kind: "outcome-pattern",
      sampleSize: totals.tracked,
      observation: `None of the ${totals.tracked} tracked applications has a recorded interview stage or interview event yet.`,
      recommendation: "Review the most repeated evidence gaps and whether recent opportunities align with the target tracks and constraints you actually intend to pursue before changing application volume.",
      caveat,
    });
  } else if (totals.interviews >= 3 && totals.offers === 0) {
    signals.push({
      id: "interviews-without-offers",
      kind: "outcome-pattern",
      sampleSize: totals.interviews,
      observation: `${totals.interviews} tracked applications have recorded interview activity, while none has a recorded offer yet.`,
      recommendation: "Compare interview preparation, submitted materials, and repeated requirement gaps across those applications for differences worth investigating.",
      caveat,
    });
  }

  const recurring = repeatedGaps.find((gap) => gap.applicationCount >= 3);
  if (recurring) {
    signals.push({
      id: `gap:${recurring.key}`,
      kind: "recurring-gap",
      sampleSize: recurring.applicationCount,
      observation: `“${recurring.label}” appears unsupported or ambiguous across ${recurring.applicationCount} tracked applications.`,
      recommendation: "Decide whether this is a capability you want to build, evidence you already have but have not recorded, or a signal to narrow the opportunities you pursue. Sojourner will not change your Career Evidence or target tracks automatically.",
      caveat,
    });
  }

  const sourceGroups = groups.filter((group) => group.dimension === "source-class" && group.tracked >= 3);
  const withInterview = sourceGroups
    .filter((group) => group.interviews > 0)
    .sort((a, b) => b.interviews / b.tracked - a.interviews / a.tracked)[0];
  const withoutInterview = sourceGroups
    .filter((group) => group.interviews === 0)
    .sort((a, b) => b.tracked - a.tracked)[0];
  if (withInterview && withoutInterview) {
    signals.push({
      id: `source:${withInterview.key}:${withoutInterview.key}`,
      kind: "source-pattern",
      sampleSize: withInterview.tracked + withoutInterview.tracked,
      observation: `${withInterview.label} has recorded interview activity in your history, while ${withoutInterview.label} has none across ${withoutInterview.tracked} tracked applications.`,
      recommendation: "Compare the roles and employers in those source groups before deciding whether source mix deserves more or less attention.",
      caveat,
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "no-strong-pattern",
      kind: "insufficient-data",
      sampleSize: totals.tracked,
      observation: "Your saved history does not yet contain a strong enough deterministic pattern for Sojourner to surface a strategy recommendation.",
      recommendation: null,
      caveat,
    });
  }
  return signals;
}

export class ApplicationInsightsBackend {
  private readonly sqlite: SqliteClient;

  constructor(databasePath: string, sqliteBinaryPath: string) {
    this.sqlite = new SqliteClient(databasePath, sqliteBinaryPath);
  }

  async initialize(): Promise<void> {
    await this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );
    const existing = await this.sqlite.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations
      WHERE version = ${APPLICATION_INSIGHTS_MIGRATION_VERSION}
      LIMIT 1;
    `);
    if (existing) return;
    await this.sqlite.exec(APPLICATION_INSIGHTS_SCHEMA);
    await this.sqlite.exec(sql`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (
        ${APPLICATION_INSIGHTS_MIGRATION_VERSION},
        ${APPLICATION_INSIGHTS_MIGRATION_NAME},
        ${new Date().toISOString()}
      );
    `);
  }

  private async assertApplication(applicationId: string): Promise<void> {
    const application = await this.sqlite.queryOne<{ id: string }>(sql`
      SELECT id FROM applications WHERE id = ${applicationId} LIMIT 1;
    `);
    if (!application) throw new Error(`Application ${applicationId} not found`);
  }

  async getApplicationDetail(applicationId: string): Promise<ApplicationInsightDetail> {
    await this.assertApplication(applicationId);
    const [context, offer] = await Promise.all([
      this.sqlite.queryOne<SearchContextRow>(sql`
        SELECT
          context.application_id,
          context.target_track_id,
          tracks.name AS target_track_name,
          context.updated_at
        FROM application_search_context AS context
        LEFT JOIN career_target_tracks AS tracks ON tracks.id = context.target_track_id
        WHERE context.application_id = ${applicationId}
        LIMIT 1;
      `),
      this.sqlite.queryOne<OfferRow>(sql`
        SELECT * FROM application_offers WHERE application_id = ${applicationId} LIMIT 1;
      `),
    ]);
    return {
      applicationId,
      searchContext: mapSearchContext(applicationId, context),
      offer: offer ? mapOffer(offer) : null,
    };
  }

  async setTargetTrack(applicationId: string, targetTrackId: string | null): Promise<ApplicationSearchContext> {
    await this.assertApplication(applicationId);
    if (targetTrackId) {
      const track = await this.sqlite.queryOne<{ id: string }>(sql`
        SELECT id FROM career_target_tracks WHERE id = ${targetTrackId} LIMIT 1;
      `);
      if (!track) throw new Error(`Target track ${targetTrackId} not found`);
    }
    const now = new Date().toISOString();
    await this.sqlite.exec(sql`
      INSERT INTO application_search_context (
        application_id, target_track_id, created_at, updated_at
      ) VALUES (${applicationId}, ${targetTrackId}, ${now}, ${now})
      ON CONFLICT(application_id) DO UPDATE SET
        target_track_id = excluded.target_track_id,
        updated_at = excluded.updated_at;
    `);
    return (await this.getApplicationDetail(applicationId)).searchContext;
  }

  async saveOffer(applicationId: string, input: ApplicationOfferInput): Promise<ApplicationOffer> {
    await this.assertApplication(applicationId);
    const now = new Date().toISOString();
    await this.sqlite.exec(sql`
      INSERT INTO application_offers (
        application_id, status, base_pay, pay_basis, currency,
        bonus_notes, equity_notes, benefits_notes, start_date,
        response_deadline, negotiation_notes, created_at, updated_at
      ) VALUES (
        ${applicationId}, ${input.status}, ${input.basePay ?? null}, ${input.payBasis},
        ${(input.currency ?? "USD").trim().toUpperCase()}, ${(input.bonusNotes ?? "").trim()},
        ${(input.equityNotes ?? "").trim()}, ${(input.benefitsNotes ?? "").trim()},
        ${input.startDate ?? null}, ${input.responseDeadline ?? null},
        ${(input.negotiationNotes ?? "").trim()}, ${now}, ${now}
      )
      ON CONFLICT(application_id) DO UPDATE SET
        status = excluded.status,
        base_pay = excluded.base_pay,
        pay_basis = excluded.pay_basis,
        currency = excluded.currency,
        bonus_notes = excluded.bonus_notes,
        equity_notes = excluded.equity_notes,
        benefits_notes = excluded.benefits_notes,
        start_date = excluded.start_date,
        response_deadline = excluded.response_deadline,
        negotiation_notes = excluded.negotiation_notes,
        updated_at = excluded.updated_at;
    `);
    const row = await this.sqlite.queryOne<OfferRow>(sql`
      SELECT * FROM application_offers WHERE application_id = ${applicationId} LIMIT 1;
    `);
    if (!row) throw new Error("Failed to save application offer");
    return mapOffer(row);
  }

  async deleteOffer(applicationId: string): Promise<void> {
    await this.assertApplication(applicationId);
    await this.sqlite.exec(sql`DELETE FROM application_offers WHERE application_id = ${applicationId};`);
  }

  async getSearchLearning(): Promise<SearchLearningSnapshot> {
    const rows = await this.sqlite.queryAll<ApplicationLearningRow>(`
      SELECT
        applications.id AS application_id,
        applications.status AS status,
        applications.title AS title,
        jobs.source_type AS source_type,
        jobs.employment_type AS employment_type,
        context.target_track_id AS target_track_id,
        tracks.name AS target_track_name,
        (SELECT COUNT(*) FROM application_events events
          WHERE events.application_id = applications.id AND events.kind = 'interview') AS interview_events,
        (SELECT COUNT(*) FROM application_events events
          WHERE events.application_id = applications.id AND events.kind = 'offer') AS offer_events,
        CASE WHEN offers.application_id IS NULL THEN 0 ELSE 1 END AS has_offer_record
      FROM applications
      LEFT JOIN jobs ON CAST(jobs.id AS TEXT) = applications.job_id
      LEFT JOIN application_search_context context ON context.application_id = applications.id
      LEFT JOIN career_target_tracks tracks ON tracks.id = context.target_track_id
      LEFT JOIN application_offers offers ON offers.application_id = applications.id
      ORDER BY applications.created_at ASC;
    `);

    const totals = emptyTotals();
    for (const row of rows) addRowToTotals(totals, row);

    const groups: OutcomeGroup[] = [
      ...groupRows(rows, "target-track", (row) =>
        row.target_track_id
          ? { key: row.target_track_id, label: row.target_track_name ?? "Unnamed target track" }
          : { key: "unassigned", label: "Unassigned target track" },
      ),
      ...groupRows(rows, "source-type", (row) => ({
        key: row.source_type ?? "unknown",
        label: sourceLabel(row.source_type),
      })),
      ...groupRows(rows, "source-class", (row) => ({
        key: sourceClass(row.source_type).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        label: sourceClass(row.source_type),
      })),
      ...groupRows(rows, "opportunity-category", (row) => ({
        key: (row.employment_type ?? "Unknown arrangement").toLowerCase(),
        label: row.employment_type ?? "Unknown arrangement",
      })),
    ];

    const gapRows = await this.sqlite.queryAll<GapRow>(`
      SELECT
        applications.id AS application_id,
        applications.title AS application_title,
        requirements.id AS requirement_id,
        requirements.kind AS kind,
        requirements.text AS requirement_text,
        requirements.normalized_term AS normalized_term,
        MAX(CASE WHEN maps.classification IN ('direct', 'transferable') THEN 1 ELSE 0 END) AS supported
      FROM applications
      JOIN job_requirements requirements ON requirements.job_id = applications.job_id
      LEFT JOIN requirement_evidence_maps maps ON maps.job_requirement_id = requirements.id
      WHERE requirements.kind IN ('must-have', 'preferred', 'credential')
      GROUP BY applications.id, applications.title, requirements.id, requirements.kind,
               requirements.text, requirements.normalized_term
      ORDER BY applications.id, requirements.id;
    `);

    const gapBuckets = new Map<
      string,
      { kind: RecurringGapSignal["kind"]; label: string; applications: Set<string>; requirements: Set<string>; examples: Set<string> }
    >();
    for (const row of gapRows) {
      if (row.supported > 0) continue;
      const normalized = normalizeGapKey(row);
      const bucket = gapBuckets.get(normalized.key) ?? {
        kind: row.kind === "credential" ? "credential" : "skill-or-requirement",
        label: normalized.label,
        applications: new Set<string>(),
        requirements: new Set<string>(),
        examples: new Set<string>(),
      };
      bucket.applications.add(row.application_id);
      bucket.requirements.add(row.requirement_id);
      if (bucket.examples.size < 3) bucket.examples.add(row.application_title);
      gapBuckets.set(normalized.key, bucket);
    }

    const repeatedGaps = Array.from(gapBuckets.entries())
      .map(([key, bucket]): RecurringGapSignal => ({
        key,
        kind: bucket.kind,
        label: bucket.label,
        applicationCount: bucket.applications.size,
        requirementCount: bucket.requirements.size,
        examples: Array.from(bucket.examples),
      }))
      .filter((gap) => gap.applicationCount >= 2)
      .sort((left, right) =>
        right.applicationCount - left.applicationCount ||
        right.requirementCount - left.requirementCount ||
        left.label.localeCompare(right.label),
      );

    return {
      generatedAt: new Date().toISOString(),
      totals,
      repeatedGaps,
      outcomeGroups: groups,
      strategySignals: strategySignals(totals, repeatedGaps, groups),
    };
  }
}
