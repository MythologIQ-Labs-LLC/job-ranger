import { useEffect, useState } from "react";
import { getDesktopApi } from "../services/api";
import type { ManualPostPackage,ManualPublicationReceipt,PersonalBrandDraft } from "../shared/personal-brand";
import type { LearningReport } from "../shared/personal-brand-learning";
import { buildLinkedInTopicCohorts,type LinkedInTopicCohortReport } from "../shared/linkedin-topic-cohorts";

function formatMetric(value:number|null,units:"count"|"rate"):string {
  if(value===null)return "Withheld";
  return units==="rate"?(value*100).toFixed(2)+"%":value.toLocaleString(undefined,{maximumFractionDigits:2});
}
/** A coverage and descriptive review, never an automatic topic performance ranking. */
export function LinkedInTopicCohortSummary({
  learning,publications,prepared,drafts,refreshToken,
}:{
  learning:LearningReport;
  publications:readonly ManualPublicationReceipt[];
  prepared:readonly ManualPostPackage[];
  drafts:readonly PersonalBrandDraft[];
  refreshToken:number;
}) {
  const [report,setReport]=useState<LinkedInTopicCohortReport|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;setReport(null);setError(null);
    void getDesktopApi().personalBrand.listLinkedInTopicLabels()
      .then(events=>buildLinkedInTopicCohorts(learning,publications,prepared,drafts,events))
      .then(result=>{if(alive)setReport(result);})
      .catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:"Topic evidence not available.");});
    return ()=>{alive=false;};
  },[learning,publications,prepared,drafts,refreshToken]);
  return <section className="rounded-xl border border-[var(--color-border)] p-4 space-y-3"
    aria-label="LinkedIn topic cohort coverage" data-testid="linkedin-topic-cohorts">
    <h3 className="font-semibold">Observed topic cohorts</h3>
    <p className="text-sm text-[var(--color-text-secondary)]">
      User-confirmed topics only. Comparisons require identical recorded hook, format,
      objective, target-audience labels and metric source, plus comparable post ages.
      This view never infers a topic or declares what caused an engagement difference.
    </p>
    {error && <p role="alert">{error}</p>}
    {!error && !report && <p role="status">Validating topic coverage...</p>}
    {report && <>
      <p className="text-sm" data-testid="topic-coverage">
        {report.singleTopicLabeled} single-topic, age-matched posts from {report.totalObserved} recorded observations.
        {" "}{report.originalVerified} with fingerprint-verified original copy,
        {" "}{report.withoutValidTopic} without eligible topic assertions,
        {" "}{report.multiTopicExcluded} with multiple labels withheld,
        {" "}{report.ageExcluded} outside the stricter comparison-age window.
      </p>
      <p className="text-sm" data-testid="topic-comparison-count">
        {report.eligibleComparisons} descriptive topic comparison group(s) supported at
        {" "}{report.ageHours} hours using {report.metric.replaceAll("_"," ")}.
        Minimum {report.minimumPerTopic} distinct posts per topic.
      </p>
      {report.contexts.length===0&&<p className="text-sm">
        No eligible labeled context yet. Attach user-reviewed topics to confirmed posts,
        then collect same-age individual-post measurements.
      </p>}
      <div className="space-y-3">
        {report.contexts.slice(0,6).map(context=><article key={context.contextId}
          className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
          <p className="text-sm font-semibold">
            {context.objective.replaceAll("_"," ")} · {context.format} · {context.hook.replaceAll("_"," ")}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Recorded audiences: {context.audiences.join(", ")} · Source: {context.sourceLabel}
            {" "}· States: {context.observationStates.join(", ")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left">
                <th scope="col" className="p-2">User topic</th>
                <th scope="col" className="p-2">Posts</th>
                <th scope="col" className="p-2">Median</th>
                <th scope="col" className="p-2">Observed range</th>
              </tr></thead>
              <tbody>{context.cohorts.map(cohort=><tr key={cohort.topic}
                className="border-t border-[var(--color-border)]">
                <th scope="row" className="p-2 text-left font-normal">{cohort.topic}</th>
                <td className="p-2">{cohort.count}</td>
                <td className="p-2">{formatMetric(cohort.median,report.units)}</td>
                <td className="p-2">{cohort.withheld?"Withheld":
                  formatMetric(cohort.min,report.units)+" to "+formatMetric(cohort.max,report.units)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">{context.caveat}</p>
        </article>)}
        {report.contexts.length>6&&<p className="text-xs">Showing six of {report.contexts.length} contexts.</p>}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Qualification and uncertainty ({report.caveats.length})</summary>
        <ul className="list-disc pl-5 text-xs space-y-1">
          {report.caveats.map(reason=><li key={reason}>{reason}</li>)}
        </ul>
      </details>
    </>}
  </section>;
}
