import { useMemo } from "react";
import type { LinkedInReconciliationReport } from "../shared/linkedin-reconciliation";
import { buildLinkedInObservedDashboard, type LinkedInTrendMetric } from "../shared/linkedin-observed-dashboard";

const titles:Record<LinkedInTrendMetric,string>={
 impressions:"Impressions",
 engagements:"Engagements",
 newFollowers:"New followers",
};
function number(value:number|null){return value===null?"Unavailable":value.toLocaleString();}
function statusDescription(quality:string):string{
  switch(quality){
    case "complete": return "7 of 7 reported days";
    case "conflict": return "Conflicting observations";
    case "missing": return "Missing daily observations";
    default: return "Insufficient history";
  }
}
export function LinkedInObservedDashboard({report}:{report:LinkedInReconciliationReport}){
  const data=useMemo(()=>buildLinkedInObservedDashboard(report),[report]);
  return (
    <section className="rounded-xl border border-[var(--color-border)] p-4 space-y-3"
      aria-label="Observed LinkedIn performance dashboard"
      data-testid="linkedin-observed-dashboard">
      <h3 className="font-semibold">Observed LinkedIn performance</h3>
      <p className="text-sm text-[var(--color-text-secondary)]">{data.statement}</p>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Source: {data.sources} locally saved manual XLSX export(s). Disputed dates are never
        silently resolved. Ranking metrics and reactions are not interchangeable with daily engagement totals.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {data.comparisons.map(item=>(
          <div key={item.metric} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2"
            data-testid={`linkedin-weekly-${item.metric}`}>
            <h4 className="text-sm font-semibold">{titles[item.metric]}</h4>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--color-text-secondary)]">Latest 7 days</dt>
                <dd className="font-semibold">{number(item.latest.value)}</dd>
                <dd className="text-xs text-[var(--color-text-secondary)]">{statusDescription(item.latest.quality)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-secondary)]">Previous 7 days</dt>
                <dd className="font-semibold">{number(item.previous.value)}</dd>
                <dd className="text-xs text-[var(--color-text-secondary)]">{statusDescription(item.previous.quality)}</dd>
              </div>
            </dl>
            <p className="text-xs">
              {item.absoluteDifference===null ? "Change unavailable" :
                `${item.absoluteDifference>0?"+":""}${item.absoluteDifference.toLocaleString()} over prior window`}
              {item.percentageDifference===null?"":` (${item.percentageDifference>0?"+":""}${item.percentageDifference.toFixed(1)}%)`}
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">{item.note}</p>
            {item.latest.end && <p className="text-xs text-[var(--color-text-secondary)]">
              {item.previous.start} to {item.previous.end} compared with {item.latest.start} to {item.latest.end}.
            </p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        These are historical calendar-aligned observations, not predictions, post-level causal attribution,
        recruiter interest, job offers, or evidence of employment outcomes. Partial TOP POSTS lists do not establish
        the best-performing content across all posts.
      </p>
    </section>
  );
}
