/**
 * When may the web runtime offer "Restore from a backup" after the workspace failed to open?
 *
 * Only for a positively identified damaged database (SQLite NOTADB / CORRUPT). Any other failure
 * must not offer it: a workspace upgraded by a newer Sojourner, a storage or quota error, or a
 * failed pending restore can all hold healthy data that a restore would permanently replace.
 *
 * Only erasable TypeScript syntax is used so Node can load this file directly in tests.
 */

/** The only calls a failed workspace still serves: validating and staging a backup restore. */
export const RECOVERY_CHANNELS: ReadonlySet<string> = new Set(["backups:select-restore", "backups:stage-restore"]);

const DAMAGED_DATABASE = /\bSQLITE_(NOTADB|CORRUPT)\b|file is not a database|database disk image is malformed/i;

/**
 * A schema SQLite cannot parse is also reported as SQLITE_CORRUPT ("malformed database schema"),
 * but that is what a healthy database written by a newer SQLite looks like to an older build
 * (for example after a service-worker rollback). It must never be offered a destructive restore.
 */
const NEWER_OR_UNPARSEABLE_SCHEMA = /malformed database schema/i;

export function isDamagedWorkspaceError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return DAMAGED_DATABASE.test(message) && !NEWER_OR_UNPARSEABLE_SCHEMA.test(message);
}

export interface RecoveryContext {
  error: unknown;
  demo: boolean;
  /** The SQLite engine is running (validating a backup needs it). */
  engineReady: boolean;
  /** applyPendingRestore finished; a failure there must never lead to another restore. */
  pendingRestoreSettled: boolean;
}

export function canOfferRestoreFromBackup(context: RecoveryContext): boolean {
  return !context.demo && context.engineReady && context.pendingRestoreSettled && isDamagedWorkspaceError(context.error);
}
