/**
 * Demo-flavor workspace ownership (runtime worker side).
 *
 * The demo flavor replaces its workspace with fresh fictional sample data at
 * the start of each demo session. Erasing browser storage is only safe when the
 * storage provably holds a demo workspace, so every demo workspace carries a
 * sentinel file written by the demo itself:
 *
 *   /job-ranger/.demo-workspace.json
 *   { schemaVersion, kind, buildFlavor: "demo", sessionId, createdAt, lastActiveAt, seeded }
 *
 * Startup rules (decideDemoStartup):
 * - workspace directory missing or holding no files -> reset (nothing to erase);
 * - files present but no valid demo sentinel        -> REFUSE, never erase (it may be
 *   a real workspace: the demo deployed to a real origin, a service-worker update from
 *   the standard app, or the demo served on a real workspace's address);
 * - valid sentinel from an unfinished seed          -> reset;
 * - valid sentinel owned by another session          -> reset (a tab never opens a
 *   workspace another demo session took over);
 * - valid sentinel idle longer than DEMO_IDLE_RESET_HOURS -> reset (browsers that
 *   restore sessions would otherwise keep a previous visitor's entries indefinitely);
 * - otherwise                                         -> keep.
 *
 * Pure functions over an injected file-system and clock, so the rules are unit
 * tested in Node (tests/pwa-demo-workspace.test.mjs).
 */

import { DEMO_IDLE_RESET_HOURS } from "../../demo/flavor.ts";

export { DEMO_IDLE_RESET_HOURS };
export const DEMO_SENTINEL_FILE = ".demo-workspace.json";
export const DEMO_SENTINEL_KIND = "job-ranger-demo-workspace";
export const DEMO_IDLE_RESET_MS = DEMO_IDLE_RESET_HOURS * 60 * 60 * 1000;
/** How often (at most) activity refreshes the sentinel's lastActiveAt. */
export const DEMO_ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export const DEMO_REFUSAL_MESSAGE =
  "This site holds a Sojourner workspace that is not a demo; the demo will not erase it.";

export interface DemoWorkspaceSentinel {
  schemaVersion: 1;
  kind: typeof DEMO_SENTINEL_KIND;
  buildFlavor: "demo";
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
  /** False while the fictional workspace is being written; an unfinished seed is replaced. */
  seeded: boolean;
}

export interface DemoWorkspaceFs {
  readdir(target: string): Promise<string[]>;
  readFile(target: string): Promise<Uint8Array | string>;
  writeFile(target: string, data: Uint8Array): Promise<void>;
  mkdir(target: string, options: { recursive: true }): Promise<unknown>;
  rm(target: string, options: { recursive: true; force: true }): Promise<void>;
}

export type DemoStartupDecision =
  | { action: "keep"; sentinel: DemoWorkspaceSentinel }
  | { action: "reset"; reason: "empty" | "new-session" | "idle" | "incomplete-seed" }
  | { action: "refuse"; reason: "not-a-demo-workspace" };

const SESSION_ID = /^[A-Za-z0-9-]{16,80}$/;

