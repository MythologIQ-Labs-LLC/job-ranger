// Sojourner rename (#339): a browser workspace, its storage keys and the database file name of
// builds released as Job Ranger move to the Sojourner names without any user losing data.
// - src/pwa/runtime/workspace-migration.ts: copy the legacy OPFS tree, verify, switch; never delete it;
// - src/browser-storage-migration.ts: copy legacy localStorage keys once, keep them;
// Run: node --experimental-transform-types --no-warnings tests/pwa-workspace-migration.test.mjs
// The worker side (both Web Locks, the fallback to the legacy root, the real copy in OPFS) is
// proven in a browser by tests/pwa/workspace-rename-migration.spec.ts.
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

// Same extensionless-import hook as tests/pwa-opfs-write-chunks.test.mjs (CI runs Node 22.12).
const extensionlessTs = `
export async function resolve(specifier, context, nextResolve) {
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith(".ts")) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(extensionlessTs)}`);

const {
  MIGRATION_IN_PROGRESS_FILE,
  MIGRATION_RECORD_FILE,
  hasWorkspace,
  migrateLegacyWorkspace,
  migratedRelativePath,
} = await import("../src/pwa/runtime/workspace-migration.ts");
const {
  DATABASE_FILE_NAME,
  DATA_DIRECTORY,
  LEGACY_DATABASE_FILE_NAME,
  LEGACY_RUNTIME_LOCK_NAME,
  LEGACY_USER_DATA_DIRECTORY,
  RUNTIME_LOCK_NAME,
  USER_DATA_DIRECTORY,
} = await import("../src/pwa/runtime/protocol.ts");
const {
  LEGACY_STORAGE_KEY_PREFIX,
  STORAGE_KEYS_MIGRATED_KEY,
  migrateLegacyStorageKeys,
} = await import("../src/browser-storage-migration.ts");

const NEW = USER_DATA_DIRECTORY;
const LEGACY = LEGACY_USER_DATA_DIRECTORY;
const T0 = Date.parse("2026-11-02T12:00:00.000Z");

test("the renamed build's names and the legacy names it migrates from", () => {
  assert.equal(NEW, "/sojourner");
  assert.equal(DATA_DIRECTORY, "/sojourner/data");
  assert.equal(DATABASE_FILE_NAME, "sojourner.sqlite3");
  assert.equal(RUNTIME_LOCK_NAME, "sojourner-web-runtime-v1");
  assert.equal(LEGACY, "/job-ranger");
  assert.equal(LEGACY_DATABASE_FILE_NAME, "jobscout.sqlite3");
  assert.equal(LEGACY_RUNTIME_LOCK_NAME, "job-ranger-web-runtime-v1");
  assert.equal(LEGACY_STORAGE_KEY_PREFIX, "job-ranger.");
});

/** POSIX-path in-memory file system with Node-style error codes (files only; directories implied). */
function memoryFs(files = {}) {
  const store = new Map(Object.entries(files).map(([name, value]) => [name, typeof value === "string" ? new TextEncoder().encode(value) : value]));
  const directories = new Set();
  const error = (code, target) => Object.assign(new Error(`${code}: ${target}`), { code });
  const isDirectory = (target) =>
    target === "/" || directories.has(target) || [...store.keys(), ...directories].some((name) => name.startsWith(`${target}/`));
  const fs = {
    store,
    directories,
    async readdir(target) {
      if (store.has(target)) throw error("ENOTDIR", target);
      if (!isDirectory(target)) throw error("ENOENT", target);
      const names = new Set();
      for (const name of [...store.keys(), ...directories]) {
        if (name.startsWith(`${target}/`)) names.add(name.slice(target.length + 1).split("/")[0]);
      }
      return [...names].sort();
    },
    async stat(target) {
      if (store.has(target)) return { size: store.get(target).byteLength, isFile: () => true, isDirectory: () => false };
      if (isDirectory(target)) return { size: 0, isFile: () => false, isDirectory: () => true };
      throw error("ENOENT", target);
    },
    async copyFile(source, destination) {
      if (!store.has(source)) throw error("ENOENT", source);
      store.set(destination, new Uint8Array(store.get(source)));
    },
    async writeFile(target, data) {
      store.set(target, data);
    },
    async mkdir(target) {
      directories.add(target);
    },
    async rm(target) {
      for (const name of [...store.keys()]) if (name === target || name.startsWith(`${target}/`)) store.delete(name);
      for (const name of [...directories]) if (name === target || name.startsWith(`${target}/`)) directories.delete(name);
    },
  };
  return fs;
}

