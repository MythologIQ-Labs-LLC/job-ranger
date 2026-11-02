import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ApplicationUpdate,
  CandidateEvidence,
  CandidateEvidenceReviewItem,
  CareerProfile,
  CareerTargetTrack,
  CareerTargetTrackInput,
  EvidenceReviewUpdate,
  ExtractionSnapshot,
  LegacyCareerMigration,
  PastedResumeInput,
  ResumeImportFailureCode,
  ResumeImportResult,
  SourceArtifact,
  SourceArtifactExtractionState,
  TrackedApplication,
  UserAuthoredEvidenceInput,
} from "../../src/shared/contracts.js";
import { CareerRepository } from "./career-repository.cjs";
import { CareerEvidenceRepository } from "./career-evidence-repository.cjs";
import { normalizeEvidenceProposals } from "./evidence-normalizer.cjs";
import {
  extractResumeDocument,
  RESUME_PARSER_ID,
  RESUME_PARSER_VERSION,
  ResumeParserError,
} from "./resume-parser.cjs";
import { SqliteClient } from "./sqlite.cjs";
import { replaceNul, unreadableCharactersWarning } from "./nul-text.cjs";

interface CareerBackendOptions {
  dataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
}

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const NATIVE_TEXT_PARSER_ID = "job-ranger/native-text";
const NATIVE_TEXT_PARSER_VERSION = "1";

function cleanList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function cleanOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizeProfile(profile: CareerProfile): CareerProfile {
  const minimumPay =
    profile.minimumPay === null || Number.isNaN(profile.minimumPay)
      ? null
      : profile.payBasis === "annual"
        ? Math.max(0, Math.round(profile.minimumPay))
        : Math.max(0, Math.round(profile.minimumPay * 100) / 100);

  return {
    version: 2,
    fullName: profile.fullName.trim(),
    homeLocation: profile.homeLocation.trim(),
    radiusMiles:
      profile.radiusMiles === null || Number.isNaN(profile.radiusMiles)
        ? null
        : Math.max(0, Math.round(profile.radiusMiles)),
    minimumPay,
    payBasis: profile.payBasis === "annual" ? "annual" : "hourly",
    targetTitles: cleanList(profile.targetTitles),
    skills: cleanList(profile.skills),
    certifications: cleanList(profile.certifications),
    sectors: cleanList(profile.sectors),
    onCallPreference: profile.onCallPreference,
    fullTimeOnly: profile.fullTimeOnly,
    updatedAt: new Date().toISOString(),
  };
}

function extensionFormat(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".docx") return "docx";
  if (extension === ".pdf") return "pdf";
  if (extension === ".txt") return "txt";
  return extension ? extension.slice(1) : null;
}

