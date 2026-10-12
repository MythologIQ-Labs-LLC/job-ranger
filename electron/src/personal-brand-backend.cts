import { randomUUID, createHash } from "node:crypto";
import { validateLinkedInImport, type SavedLinkedInExport, type LinkedInImportResult } from "../../src/shared/linkedin-import-ledger.js";
import { validateHistoricalLinkedInPost, canonicalHistoricalLinkedInUrl, collidesWithApprovedPublication, type HistoricalLinkedInPost } from "../../src/shared/linkedin-history.js";
import type {
  AnalyticsSnapshot, ManualPostPackage, ManualPublicationReceipt, PersonalBrandDraft, MetricObservation,
} from "../../src/shared/personal-brand.js";
import {
  appendAnalyticsSnapshot, confirmManualPublication, prepareManualPost,
} from "../../src/shared/personal-brand.js";
import type { AnalyticsSnapshotInput, PersonalBrandDraftInput } from "../../src/shared/personal-brand-api.js";
import { sql, SqliteClient, toSqlLiteral } from "./sqlite.cjs";
import { FEATURE_MIGRATIONS } from "./feature-migrations.cjs";
import { validateCareerOutcomeInput, type CareerOutcomeRecord } from "../../src/shared/personal-brand-outcomes.js";
import { validateTopicLabels, validateTopicTarget, latestTopicLabels, type LinkedInTopicEvent } from "../../src/shared/linkedin-topics.js";

const schema = `
CREATE TABLE IF NOT EXISTS personal_brand_drafts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personal_brand_prepared (
  draft_id TEXT NOT NULL REFERENCES personal_brand_drafts(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, revision)
);
CREATE TABLE IF NOT EXISTS personal_brand_publications (
  post_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES personal_brand_drafts(id) ON DELETE RESTRICT,
  approved_revision INTEGER NOT NULL,
  published_url TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  UNIQUE (draft_id, approved_revision),
  FOREIGN KEY (draft_id, approved_revision) REFERENCES personal_brand_prepared(draft_id, revision)
);
CREATE TABLE IF NOT EXISTS personal_brand_snapshots (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES personal_brand_publications(post_id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_brand_snapshots_post
  ON personal_brand_snapshots(post_id, captured_at);
`;

const outcomeSchema = `
CREATE TABLE IF NOT EXISTS personal_brand_career_outcomes (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  related_post_id TEXT REFERENCES personal_brand_publications(post_id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_brand_career_outcomes_at
  ON personal_brand_career_outcomes(occurred_at, id);
`;

const linkedinExportSchema = `
CREATE TABLE IF NOT EXISTS personal_brand_linkedin_exports (
  id TEXT PRIMARY KEY,
  content_sha256 TEXT NOT NULL UNIQUE CHECK(length(content_sha256) = 64),
  imported_at TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_brand_linkedin_exports_period
  ON personal_brand_linkedin_exports(period_start, period_end, imported_at);
`;

const historicalLinkedInSchema = `
CREATE TABLE IF NOT EXISTS personal_brand_linkedin_historical_posts (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  published_on TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_brand_linkedin_historical_dates
  ON personal_brand_linkedin_historical_posts(published_on DESC, recorded_at DESC);
`;

const topicAttestationSchema = `
CREATE TABLE IF NOT EXISTS personal_brand_linkedin_topic_events (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('confirmed_publication','historical_post')),
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(target_kind,target_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_personal_brand_linkedin_topic_history
  ON personal_brand_linkedin_topic_events(target_kind,target_id,revision DESC);
`;

type JsonRow = { payload_json: string };
type EvidenceRow = { id: string; verification_state: string };

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Personal Brand input.");
  return value as Record<string, unknown>;
}
function safeString(v: unknown, label: string, limit: number): string {
  if (typeof v !== "string" || v.length > limit) throw new Error(`Invalid ${label}.`);
  return v;
}
function fieldList(v: unknown, label: string, max = 20): string[] {
  if (!Array.isArray(v) || v.length > max ||
      v.some((x) => typeof x !== "string" || x.length > 300))
    throw new Error(`Invalid ${label}.`);
  return v.map((x: string) => x.trim()).filter(Boolean);
}
function optionalEnum<T extends string>(v: unknown, choices: readonly T[], label: string): T | null {
  if (v === null) return null;
  if (typeof v !== "string" || !choices.includes(v as T)) throw new Error(`Invalid ${label}.`);
  return v as T;
}
const objectives = [
  "recruiter_discovery", "expertise_proof", "project_visibility", "career_narrative",
  "network_growth", "community_contribution", "job_search_learning", "other",
] as const;
const destinations = ["linkedin", "facebook_page", "instagram_professional", "x"] as const;
const formats = ["text", "image", "video", "document", "link"] as const;
const hooks = [
  "concrete_experience", "contradiction", "build_proof", "lesson",
  "counterintuitive", "before_after", "question", "other",
] as const;

