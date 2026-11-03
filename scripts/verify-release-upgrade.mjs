#!/usr/bin/env node
// Verifies that the current build safely opens data written by a previously
// published release (RELEASE_READINESS §3, "Data and migration safety").
//
//   npm run test:release-upgrade -- [--baseline job-ranger-v1.2.0] [--work <dir>] [--keep]
//                                   [--reuse-node-modules]
//
// 1. Checks the baseline release tag out into a temporary git worktree,
//    installs its dependencies, and compiles its desktop runtime. The default
//    baseline is the newest stable Sojourner tag (vX.Y.Z). Until Sojourner has
//    one, it is the newest stable Job Ranger tag (job-ranger-vX.Y.Z, i.e.
//    job-ranger-v1.2.0): the Job Ranger releases were archived under that
//    prefix and their data is what a Sojourner install upgrades in place.
//    Pre-release tags (v1.0.0-alpha.1, job-ranger-v1.2.0-rc.5) are never the
//    default. --baseline <tag> overrides the choice.
// 2. Runs the baseline's own package smoke and feature smoke tests to write
//    real baseline data directories (scripts/upgrade-check/generate-baseline-data.cjs).
// 3. Opens every directory with the current build and checks that no baseline
//    data changed, all migrations apply, read paths work, and backup/restore
//    works wherever the baseline itself could back up
//    (scripts/upgrade-check/check-current-release.cjs).
//
// The current runtime must already be compiled (`npm run desktop:compile`).
// The report is written to build/trust/release-upgrade-report.json.
// --reuse-node-modules symlinks the current node_modules into the baseline
// instead of running `npm ci` there (faster offline local runs; CI installs).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectDefaultBaseline } from "./upgrade-check/baseline-tag.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const flag = (name) => args.includes(name);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    // Only npm needs a shell on Windows (npm.cmd). Running node or git through
    // a shell breaks when process.execPath contains spaces (C:\Program Files\nodejs).
    shell: process.platform === "win32" && command === "npm",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

function defaultBaseline() {
  const tags = run("git", ["tag", "--list", "v*", "job-ranger-v*"], { capture: true }).split(/\r?\n/);
  const baseline = selectDefaultBaseline(tags);
  if (!baseline) {
    throw new Error(
      "No stable vX.Y.Z or job-ranger-vX.Y.Z tag found. Fetch tags (actions/checkout with fetch-depth: 0) or pass --baseline.",
    );
  }
  return baseline;
}

const baseline = option("--baseline") ?? defaultBaseline();
const work = path.resolve(option("--work") ?? mkdtempSync(path.join(os.tmpdir(), "sojourner-release-upgrade-")));
const baselineRoot = path.join(work, "baseline");
const dataRoot = path.join(work, "data");
const keep = flag("--keep");

console.log(`Release upgrade verification: ${baseline} -> current checkout`);
rmSync(baselineRoot, { recursive: true, force: true });
rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(dataRoot, { recursive: true });

let failed = false;
try {
  run("git", ["worktree", "add", "--detach", baselineRoot, baseline]);

  if (flag("--reuse-node-modules")) {
    symlinkSync(path.join(root, "node_modules"), path.join(baselineRoot, "node_modules"), "junction");
  } else {
    // Only the Node-side runtime is exercised; no Electron binary is needed.
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: baselineRoot,
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: "1" },
    });
  }
  run(process.execPath, ["scripts/prepare-electron-runtime.mjs"], { cwd: baselineRoot });
  run(process.execPath, [path.join(baselineRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.electron.json"], {
    cwd: baselineRoot,
  });

  run(process.execPath, [path.join(root, "scripts", "upgrade-check", "generate-baseline-data.cjs"), baselineRoot, dataRoot], {
    cwd: baselineRoot,
  });

  const check = spawnSync(process.execPath, [path.join(root, "scripts", "upgrade-check", "check-current-release.cjs"), dataRoot], {
    cwd: root,
    stdio: "inherit",
  });
  failed = check.status !== 0;

  const report = path.join(dataRoot, "release-upgrade-report.json");
  if (existsSync(report)) {
    mkdirSync(path.join(root, "build", "trust"), { recursive: true });
    copyFileSync(report, path.join(root, "build", "trust", "release-upgrade-report.json"));
    console.log("Report: build/trust/release-upgrade-report.json");
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  spawnSync("git", ["worktree", "remove", "--force", baselineRoot], { cwd: root, stdio: "ignore" });
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`Kept working directory: ${work}`);
}

if (failed) {
  console.error(`Release upgrade verification FAILED (${baseline} -> current).`);
  process.exit(1);
}
console.log(`Release upgrade verification passed (${baseline} -> current).`);
