/**
 * Read-only LinkedIn analytics reconciliation.
 *
 * The saved XLSX snapshots are immutable attestations of what the user
 * imported, not authenticated LinkedIn API measurements. Multiple exports
 * may overlap or disagree. This projection NEVER chooses a winning value
 * for a disputed day, stitches partial top-50 rankings, extrapolates missing
 * dates, or promotes engagement into career outcomes.
 */
import type { LinkedInRankedPost } from "./linkedin-analytics.js";
import type { SavedLinkedInExport } from "./linkedin-import-ledger.js";

export type ReconciledState = "observed" | "missing" | "conflict";
export interface ReconciledValue {
  state: ReconciledState;
  value: number | null;
  /** All exports reporting this metric, sorted newest import first. */
  sources: string[];
}
export interface ReconciledDay {
  date: string;
  impressions: ReconciledValue;
  engagements: ReconciledValue;
  newFollowers: ReconciledValue;
}
export interface RankedPostSnapshot extends LinkedInRankedPost {
  sourceImportId: string;
}
export interface LinkedInReconciliationReport {
  authority: "unverified-manual-export";
  period: { start: string; end: string } | null;
  imports: number;
  latestImportId: string | null;
  coverage: {
    calendarDays: number;
    observedDays: number;
    missingDays: number;
    conflictedDays: number;
  };
  /** Only complete, conflict-free daily series can have totals. */
  totals: { impressions: number | null; engagements: number | null; newFollowers: number | null };
  daily: ReconciledDay[];
  /** Rankings from ONE complete saved export, not a cumulative global ranking. */
  topPostsFromLatestExport: RankedPostSnapshot[];
  warnings: string[];
}
type DayMetrics = { impressions: number; engagements: number; newFollowers: number | null };
type Candidate = { source: string; metrics: DayMetrics };

function sameNumber(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}
function metric(candidates: readonly Candidate[], key: keyof DayMetrics): ReconciledValue {
  const available = candidates.filter(c => c.metrics[key] !== null);
  const sources = available.map(c => c.source);
  if (!available.length) return { state: "missing", value: null, sources: [] };
  const values = new Set(available.map(c => c.metrics[key]));
  if (values.size > 1) return { state: "conflict", value: null, sources };
  return { state: "observed", value: available[0].metrics[key], sources };
}
function dateAt(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}
function dayNumber(date: string): number {
  return Date.parse(date + "T00:00:00.000Z") / 86400000;
}
function sortedImports(imports: readonly SavedLinkedInExport[]): SavedLinkedInExport[] {
  return [...imports].sort((a,b) =>
    b.importedAt.localeCompare(a.importedAt) ||
    a.contentSha256.localeCompare(b.contentSha256) ||
    a.id.localeCompare(b.id));
}

export function reconcileLinkedInExports(
  records: readonly SavedLinkedInExport[],
): LinkedInReconciliationReport {
  if (!Array.isArray(records) || records.length > 250) {
    throw new Error("Too many saved LinkedIn imports for a reconciliation projection.");
  }
  if (new Set(records.map(record => record.id)).size !== records.length ||
      new Set(records.map(record => record.contentSha256)).size !== records.length) {
    throw new Error("Duplicate saved LinkedIn imports cannot be reconciled.");
  }
  const sorted = sortedImports(records);
  const latest = sorted[0];
  if (!latest) return {
    authority: "unverified-manual-export", period: null, imports: 0,
    latestImportId: null, coverage: {
      calendarDays: 0, observedDays: 0, missingDays: 0, conflictedDays: 0,
    },
    totals: { impressions: null, engagements: null, newFollowers: null },
    daily: [], topPostsFromLatestExport: [],
    warnings: ["No LinkedIn exports saved. Import a workbook to compare observed performance."],
  };
  const start = sorted.reduce((earliest, record) =>
    record.preview.period.start < earliest ? record.preview.period.start : earliest, latest.preview.period.start);
  const end = sorted.reduce((last, record) =>
    record.preview.period.end > last ? record.preview.period.end : last, latest.preview.period.end);
  const firstDay = dayNumber(start), lastDay = dayNumber(end);
  if (!Number.isInteger(firstDay) || !Number.isInteger(lastDay) ||
      firstDay > lastDay || lastDay-firstDay > 3000) {
    throw new Error("Invalid or excessive LinkedIn reporting period.");
  }
  const byDay = new Map<string, Candidate[]>();
  for (const record of sorted) {
    if (!/^linkedin-import-[a-f0-9-]{36}$/.test(record.id) ||
        !/^[a-f0-9]{64}$/.test(record.contentSha256) ||
        !Number.isFinite(Date.parse(record.importedAt))) {
      throw new Error("Invalid saved LinkedIn import provenance.");
    }
    for (const row of record.preview.daily) {
      if (row.date < record.preview.period.start || row.date > record.preview.period.end ||
          !sameNumber(row.impressions) || !sameNumber(row.engagements) ||
          !sameNumber(row.newFollowers)) {
        throw new Error("Invalid saved LinkedIn daily observation.");
      }
      const group = byDay.get(row.date) ?? [];
      if (group.some(c => c.source === record.id)) throw new Error("Duplicate daily observations in saved export.");
      group.push({ source: record.id, metrics: row });
      byDay.set(row.date, group);
    }
  }
  const daily: ReconciledDay[] = [];
  let observedDays = 0, missingDays = 0, conflictedDays = 0;
  for (let cursor = firstDay; cursor <= lastDay; cursor++) {
    const date = dateAt(cursor), candidates = byDay.get(date) ?? [];
    const row: ReconciledDay = {
      date, impressions: metric(candidates, "impressions"),
      engagements: metric(candidates, "engagements"),
      newFollowers: metric(candidates, "newFollowers"),
    };
    if (candidates.length) observedDays++;
    else missingDays++;
    if ([row.impressions,row.engagements,row.newFollowers].some(m => m.state === "conflict"))
      conflictedDays++;
    daily.push(row);
  }
  const total = (key: "impressions" | "engagements" | "newFollowers"): number | null => {
    if (daily.some(row => row[key].state !== "observed")) return null;
    const sum = daily.reduce((n,row) => n + row[key].value!, 0);
    return Number.isSafeInteger(sum) ? sum : null;
  };
  const warnings: string[] = [];
  if (conflictedDays) warnings.push(
    `${conflictedDays} date(s) have conflicting observations across imports. Disputed metrics are hidden, not silently overwritten.`);
  if (missingDays) warnings.push(
    `${missingDays} date(s) lack daily observations across the selected period. Full-period totals are withheld.`);
  if (daily.some(row => row.newFollowers.state === "missing") && !missingDays) {
    warnings.push("New-follower figures are missing for some days. No follower-growth total is shown.");
  }
  if (sorted.length > 1) warnings.push(
    "Overlapping exports are compared by calendar date and metric, never added as independent reporting periods.");
  if (latest.preview.warnings.length) warnings.push(
    "The latest saved export contains source interpretation warnings. Review its import record before using rankings.");
  warnings.push("Top posts and demographic breakdowns reflect only the latest imported workbook. Ranking coverage is incomplete and not additive.");
  const posts = latest.preview.topPosts.map(post => ({ ...post, sourceImportId: latest.id }));
  return {
    authority: "unverified-manual-export",
    period: { start, end }, imports: sorted.length, latestImportId: latest.id,
    coverage: { calendarDays: daily.length, observedDays, missingDays, conflictedDays },
    totals: { impressions: total("impressions"), engagements: total("engagements"),
      newFollowers: total("newFollowers") },
    daily,
    topPostsFromLatestExport: posts,
    warnings,
  };
}
