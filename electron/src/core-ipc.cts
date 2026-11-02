import { dialog, ipcMain, shell } from "electron";
import type { RuntimeInfo } from "../../src/shared/runtime.js";
import type { JobScoutBackend } from "./backend.cjs";
import type { CareerBackend } from "./career-backend.cjs";
import type { RequirementBackend } from "./requirement-backend.cjs";
import { publicJobFeedDiscoveryProvider } from "./source-discovery-provider.cjs";
import { validateSourceDiscoveryRequest } from "./source-discovery-validator.cjs";
import { assertManagedArtifactPath } from "./managed-path-policy.cjs";
import {
  validateExternalUrl,
  validateId,
  validateIntegerInRange,
  validateCompanyDraft,
  validateCompanyUpdate,
  validateFilterDraft,
  validateFilterUpdate,
  validateSettingsUpdate,
} from "./validators.cjs";
import {
  validateApplicationUpdate,
  validateCareerEntityId,
  validateCareerProfile,
  validateEvidenceReviewUpdate,
  validateLegacyCareerMigration,
  validatePastedResumeInput,
  validateUserAuthoredEvidenceInput,
} from "./career-validators.cjs";
import { validateCareerTargetTrackInput } from "./target-track-validator.cjs";

export interface CoreIpcOptions {
  backend: JobScoutBackend;
  careerBackend: CareerBackend;
  requirementBackend: RequirementBackend;
  appVersion: string;
  platform: string;
  discoveryFetch: () => typeof fetch;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  /** Maps a managed path to the path the OS file manager sees (Store virtualization). */
  hostPath?: (managedPath: string) => string;
}

/**
 * The core Job Ranger IPC contract: channel names, boundary validation, and
 * dispatch into the shared application services. Electron registers it on the
 * real `ipcMain`; the browser runtime registers the identical table inside its
 * dedicated worker through the runtime's `electron` adapter.
 */