/** A legacy workspace as a Job Ranger build left it: database, artifacts, a staged restore, a rollback folder. */
function legacyWorkspace(extra = {}) {
  return {
    [`${LEGACY}/data/${LEGACY_DATABASE_FILE_NAME}`]: "SQLite format 3\u0000 legacy records",
    [`${LEGACY}/data/artifacts/sources/a1/resume.pdf`]: new Uint8Array([37, 80, 68, 70, 1, 2, 3]),
    [`${LEGACY}/data/artifacts/generated/b2/tailored.docx`]: "docx bytes",
    [`${LEGACY}/pending-restore/manifest.json`]: "{\"staged\":true}",
    [`${LEGACY}/pending-restore/${LEGACY_DATABASE_FILE_NAME}`]: "staged backup database",
    [`${LEGACY}/.job-ranger-restore-rollback-1234/${LEGACY_DATABASE_FILE_NAME}`]: "rollback",
    [`${LEGACY}/storage-location.json`]: "{}",
    ...extra,
  };
}

function options(overrides = {}) {
  const verified = [];
  const rebased = [];
  return {
    verified,
    rebased,
    userDataDirectory: NEW,
    legacyUserDataDirectory: LEGACY,
    dataDirectoryName: "data",
    databaseFileName: DATABASE_FILE_NAME,
    legacyDatabaseFileName: LEGACY_DATABASE_FILE_NAME,
    rebaseDatabase: async (path, from, to) => { rebased.push([path, from, to]); assert.equal(verified.length, 0, "rebase precedes the integrity check"); },
    verifyDatabase: async (path) => { verified.push(path); },
    now: () => T0,
    ...overrides,
  };
}

const snapshot = (fs, root) => new Map([...fs.store].filter(([name]) => name.startsWith(`${root}/`)).map(([name, bytes]) => [name, Buffer.from(bytes).toString("hex")]));
const below = (fs, root) => [...fs.store.keys()].filter((name) => name.startsWith(`${root}/`)).sort();

test("database renames follow the data directory only (journals included); everything else keeps its path", () => {
  const o = options();
  assert.equal(migratedRelativePath(`data/${LEGACY_DATABASE_FILE_NAME}`, o), `data/${DATABASE_FILE_NAME}`);
  assert.equal(migratedRelativePath(`data/${LEGACY_DATABASE_FILE_NAME}-journal`, o), `data/${DATABASE_FILE_NAME}-journal`);
  assert.equal(migratedRelativePath(`pending-restore/${LEGACY_DATABASE_FILE_NAME}`, o), `pending-restore/${LEGACY_DATABASE_FILE_NAME}`);
  assert.equal(migratedRelativePath("data/artifacts/x.pdf", o), "data/artifacts/x.pdf");
});

test("no legacy workspace: nothing happens and nothing is created", async () => {
  const fs = memoryFs();
  assert.deepEqual(await migrateLegacyWorkspace(fs, options()), { action: "none", reason: "no-legacy-workspace" });
  assert.deepEqual([...fs.store.keys()], []);
  fs.directories.add(LEGACY);
  fs.directories.add(`${LEGACY}/data`);
  assert.deepEqual(await migrateLegacyWorkspace(fs, options()), { action: "none", reason: "no-legacy-workspace" }, "empty legacy folders hold no workspace");
});

