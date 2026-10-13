// Canonical inputs and outputs for the agent workspace (#285/#286).
import type {
  CandidateEvidenceReviewItem,
  CareerProfile,
  CareerTargetTrack,
  ResumeStatement,
  TrackedApplication,
} from "../shared/career-contracts.ts";
import type { Job } from "../shared/contracts.ts";
import type { ApplicationMaterialProjection } from "../shared/application-materials.ts";
import type {
  ResumeParseabilityGateReport,
  ResumeProjectionRecord,
  ResumeTruthGateReport,
} from "../shared/resume-contracts.ts";

/**
 * A read-only view of canonical Job Ranger data, gathered through existing services.
 * The agent workspace code never writes it back.
 */
export interface CanonicalSnapshot {
  sourceRevision: string;
  profile: CareerProfile | null;
  tracks: CareerTargetTrack[];
  evidence: CandidateEvidenceReviewItem[];
  jobs: Job[];
  applications: TrackedApplication[];
  resumes: {
    projection: ResumeProjectionRecord;
    statements: ResumeStatement[];
    truthGate: ResumeTruthGateReport;
    parseability: ResumeParseabilityGateReport | null;
  }[];
  coverLetters: ApplicationMaterialProjection[];
}

export type ExportScope =
  | "tracks"
  | "career_direction"
  | "confirmed_evidence"
  | "selected_opportunities"
  | "selected_applications"
  | "resume_templates"
  | "selected_resumes"
  | "selected_cover_letters";

export interface ExportRequest {
  exportId: string;
  /** Trusted local workspace identity (D13); agents must echo it in every batch. */
  workspaceId: string;
  createdAt: string;
  build: string;
  scopes: ExportScope[];
  selectedJobIds: string[];
  /** Explicitly selected applications (D06); unselected applications never leave. */
  selectedApplicationIds?: string[];
  selectedResumeIds: string[];
  selectedCoverLetterIds: string[];
  /** Published JSON Schema documents, copied into schema/ verbatim. */
  schemaDocuments: { path: string; text: string }[];
}

export interface ExportFile {
  path: string;
  role: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** Locally trusted record of a publication. Remote manifests are checked against it. */
export interface ExportReceipt {
  format: "jr-agent-export-receipt";
  schema_version: 2;
  export_id: string;
  workspace_id: string;
  created_at: string;
  job_ranger_build: string;
  source_revision: string;
  manifest_sha256: string;
  manifest_bytes: number;
  scopes: ExportScope[];
  files: { path: string; sha256: string; bytes: number }[];
  record_revisions: Record<string, string>;
}

export interface AgentExportResult {
  files: ExportFile[];
  manifest: Record<string, unknown>;
  manifestBytes: Uint8Array;
  manifestSha256: string;
  receipt: ExportReceipt;
}
