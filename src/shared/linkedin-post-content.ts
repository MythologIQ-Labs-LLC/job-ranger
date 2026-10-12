/**
 * Join the latest LinkedIn XLSX TOP POSTS sample to independently
 * user-confirmed Job Ranger publication receipts and immutable copy packages.
 *
 * Content is NEVER present in the analytics export itself. A URL match alone
 * does not prove the exact published content: show copy only when the original
 * user-reviewed package fingerprint and revision match the receipt, and the
 * calendar dates agree. This is an observational read model, not a mutation.
 */
import type { LinkedInReconciliationReport } from "./linkedin-reconciliation.js";
import type {
  HookArchetype, ManualPostPackage, ManualPublicationReceipt,
  PersonalBrandDraft, PostFormat, PresenceObjective,
} from "./personal-brand.js";

/** Same SHA-256-of-exact-UTF8 contract used by manual post preparation.
 * Inline here to keep Node type-stripping tests and both runtimes source-only.
 */
async function fingerprintExactCopy(body: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export type RankedPostLinkStatus =
  | "unmatched" | "ambiguous-url" | "publication-date-conflict"
  | "copy-unavailable" | "copy-fingerprint-conflict" | "copy-verified";

export interface RankedPostContentRow {
  url: string;
  publishedOn: string;
  impressions: number | null;
  engagements: number | null;
  sourceImportId: string;
  status: RankedPostLinkStatus;
  explanation: string;
  postId: string | null;
  /** Byte-for-byte copy of the human-approved package; never synthesized. */
  reviewedCopy: string | null;
  objective: PresenceObjective | null;
  hook: HookArchetype | null;
  format: PostFormat | null;
  /** True iff current draft version matches the published, reviewed revision. */
  metadataCurrent: boolean;
}
export interface RankedPostContentReport {
  sourceImportId: string | null;
  totalRanked: number;
  verifiedCopyCount: number;
  unmatchedCount: number;
  rows: RankedPostContentRow[];
  warnings: string[];
}

/** Only LinkedIn post permalinks; tracking parameters are not identity. */
export function canonicalLinkedInPostUrl(raw: string): string | null {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 1600) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password ||
      !["www.linkedin.com", "linkedin.com"].includes(url.hostname.toLowerCase()) ||
      url.port || !/^\/(posts\/|feed\/update\/)/.test(url.pathname) ||
      url.pathname.includes("//")) return null;
  url.hostname = "www.linkedin.com";
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

export async function matchLinkedInRankedPosts(
  analytics: LinkedInReconciliationReport,
  receipts: readonly ManualPublicationReceipt[],
  packages: readonly ManualPostPackage[],
  currentDrafts: readonly PersonalBrandDraft[],
): Promise<RankedPostContentReport> {
  const byUrl = new Map<string, ManualPublicationReceipt[]>();
  for (const receipt of receipts) {
    if (receipt.destination !== "linkedin" || receipt.source !== "user_confirmed") continue;
    const canonical = canonicalLinkedInPostUrl(receipt.publishedUrl);
    if (!canonical) continue;
    const group = byUrl.get(canonical) ?? [];
    group.push(receipt);
    byUrl.set(canonical, group);
  }
  const rows: RankedPostContentRow[] = await Promise.all(analytics.topPostsFromLatestExport.map(async post => {
    const base = {
      url: post.url, publishedOn: post.publishedOn, impressions: post.impressions,
      engagements: post.engagements, sourceImportId: post.sourceImportId,
      postId: null, reviewedCopy: null, objective: null, hook: null,
      format: null, metadataCurrent: false,
    } satisfies Omit<RankedPostContentRow, "status" | "explanation">;
    const canonical = canonicalLinkedInPostUrl(post.url);
    if (!canonical) return {
      ...base, status: "unmatched" as const,
      explanation: "Export permalink is invalid or outside supported LinkedIn post URLs.",
    };
    const matches = byUrl.get(canonical) ?? [];
    if (!matches.length) return {
      ...base, status: "unmatched" as const,
      explanation: "No user-confirmed publication receipt matches this permalink.",
    };
    if (matches.length !== 1) return {
      ...base, status: "ambiguous-url" as const,
      explanation: "Multiple publication receipts match this permalink. No copy is selected.",
    };
    const receipt = matches[0];
    if (!/^\d{4}-\d{2}-\d{2}T/.test(receipt.publishedAt) ||
        receipt.publishedAt.slice(0, 10) !== post.publishedOn) {
      return {
        ...base, status: "publication-date-conflict" as const, postId: receipt.postId,
        explanation: "The workbook publication day conflicts with the user-confirmed receipt date. Review dates before linking content.",
      };
    }
    const approved = packages.filter(pkg =>
      pkg.draftId === receipt.draftId &&
      pkg.approvedRevision === receipt.approvedRevision &&
      pkg.destination === "linkedin" &&
      pkg.status === "prepared_for_manual_copy" && pkg.humanReviewConfirmed === true);
    if (!approved.length) return {
      ...base, status: "copy-unavailable" as const, postId: receipt.postId,
      explanation: "A receipt matches, but no original human-reviewed copy package is available.",
    };
    if (approved.length !== 1 || !approved[0].sha256 ||
        approved[0].sha256 !== receipt.contentSha256 ||
        await fingerprintExactCopy(approved[0].body) !== approved[0].sha256) return {
      ...base, status: "copy-fingerprint-conflict" as const, postId: receipt.postId,
      explanation: "The stored approved copy has inconsistent fingerprints or revisions. Content is withheld.",
    };
    const pkg = approved[0];
    const draft = currentDrafts.find(item => item.id === receipt.draftId &&
      item.revision === receipt.approvedRevision && item.destination === "linkedin" &&
      item.body === pkg.body);
    return {
      ...base, status: "copy-verified" as const, postId: receipt.postId,
      reviewedCopy: pkg.body,
      explanation: "The original human-approved copy and confirmed publication receipt agree. The live LinkedIn post text has not been fetched or independently verified.",
      metadataCurrent: !!draft, objective: draft?.objective ?? null,
      hook: draft?.hookArchetype ?? null, format: draft?.format ?? null,
    };
  }));
  const verifiedCopyCount = rows.filter(row => row.status === "copy-verified").length;
  const unmatchedCount = rows.filter(row => row.status === "unmatched").length;
  const warnings = [
    "Post rankings are a partial sample from one imported XLSX, not an all-time ranking or a complete publishing archive.",
    "A saved review package proves only the user-approved text. Job Ranger has not read LinkedIn's live post or its comments.",
    "Comparing raw post totals without the same observation-age window does not establish content effectiveness.",
  ];
  if (rows.some(row => row.status === "publication-date-conflict"))
    warnings.push("Date conflicts are withheld; the XLSX has a publication date but no timezone.");
  if (rows.some(row => row.status === "copy-fingerprint-conflict" || row.status === "ambiguous-url"))
    warnings.push("Ambiguous or fingerprint-conflicting records are not automatically attributed.");
  return {
    sourceImportId: analytics.latestImportId,
    totalRanked: rows.length,
    verifiedCopyCount, unmatchedCount, rows, warnings,
  };
}
