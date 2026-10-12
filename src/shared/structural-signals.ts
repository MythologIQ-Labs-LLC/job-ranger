/**
 * Untrusted structural-market context, deliberately separate from Career
 * Evidence, Target Tracks, the deterministic Truth Gate, and job matching.
 *
 * Validation establishes only shape and provenance *metadata*. A passing
 * record is NOT a verified market fact and never becomes an automated score.
 * No I/O, clocks, inference, persistence, network calls, or user profiling.
 */

export type SignalLayer = "task" | "business-model" | "industry";
export type SignalEvent =
  | "task-exposure" | "employment-change" | "employer-closure"
  | "market-entry" | "consolidation" | "demand-change"
  | "regulatory-change" | "forecast";
export type ClaimKind = "observation" | "projection";
export type ReviewState = "unreviewed" | "reviewed" | "disputed" | "withdrawn";
export type CollectionOrigin = "user-entered" | "research-collection" | "inference-proposed";
export type CitationRights = "link-only" | "excerpt-permitted" | "unclear";
export type ScenarioOutcome =
  | "augmentation" | "substitution" | "new-entry"
  | "consolidation" | "slow-adoption" | "unknown";

export interface SignalCitation {
  url: string;
  publisher: string;
  title: string;
  publishedOn: string;
  retrievedOn: string;
  rights: CitationRights;
  /** Only a short, explicitly permitted quote. Never a whole article. */
  excerpt: string | null;
  /** A supplied rights assertion is metadata, not independent license verification. */
  reuseBasis: string | null;
}

export interface MarketScope {
  geographies: string[];
  industries: string[];
  businessModels: string[];
}
export interface ObservationPeriod {
  from: string;
  to: string;
}

export interface StructuralSignal {
  id: string;
  layer: SignalLayer;
  event: SignalEvent;
  claimKind: ClaimKind;
  claimSummary: string;
  citation: SignalCitation;
  scope: MarketScope;
  observedPeriod: ObservationPeriod | null;
  methodologyLimits: string[];
  reviewState: ReviewState;
  origin: CollectionOrigin;
  counterSignalIds: string[];
}

export interface ScenarioHypothesis {
  id: string;
  title: string;
  hypothesis: string;
  layer: SignalLayer;
  outcome: ScenarioOutcome;
  proposedOn: string;
  origin: CollectionOrigin;
  reviewState: ReviewState;
  signalIds: string[];
  counterScenarioIds: string[];
}

export interface StructuralContextBundle {
  asOf: string;
  /** Exact, user-specified comparison scope. No inferred geography hierarchy. */
  market: { geography: string | null; industry: string | null; businessModel: string | null };
  signals: StructuralSignal[];
  scenarios: ScenarioHypothesis[];
}

export type SignalRelevance = "matching-scope" | "partial-scope" | "out-of-scope";
export type SignalRecency = "recent" | "stale" | "not-yet-available";
export interface SignalAssessment {
  signalId: string;
  layer: SignalLayer;
  claimKind: ClaimKind;
  reviewState: ReviewState;
  origin: CollectionOrigin;
  citationRights: CitationRights;
  relevance: SignalRelevance;
  recency: SignalRecency;
  /** Cross-references are warnings, NOT adjudication of which claim is true. */
  counterSignalIds: string[];
  cautions: string[];
}
export interface ScenarioAssessment {
  scenarioId: string;
  outcome: ScenarioOutcome;
  /** All outcomes remain hypotheses, even when linked sources were reviewed. */
  authority: "hypothesis-only";
  linkedSignalIds: string[];
  contextualSignalIds: string[];
  counterScenarioIds: string[];
  cautions: string[];
}
export interface StructuralContextAssessment {
  asOf: string;
  signals: SignalAssessment[];
  scenarios: ScenarioAssessment[];
  notice: "Context only. Reviewed metadata does not verify a claim or predict an outcome.";
}