export function isValidDemoSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, "")}/${name}`;
}

export function sentinelPath(userDataDirectory: string): string {
  return joinPath(userDataDirectory, DEMO_SENTINEL_FILE);
}

/** Parses a sentinel; anything that is not exactly a demo sentinel is null. */
export function parseDemoSentinel(text: string): DemoWorkspaceSentinel | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.kind !== DEMO_SENTINEL_KIND ||
    candidate.buildFlavor !== "demo" ||
    !isValidDemoSessionId(candidate.sessionId) ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.lastActiveAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    Number.isNaN(Date.parse(candidate.lastActiveAt)) ||
    typeof candidate.seeded !== "boolean"
  ) {
    return null;
  }
  return candidate as unknown as DemoWorkspaceSentinel;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : null;
}

/** True when the directory tree contains at least one file (a missing directory has none). */
export async function containsAnyFile(fs: DemoWorkspaceFs, directory: string): Promise<boolean> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return false;
    if (code === "ENOTDIR") return true;
    throw error;
  }
  for (const name of names) {
    if (await containsAnyFile(fs, joinPath(directory, name))) return true;
  }
  return false;
}

async function readSentinel(fs: DemoWorkspaceFs, userDataDirectory: string): Promise<DemoWorkspaceSentinel | null> {
  let raw: Uint8Array | string;
  try {
    raw = await fs.readFile(sentinelPath(userDataDirectory));
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return null;
    throw error;
  }
  return parseDemoSentinel(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
}

export async function decideDemoStartup(
  fs: DemoWorkspaceFs,
  options: { userDataDirectory: string; sessionId: string; now: number },
): Promise<DemoStartupDecision> {
  if (!isValidDemoSessionId(options.sessionId)) throw new Error("A demo session needs a valid session id");
  const sentinel = await readSentinel(fs, options.userDataDirectory);
  if (!sentinel) {
    return (await containsAnyFile(fs, options.userDataDirectory))
      ? { action: "refuse", reason: "not-a-demo-workspace" }
      : { action: "reset", reason: "empty" };
  }
  if (!sentinel.seeded) return { action: "reset", reason: "incomplete-seed" };
  if (sentinel.sessionId !== options.sessionId) return { action: "reset", reason: "new-session" };
  const idleMs = options.now - Date.parse(sentinel.lastActiveAt);
  if (!(idleMs <= DEMO_IDLE_RESET_MS)) return { action: "reset", reason: "idle" };
  return { action: "keep", sentinel };
}

export function createDemoSentinel(options: { sessionId: string; now: number; seeded: boolean; createdAt?: string }): DemoWorkspaceSentinel {
  const at = new Date(options.now).toISOString();
  return {
    schemaVersion: 1,
    kind: DEMO_SENTINEL_KIND,
    buildFlavor: "demo",
    sessionId: options.sessionId,
    createdAt: options.createdAt ?? at,
    lastActiveAt: at,
    seeded: options.seeded,
  };
}

export async function writeDemoSentinel(
  fs: DemoWorkspaceFs,
  userDataDirectory: string,
  sentinel: DemoWorkspaceSentinel,
): Promise<void> {
  await fs.mkdir(userDataDirectory, { recursive: true });
  await fs.writeFile(sentinelPath(userDataDirectory), new TextEncoder().encode(`${JSON.stringify(sentinel, null, 2)}\n`));
}

/**
 * Erases a demo workspace and immediately claims the empty workspace for this
 * session (seeded: false), so a seed interrupted part-way is recognised as the
 * demo's own and replaced next time instead of looking like a real workspace.
 * Only call with a "reset" decision from decideDemoStartup.
 */
export async function resetDemoWorkspace(
  fs: DemoWorkspaceFs,
  options: { userDataDirectory: string; ioDirectory: string; sessionId: string; now: number },
  decision: DemoStartupDecision,
): Promise<DemoWorkspaceSentinel> {
  if (decision.action !== "reset") throw new Error("Refusing to erase a workspace without a reset decision");
  // Claim first, erase second, and never remove the sentinel itself: OPFS recursive removal is not
  // atomic, so an interrupted wipe must still leave a demo sentinel (seeded:false) behind. The next
  // start then resets the half-erased workspace instead of refusing it as "not a demo".
  const claim = createDemoSentinel({ sessionId: options.sessionId, now: options.now, seeded: false });
  await writeDemoSentinel(fs, options.userDataDirectory, claim);
  for (const name of await fs.readdir(options.userDataDirectory)) {
    if (name === DEMO_SENTINEL_FILE) continue;
    await fs.rm(joinPath(options.userDataDirectory, name), { recursive: true, force: true });
  }
  await fs.rm(options.ioDirectory, { recursive: true, force: true });
  return claim;
}

/** True when activity at `now` should refresh lastActiveAt (written at most every few minutes). */
export function shouldRecordDemoActivity(lastRecordedAt: number, now: number): boolean {
  return now - lastRecordedAt >= DEMO_ACTIVITY_WRITE_INTERVAL_MS;
}
