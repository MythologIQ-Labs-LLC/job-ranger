import assert from "node:assert/strict";
import { canonicalLinkedInPostUrl, matchLinkedInRankedPosts } from "../src/shared/linkedin-post-content.ts";
import { fingerprintExactPost } from "../src/shared/personal-brand.ts";

const body = "An observed career transition, not a fabricated post.";
const hash = await fingerprintExactPost(body);
const baseUrl="https://www.linkedin.com/posts/fake-user-career-example-12345";
const urlTwo="https://www.linkedin.com/posts/fake-user-second-example-2222";
const urlThree="https://www.linkedin.com/posts/fake-user-unmatched-3333";
const post=(url,day="2026-10-08")=>({
  url,publishedOn:day,impressions:100,engagements:null,sourceImportId:"import-A",
});
const receipt=(url=baseUrl,overrides={})=>({
  postId:"p:r1",draftId:"p",approvedRevision:1,destination:"linkedin",
  publishedUrl:url,publishedAt:"2026-10-08T14:00:00-04:00",
  confirmedAt:"2026-10-08T16:00:00-04:00",
  contentSha256:hash,source:"user_confirmed",...overrides,
});
const pkg=(overrides={})=>({
  draftId:"p",approvedRevision:1,destination:"linkedin",body,sha256:hash,
  humanReviewConfirmed:true,status:"prepared_for_manual_copy",...overrides,
});
const draft=(overrides={})=>({
  id:"p",revision:1,destination:"linkedin",body,
  objective:"expertise_proof",hookArchetype:"contradiction",format:"text",
  ...overrides,
});
const report=posts=>({ latestImportId:"import-A",topPostsFromLatestExport:posts });
const run=(posts, receipts=[receipt()], packages=[pkg()], drafts=[draft()])=>
  matchLinkedInRankedPosts(report(posts), receipts, packages, drafts);
assert.equal(canonicalLinkedInPostUrl("https://linkedin.com/posts/fake-user-career-example-12345/?trk=tracking#no"),
             baseUrl);
assert.equal(canonicalLinkedInPostUrl("http://www.linkedin.com/posts/x"),null);
assert.equal(canonicalLinkedInPostUrl("https://www.linkedin.com.evil.test/posts/x"),null);
assert.equal(canonicalLinkedInPostUrl("https://attacker@www.linkedin.com/posts/x"),null);
assert.equal(canonicalLinkedInPostUrl("https://www.linkedin.com/profile/x"),null);
assert.equal(canonicalLinkedInPostUrl("https://www.linkedin.com/posts//x"),null);
const stableInput=[post(baseUrl),post(urlThree)];
const before=structuredClone(stableInput);
const matched=await run(stableInput,[receipt(baseUrl+"?trk=feed")]);
assert.deepEqual(stableInput,before,"pure matcher must not mutate input");
assert.equal(matched.rows.length,2);
assert.equal(matched.rows[0].status,"copy-verified");
assert.equal(matched.rows[0].reviewedCopy,body);
assert.equal(matched.rows[0].objective,"expertise_proof");
assert.equal(matched.rows[0].hook,"contradiction");
assert.equal(matched.rows[0].metadataCurrent,true);
assert.equal(matched.rows[1].status,"unmatched");
assert.equal(matched.rows[1].reviewedCopy,null);
assert.equal(matched.totalRanked,2);
assert.equal(matched.verifiedCopyCount,1);
assert.equal(matched.unmatchedCount,1);
assert.equal(matched.rows[0].engagements,null,"a missing metric stays null");

const stale=await run([post(baseUrl)], [receipt()],[pkg()],[draft({revision:2,body:"revised copy"})]);
assert.equal(stale.rows[0].status,"copy-verified");
assert.equal(stale.rows[0].reviewedCopy,body,"stale draft must not rewrite published copy");
assert.equal(stale.rows[0].metadataCurrent,false);
assert.equal(stale.rows[0].hook,null,"stale draft metadata must not be asserted");
const disputedDate=await run([post(baseUrl,"2026-10-09")]);
assert.equal(disputedDate.rows[0].status,"publication-date-conflict");
assert.equal(disputedDate.rows[0].reviewedCopy,null);
assert.ok(disputedDate.warnings.some(w=>/Date conflicts/.test(w)));
const missing=await run([post(baseUrl)], [receipt()], []);
assert.equal(missing.rows[0].status,"copy-unavailable");
const fingerprint=await run([post(baseUrl)], [receipt()],[pkg({body:"not the approved copy"})]);
assert.equal(fingerprint.rows[0].status,"copy-fingerprint-conflict",
  "forged content with copied digest must fail closed");
assert.equal(fingerprint.rows[0].reviewedCopy,null);
const badSha=await run([post(baseUrl)], [receipt()],[pkg({sha256:"f".repeat(64)})]);
assert.equal(badSha.rows[0].status,"copy-fingerprint-conflict");
const ambiguous=await run([post(baseUrl)], [receipt(),receipt(baseUrl+"?ref=duplicate",{postId:"other"})]);
assert.equal(ambiguous.rows[0].status,"ambiguous-url");
assert.equal(ambiguous.rows[0].reviewedCopy,null);
const independent=await run([post(urlTwo)], [receipt()], [pkg()], [draft()]);
assert.equal(independent.rows[0].status,"unmatched","never match by date alone");
const otherPlatform=await run([post(baseUrl)], [receipt(baseUrl,{destination:"x"})]);
assert.equal(otherPlatform.rows[0].status,"unmatched");
const invalid=await run([post("https://not-linkedin.example/posts/test")]);
assert.equal(invalid.rows[0].status,"unmatched");
const empty=await run([],[],[],[]);
assert.equal(empty.totalRanked,0);
assert.equal(empty.sourceImportId,"import-A");
console.log("LinkedIn ranked-post/copy provenance: deterministic adversarial fixtures passed");