const layers: readonly SignalLayer[] = ["task", "business-model", "industry"];
const events: readonly SignalEvent[] = [
  "task-exposure", "employment-change", "employer-closure", "market-entry",
  "consolidation", "demand-change", "regulatory-change", "forecast",
];
const outcomes: readonly ScenarioOutcome[] = [
  "augmentation", "substitution", "new-entry", "consolidation", "slow-adoption", "unknown",
];
const reviewStates: readonly ReviewState[] = ["unreviewed", "reviewed", "disputed", "withdrawn"];
const origins: readonly CollectionOrigin[] = ["user-entered", "research-collection", "inference-proposed"];
const rights: readonly CitationRights[] = ["link-only", "excerpt-permitted", "unclear"];
const idPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const dayMilliseconds = 86_400_000;
/** Age policy is explicitly dated, not a claim that old studies are false. */
export const MAX_CONTEXT_AGE_DAYS = 540;

function record(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) {
    if (!keys.includes(key)) throw new Error(label + " contains unexpected field " + key);
  }
  return item;
}

function string(value: unknown, label: string, max = 320, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(label + " must be nonblank and at most " + max + " characters");
  }
  return value.trim();
}

function required(value: unknown, label: string, max = 320): string {
  return string(value, label, max) as string;
}

function selected<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(label + " has an invalid value");
  }
  return value as T;
}

function list(value: unknown, label: string, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(label + " must contain no more than " + maxItems + " entries");
  }
  const result = value.map((entry: unknown) => required(entry, label + " item", maxItemLength));
  if (new Set(result.map(entry => entry.toLowerCase())).size !== result.length) {
    throw new Error(label + " contains duplicate entries");
  }
  return result;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new Error(label + " must be a stable lowercase identifier");
  }
  return value;
}

function ids(value: unknown, label: string, maxItems = 16): string[] {
  const values = list(value, label, maxItems, 64);
  return values.map(value => identifier(value, label));
}

/** Strict ISO calendar date; no local timezone or Date.now() dependency. */
function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(label + " must be YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) throw new Error(label + " is outside the supported calendar");
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(label + " is not a real calendar date");
  }
  return value;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / dayMilliseconds;
}

function publicCitationUrl(raw: unknown): string {
  const value = required(raw, "citation URL", 1500);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Citation requires a valid HTTPS URL"); }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || !host.includes(".") ||
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    /^\d+(?:\.\d+){3}$/.test(host) || host.startsWith("[") ||
    url.username || url.password || url.hash || (url.port && url.port !== "443")
  ) {
    throw new Error("Citation requires an uncredentialed public HTTPS URL without a fragment");
  }
  return url.toString();
}

function citation(raw: unknown): SignalCitation {
  const r = record(raw, "Citation", [
    "url", "publisher", "title", "publishedOn", "retrievedOn", "rights", "excerpt", "reuseBasis",
  ]);
  const publishedOn = date(r.publishedOn, "Publication date");
  const retrievedOn = date(r.retrievedOn, "Retrieval date");
  if (daysBetween(publishedOn, retrievedOn) < 0) throw new Error("Retrieval predates publication");
  const usage = selected(r.rights, rights, "Citation rights");
  const excerpt = string(r.excerpt, "Licensed excerpt", 180, true);
  const reuseBasis = string(r.reuseBasis, "Reuse basis", 180, true);
  if (usage !== "excerpt-permitted" && (excerpt !== null || reuseBasis !== null)) {
    throw new Error("Non-licensed citation must be link-only without an excerpt or reuse basis");
  }
  if (usage === "excerpt-permitted" && (!excerpt || !reuseBasis)) {
    throw new Error("Excerpt requires a short quotation and explicitly recorded reuse basis");
  }
  return {
    url: publicCitationUrl(r.url),
    publisher: required(r.publisher, "Publisher", 120),
    title: required(r.title, "Source title", 200),
    publishedOn, retrievedOn, rights: usage, excerpt, reuseBasis,
  };
}

