import assert from "node:assert/strict";
import {
  MAX_CONTEXT_AGE_DAYS, validateStructuralContext, assessStructuralContext,
} from "../src/shared/structural-signals.ts";

// Entire fixture is SYNTHETIC. These are not real companies, observed layoffs
// or authenticated research. Source URLs are inert provenance fields, never fetched.
const baseCitation = {
  url: "https://research.example.org/synthetic/market-structure",
  publisher: "Synthetic Research Institute",
  title: "Synthetic market-structure observations for QA",
  publishedOn: "2026-08-01",
  retrievedOn: "2026-09-01",
  rights: "link-only",
  excerpt: null,
  reuseBasis: null,
};
const baseSignal = {
  id: "s-middleware-entry",
  layer: "business-model",
  event: "market-entry",
  claimKind: "observation",
  claimSummary: "Synthetic example: a smaller market participant entered a middleware segment.",
  citation: baseCitation,
  scope: { geographies: ["United States"], industries: ["Enterprise software"], businessModels: ["SaaS middleware"] },
  observedPeriod: { from: "2026-02-01", to: "2026-07-01" },
  methodologyLimits: ["Synthetic fixture; not real market evidence", "One local observation cannot establish an industry-wide trend"],
  reviewState: "reviewed",
  origin: "research-collection",
  counterSignalIds: [],
};
const competingSignal = {
  ...baseSignal,
  id: "s-middleware-consolidation",
  event: "consolidation",
  claimSummary: "Synthetic counterexample: larger vendors consolidated a middleware segment.",
  citation: { ...baseCitation, url: "https://studies.example.org/synthetic/consolidation" },
  counterSignalIds: ["s-middleware-entry"],
};
const observation = (id, overrides = {}) => ({
  ...baseSignal, id,
  citation: { ...baseCitation, url: "https://research.example.org/synthetic/" + id },
  counterSignalIds: [],
  ...overrides,
});
const entryScenario = {
  id: "h-entry",
  title: "Small firms can enter",
  hypothesis: "Lower tooling costs might permit new competition while incumbents survive.",
  layer: "business-model",
  outcome: "new-entry",
  proposedOn: "2026-09-15",
  origin: "user-entered",
  reviewState: "reviewed",
  signalIds: ["s-middleware-entry"],
  counterScenarioIds: ["h-consolidation"],
};
const consolidationScenario = {
  ...entryScenario,
  id: "h-consolidation",
  title: "Incumbents consolidate",
  hypothesis: "Large vendors might consolidate, despite cheaper entry.",
  outcome: "consolidation",
  signalIds: ["s-middleware-consolidation"],
  counterScenarioIds: [],
};
const base = {
  asOf: "2026-10-09",
  market: { geography: "United States", industry: "Enterprise software", businessModel: "SaaS middleware" },
  signals: [baseSignal, competingSignal],
  scenarios: [entryScenario, consolidationScenario],
};
const clone = value => structuredClone(value);
const mutate = (change) => { const v = clone(base); change(v); return v; };

const before = JSON.stringify(base);
const parsed = validateStructuralContext(base);
assert.notEqual(parsed, base, "validator must return a defensive copy");
assert.notEqual(parsed.signals[0], base.signals[0]);
assert.notEqual(parsed.signals[0].scope.geographies, base.signals[0].scope.geographies);
assert.equal(JSON.stringify(base), before, "validator must not mutate callers");
assert.ok(MAX_CONTEXT_AGE_DAYS >= 365);

const assessment = assessStructuralContext(base);
assert.equal(assessment.scenarios.length, 2);
assert.equal(assessment.scenarios[0].authority, "hypothesis-only");
assert.equal(assessment.scenarios[1].authority, "hypothesis-only");
assert.deepEqual(assessment.scenarios[0].counterScenarioIds, ["h-consolidation"],
  "contradiction recorded once is visible on both sides");
assert.deepEqual(assessment.scenarios[1].counterScenarioIds, ["h-entry"]);
assert.deepEqual(assessment.signals[0].counterSignalIds, ["s-middleware-consolidation"]);
assert.deepEqual(assessment.signals[1].counterSignalIds, ["s-middleware-entry"]);
assert.deepEqual(assessment.scenarios.map(s => s.contextualSignalIds), [[], []],
  "counter-signals are not silently resolved in favor of either scenario");
