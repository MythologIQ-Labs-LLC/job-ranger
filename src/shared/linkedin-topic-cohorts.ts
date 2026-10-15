/**
 * Local-only, observational topic cohorts. Explicit user labels are a separate
 * assertion from provider metrics and are never inferred from post text.
 *
 * Individual cumulative snapshots must pass the existing same-age learning
 * gates and original-copy fingerprint verification. Historical XLSX leaderboard
 * totals are not eligible because measurement ages are unknown.
 */
import type { ManualPostPackage, ManualPublicationReceipt, PersonalBrandDraft } from "./personal-brand.js";
import type { LearningReport } from "./personal-brand-learning.js";
import { verifiedApprovedPostMembers, type ApprovedPostCohortMember } from "./linkedin-approved-content-cohorts.js";
import { validateTopicLabels, type LinkedInTopicEvent } from "./linkedin-topics.js";

export interface TopicCohort {
  topic: string;
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
  postIds: string[];
  withheld: boolean;
}
export interface TopicCohortContext {
  contextId: string;
  hook: string;
  format: string;
  objective: string;
  audiences: string[];
  sourceLabel: string;
  observationStates: string[];
  eligibleComparison: boolean;
  cohorts: TopicCohort[];
  caveat: string;
}
export interface LinkedInTopicCohortReport {
  authority: "manual-topics-verified-copy-age-matched-observations";
  metric: string;
  units: "count" | "rate";
  ageHours: number;
  totalObserved: number;
  originalVerified: number;
  singleTopicLabeled: number;
  withoutValidTopic: number;
  multiTopicExcluded: number;
  ageExcluded: number;
  historicalWithoutSameAgeSnapshots: number;
  minimumPerTopic: 3;
  contexts: TopicCohortContext[];
  eligibleComparisons: number;
  caveats: string[];
}
const minimum=3;
function median(values:readonly number[]):number {
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function normalizedAudience(values:readonly string[]):string[] {
  return [...new Set(values.map(v=>v.toLowerCase().trim()).filter(Boolean))].sort();
}
function validSingleLabel(member:ApprovedPostCohortMember, event:LinkedInTopicEvent):string|null {
  if(event.targetKind!=="confirmed_publication" || event.targetId!==member.postId ||
     event.source!=="user_attested" || event.userConfirmed!==true ||
     event.action!=="label" || event.sourceFingerprint!==member.sourceFingerprint ||
     !Number.isSafeInteger(event.revision) || event.revision<1 ||
     !Number.isFinite(Date.parse(event.recordedAt)))return null;
  try {
    const cleaned=validateTopicLabels({
      targetKind:event.targetKind,targetId:event.targetId,topics:event.topics,
    });
    return cleaned.topics.length===1 && cleaned.topics[0]===event.topics[0]?cleaned.topics[0]:null;
  }catch{return null;}
}
function contextKey(member:ApprovedPostCohortMember):string {
  return JSON.stringify([
    member.hook,member.format,member.objective,
    normalizedAudience(member.audiences),member.sourceLabel,member.states,
  ]);
}
export async function buildLinkedInTopicCohorts(
  learning:LearningReport,
  receipts:readonly ManualPublicationReceipt[],
  packages:readonly ManualPostPackage[],
  drafts:readonly PersonalBrandDraft[],
  topicEvents:readonly LinkedInTopicEvent[],
):Promise<LinkedInTopicCohortReport> {
  if(topicEvents.length>1500)throw new Error("Too many topic attestations for comparison.");
  const verified=await verifiedApprovedPostMembers(learning,receipts,packages,drafts);
  const eventGroups=new Map<string,LinkedInTopicEvent[]>();
  for(const event of topicEvents) {
    if(event.targetKind!=="confirmed_publication")continue;
    const events=eventGroups.get(event.targetId)??[];
    events.push(event);
    eventGroups.set(event.targetId,events);
  }
  let withoutValidTopic=0,multiTopicExcluded=0,ageExcluded=0,singleTopicLabeled=0;
  const bucket=new Map<string,{member:ApprovedPostCohortMember;topic:string}[]>();
  const uniqueIds=new Set<string>();
  const maxDifference=learning.targetAgeHours===24?2:learning.targetAgeHours===48?4:8;
  for(const member of verified) {
    if(uniqueIds.has(member.postId)) {
      // Duplicated learning evidence is unsafe for group sample sizes.
      throw new Error("Repeated verified post identity in topic cohort projection.");
    }
    uniqueIds.add(member.postId);
    const events=eventGroups.get(member.postId)??[];
    if(events.length!==1){withoutValidTopic++;continue;}
    const event=events[0];
    if(Array.isArray(event.topics) && event.topics.length>1){multiTopicExcluded++;continue;}
    const topic=validSingleLabel(member,event);
    if(!topic){withoutValidTopic++;continue;}
    if(Math.abs(member.observedAgeHours-learning.targetAgeHours)>maxDifference){
      ageExcluded++;continue;
    }
    singleTopicLabeled++;
    const key=contextKey(member);
    const rows=bucket.get(key)??[];
    rows.push({member,topic});
    bucket.set(key,rows);
  }
  const contexts:TopicCohortContext[]=[];
  for(const [key,posts] of bucket) {
    const [hook,format,objective,audiences,sourceLabel,states]=JSON.parse(key) as
      [string,string,string,string[],string,string[]];
    const grouped=new Map<string,typeof posts>();
    for(const item of posts){
      const rows=grouped.get(item.topic)??[];
      rows.push(item);
      grouped.set(item.topic,rows);
    }
    const qualifyingTopics=[...grouped.values()].filter(rows=>rows.length>=minimum).length;
    const eligibleComparison=qualifyingTopics>=2;
    const cohorts:TopicCohort[]=[...grouped.entries()].sort(([a],[b])=>a.localeCompare(b))
      .map(([topic,items])=>{
        const approved=eligibleComparison&&items.length>=minimum;
        const sorted=[...items].sort((a,b)=>a.member.postId.localeCompare(b.member.postId));
        const observations=sorted.map(item=>item.member.value);
        return {topic,count:items.length,
          median:approved?median(observations):null,
          min:approved?Math.min(...observations):null,
          max:approved?Math.max(...observations):null,
          postIds:sorted.map(item=>item.member.postId),
          withheld:!approved};
      });
    contexts.push({
      contextId:key,hook,format,objective,audiences,sourceLabel,observationStates:states,
      eligibleComparison,cohorts,
      caveat:eligibleComparison
        ?"Descriptive distribution only. Publishing time, actual audience, and external events remain uncontrolled; no topic effect or winner is established."
        :"Topic measurements withheld. At least two distinct topics with three verified same-context posts each are required.",
    });
  }
  contexts.sort((a,b)=>a.contextId.localeCompare(b.contextId));
  const caveats=[
    "Only explicitly user-attested single-topic labels are admitted. Multilabel posts and cleared or ambiguous labels are excluded rather than assigned to invented topics.",
    "All comparison members must have fingerprint-verified original approved copy and a valid same-age cumulative individual-post snapshot.",
    "Within each comparison context, hook, format, objective, recorded target audience, metric source, and observation states must match.",
    "At least three posts per topic and two distinct qualifying topics are needed before descriptive medians or ranges appear.",
    "Manual or platform-observed counts are observations, not experimental controls. Collection bias, posting time, actual reach, and external factors remain.",
    "Historical posts without eligible post-age observations and the LinkedIn XLSX top-post rankings are excluded; missing values never mean zero.",
    "No reported difference proves a winning topic, recruiter impact, job offer, salary improvement, or causal mechanism.",
  ];
  return {
    authority:"manual-topics-verified-copy-age-matched-observations",
    metric:learning.metric,units:learning.units,ageHours:learning.targetAgeHours,
    totalObserved:learning.rows.length,originalVerified:verified.length,
    singleTopicLabeled,withoutValidTopic,multiTopicExcluded,ageExcluded,
    historicalWithoutSameAgeSnapshots:topicEvents.filter(e=>e.targetKind==="historical_post").length,
    minimumPerTopic:minimum,contexts,
    eligibleComparisons:contexts.filter(x=>x.eligibleComparison).length,caveats,
  };
}
