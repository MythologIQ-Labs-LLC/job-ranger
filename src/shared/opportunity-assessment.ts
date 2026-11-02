import type {
  CareerTargetTrack,
  EmploymentArrangement,
  PayBasis,
  PreferenceStrength,
  WorkMode,
  WorkSchedule,
} from "./career-contracts.js";
import type { JobEvidenceCoverage } from "./requirement-coverage.js";

export type EligibilityStatus = "likely" | "unclear" | "unlikely";
export type EvidenceCoverageStatus = "strong" | "partial" | "limited" | "unknown";
export type AlignmentStatus = "aligned" | "mixed" | "misaligned" | "unknown";

export interface AssessableJob {
  id: string;
  title: string;
  location: string;
  employmentType: string | null;
  descriptionSnippet: string;
  salaryMin: number | null;
  salaryText: string | null;
  sourceType: string;
}

export interface OpportunityAssessment {
  jobId: string;
  targetTrackId: string;
  targetTrackName: string;
  eligibility: {
    status: EligibilityStatus;
    blockers: string[];
    potentialBlockers: string[];
  };
  evidenceCoverage: {
    status: EvidenceCoverageStatus;
    directCount: number;
    transferableCount: number;
    ambiguousCount: number;
    gapCount: number;
    totalCount: number;
  };
  careerAlignment: {
    status: AlignmentStatus;
    reasons: string[];
  };
  preferenceAlignment: {
    status: AlignmentStatus;
    matches: string[];
    misses: string[];
    unknowns: string[];
  };
  unknowns: string[];
  generatedAt: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function titleSimilarity(jobTitle: string, targetTitle: string): number {
  const job = normalize(jobTitle);
  const target = normalize(targetTitle);
  if (!job || !target) return 0;
  if (job.includes(target) || target.includes(job)) return 1;

  const targetTokens = tokens(targetTitle);
  if (targetTokens.length === 0) return 0;
  const jobTokens = new Set(tokens(jobTitle));
  return targetTokens.filter((token) => jobTokens.has(token)).length / targetTokens.length;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatPay(value: number, basis: PayBasis): string {
  return `${formatMoney(value)}/${basis === "hourly" ? "hr" : "yr"}`;
}

function detectPayBasis(job: AssessableJob): PayBasis | null {
  const salaryText = normalize(job.salaryText ?? "");
  if (salaryText.includes("hour") || salaryText.includes("/hr") || /\bhr\b/.test(salaryText)) {
    return "hourly";
  }
  if (
    salaryText.includes("year") || salaryText.includes("annual") || salaryText.includes("salary") ||
    /\byr\b|\bannum\b/.test(salaryText)
  ) {
    return "annual";
  }
  if (job.salaryMin !== null && job.salaryMin > 1000) return "annual";
  return null;
}

function payEquivalent(job: AssessableJob, targetBasis: PayBasis): number | null {
  if (job.salaryMin === null) return null;
  const sourceBasis = detectPayBasis(job);
  if (!sourceBasis) return null;
  if (sourceBasis === targetBasis) return job.salaryMin;
  return targetBasis === "hourly" ? job.salaryMin / 2080 : job.salaryMin * 2080;
}

function detectWorkMode(job: AssessableJob): WorkMode | null {
  const text = normalize(`${job.location} ${job.descriptionSnippet}`);
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(text)) return "remote";
  if (/\bon-site\b|\bonsite\b|\bon site\b|\bin-person\b|\bin person\b/.test(text)) {
    return "on-site";
  }
  return null;
}

function detectWorkSchedules(job: AssessableJob): WorkSchedule[] {
  const text = normalize(`${job.title} ${job.descriptionSnippet}`);
  const schedules = new Set<WorkSchedule>();

  const coordinatedShiftPhrase =
    /\b(day|evening|night)\s+(?:or|and|\/)\s+(day|evening|night)\s+shifts?\b/g;
  for (const match of text.matchAll(coordinatedShiftPhrase)) {
    schedules.add(match[1] as WorkSchedule);
    schedules.add(match[2] as WorkSchedule);
  }

  const coordinatedNamedShiftPhrase =
    /\b(first|1st|second|2nd|third|3rd)\s+(?:or|and|\/)\s+(first|1st|second|2nd|third|3rd)\s+shifts?\b/g;
  const namedShift = (value: string): WorkSchedule => {
    if (value === "first" || value === "1st") return "day";
    if (value === "second" || value === "2nd") return "evening";
    return "night";
  };
  for (const match of text.matchAll(coordinatedNamedShiftPhrase)) {
    schedules.add(namedShift(match[1]));
    schedules.add(namedShift(match[2]));
  }

  if (/\bday shift\b|\bdaytime\b|\bfirst shift\b|\b1st shift\b/.test(text)) {
    schedules.add("day");
  }
  if (/\bevening shift\b|\bswing shift\b|\bsecond shift\b|\b2nd shift\b/.test(text)) {
    schedules.add("evening");
  }
  if (/\bnight shift\b|\bovernight\b|\bgraveyard\b|\bthird shift\b|\b3rd shift\b/.test(text)) {
    schedules.add("night");
  }

  const weekendsExplicitlyExcluded =
    /\bno weekends?\b/.test(text) ||
    /\bweekends? off\b/.test(text) ||
    /\bdoes not require\b.{0,30}\bweekends?\b/.test(text) ||
    /\bweekend work\b.{0,30}\b(not required|optional|none)\b/.test(text);
  if (!weekendsExplicitlyExcluded && /\bweekends?\b/.test(text)) {
    schedules.add("weekend");
  }

  if (/\brotating shifts?\b|\bshift rotation\b|\brotating schedule\b/.test(text)) {
    schedules.add("rotating");
  }

  return [...schedules];
}

type OnCallRequirement = "required" | "not-required" | "unknown";

function detectOnCallRequirement(job: AssessableJob): OnCallRequirement {
  const text = normalize(`${job.title} ${job.descriptionSnippet}`);
  if (!/\bon[- ]?call\b/.test(text)) return "unknown";

  const explicitlyNotRequired =
    /\b(no|without)\s+(?:regular\s+)?on[- ]?call\b/.test(text) ||
    /\bnot\s+(?:an?\s+)?on[- ]?call\b/.test(text) ||
    /\bdoes not require\b.{0,30}\bon[- ]?call\b/.test(text) ||
    /\bon[- ]?call\b.{0,40}\b(not required|not expected|optional|none)\b/.test(text);

  return explicitlyNotRequired ? "not-required" : "required";
}

function detectEmploymentArrangement(value: string | null): EmploymentArrangement | null {
  const text = normalize(value ?? "");
  if (!text) return null;
  if (text.includes("full time") || text.includes("full-time")) return "full-time";
  if (text.includes("part time") || text.includes("part-time")) return "part-time";
  if (text.includes("intern")) return "internship";
  if (text.includes("freelance")) return "freelance";
  if (text.includes("season")) return "seasonal";
  if (text.includes("temp")) return "temporary";
  if (text.includes("contract")) return "contract";
  return "other";
}

function supplied(strength: PreferenceStrength, hasValue: boolean): boolean {
  return hasValue && strength !== "unspecified";
}

function addConstraintResult(
  strength: PreferenceStrength,
  result: "match" | "miss" | "unknown",
  detail: string,
  matches: string[],
  misses: string[],
  unknowns: string[],
  blockers: string[],
  potentialBlockers: string[],
): void {
  if (result === "match") {
    matches.push(detail);
    return;
  }
  if (result === "miss") {
    misses.push(detail);
    if (strength === "required") blockers.push(detail);
    return;
  }
  unknowns.push(detail);
  if (strength === "required") potentialBlockers.push(detail);
}

function evidenceStatus(coverage: JobEvidenceCoverage): EvidenceCoverageStatus {
  if (coverage.totalCount === 0) return "unknown";
  if (coverage.gapCount === 0 && coverage.ambiguousCount === 0) return "strong";
  if (coverage.supportedCount > 0) return "partial";
  return "limited";
}

function sourceUncertainty(sourceType: string): string | null {
  const structured = new Set(["greenhouse", "lever", "smartrecruiters", "ashby"]);
  if (structured.has(sourceType)) return null;
  return "This source may not expose every requirement or field, so missing listing data remains uncertain.";
}

function requirementCanBlock(
  kind: JobEvidenceCoverage["items"][number]["requirement"]["kind"],
  text: string,
): boolean {
  if (kind === "must-have") return true;
  if (kind !== "credential") return false;
  const normalized = normalize(text);
  return !/\b(prefer|preferred|nice to have|plus|bonus|desirable)\b/.test(normalized);
}

export function buildOpportunityAssessment(
  job: AssessableJob,
  track: CareerTargetTrack,
  coverage: JobEvidenceCoverage,
  now = new Date().toISOString(),
): OpportunityAssessment {
  const blockers: string[] = [];
  const potentialBlockers: string[] = [];
  const matches: string[] = [];
  const misses: string[] = [];
  const preferenceUnknowns: string[] = [];
  let configuredPreferenceCount = 0;

  for (const item of coverage.items) {
    const unsupported =
      item.mapping.classification === "gap" || item.mapping.classification === "ambiguous";
    if (requirementCanBlock(item.requirement.kind, item.requirement.text) && unsupported) {
      const requirement = item.requirement.text.trim().replace(/[\s.,;:]+$/, "");
      potentialBlockers.push(
        `${requirement} (${item.mapping.classification === "gap" ? "no confirmed support" : "support needs confirmation"}).`,
      );
    }
  }

  const geography = track.constraints.geography;
  if (supplied(geography.strength, geography.locations.length > 0)) {
    configuredPreferenceCount += 1;
    const jobLocation = normalize(job.location);
    const matchedLocation = jobLocation
      ? geography.locations.find((location) => {
          const target = normalize(location);
          return Boolean(target && (jobLocation.includes(target) || target.includes(jobLocation)));
        })
      : undefined;

    if (matchedLocation) {
      addConstraintResult(
        geography.strength,
        "match",
        `Location matches ${matchedLocation}.`,
        matches,
        misses,
        preferenceUnknowns,
        blockers,
        potentialBlockers,
      );
    } else if (!jobLocation) {
      addConstraintResult(
        geography.strength,
        "unknown",
        `The listing does not provide enough location detail to evaluate ${geography.locations.join(", ")}.`,
        matches,
        misses,
        preferenceUnknowns,
        blockers,
        potentialBlockers,
      );
    } else {
      addConstraintResult(
        geography.strength,
        "unknown",
        `The listed location (${job.location}) does not textually establish whether it satisfies ${geography.locations.join(", ")}.`,
        matches,
        misses,
        preferenceUnknowns,
        blockers,
        potentialBlockers,
      );
    }
  }

  const workModes = track.constraints.workModes;
  if (supplied(workModes.strength, workModes.values.length > 0)) {
    configuredPreferenceCount += 1;
    const detected = detectWorkMode(job);
    addConstraintResult(
      workModes.strength,
      detected === null ? "unknown" : workModes.values.includes(detected) ? "match" : "miss",
      detected === null
        ? `The listing does not explicitly identify a work mode; your track allows ${workModes.values.join(", ")}.`
        : `Work mode is listed as ${detected}; your track allows ${workModes.values.join(", ")}.`,
      matches,
      misses,
      preferenceUnknowns,
      blockers,
      potentialBlockers,
    );
  }

  const arrangements = track.constraints.employmentArrangements;
  if (supplied(arrangements.strength, arrangements.values.length > 0)) {
    configuredPreferenceCount += 1;
    const detected = detectEmploymentArrangement(job.employmentType);
    addConstraintResult(
      arrangements.strength,
      detected === null
        ? "unknown"
        : arrangements.values.includes(detected)
          ? "match"
          : "miss",
      detected === null
        ? `The listing does not provide a usable employment arrangement; your track allows ${arrangements.values.join(", ")}.`
        : `Employment arrangement is ${detected}; your track allows ${arrangements.values.join(", ")}.`,
      matches,
      misses,
      preferenceUnknowns,
      blockers,
      potentialBlockers,
    );
  }

  const schedules = track.constraints.schedules;
  if (schedules && supplied(schedules.strength, schedules.values.length > 0)) {
    configuredPreferenceCount += 1;
    const detected = detectWorkSchedules(job);
    const allowed = detected.filter((schedule) => schedules.values.includes(schedule));
    const result =
      detected.length === 0
        ? "unknown"
        : allowed.length === detected.length
          ? "match"
          : allowed.length === 0
            ? "miss"
            : "unknown";
    const detail =
      detected.length === 0
        ? `The listing does not explicitly identify a work schedule; your track allows ${schedules.values.join(", ")}.`
        : result === "unknown"
          ? `The listing mentions multiple schedules (${detected.join(", ")}) and only some overlap with your allowed schedules (${schedules.values.join(", ")}); whether the role can honor your availability is unclear.`
          : `Work schedule is listed as ${detected.join(", ")}; your track allows ${schedules.values.join(", ")}.`;
    addConstraintResult(
      schedules.strength,
      result,
      detail,
      matches,
      misses,
      preferenceUnknowns,
      blockers,
      potentialBlockers,
    );
  }

  const compensation = track.constraints.compensation;
  if (supplied(compensation.floorStrength, compensation.floor !== null)) {
    configuredPreferenceCount += 1;
    const floor = compensation.floor ?? 0;
    const comparable = payEquivalent(job, compensation.basis);
    addConstraintResult(
      compensation.floorStrength,
      comparable === null ? "unknown" : comparable >= floor ? "match" : "miss",
      comparable === null
        ? `The listing does not provide enough pay detail to verify your ${formatPay(floor, compensation.basis)} floor.`
        : `Listed starting pay is approximately ${formatPay(comparable, compensation.basis)} versus your ${formatPay(floor, compensation.basis)} floor.`,
      matches,
      misses,
      preferenceUnknowns,
      blockers,
      potentialBlockers,
    );
  }

  const onCall = track.constraints.onCall;
  if (supplied(onCall.strength, onCall.value !== "either")) {
    configuredPreferenceCount += 1;
    const requirement = detectOnCallRequirement(job);
    const result =
      requirement === "unknown"
        ? "unknown"
        : onCall.value === "yes" || requirement === "not-required"
          ? "match"
          : "miss";
    const detail =
      requirement === "unknown"
        ? `The listing does not establish whether on-call work is required; your track says ${onCall.value}.`
        : requirement === "not-required"
          ? `The listing explicitly says on-call work is not required; your track says ${onCall.value}.`
          : `The listing explicitly requires on-call work; your track says ${onCall.value}.`;
    addConstraintResult(
      onCall.strength,
      result,
      detail,
      matches,
      misses,
      preferenceUnknowns,
      blockers,
      potentialBlockers,
    );
  }

  const industries = track.constraints.industries;
  if (supplied(industries.strength, industries.values.length > 0)) {
    configuredPreferenceCount += 1;
    addConstraintResult(
      industries.strength,
      "unknown",
      `Industry preference (${industries.values.join(", ")}) cannot be verified from the normalized job record yet.`,
      matches,
      misses,
      preferenceUnknowns,
      blockers,
      potentialBlockers,
    );
  }

  const careerReasons: string[] = [];
  let careerStatus: AlignmentStatus = "unknown";
  if (track.roleTitles.length > 0) {
    const best = track.roleTitles
      .map((title) => ({ title, similarity: titleSimilarity(job.title, title) }))
      .sort((left, right) => right.similarity - left.similarity)[0];
    if (best && best.similarity >= 0.66) {
      careerStatus = "aligned";
      careerReasons.push(`The role title aligns with your ${best.title} target.`);
    } else if (best && best.similarity > 0) {
      careerStatus = "mixed";
      careerReasons.push(`The role title partially overlaps with your ${best.title} target.`);
    } else {
      careerStatus = "misaligned";
      careerReasons.push("The role title does not clearly overlap with this track's saved target roles.");
    }
  } else {
    careerReasons.push("This target track does not yet include a role title to compare.");
  }

  if (track.seniority) {
    const seniority = normalize(track.seniority);
    careerReasons.push(
      seniority && normalize(job.title).includes(seniority)
        ? `The job title explicitly matches the track's ${track.seniority} seniority.`
        : `The track requests ${track.seniority} seniority, but the normalized listing does not establish that clearly.`,
    );
  }
  if (track.direction) {
    careerReasons.push(
      `Track direction: ${track.direction}. This free-text direction is shown for context rather than semantically scored.`,
    );
  }

  let preferenceStatus: AlignmentStatus;
  if (configuredPreferenceCount === 0) {
    preferenceStatus = "unknown";
    preferenceUnknowns.push("This target track has no explicit comparable preferences or constraints yet.");
  } else if (blockers.length > 0) {
    preferenceStatus = "misaligned";
  } else if (misses.length > 0 || preferenceUnknowns.length > 0) {
    preferenceStatus = "mixed";
  } else {
    preferenceStatus = "aligned";
  }

  const unknowns = [...preferenceUnknowns];
  if (coverage.totalCount === 0) {
    unknowns.push("No explicit job requirements were identified in the listing text currently available.");
  }
  const sourceUnknown = sourceUncertainty(job.sourceType);
  if (sourceUnknown) unknowns.push(sourceUnknown);

  const eligibility: EligibilityStatus =
    blockers.length > 0
      ? "unlikely"
      : potentialBlockers.length > 0 || coverage.totalCount === 0
        ? "unclear"
        : "likely";

  return {
    jobId: job.id,
    targetTrackId: track.id,
    targetTrackName: track.name,
    eligibility: {
      status: eligibility,
      blockers: Array.from(new Set(blockers)),
      potentialBlockers: Array.from(new Set(potentialBlockers)),
    },
    evidenceCoverage: {
      status: evidenceStatus(coverage),
      directCount: coverage.directCount,
      transferableCount: coverage.transferableCount,
      ambiguousCount: coverage.ambiguousCount,
      gapCount: coverage.gapCount,
      totalCount: coverage.totalCount,
    },
    careerAlignment: {
      status: careerStatus,
      reasons: careerReasons,
    },
    preferenceAlignment: {
      status: preferenceStatus,
      matches: Array.from(new Set(matches)),
      misses: Array.from(new Set(misses)),
      unknowns: Array.from(new Set(preferenceUnknowns)),
    },
    unknowns: Array.from(new Set(unknowns)),
    generatedAt: now,
  };
}
