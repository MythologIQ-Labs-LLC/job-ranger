// Runs the shared-core domain smoke suites on the web runtime's SQLite WASM
// engine (see tests/support/wasm-sqlite-preload.mjs). A pass proves the PWA
// persistence adapter preserves the same domain semantics as the Electron
// sqlite3 CLI adapter: migrations, provenance, lineage, applications,
// submitted-artifact links, backups, and restores.
import { spawnSync } from "node:child_process";

const suites = [
  "backend-smoke-test",
  "career-persistence-smoke-test",
  "target-tracks-smoke-test",
  "user-authored-evidence-smoke-test",
  "evidence-extension-smoke-test",
  "application-lifecycle-smoke-test",
  "application-insights-smoke-test",
  "career-story-smoke-test",
  "application-materials-smoke-test",
  "interview-prep-smoke-test",
  "requirement-coverage-smoke-test",
  "json-resume-smoke-test",
  "backup-restore-smoke-test",
  "portable-archive-smoke-test",
  "resume-lifecycle-smoke-test",
  "resume-tailoring-smoke-test",
  "resume-import-smoke-test",
  "google-drive-export-smoke-test",
  "google-drive-export-recovery.test",
  "v1-1-2-upgrade-smoke-test",
  "sql-text-readback.test",
  "nul-text.test",
  "demo-seed-smoke-test",
];

let failed = 0;
for (const suite of suites) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--import", "./tests/support/wasm-sqlite-preload.mjs", `tests/${suite}.cjs`],
    { encoding: "utf8", timeout: 300_000 },
  );
  const engineLine = (result.stdout ?? "").split("\n").find((line) => line.startsWith("[sqlite-wasm parity]"));
  if (result.status === 0 && engineLine) {
    console.log(`ok   ${suite} ${engineLine.replace("[sqlite-wasm parity] ", "(")})`);
  } else {
    failed += 1;
    console.error(`FAIL ${suite} (exit ${result.status})`);
    console.error((result.stdout ?? "").slice(-2000));
    console.error((result.stderr ?? "").slice(-4000));
  }
}
if (failed > 0) {
  console.error(`${failed} shared-core suite(s) failed on the SQLite WASM engine`);
  process.exit(1);
}
console.log(`All ${suites.length} shared-core suites passed on the SQLite WASM engine.`);
