import type { Job } from "../types";
import type { CareerProfile, PayBasis } from "./storage";

export type FitBand = "strong" | "good" | "possible" | "low";

export interface JobFitEvaluation {
  score: number;
  band: FitBand;
  label: string;
  reasons: string[];
  concerns: string[];
  evidence: string[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function titleSimilarity(jobTitle: string, targetTitle: string): number {
  const job = normalize(jobTitle);
  const target = normalize(targetTitle);
  if (!job || !target) {
    return 0;
  }
  if (job.includes(target) || target.includes(job)) {
    return 1;
  }

  const targetTokens = tokens(targetTitle);
  if (targetTokens.length === 0) {
    return 0;
  }
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

function detectJobPayBasis(job: Job): PayBasis | null {
  const text = normalize(job.salaryText ?? "");
  // Same spellings as the opportunity assessment's detectPayBasis (#216).
  if (text.includes("hour") || text.includes("/hr") || /\bhr\b/.test(text)) {
    return "hourly";
  }
  if (
    text.includes("year") || text.includes("annual") || text.includes("salary") ||
    /\byr\b|\bannum\b/.test(text)
  ) {
    return "annual";
  }
  if (job.salaryMin && job.salaryMin > 1000) {
    return "annual";
  }
  return null;
}

function payEquivalent(job: Job, targetBasis: PayBasis): number | null {
  if (!job.salaryMin) {
    return null;
  }

  const sourceBasis = detectJobPayBasis(job);
  if (!sourceBasis) {
    return null;
  }
  if (sourceBasis === targetBasis) {
    return job.salaryMin;
  }
  return targetBasis === "hourly" ? job.salaryMin / 2080 : job.salaryMin * 2080;
}

function formatPay(value: number, basis: PayBasis): string {
  return `${formatMoney(value)}/${basis === "hourly" ? "hr" : "yr"}`;
}

function includesPhrase(haystack: string, value: string): boolean {
  const phrase = normalize(value);
  if (!phrase) {
    return false;
  }
  return haystack.includes(phrase);
}

function fitBand(score: number): { band: FitBand; label: string } {
  if (score >= 75) return { band: "strong", label: "Strong match" };
  if (score >= 55) return { band: "good", label: "Good match" };
  if (score >= 35) return { band: "possible", label: "Possible match" };
  return { band: "low", label: "Low evidence match" };
}

export function evaluateJobFit(job: Job, profile: CareerProfile): JobFitEvaluation | null {
  const hasProfile =
    profile.targetTitles.length > 0 ||
    profile.skills.length > 0 ||
    profile.certifications.length > 0 ||
    Boolean(profile.homeLocation) ||
    profile.minimumPay !== null;

  if (!hasProfile) {
    return null;
  }

  const searchable = normalize(`${job.title} ${job.descriptionSnippet}`);
  const reasons: string[] = [];
  const concerns: string[] = [];
  const evidence: string[] = [];
  let score = 0;
  let availableWeight = 0;

  if (profile.targetTitles.length > 0) {
    availableWeight += 45;
    const bestTitle = profile.targetTitles
      .map((title) => ({ title, similarity: titleSimilarity(job.title, title) }))
      .sort((a, b) => b.similarity - a.similarity)[0];

    const titlePoints = Math.round((bestTitle?.similarity ?? 0) * 45);
    score += titlePoints;
    if (bestTitle && bestTitle.similarity >= 0.66) {
      reasons.push(`The title lines up with your ${bestTitle.title} target.`);
      evidence.push(`Target title: ${bestTitle.title}`);
    } else if (bestTitle && bestTitle.similarity > 0) {
      reasons.push(`The title overlaps with your ${bestTitle.title} target.`);
    } else {
      concerns.push("The title does not clearly match one of your saved target roles.");
    }
  }

  const experienceSignals = [...profile.certifications, ...profile.skills];
  if (experienceSignals.length > 0) {
    availableWeight += 30;
    const matched = experienceSignals.filter((signal) => includesPhrase(searchable, signal));
    const signalRatio = Math.min(1, matched.length / Math.min(4, experienceSignals.length));
    score += Math.round(signalRatio * 30);

    if (matched.length > 0) {
      const visible = matched.slice(0, 3);
      reasons.push(`The posting mentions ${visible.join(", ")}${matched.length > 3 ? ", and other saved experience" : ""}.`);
      evidence.push(...visible.map((item) => `Posting mentions: ${item}`));
    } else if (job.descriptionSnippet.trim()) {
      concerns.push("The visible posting text does not mention your saved skills or certifications yet.");
    }
  }

  if (profile.homeLocation) {
    availableWeight += 10;
    const jobLocation = normalize(job.location);
    const homeParts = normalize(profile.homeLocation)
      .split(" ")
      .filter((part) => part.length >= 2);
    const remote = jobLocation.includes("remote");
    const locationMatch = remote || homeParts.some((part) => jobLocation.includes(part));
    if (locationMatch) {
      score += 10;
      reasons.push(remote ? "The role is listed as remote." : "The listed location overlaps with your home area.");
      evidence.push(`Location: ${job.location}`);
    } else {
      concerns.push(`The listed location (${job.location || "not provided"}) does not clearly match ${profile.homeLocation}.`);
    }
  }

  if (profile.minimumPay !== null) {
    availableWeight += 10;
    const comparablePay = payEquivalent(job, profile.payBasis);
    if (comparablePay === null) {
      score += 5;
      concerns.push("The posting does not provide enough pay detail to verify your minimum.");
    } else if (comparablePay >= profile.minimumPay) {
      score += 10;
      reasons.push(`Listed pay appears to meet your ${formatPay(profile.minimumPay, profile.payBasis)} minimum.`);
      evidence.push(`Approx. starting pay: ${formatPay(comparablePay, profile.payBasis)}`);
    } else {
      concerns.push(`Listed pay appears below your ${formatPay(profile.minimumPay, profile.payBasis)} minimum.`);
    }
  }

  if (job.matchedFilterCount > 0) {
    availableWeight += 5;
    score += 5;
    reasons.push(`It also matches ${job.matchedFilterCount} of your saved Sojourner filter${job.matchedFilterCount === 1 ? "" : "s"}.`);
  }

  const normalizedScore = availableWeight > 0 ? Math.round((score / availableWeight) * 100) : 0;
  const boundedScore = Math.max(0, Math.min(100, normalizedScore));
  const band = fitBand(boundedScore);

  if (reasons.length === 0) {
    reasons.push("There is not enough matching evidence in the saved listing summary yet.");
  }

  return {
    score: boundedScore,
    band: band.band,
    label: band.label,
    reasons,
    concerns,
    evidence,
  };
}
