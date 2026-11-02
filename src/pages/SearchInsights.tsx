import { BarChart3, Lightbulb, TriangleAlert } from "lucide-react";
import { useSearchLearning } from "../career/application-insights";
import { Layout } from "../components/Layout";
import type { LearningGroupDimension, OutcomeGroup } from "../shared/application-insights";

const dimensionLabels: Record<LearningGroupDimension, string> = {
  "target-track": "Target tracks",
  "source-type": "Source types",
  "source-class": "Source classes",
  "opportunity-category": "Opportunity categories",
};

function OutcomeTable({ groups }: { groups: OutcomeGroup[] }) {
  if (groups.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No observed history in this category yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          <tr><th className="py-2 pr-4">Group</th><th>Tracked</th><th>Current applied</th><th>Interview activity</th><th>Offer activity</th><th>Rejected</th></tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={`${group.dimension}:${group.key}`} className="border-t border-[var(--color-border)]">
              <td className="py-3 pr-4 font-medium text-[var(--color-text-primary)]">{group.label}</td>
              <td>{group.tracked}</td><td>{group.applied}</td><td>{group.interviews}</td><td>{group.offers}</td><td>{group.rejections}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchInsights() {
  const { snapshot, loading, error } = useSearchLearning();

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <span className="alpha-pill"><BarChart3 className="h-3.5 w-3.5" /> Search history</span>
        <h1 className="page-title mt-4">See what your saved search history actually shows.</h1>
        <p className="page-copy">
          These are local observations from applications you tracked in Sojourner. They are not market benchmarks, causal claims, or quotas for how many jobs a human being should fling into the internet.
        </p>
      </section>

      {error && <section className="support-note mt-6 px-5 py-4 text-sm text-[var(--color-danger)]">{error}</section>}
      {loading && <section className="panel panel-strong mt-8 p-6 text-sm text-[var(--color-text-secondary)]">Reading saved application history...</section>}

      {snapshot && (
        <div className="mt-8 space-y-8">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {([
              ["Tracked", snapshot.totals.tracked],
              ["Current applied", snapshot.totals.applied],
              ["Interview activity", snapshot.totals.interviews],
              ["Offer activity", snapshot.totals.offers],
              ["Rejected", snapshot.totals.rejections],
              ["Withdrawn", snapshot.totals.withdrawals],
            ] as const).map(([label, value]) => (
              <div key={label} className="panel panel-strong p-4">
                <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{value}</div>
                <div className="mt-1 text-xs text-[var(--color-text-muted)]">{label}</div>
              </div>
            ))}
          </section>

          <section className="panel panel-strong p-6">
            <div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-[var(--color-primary)]" /><h2 className="text-xl font-semibold">Recurring evidence gaps</h2></div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Requirements that appear unsupported or ambiguous across more than one tracked application. A gap is not proof that you lack the capability.</p>
            <div className="mt-4 space-y-3">
              {snapshot.repeatedGaps.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">No recurring gap pattern is established yet.</p>
              ) : snapshot.repeatedGaps.map((gap) => (
                <div key={gap.key} className="rounded-2xl border border-[var(--color-border)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-text-primary)]">{gap.label}</span>
                    <span className="soft-badge">{gap.applicationCount} applications</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    {gap.requirementCount} matching requirement{gap.requirementCount === 1 ? "" : "s"}
                    {gap.examples.length ? ` · seen in ${gap.examples.join(", ")}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel panel-strong p-6">
            <div className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-[var(--color-primary)]" /><h2 className="text-xl font-semibold">Strategy signals</h2></div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Sojourner separates the observation from any suggested next step and leaves your evidence and target tracks untouched.</p>
            <div className="mt-4 space-y-4">
              {snapshot.strategySignals.map((signal) => (
                <div key={signal.id} className="rounded-2xl border border-[var(--color-border)] p-4">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Observation</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{signal.observation}</p>
                  {signal.recommendation && <><p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">Possible next step</p><p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{signal.recommendation}</p></>}
                  <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">{signal.caveat}</p>
                </div>
              ))}
            </div>
          </section>

          {(["target-track", "source-class", "source-type", "opportunity-category"] as const).map((dimension) => (
            <section key={dimension} className="panel panel-strong p-6">
              <h2 className="text-xl font-semibold">{dimensionLabels[dimension]}</h2>
              <p className="mt-2 mb-4 text-sm text-[var(--color-text-secondary)]">Observed application state grouped only by data Sojourner actually saved.</p>
              <OutcomeTable groups={snapshot.outcomeGroups.filter((group) => group.dimension === dimension)} />
            </section>
          ))}
        </div>
      )}
    </Layout>
  );
}