function scope(raw: unknown): MarketScope {
  const r = record(raw, "Market scope", ["geographies", "industries", "businessModels"]);
  return {
    geographies: list(r.geographies, "Geographies", 20, 100),
    industries: list(r.industries, "Industries", 20, 100),
    businessModels: list(r.businessModels, "Business models", 20, 100),
  };
}

function signal(raw: unknown): StructuralSignal {
  const r = record(raw, "Structural signal", [
    "id", "layer", "event", "claimKind", "claimSummary", "citation",
    "scope", "observedPeriod", "methodologyLimits", "reviewState", "origin", "counterSignalIds",
  ]);
  const origin = selected(r.origin, origins, "Signal origin");
  const reviewState = selected(r.reviewState, reviewStates, "Signal review state");
  if (origin === "inference-proposed" && reviewState !== "unreviewed") {
    throw new Error("Inference proposals must remain unreviewed until independent source review");
  }
  const claimKind = selected(r.claimKind, ["observation", "projection"] as const, "Claim kind");
  const event = selected(r.event, events, "Event");
  if (event === "forecast" && claimKind !== "projection") {
    throw new Error("A forecast cannot be recorded as an observed event");
  }
  let period: ObservationPeriod | null = null;
  const c = citation(r.citation);
  if (r.observedPeriod !== null) {
    const p = record(r.observedPeriod, "Observation period", ["from", "to"]);
    period = { from: date(p.from, "Observed from"), to: date(p.to, "Observed to") };
    if (daysBetween(period.from, period.to) < 0) throw new Error("Observation period is reversed");
    if (daysBetween(period.to, c.publishedOn) < 0) {
      throw new Error("Observed period extends beyond publication");
    }
  }
  if (claimKind === "observation" && !period) throw new Error("Observation requires an observed period");
  if (claimKind === "projection" && period) throw new Error("Projection cannot masquerade as an observation");
  const id = identifier(r.id, "Signal ID");
  const counters = ids(r.counterSignalIds, "Counter-signal IDs");
  if (counters.includes(id)) throw new Error("Signal cannot counter itself");
  return {
    id, layer: selected(r.layer, layers, "Signal layer"), event, claimKind,
    claimSummary: required(r.claimSummary, "Claim summary", 360),
    citation: c, scope: scope(r.scope), observedPeriod: period,
    methodologyLimits: list(r.methodologyLimits, "Methodology limits", 12, 240),
    origin, reviewState, counterSignalIds: counters,
  };
}

function scenario(raw: unknown): ScenarioHypothesis {
  const r = record(raw, "Scenario hypothesis", [
    "id", "title", "hypothesis", "layer", "outcome", "proposedOn",
    "origin", "reviewState", "signalIds", "counterScenarioIds",
  ]);
  const id = identifier(r.id, "Scenario ID");
  const counterScenarioIds = ids(r.counterScenarioIds, "Counter-scenario IDs");
  if (counterScenarioIds.includes(id)) throw new Error("Scenario cannot contradict itself");
  const origin = selected(r.origin, origins, "Scenario origin");
  const reviewState = selected(r.reviewState, reviewStates, "Scenario review state");
  if (origin === "inference-proposed" && reviewState !== "unreviewed") {
    throw new Error("Inference hypotheses cannot be promoted by asserted review state");
  }
  return {
    id, title: required(r.title, "Scenario title", 120),
    hypothesis: required(r.hypothesis, "Hypothesis text", 400),
    layer: selected(r.layer, layers, "Scenario layer"),
    outcome: selected(r.outcome, outcomes, "Scenario outcome"),
    proposedOn: date(r.proposedOn, "Scenario proposal date"),
    origin, reviewState,
    signalIds: ids(r.signalIds, "Scenario signal IDs"),
    counterScenarioIds,
  };
}

function referenceIntegrity(items: readonly { id: string }[], getLinks: (item: { id: string }) => readonly string[], label: string): void {
  const known = new Set(items.map(item => item.id));
  if (known.size !== items.length) throw new Error("Duplicate " + label + " IDs");
  for (const item of items) {
    for (const id of getLinks(item)) {
      if (!known.has(id)) throw new Error(label + " refers to missing ID " + id);
    }
  }
}