test("a legacy workspace is copied, renamed, verified, switched to, and left untouched", async () => {
  const fs = memoryFs(legacyWorkspace());
  const legacyBefore = snapshot(fs, LEGACY);
  const o = options();
  const outcome = await migrateLegacyWorkspace(fs, o);
  assert.equal(outcome.action, "migrated");
  assert.equal(outcome.files, legacyBefore.size);
  assert.equal(outcome.bytes, [...fs.store].filter(([name]) => name.startsWith(`${LEGACY}/`)).reduce((sum, [, bytes]) => sum + bytes.byteLength, 0));
  assert.deepEqual(snapshot(fs, LEGACY), legacyBefore, "the legacy copy is byte-for-byte untouched");
  assert.deepEqual(o.rebased, [[`${NEW}/data/${DATABASE_FILE_NAME}`, `${LEGACY}/data`, `${NEW}/data`]], "managed-artifact paths were rebased in the copy only");
  assert.deepEqual(o.verified, [`${NEW}/data/${DATABASE_FILE_NAME}`], "the copied database was integrity-checked");
  for (const [name, hex] of legacyBefore) {
    const relative = migratedRelativePath(name.slice(LEGACY.length + 1), o);
    assert.equal(Buffer.from(fs.store.get(`${NEW}/${relative}`)).toString("hex"), hex, relative);
  }
  assert.ok(!fs.store.has(`${NEW}/data/${LEGACY_DATABASE_FILE_NAME}`), "the database only exists under its new name");
  assert.ok(!fs.store.has(`${NEW}/${MIGRATION_IN_PROGRESS_FILE}`), "the switch removed the in-progress marker");
  const record = JSON.parse(new TextDecoder().decode(fs.store.get(`${NEW}/${MIGRATION_RECORD_FILE}`)));
  assert.equal(record.from, LEGACY);
  assert.equal(record.files, legacyBefore.size);
  assert.equal(await hasWorkspace(fs, NEW), true);

  // A later start: the new root holds a workspace, so nothing is copied again.
  fs.store.set(`${LEGACY}/data/${LEGACY_DATABASE_FILE_NAME}`, new TextEncoder().encode("a legacy tab wrote later"));
  const newBefore = snapshot(fs, NEW);
  assert.deepEqual(await migrateLegacyWorkspace(fs, options()), { action: "none", reason: "workspace-present" });
  assert.deepEqual(snapshot(fs, NEW), newBefore);
});

test("an existing Sojourner workspace is never replaced by a legacy one", async () => {
  const fs = memoryFs(legacyWorkspace({ [`${NEW}/data/${DATABASE_FILE_NAME}`]: "current workspace" }));
  const before = snapshot(fs, "");
  assert.deepEqual(await migrateLegacyWorkspace(fs, options()), { action: "none", reason: "workspace-present" });
  assert.deepEqual(snapshot(fs, ""), before);
});