export function registerCoreIpcHandlers(options: CoreIpcOptions): void {
  ipcMain.handle("app:get-version", () => options.appVersion);
  ipcMain.handle("app:get-runtime-info", () => options.getRuntimeInfo());
  ipcMain.handle("app:get-platform", () => options.platform);
  ipcMain.handle("app:open-external", async (_event, url: string) => {
    await shell.openExternal(validateExternalUrl(url));
  });
  ipcMain.handle("app:show-item-in-folder", async (_event, targetPath: unknown) => {
    const safePath = assertManagedArtifactPath(
      targetPath,
      options.careerBackend.getArtifactDirectory(),
    );
    shell.showItemInFolder(options.hostPath ? options.hostPath(safePath) : safePath);
  });

  ipcMain.handle("system:get-status", () =>
    options.backend.getSystemStatus(options.platform),
  );

  ipcMain.handle("companies:list", () => options.backend.listCompanies());
  ipcMain.handle("companies:create", (_event, draft) =>
    options.backend.createCompany(validateCompanyDraft(draft)),
  );
  ipcMain.handle("companies:update", (_event, id: string, update) =>
    options.backend.updateCompany(
      validateId(id, "Company id"),
      validateCompanyUpdate(update),
    ),
  );
  ipcMain.handle("companies:delete", (_event, id: string) =>
    options.backend.deleteCompany(validateId(id, "Company id")),
  );
  ipcMain.handle("companies:run-scrape", (_event, id: string) =>
    options.backend.runCompanyScrape(validateId(id, "Company id")),
  );

  ipcMain.handle("discovery:discover", async (_event, request) => {
    const validated = validateSourceDiscoveryRequest(request);
    const [existingCompanies, runtime] = await Promise.all([
      options.backend.listCompanies(),
      options.getRuntimeInfo(),
    ]);
    return publicJobFeedDiscoveryProvider.discover(validated, {
      fetchImpl: options.discoveryFetch(),
      existingCompanies,
      runtimeKind: runtime.kind,
    });
  });

  ipcMain.handle("jobs:list", () => options.backend.listJobs());
  ipcMain.handle("jobs:mark-seen", (_event, id: string) =>
    options.backend.markJobSeen(validateId(id, "Job id")),
  );
  ipcMain.handle("jobs:get-evidence-coverage", (_event, id: string) =>
    options.requirementBackend.getJobEvidenceCoverage(validateId(id, "Job id")),
  );

  ipcMain.handle("filters:list", () => options.backend.listFilters());
  ipcMain.handle("filters:create", (_event, draft) =>
    options.backend.createFilter(validateFilterDraft(draft)),
  );
  ipcMain.handle("filters:update", (_event, id: string, update) =>
    options.backend.updateFilter(
      validateId(id, "Filter id"),
      validateFilterUpdate(update),
    ),
  );
  ipcMain.handle("filters:delete", (_event, id: string) =>
    options.backend.deleteFilter(validateId(id, "Filter id")),
  );

  ipcMain.handle("settings:get", () => options.backend.getSettings());
  ipcMain.handle("settings:update", (_event, update) =>
    options.backend.updateSettings(validateSettingsUpdate(update)),
  );

  ipcMain.handle("scrape-runs:list-recent", (_event, limit?: number) =>
    options.backend.listRecentScrapeRuns(
      limit === undefined
        ? undefined
        : validateIntegerInRange(limit, "Scrape run limit", 1, 100),
    ),
  );

  ipcMain.handle("career:get-profile", () => options.careerBackend.getProfile());
  ipcMain.handle("career:save-profile", (_event, profile) =>
    options.careerBackend.saveProfile(validateCareerProfile(profile)),
  );
  ipcMain.handle("career:list-target-tracks", () =>
    options.careerBackend.listTargetTracks(),
  );
  ipcMain.handle("career:create-target-track", (_event, input) =>
    options.careerBackend.createTargetTrack(validateCareerTargetTrackInput(input)),
  );
  ipcMain.handle("career:update-target-track", (_event, id: string, input) =>
    options.careerBackend.updateTargetTrack(
      validateCareerEntityId(id, "Target track id"),
      validateCareerTargetTrackInput(input),
    ),
  );
  ipcMain.handle("career:delete-target-track", (_event, id: string) =>
    options.careerBackend.deleteTargetTrack(
      validateCareerEntityId(id, "Target track id"),
    ),
  );
  ipcMain.handle("career:migrate-legacy", (_event, payload) =>
    options.careerBackend.migrateLegacy(validateLegacyCareerMigration(payload)),
  );
  ipcMain.handle("career:select-resume-import", async () => {
    const selection = await dialog.showOpenDialog({
      title: "Import resume or career history",
      properties: ["openFile"],
      filters: [
        { name: "Resume documents", extensions: ["docx", "pdf", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return null;
    }
    return options.careerBackend.importResumeFile(selection.filePaths[0]);
  });
  ipcMain.handle("career:import-pasted-text", (_event, input) =>
    options.careerBackend.importPastedText(validatePastedResumeInput(input)),
  );
  ipcMain.handle("career:create-user-evidence", (_event, input) =>
    options.careerBackend.createUserEvidence(validateUserAuthoredEvidenceInput(input)),
  );
  ipcMain.handle("career:list-source-artifacts", () =>
    options.careerBackend.listSourceArtifacts(),
  );
  ipcMain.handle("career:list-evidence", () =>
    options.careerBackend.listEvidence(),
  );
  ipcMain.handle("career:review-evidence", (_event, id: string, update) =>
    options.careerBackend.reviewEvidence(
      validateCareerEntityId(id, "Evidence id"),
      validateEvidenceReviewUpdate(update),
    ),
  );
  ipcMain.handle(
    "career:merge-evidence",
    (_event, sourceId: string, targetId: string) =>
      options.careerBackend.mergeEvidence(
        validateCareerEntityId(sourceId, "Source evidence id"),
        validateCareerEntityId(targetId, "Target evidence id"),
      ),
  );

  ipcMain.handle("applications:list", () =>
    options.careerBackend.listApplications(),
  );
  ipcMain.handle("applications:track", (_event, jobId: string) =>
    options.careerBackend.trackApplication(validateId(jobId, "Job id")),
  );
  ipcMain.handle("applications:update", (_event, id: string, update) =>
    options.careerBackend.updateApplication(
      validateCareerEntityId(id, "Application id"),
      validateApplicationUpdate(update),
    ),
  );
  ipcMain.handle("applications:delete", (_event, id: string) =>
    options.careerBackend.deleteApplication(
      validateCareerEntityId(id, "Application id"),
    ),
  );
}
