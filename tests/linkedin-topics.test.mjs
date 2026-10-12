import assert from "node:assert/strict";
import { validateTopicLabels,validateTopicTarget,latestTopicLabels } from "../src/shared/linkedin-topics.ts";
const id="presence-00000000-0000-4000-8000-000000000001:r2";
const target={targetKind:"confirmed_publication",targetId:id};
const historic={targetKind:"historical_post",targetId:"linkedin-history-00000000-0000-4000-8000-000000000001"};
assert.deepEqual(validateTopicTarget(target),target);
assert.deepEqual(validateTopicTarget(historic),historic);
const input={...target,topics:[" Career change ","AI   GOVERNANCE"]};
assert.deepEqual(validateTopicLabels(input).topics,["ai governance","career change"]);
assert.equal(input.topics[0]," Career change ","validator must not mutate source input");
const reject=(x,reason)=>assert.throws(()=>validateTopicLabels(x),reason);
reject({...target,topics:["Ai","ai"]},/Duplicate/);
reject({...target,topics:["topic", " TOPIC  "]},/Duplicate/);
reject({...target,topics:["x"]},/2–50/);
reject({...target,topics:["good\u0000bad"]},/2–50/);
reject({...target,topics:["<script>"]},/2–50/);
reject({...target,topics:["x".repeat(51)]},/2–50/);
reject({...target,topics:Array.from({length:7},(_,i)=>"topic "+i)},/at most 6/);
reject({...target,topics:"not an array"},/at most 6/);
reject({...target,topics:["topic"],source:"AI-generated"},/Unexpected/);
reject({...target,topics:["topic",1]},/must be text/);
reject({...target,targetKind:"facebook_page",topics:["topic"]},/Unsupported/);
reject({...target,targetId:"arbitrary",topics:["topic"]},/identifier/);
const one=(n,topics)=>({...target,id:"event"+n,revision:n,topics,action:topics.length?"label":"clear",
  recordedAt:"2026-10-10T02:00:00Z",sourceFingerprint:"f".repeat(64),
  source:"user_attested",userConfirmed:true});
const latest=latestTopicLabels([one(2,[]),one(1,["career change"]),{
 ...one(1,["AI Strategy"]),...historic,id:"history-event-1",
}]);
assert.equal(latest.length,2);
assert.deepEqual(latest.find(x=>x.targetKind==="confirmed_publication").topics,[]);
assert.equal(latest.find(x=>x.targetKind==="confirmed_publication").action,"clear");
assert.deepEqual(validateTopicLabels({...target,topics:[]}).topics,[],"empty labels are a deliberate clear");
console.log("LinkedIn user topic assertions validate independently of inference or analytics");
