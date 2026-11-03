import path from "node:path";
import { SojournerBackend } from "./backend.cjs";
import { CareerBackend } from "./career-backend.cjs";
import { RequirementBackend } from "./requirement-backend.cjs";
import { runPackagedSmoke, writePackageSmokeReport } from "./package-smoke.cjs";

async function run(): Promise<void> {
  const userDataDirectory = process.env.SOJOURNER_PACKAGE_SMOKE_USER_DATA?.trim();
  if (!userDataDirectory) {
    throw new Error("SOJOURNER_PACKAGE_SMOKE_USER_DATA is required for packaged smoke validation");
  }

  const appVersion = process.env.SOJOURNER_PACKAGE_SMOKE_VERSION?.trim() || "unknown";
  const reportPath =
    process.env.SOJOURNER_PACKAGE_SMOKE_REPORT?.trim() ||
    path.join(userDataDirectory, "package-smoke-result.json");
  const dataDirectory = path.join(userDataDirectory, "data");

  const backend = new SojournerBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error("Packaged smoke validation must not use the public network");
    },
  });

  try {
    await backend.initialize();
    const status = await backend.getSystemStatus(process.platform);
    const careerBackend = new CareerBackend({
      dataDirectory,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });
    await careerBackend.initialize();
    const requirementBackend = new RequirementBackend({
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
    });

    const report = await runPackagedSmoke({
      backend,
      careerBackend,
      requirementBackend,
      userDataDirectory,
      dataDirectory,
      databasePath: status.databasePath,
      sqliteBinaryPath: status.sqliteBinaryPath,
      appVersion,
      platform: process.platform,
      reportPath,
    });

    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await writePackageSmokeReport(reportPath, {
        schemaVersion: 1,
        status: "failed",
        generatedAt: new Date().toISOString(),
        appVersion,
        platform: process.platform,
        scenario: "healthcare-operations",
        checks: {},
        error: message,
      });
    } catch {
      // Preserve the original failure when even the report path is unavailable.
    }
    throw error;
  } finally {
    await backend.dispose();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
