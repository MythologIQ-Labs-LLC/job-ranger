/**
 * Historical LinkedIn content is USER-ATTESTED text, not an approved
 * Job Ranger publishing package or verified live provider content.
 * Analytics XLSX contains neither post body nor comment text.
 */
import type { LinkedInReconciliationReport } from "./linkedin-reconciliation.js";
import type { ManualPublicationReceipt } from "./personal-brand.js";

export type HistoricalTextSource = "copied_from_post" | "reconstructed_from_memory";
export interface HistoricalLinkedInPostInput {
  url: string;
  publishedOn: string;
  body: string;
  textSource: HistoricalTextSource;
}
export interface HistoricalLinkedInPost extends HistoricalLinkedInPostInput {
  id: string;
  recordedAt: string;
  bodySha256: string;
  source: "user_attested_historical";
  userConfirmed: true;
}
export interface HistoricalPostAnalyticsMatch {
  historicalId: string;
  url: string;
  publishedOn: string;
  status: "linked" | "not-in-latest-ranking" | "publication-date-conflict" | "duplicate-ranking";
  impressions: number | null;
  engagements: number | null;
  sourceImportId: string | null;
  explanation: string;
}
function strictDay(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("Provide the original publication date as YYYY-MM-DD.");
  }
  const [y,m,d] = raw.split("-").map(Number);
  const actual = new Date(Date.UTC(y,m-1,d));
  if (y < 2003 || y > 9999 || actual.getUTCFullYear() !== y ||
      actual.getUTCMonth() !== m-1 || actual.getUTCDate() !== d) {
    throw new Error("Invalid historical LinkedIn publication date.");
  }
  return raw;
}
export function canonicalHistoricalLinkedInUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 1600) {
    throw new Error("A LinkedIn post permalink is required.");
  }
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("Invalid LinkedIn post permalink."); }
  if (url.protocol !== "https:" || !["www.linkedin.com","linkedin.com"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.port || url.pathname.includes("//") ||
      !/^\/(posts\/|feed\/update\/)/.test(url.pathname)) {
    throw new Error("Permalink must point to a LinkedIn post, not another website.");
  }
  url.hostname = "www.linkedin.com";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}
export function validateHistoricalLinkedInPost(raw: unknown): HistoricalLinkedInPostInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid historical post input.");
  const item = raw as Record<string, unknown>;
  const keys=["url","publishedOn","body","textSource"];
  if (Object.keys(item).some(key=>!keys.includes(key)) ||
      keys.some(key=>!Object.hasOwn(item,key))) {
    throw new Error("Unknown or missing historical post fields.");
  }
  const url = canonicalHistoricalLinkedInUrl(item.url);
  const publishedOn = strictDay(item.publishedOn);
  if (typeof item.body !== "string" || !item.body.trim() || item.body.length > 12000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.body)) {
    throw new Error("Historical post text must be 1–12,000 characters without control characters.");
  }
  if (item.textSource !== "copied_from_post" && item.textSource !== "reconstructed_from_memory") {
    throw new Error("Choose how the historical post text was obtained.");
  }
  return {url,publishedOn,body:item.body,textSource:item.textSource};
}
/**
 * Read-only URL join against ONE latest, partial top-50 LinkedIn sample.
 * We do not infer a zero from absence, or treat dates as timestamps.
 */
export function matchHistoricalPostsToLatestRanking(
  records: readonly HistoricalLinkedInPost[],
  analytics: LinkedInReconciliationReport,
): HistoricalPostAnalyticsMatch[] {
  const byUrl = new Map<string, typeof analytics.topPostsFromLatestExport>();
  for(const post of analytics.topPostsFromLatestExport){
    const key=canonicalHistoricalLinkedInUrl(post.url);
    byUrl.set(key,[...(byUrl.get(key)??[]),post]);
  }
  return records.map(record=>{
    const matches=byUrl.get(record.url)??[];
    const base={historicalId:record.id,url:record.url,publishedOn:record.publishedOn,
      impressions:null,engagements:null,sourceImportId:null};
    if(!matches.length)return {...base,status:"not-in-latest-ranking" as const,
      explanation:"This post is not in the latest workbook's partial top-post lists. Performance is unknown."};
    if(matches.length!==1)return {...base,status:"duplicate-ranking" as const,
      explanation:"Multiple ranked entries match this URL; attribution is withheld."};
    const candidate=matches[0];
    if(candidate.publishedOn!==record.publishedOn)return {...base,status:"publication-date-conflict" as const,
      explanation:"The manually entered publication day disagrees with the LinkedIn export. Review before attributing metrics."};
    return {...base,status:"linked" as const,
      impressions:candidate.impressions,engagements:candidate.engagements,sourceImportId:candidate.sourceImportId,
      explanation:"Metrics are reported in the latest manually imported XLSX. Post text is user-attested, not provider-verified."};
  });
}
export function collidesWithApprovedPublication(
  url:string, receipts: readonly ManualPublicationReceipt[],
): boolean {
  return receipts.some(item=>{
    if(item.destination!=="linkedin")return false;
    try { return canonicalHistoricalLinkedInUrl(item.publishedUrl)===url; }
    catch{return false;}
  });
}
