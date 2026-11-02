/** Pure, optional arithmetic for user-authored economic transition scenarios.
 * Not Career Evidence, a verified income projection or an AI recommendation.
 */
export type PathwayKind = "employment" | "industry-transition" | "contract" | "self-employment" | "blended" | "retraining";
export interface PathwayOption {
  name: string;
  kind: PathwayKind;
  monthlyGross: number | null;
  monthlyCosts: number | null;
  upfrontCost: number | null;
  monthsToIncome: number | null;
}
export interface PathwayComparison {
  currency: string | null;
  monthlyMinimum: number | null;
  horizonMonths: number | null;
  options: readonly PathwayOption[];
}
export interface PathwayResult {
  name: string;
  kind: PathwayKind;
  monthlyNet: number | null;
  monthlyDifference: number | null;
  beginsWithinHorizon: boolean | null;
  upfrontCost: number | null;
  unknowns: string[];
  questions: string[];
}
const kinds: readonly PathwayKind[] = [
  "employment", "industry-transition", "contract", "self-employment", "blended", "retraining",
];
const question: Record<PathwayKind, string> = {
  employment: "Verify that the role, pay, and benefits are available from a real employer.",
  "industry-transition": "Confirm transferability, licensing, entry requirements, and paid openings in the new sector.",
  contract: "Validate real paying clients, contract duration, taxes, and insurance obligations.",
  "self-employment": "Validate paying customer demand, startup costs, permits, and benefits independently.",
  blended: "Check whether the income sources depend on the same customers, platforms, or industry.",
  retraining: "Check training cost, completion time, credentials, and an income bridge before enrolling.",
};
function validateAmount(value: number | null, label: string): void {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)) {
    throw new Error(label + " must be a finite, nonnegative amount up to 1 billion.");
  }
}
function validateMonths(value: number | null, label: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 600)) {
    throw new Error(label + " must be a whole number between 0 and 600 months.");
  }
}
/** Unknown remains null. Zero means an explicit user-supplied zero, never a fallback. */
export function evaluatePathways(input: PathwayComparison): PathwayResult[] {
  validateAmount(input.monthlyMinimum, "Monthly minimum");
  validateMonths(input.horizonMonths, "Horizon");
  if (input.currency !== null && !/^[A-Z]{3}$/.test(input.currency)) throw Error("Currency must be a three-letter ISO code.");
  if (input.options.length > 2) throw Error("Compare no more than two pathways at a time.");
  return input.options.map(option => {
    if (!kinds.includes(option.kind)) throw Error("Unknown pathway kind.");
    if (option.name.length > 120) throw Error("Pathway name is too long.");
    validateAmount(option.monthlyGross, "Gross monthly estimate");
    validateAmount(option.monthlyCosts, "Recurring monthly costs");
    validateAmount(option.upfrontCost, "Upfront costs");
    validateMonths(option.monthsToIncome, "Time to first income");
    const unknowns: string[] = [];
    if (input.currency === null) unknowns.push("Currency");
    if (input.monthlyMinimum === null) unknowns.push("Monthly income requirement");
    if (input.horizonMonths === null) unknowns.push("Evaluation horizon");
    if (option.monthlyGross === null) unknowns.push("Gross income estimate");
    if (option.monthlyCosts === null) unknowns.push("Costs, taxes and benefits allowance");
    if (option.upfrontCost === null) unknowns.push("Upfront costs");
    if (option.monthsToIncome === null) unknowns.push("Time to first income");
    const monthlyNet = input.currency !== null && option.monthlyGross !== null && option.monthlyCosts !== null
      ? option.monthlyGross - option.monthlyCosts : null;
    const monthlyDifference = monthlyNet !== null && input.monthlyMinimum !== null
      ? monthlyNet - input.monthlyMinimum : null;
    const beginsWithinHorizon = input.horizonMonths !== null && option.monthsToIncome !== null
      ? option.monthsToIncome <= input.horizonMonths : null;
    return {
      name: option.name.trim(), kind: option.kind, monthlyNet, monthlyDifference,
      beginsWithinHorizon, upfrontCost: option.upfrontCost, unknowns,
      questions: [
        question[option.kind],
        "Verify all income and cost assumptions independently; these estimates are not proven earnings.",
      ],
    };
  });
}
