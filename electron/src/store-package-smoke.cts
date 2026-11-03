import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RuntimeDistributionChannel } from "../../src/shared/runtime.js";
import { SojournerBackend } from "./backend.cjs";
import { CareerBackend } from "./career-backend.cjs";
import { RequirementBackend } from "./requirement-backend.cjs";
import { BackupService, applyPendingRestore } from "./backup-service.cjs";
import { runPackagedSmoke, writePackageSmokeReport, type PackageSmokeReport } from "./package-smoke.cjs";
import { ResumeService } from "./resume-service.cjs";
import { renderResumePdf } from "./resume-renderer.cjs";
import { validateExternalUrl } from "./validators.cjs";
import { detectLegacyInstall } from "./legacy-install-ipc.cjs";
import { packageFamilyNameFromExecPath, STORE_USER_DATA_FOLDER, storeHostPath } from "./distribution.cjs";
import { encodeStoreZip } from "./portable-archive.cjs";

/** Minimal OOXML package for a non-software resume (used to exercise native DOCX import). */
function healthcareResumeDocx(): Uint8Array {
  const paragraph = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = [
    paragraph("Morgan Rivera", "Title"),
    paragraph("Experience", "Heading1"),
    paragraph("Patient Services Coordinator, Harbor Family Clinic, 2023 - Present"),
    paragraph("Coordinated patient scheduling, referrals, and insurance verification for six providers."),
    paragraph("Certifications", "Heading1"),
    paragraph("CPR/BLS, American Heart Association"),
  ].join("");
  const encoder = new TextEncoder();
  return encodeStoreZip([
    {
      name: "[Content_Types].xml",
      bytes: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      bytes: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      bytes: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    },
  ]);
}

/**
 * Packaged-runtime smoke executed by the *real Electron main process* of an
 * installed package (`Sojourner.exe --sojourner-package-smoke-report=<file>`).
 *
 * Unlike the ELECTRON_RUN_AS_NODE smoke used for the NSIS build, this runs with
 * the package's identity and file-system virtualization, so it proves the
 * Store-specific data root, bundled sqlite3.exe, migrations, Chromium PDF
 * rendering + native Anydoc parseability, and archive backup/restore under
 * AppX constraints. It never touches the user's `data` directory: everything
 * happens under a unique `package-smoke-*` folder that is removed afterwards.
 */
export interface StorePackageSmokeOptions {
  reportPath: string;
  appVersion: string;
  channel: RuntimeDistributionChannel;
  windowsStore: boolean;
  userDataDirectory: string;
  appDataDirectory: string;
  localAppDataDirectory: string | null;
  execPath: string;
  resourcesPath: string | null;
  platform: string;
}

export function parsePackageSmokeArgument(argv: readonly string[]): string | null {
  const prefix = "--sojourner-package-smoke-report=";
  const raw = argv.find((value) => value.startsWith(prefix));
  if (!raw) return null;
  const reportPath = raw.slice(prefix.length).replace(/^"|"$/g, "");
  if (!path.isAbsolute(reportPath) || !reportPath.toLowerCase().endsWith(".json")) {
    throw new Error("--sojourner-package-smoke-report must be an absolute path to a .json file");
  }
  return reportPath;
}

async function openInstallation(dataDirectory: string, appVersion: string, userDataDirectory: string) {
  const backend = new SojournerBackend({
    dataDirectory,
    schedulerEnabled: false,
    fetchImpl: async () => {
      throw new Error("Packaged smoke validation must not use the public network");
    },
  });
  await backend.initialize();
  const status = await backend.getSystemStatus(process.platform);
  const careerBackend = new CareerBackend({
    dataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
  });
  await careerBackend.initialize();
  const backups = new BackupService({
    dataDirectory,
    userDataDirectory,
    databasePath: status.databasePath,
    sqliteBinaryPath: status.sqliteBinaryPath,
    appVersion,
  });
  return { backend, careerBackend, backups, status };
}

