import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readLinkedInXlsx } from "../src/browser/linkedin-xlsx.ts";
import { normalizeLinkedInAnalyticsExport } from "../src/shared/linkedin-analytics.ts";

const clone = x => structuredClone(x);
const rows = {
  "DISCOVERY": [
    ["Overall Performance", "10/8/2026 - 10/9/2026"],
    ["Impressions", "12"], ["Members reached", "8"],
  ],
  "ENGAGEMENT": [
    ["Date", "Impressions", "Engagements"],
    ["10/8/2026", "4", "0"], ["10/9/2026", "8", "2"],
  ],
  "TOP POSTS": [
    ["Maximum of 50 posts available to include in this list"],
    [],
    ["Post URL", "Post Publish Date", "Engagements", "481", "Post URL", "Post Publish Date", "Impressions"],
    ["https://www.linkedin.com/posts/example-test-share-100-abc", "10/9/2026", "2", "481",
      "https://www.linkedin.com/posts/example-test-share-100-abc", "10/9/2026", "10"],
    ["481", "481", "481", "481", "https://www.linkedin.com/posts/example-older-share-99-abc", "5/1/2026", "2"],
  ],
  "FOLLOWERS": [
    ["Total followers on 10/9/2026", "101"], [],
    ["Date", "New followers"], ["10/8/2026", "0"], ["10/9/2026", "1"],
  ],
  "AUDIENCE DEMOGRAPHICS": [
    ["Top Demographics", "Value", "Percentage"],
    ["Company", "A fictional organization", "< 1%"],
  ],
  "CONTENT DEMOGRAPHICS": [
    ["Top Demographics", "Value", "Percentage"], ["Location", "Exampleville", "12%"],
  ],
};
const before = JSON.stringify(rows);
const result = normalizeLinkedInAnalyticsExport(rows);
assert.equal(JSON.stringify(rows), before, "import must not mutate caller");
assert.deepEqual(result.period, { start: "2026-10-08", end: "2026-10-09" });
assert.deepEqual(result.discovery, { impressions: 12, membersReached: 8 });
assert.deepEqual(result.daily.map(x => x.newFollowers), [0, 1]);
assert.equal(result.followers.total, 101);
assert.equal(result.topPosts.length, 2);
assert.equal(result.topPosts.find(p => p.impressions === 10)?.engagements, 2);
assert.equal(result.topPosts.find(p => p.impressions === 2)?.engagements, null,
  "different top rankings must preserve unavailable vs zero");
assert.equal(result.audienceDemographics[0].reportedPercentage, "< 1%");
assert.ok(result.warnings.some(w => /outside/.test(w)));
assert.ok(result.warnings.some(w => /different coverage/.test(w)));
assert.equal(result.provenance, "manual-linkedIn-export");
const fail = (mutate, pattern) => {
  const test = clone(rows);
  mutate(test);
  assert.throws(() => normalizeLinkedInAnalyticsExport(test), pattern);
};
fail(v => { delete v.DISCOVERY; }, /missing DISCOVERY/);
fail(v => { v.ENGAGEMENT[2][0] = "10/8/2026"; }, /duplicate ENGAGEMENT/);
fail(v => { v.DISCOVERY[1][1] = "-1"; }, /Invalid overall impressions/);
fail(v => { v["TOP POSTS"][3][0] = "https://linkedin.com.evil.test/posts/example"; }, /Invalid LinkedIn post URL/);
fail(v => { v["TOP POSTS"][3][1] = "02/30/2026"; }, /Invalid LinkedIn export calendar/);
fail(v => { v["TOP POSTS"][3][2] = ""; }, /Invalid post engagements/);
fail(v => { v["TOP POSTS"][4][4] = "https://www.linkedin.com/posts/example-test-share-100-abc"; }, /Conflicting publication dates/);
fail(v => { v["CONTENT DEMOGRAPHICS"][1][2] = "110%"; }, /Invalid CONTENT DEMOGRAPHICS percentage/);
fail(v => { v.FOLLOWERS[4][1] = ""; }, /Invalid new followers/);
const stale = clone(rows);
stale.DISCOVERY[1][1] = "13";
assert.ok(normalizeLinkedInAnalyticsExport(stale).warnings.some(w => /daily impression total/i.test(w)));

const xesc = x => String(x).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const fakeSheet = rows => '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  rows.map((r, idx) => '<row r="' + (idx + 1) + '">' + r.map((value, col) => value == null ? "" :
    '<c r="' + String.fromCharCode(65 + col) + (idx + 1) + '" t="inlineStr"><is><t>' + xesc(value) + '</t></is></c>'
  ).join("") + '</row>').join("") + '</sheetData></worksheet>';
const names = Object.keys(rows);
const wb = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
  names.map((n, i) => '<sheet name="' + n + '" sheetId="' + (i+1) + '" r:id="rId' + (i+1) + '"/>').join("") + '</sheets></workbook>';
const relations = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  names.map((n, i) => '<Relationship Id="rId' + (i+1) + '" Target="worksheets/sheet' + (i+1) + '.xml"/>').join("") + '</Relationships>';
const syntheticFiles = {
  "xl/workbook.xml": strToU8(wb),
  "xl/_rels/workbook.xml.rels": strToU8(relations),
};
names.forEach((name,i) => { syntheticFiles["xl/worksheets/sheet" + (i+1) + ".xml"] = strToU8(fakeSheet(rows[name])); });
const workbookBytes = (files) => Uint8Array.from(zipSync(files)).buffer;
const decoded = readLinkedInXlsx(workbookBytes(syntheticFiles));
assert.equal(decoded.DISCOVERY[1][1], "12");
assert.equal(normalizeLinkedInAnalyticsExport(decoded).discovery.impressions, 12);
const withBadXml = { ...syntheticFiles,
  "xl/worksheets/sheet1.xml": strToU8('<!DOCTYPE x><worksheet><sheetData/></worksheet>') };
assert.throws(() => readLinkedInXlsx(workbookBytes(withBadXml)), /Unsupported XML markup/);
const withFormula = { ...syntheticFiles,
  "xl/worksheets/sheet1.xml": strToU8(syntheticFiles["xl/worksheets/sheet1.xml"].length ? new TextDecoder().decode(syntheticFiles["xl/worksheets/sheet1.xml"]).replace('<is><t>12</t></is>', '<f>1+2</f><v>3</v>') : "") };
assert.throws(() => readLinkedInXlsx(workbookBytes(withFormula)), /Formula cells are not supported/);

console.log("LinkedIn XLSX reader and six-sheet normalizer: synthetic and adversarial cases passed");
