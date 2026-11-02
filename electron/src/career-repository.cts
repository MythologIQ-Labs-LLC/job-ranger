import { randomUUID } from "node:crypto";
import type {
  ApplicationUpdate,
  CareerProfile,
  CareerSearchConstraints,
  CareerTargetTrack,
  CareerTargetTrackInput,
  TrackedApplication,
} from "../../src/shared/contracts.js";
import { sql, SqliteClient } from "./sqlite.cjs";

type CareerProfileRow = {
  id: number;
  version: number;
  full_name: string;
  home_location: string;
  radius_miles: number | null;
  minimum_pay: number | null;
  pay_basis: CareerProfile["payBasis"];
  target_titles: string;
  skills: string;
  certifications: string;
  sectors: string;
  on_call_preference: CareerProfile["onCallPreference"];
  full_time_only: number;
  updated_at: string | null;
};

type TargetTrackRow = {
  id: string;
  name: string;
  relation: CareerTargetTrack["relation"];
  role_titles_json: string;
  seniority: string | null;
  direction: string | null;
  constraints_json: string;
  origin: CareerTargetTrack["origin"];
  is_active: number;
  created_at: string;
  updated_at: string;
};

type ApplicationRow = {
  id: string;
  job_id: string;
  title: string;
  company_name: string;
  url: string;
  status: TrackedApplication["status"];
  notes: string;
  created_at: string;
  updated_at: string;
};

