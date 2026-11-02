import type { DesktopApi } from "../shared/contracts";
import type { ApplicationInsightsDesktopApi } from "../shared/application-insights";
import type { ApplicationLifecycleDesktopApi } from "../shared/application-lifecycle";
import type { ApplicationMaterialsDesktopApi } from "../shared/application-materials";
import type { BackupDesktopApi } from "../shared/backup";
import type { CareerStoriesDesktopApi } from "../shared/career-stories";
import type { PersonalBrandDesktopApi } from "../shared/personal-brand-api";
import type { EvidenceExtensionDesktopApi } from "../shared/evidence-extensions";
import type { InterviewPrepDesktopApi } from "../shared/interview-prep";
import type { JsonResumeDesktopApi } from "../shared/json-resume";
import type { ResumeDesktopApi } from "../shared/resume-api";
import type { SourceDiscoveryDesktopApi } from "../shared/source-discovery";
import type { RuntimeDesktopApi } from "../shared/runtime";
import type { LegacyInstallDesktopApi } from "../shared/legacy-install";

export type JobRangerDesktopApi = DesktopApi &
  ResumeDesktopApi &
  EvidenceExtensionDesktopApi &
  SourceDiscoveryDesktopApi &
  ApplicationLifecycleDesktopApi &
  InterviewPrepDesktopApi &
  CareerStoriesDesktopApi &
  PersonalBrandDesktopApi &
  ApplicationMaterialsDesktopApi &
  BackupDesktopApi &
  ApplicationInsightsDesktopApi &
  JsonResumeDesktopApi &
  RuntimeDesktopApi &
  LegacyInstallDesktopApi;

export class DesktopApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopApiError";
  }
}

export function hasDesktopApi(): boolean {
  return typeof window !== "undefined" && typeof window.electronAPI !== "undefined";
}

export function getDesktopApi(): JobRangerDesktopApi {
  if (!hasDesktopApi()) {
    throw new DesktopApiError(
      "Sojourner requires the Electron desktop shell. Use `npm run electron:dev` for local development.",
    );
  }

  return window.electronAPI;
}