test("a failed copy, a size mismatch or a failed integrity check removes only the partial copy", async () => {
  const failures = {
    "copy interrupted": (fs) => {
      let calls = 0;
      const copy = fs.copyFile.bind(fs);
      fs.copyFile = async (source, destination) => {
        calls += 1;
        if (calls === 3) throw Object.assign(new Error("QuotaExceededError"), { code: "EQUOTA" });
        return copy(source, destination);
      };
    },
    "short copy": (fs) => {
      const copy = fs.copyFile.bind(fs);
      fs.copyFile = async (source, destination) => {
        await copy(source, destination);
        if (destination.endsWith(".pdf")) fs.store.set(destination, fs.store.get(destination).subarray(1));
      };
    },
    "missing copy": (fs) => {
      const copy = fs.copyFile.bind(fs);
      fs.copyFile = async (source, destination) => {
        if (!destination.endsWith(".docx")) await copy(source, destination);
      };
    },
  };
  for (const [label, sabotage] of Object.entries(failures)) {
    const fs = memoryFs(legacyWorkspace());
    const legacyBefore = snapshot(fs, LEGACY);
    sabotage(fs);
    const outcome = await migrateLegacyWorkspace(fs, options());
    assert.equal(outcome.action, "failed", label);
    assert.equal(outcome.cleanedUp, true, label);
    assert.deepEqual(below(fs, NEW), [], `${label}: the partial copy is gone`);
    assert.deepEqual(snapshot(fs, LEGACY), legacyBefore, `${label}: the legacy copy is untouched`);
  }
  for (const [label, override, message] of [
    ["integrity check", { verifyDatabase: async () => { throw new Error("database disk image is malformed"); } }, /malformed/],
    ["path rebase", { rebaseDatabase: async () => { throw new Error("1 managed artifact path(s) still point to the earlier workspace"); } }, /earlier workspace/],
  ]) {
    const fs = memoryFs(legacyWorkspace());
    const legacyBefore = snapshot(fs, LEGACY);
    const outcome = await migrateLegacyWorkspace(fs, options(override));
    assert.equal(outcome.action, "failed", label);
    assert.match(String(outcome.error), message, label);
    assert.deepEqual(below(fs, NEW), [], label);
    assert.deepEqual(snapshot(fs, LEGACY), legacyBefore, label);
  }
});

test("a workspace without a database (only artifacts) is copied without a database check", async () => {
  const fs = memoryFs({ [`${LEGACY}/data/artifacts/a/x.pdf`]: "pdf" });
  const o = options();
  assert.equal((await migrateLegacyWorkspace(fs, o)).action, "migrated");
  assert.deepEqual(o.verified, []);
  assert.deepEqual(o.rebased, []);
  assert.ok(fs.store.has(`${NEW}/data/artifacts/a/x.pdf`));
});

test("an interrupted earlier copy is recognised by its marker, discarded and redone", async () => {
  const fs = memoryFs(legacyWorkspace({
    [`${NEW}/${MIGRATION_IN_PROGRESS_FILE}`]: "{}",
    [`${NEW}/data/${DATABASE_FILE_NAME}`]: "half a database",
    [`${NEW}/stray-partial-file`]: "x",
  }));
  assert.equal(await hasWorkspace(fs, NEW), false, "a marked root is not a workspace");
  const legacyBefore = snapshot(fs, LEGACY);
  assert.equal((await migrateLegacyWorkspace(fs, options())).action, "migrated");
  assert.ok(!fs.store.has(`${NEW}/stray-partial-file`), "the partial copy was discarded first");
  assert.equal(new TextDecoder().decode(fs.store.get(`${NEW}/data/${DATABASE_FILE_NAME}`)), "SQLite format 3\u0000 legacy records");
  assert.deepEqual(snapshot(fs, LEGACY), legacyBefore);

  // Marker but no legacy workspace any more: the partial copy is removed, nothing else happens.
  const orphan = memoryFs({ [`${NEW}/${MIGRATION_IN_PROGRESS_FILE}`]: "{}", [`${NEW}/data/x`]: "partial" });
  assert.deepEqual(await migrateLegacyWorkspace(orphan, options()), { action: "none", reason: "no-legacy-workspace" });
  assert.deepEqual(below(orphan, NEW), []);
});

test("when even the cleanup fails, the marker keeps the leftovers recognisable for the next start", async () => {
  const fs = memoryFs(legacyWorkspace());
  const rm = fs.rm.bind(fs);
  fs.rm = async () => { throw Object.assign(new Error("locked"), { code: "ELOCKED" }); };
  const outcome = await migrateLegacyWorkspace(fs, options({ verifyDatabase: async () => { throw new Error("not ok"); } }));
  assert.equal(outcome.action, "failed");
  assert.equal(outcome.cleanedUp, false);
  assert.ok(fs.store.has(`${NEW}/${MIGRATION_IN_PROGRESS_FILE}`));
  assert.equal(await hasWorkspace(fs, NEW), false);
  fs.rm = rm;
  assert.equal((await migrateLegacyWorkspace(fs, options())).action, "migrated");
  assert.equal(await hasWorkspace(fs, NEW), true);
});

