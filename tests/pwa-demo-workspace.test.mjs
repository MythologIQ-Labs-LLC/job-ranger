// Demo-flavor workspace ownership rules (src/pwa/runtime/demo-workspace.ts), with an
// in-memory file system and an injected clock. The demo may only ever erase a
// workspace it can prove is its own.
// Run: node --experimental-strip-types tests/pwa-demo-workspace.test.mjs
import assert from "node:assert/strict";
import {
  DEMO_ACTIVITY_WRITE_INTERVAL_MS,
  DEMO_IDLE_RESET_HOURS,
  DEMO_IDLE_RESET_MS,
  DEMO_REFUSAL_MESSAGE,
  DEMO_SENTINEL_FILE,
  containsAnyFile,
  createDemoSentinel,
  decideDemoStartup,
  isValidDemoSessionId,
  parseDemoSentinel,
  resetDemoWorkspace,
  shouldRecordDemoActivity,
  writeDemoSentinel,
} from "../src/pwa/runtime/demo-workspace.ts";

const USER = "/job-ranger";
const IO = "/job-ranger-io";
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const T0 = Date.parse("2026-10-16T09:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/** Minimal POSIX-path in-memory file system with Node-style error codes. */
function memoryFs(files = {}) {
  const store = new Map(Object.entries(files).map(([name, text]) => [name, new TextEncoder().encode(text)]));
  const directories = new Set();
  const error = (code, target) => Object.assign(new Error(`${code}: ${target}`), { code });
  const isDirectory = (target) =>
    directories.has(target) || [...store.keys(), ...directories].some((name) => name.startsWith(`${target}/`));
  return {
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
    async readFile(target) {
      if (!store.has(target)) throw error(isDirectory(target) ? "EISDIR" : "ENOENT", target);
      return store.get(target);
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
}

const sentinelText = (overrides = {}) =>
  JSON.stringify({ ...createDemoSentinel({ sessionId: SESSION_A, now: T0, seeded: true }), ...overrides });
const decide = (fs, sessionId = SESSION_A, now = T0 + HOUR) =>
  decideDemoStartup(fs, { userDataDirectory: USER, sessionId, now });

assert.equal(DEMO_IDLE_RESET_HOURS, 8);
assert.equal(DEMO_IDLE_RESET_MS, 8 * HOUR);
assert.equal(DEMO_SENTINEL_FILE, ".demo-workspace.json");
assert.equal(DEMO_REFUSAL_MESSAGE, "This site holds a Job Ranger workspace that is not a demo; the demo will not erase it.");
assert.ok(isValidDemoSessionId(SESSION_A));
assert.ok(!isValidDemoSessionId("short"));
assert.ok(!isValidDemoSessionId("../../job-ranger/escape-attempt"));

// --- nothing to erase: missing or empty workspace -> reset
assert.deepEqual(await decide(memoryFs()), { action: "reset", reason: "empty" });
{
  const fs = memoryFs();
  fs.directories.add(USER);
  fs.directories.add(`${USER}/data`);
  assert.equal(await containsAnyFile(fs, USER), false, "empty directories hold no workspace");
  assert.deepEqual(await decide(fs), { action: "reset", reason: "empty" });
}

// --- B1: any files without a valid demo sentinel -> REFUSE, never erase
for (const [label, files] of [
  ["a real standard workspace", { [`${USER}/data/jobscout.sqlite3`]: "SQLite format 3", [`${USER}/data/artifacts/sources/a/source.txt`]: "resume" }],
  ["a staged restore", { [`${USER}/pending-restore/manifest.json`]: "{}" }],
  ["an unparsable sentinel", { [`${USER}/${DEMO_SENTINEL_FILE}`]: "not json", [`${USER}/data/jobscout.sqlite3`]: "db" }],
  ["a sentinel for another flavor", { [`${USER}/${DEMO_SENTINEL_FILE}`]: sentinelText({ buildFlavor: "standard" }), [`${USER}/data/jobscout.sqlite3`]: "db" }],
  ["a sentinel of another kind", { [`${USER}/${DEMO_SENTINEL_FILE}`]: sentinelText({ kind: "something-else" }) }],
  ["a sentinel with a bad session id", { [`${USER}/${DEMO_SENTINEL_FILE}`]: sentinelText({ sessionId: "x" }) }],
]) {
  const fs = memoryFs(files);
  const before = new Map(fs.store);
  assert.deepEqual(await decide(fs), { action: "refuse", reason: "not-a-demo-workspace" }, label);
  await assert.rejects(
    resetDemoWorkspace(fs, { userDataDirectory: USER, ioDirectory: IO, sessionId: SESSION_A, now: T0 }, await decide(fs)),
    /without a reset decision/,
    `${label}: erasing is impossible without a reset decision`,
  );
  assert.deepEqual(fs.store, before, `${label}: nothing was touched`);
}

// --- valid demo sentinel
const demoWorkspace = (overrides) =>
  memoryFs({ [`${USER}/${DEMO_SENTINEL_FILE}`]: sentinelText(overrides), [`${USER}/data/jobscout.sqlite3`]: "demo db" });
const kept = await decide(demoWorkspace());
assert.equal(kept.action, "keep", "same session, recently active: keep (reload)");
assert.equal(kept.sentinel.sessionId, SESSION_A);
// M1: a workspace owned by another session is never opened by this tab.
assert.deepEqual(await decide(demoWorkspace(), SESSION_B), { action: "reset", reason: "new-session" });
// M2: idle longer than the limit is replaced even for the same session (session-restoring browsers).
assert.equal((await decide(demoWorkspace(), SESSION_A, T0 + DEMO_IDLE_RESET_MS)).action, "keep", "exactly at the limit");
assert.deepEqual(await decide(demoWorkspace(), SESSION_A, T0 + DEMO_IDLE_RESET_MS + 1), { action: "reset", reason: "idle" });
assert.deepEqual(await decide(demoWorkspace(), SESSION_A, T0 + 3 * 24 * HOUR), { action: "reset", reason: "idle" });
// An unfinished seed (claimed, never completed) is the demo's own and is replaced.
assert.deepEqual(await decide(demoWorkspace({ seeded: false })), { action: "reset", reason: "incomplete-seed" });

// --- reset erases only after a reset decision and immediately claims the workspace
{
  const fs = demoWorkspace();
  fs.store.set(`${IO}/inbox/x/file.pdf`, new Uint8Array([1]));
  const decision = await decide(fs, SESSION_B, T0 + 2 * HOUR);
  const claim = await resetDemoWorkspace(fs, { userDataDirectory: USER, ioDirectory: IO, sessionId: SESSION_B, now: T0 + 2 * HOUR }, decision);
  assert.deepEqual([...fs.store.keys()], [`${USER}/${DEMO_SENTINEL_FILE}`], "only the new claim remains");
  assert.equal(claim.sessionId, SESSION_B);
  assert.equal(claim.seeded, false);
  const stored = parseDemoSentinel(new TextDecoder().decode(fs.store.get(`${USER}/${DEMO_SENTINEL_FILE}`)));
  assert.deepEqual(stored, claim);
  // An interrupted seed is recognised as the demo's own next time, never as a real workspace.
  fs.store.set(`${USER}/data/jobscout.sqlite3`, new Uint8Array([1, 2]));
  assert.deepEqual(await decide(fs, SESSION_B, T0 + 3 * HOUR), { action: "reset", reason: "incomplete-seed" });
  // After a completed seed the owning session keeps it.
  await writeDemoSentinel(fs, USER, createDemoSentinel({ sessionId: SESSION_B, now: T0 + 3 * HOUR, seeded: true, createdAt: claim.createdAt }));
  assert.equal((await decide(fs, SESSION_B, T0 + 4 * HOUR)).action, "keep");
  assert.deepEqual(await decide(fs, SESSION_A, T0 + 4 * HOUR), { action: "reset", reason: "new-session" });
}

// --- activity refreshes lastActiveAt at a modest cadence
assert.equal(shouldRecordDemoActivity(T0, T0 + DEMO_ACTIVITY_WRITE_INTERVAL_MS - 1), false);
assert.equal(shouldRecordDemoActivity(T0, T0 + DEMO_ACTIVITY_WRITE_INTERVAL_MS), true);
assert.ok(DEMO_ACTIVITY_WRITE_INTERVAL_MS <= DEMO_IDLE_RESET_MS / 10);
{
  // A session that stays active never goes idle; a refreshed sentinel resets the idle clock.
  const fs = demoWorkspace();
  const active = { ...createDemoSentinel({ sessionId: SESSION_A, now: T0 + 7 * HOUR, seeded: true }), createdAt: new Date(T0).toISOString() };
  await writeDemoSentinel(fs, USER, active);
  assert.equal((await decide(fs, SESSION_A, T0 + 14 * HOUR)).action, "keep");
}

console.log("pwa demo workspace ownership tests passed");