function validateDraftInput(raw: unknown): PersonalBrandDraftInput {
  const x = asRecord(raw);
  if (!Array.isArray(x.claimChecks) || x.claimChecks.length > 30)
    throw new Error("Invalid claim review entries.");
  const checks = x.claimChecks.map((item: unknown) => {
    const c = asRecord(item);
    if (typeof c.verified !== "boolean" || typeof c.privacyCleared !== "boolean")
      throw new Error("Claim review must include explicit truth and privacy states.");
    return {
      claim: safeString(c.claim, "claim", 1000).trim(),
      evidenceIds: fieldList(c.evidenceIds, "linked evidence", 20),
      verified: c.verified,
      privacyCleared: c.privacyCleared,
    };
  });
  const mediaCount = x.mediaCount;
  if (!Number.isSafeInteger(mediaCount) || (mediaCount as number) < 0 || (mediaCount as number) > 20)
    throw new Error("Invalid media count.");
  if (typeof x.mediaAccessibilityReviewed !== "boolean") throw new Error("Invalid media review.");
  return {
    body: safeString(x.body, "post body", 20000),
    objective: optionalEnum(x.objective, objectives, "objective"),
    audiences: fieldList(x.audiences, "intended audience"),
    destination: optionalEnum(x.destination, destinations, "destination"),
    format: optionalEnum(x.format, formats, "format") ?? "text",
    hookArchetype: optionalEnum(x.hookArchetype, hooks, "hook archetype"),
    hypothesis: safeString(x.hypothesis, "experiment hypothesis", 2500),
    claimChecks: checks,
    mediaCount: mediaCount as number,
    mediaAccessibilityReviewed: x.mediaAccessibilityReviewed as boolean,
  };
}
function rowJson<T>(row: JsonRow): T {
  return JSON.parse(row.payload_json) as T;
}
function assertRevision(actual: PersonalBrandDraft, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 ||
      actual.revision !== expectedRevision)
    throw new Error("Stale draft revision. Reload before editing, preparing, or recording publication.");
}

