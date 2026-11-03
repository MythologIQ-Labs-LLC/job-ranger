import { defineConfig } from "@playwright/test";

// Public demo recording (npm run demo:record) and curated screenshots
// (npm run demo:screenshots). Both specs launch their own
// persistent browser contexts, so they read SOJOURNER_PW_CHROMIUM themselves.
export default defineConfig({
  testDir: ".",
  testMatch: ["story.spec.ts", "screenshots.spec.ts"],
  timeout: 300_000,
  outputDir: "../../test-results/demo",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { browserName: "chromium" },
});