assert.ok(assessment.scenarios[0].cautions.some(text => /competing/i.test(text)));
assert.ok(assessment.notice.includes("does not verify"));
assert.equal(JSON.stringify(assessment), JSON.stringify(assessStructuralContext(base)),
  "fixed as-of dates ensure reproducible review");
assert.ok(!/\b(score|probability|confidence|riskPct|likelihood)\b/i.test(Object.keys(assessment.scenarios[0]).join(" ")));

const single = assessStructuralContext(mutate(v => {
  v.signals.pop(); v.scenarios.pop();
  v.signals[0].counterSignalIds = []; v.scenarios[0].counterScenarioIds = [];
}));
assert.deepEqual(single.scenarios[0].contextualSignalIds, ["s-middleware-entry"]);
assert.equal(single.scenarios[0].authority, "hypothesis-only",
  "even an aligned reviewed observation does not prove a hypothesis");

// Task-level exposure cannot be promoted to proof that an entire business disappears.
const taskLeap = assessStructuralContext(mutate(v => {
  v.signals = [observation("s-task-exposure", { layer: "task", event: "task-exposure" })];
  v.scenarios = [{ ...entryScenario, outcome: "substitution", signalIds: ["s-task-exposure"], counterScenarioIds: [] }];
}));
assert.deepEqual(taskLeap.scenarios[0].contextualSignalIds, []);
assert.ok(taskLeap.scenarios[0].cautions.some(text => /Task-level changes alone/.test(text)));

// Diverse, genuinely different industry scopes share the same domain contract.
// They assert *relevance and uncertainty*, not made-up real-world job demand.
for (const [industry, model, event, layer] of [
  ["Regulated healthcare", "Outpatient clinic", "regulatory-change", "industry"],
  ["Skilled trades", "Electrical contracting", "employment-change", "task"],
  ["Local services", "Home maintenance", "market-entry", "business-model"],
]) {
  const industrySignal = observation("s-scoped-fixture", {
    layer, event,
    scope: { geographies: ["Annapolis"], industries: [industry], businessModels: [model] },
    methodologyLimits: ["Local synthetic observations cannot justify national conclusions"],
  });
  const context = {
    asOf: "2026-10-09",
    market: { geography: "Annapolis", industry, businessModel: model },
    signals: [industrySignal],
    scenarios: [{
      ...entryScenario, id: "h-scoped-fixture", layer,
      signalIds: ["s-scoped-fixture"], counterScenarioIds: [],
    }],
  };
  const inScope = assessStructuralContext(context);
  assert.equal(inScope.signals[0].relevance, "matching-scope");
  assert.deepEqual(inScope.scenarios[0].contextualSignalIds, ["s-scoped-fixture"]);
  assert.equal(inScope.scenarios[0].authority, "hypothesis-only");
  const wrongIndustry = assessStructuralContext({
    ...context, market: { ...context.market, industry: "Another industry" },
  });
  assert.equal(wrongIndustry.signals[0].relevance, "out-of-scope");
  assert.deepEqual(wrongIndustry.scenarios[0].contextualSignalIds, []);
}

// Matching is literal and explicit. "United States" must not magically imply Maryland.
const mismatch = assessStructuralContext(mutate(v => {
  v.market.geography = "Maryland";
}));
assert.equal(mismatch.signals[0].relevance, "out-of-scope");
assert.deepEqual(mismatch.scenarios[0].contextualSignalIds, []);
const unknownScope = assessStructuralContext(mutate(v => { v.market.geography = null; }));
assert.equal(unknownScope.signals[0].relevance, "partial-scope");
const unknownModel = assessStructuralContext(mutate(v => { v.signals[0].scope.businessModels = []; }));
assert.equal(unknownModel.signals[0].relevance, "partial-scope");

