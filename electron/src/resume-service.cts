import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CandidateEvidence,
  ResumeStatement,
} from "../../src/shared/contracts.js";
import type {
  ResumeCreateInput,
  ResumeExportRequest,
  ResumeExportResult,
  ResumeParseabilityGateReport,
  ResumeParseabilityIssue,
  ResumeProjectionDetail,
  ResumeProjectionRecord,
  ResumeStatementUpdate,
  ResumeTruthGateReport,
  ResumeTruthIssue,
  ResumeVersionDiff,
} from "../../src/shared/resume-contracts.js";
import { canEvidenceSupportFactualClaim } from "../../src/shared/career-contracts.js";
import { CareerEvidenceRepository } from "./career-evidence-repository.cjs";
import { ResumeRepository } from "./resume-repository.cjs";
import {
  extractResumeDocument,
  RESUME_PARSER_ID,
  RESUME_PARSER_VERSION,
} from "./resume-parser.cjs";
import { SqliteClient } from "./sqlite.cjs";
import { normalizedParseabilityText, parseabilityTokens } from "./parseability-text.cjs";
import {
  buildTruthEvidenceIndex,
  unsupportedTruthTokens,
} from "./truth-gate-tokens.cjs";

interface ResumeServiceOptions {
  dataDirectory: string;
  databasePath: string;
  sqliteBinaryPath: string;
}

export interface PreparedResumeRender {
  projection: ResumeProjectionRecord;
  statements: ResumeStatement[];
  truthGate: ResumeTruthGateReport;
  html: string;
  temporaryPath: string;
}

const sectionOrder = [
  "Experience",
  "Skills",
  "Certifications",
  "Education",
  "Projects",
  "Publications",
  "Additional",
];

function sectionForEvidence(evidence: CandidateEvidence): string {
  switch (evidence.subjectType) {
    case "role":
    case "achievement":
      return "Experience";
    case "skill":
      return "Skills";
    case "credential":
      return "Certifications";
    case "education":
      return "Education";
    case "project":
      return "Projects";
    case "publication":
      return "Publications";
    default:
      return "Additional";
  }
}

function compareEvidence(a: CandidateEvidence, b: CandidateEvidence): number {
  const aDate = a.startDate ?? a.endDate ?? a.updatedAt;
  const bDate = b.startDate ?? b.endDate ?? b.updatedAt;
  return bDate.localeCompare(aDate);
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateContact(
  input: ResumeCreateInput["contact"],
): ResumeCreateInput["contact"] {
  const contact = {
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    location: input.location.trim(),
    links: Array.from(
      new Set(input.links.map((item) => item.trim()).filter(Boolean)),
    ),
  };
  if (!contact.fullName) throw new Error("A resume needs your name.");
  if (!contact.email && !contact.phone) {
    throw new Error("A resume needs at least an email address or phone number.");
  }
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    throw new Error("Resume email address is invalid.");
  }
  return contact;
}

function safeTemplateCss(
  templateId: ResumeProjectionRecord["templateId"],
): string {
  const compact = templateId === "ats-compact-v1";
  return `
    @page { size: auto; margin: ${compact ? "0.42in" : "0.55in"}; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: ${compact ? "9.5pt" : "10.5pt"}; line-height: ${compact ? "1.28" : "1.38"}; }
    main { width: 100%; }
    header { border-bottom: 1.5px solid #222; padding-bottom: ${compact ? "6px" : "9px"}; margin-bottom: ${compact ? "10px" : "14px"}; }
    h1 { font-size: ${compact ? "19pt" : "22pt"}; line-height: 1.1; margin: 0 0 5px; }
    .contact { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 9pt; }
    section { break-inside: avoid; margin: 0 0 ${compact ? "9px" : "13px"}; }
    h2 { font-size: ${compact ? "10.5pt" : "11.5pt"}; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #777; margin: 0 0 5px; padding-bottom: 2px; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 0 0 ${compact ? "2px" : "4px"}; }
    p { margin: 0 0 4px; }
  `;
}