export class PersonalBrandBackend {
  private readonly db: SqliteClient;
  constructor(options: { databasePath: string; sqliteBinaryPath: string }) {
    this.db = new SqliteClient(options.databasePath, options.sqliteBinaryPath);
  }
  async initialize(): Promise<void> {
    await this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    const migration = FEATURE_MIGRATIONS.personalBrand;
    const exists = await this.db.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${migration.version} LIMIT 1;
    `);
    if (!exists) {
      await this.db.transaction([
        schema,
        sql`INSERT INTO schema_migrations (version, name, applied_at)
            VALUES (${migration.version}, ${migration.name}, ${new Date().toISOString()});`,
      ]);
    }
    const outcomeMigration = FEATURE_MIGRATIONS.personalBrandOutcomes;
    const outcomesExist = await this.db.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${outcomeMigration.version} LIMIT 1;
    `);
    if (!outcomesExist) {
      await this.db.transaction([
        outcomeSchema,
        sql`INSERT INTO schema_migrations (version, name, applied_at)
            VALUES (${outcomeMigration.version}, ${outcomeMigration.name}, ${new Date().toISOString()});`,
      ]);
    }
    const linkedinMigration = FEATURE_MIGRATIONS.personalBrandLinkedInAnalytics;
    const linkedinExists = await this.db.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${linkedinMigration.version} LIMIT 1;
    `);
    if (!linkedinExists) {
      await this.db.transaction([
        linkedinExportSchema,
        sql`INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (${linkedinMigration.version}, ${linkedinMigration.name}, ${new Date().toISOString()});`,
      ]);
    }
    const historicMigration = FEATURE_MIGRATIONS.personalBrandHistoricalLinkedIn;
    const historicExists = await this.db.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${historicMigration.version} LIMIT 1;
    `);
    if (!historicExists) {
      await this.db.transaction([
        historicalLinkedInSchema,
        sql`INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (${historicMigration.version}, ${historicMigration.name}, ${new Date().toISOString()});`,
      ]);
    }
    const topicMigration = FEATURE_MIGRATIONS.personalBrandLinkedInTopics;
    const topicExists = await this.db.queryOne<{ version: number }>(sql`
      SELECT version FROM schema_migrations WHERE version = ${topicMigration.version} LIMIT 1;
    `);
    if (!topicExists) {
      await this.db.transaction([
        topicAttestationSchema,
        sql`INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (${topicMigration.version}, ${topicMigration.name}, ${new Date().toISOString()});`,
      ]);
    }
  }

  private async getDraft(id: string): Promise<PersonalBrandDraft> {
    const row = await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_drafts WHERE id = ${id} LIMIT 1;
    `);
    if (!row) throw new Error("Personal Brand draft not found.");
    return rowJson<PersonalBrandDraft>(row);
  }
  async listDrafts(): Promise<PersonalBrandDraft[]> {
    const rows = await this.db.queryAll<JsonRow>(
      "SELECT payload_json FROM personal_brand_drafts ORDER BY updated_at DESC, id ASC;",
    );
    return rows.map((row) => rowJson<PersonalBrandDraft>(row));
  }
  async createDraft(raw: unknown): Promise<PersonalBrandDraft> {
    const input = validateDraftInput(raw);
    const draft: PersonalBrandDraft = { ...input, id: `presence-${randomUUID()}`, revision: 1 };
    const now = new Date().toISOString();
    await this.db.exec(sql`INSERT INTO personal_brand_drafts
      (id, revision, payload_json, created_at, updated_at)
      VALUES (${draft.id}, ${draft.revision}, ${JSON.stringify(draft)}, ${now}, ${now});`);
    return draft;
  }
  async updateDraft(id: string, revision: number, raw: unknown): Promise<PersonalBrandDraft> {
    const current = await this.getDraft(id);
    assertRevision(current, revision);
    const input = validateDraftInput(raw);
    const next: PersonalBrandDraft = { ...input, id: current.id, revision: revision + 1 };
    // Prevent a lost update even if multiple native windows race on the same draft.
    // Fail the transaction if the conditional update did not change exactly one row.
    await this.db.transaction([
      "CREATE TEMP TABLE _presence_revision_guard (ok INTEGER NOT NULL);",
      sql`UPDATE personal_brand_drafts SET revision = ${next.revision},
        payload_json = ${JSON.stringify(next)}, updated_at = ${new Date().toISOString()}
        WHERE id = ${id} AND revision = ${revision};`,
      "INSERT INTO _presence_revision_guard (ok) SELECT NULL WHERE changes() != 1;",
    ]);
    return next;
  }

  private async assertClaimsCurrent(draft: PersonalBrandDraft): Promise<void> {
    const ids = Array.from(new Set(draft.claimChecks.flatMap((claim) => claim.evidenceIds)));
    if (ids.length === 0) return;
    const rows = await this.db.queryAll<EvidenceRow>(`
      SELECT id, verification_state FROM candidate_evidence
      WHERE id IN (${ids.map(toSqlLiteral).join(",")});
    `);
    if (rows.length !== ids.length || rows.some((row) =>
      row.verification_state !== "user-authored" && row.verification_state !== "user-confirmed"))
      throw new Error("One or more linked Career Evidence items are missing or no longer current.");
  }
  async prepareDraft(id: string, revision: number, humanReviewConfirmed: boolean): Promise<ManualPostPackage> {
    const draft = await this.getDraft(id);
    assertRevision(draft, revision);
    await this.assertClaimsCurrent(draft);
    const pkg = await prepareManualPost(draft, humanReviewConfirmed);
    await this.db.exec(sql`INSERT OR IGNORE INTO personal_brand_prepared
      (draft_id, revision, payload_json, prepared_at)
      SELECT ${id}, ${revision}, ${JSON.stringify(pkg)}, ${new Date().toISOString()}
      WHERE EXISTS (SELECT 1 FROM personal_brand_drafts WHERE id = ${id} AND revision = ${revision});`);
    const saved = await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_prepared WHERE draft_id = ${id} AND revision = ${revision};
    `);
    if (!saved || rowJson<ManualPostPackage>(saved).sha256 !== pkg.sha256)
      throw new Error("Draft changed before copy preparation completed.");
    return pkg;
  }
  async listPrepared(): Promise<ManualPostPackage[]> {
    const rows = await this.db.queryAll<JsonRow>("SELECT payload_json FROM personal_brand_prepared ORDER BY prepared_at DESC;");
    return rows.map((row) => rowJson<ManualPostPackage>(row));
  }
  async listPublications(): Promise<ManualPublicationReceipt[]> {
    const rows = await this.db.queryAll<JsonRow>("SELECT payload_json FROM personal_brand_publications ORDER BY post_id DESC;");
    return rows.map((row) => rowJson<ManualPublicationReceipt>(row));
  }
  async confirmPublication(input: {
    draftId: string; revision: number; publishedUrl: string; publishedAt: string; userConfirmed: boolean;
  }): Promise<ManualPublicationReceipt> {
    if (!input || typeof input.draftId !== "string" || input.draftId.length > 120 ||
        !Number.isSafeInteger(input.revision) || typeof input.publishedUrl !== "string" ||
        input.publishedUrl.length > 2048 || typeof input.publishedAt !== "string" ||
        typeof input.userConfirmed !== "boolean") throw new Error("Invalid publication confirmation.");
    const row = await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_prepared
      WHERE draft_id = ${input.draftId} AND revision = ${input.revision} LIMIT 1;
    `);
    if (!row) throw new Error("Prepare the exact post for copying before recording publication.");
    const pkg = rowJson<ManualPostPackage>(row);
    const receipt = await confirmManualPublication({
      package: pkg,
      publishedUrl: input.publishedUrl,
      publishedAt: input.publishedAt,
      confirmedAt: new Date().toISOString(),
      userConfirmed: input.userConfirmed,
      existing: await this.listPublications(),
    });
    const canonical = receipt.destination === "linkedin" ? canonicalHistoricalLinkedInUrl(receipt.publishedUrl) : null;
    if (canonical) {
      const historical = await this.db.queryOne<{ id: string }>(sql`
        SELECT id FROM personal_brand_linkedin_historical_posts
        WHERE canonical_url = ${canonical} LIMIT 1;
      `);
      if (historical) throw new Error("This URL is recorded in the historical archive. Delete that user-attested entry before confirming a reviewed publication.");
    }
    await this.db.exec(sql`INSERT INTO personal_brand_publications
      (post_id, draft_id, approved_revision, published_url, payload_json)
      VALUES (${receipt.postId}, ${receipt.draftId}, ${receipt.approvedRevision},
              ${receipt.publishedUrl}, ${JSON.stringify(receipt)});`);
    return receipt;
  }
  async listSnapshots(postId: string): Promise<AnalyticsSnapshot[]> {
    const rows = await this.db.queryAll<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_snapshots
      WHERE post_id = ${postId} ORDER BY captured_at ASC, id ASC;
    `);
    return rows.map((row) => rowJson<AnalyticsSnapshot>(row));
  }
  async appendSnapshot(postId: string, input: AnalyticsSnapshotInput): Promise<AnalyticsSnapshot> {
    if (typeof postId !== "string" || postId.length > 150) throw new Error("Invalid publication ID.");
    const publication = (await this.listPublications()).find((row) => row.postId === postId);
    if (!publication) throw new Error("Publication not found.");
    if (!input || !Array.isArray(input.observations) || input.observations.length > 25 ||
        typeof input.sourceLabel !== "string" || input.sourceLabel.length > 250)
      throw new Error("Invalid analytics input.");
    // Only declared canonical metric names/states may cross IPC. They are not arbitrary SQL field names.
    const names = ["impressions", "reached", "reactions", "comments", "reposts", "saves", "sends",
      "link_clicks", "profile_views", "followers_gained", "video_views", "watch_seconds"];
    const states = ["manual", "estimated", "unavailable", "unknown"]; // Untrusted manual IPC cannot claim provider observation.
    const observations = input.observations.map((raw) => {
      const o = asRecord(raw);
      if (!names.includes(String(o.name)) || !states.includes(String(o.state)) ||
          (o.value !== undefined && typeof o.value !== "number") ||
          (o.providerMetric !== undefined && typeof o.providerMetric !== "string") ||
          (o.limitation !== undefined && typeof o.limitation !== "string"))
        throw new Error("Invalid analytics observation.");
      return { ...o } as unknown as MetricObservation;
    });
    const snapshot: AnalyticsSnapshot = {
      id: `presence-snapshot-${randomUUID()}`,
      postId,
      capturedAt: safeString(input.capturedAt, "capture time", 40),
      windowStart: safeString(input.windowStart, "window start", 40),
      windowEnd: safeString(input.windowEnd, "window end", 40),
      sourceLabel: input.sourceLabel,
      observations,
    };
    appendAnalyticsSnapshot(publication, await this.listSnapshots(postId), snapshot);
    await this.db.exec(sql`INSERT INTO personal_brand_snapshots
      (id, post_id, captured_at, payload_json)
      VALUES (${snapshot.id}, ${postId}, ${snapshot.capturedAt}, ${JSON.stringify(snapshot)});`);
    return snapshot;
  }

  async listLinkedInImports(): Promise<SavedLinkedInExport[]> {
    const rows = await this.db.queryAll<JsonRow>(
      "SELECT payload_json FROM personal_brand_linkedin_exports ORDER BY imported_at DESC, id ASC;",
    );
    return rows.map(row => rowJson<SavedLinkedInExport>(row));
  }
  async saveLinkedInImport(raw: unknown, userConfirmed: boolean): Promise<LinkedInImportResult> {
    if (userConfirmed !== true) throw new Error("Saving LinkedIn analytics requires explicit user confirmation.");
    const preview = validateLinkedInImport(raw);
    const contentSha256 = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
    const existing = await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_linkedin_exports
      WHERE content_sha256 = ${contentSha256} LIMIT 1;
    `);
    if (existing) return { record: rowJson<SavedLinkedInExport>(existing), alreadyPresent: true };
    const record: SavedLinkedInExport = {
      id: `linkedin-import-${randomUUID()}`, contentSha256,
      importedAt: new Date().toISOString(), source: "linkedin-native-xlsx-manual", preview,
    };
    // Ignore conflicts for the identical normalized content hash only.
    // Read back the unique record after insertion to handle overlapping writers safely.
    await this.db.exec(sql`
      INSERT OR IGNORE INTO personal_brand_linkedin_exports
      (id, content_sha256, imported_at, period_start, period_end, payload_json)
      VALUES (${record.id}, ${record.contentSha256}, ${record.importedAt},
        ${preview.period.start}, ${preview.period.end}, ${JSON.stringify(record)});
    `);
    const persisted = await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_linkedin_exports
      WHERE content_sha256 = ${contentSha256} LIMIT 1;
    `);
    if (!persisted) throw new Error("LinkedIn import was not committed.");
    const actual = rowJson<SavedLinkedInExport>(persisted);
    return { record: actual, alreadyPresent: actual.id !== record.id };
  }
  async deleteLinkedInImport(id: string, userConfirmed: boolean): Promise<void> {
    if (userConfirmed !== true) throw new Error("Deleting LinkedIn analytics requires explicit confirmation.");
    if (typeof id !== "string" || !/^linkedin-import-[a-f0-9-]{36}$/.test(id)) {
      throw new Error("Invalid LinkedIn import ID.");
    }
    const existing = await this.db.queryOne<{ id: string }>(sql`
      SELECT id FROM personal_brand_linkedin_exports WHERE id = ${id} LIMIT 1;
    `);
    if (!existing) throw new Error("LinkedIn import record not found.");
    await this.db.exec(sql`DELETE FROM personal_brand_linkedin_exports WHERE id = ${id};`);
  }

  async listHistoricalLinkedInPosts(): Promise<HistoricalLinkedInPost[]> {
    const rows = await this.db.queryAll<JsonRow>(
      "SELECT payload_json FROM personal_brand_linkedin_historical_posts ORDER BY published_on DESC, recorded_at DESC, id ASC;",
    );
    return rows.map(row => rowJson<HistoricalLinkedInPost>(row));
  }

  async recordHistoricalLinkedInPost(raw: unknown, confirmed: boolean): Promise<HistoricalLinkedInPost> {
    if (confirmed !== true) throw new Error("Historical post text requires explicit user attestation.");
    const input = validateHistoricalLinkedInPost(raw);
    if (input.publishedOn > new Date().toISOString().slice(0, 10)) {
      throw new Error("Historical LinkedIn publication date cannot be in the future.");
    }
    if (collidesWithApprovedPublication(input.url, await this.listPublications())) {
      throw new Error("A reviewed publication receipt already exists for this LinkedIn URL.");
    }
    const exists = await this.db.queryOne<{ id: string }>(sql`
      SELECT id FROM personal_brand_linkedin_historical_posts WHERE canonical_url = ${input.url} LIMIT 1;
    `);
    if (exists) throw new Error("This historical LinkedIn URL is already archived.");
    const record: HistoricalLinkedInPost = {
      ...input, id: `linkedin-history-${randomUUID()}`,
      recordedAt: new Date().toISOString(),
      bodySha256: createHash("sha256").update(input.body,"utf8").digest("hex"),
      source: "user_attested_historical", userConfirmed: true,
    };
    await this.db.exec(sql`
      INSERT INTO personal_brand_linkedin_historical_posts
        (id, canonical_url, published_on, recorded_at, payload_json)
      VALUES (${record.id}, ${record.url}, ${record.publishedOn},
        ${record.recordedAt}, ${JSON.stringify(record)});
    `);
    return record;
  }

  async deleteHistoricalLinkedInPost(id: string, confirmed: boolean): Promise<void> {
    if (confirmed !== true) throw new Error("Deleting a historical LinkedIn post requires explicit confirmation.");
    if (typeof id !== "string" || !/^linkedin-history-[0-9a-f-]{36}$/.test(id)) {
      throw new Error("Invalid historical LinkedIn post identifier.");
    }
    const exists = await this.db.queryOne<{ id: string }>(sql`
      SELECT id FROM personal_brand_linkedin_historical_posts WHERE id = ${id} LIMIT 1;
    `);
    if (!exists) throw new Error("Historical LinkedIn post not found.");
    await this.db.transaction([
      sql`DELETE FROM personal_brand_linkedin_topic_events
        WHERE target_kind = 'historical_post' AND target_id = ${id};`,
      sql`DELETE FROM personal_brand_linkedin_historical_posts WHERE id = ${id};`,
    ]);
  }

  private async topicSourceFingerprint(target: { targetKind: "confirmed_publication" | "historical_post"; targetId: string }): Promise<string> {
    if (target.targetKind === "confirmed_publication") {
      const row = await this.db.queryOne<JsonRow>(sql`
        SELECT payload_json FROM personal_brand_publications WHERE post_id = ${target.targetId} LIMIT 1;
      `);
      if (!row) throw new Error("LinkedIn topic publication does not exist.");
      const receipt = rowJson<ManualPublicationReceipt>(row);
      if (receipt.destination !== "linkedin" || receipt.source !== "user_confirmed" ||
          !/^[a-f0-9]{64}$/.test(receipt.contentSha256))
        throw new Error("Topics require a confirmed LinkedIn publication.");
      return receipt.contentSha256;
    }
    const row = await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_linkedin_historical_posts WHERE id = ${target.targetId} LIMIT 1;
    `);
    if (!row) throw new Error("Historical LinkedIn topic post does not exist.");
    const post = rowJson<HistoricalLinkedInPost>(row);
    if (post.source !== "user_attested_historical" || post.userConfirmed !== true ||
        !/^[a-f0-9]{64}$/.test(post.bodySha256) ||
        createHash("sha256").update(post.body,"utf8").digest("hex") !== post.bodySha256)
      throw new Error("Historical topic post failed source integrity verification.");
    return post.bodySha256;
  }

  async listLinkedInTopicHistory(target: unknown): Promise<LinkedInTopicEvent[]> {
    const t=validateTopicTarget(target);
    await this.topicSourceFingerprint(t);
    const rows=await this.db.queryAll<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_linkedin_topic_events
      WHERE target_kind = ${t.targetKind} AND target_id = ${t.targetId}
      ORDER BY revision ASC;
    `);
    return rows.map(row=>rowJson<LinkedInTopicEvent>(row));
  }

  async listLinkedInTopicLabels(): Promise<LinkedInTopicEvent[]> {
    const rows=await this.db.queryAll<JsonRow>(
      "SELECT payload_json FROM personal_brand_linkedin_topic_events ORDER BY target_kind, target_id, revision ASC;",
    );
    const active=latestTopicLabels(rows.map(row=>rowJson<LinkedInTopicEvent>(row)));
    const valid:LinkedInTopicEvent[]=[];
    for(const event of active){
      try{
        const fingerprint=await this.topicSourceFingerprint(event);
        if(fingerprint===event.sourceFingerprint)valid.push(event);
      }catch{
        // Never show labels attributed to a deleted or integrity-failed post.
      }
    }
    return valid;
  }

  async attestLinkedInTopics(raw: unknown, expectedRevision: number, confirmed: boolean): Promise<LinkedInTopicEvent> {
    if(confirmed!==true)throw new Error("LinkedIn topic labels require explicit user confirmation.");
    const input=validateTopicLabels(raw);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>100000)
      throw new Error("Invalid topic revision precondition.");
    const sourceFingerprint=await this.topicSourceFingerprint(input);
    const record:LinkedInTopicEvent={
      ...input,revision:expectedRevision+1,
      id:`linkedin-topics-${randomUUID()}`, recordedAt:new Date().toISOString(),
      sourceFingerprint, source:"user_attested",userConfirmed:true,
      action:input.topics.length?"label":"clear",
    };
    // One atomic SQLite statement: a stale writer cannot replace a newer
    // attestation or accidentally skip a revision on concurrent IPC calls.
    await this.db.exec(sql`
      INSERT INTO personal_brand_linkedin_topic_events
        (id,target_kind,target_id,revision,recorded_at,payload_json)
      SELECT ${record.id},${record.targetKind},${record.targetId},${record.revision},
        ${record.recordedAt},${JSON.stringify(record)}
      WHERE COALESCE((SELECT MAX(revision) FROM personal_brand_linkedin_topic_events
        WHERE target_kind=${record.targetKind} AND target_id=${record.targetId}),0) = ${expectedRevision};
    `);
    const saved=await this.db.queryOne<JsonRow>(sql`
      SELECT payload_json FROM personal_brand_linkedin_topic_events WHERE id=${record.id} LIMIT 1;
    `);
    if(!saved)throw new Error("Stale LinkedIn topic revision. Reload before updating.");
    return rowJson<LinkedInTopicEvent>(saved);
  }

  async listCareerOutcomes(): Promise<CareerOutcomeRecord[]> {
    const rows = await this.db.queryAll<JsonRow>(
      "SELECT payload_json FROM personal_brand_career_outcomes ORDER BY occurred_at DESC, id ASC;",
    );
    return rows.map((row) => rowJson<CareerOutcomeRecord>(row));
  }

  async recordCareerOutcome(raw: unknown): Promise<CareerOutcomeRecord> {
    const now = new Date().toISOString();
    const input = validateCareerOutcomeInput(raw, await this.listPublications(), now);
    const record: CareerOutcomeRecord = {
      ...input,
      id: `career-outcome-${randomUUID()}`,
      recordedAt: now,
      source: "user_attested",
      userConfirmed: true,
    };
    await this.db.exec(sql`
      INSERT INTO personal_brand_career_outcomes
        (id, occurred_at, related_post_id, payload_json, recorded_at)
      VALUES (${record.id}, ${record.occurredAt}, ${record.relatedPostId},
              ${JSON.stringify(record)}, ${record.recordedAt});
    `);
    return record;
  }

  async deleteCareerOutcome(id: string, userConfirmed: boolean): Promise<void> {
    if (!userConfirmed) throw new Error("Deleting a career outcome requires explicit user confirmation.");
    if (typeof id !== "string" || id.length > 150 || !id.startsWith("career-outcome-"))
      throw new Error("Invalid career outcome identifier.");
    const existing = await this.db.queryOne<{ id: string }>(sql`
      SELECT id FROM personal_brand_career_outcomes WHERE id = ${id} LIMIT 1;
    `);
    if (!existing) throw new Error("Career outcome record not found.");
    await this.db.exec(sql`DELETE FROM personal_brand_career_outcomes WHERE id = ${id};`);
  }
}