// Old reports are NOT automatically false, but cannot pass current-context filter.
const stale = assessStructuralContext(mutate(v => {
  v.signals = [observation("s-old-observation", {
    citation: { ...baseCitation, publishedOn: "2021-08-01", retrievedOn: "2022-09-01" },
    observedPeriod: { from: "2020-01-01", to: "2021-07-01" },
  })];
  v.scenarios = [{ ...entryScenario, signalIds: ["s-old-observation"], counterScenarioIds: [] }];
}));
assert.equal(stale.signals[0].recency, "stale");
assert.deepEqual(stale.scenarios[0].contextualSignalIds, []);
assert.ok(stale.signals[0].cautions.some(text => /not automatically false/.test(text)));
const future = assessStructuralContext(mutate(v => {
  v.asOf = "2026-06-01";
  v.scenarios = [{ ...entryScenario, proposedOn: "2026-05-01", counterScenarioIds: [] }];
  v.signals = [baseSignal];
}));
assert.equal(future.signals[0].recency, "not-yet-available");
assert.deepEqual(future.scenarios[0].contextualSignalIds, []);

// Projection, even reviewed and current, is not an observed closure/demand shift.
const forecast = assessStructuralContext(mutate(v => {
  v.signals = [observation("s-projected-demand", {
    event: "forecast", claimKind: "projection", observedPeriod: null,
    origin: "research-collection", reviewState: "reviewed",
  })];
  v.scenarios = [{ ...entryScenario, signalIds: ["s-projected-demand"], counterScenarioIds: [] }];
}));
assert.equal(forecast.signals[0].claimKind, "projection");
assert.deepEqual(forecast.scenarios[0].contextualSignalIds, []);
assert.ok(forecast.scenarios[0].cautions.some(text => /Forecast/.test(text)));

// Disputed, withdrawn, unreviewed and inference-produced claims never become
// an automatically eligible observational context.
for (const state of ["unreviewed", "disputed", "withdrawn"]) {
  const result = assessStructuralContext(mutate(v => {
    v.signals = [observation("s-" + state, { reviewState: state })];
    v.scenarios = [{ ...entryScenario, signalIds: ["s-" + state], counterScenarioIds: [] }];
  }));
  assert.deepEqual(result.scenarios[0].contextualSignalIds, []);
}
const proposal = assessStructuralContext(mutate(v => {
  v.signals = [observation("s-inference", { origin: "inference-proposed", reviewState: "unreviewed" })];
  v.scenarios = [{ ...entryScenario, signalIds: ["s-inference"], counterScenarioIds: [] }];
}));
assert.deepEqual(proposal.scenarios[0].contextualSignalIds, []);
assert.ok(proposal.signals[0].cautions.some(text => /Inference proposal is untrusted/.test(text)));

// Citation rights: a link can contextualize a claim, but quoting text requires
// an explicit reuse basis. Even a supplied permission claim is not authentication.
const unknownRights = assessStructuralContext(mutate(v => {
  v.signals = [observation("s-rights-unclear", {
    citation: { ...baseCitation, rights: "unclear", excerpt: null, reuseBasis: null },
  })];
  v.scenarios = [{ ...entryScenario, signalIds: ["s-rights-unclear"], counterScenarioIds: [] }];
}));
assert.deepEqual(unknownRights.scenarios[0].contextualSignalIds, []);
validateStructuralContext(mutate(v => {
  v.signals[0].citation = {
    ...baseCitation, rights: "excerpt-permitted",
    excerpt: "Brief synthetic excerpt with permission.",
    reuseBasis: "Synthetic author permission for fixtures",
  };
}));

