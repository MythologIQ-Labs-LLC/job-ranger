import assert from "node:assert/strict";
import { reconcileLinkedInExports } from "../src/shared/linkedin-reconciliation.ts";

const uuid = n => "linkedin-import-00000000-0000-4000-8000-" + String(n).padStart(12,"0");
const digest = n => n.toString(16).padStart(64,"0");
const make = (n, start, end, days, options={}) => ({
  id: uuid(n), contentSha256: digest(n),
  importedAt: options.importedAt || `2026-10-${String(n + 10).padStart(2,"0")}T15:00:00.000Z`,
  source: "linkedin-native-xlsx-manual",
  preview: {
    format: "linkedin-aggregate-analytics-v1", period: { start, end },
    discovery: { impressions: days.reduce((v,d) => v+d.impressions,0), membersReached: 20 },
    followers: { asOf: end, total: 100 },
    daily: days.map(d=>({...d})),
    topPosts: options.posts ?? [],
    audienceDemographics: [], contentDemographics: [],
    warnings: options.warnings ?? [], provenance: "manual-linkedIn-export",
  },
});
const row = (date, impressions, engagements, newFollowers) =>
  ({ date, impressions, engagements, newFollowers });
const post = (suffix, impressions, engagements) => ({
  url: `https://www.linkedin.com/posts/fake-${suffix}`,
  publishedOn: "2026-09-01", impressions, engagements,
});
const a = make(1,"2026-10-01","2026-10-03",[
  row("2026-10-01",10,1,0),row("2026-10-02",20,2,1),row("2026-10-03",30,3,null),
],{posts:[post("first",50,null)]});
const b = make(2,"2026-10-02","2026-10-04",[
  row("2026-10-02",20,2,1),row("2026-10-03",31,3,2),row("2026-10-04",40,4,0),
],{posts:[post("second",90,9)]});
const initial = JSON.stringify([a,b]);
const report=reconcileLinkedInExports([a,b]);
assert.equal(JSON.stringify([a,b]),initial,"pure read projection must not mutate originals");
assert.deepEqual(report.period,{start:"2026-10-01",end:"2026-10-04"});
assert.deepEqual(report.coverage,{calendarDays:4,observedDays:4,missingDays:0,conflictedDays:1});
assert.equal(report.daily[1].impressions.value,20,"duplicate dates must not double count");
assert.equal(report.daily[1].engagements.value,2);
assert.equal(report.daily[1].impressions.sources.length,2,"provenance retained across agreeing snapshots");
assert.equal(report.daily[2].impressions.state,"conflict");
assert.equal(report.daily[2].impressions.value,null,"conflict never chooses most recent");
assert.equal(report.daily[2].engagements.value,3,"independent agreeing metric remains visible");
assert.equal(report.daily[2].newFollowers.value,2,"missing in one export remains distinct from zero");
assert.equal(report.totals.impressions,null);
assert.equal(report.totals.engagements,10,"no double-counting days when observations agree");
assert.equal(report.totals.newFollowers,3);
assert.equal(report.latestImportId,b.id);
assert.deepEqual(report.topPostsFromLatestExport.map(x=>x.url),[post("second",90,9).url]);
assert.ok(report.warnings.some(x=>/conflicting observations/.test(x)));
assert.ok(report.warnings.some(x=>/not additive/.test(x)));
const reverse=reconcileLinkedInExports([b,a]);
assert.deepEqual(reverse,report,"input order must not change deterministic reconciliation");

const complete=reconcileLinkedInExports([a]);
assert.equal(complete.totals.impressions,60);
assert.equal(complete.totals.engagements,6);
assert.equal(complete.totals.newFollowers,null,"missing not mistaken for zero");
const empty=reconcileLinkedInExports([]);
assert.equal(empty.period,null);
assert.equal(empty.totals.impressions,null);
assert.equal(empty.coverage.calendarDays,0);
const gap=reconcileLinkedInExports([a,make(3,"2026-10-06","2026-10-06",[row("2026-10-06",9,1,1)])]);
assert.equal(gap.coverage.missingDays,2);
assert.equal(gap.totals.engagements,null);
assert.ok(gap.daily.find(x=>x.date==="2026-10-05").impressions.state==="missing");
const changed = structuredClone(b);
changed.preview.daily[0].engagements=99;
const conflict = reconcileLinkedInExports([a,changed]);
assert.equal(conflict.daily[1].engagements.state,"conflict");
assert.equal(conflict.totals.engagements,null);
assert.equal(conflict.daily[1].impressions.state,"observed");
const sameNewest=structuredClone(b);
sameNewest.importedAt=a.importedAt;
const tieA=structuredClone(a);
tieA.importedAt=a.importedAt;
assert.deepEqual(
  reconcileLinkedInExports([sameNewest,tieA]),
  reconcileLinkedInExports([tieA,sameNewest]),
  "tie breaks must be stable"
);
assert.throws(()=>reconcileLinkedInExports([a,a]),/Duplicate saved LinkedIn imports/);
assert.throws(()=>reconcileLinkedInExports(new Array(251).fill(a)),/Too many saved LinkedIn imports/);
const malformed=structuredClone(a);
malformed.preview.daily[0].impressions=-1;
assert.throws(()=>reconcileLinkedInExports([malformed]),/Invalid saved LinkedIn daily/);
const malicious=structuredClone(a);
malicious.contentSha256="not-sha";
assert.throws(()=>reconcileLinkedInExports([malicious]),/Invalid saved LinkedIn import provenance/);
console.log("LinkedIn deterministic historical reconciliation: adversarial and coverage fixtures passed");