/**
 * Runtime-validation boundary for externally assembled data.
 * Strict shape, references, bounds and dates; makes defensive copies.
 * Passing this validator is not source authentication or fact confirmation.
 */
export function validateStructuralContext(input: unknown): StructuralContextBundle {
  const r = record(input, "Structural context", ["asOf", "market", "signals", "scenarios"]);
  const asOf = date(r.asOf, "Review as-of date");
  const m = record(r.market, "Comparison market", ["geography", "industry", "businessModel"]);
  const market = {
    geography: string(m.geography, "Market geography", 100, true),
    industry: string(m.industry, "Market industry", 100, true),
    businessModel: string(m.businessModel, "Market business model", 100, true),
  };
  if (!Array.isArray(r.signals) || r.signals.length > 50) throw new Error("At most 50 signals are accepted");
  if (!Array.isArray(r.scenarios) || r.scenarios.length > 12) throw new Error("At most 12 scenarios are accepted");
  const signals = r.signals.map(signal);
  const scenarios = r.scenarios.map(scenario);
  referenceIntegrity(signals, item => (item as StructuralSignal).counterSignalIds, "Signal");
  referenceIntegrity(scenarios, item => (item as ScenarioHypothesis).counterScenarioIds, "Scenario");
  const knownSignals = new Set(signals.map(item => item.id));
  for (const item of scenarios) {
    for (const id of item.signalIds) {
      if (!knownSignals.has(id)) throw new Error("Scenario refers to missing signal " + id);
    }
    if (daysBetween(item.proposedOn, asOf) < 0) throw new Error("Future-dated scenario");
  }
  return { asOf, market, signals, scenarios };
}

function aligned(labels: readonly string[], selectedValue: string | null): "matched" | "unknown" | "mismatch" {
  if (labels.length === 0 || selectedValue === null) return "unknown";
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  return labels.some(label => normalize(label) === normalize(selectedValue)) ? "matched" : "mismatch";
}

function symmetricContradictions<T extends { id: string }>(
  items: readonly T[], getLinks: (item: T) => readonly string[],
): Map<string, string[]> {
  const contradictions = new Map(items.map(item => [item.id, new Set<string>()]));
  for (const item of items) {
    for (const target of getLinks(item)) {
      contradictions.get(item.id)!.add(target);
      contradictions.get(target)!.add(item.id);
    }
  }
  return new Map(Array.from(contradictions, ([id, links]) => [id, Array.from(links).sort()]));
}

