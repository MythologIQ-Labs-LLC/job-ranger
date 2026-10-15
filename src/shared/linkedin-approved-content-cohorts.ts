/**
 * Reviewed content context for SAME-AGE per-post observations.
 *
 * Aggregated LinkedIn XLSX TOP POSTS lists have no post-age observation end,
 * so they never enter this model. Content comes solely from the original
 * human-approved package with a recomputed byte-exact fingerprint.
 *
 * A pair is a review candidate, NOT a controlled experiment. Topics are
 * unrecorded and never inferred from prose.
 */
import type {
  HookArchetype, ManualPostPackage, ManualPublicationReceipt,
  PersonalBrandDraft, PostFormat, PresenceObjective,
} from "./personal-brand.js";
import type { LearningReport } from "./personal-brand-learning.js";

export interface ApprovedPostCohortMember {
  postId: string;
  publishedUrl: string;
  publishedAt: string;
  observedAgeHours: number;
  value: number;
  sourceLabel: string;
  states: string[];
  hook: HookArchetype;
  format: PostFormat;
  objective: PresenceObjective;
  audiences: string[];
  approvedCopy: string;
  hypothesis: string;
  sourceFingerprint: string;
}
export interface ApprovedPostComparison {
  first: ApprovedPostCohortMember;
  second: ApprovedPostCohortMember;
  changedVariable: "hook";
  classification: "review-only-not-controlled";
  caveat: string;
}
export interface ApprovedPostCohortReport {
  metric: string;
  units: "count" | "rate";
  ageHours: number;
  observations: number;
  verifiedContext: number;
  excluded: number;
  candidates: ApprovedPostComparison[];
  authority: "fingerprint-checked-approved-copy-and-manual-observations";
  reasons: string[];
}
async function digestCopy(body:string):Promise<string> {
  const bytes=new TextEncoder().encode(body);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function audienceKey(audiences:readonly string[]):string|null {
  const values=[...new Set(audiences.map(s=>s.trim().toLowerCase()).filter(Boolean))].sort();
  return values.length ? JSON.stringify(values) : null;
}
export async function verifiedApprovedPostMembers(
  learning: LearningReport,
  receipts: readonly ManualPublicationReceipt[],
  packages: readonly ManualPostPackage[],
  drafts: readonly PersonalBrandDraft[],
): Promise<ApprovedPostCohortMember[]> {
  if (learning.rows.length > 500 || receipts.length > 1000 ||
      packages.length > 1000 || drafts.length > 1000) {
    throw new Error("Too many records in post content comparison.");
  }
  const receiptsByPost=new Map<string,ManualPublicationReceipt[]>();
  for(const receipt of receipts){
    if(receipt.destination!=="linkedin" || receipt.source!=="user_confirmed")continue;
    const group=receiptsByPost.get(receipt.postId)??[];
    group.push(receipt);
    receiptsByPost.set(receipt.postId,group);
  }
  const candidates:ApprovedPostCohortMember[]=[];
  for (const row of learning.rows) {
    if(row.status!=="included" || row.value===null ||
       !Number.isFinite(row.value) || row.value<0 ||
       row.observedAgeHours===null || !Number.isFinite(row.observedAgeHours) ||
       !row.sourceLabel || !row.states.length || !row.metadataCurrent)continue;
    const matching=receiptsByPost.get(row.postId)??[];
    if(matching.length!==1)continue;
    const receipt=matching[0];
    if(row.publishedAt!==receipt.publishedAt ||
       row.publishedUrl!==receipt.publishedUrl)continue;
    const originals=packages.filter(pkg=>pkg.draftId===receipt.draftId &&
      pkg.approvedRevision===receipt.approvedRevision && pkg.destination==="linkedin" &&
      pkg.humanReviewConfirmed===true && pkg.status==="prepared_for_manual_copy");
    if(originals.length!==1 || originals[0].sha256!==receipt.contentSha256)continue;
    const original=originals[0];
    if(await digestCopy(original.body)!==original.sha256)continue;
    const versions=drafts.filter(d=>d.id===receipt.draftId &&
      d.revision===receipt.approvedRevision && d.destination==="linkedin" &&
      d.body===original.body);
    if(versions.length!==1)continue;
    const draft=versions[0];
    if(!draft.hookArchetype || !draft.objective || !audienceKey(draft.audiences))continue;
    candidates.push({
      postId:receipt.postId,publishedUrl:row.publishedUrl,publishedAt:row.publishedAt,
      observedAgeHours:row.observedAgeHours,value:row.value,
      sourceLabel:row.sourceLabel,states:[...row.states],
      hook:draft.hookArchetype,format:draft.format,objective:draft.objective,
      audiences:[...draft.audiences],approvedCopy:original.body,hypothesis:draft.hypothesis,
      sourceFingerprint:receipt.contentSha256,
    });
  }
  candidates.sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt)||a.postId.localeCompare(b.postId));
  return candidates;
}

export async function compareLinkedInApprovedPostContexts(
  learning: LearningReport,
  receipts: readonly ManualPublicationReceipt[],
  packages: readonly ManualPostPackage[],
  drafts: readonly PersonalBrandDraft[],
): Promise<ApprovedPostCohortReport> {
  const candidates=await verifiedApprovedPostMembers(learning,receipts,packages,drafts);
  const comparisons:ApprovedPostComparison[]=[];
  const ageTolerance=learning.targetAgeHours===24?2:learning.targetAgeHours===48?4:8;
  for(let i=0;i<candidates.length;i++){
    for(let j=i+1;j<candidates.length;j++){
      const a=candidates[i],b=candidates[j];
      if(a.hook===b.hook || a.objective!==b.objective || a.format!==b.format ||
         audienceKey(a.audiences)!==audienceKey(b.audiences) ||
         a.sourceLabel!==b.sourceLabel || a.states.join("|")!==b.states.join("|") ||
         Math.abs(a.observedAgeHours-b.observedAgeHours)>ageTolerance)continue;
      comparisons.push({
        first:a,second:b,changedVariable:"hook",
        classification:"review-only-not-controlled",
        caveat:"The recorded hook tags differ, but topics, posting time, audiences actually reached, and external conditions are not controlled. These observations cannot establish a winning hook.",
      });
      if(comparisons.length>=12)break;
    }
    if(comparisons.length>=12)break;
  }
  const reasons=[
    "Only same-age cumulative individual-post snapshots enter this view. Aggregate XLSX top-post totals are excluded.",
    "Approved text is shown only after matching its publishing receipt and recomputing the exact SHA-256 fingerprint.",
    "Historical post themes and topics have not been explicitly tagged. This view does not infer them from text.",
    "Pairs match recorded objective, format, target-audience labels, metric source and measurement age; that does not make them controlled experiments.",
    "Differences are observations only, with no causal, recruiter-interest or employment-outcome claims.",
  ];
  if(candidates.length<2)reasons.push("At least two comparable posts with intact original review packages are needed.");
  if(candidates.length>=2 && !comparisons.length)
    reasons.push("No two validated observations meet the narrow hook-contrast review criteria.");
  return {
    metric:learning.metric,units:learning.units,ageHours:learning.targetAgeHours,
    observations:learning.rows.length,verifiedContext:candidates.length,
    excluded:learning.rows.length-candidates.length,candidates:comparisons,
    authority:"fingerprint-checked-approved-copy-and-manual-observations",
    reasons,
  };
}