const rejects = [
  [v => { v.signals[0].citation.url = "http://research.example.org/page"; }, /public HTTPS/],
  [v => { v.signals[0].citation.url = "https://127.0.0.1/private"; }, /public HTTPS/],
  [v => { v.signals[0].citation.url = "https://localhost/private"; }, /public HTTPS/],
  [v => { v.signals[0].citation.url = "https://someone:secret@research.example.org/post"; }, /public HTTPS/],
  [v => { v.signals[0].citation.url = "https://research.example.org/page#tracking"; }, /public HTTPS/],
  [v => { v.signals[0].citation.excerpt = "Unlicensed quoted passage"; }, /link-only/],
  [v => { v.signals[0].citation.rights = "excerpt-permitted"; }, /Excerpt requires/],
  [v => { v.signals[0].citation.rights = "excerpt-permitted"; v.signals[0].citation.excerpt = "X".repeat(181); }, /180 characters/],
  [v => { v.signals[0].citation.publishedOn = "2026-02-29"; }, /real calendar date/],
  [v => { v.signals[0].citation.retrievedOn = "2026-01-01"; }, /predates publication/],
  [v => { v.signals[0].observedPeriod = { from: "2026-01-01", to: "2026-08-09" }; }, /beyond publication/],
  [v => { v.signals[0].observedPeriod = { from: "2026-07-01", to: "2026-01-01" }; }, /reversed/],
  [v => { v.signals[0].observedPeriod = null; }, /Observation requires/],
  [v => { v.signals[0].event = "forecast"; }, /forecast cannot/],
  [v => { v.signals[0].claimKind = "projection"; }, /Projection cannot/],
  [v => { v.signals[0].reviewState = "reviewed"; v.signals[0].origin = "inference-proposed"; }, /Inference proposals/],
  [v => { v.scenarios[0].origin = "inference-proposed"; }, /Inference hypotheses/],
  [v => { v.signals[0].counterSignalIds = ["missing-signal"]; }, /missing ID/],
  [v => { v.scenarios[0].counterScenarioIds = ["missing-hypothesis"]; }, /missing ID/],
  [v => { v.scenarios[0].signalIds = ["missing-signal"]; }, /missing signal/],
  [v => { v.signals[0].counterSignalIds = ["s-middleware-entry"]; }, /counter itself/],
  [v => { v.scenarios[0].counterScenarioIds = ["h-entry"]; }, /contradict itself/],
  [v => { v.signals.push(clone(v.signals[0])); }, /Duplicate Signal/],
  [v => { v.scenarios.push(clone(v.scenarios[0])); }, /Duplicate Scenario/],
  [v => { v.scenarios[0].proposedOn = "2026-12-01"; }, /Future-dated scenario/],
  [v => { v.signals[0].privateProfileId = "user-personal-data"; }, /unexpected field/],
  [v => { v.market.userSalary = 123000; }, /unexpected field/],
  [v => { v.signals[0].methodologyLimits = ["duplicate", "duplicate"]; }, /duplicate entries/],
  [v => { v.signals[0].scope.geographies = ["", "United States"]; }, /nonblank/],
  [v => { v.signals[0].layer = "company-will-disappear"; }, /invalid value/],
  [v => { v.scenarios[0].outcome = "100-percent-closure"; }, /invalid value/],
  [v => { v.scenarios[0].hypothesis = "x".repeat(401); }, /400 characters/],
  [v => { v.signals = Array.from({ length: 51 }, () => clone(baseSignal)); }, /At most 50/],
  [v => { v.scenarios = Array.from({ length: 13 }, () => clone(entryScenario)); }, /At most 12/],
];
for (const [change, message] of rejects) {
  assert.throws(() => validateStructuralContext(mutate(change)), message, String(change));
}

// A worker's choice to stay employed and an unrelated local service with no
// citable signal are valid, non-ranked hypotheses (not recommendations).
const noSignals = assessStructuralContext({
  asOf: "2026-10-09",
  market: { geography: "Annapolis", industry: "Local services", businessModel: null },
  signals: [],
  scenarios: [
    { ...entryScenario, id: "h-stay-employed", title: "Remain employed", outcome: "unknown",
      layer: "industry", signalIds: [], counterScenarioIds: [] },
    { ...entryScenario, id: "h-local-trade", title: "Explore a licensed local trade",
      outcome: "slow-adoption", layer: "task", signalIds: [], counterScenarioIds: [] },
    { ...entryScenario, id: "h-independent", title: "Independent services",
      outcome: "new-entry", layer: "business-model", signalIds: [], counterScenarioIds: [] },
  ],
});
assert.ok(noSignals.scenarios.every(s => s.authority === "hypothesis-only"));
assert.ok(noSignals.scenarios.every(s => s.contextualSignalIds.length === 0));
assert.ok(noSignals.scenarios.every(s => s.cautions.some(w => /No external evidence/.test(w))));
assert.ok(!("recommended" in noSignals) && !("ranking" in noSignals));
console.log("Structural signals: strict source provenance, scope, chronology, counterevidence and inference boundaries passed");
