import assert from "node:assert/strict";
import { compareLinkedInApprovedPostContexts } from "../src/shared/linkedin-approved-content-cohorts.ts";
import { buildPersonalBrandLearningReport } from "../src/shared/personal-brand-learning.ts";
import { createHash } from "node:crypto";

const sha=body=>createHash("sha256").update(body).digest("hex");
const published="2026-10-01T10:00:00.000Z";
const at=(hours)=>new Date(Date.parse(published)+hours*3600000).toISOString();
function make(id,hook,overrides={}){
  const copy="Approved original post "+id;
  const receipt={
    postId:id,draftId:id,approvedRevision:1,destination:"linkedin",
    publishedUrl:"https://www.linkedin.com/posts/example-"+id,
    publishedAt:published,confirmedAt:at(1),contentSha256:sha(copy),source:"user_confirmed",
  };
  const draft={
    id,revision:1,body:copy,objective:"expertise_proof",
    audiences:["Recruiters","Hiring Managers"],destination:"linkedin",
    format:"text",hookArchetype:hook,hypothesis:"Compare two approaches without guessing reasons",
    claimChecks:[],mediaCount:0,mediaAccessibilityReviewed:true,
  };
  const pkg={draftId:id,approvedRevision:1,destination:"linkedin",body:copy,sha256:sha(copy),
    humanReviewConfirmed:true,status:"prepared_for_manual_copy"};
  const snap={id:"snap-"+id,postId:id,capturedAt:at(48),
    windowStart:published,windowEnd:at(24),
    sourceLabel:"Per-post manual analytics",
    observations:[{name:"impressions",value:id==="a"?120:80,state:"manual"}]};
  return {receipt,draft,pkg,snap,...overrides};
}
const a=make("a","question"),b=make("b","contradiction");
const learn=(data)=>buildPersonalBrandLearningReport(data.map(x=>({
  receipt:x.receipt,draft:x.draft,snapshots:[x.snap]
})),24,"impressions");
const compare=(data)=>compareLinkedInApprovedPostContexts(
  learn(data),data.map(x=>x.receipt),data.map(x=>x.pkg),data.map(x=>x.draft));
const original=JSON.stringify([a,b]);
const eligible=await compare([a,b]);
assert.equal(JSON.stringify([a,b]),original,"comparisons must not mutate source");
assert.equal(eligible.observations,2);
assert.equal(eligible.verifiedContext,2);
assert.equal(eligible.excluded,0);
assert.equal(eligible.candidates.length,1);
assert.equal(eligible.candidates[0].first.hook,"question");
assert.equal(eligible.candidates[0].second.hook,"contradiction");
assert.equal(eligible.candidates[0].classification,"review-only-not-controlled");
assert.match(eligible.candidates[0].caveat,/not controlled/);
assert.equal(eligible.candidates[0].first.approvedCopy,a.pkg.body);
assert.deepEqual((await compare([b,a])).candidates,eligible.candidates,"stable ordering");
const forged=structuredClone(b);
forged.pkg.body="forged content with copied hash";
assert.equal((await compare([a,forged])).candidates.length,0);
assert.equal((await compare([a,forged])).verifiedContext,1);
const revised=structuredClone(b);
revised.draft.revision=2;
assert.equal((await compare([a,revised])).verifiedContext,1);
const wrongObjective=structuredClone(b);
wrongObjective.draft.objective="network_growth";
assert.equal((await compare([a,wrongObjective])).candidates.length,0);
assert.equal((await compare([a,wrongObjective])).verifiedContext,2);
const wrongFormat=structuredClone(b);
wrongFormat.draft.format="image";
assert.equal((await compare([a,wrongFormat])).candidates.length,0);
const wrongAudience=structuredClone(b);
wrongAudience.draft.audiences=["founders"];
assert.equal((await compare([a,wrongAudience])).candidates.length,0);
const sameHook=structuredClone(b);
sameHook.draft.hookArchetype="question";
assert.equal((await compare([a,sameHook])).candidates.length,0);
const wrongSource=structuredClone(b);
wrongSource.snap.sourceLabel="Other source";
assert.equal((await compare([a,wrongSource])).candidates.length,0);
const wrongState=structuredClone(b);
wrongState.snap.observations[0].state="provider_observed";
assert.equal((await compare([a,wrongState])).candidates.length,0);
const estimated=structuredClone(b);
estimated.snap.observations[0].state="estimated";
assert.equal((await compare([a,estimated])).verifiedContext,1);
const wrongAge=structuredClone(b);
wrongAge.snap.windowEnd=at(48);
assert.equal((await compare([a,wrongAge])).verifiedContext,1);
const noAudience=structuredClone(b);
noAudience.draft.audiences=[];
assert.equal((await compare([a,noAudience])).verifiedContext,1);
const unreviewed=structuredClone(b);
unreviewed.pkg.humanReviewConfirmed=false;
assert.equal((await compare([a,unreviewed])).verifiedContext,1);
const duplicate=await compareLinkedInApprovedPostContexts(learn([a,b]),
 [a.receipt,b.receipt], [a.pkg,a.pkg,b.pkg],[a.draft,b.draft]);
assert.equal(duplicate.verifiedContext,1,"ambiguous approved packages fail closed");
const blank=await compare([]);
assert.equal(blank.candidates.length,0);
assert.equal(blank.verifiedContext,0);
console.log("Content-level hook contrast safety and approved-copy integrity tests passed");