test("an interrupted cleanup removes the in-progress marker last, so leftovers are never taken for a workspace", async () => {
  const fs = memoryFs(legacyWorkspace());
  const rm = fs.rm.bind(fs);
  let calls = 0;
  fs.rm = async (target, options) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error("interrupted"), { code: "EIO" });
    return rm(target, options);
  };
  const outcome = await migrateLegacyWorkspace(fs, options({ verifyDatabase: async () => { throw new Error("not ok"); } }));
  assert.equal(outcome.action, "failed");
  assert.equal(outcome.cleanedUp, false);
  assert.ok(fs.store.has(`${NEW}/${MIGRATION_IN_PROGRESS_FILE}`), "the marker outlives every other leftover");
  assert.equal(await hasWorkspace(fs, NEW), false);
  fs.rm = rm;
  assert.equal((await migrateLegacyWorkspace(fs, options())).action, "migrated");
});

// --- browser storage keys ---------------------------------------------------------------------

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

test("legacy storage keys are copied once to their new names, never over a newer value, and kept", () => {
  const storage = memoryStorage({
    "job-ranger.onboarding.dismissed.v1": "true",
    "job-ranger.career-profile.v1": "{\"fullName\":\"Legacy\"}",
    "job-ranger.applications.v1": "[]",
    "sojourner.applications.v1": "[{\"id\":\"newer\"}]",
    theme: "dark",
    "someone-else.key": "x",
  });
  const result = migrateLegacyStorageKeys(storage, () => T0);
  assert.equal(result.status, "migrated");
  assert.deepEqual(result.copied.sort(), ["sojourner.career-profile.v1", "sojourner.onboarding.dismissed.v1"]);
  assert.equal(storage.getItem("sojourner.onboarding.dismissed.v1"), "true");
  assert.equal(storage.getItem("sojourner.career-profile.v1"), "{\"fullName\":\"Legacy\"}");
  assert.equal(storage.getItem("sojourner.applications.v1"), "[{\"id\":\"newer\"}]", "a newer value wins");
  assert.equal(storage.getItem("job-ranger.career-profile.v1"), "{\"fullName\":\"Legacy\"}", "legacy keys are kept");
  assert.equal(storage.getItem("theme"), "dark");
  assert.equal(storage.getItem(STORAGE_KEYS_MIGRATED_KEY), new Date(T0).toISOString());

  // The app consumed and removed the copied career profile (moved into the database): it must not come back.
  storage.removeItem("sojourner.career-profile.v1");
  assert.deepEqual(migrateLegacyStorageKeys(storage), { status: "already-migrated", copied: [] });
  assert.equal(storage.getItem("sojourner.career-profile.v1"), null);
});

test("storage failures never remove anything and leave the copy to the next start", () => {
  assert.deepEqual(migrateLegacyStorageKeys(null), { status: "unavailable", copied: [] });
  const storage = memoryStorage({ "job-ranger.onboarding.dismissed.v1": "true" });
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === STORAGE_KEYS_MIGRATED_KEY) throw new DOMException("full", "QuotaExceededError");
    setItem(key, value);
  };
  assert.equal(migrateLegacyStorageKeys(storage).status, "failed");
  assert.equal(storage.getItem("job-ranger.onboarding.dismissed.v1"), "true");
  assert.equal(storage.getItem(STORAGE_KEYS_MIGRATED_KEY), null);
  storage.setItem = setItem;
  assert.equal(migrateLegacyStorageKeys(storage).status, "migrated");
});
