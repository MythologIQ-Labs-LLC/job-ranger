import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Read-only audit. Live mode calls locally authenticated gh, never GitHub Actions.
const labels = item => (item.labels ?? []).map(x => typeof x === "string" ? x : x.name).filter(Boolean);
const tagged = (item, prefix) => labels(item).some(x => x.startsWith(prefix));
const open = item => !["closed", "CLOSED"].includes(item.state);
const draft = item => Boolean(item.isDraft ?? item.draft);

export function auditRepository({ issues, prs }, { asOf = new Date(), staleDays = 14, activeLimit = 3 } = {}) {
  if (!Array.isArray(issues) || !Array.isArray(prs)) throw Error("Snapshot requires issues and prs arrays");
  const now = new Date(asOf).getTime();
  if (!Number.isFinite(now) || !Number.isInteger(staleDays) || staleDays < 1) throw Error("Invalid audit date or staleDays");
  const is = issues.filter(open), ps = prs.filter(open), heads = new Map();
  const gaps = is.map(item => ({ number: item.number, missing: [
    ...(!tagged(item, "status:") ? ["status"] : []),
    ...(!tagged(item, "area:") ? ["area"] : []),
    ...(!(item.assignees ?? []).length ? ["owner"] : []),
  ] })).filter(x => x.missing.length);
  for (const pr of ps) {
    const name = pr.headRefName ?? pr.head?.ref;
    if (name) heads.set(name, [...(heads.get(name) ?? []), pr.number]);
  }
  const active = ps.filter(pr => labels(pr).includes("status:active")).length;
  return {
    counts: {
      issues: is.length, prs: ps.length, drafts: ps.filter(draft).length,
      nonDraftHumanPrs: ps.filter(pr => !draft(pr) && !/\[bot\]$/.test(pr.author?.login ?? pr.user?.login ?? "")).length,
      activePrs: active,
    },
    activeLimit, activeLimitExceeded: active > activeLimit,
    issuesMissingTriage: gaps,
    prsMissingStatus: ps.filter(pr => !tagged(pr, "status:")).map(pr => pr.number),
    conflictingStatus: [...is, ...ps].filter(item => labels(item).filter(x => x.startsWith("status:")).length > 1).map(item => item.number),
    duplicateHeads: [...heads.entries()].filter(([, ns]) => ns.length > 1).map(([head, numbers]) => ({ head, numbers })),
    staleDrafts: ps.filter(pr => draft(pr) &&
      Number.isFinite(Date.parse(pr.updatedAt ?? pr.updated_at ?? "")) &&
      now - Date.parse(pr.updatedAt ?? pr.updated_at) >= staleDays * 86400000)
      .map(pr => ({ number: pr.number, lastUpdated: pr.updatedAt ?? pr.updated_at })),
    note: "Read-only. No auto-closures, merges, or release-qualification claims.",
  };
}

function fromGithub(repo) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error("Expected GitHub owner/name");
  const gh = args => JSON.parse(execFileSync("gh", args, {
    encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
  return {
    issues: gh(["issue", "list", "--repo", repo, "--state", "open", "--limit", "500",
      "--json", "number,title,state,labels,assignees,updatedAt"]),
    prs: gh(["pr", "list", "--repo", repo, "--state", "open", "--limit", "500",
      "--json", "number,title,state,isDraft,headRefName,updatedAt,labels,author"]),
  };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (key, fallback) => {
    const i = args.indexOf(key);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw Error("Missing " + key);
    return args[i + 1];
  };
  if (args.some(x => x.startsWith("--") && !["--repo", "--snapshot", "--json", "--stale-days"].includes(x))) throw Error("Unknown audit flag");
  const file = arg("--snapshot", null);
  const state = file ? JSON.parse(readFileSync(file, "utf8")) :
    fromGithub(arg("--repo", "MythologIQ-Labs-LLC/job-ranger"));
  const days = Number(arg("--stale-days", "14"));
  const r = auditRepository(state, { staleDays: days });
  if (args.includes("--json")) return void process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  process.stdout.write([
    "Job Ranger repository hygiene (read-only)",
    "Open: " + r.counts.issues + " issues, " + r.counts.prs + " PRs (" + r.counts.drafts + " drafts)",
    "Active feature PRs (explicit labels): " + r.counts.activePrs + " / " + r.activeLimit,
    "Issues missing status/area/owner: " + r.issuesMissingTriage.length,
    "PRs lacking status: " + r.prsMissingStatus.length,
    "Conflicting status labels: " + (r.conflictingStatus.join(", ") || "none"),
    "Duplicate head branches: " + (r.duplicateHeads.map(x => x.numbers.join("/")).join(", ") || "none"),
    "Drafts idle for " + days + "+ days: " + (r.staleDrafts.map(x => "#" + x.number).join(", ") || "none"),
    r.activeLimitExceeded ? "WARNING: Active PR WIP cap exceeded" : "",
    "No changes made. See docs/REPOSITORY_WORKFLOW.md.",
  ].filter(Boolean).join("\n") + "\n");
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/repo-hygiene-audit.mjs")) {
  try { main(); } catch (error) {
    process.stderr.write("Repo hygiene audit: " + error.message + "\n");
    process.exitCode = 2;
  }
}