export async function runStorePackageSmoke(options: StorePackageSmokeOptions): Promise<PackageSmokeReport> {
  const smokeRoot = path.join(options.userDataDirectory, `package-smoke-${randomUUID()}`);
  const restoreRoot = path.join(options.userDataDirectory, `package-smoke-restore-${randomUUID()}`);
  const dataDirectory = path.join(smokeRoot, "data");
  const scenarioReport = path.join(smokeRoot, "scenario-report.json");
  const extra: Record<string, boolean | number | string> = {};
  let backend: SojournerBackend | null = null;

  try {
    await fs.mkdir(dataDirectory, { recursive: true });
    const install = await openInstallation(dataDirectory, options.appVersion, smokeRoot);
    backend = install.backend;
    const requirementBackend = new RequirementBackend({
      databasePath: install.status.databasePath,
      sqliteBinaryPath: install.status.sqliteBinaryPath,
    });

    // 1. The shared non-software healthcare-operations scenario.
    const scenario = await runPackagedSmoke({
      backend: install.backend,
      careerBackend: install.careerBackend,
      requirementBackend,
      userDataDirectory: smokeRoot,
      dataDirectory,
      databasePath: install.status.databasePath,
      sqliteBinaryPath: install.status.sqliteBinaryPath,
      appVersion: options.appVersion,
      platform: options.platform,
      reportPath: scenarioReport,
    });

    // 2. Runtime/distribution facts under the package.
    extra.channel = options.channel;
    extra.windowsStore = options.windowsStore;
    extra.userDataFolder = path.basename(options.userDataDirectory);
    extra.storeDataIsolated =
      options.channel !== "microsoft-store" || path.basename(options.userDataDirectory) === STORE_USER_DATA_FOLDER;
    extra.sqliteBinary = install.status.sqliteBinaryPath;
    extra.sqliteBundled =
      options.resourcesPath !== null &&
      path.resolve(path.dirname(install.status.sqliteBinaryPath)) === path.resolve(options.resourcesPath);
    const packageFamilyName = packageFamilyNameFromExecPath(options.execPath);
    extra.packageFamilyName = packageFamilyName ?? "none";
    if (options.localAppDataDirectory) {
      extra.hostDataPath = storeHostPath(options.userDataDirectory, {
        appDataDirectory: options.appDataDirectory,
        localAppDataDirectory: options.localAppDataDirectory,
        packageFamilyName,
      });
    }
    const legacy = await detectLegacyInstall({
      channel: options.channel,
      appDataDirectory: options.appDataDirectory,
      userDataDirectory: options.userDataDirectory,
      dataDirectory,
      databasePath: install.status.databasePath,
      sqliteBinaryPath: install.status.sqliteBinaryPath,
      appVersion: options.appVersion,
    });
    extra.legacyImportApplicable = legacy.applicable;
    extra.legacyInstallFound = legacy.found;

    // 2b. Native DOCX resume import (Anydoc) inside the package.
    const docxPath = path.join(smokeRoot, "morgan-rivera-resume.docx");
    await fs.writeFile(docxPath, healthcareResumeDocx());
    const docxImport = await install.careerBackend.importResumeFile(docxPath);
    extra.docxImportParser = docxImport.artifact.parserId ?? "none";
    extra.docxImportState = docxImport.artifact.extractionState;
    extra.docxImportProposals = docxImport.proposedEvidence.length;
    extra.docxImportSucceeded =
      docxImport.failureCode === null && docxImport.proposedEvidence.length > 0;

    // 3. External navigation validation stays strict in the package.
    let rejectsFileUrl = false;
    try {
      validateExternalUrl("file:///C:/Windows/System32/calc.exe");
    } catch {
      rejectsFileUrl = true;
    }
    extra.externalNavigationValidated =
      rejectsFileUrl && validateExternalUrl("https://example.com/job") === "https://example.com/job";

    // 4. Truth-Gated resume → Chromium PDF → native parser Parseability Gate.
    const resumeService = new ResumeService({
      dataDirectory,
      databasePath: install.status.databasePath,
      sqliteBinaryPath: install.status.sqliteBinaryPath,
    });
    await resumeService.initialize();
    const evidence = await install.careerBackend.listEvidence();
    const authored = evidence
      .filter((item) => item.evidence.verificationState === "user-authored")
      .map((item) => item.evidence.id);
    const projection = await resumeService.createProjection({
      jobId: null,
      context: "private-sector",
      pageFormat: "letter",
      templateId: "ats-standard-v1",
      contact: {
        fullName: "Morgan Rivera",
        email: "morgan.rivera@example.org",
        phone: "",
        location: "Baltimore, MD",
        links: [],
      },
      selectedEvidenceIds: authored,
    });
    const prepared = await resumeService.prepareRender(projection.projection.id);
    await renderResumePdf(prepared);
    const exported = await resumeService.finalizeRenderedPdf(prepared, {
      projectionId: projection.projection.id,
      applicationId: null,
    });
    const parseability = exported.parseabilityGate;
    extra.resumeTruthGatePassed = exported.truthGate.passed;
    extra.resumeParseabilityPassed = parseability?.passed === true && exported.artifact !== null;
    extra.resumeParser = parseability ? `${parseability.parserId}@${parseability.parserVersion}` : "none";
    extra.resumePdfPages = parseability?.pageCount ?? 0;

    // 5. Portable archive round trip into a second data root.
    const archivePath = path.join(smokeRoot, "smoke-backup.sojourner");
    const archive = await install.backups.createArchive(archivePath, {
      runtime: "electron",
      channel: options.channel,
      appVersion: options.appVersion,
      buildId: `package-smoke-${options.appVersion}`,
    });
    extra.archiveBytes = archive.archive?.bytes ?? 0;
    await install.backend.dispose();
    backend = null;

    const restoreData = path.join(restoreRoot, "data");
    const target = await openInstallation(restoreData, options.appVersion, restoreRoot);
    const selection = await target.backups.validateRestoreSource(archivePath);
    await target.backups.stageRestore(selection.bundlePath);
    await target.backend.dispose();
    extra.archiveRestoreApplied = await applyPendingRestore({
      userDataDirectory: restoreRoot,
      dataDirectory: restoreData,
    });
    const restored = await openInstallation(restoreData, options.appVersion, restoreRoot);
    extra.archiveRestoredProfile = (await restored.careerBackend.getProfile())?.fullName === "Morgan Rivera";
    await restored.backend.dispose();

    const required = [
      "docxImportSucceeded",
      "storeDataIsolated",
      "externalNavigationValidated",
      "resumeTruthGatePassed",
      "resumeParseabilityPassed",
      "archiveRestoreApplied",
      "archiveRestoredProfile",
    ];
    for (const key of required) {
      if (extra[key] !== true) throw new Error(`Store package smoke check failed: ${key}`);
    }

    const report: PackageSmokeReport = {
      ...scenario,
      generatedAt: new Date().toISOString(),
      platform: options.platform,
      checks: { ...scenario.checks, ...extra },
    };
    await writePackageSmokeReport(options.reportPath, report);
    return report;
  } catch (error) {
    const report: PackageSmokeReport = {
      schemaVersion: 1,
      status: "failed",
      generatedAt: new Date().toISOString(),
      appVersion: options.appVersion,
      platform: options.platform,
      scenario: "healthcare-operations",
      checks: extra,
      error: error instanceof Error ? error.message : String(error),
    };
    await writePackageSmokeReport(options.reportPath, report);
    throw error;
  } finally {
    await backend?.dispose();
    await fs.rm(smokeRoot, { recursive: true, force: true });
    await fs.rm(restoreRoot, { recursive: true, force: true });
  }
}
