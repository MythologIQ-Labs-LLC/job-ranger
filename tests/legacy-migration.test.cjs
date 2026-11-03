// Startup migration of a data folder written before the rename (Job Ranger -> Sojourner):
// %APPDATA%\job-ranger -> %APPDATA%\Sojourner and "Job Ranger Store" -> "Sojourner Store",
// with data\jobscout.sqlite3 renamed to data\sojourner.sqlite3 in the verified copy.
// Every branch runs against real temporary folders and a real sqlite3 integrity check.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const migration = require("../electron-runtime/electron/src/legacy-migration.cjs");
const { DATABASE_FILE_NAME, LEGACY_DATABASE_FILE_NAME } = require("../electron-runtime/electron/src/database-file.cjs");
const { resolveSqliteBinarySync, sqliteIntegrityCheck, sqliteManagedPathRebase } = require("../electron-runtime/electron/src/sqlite-sync.cjs");

const sqlite = resolveSqliteBinarySync();
assert.ok(sqlite, "sqlite3 is required (set SQLITE3_PATH)");
const verifyDatabase = sqliteIntegrityCheck(sqlite);
const rebaseManagedPaths = sqliteManagedPathRebase(sqlite);
const roots = [];

function appData() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sojourner-migration-test-"));
  roots.push(root);
  return root;
}

