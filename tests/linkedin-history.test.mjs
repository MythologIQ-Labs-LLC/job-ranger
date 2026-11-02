import assert from "node:assert/strict";
import {
 canonicalHistoricalLinkedInUrl, validateHistoricalLinkedInPost,
 matchHistoricalPostsToLatestRanking, collidesWithApprovedPublication,
} from "../src/shared/linkedin-history.ts";

const url="https://www.linkedin.com/posts/fake-author-history-share-123";
const input={url:url+"?trk=tracking",publishedOn:"2026-08-09",body:"My real historic post\nSecond paragraph.",textSource:"copied_from_post"};
const normalized=validateHistoricalLinkedInPost(input);
assert.equal(normalized.url,url);
assert.equal(normalized.body,input.body);
assert.equal(canonicalHistoricalLinkedInUrl(url+"#comments"),url);
const receipt={destination:"linkedin",publishedUrl:url+"?source=manual"};
assert.equal(collidesWithApprovedPublication(url,[receipt]),true);
assert.equal(collidesWithApprovedPublication(url,[{destination:"x",publishedUrl:url}]),false);
const historical={
 ...normalized,id:"linkedin-history-00000000-0000-4000-8000-000000000001",
 recordedAt:"2026-10-10T01:00:00.000Z",bodySha256:"f".repeat(64),
 source:"user_attested_historical",userConfirmed:true,
};
const latest={latestImportId:"abc",topPostsFromLatestExport:[
 {url,publishedOn:"2026-08-09",impressions:72,engagements:null,sourceImportId:"abc"},
]};
const baseline=structuredClone(historical);
const included=matchHistoricalPostsToLatestRanking([historical],latest);
assert.deepEqual(historical,baseline,"pure matching must not mutate history");
assert.equal(included[0].status,"linked");
assert.equal(included[0].impressions,72);
assert.equal(included[0].engagements,null);
assert.equal(included[0].sourceImportId,"abc");
assert.equal(matchHistoricalPostsToLatestRanking([historical],{
 latestImportId:"abc",topPostsFromLatestExport:[],
})[0].status,"not-in-latest-ranking");
const mismatched={...latest,topPostsFromLatestExport:[{...latest.topPostsFromLatestExport[0],publishedOn:"2026-08-10"}]};
const conflict=matchHistoricalPostsToLatestRanking([historical],mismatched)[0];
assert.equal(conflict.status,"publication-date-conflict");
assert.equal(conflict.impressions,null);
assert.equal(matchHistoricalPostsToLatestRanking([historical],{
 ...latest,topPostsFromLatestExport:[...latest.topPostsFromLatestExport,...latest.topPostsFromLatestExport],
})[0].status,"duplicate-ranking");
assert.equal(validateHistoricalLinkedInPost({...input,textSource:"reconstructed_from_memory"}).textSource,"reconstructed_from_memory");
const reject=(changes,re)=>assert.throws(()=>validateHistoricalLinkedInPost({...input,...changes}),re);
reject({url:"https://evil.linkedin.com.evil.example/posts/abc"},/must point to a LinkedIn post/);
reject({url:"http://www.linkedin.com/posts/abc"},/must point to a LinkedIn post/);
reject({url:"https://user@www.linkedin.com/posts/abc"},/must point to a LinkedIn post/);
reject({url:"https://www.linkedin.com/in/somebody"},/must point to a LinkedIn post/);
reject({publishedOn:"2026-02-30"},/Invalid historical/);
reject({publishedOn:"2026-2-3"},/YYYY-MM-DD/);
reject({textSource:"linkedIn-api"},/Choose how/);
reject({body:" "},/Historical post text/);
reject({body:"x".repeat(12001)},/Historical post text/);
reject({body:"abc\u0000def"},/Historical post text/);
reject({body:"<p>not executable</p>",invalidField:1},/Unknown or missing/);
console.log("User-attested historical LinkedIn post validator and partial ranking join passed");
