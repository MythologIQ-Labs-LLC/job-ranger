import assert from "node:assert/strict";
import { buildLinkedInObservedDashboard } from "../src/shared/linkedin-observed-dashboard.ts";

const day=(n)=>`2026-10-${String(n).padStart(2,"0")}`;
const observation=(date,value,followers=1)=>({
 date,
 impressions:{state:"observed",value,sources:["import-one"]},
 engagements:{state:"observed",value:Math.floor(value/10),sources:["import-one"]},
 newFollowers:{state:"observed",value:followers,sources:["import-one"]},
});
const original={
 imports:2,period:{start:day(1),end:day(14)},
 daily:Array.from({length:14},(_,i)=>observation(day(i+1),i<7?10:20)),
};
const before=JSON.stringify(original);
const data=buildLinkedInObservedDashboard(original);
assert.equal(JSON.stringify(original),before,"dashboard model must be read-only");
assert.equal(data.authority,"user-imported-linkedin-xlsx-observations");
assert.equal(data.sources,2);
assert.equal(data.comparisons[0].previous.value,70);
assert.equal(data.comparisons[0].latest.value,140);
assert.equal(data.comparisons[0].absoluteDifference,70);
assert.equal(data.comparisons[0].percentageDifference,100);
assert.equal(data.comparisons[0].direction,"up");
assert.equal(data.comparisons[1].previous.value,7);
assert.equal(data.comparisons[1].latest.value,14);
assert.equal(data.comparisons[2].direction,"unchanged");
const conflict=structuredClone(original);
conflict.daily[11].impressions={state:"conflict",value:null,sources:["old","new"]};
const c=buildLinkedInObservedDashboard(conflict);
assert.equal(c.comparisons[0].latest.quality,"conflict");
assert.equal(c.comparisons[0].latest.value,null);
assert.equal(c.comparisons[0].direction,"unavailable");
assert.equal(c.comparisons[0].absoluteDifference,null);
assert.equal(c.comparisons[1].direction,"up","metric-specific conflict should not contaminate agreeing metrics");
const missing=structuredClone(original);
missing.daily[10].newFollowers={state:"missing",value:null,sources:[]};
assert.equal(buildLinkedInObservedDashboard(missing).comparisons[2].latest.quality,"missing");
assert.equal(buildLinkedInObservedDashboard(missing).comparisons[2].absoluteDifference,null);
const shortened=structuredClone(original);
shortened.daily=shortened.daily.slice(4);
shortened.period.start=day(5);
const s=buildLinkedInObservedDashboard(shortened);
assert.equal(s.comparisons[0].previous.value,null);
assert.equal(s.comparisons[0].direction,"unavailable");
const zero=structuredClone(original);
zero.daily.slice(0,7).forEach(d=>{d.impressions.value=0;});
const z=buildLinkedInObservedDashboard(zero).comparisons[0];
assert.equal(z.previous.value,0);
assert.equal(z.absoluteDifference,140);
assert.equal(z.percentageDifference,null,"never divide by zero");
const empty=buildLinkedInObservedDashboard({period:null,imports:0,daily:[]});
assert.equal(empty.comparisons[0].direction,"unavailable");
assert.equal(empty.comparisons[0].latest.value,null);
const duplicate=structuredClone(original);
duplicate.daily[13].date=day(13);
assert.throws(()=>buildLinkedInObservedDashboard(duplicate),/Duplicate reconciled/);
console.log("LinkedIn observed weekly dashboard model: completeness, conflicts, zeros and no inference passed");