/** Returns comparable *context and cautions*, never a risk score or verified assertion. */
export function assessStructuralContext(input: unknown): StructuralContextAssessment {
  const context = validateStructuralContext(input);
  const contradictorySignals = symmetricContradictions(context.signals, s => s.counterSignalIds);
  const contradictoryScenarios = symmetricContradictions(context.scenarios, s => s.counterScenarioIds);
  const signals: SignalAssessment[] = context.signals.map(signal => {
    const dimensions = [
      aligned(signal.scope.geographies, context.market.geography),
      aligned(signal.scope.industries, context.market.industry),
      aligned(signal.scope.businessModels, context.market.businessModel),
    ];
    const relevance: SignalRelevance = dimensions.includes("mismatch") ? "out-of-scope"
      : dimensions.every(value => value === "matched") ? "matching-scope" : "partial-scope";
    const dateOfEvidence = signal.observedPeriod?.to ?? signal.citation.publishedOn;
    const recency: SignalRecency =
      daysBetween(signal.citation.retrievedOn, context.asOf) < 0 ||
      daysBetween(signal.citation.publishedOn, context.asOf) < 0 ||
      daysBetween(dateOfEvidence, context.asOf) < 0
        ? "not-yet-available"
        : daysBetween(dateOfEvidence, context.asOf) > MAX_CONTEXT_AGE_DAYS ? "stale" : "recent";
    const counterSignalIds = contradictorySignals.get(signal.id)!;
    const cautions = ["A citation link and review-state field do not authenticate a market claim."];
    if (relevance !== "matching-scope") cautions.push(relevance === "out-of-scope"
      ? "Source geography, industry, or business model conflicts with the comparison scope."
      : "Comparison scope is incomplete; do not generalize beyond observed coverage.");
    if (recency === "stale") cautions.push("Evidence period predates the recency threshold; older research is not automatically false.");
    if (recency === "not-yet-available") cautions.push("This claim was not available at the requested as-of date.");
    if (signal.claimKind === "projection") cautions.push("Projected outcome, not an observed company or labor-market change.");
    if (signal.reviewState !== "reviewed") cautions.push("The claim has not passed a completed human metadata review, or is disputed/withdrawn.");
    if (signal.origin === "inference-proposed") cautions.push("Inference proposal is untrusted; independent human source review is required.");
    if (signal.citation.rights === "unclear") cautions.push("Reuse rights unclear; do not quote or redistribute source material.");
    if (counterSignalIds.length) cautions.push("Contradictory source records are attached; neither is automatically adjudicated.");
    if (signal.methodologyLimits.length === 0) cautions.push("No methodological limitations supplied; this does not imply there are none.");
    return {
      signalId: signal.id, layer: signal.layer, claimKind: signal.claimKind, reviewState: signal.reviewState,
      origin: signal.origin, citationRights: signal.citation.rights,
      relevance, recency, counterSignalIds, cautions,
    };
  });
  const byId = new Map(signals.map(s => [s.signalId, s]));
  const scenarios: ScenarioAssessment[] = context.scenarios.map(scenario => {
    const assessed = scenario.signalIds.map(id => byId.get(id)!);
    const contextualSignalIds = assessed.filter(s => (
      s.layer === scenario.layer && s.relevance === "matching-scope" && s.recency === "recent" &&
      s.claimKind === "observation" && s.reviewState === "reviewed" &&
      s.origin !== "inference-proposed" && s.citationRights !== "unclear" &&
      s.counterSignalIds.length === 0
    )).map(s => s.signalId);
    const counterScenarioIds = contradictoryScenarios.get(scenario.id)!;
    const cautions = ["Scenario remains a hypothesis; source metadata does not verify demand, employment or company viability."];
    if (assessed.length === 0) cautions.push("No external evidence records are linked.");
    if (assessed.length && contextualSignalIds.length === 0) cautions.push("No current, precisely in-scope, reviewed uncontested observation is linked.");
    if (assessed.some(s => s.layer !== scenario.layer)) cautions.push("Task-level changes alone do not prove employer viability or industry-wide change; layer-specific observations are required.");
    if (assessed.some(s => s.relevance !== "matching-scope")) cautions.push("One or more sources have incomplete or mismatched sector, geographic, or business-model coverage.");
    if (assessed.some(s => s.recency !== "recent")) cautions.push("Some linked observations are stale or postdate the requested as-of date.");
    if (assessed.some(s => s.claimKind === "projection")) cautions.push("Forecast material is not evidence an outcome occurred.");
    if (assessed.some(s => s.counterSignalIds.length)) cautions.push("Competing signal records are not reconciled.");
    if (counterScenarioIds.length) cautions.push("An alternative, explicitly competing scenario is also recorded.");
    if (scenario.origin === "inference-proposed" || scenario.reviewState !== "reviewed") {
      cautions.push("This hypothesis lacks completed human review; it is not actionable authority.");
    }
    return {
      scenarioId: scenario.id, outcome: scenario.outcome,
      authority: "hypothesis-only", linkedSignalIds: [...scenario.signalIds],
      contextualSignalIds, counterScenarioIds, cautions,
    };
  });
  return {
    asOf: context.asOf, signals, scenarios,
    notice: "Context only. Reviewed metadata does not verify a claim or predict an outcome.",
  };
}
