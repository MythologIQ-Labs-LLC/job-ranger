/**
 * Browser storage keys (localStorage) are named `sojourner.<name>`. Builds released as
 * "Job Ranger" used `job-ranger.<name>`; on the first start of a renamed build (desktop renderer
 * and the standard web app, before the application renders) every legacy value is COPIED to its
 * new key, unless the new key already has a value. Legacy keys are kept (a later version may
 * remove them), and a marker makes the copy happen once, so a value the app has since consumed
 * and removed (for example the pre-database career profile) is never brought back.
 *
 * The demo flavor never migrates: its preferences are reset with every new demo session.
 * Pure over an injected storage, unit tested in tests/browser-storage-migration.test.mjs.
 */

export const STORAGE_KEY_PREFIX = "sojourner.";
/** Records that the one-time copy of legacy keys finished. */
export const STORAGE_KEYS_MIGRATED_KEY = "sojourner.storage-keys-migrated.v1";
/** LEGACY: key prefix of builds released as Job Ranger (read only, never written or removed). */
export const LEGACY_STORAGE_KEY_PREFIX = "job-ranger.";
/** LEGACY: the window event-name prefix of those builds (never stored, but a demo reset clears anything under it). */
export const LEGACY_EVENT_PREFIX = "job-ranger:";

export interface MigratableStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StorageKeyMigrationResult {
  status: "migrated" | "already-migrated" | "unavailable" | "failed";
  copied: string[];
}

function defaultStorage(): MigratableStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function migrateLegacyStorageKeys(storage: MigratableStorage | null = defaultStorage(), now: () => number = Date.now): StorageKeyMigrationResult {
  if (!storage) return { status: "unavailable", copied: [] };
  const copied: string[] = [];
  try {
    if (storage.getItem(STORAGE_KEYS_MIGRATED_KEY) !== null) return { status: "already-migrated", copied };
    const legacyKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(LEGACY_STORAGE_KEY_PREFIX)) legacyKeys.push(key);
    }
    for (const legacyKey of legacyKeys) {
      const value = storage.getItem(legacyKey);
      const key = STORAGE_KEY_PREFIX + legacyKey.slice(LEGACY_STORAGE_KEY_PREFIX.length);
      if (value === null || storage.getItem(key) !== null) continue;
      storage.setItem(key, value);
      copied.push(key);
    }
    storage.setItem(STORAGE_KEYS_MIGRATED_KEY, new Date(now()).toISOString());
    return { status: "migrated", copied };
  } catch {
    // Storage blocked or full: nothing was removed, and the copy is retried on the next start.
    return { status: "failed", copied };
  }
}
