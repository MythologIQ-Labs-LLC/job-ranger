// Gathers a read-only canonical snapshot through existing Job Ranger services (#285).
// Uses only list/get methods, so the UI and a future local headless adapter share one
// path and the existing service boundaries. Nothing here writes canonical data.

import type { JobRangerDesktopApi } from "../services/api.ts";
import type { ResumeParseabilityGateReport } from "../shared/resume-contracts.ts";
import { canonicalJsonBytes, sha256Hex } from "./canonical.ts";
import type { CanonicalSnapshot } from "./types.ts";

export type SnapshotReader = {
  career: Pick<JobRangerDesktopApi["career"], "getProfile" | "listTargetTracks" | "listEvidence">;
  jobs: Pick<JobRangerDesktopApi["jobs"], "list">;
  applications: Pick<JobRangerDesktopApi["applications"], "list">;
  resume: Pick<JobRangerDesktopApi["resume"], "list" | "get">;
  applicationMaterials: Pick<JobRangerDesktopApi["applicationMaterials"], "list">;
};

function latestParseability(results: (string | null)[]): ResumeParseabilityGateReport | null {
  for (const raw of results) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<ResumeParseabilityGateReport>;
      if (typeof parsed.passed === "boolean" && typeof parsed.checkedAt === "string") return parsed as ResumeParseabilityGateReport;
    } catch {
      // Older artifacts store a plain label; treat it as an unavailable report.
    }
  }
  return null;
}

export async function gatherCanonicalSnapshot(api: SnapshotReader): Promise<CanonicalSnapshot> {
  const [profile, tracks, evidence, jobs, applications, resumeList] = await Promise.all([
    api.career.getProfile(),
    api.career.listTargetTracks(),
    api.career.listEvidence(),
    api.jobs.list(),
    api.applications.list(),
    api.resume.list(),
  ]);
  const resumes = await Promise.all(resumeList.map(async (summary) => {
    const detail = await api.resume.get(summary.id);
    const newestFirst = [...detail.artifacts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return {
      projection: detail.projection,
      statements: detail.statements,
      truthGate: detail.truthGate,
      parseability: latestParseability(newestFirst.map((a) => a.parseabilityResult)),
    };
  }));
  const coverLetters = (await Promise.all(applications.map((a) => api.applicationMaterials.list(a.id))))
    .flat()
    .filter((m) => m.kind === "cover-letter");
  const content = { profile, tracks, evidence, jobs, applications, resumes, coverLetters };
  // No global revision counter exists; the snapshot's own content digest identifies it.
  const sourceRevision = `sha256:${await sha256Hex(canonicalJsonBytes(content))}`;
  return { sourceRevision, ...content };
}
