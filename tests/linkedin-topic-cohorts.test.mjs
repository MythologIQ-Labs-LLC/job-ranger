import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPersonalBrandLearningReport } from "../src/shared/personal-brand-learning.ts";
import { buildLinkedInTopicCohorts } from "../electron-runtime/src/shared/linkedin-topic-cohorts.js";

const h=(text)=>createHash("sha256").update(text).digest("hex");
const origin=Date.parse("2026-09-01T12:00:00.000Z");
const make=(number,topic,overrides={})=>{
  const id="presence-"+String(number).padStart(8,"0")+"-0000-4000-8000-000000000001";
  const postId=id+":r1",body="Human approved exact post "+number;
  const timestamp=new Date(origin+number*86400000).toISOString();
  const receipt={postId,draftId:id,approvedRevision:1,destination:"linkedin",
    publishedUrl:"https://www.linkedin.com/posts/synthetic-user-"+number,
    publishedAt:timestamp,confirmedAt:timestamp,contentSha256:h(body),source:"user_confirmed"};
  const draft={id,revision:1,body,destination:"linkedin",
    objective:"expertise_proof",audiences:["Recruiters"],format:"text",
    hookArchetype:"lesson",hypothesis:"Record observations",claimChecks:[],
    mediaCount:0,mediaAccessibilityReviewed:true};
  const pkg={draftId:id,approvedRevision:1,destination:"linkedin",
    body,sha256:h(body),humanReviewConfirmed:true,status:"prepared_for_manual_copy"};
  const after=(hours)=>new Date(Date.parse(timestamp)+hours*3600000).toISOString();
  const snapshot={id:"snapshot-"+number,postId,capturedAt:after(48),
    windowStart:timestamp,windowEnd:after(24),
    sourceLabel:"Same manually recorded individual post panel",
    observations:[{name:"impressions",value:number*10,state:"manual"}]};
  const event={id:"topic-"+number,targetKind:"confirmed_publication",
    targetId:postId,revision:1,recordedAt:after(49),sourceFingerprint:h(body),
    source:"user_attested",userConfirmed:true,action:"label",topics:[topic]};
  return {...{receipt,draft,pkg,snapshot,event},...overrides};
};
const fixtures=[
  make(1,"career change"),make(2,"career change"),make(3,"career change"),
  make(4,"ai governance"),make(5,"ai governance"),make(6,"ai governance"),
];
const report=(items=fixtures,events=items.map(i=>i.event))=>{
  const learning=buildPersonalBrandLearningReport(items.map(i=>({
    receipt:i.receipt,draft:i.draft,snapshots:[i.snapshot]})),24,"impressions");
  return buildLinkedInTopicCohorts(
    learning,items.map(i=>i.receipt),items.map(i=>i.pkg),
    items.map(i=>i.draft),events);
};
const inputs=JSON.stringify(fixtures),eligible=await report();
assert.equal(JSON.stringify(fixtures),inputs,"no mutation of inputs");
assert.equal(eligible.authority,"manual-topics-verified-copy-age-matched-observations");
assert.equal(eligible.totalObserved,6);
assert.equal(eligible.originalVerified,6);
assert.equal(eligible.singleTopicLabeled,6);
assert.equal(eligible.contexts.length,1);
assert.equal(eligible.eligibleComparisons,1);
assert.deepEqual(eligible.contexts[0].cohorts.map(c=>c.topic),["ai governance","career change"],
  "topics presented alphabetically, not ranked by their performance");
assert.deepEqual(eligible.contexts[0].cohorts.map(c=>c.count),[3,3]);
assert.deepEqual(eligible.contexts[0].cohorts.map(c=>c.median),[50,20]);
assert.deepEqual(eligible.contexts[0].cohorts.map(c=>[c.min,c.max]),[[40,60],[10,30]]);
assert.deepEqual((await report([...fixtures].reverse())).contexts,eligible.contexts,
  "post and input order cannot change the result");
const onlyFive=await report(fixtures.slice(0,5));
assert.equal(onlyFive.eligibleComparisons,0);
assert.ok(onlyFive.contexts[0].cohorts.every(c=>c.median===null&&c.withheld),
  "having only two posts in one topic withholds all numeric topic contrasts");
const noLabels=await report(fixtures,[]);
assert.equal(noLabels.withoutValidTopic,6);
assert.equal(noLabels.eligibleComparisons,0);
const withDuplicate=await report(fixtures,[...fixtures.map(i=>i.event),fixtures[0].event]);
assert.equal(withDuplicate.withoutValidTopic,1);
assert.equal(withDuplicate.eligibleComparisons,0);
const withClear=await report(fixtures,fixtures.map((i,j)=>j===0?
 {...i.event,action:"clear",topics:[]}:i.event));
