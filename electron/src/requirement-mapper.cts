import { createHash } from "node:crypto";
import type {
  CandidateEvidence,
  EvidenceVerificationState,
  Job,
  JobRequirement,
  JobRequirementKind,
  RequirementEvidenceMap,
  RequirementEvidenceClassification,
} from "../../src/shared/contracts.js";
import type { JobEvidenceCoverage } from "../../src/shared/requirement-coverage.js";
import { affirmedText, NEGATION_NOTE, negationChangedOutcome } from "./evidence-negation.cjs";
import { claimActionNote, claimVerb, isCapped, selectUncapped } from "./claim-action.cjs";

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "that", "this", "from", "your", "you", "our",
  "are", "will", "have", "has", "into", "their", "they", "job", "role", "work",
  "years", "year", "experience", "required", "preferred", "minimum", "ability",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    // G11: discard sentence-terminal stop words such as "required." without
    // rewriting ordinary lexical tokens. Broadly stripping periods changed
    // established positive corpus classifications; keep that wider semantic
    // matching question separate from this safe stop-word correction.
    // normalize() stays stable for persisted requirement fingerprints.
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token.replace(/\.+$/u, "")));
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

/**
 * Deliberately conservative morphological equivalence for deterministic
 * matching. It catches ordinary inflections such as maintain/maintained,
 * coordinate/coordinated, record/records, and schedule/scheduling without
 * introducing a fuzzy semantic matcher that could invent support.
 */