function mediaTypeFor(format: string | null): string {
  switch (format) {
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function artifactStateForFailure(
  failureCode: ResumeImportFailureCode,
): SourceArtifactExtractionState {
  switch (failureCode) {
    case "ocr-required":
      return "needs-ocr";
    case "encrypted":
      return "encrypted";
    case "malformed":
      return "malformed";
    case "unsupported":
      return "unsupported";
    case "resource-limit":
      return "resource-limited";
    case "parser-failure":
      return "failed";
  }
}

function failureCodeForArtifact(
  state: SourceArtifactExtractionState,
): ResumeImportFailureCode | null {
  switch (state) {
    case "needs-ocr":
      return "ocr-required";
    case "encrypted":
      return "encrypted";
    case "malformed":
      return "malformed";
    case "unsupported":
      return "unsupported";
    case "resource-limited":
      return "resource-limit";
    case "failed":
      return "parser-failure";
    default:
      return null;
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeOriginalName(label: string): string {
  const cleaned = label.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ");
  return cleaned || "Pasted career evidence";
}

export class CareerBackend {
  private readonly sqlite: SqliteClient;
  private readonly repository: CareerRepository;
  private readonly evidenceRepository: CareerEvidenceRepository;
  private readonly artifactsDirectory: string;
  private readonly sourceArtifactsDirectory: string;

  constructor(options: CareerBackendOptions) {
    this.sqlite = new SqliteClient(
      options.databasePath,
      options.sqliteBinaryPath,
    );
    this.repository = new CareerRepository(this.sqlite);
    this.evidenceRepository = new CareerEvidenceRepository(this.sqlite);
    this.artifactsDirectory = path.join(options.dataDirectory, "artifacts");
    this.sourceArtifactsDirectory = path.join(
      this.artifactsDirectory,
      "sources",
    );
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.sourceArtifactsDirectory, { recursive: true });
  }

  getArtifactDirectory(): string {
    return this.artifactsDirectory;
  }

  async getProfile(): Promise<CareerProfile | null> {
    return this.repository.getProfile();
  }

  async saveProfile(profile: CareerProfile): Promise<CareerProfile> {
    return this.repository.saveProfile(normalizeProfile(profile));
  }

  async listTargetTracks(): Promise<CareerTargetTrack[]> {
    return this.repository.listTargetTracks();
  }

  async createTargetTrack(input: CareerTargetTrackInput): Promise<CareerTargetTrack> {
    return this.repository.createTargetTrack(input);
  }

  async updateTargetTrack(
    id: string,
    input: CareerTargetTrackInput,
  ): Promise<CareerTargetTrack> {
    return this.repository.updateTargetTrack(id, input);
  }

  async deleteTargetTrack(id: string): Promise<void> {
    if (id === "legacy-default") {
      throw new Error(
        "The Career Profile bridge cannot be deleted until the legacy profile transition is retired.",
      );
    }
    await this.repository.deleteTargetTrack(id);
  }

  async listApplications(): Promise<TrackedApplication[]> {
    return this.repository.listApplications();
  }

  async trackApplication(jobId: string): Promise<TrackedApplication> {
    return this.repository.createApplicationFromJob(jobId);
  }

  async updateApplication(
    id: string,
    update: ApplicationUpdate,
  ): Promise<TrackedApplication> {
    return this.repository.updateApplication(id, update);
  }

  async deleteApplication(id: string): Promise<void> {
    await this.repository.deleteApplication(id);
  }

  async migrateLegacy(payload: LegacyCareerMigration): Promise<void> {
    const existingProfile = await this.repository.getProfile();
    if (!existingProfile && payload.profile) {
      await this.repository.saveProfile(normalizeProfile(payload.profile));
    }

    for (const application of payload.applications) {
      await this.repository.importLegacyApplication(application);
    }
  }

  async listSourceArtifacts(): Promise<SourceArtifact[]> {
    return this.evidenceRepository.listSourceArtifacts();
  }

  async listEvidence(): Promise<CandidateEvidenceReviewItem[]> {
    return this.evidenceRepository.listEvidenceReviewItems();
  }

  async createUserEvidence(
    input: UserAuthoredEvidenceInput,
  ): Promise<CandidateEvidence> {
    const now = new Date().toISOString();
    return this.evidenceRepository.createUserAuthoredEvidence({
      id: `evidence-${randomUUID()}`,
      subjectType: input.subjectType,
      organization: cleanOptional(input.organization),
      titleOrName: cleanOptional(input.titleOrName),
      startDate: cleanOptional(input.startDate),
      endDate: cleanOptional(input.endDate),
      statement: input.statement.trim(),
      action: null,
      context: null,
      skills: cleanList(input.skills ?? []),
      methodsOrTools: cleanList(input.methodsOrTools ?? []),
      scope: cleanList(input.scope ?? []),
      outcomes: cleanList(input.outcomes ?? []),
      metrics: cleanList(input.metrics ?? []),
      credential: input.subjectType === "credential" ? input.credential ?? null : null,
      verificationState: "user-authored",
      confidence: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async reviewEvidence(
    id: string,
    update: EvidenceReviewUpdate,
  ): Promise<CandidateEvidence> {
    return this.evidenceRepository.reviewEvidence(id, update);
  }

  async mergeEvidence(
    sourceId: string,
    targetId: string,
  ): Promise<CandidateEvidence> {
    return this.evidenceRepository.mergeEvidence(sourceId, targetId);
  }

  async importPastedText(input: PastedResumeInput): Promise<ResumeImportResult> {
    const artifactId = `artifact-${randomUUID()}`;
    const artifactDirectory = path.join(this.sourceArtifactsDirectory, artifactId);
    const managedPath = path.join(artifactDirectory, "source.txt");
    await fs.mkdir(artifactDirectory, { recursive: true });
    await fs.writeFile(managedPath, input.text, "utf8");
    return this.importPreservedArtifact({
      artifactId,
      artifactDirectory,
      managedPath,
      originalName: `${safeOriginalName(input.label)}.txt`,
      detectedFormat: "txt",
    });
  }

  async importResumeFile(filePath: string): Promise<ResumeImportResult> {
    const sourceStats = await fs.stat(filePath);
    if (!sourceStats.isFile()) {
      throw new Error("Resume import source must be a file");
    }

    const artifactId = `artifact-${randomUUID()}`;
    const artifactDirectory = path.join(this.sourceArtifactsDirectory, artifactId);
    const detectedFormat = extensionFormat(filePath);
    const managedExtension = detectedFormat ? `.${detectedFormat}` : ".bin";
    const managedPath = path.join(artifactDirectory, `source${managedExtension}`);
    await fs.mkdir(artifactDirectory, { recursive: true });
    await fs.copyFile(filePath, managedPath);

    return this.importPreservedArtifact({
      artifactId,
      artifactDirectory,
      managedPath,
      originalName: path.basename(filePath),
      detectedFormat,
    });
  }

  private async duplicateResult(
    artifact: SourceArtifact,
  ): Promise<ResumeImportResult> {
    const extractionSnapshot =
      await this.evidenceRepository.getLatestExtractionSnapshot(artifact.id);
    const proposedEvidence =
      await this.evidenceRepository.listEvidenceForArtifact(artifact.id);
    const failureCode = failureCodeForArtifact(artifact.extractionState);
    return {
      artifact,
      extractionSnapshot,
      proposedEvidence,
      duplicate: true,
      failureCode,
      message: failureCode
        ? artifact.warnings[0] ?? "This file was already imported with the same result."
        : "This file was already imported. Existing evidence was reused.",
    };
  }

  private async importPreservedArtifact(input: {
    artifactId: string;
    artifactDirectory: string;
    managedPath: string;
    originalName: string;
    detectedFormat: string | null;
  }): Promise<ResumeImportResult> {
    const bytes = await fs.readFile(input.managedPath);
    const contentHash = hashBytes(bytes);
    const duplicate =
      await this.evidenceRepository.getSourceArtifactByHash(contentHash);
    if (duplicate) {
      await fs.rm(input.artifactDirectory, { recursive: true, force: true });
      return this.duplicateResult(duplicate);
    }

    const importedAt = new Date().toISOString();
    let artifact = await this.evidenceRepository.createSourceArtifact({
      id: input.artifactId,
      kind: "resume",
      originalName: input.originalName,
      mediaType: mediaTypeFor(input.detectedFormat),
      detectedFormat: input.detectedFormat,
      contentHash,
      managedPath: input.managedPath,
      byteSize: bytes.byteLength,
      importedAt,
      parserId: null,
      parserVersion: null,
      extractionState: "pending",
      warnings: [],
    });

    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      const message = "This file was preserved, but it exceeds the 25 MiB local resume parsing limit.";
      artifact = await this.evidenceRepository.updateSourceArtifactExtraction(
        artifact.id,
        {
          detectedFormat: input.detectedFormat,
          parserId: null,
          parserVersion: null,
          extractionState: "resource-limited",
          warnings: [message],
        },
      );
      return {
        artifact,
        extractionSnapshot: null,
        proposedEvidence: [],
        duplicate: false,
        failureCode: "resource-limit",
        message,
      };
    }

    if (
      input.detectedFormat !== "docx" &&
      input.detectedFormat !== "pdf" &&
      input.detectedFormat !== "txt"
    ) {
      const message = "R1 resume import supports DOCX, text-bearing PDF, plain text, and pasted text.";
      artifact = await this.evidenceRepository.updateSourceArtifactExtraction(
        artifact.id,
        {
          detectedFormat: input.detectedFormat,
          parserId: null,
          parserVersion: null,
          extractionState: "unsupported",
          warnings: [message],
        },
      );
      return {
        artifact,
        extractionSnapshot: null,
        proposedEvidence: [],
        duplicate: false,
        failureCode: "unsupported",
        message,
      };
    }

    let rawText: string;
    let parserId: string;
    let parserVersion: string;
    let detectedFormat = input.detectedFormat;
    let warnings: string[] = [];

    try {
      if (input.detectedFormat === "txt") {
        // A UTF-16 file decoded as UTF-8 is full of NUL; show each as U+FFFD with a warning (#297).
        const decoded = replaceNul(bytes.toString("utf8"));
        rawText = decoded.text;
        if (decoded.replaced > 0) warnings.push(unreadableCharactersWarning(decoded.replaced));
        parserId = NATIVE_TEXT_PARSER_ID;
        parserVersion = NATIVE_TEXT_PARSER_VERSION;
        if (!rawText.trim()) {
          throw new ResumeParserError(
            "The text source is empty and contains no career evidence to review.",
            "malformed",
          );
        }
      } else {
        const parsed = await extractResumeDocument(input.managedPath);
        rawText = parsed.rawText;
        parserId = parsed.parserId;
        parserVersion = parsed.parserVersion;
        detectedFormat = parsed.detectedFormat;
        warnings = parsed.warnings;
      }
    } catch (error) {
      const parserError =
        error instanceof ResumeParserError
          ? error
          : new ResumeParserError(
              error instanceof Error ? error.message : "Resume parsing failed unexpectedly.",
              "parser-failure",
            );
      artifact = await this.evidenceRepository.updateSourceArtifactExtraction(
        artifact.id,
        {
          detectedFormat,
          parserId:
            input.detectedFormat === "txt" ? NATIVE_TEXT_PARSER_ID : RESUME_PARSER_ID,
          parserVersion:
            input.detectedFormat === "txt"
              ? NATIVE_TEXT_PARSER_VERSION
              : RESUME_PARSER_VERSION,
          extractionState: artifactStateForFailure(parserError.code),
          warnings: [parserError.message],
        },
      );
      return {
        artifact,
        extractionSnapshot: null,
        proposedEvidence: [],
        duplicate: false,
        failureCode: parserError.code,
        message: parserError.message,
      };
    }

    const snapshot: ExtractionSnapshot =
      await this.evidenceRepository.createExtractionSnapshot({
        id: `snapshot-${randomUUID()}`,
        sourceArtifactId: artifact.id,
        parserId,
        parserVersion,
        rawText,
        structuredPayload: { normalizationVersion: 1 },
        warnings,
        createdAt: new Date().toISOString(),
      });

    const proposals = normalizeEvidenceProposals(rawText);
    const proposedEvidence: CandidateEvidence[] = [];
    for (const proposal of proposals) {
      const createdAt = new Date().toISOString();
      const evidence = await this.evidenceRepository.createEvidenceProposal(
        {
          id: `evidence-${randomUUID()}`,
          subjectType: proposal.subjectType,
          organization: null,
          titleOrName: null,
          startDate: null,
          endDate: null,
          statement: proposal.statement,
          action: null,
          context: proposal.context,
          skills: [],
          methodsOrTools: [],
          scope: [],
          outcomes: [],
          metrics: [],
          verificationState: "imported",
          confidence: proposal.confidence,
          createdAt,
          updatedAt: createdAt,
        },
        {
          sourceArtifactId: artifact.id,
          extractionSnapshotId: snapshot.id,
          sourceLocator: proposal.sourceLocator,
          sourceText: proposal.sourceText,
          relation: "extracted",
        },
      );
      proposedEvidence.push(evidence);
    }

    artifact = await this.evidenceRepository.updateSourceArtifactExtraction(
      artifact.id,
      {
        detectedFormat,
        parserId,
        parserVersion,
        extractionState:
          proposedEvidence.length > 0 ? "review-required" : "extracted",
        warnings,
      },
    );

    return {
      artifact,
      extractionSnapshot: snapshot,
      proposedEvidence,
      duplicate: false,
      failureCode: null,
      message:
        proposedEvidence.length > 0
          ? `${proposedEvidence.length} extracted statement${proposedEvidence.length === 1 ? "" : "s"} need your review before they become confirmed career evidence.`
          : "The source was preserved and extracted, but no reviewable statements were found.",
    };
  }
}
