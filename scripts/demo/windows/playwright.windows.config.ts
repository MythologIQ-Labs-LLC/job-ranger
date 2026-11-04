import { defineConfig } from "@playwright/test";

// The narrated film is captured from the installed signed Windows app (scripts/demo/windows/).
export default defineConfig({
  testDir: ".",
  testMatch: ["rehearse.spec.ts", "record.spec.ts"],
  timeout: 600_000,
  outputDir: "../../../test-results/film",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