function sqlText(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function managedPaths(databasePath) {
  return execFileSync(sqlite, [databasePath], {
    input: "SELECT id || '=' || managed_path FROM source_artifacts UNION ALL SELECT id || '=' || managed_path FROM resume_artifacts ORDER BY 1;\n",
    encoding: "utf8",
  }).trim().split(/\r?\n/);
}

/** Migration with the real sqlite3-backed rebase unless a test overrides it. */
function migrate(input) {
  return migration.migrateLegacyUserData({ rebaseManagedPaths, ...input });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A legacy folder shaped like a real Job Ranger v1.2.0 install. */
function makeLegacy(root, name = "job-ranger") {
  const legacy = path.join(root, name);
  const data = path.join(legacy, "data");
  fs.mkdirSync(data, { recursive: true });
  const database = path.join(data, LEGACY_DATABASE_FILE_NAME);
  execFileSync(sqlite, [database], {
    input: [
      "CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT);",
      "INSERT INTO companies VALUES ('c1', 'Acme Health');",
      "CREATE TABLE schema_migrations (version INTEGER);",
      "INSERT INTO schema_migrations VALUES (1);",
      "CREATE TABLE source_artifacts (id TEXT PRIMARY KEY, managed_path TEXT NOT NULL);",
      "CREATE TABLE resume_artifacts (id TEXT PRIMARY KEY, managed_path TEXT NOT NULL);",
      `INSERT INTO source_artifacts VALUES ('a1', ${sqlText(path.join(data, "artifacts", "sources", "a1", "resume.pdf"))});`,
      // Stored with different letter case, as Windows paths can be.
      `INSERT INTO source_artifacts VALUES ('a2', ${sqlText(path.join(data.toUpperCase(), "artifacts", "sources", "a2", "o'neil.txt"))});`,
      `INSERT INTO source_artifacts VALUES ('outside', ${sqlText(path.join(root, "elsewhere", "x.txt"))});`,
      `INSERT INTO resume_artifacts VALUES ('r1', ${sqlText(path.join(data, "artifacts", "resumes", "r1", "tailored.pdf"))});`,
      "",
    ].join("\n"),
  });
  write(path.join(data, "artifacts", "sources", "a1", "resume.pdf"), Buffer.alloc(70_000, 7));
  write(path.join(data, "artifacts", "resumes", "r1", "tailored.pdf"), "pdf bytes");
  write(path.join(legacy, "Local Storage", "leveldb", "000003.log"), "renderer preferences");
  write(path.join(legacy, "IndexedDB", "file__0.indexeddb.leveldb", "CURRENT"), "MANIFEST-000001\n");
  write(path.join(legacy, "google-drive-credentials.json"), '{"sealed":"x"}');
  write(path.join(legacy, "microsoft-credentials.json"), '{"sealed":"y"}');
  write(path.join(legacy, "storage-location.json"), '{"kind":"folder"}');
  write(path.join(legacy, "Preferences"), "{}");
  return legacy;
}

/** Path -> size + sha256 + mtime for every file and folder under root. */
function snapshot(root) {
  const result = {};
  const visit = (relative) => {
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const child = path.join(relative, name);
      const stat = fs.lstatSync(path.join(root, child));
      if (stat.isDirectory()) {
        result[child] = "dir";
        visit(child);
      } else {
        const bytes = fs.readFileSync(path.join(root, child));
        result[child] = `${stat.size}:${createHash("sha256").update(bytes).digest("hex")}:${stat.mtimeMs}`;
      }
    }
  };
  visit("");
  return result;
}

function withoutNote(snap) {
  const copy = { ...snap };
  delete copy[migration.MIGRATION_NOTE_FILE];
  return copy;
}

function stagingLeftovers(root) {
  return fs.readdirSync(root).filter((name) => name.startsWith(".") && name.includes("-migration-"));
}

function companies(databasePath) {
  return execFileSync(sqlite, [databasePath], { input: "SELECT name FROM companies;\n", encoding: "utf8" }).trim().replace(/\r\n/g, "\n");
}

const logs = [];
const log = (message) => logs.push(message);
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("fresh install: neither folder has a workspace", () => {
  const root = appData();
  const target = path.join(root, "Sojourner");
  const result = migrate({ target, legacy: path.join(root, "job-ranger"), verifyDatabase, log });
  assert.deepEqual(result, { kind: "fresh", userDataDirectory: target });
  assert.equal(fs.existsSync(target), false, "the target is left for Electron to create");
  assert.deepEqual(fs.readdirSync(root), []);
});

test("a legacy folder without a workspace is not migrated", () => {
  const root = appData();
  const legacy = path.join(root, "job-ranger");
  write(path.join(legacy, "Local Storage", "leveldb", "LOG"), "x");
  const before = snapshot(legacy);
  const result = migrate({ target: path.join(root, "Sojourner"), legacy, verifyDatabase, log });
  assert.equal(result.kind, "fresh");
  assert.deepEqual(snapshot(legacy), before);
});

test("legacy only: the whole folder is copied, verified, renamed and used", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({ target, legacy, verifyDatabase, log });
  assert.equal(result.kind, "migrated");
  assert.equal(result.userDataDirectory, target);
  assert.equal(result.legacyDirectory, legacy);
  assert.equal(result.files, Object.values(before).filter((value) => value !== "dir").length);

  // Never modifies legacy files: only the note is added.
  const after = snapshot(legacy);
  assert.deepEqual(withoutNote(after), before);
  const note = fs.readFileSync(path.join(legacy, migration.MIGRATION_NOTE_FILE), "utf8");
  assert.match(note, /now named Sojourner/);
  assert.ok(note.includes(target));
  assert.match(note, /Nothing in this folder was changed or deleted/);

  // Everything arrived, byte for byte, with the database renamed. The
  // database itself differs only by the rebased artifact paths (checked below).
  const copied = snapshot(target);
  const rename = (key) => key.replace(LEGACY_DATABASE_FILE_NAME, DATABASE_FILE_NAME);
  const legacyDatabaseKey = path.join("data", LEGACY_DATABASE_FILE_NAME);
  for (const [key, value] of Object.entries(before)) {
    const copy = copied[rename(key)];
    assert.ok(copy, `${key} was copied`);
    if (value === "dir") assert.equal(copy, "dir");
    else if (key !== legacyDatabaseKey) {
      assert.equal(copy.split(":").slice(0, 2).join(":"), value.split(":").slice(0, 2).join(":"), `${key} is identical`);
    }
  }
  assert.equal(Object.keys(copied).length, Object.keys(before).length, "nothing extra in the copy");
  assert.equal(fs.existsSync(path.join(target, "data", LEGACY_DATABASE_FILE_NAME)), false);
  assert.equal(companies(path.join(target, "data", DATABASE_FILE_NAME)), "Acme Health");
  assert.equal(verifyDatabase(path.join(target, "data", DATABASE_FILE_NAME)), "ok");
  // Managed artifacts now point into the migrated folder; paths outside it are left alone.
  const targetData = path.join(target, "data");
  const expectedPaths = [
    `a1=${path.join(targetData, "artifacts", "sources", "a1", "resume.pdf")}`,
    `a2=${path.join(targetData, "artifacts", "sources", "a2", "o'neil.txt")}`,
    `outside=${path.join(root, "elsewhere", "x.txt")}`,
    `r1=${path.join(targetData, "artifacts", "resumes", "r1", "tailored.pdf")}`,
  ];
  if (process.platform !== "win32") expectedPaths[1] = `a2=${path.join(path.join(legacy, "data").toUpperCase(), "artifacts", "sources", "a2", "o'neil.txt")}`;
  assert.deepEqual(managedPaths(path.join(targetData, DATABASE_FILE_NAME)), expectedPaths);
  assert.ok(
    managedPaths(path.join(legacy, "data", LEGACY_DATABASE_FILE_NAME))[0].startsWith(`a1=${path.join(legacy, "data")}`),
    "the legacy database is unchanged",
  );
  assert.deepEqual(stagingLeftovers(root), []);
  assert.equal(migration.hasWorkspace(target), true);

  // The next start uses the migrated folder and leaves both alone.
  const legacyNow = snapshot(legacy);
  const targetNow = snapshot(target);
  assert.deepEqual(migrate({ target, legacy, verifyDatabase, log }), { kind: "current", userDataDirectory: target });
  assert.deepEqual(snapshot(legacy), legacyNow);
  assert.deepEqual(snapshot(target), targetNow);
});

