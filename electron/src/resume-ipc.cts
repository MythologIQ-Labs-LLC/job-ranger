import { ipcMain } from "electron";
import type { ResumeExportRequest } from "../../src/shared/resume-contracts.js";
import { ResumeService } from "./resume-service.cjs";
import { ResumeTailoringService } from "./resume-tailoring-service.cjs";
import { renderResumePdf } from "./resume-renderer.cjs";
import {
  validateResumeCreateInput,
  validateResumeExportRequest,
  validateResumeStatementUpdate,
  validateResumeTailoringApplyRequest,
  validateResumeTailoringPreviewRequest,
} from "./resume-validators.cjs";
import { validateCareerEntityId } from "./career-validators.cjs";

interface ResumeIpcOptions {
  dataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
}

export async function initializeResumeIpc(
  options: ResumeIpcOptions,
): Promise<ResumeService> {
  const service = new ResumeService(options);
  const tailoringService = new ResumeTailoringService(options);
  await service.initialize();

  ipcMain.handle("resume:list", () => service.listProjections());
  ipcMain.handle("resume:create", (_event, input) =>
    service.createProjection(validateResumeCreateInput(input)),
  );
  ipcMain.handle("resume:get", (_event, id: string) =>
    service.getProjectionDetail(validateCareerEntityId(id, "Resume projection id")),
  );
  ipcMain.handle("resume:update-statement", (_event, id: string, update) =>
    service.updateStatement(
      validateCareerEntityId(id, "Resume statement id"),
      validateResumeStatementUpdate(update),
    ),
  );
  ipcMain.handle("resume:preview-tailoring", (_event, request) =>
    tailoringService.preview(validateResumeTailoringPreviewRequest(request)),
  );
  ipcMain.handle("resume:apply-tailoring", async (_event, request) => {
    const projection = await tailoringService.apply(
      validateResumeTailoringApplyRequest(request),
    );
    return service.getProjectionDetail(projection.id);
  });
  ipcMain.handle("resume:export-pdf", async (_event, rawRequest) => {
    const request: ResumeExportRequest = validateResumeExportRequest(rawRequest);
    const prepared = await service.prepareRender(request.projectionId);
    await renderResumePdf(prepared);
    return service.finalizeRenderedPdf(prepared, request);
  });
  ipcMain.handle("resume:read-verified-artifact-for-export", (_event, artifactId: string) =>
    service.readVerifiedArtifactForExport(validateCareerEntityId(artifactId, "Resume artifact id")),
  );
  ipcMain.handle(
    "resume:compare-versions",
    (_event, fromArtifactId: string, toArtifactId: string) =>
      service.compareArtifacts(
        validateCareerEntityId(fromArtifactId, "From resume artifact id"),
        validateCareerEntityId(toArtifactId, "To resume artifact id"),
      ),
  );

  return service;
}