function renderResumeHtml(
  projection: ResumeProjectionRecord,
  statements: ResumeStatement[],
): string {
  const contactItems = [
    projection.contact.email,
    projection.contact.phone,
    projection.contact.location,
    ...projection.contact.links,
  ].filter(Boolean);

  const sections = projection.sections
    .map((section) => {
      const items = statements.filter(
        (statement) => statement.section === section,
      );
      if (items.length === 0) return "";
      return `<section><h2>${htmlEscape(section)}</h2><ul>${items
        .map((item) => `<li>${htmlEscape(item.text)}</li>`)
        .join("")}</ul></section>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>${safeTemplateCss(projection.templateId)}</style></head><body><main><header><h1>${htmlEscape(projection.contact.fullName)}</h1><div class="contact">${contactItems.map((item) => `<span>${htmlEscape(item)}</span>`).join("")}</div></header>${sections}</main></body></html>`;

  if (
    /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*0(?:\D|$)/i.test(
      html,
    )
  ) {
    throw new Error("Resume template contains hidden-content styling.");
  }
  return html;
}

function countPdfPages(bytes: Uint8Array): number | null {
  const matches = new TextDecoder("latin1")
    .decode(bytes)
    .match(/\/Type\s*\/Page(?!s)\b/g);
  return matches?.length ? matches.length : null;
}

export class ResumeService {
  private readonly sqlite: SqliteClient;
  private readonly evidenceRepository: CareerEvidenceRepository;
  private readonly repository: ResumeRepository;
  private readonly resumeDirectory: string;

  constructor(options: ResumeServiceOptions) {
    this.sqlite = new SqliteClient(
      options.databasePath,
      options.sqliteBinaryPath,
    );
    this.evidenceRepository = new CareerEvidenceRepository(this.sqlite);
    this.repository = new ResumeRepository(this.sqlite);
    this.resumeDirectory = path.join(
      options.dataDirectory,
      "artifacts",
      "resumes",
    );
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.resumeDirectory, { recursive: true });
  }

  /**
   * Read only a previously truth/parseability-verified, managed PDF artifact.
   * No arbitrary filesystem path is accepted from the web page or an agent.
   * Source hash is checked again immediately before bytes enter a Drive consent preview.
   */
  async readVerifiedArtifactForExport(artifactId: string): Promise<{
    artifactId: string; projectionId: string; revision: string; fileName: string;
    mimeType: "application/pdf"; contentHash: string; bytes: Uint8Array;
  }> {
    const artifact = await this.repository.getArtifact(artifactId);
    if (!artifact || artifact.format !== "pdf" ||
        typeof artifact.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(artifact.contentHash)) {
      throw new Error("Only an existing verified resume PDF can be exported.");
    }
    let truth: { passed?: unknown }, parseability: { passed?: unknown };
    try {
      truth = JSON.parse(artifact.truthGateResult ?? "null");
      parseability = JSON.parse(artifact.parseabilityResult ?? "null");
    } catch {
      throw new Error("Resume artifact verification record is invalid.");
    }
    if (!truth || truth.passed !== true || !parseability || parseability.passed !== true) {
      throw new Error("The saved resume did not pass both export gates.");
    }
    const resolved = path.resolve(artifact.managedPath);
    const root = path.resolve(this.resumeDirectory);
    if (!resolved.startsWith(root + path.sep) || path.extname(resolved).toLowerCase() !== ".pdf") {
      throw new Error("Resume artifact is outside Sojourner's managed PDF directory.");
    }
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 5 * 1024 * 1024) {
      throw new Error("This verified resume exceeds the supported 5 MB Drive export limit or is not a regular PDF.");
    }
    const bytes = await fs.readFile(resolved);
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash) {
      throw new Error("Saved resume PDF bytes do not match the verified artifact digest.");
    }
    return { artifactId: artifact.id, projectionId: artifact.projectionId,
      revision: String(artifact.version), fileName: path.basename(resolved),
      mimeType: "application/pdf", contentHash: artifact.contentHash,
      bytes: Uint8Array.from(bytes) };
  }

  async createProjection(
    input: ResumeCreateInput,
  ): Promise<ResumeProjectionDetail> {
    const contact = validateContact(input.contact);
    const reviewItems = await this.evidenceRepository.listEvidenceReviewItems();
    const selectedIds = Array.from(new Set(input.selectedEvidenceIds));
    const selected = reviewItems
      .map((item) => item.evidence)
      .filter((evidence) => selectedIds.includes(evidence.id));

    if (selected.length === 0) {
      throw new Error("Select at least one confirmed Career Evidence item.");
    }
    const unsupported = selected.filter(
      (item) => !canEvidenceSupportFactualClaim(item),
    );
    if (unsupported.length > 0) {
      throw new Error(
        "Only user-confirmed or user-authored Career Evidence can enter a resume.",
      );
    }
    if (selected.length !== selectedIds.length) {
      throw new Error(
        "One or more selected Career Evidence records no longer exist.",
      );
    }

    const ordered = [...selected].sort((a, b) => {
      const sectionDifference =
        sectionOrder.indexOf(sectionForEvidence(a)) -
        sectionOrder.indexOf(sectionForEvidence(b));
      return sectionDifference || compareEvidence(a, b);
    });
    const sections = sectionOrder.filter((section) =>
      ordered.some((evidence) => sectionForEvidence(evidence) === section),
    );
    const id = `resume-projection-${randomUUID()}`;
    const now = new Date().toISOString();
    const projection: ResumeProjectionRecord = {
      id,
      jobId: input.jobId,
      context: input.context,
      pageFormat: input.pageFormat,
      sourceProjectionId: null,
      status: "draft",
      sections,
      selectedEvidenceIds: ordered.map((item) => item.id),
      templateId: input.templateId,
      contact,
      createdAt: now,
      updatedAt: now,
    };
    const statements: ResumeStatement[] = ordered.map((evidence, index) => ({
      id: `resume-statement-${randomUUID()}`,
      projectionId: id,
      section: sectionForEvidence(evidence),
      order: index,
      text: evidence.statement.trim(),
      evidenceIds: [evidence.id],
      generationMode: "deterministic",
      userEdited: false,
    }));

    await this.repository.createProjection(projection, statements);
    return this.getProjectionDetail(id);
  }

  async listProjections(): Promise<ResumeProjectionRecord[]> {
    return this.repository.listProjections();
  }

  async getProjectionDetail(id: string): Promise<ResumeProjectionDetail> {
    const projection = await this.repository.getProjection(id);
    if (!projection) throw new Error(`Resume projection ${id} not found`);
    const statements = await this.repository.listStatements(id);
    const reviewItems = await this.evidenceRepository.listEvidenceReviewItems();
    const evidence = reviewItems
      .map((item) => item.evidence)
      .filter((item) => projection.selectedEvidenceIds.includes(item.id));
    return {
      projection,
      statements,
      evidence,
      truthGate: this.evaluateTruth(projection, statements, evidence),
      artifacts: await this.repository.listArtifacts(id),
    };
  }

  async updateStatement(
    id: string,
    update: ResumeStatementUpdate,
  ): Promise<ResumeStatement> {
    const text = update.text.trim();
    if (!text) throw new Error("Resume statement cannot be empty.");
    if (text.length > 1000) throw new Error("Resume statement is too long.");
    return this.repository.updateStatement(id, text);
  }

  evaluateTruth(
    _projection: ResumeProjectionRecord,
    statements: ResumeStatement[],
    evidence: CandidateEvidence[],
  ): ResumeTruthGateReport {
    const byId = new Map(evidence.map((item) => [item.id, item]));
    const issues: ResumeTruthIssue[] = [];

    for (const statement of statements) {
      const resolved = statement.evidenceIds.map((id) => byId.get(id));
      const missing = statement.evidenceIds.filter((id) => !byId.has(id));
      const unconfirmed = resolved
        .filter((item): item is CandidateEvidence => Boolean(item))
        .filter((item) => !canEvidenceSupportFactualClaim(item))
        .map((item) => item.id);
      if (missing.length > 0 || statement.evidenceIds.length === 0) {
        issues.push({
          statementId: statement.id,
          code: "missing-evidence",
          message:
            "This statement is not linked to supporting Career Evidence.",
          evidenceIds: missing,
        });
      }
      if (unconfirmed.length > 0) {
        issues.push({
          statementId: statement.id,
          code: "unconfirmed-evidence",
          message:
            "This statement relies on Career Evidence that has not been confirmed.",
          evidenceIds: unconfirmed,
        });
      }

      if (statement.userEdited && resolved.length > 0) {
        const allowed = buildTruthEvidenceIndex(
          resolved
            .flatMap((item) =>
              item
                ? [
                    item.statement,
                    item.organization ?? "",
                    item.titleOrName ?? "",
                    ...item.skills,
                    ...item.methodsOrTools,
                    ...item.scope,
                    ...item.outcomes,
                    ...item.metrics,
                  ]
                : [],
            )
            .join(" "),
        );
        const unsupported = unsupportedTruthTokens(statement.text, allowed);
        if (unsupported.length > 0) {
          issues.push({
            statementId: statement.id,
            code: "unsupported-edit",
            message: `Edited text introduces unsupported factual terms: ${unsupported
              .slice(0, 8)
              .join(", ")}.`,
            evidenceIds: statement.evidenceIds,
          });
        }
      }
    }

    return {
      passed: issues.length === 0,
      checkedAt: new Date().toISOString(),
      issues,
    };
  }

  async prepareRender(projectionId: string): Promise<PreparedResumeRender> {
    const detail = await this.getProjectionDetail(projectionId);
    if (!detail.truthGate.passed) {
      throw new Error(
        "Truth Gate failed. Resolve unsupported resume statements before export.",
      );
    }
    const version = await this.repository.nextArtifactVersion(projectionId);
    return {
      projection: detail.projection,
      statements: detail.statements,
      truthGate: detail.truthGate,
      html: renderResumeHtml(detail.projection, detail.statements),
      temporaryPath: path.join(
        this.resumeDirectory,
        `.${projectionId}-v${version}-${randomUUID()}.pdf`,
      ),
    };
  }

  async finalizeRenderedPdf(
    prepared: PreparedResumeRender,
    request: ResumeExportRequest,
  ): Promise<ResumeExportResult> {
    const parseabilityGate = await this.evaluateParseability(
      prepared.projection,
      prepared.statements,
      prepared.html,
      prepared.temporaryPath,
    );
    if (!parseabilityGate.passed) {
      await fs.rm(prepared.temporaryPath, { force: true });
      return {
        artifact: null,
        truthGate: prepared.truthGate,
        parseabilityGate,
        linkedApplicationId: null,
      };
    }

    const version = await this.repository.nextArtifactVersion(
      prepared.projection.id,
    );
    const finalPath = path.join(
      this.resumeDirectory,
      `${prepared.projection.id}-v${version}.pdf`,
    );
    await fs.rename(prepared.temporaryPath, finalPath);
    const bytes = await fs.readFile(finalPath);
    const artifact = await this.repository.createArtifact({
      id: `resume-artifact-${randomUUID()}`,
      projectionId: prepared.projection.id,
      version,
      format: "pdf",
      managedPath: finalPath,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      pageCount: parseabilityGate.pageCount,
      truthGateResult: JSON.stringify(prepared.truthGate),
      parseabilityResult: JSON.stringify(parseabilityGate),
      relevanceReviewResult: null,
      projectionSnapshot: {
        projection: prepared.projection,
        statements: prepared.statements,
      },
      createdAt: new Date().toISOString(),
    });
    await this.repository.setProjectionStatus(
      prepared.projection.id,
      "finalized",
    );

    const applicationId = request.applicationId?.trim() || null;
    if (applicationId) {
      await this.repository.linkArtifactToApplication(
        applicationId,
        artifact.id,
        request.purpose ?? "submitted",
      );
    }

    return {
      artifact,
      truthGate: prepared.truthGate,
      parseabilityGate,
      linkedApplicationId: applicationId,
    };
  }

  async compareArtifacts(
    fromId: string,
    toId: string,
  ): Promise<ResumeVersionDiff> {
    const from = await this.repository.getArtifact(fromId);
    const to = await this.repository.getArtifact(toId);
    if (!from || !to) throw new Error("Resume artifact version not found.");
    const fromTexts = from.projectionSnapshot.statements.map(
      (item) => item.text,
    );
    const toTexts = to.projectionSnapshot.statements.map((item) => item.text);
    return {
      fromArtifactId: fromId,
      toArtifactId: toId,
      addedStatements: toTexts.filter((text) => !fromTexts.includes(text)),
      removedStatements: fromTexts.filter((text) => !toTexts.includes(text)),
      unchangedStatements: toTexts.filter((text) => fromTexts.includes(text)),
    };
  }

  private async evaluateParseability(
    projection: ResumeProjectionRecord,
    statements: ResumeStatement[],
    html: string,
    pdfPath: string,
  ): Promise<ResumeParseabilityGateReport> {
    const issues: ResumeParseabilityIssue[] = [];
    const bytes = await fs.readFile(pdfPath);
    const pageCount = countPdfPages(bytes);

    if (
      /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*0(?:\D|$)/i.test(
        html,
      )
    ) {
      issues.push({
        code: "hidden-content",
        severity: "critical",
        message: "Rendered template contains hidden content.",
      });
    }

    try {
      const parsed = await extractResumeDocument(pdfPath);
      const extracted = normalizedParseabilityText(parsed.rawText);
      let unverifiableScript = false;
      const contactRequired = [
        projection.contact.fullName,
        projection.contact.email || projection.contact.phone,
      ].filter(Boolean);
      for (const item of contactRequired) {
        const { tokens, containsUnverifiableScript } = parseabilityTokens(item);
        unverifiableScript ||= containsUnverifiableScript;
        if (
          tokens.length > 0 &&
          tokens.filter((token) => extracted.includes(token)).length /
            tokens.length <
            0.8
        ) {
          issues.push({
            code: "contact-missing",
            severity: "critical",
            message: `Contact content was not reliably extractable: ${item}`,
          });
        }
      }

      const positions: number[] = [];
      for (const statement of statements) {
        const { tokens, containsUnverifiableScript } = parseabilityTokens(statement.text);
        unverifiableScript ||= containsUnverifiableScript;
        const matched = tokens.filter((token) => extracted.includes(token));
        const coverage = tokens.length === 0 ? 1 : matched.length / tokens.length;
        if (coverage < 0.9) {
          issues.push({
            code: "statement-missing",
            severity: "critical",
            message: `Rendered PDF lost material statement content: ${statement.text}`,
          });
        }
        const anchor = tokens.slice(0, 3).join(" ");
        positions.push(anchor ? extracted.indexOf(anchor) : -1);
      }
      if (unverifiableScript) {
        issues.push({
          code: "unverified-script",
          severity: "advisory",
          message:
            "Text in right-to-left or Indic scripts could not be verified: PDF text extraction of these scripts differs between parsers. Open the PDF and check it before submitting.",
        });
      }
      let last = -1;
      for (const position of positions.filter((value) => value >= 0)) {
        if (position < last) {
          issues.push({
            code: "reading-order",
            severity: "critical",
            message:
              "Extracted PDF reading order differs materially from the resume projection.",
          });
          break;
        }
        last = position;
      }
    } catch (error) {
      issues.push({
        code: "pdf-unreadable",
        severity: "critical",
        message:
          error instanceof Error
            ? error.message
            : "Generated PDF could not be re-parsed.",
      });
    }

    if (pageCount !== null) {
      if (projection.context === "federal" && pageCount > 2) {
        issues.push({
          code: "page-count",
          severity: "critical",
          message: "Federal resume exceeds the current two-page application limit.",
        });
      } else if (projection.context !== "academic" && pageCount > 2) {
        issues.push({
          code: "page-count",
          severity: "advisory",
          message: `Resume is ${pageCount} pages; consider a more focused projection.`,
        });
      }
    }

    return {
      passed: !issues.some((issue) => issue.severity === "critical"),
      checkedAt: new Date().toISOString(),
      pageCount,
      parserId: RESUME_PARSER_ID,
      parserVersion: RESUME_PARSER_VERSION,
      issues,
    };
  }
}