assert.equal(withClear.withoutValidTopic,1);
assert.equal(withClear.eligibleComparisons,0);
const withMultiple=await report(fixtures,fixtures.map((i,j)=>j===0?
 {...i.event,topics:["career change","skills"]}:i.event));
assert.equal(withMultiple.multiTopicExcluded,1);
assert.equal(withMultiple.eligibleComparisons,0);
const withBadFingerprint=await report(fixtures,fixtures.map((i,j)=>j===0?
 {...i.event,sourceFingerprint:"f".repeat(64)}:i.event));
assert.equal(withBadFingerprint.withoutValidTopic,1);
assert.equal(withBadFingerprint.eligibleComparisons,0);
const withUnconfirmed=await report(fixtures,fixtures.map((i,j)=>j===0?
 {...i.event,userConfirmed:false}:i.event));
assert.equal(withUnconfirmed.withoutValidTopic,1);
const withUnnormalized=await report(fixtures,fixtures.map((i,j)=>j===0?
 {...i.event,topics:["Career Change"]}:i.event));
assert.equal(withUnnormalized.withoutValidTopic,1);
const withHistory=await report(fixtures,[...fixtures.map(i=>i.event),{
 ...fixtures[0].event,targetKind:"historical_post",
 targetId:"linkedin-history-00000000-0000-4000-8000-000000000001",
 id:"history-one",topics:["career change"],
}]);
assert.equal(withHistory.historicalWithoutSameAgeSnapshots,1);
assert.equal(withHistory.eligibleComparisons,1,"historical records cannot silently join individual approved-post data");
const wrongHook=fixtures.map((f,i)=>i===0?{
 ...f,draft:{...f.draft,hookArchetype:"question"}}:f);
assert.equal((await report(wrongHook)).eligibleComparisons,0);
const wrongObjective=fixtures.map((f,i)=>i===0?{
 ...f,draft:{...f.draft,objective:"recruiter_discovery"}}:f);
assert.equal((await report(wrongObjective)).eligibleComparisons,0);
const wrongAudience=fixtures.map((f,i)=>i===0?{
 ...f,draft:{...f.draft,audiences:["hiring managers"]}}:f);
assert.equal((await report(wrongAudience)).eligibleComparisons,0);
const wrongSource=fixtures.map((f,i)=>i===0?{
 ...f,snapshot:{...f.snapshot,sourceLabel:"Different source"}}:f);
assert.equal((await report(wrongSource)).eligibleComparisons,0);
const wrongState=fixtures.map((f,i)=>i===0?{
 ...f,snapshot:{...f.snapshot,observations:[{name:"impressions",value:10,state:"provider_observed"}]}}:f);
assert.equal((await report(wrongState)).eligibleComparisons,0);
const missingMetric=fixtures.map((f,i)=>i===0?{
 ...f,snapshot:{...f.snapshot,observations:[]}}:f);
assert.equal((await report(missingMetric)).originalVerified,5);
assert.equal((await report(missingMetric)).eligibleComparisons,0);
const estimated=fixtures.map((f,i)=>i===0?{
 ...f,snapshot:{...f.snapshot,observations:[{name:"impressions",value:10,state:"estimated"}]}}:f);
assert.equal((await report(estimated)).eligibleComparisons,0);
const oldCopy=fixtures.map((f,i)=>i===0?{
 ...f,pkg:{...f.pkg,body:"Tampered approved copy"}}:f);
assert.equal((await report(oldCopy)).originalVerified,5);
assert.equal((await report(oldCopy)).eligibleComparisons,0);
const staleDraft=fixtures.map((f,i)=>i===0?{
 ...f,draft:{...f.draft,revision:2}}:f);
assert.equal((await report(staleDraft)).originalVerified,5);
const wrongAge=fixtures.map((f,i)=>i===0?{
 ...f,snapshot:{...f.snapshot,windowEnd:new Date(
 Date.parse(f.receipt.publishedAt)+26.75*3600000).toISOString()}}:f);
const age=await report(wrongAge);
assert.equal(age.ageExcluded,1);
assert.equal(age.eligibleComparisons,0);
assert.equal(eligible.contexts[0].caveat.includes("winner"),true);
console.log("Topic-cohort comparison: verified origin, strict context, small n, ambiguity and withheld outputs passed");
