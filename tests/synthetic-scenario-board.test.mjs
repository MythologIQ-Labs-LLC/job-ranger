import assert from "node:assert/strict";
import { buildSyntheticScenarioBoard } from "../src/shared/synthetic-scenario-board.ts";
import { validateStructuralContext, assessStructuralContext } from "../src/shared/structural-signals.ts";
const build = (data, options) => buildSyntheticScenarioBoard(validateStructuralContext(data), assessStructuralContext(data), options);

const citation = (id) => ({
  url: "https://example.org/synthetic/" + id,
  publisher: "Fictional Publisher", title: "Synthetic study",
  publishedOn: "2026-08-01", retrievedOn: "2026-09-01",
  rights: "link-only", excerpt: null, reuseBasis: null,
});
const signal = (id, event, counterSignalIds = []) => ({
  id, layer: "business-model", event, claimKind: "observation",
  claimSummary: "Synthetic example, not a real finding.",
  citation: citation(id),
  scope: { geographies: ["United States"], industries: ["Software"], businessModels: ["Services"] },
  observedPeriod: { from: "2026-04-01", to: "2026-07-01" },
  methodologyLimits: ["Entirely fictional fixture"],
  reviewState: "reviewed", origin: "research-collection", counterSignalIds,
});
const scenario = (id, outcome, signalIds, counterScenarioIds = []) => ({
  id, title: id, hypothesis: "A fictional possible outcome",
  layer: "business-model", outcome, proposedOn: "2026-09-02",
  origin: "user-entered", reviewState: "reviewed", signalIds, counterScenarioIds,
});
const input = {
  asOf: "2026-10-09",
  market: { geography: "United States", industry: "Software", businessModel: "Services" },
  signals: [signal("s-entry", "market-entry"), signal("s-consolidation", "consolidation", ["s-entry"])],
  scenarios: [scenario("h-entry", "new-entry", ["s-entry"], ["h-consolidation"]),
              scenario("h-consolidation", "consolidation", ["s-consolidation"])],
};
const before = JSON.stringify(input);
assert.throws(() => build(input, {}), /explicit fixture/);
const board = build(input, { fictionalFixture: true });
assert.equal(board.cards.length, 2);
assert.equal(board.authority, "hypothesis-only");
assert.match(board.label, /FICTIONAL/);
assert.deepEqual(board.cards[0].counters, ["h-consolidation"]);
assert.deepEqual(board.cards[1].counters, ["h-entry"]);
assert.ok(board.cards[0].linkedSources[0].contested);
assert.ok(board.cards[1].linkedSources[0].contested);
assert.ok(!("score" in board.cards[0]));
assert.ok(!("recommended" in board.cards[0]));
assert.equal(JSON.stringify(input), before);
const empty = build({ ...input, signals: [], scenarios: [scenario("h-unknown", "unknown", [])] }, { fictionalFixture: true });
assert.equal(empty.cards[0].linkedSources.length, 0);
assert.ok(empty.cards[0].cautions.some(s => /No external evidence/.test(s)));
const changed = structuredClone(input);
changed.market.geography = "Maryland";
assert.equal(build(changed, { fictionalFixture: true }).cards[0].linkedSources[0].relevance, "out-of-scope");
console.log("Synthetic-only scenario board contract passed");
