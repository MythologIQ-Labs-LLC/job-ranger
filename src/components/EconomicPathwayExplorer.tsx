import { useMemo, useState } from "react";
import { evaluatePathways, type PathwayKind, type PathwayOption } from "../shared/economic-pathways";

type Draft = { name: string; kind: PathwayKind; monthlyGross: string; monthlyCosts: string; upfrontCost: string; monthsToIncome: string };
const kinds: { id: PathwayKind; label: string }[] = [
  { id: "employment", label: "Continued employment" },
  { id: "industry-transition", label: "Different industry or occupation" },
  { id: "contract", label: "Contract or fractional work" },
  { id: "self-employment", label: "Self-employment or small business" },
  { id: "blended", label: "Mix of income sources" },
  { id: "retraining", label: "Training or learning bridge" },
];
const empty = (kind: PathwayKind): Draft => ({
  name: "", kind, monthlyGross: "", monthlyCosts: "", upfrontCost: "", monthsToIncome: "",
});
const numeric = (value: string): number | null => value.trim() === "" ? null : Number(value);

export function EconomicPathwayExplorer() {
  const [currency, setCurrency] = useState("");
  const [monthlyMinimum, setMonthlyMinimum] = useState("");
  const [horizon, setHorizon] = useState("");
  const [drafts, setDrafts] = useState<[Draft, Draft]>([empty("employment"), empty("industry-transition")]);
  const update = (index: 0 | 1, field: keyof Draft, value: string) => {
    setDrafts(current => {
      const next: [Draft, Draft] = [{ ...current[0] }, { ...current[1] }];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };
  const assessment = useMemo(() => {
    try {
      const options: PathwayOption[] = drafts.map(draft => ({
        name: draft.name,
        kind: draft.kind,
        monthlyGross: numeric(draft.monthlyGross),
        monthlyCosts: numeric(draft.monthlyCosts),
        upfrontCost: numeric(draft.upfrontCost),
        monthsToIncome: numeric(draft.monthsToIncome),
      }));
      return { rows: evaluatePathways({
        currency: currency || null,
        monthlyMinimum: numeric(monthlyMinimum),
        horizonMonths: numeric(horizon),
        options,
      }), error: null as string | null };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : "Invalid pathway assumptions" };
    }
  }, [currency, monthlyMinimum, horizon, drafts]);
  const money = (value: number) => new Intl.NumberFormat(undefined, {
    style: "currency", currency: currency || "USD", maximumFractionDigits: 2,
  }).format(value);
  return (
    <section className="panel panel-strong mt-6 p-6 sm:p-8" aria-labelledby="economic-pathway-heading">
      <span className="metric-label">Optional · unsaved exploration</span>
      <h2 id="economic-pathway-heading" className="mt-2 text-xl font-semibold">Explore other ways to earn</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
        Compare two paths you choose, including continued employment, changing industries, contract work,
        or working for yourself. Job Ranger performs arithmetic using only your estimates.
        It does not predict employer failure, customer demand, future income, or recommend a path.
      </p>
      <p className="mt-3 text-sm font-semibold text-[var(--color-warning)]">
        Not saved: navigating away or reloading discards this comparison. Your Career Evidence,
        applications and Target Tracks are never modified. Estimates are hypothetical, not verified earnings or financial advice.
      </p>
      <details className="mt-5">
        <summary className="cursor-pointer font-semibold text-[var(--color-primary)]">Open pathway comparison</summary>
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label><span className="metric-label">Currency for both options</span>
              <select className="select-shell mt-2" aria-label="Comparison currency"
                value={currency} onChange={event => setCurrency(event.target.value)}>
                <option value="">Select currency</option>
                {["USD", "CAD", "EUR", "GBP", "AUD", "INR"].map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <label><span className="metric-label">Minimum sustainable monthly income</span>
              <input className="input-shell mt-2" aria-label="Minimum sustainable monthly income" type="number"
                min="0" max="1000000000" step="any" value={monthlyMinimum}
                onChange={event => setMonthlyMinimum(event.target.value)} placeholder="Unknown" />
            </label>
            <label><span className="metric-label">Evaluation horizon in months</span>
              <input className="input-shell mt-2" aria-label="Evaluation horizon in months" type="number"
                min="0" max="600" step="1" value={horizon}
                onChange={event => setHorizon(event.target.value)} placeholder="Not specified" />
            </label>
          </div>
          {assessment.error && <p className="support-note px-4 py-3 text-[var(--color-danger)]" role="alert">{assessment.error}</p>}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {drafts.map((draft, index) => {
              const key = index as 0 | 1;
              const prefix = index === 0 ? "Path A" : "Path B";
              const result = assessment.rows[index];
              return (
                <article key={prefix} className="panel panel-muted p-4 sm:p-5" aria-label={prefix + " comparison"}>
                  <h3 className="font-semibold">{prefix}</h3>
                  <div className="mt-4 grid gap-3">
                    <label><span className="metric-label">Name this option</span>
                      <input className="input-shell mt-2" aria-label={prefix + " name"} maxLength={120}
                        value={draft.name} onChange={event => update(key, "name", event.target.value)} />
                    </label>
                    <label><span className="metric-label">Type of pathway</span>
                      <select className="select-shell mt-2" aria-label={prefix + " type"}
                        value={draft.kind} onChange={event => update(key, "kind", event.target.value)}>
                        {kinds.map(kind => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                      </select>
                    </label>
                    {([
                      ["monthlyGross", "Monthly gross income estimate", "monthly gross income"],
                      ["monthlyCosts", "Monthly costs, taxes, benefits allowance", "monthly costs"],
                      ["upfrontCost", "One-time setup or transition costs", "upfront costs"],
                      ["monthsToIncome", "Months to first income", "months to first income"],
                    ] as const).map(([field, label, suffix]) => (
                      <label key={field}><span className="metric-label">{label}</span>
                        <input className="input-shell mt-2" aria-label={prefix + " " + suffix}
                          type="number" min="0" max={field === "monthsToIncome" ? 600 : 1000000000}
                          step={field === "monthsToIncome" ? "1" : "any"} value={draft[field]}
                          onChange={event => update(key, field, event.target.value)} />
                      </label>
                    ))}
                  </div>
                  {result && (
                    <div className="mt-5 space-y-3 border-t border-[var(--color-border)] pt-4"
                      aria-label={prefix + " calculated assessment"}>
                      <h4 className="font-semibold">What your assumptions show</h4>
                      <p className="text-sm">Monthly net estimate: <strong>{result.monthlyNet === null ? "Unknown" : money(result.monthlyNet)}</strong></p>
                      <p className="text-sm">Difference from monthly minimum: <strong>{result.monthlyDifference === null
                        ? "Unknown" : (result.monthlyDifference >= 0 ? "+" : "−") + money(Math.abs(result.monthlyDifference))}</strong></p>
                      <p className="text-sm">Income starts inside your chosen horizon: <strong>{result.beginsWithinHorizon === null
                        ? "Unknown" : result.beginsWithinHorizon ? "Yes, based on your estimate" : "Not on your timeline"}</strong></p>
                      <p className="text-sm">Upfront costs (not included in monthly net): <strong>{result.upfrontCost === null || !currency
                        ? "Unknown" : money(result.upfrontCost)}</strong></p>
                      {result.unknowns.length > 0 && <div className="text-sm">
                        <h5 className="font-semibold">Still unknown</h5>
                        <ul className="ml-5 mt-1 list-disc space-y-1">
                          {result.unknowns.map(value => <li key={value}>{value}</li>)}
                        </ul>
                      </div>}
                      <div className="text-sm">
                        <h5 className="font-semibold">Questions to verify</h5>
                        <ul className="ml-5 mt-1 list-disc space-y-1">
                          {result.questions.map(value => <li key={value}>{value}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <button className="secondary-button" type="button" onClick={() => {
            setCurrency(""); setMonthlyMinimum(""); setHorizon("");
            setDrafts([empty("employment"), empty("industry-transition")]);
          }}>Clear comparison</button>
          <p className="text-xs text-[var(--color-text-muted)]">
            Different net estimates do not measure probability of employment, business success, industry stability, or life suitability.
            Independently verify customer demand, licensing, benefits, and family constraints.
          </p>
        </div>
      </details>
    </section>
  );
}
