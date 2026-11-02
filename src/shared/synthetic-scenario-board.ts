/**
 * Inert presentation model for FICTIONAL structural-context fixtures only.
 * No network, inference, persistence, user profiling, ranking or authority transfer.
 * This is NOT a production claim-display or evidence review workflow.
 */
import type { StructuralContextBundle, StructuralContextAssessment, ScenarioOutcome } from "./structural-signals.js";

const outcomes: Record<ScenarioOutcome, string> = {
  augmentation: "Work may be augmented",
  substitution: "Some work may be substituted",
  "new-entry": "Smaller competitors may enter",
  consolidation: "Providers may consolidate",
  "slow-adoption": "Adoption may remain limited",
  unknown: "Outcome remains unknown",
};

export interface SyntheticScenarioCard {
  id: string;
  heading: string;
  outcome: string;
  hypothesis: string;
  authority: "hypothesis-only";
  linkedSources: Array<{
    id: string;
    publisher: string;
    publishedOn: string;
    claimKind: "observation" | "projection";
    relevance: string;
    recency: string;
    contested: boolean;
    caution: string[];
  }>;
  counters: string[];
  cautions: string[];
}

export interface SyntheticScenarioBoard {
  label: "FICTIONAL DEMONSTRATION — NOT MARKET EVIDENCE";
  authority: "hypothesis-only";
  cards: SyntheticScenarioCard[];
  notice: string;
}

/** Requires explicit fictional-fixture opt-in even for this inert calculation. */
export function buildSyntheticScenarioBoard(
  context: StructuralContextBundle,
  assessed: StructuralContextAssessment,
  options: { fictionalFixture: true },
): SyntheticScenarioBoard {
  if (options?.fictionalFixture !== true) {
    throw new Error("Synthetic-only scenario board: explicit fixture opt-in required");
  }
  const byId = new Map(assessed.signals.map(s => [s.signalId, s]));
  const signals = new Map(context.signals.map(s => [s.id, s]));
  return {
    label: "FICTIONAL DEMONSTRATION — NOT MARKET EVIDENCE",
    authority: "hypothesis-only",
    cards: context.scenarios.map((scenario, index) => {
      const analysis = assessed.scenarios[index];
      return {
        id: scenario.id,
        heading: scenario.title,
        outcome: outcomes[scenario.outcome],
        hypothesis: scenario.hypothesis,
        authority: "hypothesis-only",
        linkedSources: scenario.signalIds.map(id => {
          const source = signals.get(id)!;
          const status = byId.get(id)!;
          return {
            id,
            publisher: source.citation.publisher,
            publishedOn: source.citation.publishedOn,
            claimKind: status.claimKind,
            relevance: status.relevance,
            recency: status.recency,
            contested: status.counterSignalIds.length > 0,
            caution: [...status.cautions],
          };
        }),
        counters: [...analysis.counterScenarioIds],
        cautions: [...analysis.cautions],
      };
    }),
    notice: "Synthetic examples only. Neither metadata review nor citations establish market facts; no career recommendation is made.",
  };
}