type JobSnapshotRow = {
  job_id: string;
  title: string;
  company_name: string;
  url: string;
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

function mapProfile(row: CareerProfileRow): CareerProfile {
  return {
    version: 2,
    fullName: row.full_name,
    homeLocation: row.home_location,
    radiusMiles: row.radius_miles,
    minimumPay: row.minimum_pay,
    payBasis: row.pay_basis === "annual" ? "annual" : "hourly",
    targetTitles: parseStringArray(row.target_titles),
    skills: parseStringArray(row.skills),
    certifications: parseStringArray(row.certifications),
    sectors: parseStringArray(row.sectors),
    onCallPreference:
      row.on_call_preference === "yes" || row.on_call_preference === "no"
        ? row.on_call_preference
        : "either",
    fullTimeOnly: Boolean(row.full_time_only),
    updatedAt: row.updated_at,
  };
}

function legacyConstraints(profile: CareerProfile): CareerSearchConstraints {
  return {
    geography: {
      locations: profile.homeLocation ? [profile.homeLocation] : [],
      radiusMiles: profile.radiusMiles,
      strength: "unspecified",
    },
    workModes: {
      values: [],
      strength: "unspecified",
    },
    employmentArrangements: {
      values: profile.fullTimeOnly ? ["full-time"] : [],
      strength: "unspecified",
    },
    compensation: {
      floor: profile.minimumPay,
      target: null,
      basis: profile.payBasis,
      floorStrength: "unspecified",
    },
    onCall: {
      value: profile.onCallPreference,
      strength: "unspecified",
    },
    industries: {
      values: [...profile.sectors],
      strength: "unspecified",
    },
  };
}

function emptyConstraints(): CareerSearchConstraints {
  return {
    geography: { locations: [], radiusMiles: null, strength: "unspecified" },
    workModes: { values: [], strength: "unspecified" },
    employmentArrangements: { values: [], strength: "unspecified" },
    compensation: {
      floor: null,
      target: null,
      basis: "annual",
      floorStrength: "unspecified",
    },
    onCall: { value: "either", strength: "unspecified" },
    industries: { values: [], strength: "unspecified" },
  };
}

function parseConstraints(value: string): CareerSearchConstraints {
  try {
    const parsed = JSON.parse(value) as CareerSearchConstraints;
    if (!parsed || typeof parsed !== "object") return emptyConstraints();
    return parsed;
  } catch {
    return emptyConstraints();
  }
}

function mapTargetTrack(row: TargetTrackRow): CareerTargetTrack {
  return {
    id: row.id,
    name: row.name,
    relation: row.relation,
    roleTitles: parseStringArray(row.role_titles_json),
    seniority: row.seniority,
    direction: row.direction,
    constraints: parseConstraints(row.constraints_json),
    origin: row.origin,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasUnspecifiedStrength(constraints: CareerSearchConstraints): boolean {
  return (
    constraints.geography.strength === "unspecified" ||
    constraints.workModes.strength === "unspecified" ||
    constraints.employmentArrangements.strength === "unspecified" ||
    constraints.compensation.floorStrength === "unspecified" ||
    constraints.onCall.strength === "unspecified" ||
    constraints.industries.strength === "unspecified"
  );
}

function assertAuthoredStrengths(input: CareerTargetTrackInput): void {
  if (hasUnspecifiedStrength(input.constraints)) {
    throw new Error(
      "New user-authored target tracks must use explicit required, preferred, or target strengths.",
    );
  }
}

function mapApplication(row: ApplicationRow): TrackedApplication {
  return {
    id: row.id,
    jobId: row.job_id,
    title: row.title,
    companyName: row.company_name,
    url: row.url,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CareerRepository {
  constructor(private readonly sqlite: SqliteClient) {}

  async getProfile(): Promise<CareerProfile | null> {
    const row = await this.sqlite.queryOne<CareerProfileRow>(
      "SELECT * FROM career_profile WHERE id = 1 LIMIT 1;",
    );
    return row ? mapProfile(row) : null;
  }

  async listTargetTracks(): Promise<CareerTargetTrack[]> {
    const rows = await this.sqlite.queryAll<TargetTrackRow>(
      "SELECT * FROM career_target_tracks ORDER BY is_active DESC, updated_at DESC, created_at ASC;",
    );
    return rows.map(mapTargetTrack);
  }

  async getTargetTrackById(id: string): Promise<CareerTargetTrack | null> {
    const row = await this.sqlite.queryOne<TargetTrackRow>(
      sql`SELECT * FROM career_target_tracks WHERE id = ${id} LIMIT 1;`,
    );
    return row ? mapTargetTrack(row) : null;
  }

  async createTargetTrack(input: CareerTargetTrackInput): Promise<CareerTargetTrack> {
    assertAuthoredStrengths(input);
    const now = new Date().toISOString();
    const row = await this.sqlite.queryOne<TargetTrackRow>(sql`
      INSERT INTO career_target_tracks (
        id, name, relation, role_titles_json, seniority, direction,
        constraints_json, origin, is_active, created_at, updated_at
      ) VALUES (
        ${`track-${randomUUID()}`}, ${input.name}, ${input.relation},
        ${JSON.stringify(input.roleTitles)}, ${input.seniority}, ${input.direction},
        ${JSON.stringify(input.constraints)}, ${"user"}, ${input.isActive}, ${now}, ${now}
      )
      RETURNING *;
    `);
    if (!row) throw new Error("Failed to create target track");
    return mapTargetTrack(row);
  }

  async updateTargetTrack(
    id: string,
    input: CareerTargetTrackInput,
  ): Promise<CareerTargetTrack> {
    const current = await this.getTargetTrackById(id);
    if (!current) throw new Error(`Target track ${id} not found`);
    if (id !== "legacy-default") {
      assertAuthoredStrengths(input);
    }

    const row = await this.sqlite.queryOne<TargetTrackRow>(sql`
      UPDATE career_target_tracks
      SET
        name = ${input.name},
        relation = ${input.relation},
        role_titles_json = ${JSON.stringify(input.roleTitles)},
        seniority = ${input.seniority},
        direction = ${input.direction},
        constraints_json = ${JSON.stringify(input.constraints)},
        origin = ${"user"},
        is_active = ${input.isActive},
        updated_at = ${new Date().toISOString()}
      WHERE id = ${id}
      RETURNING *;
    `);
    if (!row) throw new Error(`Failed to update target track ${id}`);
    return mapTargetTrack(row);
  }

  async deleteTargetTrack(id: string): Promise<void> {
    const current = await this.getTargetTrackById(id);
    if (!current) throw new Error(`Target track ${id} not found`);
    if (current.origin === "legacy-profile") {
      throw new Error(
        "Edit the Career Profile bridge track before deleting it so it is not recreated by legacy profile synchronization.",
      );
    }
    await this.sqlite.exec(sql`DELETE FROM career_target_tracks WHERE id = ${id};`);
  }

  async syncLegacyTargetTrack(profile: CareerProfile): Promise<void> {
    const now = profile.updatedAt ?? new Date().toISOString();
    const constraints = legacyConstraints(profile);
    await this.sqlite.exec(sql`
      INSERT INTO career_target_tracks (
        id, name, relation, role_titles_json, seniority, direction,
        constraints_json, origin, is_active, created_at, updated_at
      ) VALUES (
        ${"legacy-default"}, ${"Primary search"}, ${"target"},
        ${JSON.stringify(profile.targetTitles)}, ${null}, ${null},
        ${JSON.stringify(constraints)}, ${"legacy-profile"}, ${true}, ${now}, ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        role_titles_json = excluded.role_titles_json,
        constraints_json = excluded.constraints_json,
        updated_at = excluded.updated_at
      WHERE career_target_tracks.origin = 'legacy-profile';
    `);
  }

  async saveProfile(profile: CareerProfile): Promise<CareerProfile> {
    const row = await this.sqlite.queryOne<CareerProfileRow>(sql`
      INSERT INTO career_profile (
        id,
        version,
        full_name,
        home_location,
        radius_miles,
        minimum_pay,
        pay_basis,
        target_titles,
        skills,
        certifications,
        sectors,
        on_call_preference,
        full_time_only,
        updated_at
      ) VALUES (
        1,
        ${profile.version},
        ${profile.fullName},
        ${profile.homeLocation},
        ${profile.radiusMiles},
        ${profile.minimumPay},
        ${profile.payBasis},
        ${JSON.stringify(profile.targetTitles)},
        ${JSON.stringify(profile.skills)},
        ${JSON.stringify(profile.certifications)},
        ${JSON.stringify(profile.sectors)},
        ${profile.onCallPreference},
        ${profile.fullTimeOnly},
        ${profile.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        version = excluded.version,
        full_name = excluded.full_name,
        home_location = excluded.home_location,
        radius_miles = excluded.radius_miles,
        minimum_pay = excluded.minimum_pay,
        pay_basis = excluded.pay_basis,
        target_titles = excluded.target_titles,
        skills = excluded.skills,
        certifications = excluded.certifications,
        sectors = excluded.sectors,
        on_call_preference = excluded.on_call_preference,
        full_time_only = excluded.full_time_only,
        updated_at = excluded.updated_at
      RETURNING *;
    `);

    if (!row) {
      throw new Error("Failed to save Career Profile");
    }
    const saved = mapProfile(row);
    await this.syncLegacyTargetTrack(saved);
    return saved;
  }

  async listApplications(): Promise<TrackedApplication[]> {
    const rows = await this.sqlite.queryAll<ApplicationRow>(
      "SELECT * FROM applications ORDER BY updated_at DESC, created_at DESC;",
    );
    return rows.map(mapApplication);
  }

  async getApplicationById(id: string): Promise<TrackedApplication | null> {
    const row = await this.sqlite.queryOne<ApplicationRow>(
      sql`SELECT * FROM applications WHERE id = ${id} LIMIT 1;`,
    );
    return row ? mapApplication(row) : null;
  }

  async getApplicationByJobId(jobId: string): Promise<TrackedApplication | null> {
    const row = await this.sqlite.queryOne<ApplicationRow>(
      sql`SELECT * FROM applications WHERE job_id = ${jobId} LIMIT 1;`,
    );
    return row ? mapApplication(row) : null;
  }

  async createApplicationFromJob(jobId: string): Promise<TrackedApplication> {
    const existing = await this.getApplicationByJobId(jobId);
    if (existing) {
      return existing;
    }

    const job = await this.sqlite.queryOne<JobSnapshotRow>(sql`
      SELECT
        CAST(jobs.id AS TEXT) AS job_id,
        jobs.title AS title,
        companies.name AS company_name,
        jobs.url AS url
      FROM jobs
      JOIN companies ON companies.id = jobs.company_id
      WHERE jobs.id = ${jobId}
      LIMIT 1;
    `);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const now = new Date().toISOString();
    const id = `application-${job.job_id}`;
    const row = await this.sqlite.queryOne<ApplicationRow>(sql`
      INSERT INTO applications (
        id,
        job_id,
        title,
        company_name,
        url,
        status,
        notes,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${job.job_id},
        ${job.title},
        ${job.company_name},
        ${job.url},
        ${"interested"},
        ${""},
        ${now},
        ${now}
      )
      RETURNING *;
    `);

    if (!row) {
      throw new Error(`Failed to track job ${jobId}`);
    }
    return mapApplication(row);
  }

  async updateApplication(
    id: string,
    update: ApplicationUpdate,
  ): Promise<TrackedApplication> {
    // An application status edit must not replay an earlier snapshot of notes
    // (nor may a notes edit replay an old status). Each omitted field retains
    // its CURRENT database value in the same atomic UPDATE statement.
    const row = await this.sqlite.queryOne<ApplicationRow>(sql`
      UPDATE applications
      SET
        status = COALESCE(${update.status ?? null}, status),
        notes = COALESCE(${update.notes ?? null}, notes),
        updated_at = ${new Date().toISOString()}
      WHERE id = ${id}
      RETURNING *;
    `);

    if (!row) {
      throw new Error(`Failed to update application ${id}`);
    }
    return mapApplication(row);
  }

  async deleteApplication(id: string): Promise<void> {
    await this.sqlite.exec(sql`DELETE FROM applications WHERE id = ${id};`);
  }

  async importLegacyApplication(application: TrackedApplication): Promise<void> {
    await this.sqlite.exec(sql`
      INSERT OR IGNORE INTO applications (
        id,
        job_id,
        title,
        company_name,
        url,
        status,
        notes,
        created_at,
        updated_at
      ) VALUES (
        ${application.id},
        ${application.jobId},
        ${application.title},
        ${application.companyName},
        ${application.url},
        ${application.status},
        ${application.notes},
        ${application.createdAt},
        ${application.updatedAt}
      );
    `);
  }
}
