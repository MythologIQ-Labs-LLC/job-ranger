// #194: "Restore from a backup" is offered only for a positively identified damaged database.
// Offering it for any other failure could permanently replace healthy data (for example a
// workspace upgraded by a newer Sojourner, which a restore would delete).
import assert from "node:assert/strict";
import { test } from "node:test";
import { canOfferRestoreFromBackup, isDamagedWorkspaceError, RECOVERY_CHANNELS } from "../src/pwa/runtime/workspace-recovery.ts";

const damaged = [
  new Error("SQLITE_NOTADB: sqlite3 result code 26: file is not a database"),
  new Error("SQLITE_CORRUPT: sqlite3 result code 11: database disk image is malformed"),
];
const notDamaged = [
  new Error("This Sojourner workspace was upgraded by a newer version (database schema 99). Update Sojourner to open it; your data has not been changed."),
  Object.assign(new Error("Sojourner could not save its database to browser storage: QuotaExceededError"), { name: "SqliteStorageError", code: "EJOBRANGERSTORAGE" }),
  Object.assign(new Error("ENOENT: no such file or directory, open '/job-ranger/data/x'"), { code: "ENOENT" }),
  new Error("Pending restore marker is invalid"),
  new Error("Backup artifact hash mismatch: artifacts/a.pdf"),
  new Error("No handler registered for 'career:get-profile'"),
  "SQLITE_BUSY: database is locked",
  null,
];

test("only SQLite NOTADB / CORRUPT failures count as a damaged workspace", () => {
  for (const error of damaged) assert.equal(isDamagedWorkspaceError(error), true, String(error));
  for (const error of notDamaged) assert.equal(isDamagedWorkspaceError(error), false, String(error));
});

test("restore is offered only for a damaged database, outside the demo, with the engine up and no failed pending restore", () => {
  const base = { error: damaged[0], demo: false, engineReady: true, pendingRestoreSettled: true };
  assert.equal(canOfferRestoreFromBackup(base), true);
  assert.equal(canOfferRestoreFromBackup({ ...base, demo: true }), false, "demo never offers restore");
  assert.equal(canOfferRestoreFromBackup({ ...base, engineReady: false }), false, "validating a backup needs the engine");
  assert.equal(canOfferRestoreFromBackup({ ...base, pendingRestoreSettled: false }), false, "a failed pending restore is never answered with another restore");
  for (const error of notDamaged) assert.equal(canOfferRestoreFromBackup({ ...base, error }), false, String(error));
});

test("recovery mode serves only backup validation and staging", () => {
  assert.deepEqual([...RECOVERY_CHANNELS].sort(), ["backups:select-restore", "backups:stage-restore"]);
});