test("Store folders: 'Job Ranger Store' -> 'Sojourner Store'", () => {
  const root = appData();
  const legacy = makeLegacy(root, "Job Ranger Store");
  const target = path.join(root, "Sojourner Store");
  const result = migrate({ target, legacy, verifyDatabase, log });
  assert.equal(result.kind, "migrated");
  assert.equal(companies(path.join(target, "data", DATABASE_FILE_NAME)), "Acme Health");
});

test("both present: the target workspace wins and nothing is copied", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  write(path.join(target, "data", DATABASE_FILE_NAME), "current workspace");
  const legacyBefore = snapshot(legacy);
  const targetBefore = snapshot(target);
  const result = migrate({ target, legacy, verifyDatabase, log });
  assert.deepEqual(result, { kind: "current", userDataDirectory: target });
  assert.deepEqual(snapshot(legacy), legacyBefore, "no note either");
  assert.deepEqual(snapshot(target), targetBefore);
});

test("an empty target folder is replaced by the migrated copy", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  fs.mkdirSync(target);
  const result = migrate({ target, legacy, verifyDatabase, log });
  assert.equal(result.kind, "migrated");
  assert.equal(migration.hasWorkspace(target), true);
});

test("partial previous copy: stale staging is removed and a workspace-less target is kept aside", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  write(path.join(root, ".Sojourner-migration-2026-11-01T00-00-00-000Z-deadbeef", "data", "half-copied.bin"), "partial");
  write(path.join(target, "Local Storage", "leveldb", "LOG"), "written before any workspace existed");
  const before = snapshot(legacy);
  const result = migrate({
    target,
    legacy,
    verifyDatabase,
    log,
    now: () => new Date("2026-11-02T10:00:00.000Z"),
  });
  assert.equal(result.kind, "migrated");
  assert.deepEqual(stagingLeftovers(root), []);
  assert.equal(companies(path.join(target, "data", DATABASE_FILE_NAME)), "Acme Health");
  const aside = path.join(root, "Sojourner.before-migration-2026-11-02T10-00-00-000Z");
  assert.equal(fs.readFileSync(path.join(aside, "Local Storage", "leveldb", "LOG"), "utf8"), "written before any workspace existed");
  assert.deepEqual(withoutNote(snapshot(legacy)), before);
});

function assertFallback(root, legacy, target, before, result, reason) {
  assert.equal(result.kind, "fallback");
  assert.equal(result.userDataDirectory, legacy, "the app runs on the legacy folder");
  assert.match(result.reason, reason);
  assert.equal(fs.existsSync(target), false, "no partial target is left");
  assert.deepEqual(stagingLeftovers(root), [], "the partial copy is deleted");
  assert.deepEqual(snapshot(legacy), before, "legacy files untouched and no note written");
}

test("copy failure part-way: fall back to the legacy folder", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({
    target,
    legacy,
    verifyDatabase,
    log,
    copyTree: (source, destination) => {
      fs.mkdirSync(path.join(destination, "data"), { recursive: true });
      fs.copyFileSync(path.join(source, "data", LEGACY_DATABASE_FILE_NAME), path.join(destination, "data", LEGACY_DATABASE_FILE_NAME));
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    },
  });
  assertFallback(root, legacy, target, before, result, /ENOSPC/);
});

test("a copy with a missing or short file fails verification: fall back", () => {
  for (const damage of ["drop", "truncate"]) {
    const root = appData();
    const legacy = makeLegacy(root);
    const target = path.join(root, "Sojourner");
    const before = snapshot(legacy);
    const result = migrate({
      target,
      legacy,
      verifyDatabase,
      log,
      copyTree: (source, destination) => {
        fs.cpSync(source, destination, { recursive: true });
        const victim = path.join(destination, "data", "artifacts", "sources", "a1", "resume.pdf");
        if (damage === "drop") fs.rmSync(victim);
        else fs.truncateSync(victim, 10);
      },
    });
    assertFallback(root, legacy, target, before, result, damage === "drop" ? /missing/ : /has 10 bytes instead of 70000/);
  }
});

