/** Strict server-side validation of an untrusted manually supplied LinkedIn export preview.
 * No network, inference, raw XLSX persistence, post-receipt mutation or roll-ups.
 */
import type { LinkedInExportPreview } from "./linkedin-analytics.js";

export interface SavedLinkedInExport {
  id: string;
  contentSha256: string;
  importedAt: string;
  source: "linkedin-native-xlsx-manual";
  preview: LinkedInExportPreview;
}
export interface LinkedInImportResult {
  record: SavedLinkedInExport;
  alreadyPresent: boolean;
}
function fields(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid " + label + ".");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(object, key))) {
    throw new Error("Invalid " + label + " fields.");
  }
  return object;
}
function text(value: unknown, label: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid " + label + ".");
  return value.trim();
}
function date(value: unknown, label: string): string {
  const raw = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Invalid " + label + ".");
  const [y, m, d] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 9999 || parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) throw new Error("Invalid " + label + ".");
  return raw;
}
function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) {
    throw new Error("Invalid " + label + ".");
  }
  return value;
}
function list<T>(raw: unknown, label: string, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(raw) || raw.length > max) throw new Error("Invalid " + label + " count.");
  return raw.map(parse);
}
function postUrl(value: unknown): string {
  const original = text(value, "LinkedIn post URL", 1500);
  let url: URL;
  try { url = new URL(original); } catch { throw new Error("Invalid LinkedIn post URL."); }
  if (url.protocol !== "https:" || url.hostname !== "www.linkedin.com" ||
      !/^\/(posts\/|feed\/update\/)/.test(url.pathname) ||
      url.username || url.password || url.search || url.hash || url.port ||
      url.toString() !== original) throw new Error("Invalid LinkedIn post URL.");
  return original;
}
function percentage(value: unknown): string {
  const raw = text(value, "demographic percentage", 8);
  if (!/^(?:\d{1,3}%|< ?1%)$/.test(raw) ||
      (!raw.startsWith("<") && Number(raw.slice(0, -1)) > 100)) {
    throw new Error("Invalid demographic percentage.");
  }
  return raw;
}
export function validateLinkedInImport(raw: unknown): LinkedInExportPreview {
  const input = fields(raw, [
    "format", "period", "discovery", "followers", "daily", "topPosts",
    "audienceDemographics", "contentDemographics", "warnings", "provenance",
  ], "LinkedIn export");
  if (input.format !== "linkedin-aggregate-analytics-v1" || input.provenance !== "manual-linkedIn-export") {
    throw new Error("Unsupported LinkedIn export version or provenance.");
  }
  const period = fields(input.period, ["start", "end"], "reporting period");
  const start = date(period.start, "period start"), end = date(period.end, "period end");
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 366) {
    throw new Error("Invalid reporting period duration.");
  }
  const d = fields(input.discovery, ["impressions", "membersReached"], "discovery metrics");
  const discovery = {
    impressions: count(d.impressions, "impressions"),
    membersReached: count(d.membersReached, "members reached"),
  };
  const f = fields(input.followers, ["asOf", "total"], "followers");
  const followers = { asOf: date(f.asOf, "follower date"), total: count(f.total, "total followers") };
  const daily = list(input.daily, "daily analytics", 370, rawRow => {
    const row = fields(rawRow, ["date", "impressions", "engagements", "newFollowers"], "daily observation");
    return {
      date: date(row.date, "observation date"),
      impressions: count(row.impressions, "daily impressions"),
      engagements: count(row.engagements, "daily engagements"),
      newFollowers: row.newFollowers === null ? null : count(row.newFollowers, "new followers"),
    };
  });
  if (daily.some(row => row.date < start || row.date > end) ||
      new Set(daily.map(row => row.date)).size !== daily.length) {
    throw new Error("Duplicate or out-of-period daily LinkedIn observation.");
  }
  const topPosts = list(input.topPosts, "top posts", 100, rawRow => {
    const row = fields(rawRow, ["url", "publishedOn", "impressions", "engagements"], "ranked post");
    if (row.impressions === null && row.engagements === null) throw new Error("Ranked post has no metrics.");
    return {
      url: postUrl(row.url),
      publishedOn: date(row.publishedOn, "post date"),
      impressions: row.impressions === null ? null : count(row.impressions, "post impressions"),
      engagements: row.engagements === null ? null : count(row.engagements, "post engagements"),
    };
  });
  if (new Set(topPosts.map(row => row.url)).size !== topPosts.length) {
    throw new Error("Duplicate ranked LinkedIn post URL.");
  }
  const parseDemo = (rawRow: unknown) => {
    const row = fields(rawRow, ["category", "value", "reportedPercentage"], "demographic row");
    return { category: text(row.category, "demographic category", 120),
      value: text(row.value, "demographic value", 200),
      reportedPercentage: percentage(row.reportedPercentage) };
  };
  const audienceDemographics = list(input.audienceDemographics, "audience demographics", 200, parseDemo);
  const contentDemographics = list(input.contentDemographics, "content demographics", 200, parseDemo);
  const warnings = list(input.warnings, "import warnings", 30, warning => text(warning, "import warning", 350));
  const expected = daily.reduce((sum, row) => sum + row.impressions, 0);
  if (expected !== discovery.impressions && !warnings.some(w => w.includes("Daily impression total differs"))) {
    throw new Error("Inconsistent daily and discovery totals without warning.");
  }
  return {
    format: "linkedin-aggregate-analytics-v1", period: { start, end }, discovery, followers,
    daily: daily.sort((a,b) => a.date.localeCompare(b.date)),
    topPosts: topPosts.sort((a,b) => (b.impressions ?? -1) - (a.impressions ?? -1) || a.url.localeCompare(b.url)),
    audienceDemographics, contentDemographics, warnings, provenance: "manual-linkedIn-export",
  };
}
