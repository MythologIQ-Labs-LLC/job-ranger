/**
 * User-authored LinkedIn topic assertions, never semantic inference, provider
 * verification, content mutation or employment-outcome evidence.
 *
 * Every edit creates an append-only revision. An empty topic list is a tombstone
 * for the active projection, not destruction of the local revision history.
 */
export type TopicTargetKind = "confirmed_publication" | "historical_post";
export interface TopicTarget { targetKind: TopicTargetKind; targetId: string }
export interface TopicLabelInput extends TopicTarget { topics: string[] }
export interface LinkedInTopicEvent extends TopicLabelInput {
  id: string;
  revision: number;
  recordedAt: string;
  sourceFingerprint: string;
  source: "user_attested";
  userConfirmed: true;
  action: "label" | "clear";
}
export function validateTopicTarget(value:unknown):TopicTarget {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid LinkedIn topic target.");
  const input=value as Record<string,unknown>;
  if(input.targetKind!=="confirmed_publication"&&input.targetKind!=="historical_post")
    throw new Error("Unsupported LinkedIn topic target.");
  if(typeof input.targetId!=="string" ||
     !(input.targetKind==="confirmed_publication"
       ? /^presence-[a-f0-9-]{36}:r[1-9]\d*$/.test(input.targetId)
       : /^linkedin-history-[a-f0-9-]{36}$/.test(input.targetId)))
    throw new Error("Invalid LinkedIn topic target identifier.");
  return {targetKind:input.targetKind,targetId:input.targetId};
}
export function validateTopicLabels(value:unknown):TopicLabelInput {
  const target=validateTopicTarget(value);
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>!["targetKind","targetId","topics"].includes(key)))
    throw new Error("Unexpected topic annotation fields.");
  if(!Array.isArray(input.topics)||input.topics.length>6)throw new Error("Use at most 6 topic labels.");
  const topics:string[]=[];
  const seen=new Set<string>();
  for(const raw of input.topics) {
    if(typeof raw!=="string")throw new Error("Topic labels must be text.");
    const label=raw.trim().replace(/\s+/g," ").toLowerCase();
    if(label.length<2||label.length>50||/[\u0000-\u001f\u007f<>]/.test(label))
      throw new Error("Each topic label must have 2–50 safe characters.");
    if(seen.has(label))throw new Error("Duplicate topic label.");
    seen.add(label);topics.push(label);
  }
  topics.sort((a,b)=>a.localeCompare(b));
  return {...target,topics};
}
export function latestTopicLabels(
  events:readonly LinkedInTopicEvent[],
): LinkedInTopicEvent[] {
  const latest=new Map<string,LinkedInTopicEvent>();
  for(const e of events){
    const key=e.targetKind+":"+e.targetId;
    const previous=latest.get(key);
    if(!previous||e.revision>previous.revision)latest.set(key,e);
  }
  return [...latest.values()].sort((a,b)=>a.targetKind.localeCompare(b.targetKind)||
    a.targetId.localeCompare(b.targetId));
}
