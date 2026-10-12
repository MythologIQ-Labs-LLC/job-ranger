import assert from "node:assert/strict";
import { evaluatePathways } from "../src/shared/economic-pathways.ts";

const empty = { name: "", kind: "employment", monthlyGross: null, monthlyCosts: null, upfrontCost: null, monthsToIncome: null };
const base = { currency: null, monthlyMinimum: null, horizonMonths: null, options: [empty] };
const unknown = evaluatePathways(base)[0];
assert.equal(unknown.monthlyNet, null);
assert.equal(unknown.monthlyDifference, null);
assert.equal(unknown.beginsWithinHorizon, null);
assert.ok(unknown.unknowns.includes("Currency"));
assert.ok(unknown.unknowns.includes("Costs, taxes and benefits allowance"));

const employment = { name: "Immediate bridge", kind: "employment", monthlyGross: 4700, monthlyCosts: 650, upfrontCost: 0, monthsToIncome: 1 };
const independent = { name: "Own practice", kind: "self-employment", monthlyGross: 6200, monthlyCosts: 1800, upfrontCost: 5500, monthsToIncome: 8 };
const complete = { currency: "USD", monthlyMinimum: 4000, horizonMonths: 3, options: [employment, independent] };
const compared = evaluatePathways(complete);
assert.deepEqual(compared.map(x => x.monthlyNet), [4050, 4400]);
assert.deepEqual(compared.map(x => x.monthlyDifference), [50, 400]);
assert.deepEqual(compared.map(x => x.beginsWithinHorizon), [true, false]);
assert.equal(compared[1].upfrontCost, 5500);
assert.equal(compared[1].unknowns.length, 0);
assert.ok(compared[1].questions[0].includes("paying customer demand"));
assert.ok(!JSON.stringify(compared).includes("probability"));
assert.ok(!JSON.stringify(compared).includes("recommendation"));

const zero = evaluatePathways({ currency: "USD", monthlyMinimum: 0, horizonMonths: 0, options: [{
  ...empty, monthlyGross: 0, monthlyCosts: 0, upfrontCost: 0, monthsToIncome: 0,
}] })[0];
assert.deepEqual([zero.monthlyNet, zero.monthlyDifference, zero.beginsWithinHorizon], [0, 0, true]);
const incomplete = evaluatePathways({ ...complete, options: [{ ...employment, monthlyCosts: null }] })[0];
assert.equal(incomplete.monthlyNet, null);
assert.equal(incomplete.monthlyDifference, null);
assert.ok(incomplete.unknowns.includes("Costs, taxes and benefits allowance"));
assert.equal(JSON.stringify(evaluatePathways(complete)), JSON.stringify(evaluatePathways(complete)));

for (const value of [-1, NaN, Infinity, 1e15]) {
  assert.throws(() => evaluatePathways({ ...base, monthlyMinimum: value }), /finite, nonnegative/);
  assert.throws(() => evaluatePathways({ ...complete, options: [{ ...employment, monthlyGross: value }] }), /finite, nonnegative/);
}
for (const value of [-1, 1.5, 601]) {
  assert.throws(() => evaluatePathways({ ...base, horizonMonths: value }), /whole number/);
  assert.throws(() => evaluatePathways({ ...complete, options: [{ ...employment, monthsToIncome: value }] }), /whole number/);
}
assert.throws(() => evaluatePathways({ ...base, currency: "fake-string" }), /Currency/);
assert.throws(() => evaluatePathways({ ...base, options: [empty, empty, empty] }), /no more than two/);
assert.throws(() => evaluatePathways({ ...base, options: [{ ...empty, kind: "AI-proof-guarantee" }] }), /Unknown pathway/);
assert.throws(() => evaluatePathways({ ...base, options: [{ ...empty, name: "A".repeat(121) }] }), /too long/);
console.log("Economic pathways: deterministic optional comparison contract passed");
