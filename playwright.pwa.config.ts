import { defineConfig } from "@playwright/test";

// Browser tests for the Sojourner web/PWA runtime. They run against the
// production build in dist-pwa/ (npm run build:pwa) served with the
// production security headers by tests/pwa/support/server.ts.
const executablePath = process.env.SOJOURNER_PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "./tests/pwa",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
});