test("integrity failure (reported by the check): fall back", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({
    target,
    legacy,
    verifyDatabase: () => "*** in database main ***\nPage 2: btreeInitPage() returns error code 11",
    log,
  });
  assertFallback(root, legacy, target, before, result, /integrity check/);
});

test("integrity failure (a damaged database file, real sqlite3): fall back", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  fs.writeFileSync(path.join(legacy, "data", LEGACY_DATABASE_FILE_NAME), Buffer.alloc(8192, 0x41));
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({ target, legacy, verifyDatabase, log });
  assertFallback(root, legacy, target, before, result, /./);
});

test("no sqlite3 to verify with: fall back", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({ target, legacy, verifyDatabase: sqliteIntegrityCheck(null), log });
  assertFallback(root, legacy, target, before, result, /sqlite3 was not found/);
  const noRebase = migrate({ target, legacy, verifyDatabase, rebaseManagedPaths: sqliteManagedPathRebase(null), log });
  assertFallback(root, legacy, target, before, noRebase, /sqlite3 was not found/);
});

test("artifact paths that cannot be rebased: fall back", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({ target, legacy, verifyDatabase, log, rebaseManagedPaths: () => 2 });
  assertFallback(root, legacy, target, before, result, /2 artifact paths still point into the old data folder/);
});

test("a database without artifact tables needs no rebase", () => {
  const root = appData();
  const database = path.join(root, "plain.sqlite3");
  execFileSync(sqlite, [database], { input: "CREATE TABLE t (x);\n" });
  assert.equal(rebaseManagedPaths(database, path.join(root, "a"), path.join(root, "b")), 0);
});

test("the final rename fails: fall back, then the next start migrates", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  const before = snapshot(legacy);
  const result = migrate({
    target,
    legacy,
    verifyDatabase,
    log,
    renamePath: (from, to) => {
      if (to === target) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      fs.renameSync(from, to);
    },
  });
  assertFallback(root, legacy, target, before, result, /EPERM/);

  // Data the fallback run wrote to the legacy folder is what the retry migrates.
  execFileSync(sqlite, [path.join(legacy, "data", LEGACY_DATABASE_FILE_NAME)], {
    input: "INSERT INTO companies VALUES ('c2', 'Written during fallback');\n",
  });
  const retry = migrate({ target, legacy, verifyDatabase, log });
  assert.equal(retry.kind, "migrated");
  assert.equal(companies(path.join(target, "data", DATABASE_FILE_NAME)), "Acme Health\nWritten during fallback");
});

test("a target folder that cannot be set aside: fall back without touching it", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  write(path.join(target, "stray.txt"), "keep me");
  const before = snapshot(legacy);
  const result = migrate({
    target,
    legacy,
    verifyDatabase,
    log,
    renamePath: () => {
      throw new Error("EBUSY: resource busy or locked");
    },
  });
  assert.equal(result.kind, "fallback");
  assert.equal(fs.readFileSync(path.join(target, "stray.txt"), "utf8"), "keep me");
  assert.deepEqual(snapshot(legacy), before);
});

test("a failure after setting the target aside puts it back", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  const target = path.join(root, "Sojourner");
  write(path.join(target, "stray.txt"), "keep me");
  const result = migrate({
    target,
    legacy,
    verifyDatabase: () => "not ok",
    log,
  });
  assert.equal(result.kind, "fallback");
  assert.equal(fs.readFileSync(path.join(target, "stray.txt"), "utf8"), "keep me");
  assert.deepEqual(stagingLeftovers(root), []);
});

test("the same folder for target and legacy is never copied", () => {
  const root = appData();
  const legacy = makeLegacy(root);
  assert.deepEqual(migrate({ target: legacy, legacy, verifyDatabase, log }), { kind: "current", userDataDirectory: legacy });
});

test("sqlite3 discovery honours SQLITE3_PATH and the packaged Windows binary", () => {
  assert.equal(resolveSqliteBinarySync({ SQLITE3_PATH: "C:\\tools\\sqlite3.exe" }, "win32", undefined), "C:\\tools\\sqlite3.exe");
  const resources = appData();
  write(path.join(resources, "sqlite3.exe"), "binary");
  assert.equal(resolveSqliteBinarySync({}, "win32", resources), path.join(resources, "sqlite3.exe"));
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}
for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
if (failed) {
  console.error(`${failed} of ${tests.length} legacy migration tests failed`);
  process.exit(1);
}
console.log(`Legacy data-folder migration tests passed (${tests.length})`);
