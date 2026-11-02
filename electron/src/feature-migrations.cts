/**
 * Schema migrations owned by feature modules (applied lazily by the module
 * that owns the tables) share the `schema_migrations` table with the core
 * migrations in migrations.cts. Listing them here lets every runtime recognize
 * a database written by a newer Job Ranger and refuse to downgrade it.
 */
export const FEATURE_MIGRATIONS = {
  applicationLifecycle: { version: 1001, name: "application_lifecycle_foundation" },
  careerStories: { version: 1002, name: "career_story_projections" },
  applicationMaterials: { version: 1003, name: "application_material_projections" },
  applicationInsights: { version: 1004, name: "application_insights_and_offers" },
  personalBrand: { version: 1005, name: "personal_brand_manual_publishing" },
  personalBrandOutcomes: { version: 1006, name: "personal_brand_user_attested_career_outcomes" },
  personalBrandLinkedInAnalytics: { version: 1007, name: "personal_brand_linkedin_native_exports" },
  personalBrandHistoricalLinkedIn: { version: 1008, name: "personal_brand_historical_linkedin_posts" },
  personalBrandLinkedInTopics: { version: 1009, name: "personal_brand_linkedin_topic_attestations" },
} as const;

export const FEATURE_MIGRATION_VERSIONS: ReadonlySet<number> = new Set(
  Object.values(FEATURE_MIGRATIONS).map((migration) => migration.version),
);