function tokenEquivalent(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;
  if (left.startsWith(right) || right.startsWith(left)) {
    return Math.abs(left.length - right.length) <= 4;
  }
  const prefix = commonPrefixLength(left, right);
  const shorter = Math.min(left.length, right.length);
  return prefix >= 5 && prefix / shorter >= 0.75 && Math.abs(left.length - right.length) <= 4;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function classifyRequirement(text: string): JobRequirementKind | null {
  const value = normalize(text);
  if (!value || value.length < 8) return null;

  if (/\b(certif|license|licence|credential|registration|degree|diploma)\w*/.test(value)) {
    return "credential";
  }
  if (/\b(remote|hybrid|onsite|on site|travel|shift|schedule|weekend|evening|night|on-call|on call|location|relocat)\w*/.test(value)) {
    return "logistics";
  }
  if (/\b(prefer|preferred|nice to have|plus|bonus|desirable)\b/.test(value)) {
    return "preferred";
  }
  if (/\b(required|requirement|must|minimum|at least|need to|needs to)\b/.test(value)) {
    return "must-have";
  }
  if (/\b(responsib|duties|will |manage|maintain|perform|support|lead|coordinate|develop|build|operate|install|repair|service|troubleshoot|communicate|deliver|administer)\w*/.test(value)) {
    return "responsibility";
  }
  return null;
}

function requirementImportance(kind: JobRequirementKind): number {
  switch (kind) {
    case "must-have":
    case "credential":
      return 1;
    case "preferred":
      return 0.7;
    case "responsibility":
      return 0.6;
    case "logistics":
      return 0.5;
  }
}

function requirementTerm(text: string): string | null {
  const tokens = significantTokens(text);
  return tokens.length > 0 ? tokens.slice(0, 6).join(" ") : null;
}

function splitRequirementText(value: string): string[] {
  return value
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((item) => item.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((item) => item.length >= 8 && item.length <= 500);
}

export function extractJobRequirements(
  job: Pick<Job, "id" | "title" | "descriptionSnippet" | "location" | "employmentType">,
  now = new Date().toISOString(),
): JobRequirement[] {
  const sourceText = `${job.title}\n${job.descriptionSnippet}\n${job.location}\n${job.employmentType ?? ""}`;
  const candidates = splitRequirementText(sourceText);
  const seen = new Set<string>();
  const requirements: JobRequirement[] = [];

  for (const text of candidates) {
    const kind = classifyRequirement(text);
    if (!kind) continue;
    const normalized = normalize(text);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    requirements.push({
      id: stableId("requirement", `${job.id}\n${normalized}`),
      jobId: job.id,
      kind,
      text,
      normalizedTerm: requirementTerm(text),
      importance: requirementImportance(kind),
      sourceText: text,
      createdAt: now,
    });
    if (requirements.length >= 12) break;
  }

  return requirements;
}

// Prose fields are negation-aware (G12); labels such as skills, tools,
// metrics, organization and title are taken as written.
function evidenceSearchText(evidence: CandidateEvidence, affirm = true): string {
  const prose = (value: string | null): string | null => (value && affirm ? affirmedText(value) : value);
  return [
    prose(evidence.statement),
    evidence.organization,
    evidence.titleOrName,
    prose(evidence.action),
    prose(evidence.context),
    ...evidence.skills,
    ...evidence.methodsOrTools,
    ...evidence.scope.map(prose),
    ...evidence.outcomes.map(prose),
    ...evidence.metrics,
    evidence.credential?.issuer,
    evidence.credential?.jurisdiction,
    evidence.credential?.status,
    evidence.credential?.credentialId,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function overlapScore(requirement: JobRequirement, evidence: CandidateEvidence, affirm = true): number {
  const requirementTokens = significantTokens(requirement.text);
  if (requirementTokens.length === 0) return 0;
  const evidenceTokens = significantTokens(evidenceSearchText(evidence, affirm));
  const matched = requirementTokens.filter((token) =>
    evidenceTokens.some((candidate) => tokenEquivalent(token, candidate)),
  );
  return matched.length / requirementTokens.length;
}

function isConfirmed(state: EvidenceVerificationState): boolean {
  return state === "user-confirmed" || state === "user-authored";
}

type CredentialStanding = { usable: true } | { usable: false; reason: string };

function credentialStanding(
  evidence: CandidateEvidence,
  now: string,
): CredentialStanding {
  if (evidence.subjectType !== "credential" || !evidence.credential) {
    return { usable: true };
  }
  const details = evidence.credential;
  if (details.status === "expired") {
    return { usable: false, reason: "the saved credential is marked expired" };
  }
  if (details.status === "inactive") {
    return { usable: false, reason: "the saved credential is marked inactive" };
  }
  if (details.status === "pending") {
    return { usable: false, reason: "the saved credential is still pending" };
  }
  if (details.expirationDate) {
    const expiration = Date.parse(`${details.expirationDate}T23:59:59.999Z`);
    const reference = Date.parse(now);
    if (!Number.isNaN(expiration) && !Number.isNaN(reference) && expiration < reference) {
      return {
        usable: false,
        reason: `the saved credential expired on ${details.expirationDate}`,
      };
    }
  }
  return { usable: true };
}

function makeMapping(
  requirement: JobRequirement,
  evidence: CandidateEvidence | null,
  classification: RequirementEvidenceClassification,
  explanation: string,
  now: string,
): RequirementEvidenceMap {
  return {
    id: stableId(
      "mapping",
      `${requirement.id}\n${evidence?.id ?? "gap"}\n${classification}`,
    ),
    jobRequirementId: requirement.id,
    evidenceId: evidence?.id ?? null,
    classification,
    explanation,
    createdBy: "deterministic",
    userConfirmed: classification === "direct" || classification === "transferable",
    createdAt: now,
    updatedAt: now,
  };
}

function rankedEvidence(
  requirement: JobRequirement,
  evidence: readonly CandidateEvidence[],
  affirm = true,
): Array<{ evidence: CandidateEvidence; score: number }> {
  return evidence
    .filter((item) => item.verificationState !== "rejected")
    .map((item) => ({ evidence: item, score: overlapScore(requirement, item, affirm) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Maps a requirement to its best supporting Career Evidence. Evidence prose is
 * scored on affirmed text (G12); when the same classification on raw text would
 * have been stronger, the explanation says that negated text was not counted.
 */
export function mapRequirementToEvidence(
  requirement: JobRequirement,
  evidence: readonly CandidateEvidence[],
  now = new Date().toISOString(),
): { mapping: RequirementEvidenceMap; evidence: CandidateEvidence | null } {
  const result = classifyRequirementEvidence(requirement, evidence, now, true);
  const raw = classifyRequirementEvidence(requirement, evidence, now, false);
  if (!negationChangedOutcome(raw.mapping.classification, result.mapping.classification)) return result;
  return { ...result, mapping: { ...result.mapping, explanation: `${result.mapping.explanation} ${NEGATION_NOTE}` } };
}

function classifyRequirementEvidence(
  requirement: JobRequirement,
  evidence: readonly CandidateEvidence[],
  now: string,
  affirm: boolean,
): { mapping: RequirementEvidenceMap; evidence: CandidateEvidence | null } {
  const ranked = rankedEvidence(requirement, evidence, affirm);
  const best =
    requirement.kind === "credential"
      ? ranked.find((item) => credentialStanding(item.evidence, now).usable) ?? ranked[0] ?? null
      : ranked[0] ?? null;
  if (!best) {
    return {
      mapping: makeMapping(
        requirement,
        null,
        "gap",
        "No saved Career Evidence currently supports this requirement.",
        now,
      ),
      evidence: null,
    };
  }

  if (!isConfirmed(best.evidence.verificationState)) {
    if (best.score >= 0.6) {
      return {
        mapping: makeMapping(
          requirement,
          best.evidence,
          "ambiguous",
          "Imported evidence appears relevant, but it has not been confirmed by you yet.",
          now,
        ),
        evidence: best.evidence,
      };
    }
    return {
      mapping: makeMapping(
        requirement,
        null,
        "gap",
        "No confirmed Career Evidence currently supports this requirement.",
        now,
      ),
      evidence: null,
    };
  }

  if (requirement.kind === "credential") {
    const standing = credentialStanding(best.evidence, now);
    if (!standing.usable) {
      return {
        mapping: makeMapping(
          requirement,
          best.evidence,
          "gap",
          `Saved Career Evidence matches this credential requirement, but ${standing.reason}; current eligibility is not established.`,
          now,
        ),
        evidence: best.evidence,
      };
    }
  }

  if (best.score >= 0.7) {
    // G13: evidence showing a recipient role without the claim action is not direct support.
    const verb = requirement.kind === "credential" ? null : claimVerb(requirement.text);
    const capped = (item: CandidateEvidence) => verb !== null && isCapped(item, requirement.text, verb, affirm);
    const supported = capped(best.evidence)
      ? selectUncapped(ranked, (item) => isConfirmed(item.verificationState), capped)
      : best;
    if (!supported) {
      return {
        mapping: makeMapping(
          requirement,
          best.evidence,
          "transferable",
          `Confirmed Career Evidence overlaps with this requirement and may transfer to this context. ${claimActionNote(verb!.word)}`,
          now,
        ),
        evidence: best.evidence,
      };
    }
    return {
      mapping: makeMapping(
        requirement,
        supported.evidence,
        "direct",
        "Confirmed Career Evidence closely matches the language of this requirement.",
        now,
      ),
      evidence: supported.evidence,
    };
  }

  if (best.score >= 0.35) {
    return {
      mapping: makeMapping(
        requirement,
        best.evidence,
        "transferable",
        "Confirmed Career Evidence overlaps with this requirement and may transfer to this context.",
        now,
      ),
      evidence: best.evidence,
    };
  }

  return {
    mapping: makeMapping(
      requirement,
      null,
      "gap",
      "The available evidence is too weak to claim support for this requirement.",
      now,
    ),
    evidence: null,
  };
}

export function buildJobEvidenceCoverage(
  jobId: string,
  requirements: readonly JobRequirement[],
  evidence: readonly CandidateEvidence[],
  now = new Date().toISOString(),
): JobEvidenceCoverage {
  const items = requirements.map((requirement) => {
    const mapped = mapRequirementToEvidence(requirement, evidence, now);
    return { requirement, mapping: mapped.mapping, evidence: mapped.evidence };
  });

  const directCount = items.filter((item) => item.mapping.classification === "direct").length;
  const transferableCount = items.filter((item) => item.mapping.classification === "transferable").length;
  const ambiguousCount = items.filter((item) => item.mapping.classification === "ambiguous").length;
  const gapCount = items.filter((item) => item.mapping.classification === "gap").length;

  return {
    jobId,
    items,
    directCount,
    transferableCount,
    ambiguousCount,
    gapCount,
    supportedCount: directCount + transferableCount,
    totalCount: items.length,
    generatedAt: now,
  };
}
