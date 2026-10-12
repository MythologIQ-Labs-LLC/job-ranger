import { useEffect, useState } from "react";
import type { ManualPostPackage, ManualPublicationReceipt, PersonalBrandDraft } from "../shared/personal-brand";
import type { LearningReport } from "../shared/personal-brand-learning";
import {
  compareLinkedInApprovedPostContexts,
  type ApprovedPostCohortReport,
  type ApprovedPostCohortMember,
} from "../shared/linkedin-approved-content-cohorts";

function metric(value:number,units:"rate"|"count"):string {
  return units==="rate" ? (value*100).toFixed(2)+"%" : value.toLocaleString();
}
function ContextPost({post,units}:{post:ApprovedPostCohortMember;units:"rate"|"count"}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-2 min-w-0">
      <p className="text-sm font-semibold">
        {post.hook.replaceAll("_"," ")} · {metric(post.value,units)}
      </p>
      <p className="text-xs text-[var(--color-text-secondary)]">
        {post.observedAgeHours.toFixed(1)} hours after publication · {post.sourceLabel}
      </p>
      <a className="text-xs underline break-all" href={post.publishedUrl}
        rel="noopener noreferrer" target="_blank">Original post permalink</a>
      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">Inspect fingerprint-verified approved copy</summary>
        <p className="mt-2 whitespace-pre-wrap break-words">{post.approvedCopy}</p>
      </details>
    </div>
  );
}
export function LinkedInApprovedContentCohorts({
  learning,publications,prepared,drafts,
}:{
  learning:LearningReport;
  publications:readonly ManualPublicationReceipt[];
  prepared:readonly ManualPostPackage[];
  drafts:readonly PersonalBrandDraft[];
}) {
  const [result,setResult]=useState<ApprovedPostCohortReport|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    setResult(null);setError(null);
    void compareLinkedInApprovedPostContexts(learning,publications,prepared,drafts)
      .then(data=>{if(active)setResult(data);})
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Cannot verify original copy.");});
    return ()=>{active=false;};
  },[learning,publications,prepared,drafts]);
  return (
    <section className="rounded-xl border border-[var(--color-border)] p-4 space-y-3"
      data-testid="linkedin-approved-content-cohorts" aria-label="Original post copy comparison candidates">
      <h3 className="font-semibold">Review hook contrasts with original post context</h3>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Only individual-post observations at comparable ages with intact original,
        human-approved copy are eligible. TOP POSTS XLSX rankings are excluded,
        since they do not provide a consistent time since publication.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      {!result && !error && <p role="status" className="text-sm">Checking content provenance...</p>}
      {result && (
        <>
          <p className="text-sm">
            <strong>{result.verifiedContext}</strong> of {result.observations} posts
            have verified original copy and age-comparable observations;
            {" "}<strong>{result.candidates.length}</strong> hook-contrast review candidates.
          </p>
          {result.candidates.length===0 ? (
            <p className="text-sm">
              No supported hook contrast yet. Record two original Job Ranger-reviewed posts
              with matched-age snapshots, retained approved text, and explicit hook labels.
              No winner is identified.
            </p>
          ) : (
            <div className="space-y-3">
              {result.candidates.slice(0,5).map(pair=>(
                <article key={pair.first.postId+"|"+pair.second.postId}
                  className="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
                  <p className="text-xs font-semibold">
                    Candidate comparison only · {result.ageHours}-hour observation · {result.metric.replaceAll("_"," ")}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ContextPost post={pair.first} units={result.units}/>
                    <ContextPost post={pair.second} units={result.units}/>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)]">{pair.caveat}</p>
                </article>
              ))}
              {result.candidates.length>5 && <p className="text-xs">Showing 5 of {result.candidates.length} candidate pairs.</p>}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Provenance and comparison limits ({result.reasons.length})</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-[var(--color-text-secondary)]">
              {result.reasons.map(reason=><li key={reason}>{reason}</li>)}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
