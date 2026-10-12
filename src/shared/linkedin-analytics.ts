/**
 * Deterministic normalization of LinkedIn's manually exported six-sheet
 * AggregateAnalytics .xlsx format. Input rows are UNTRUSTED, already decoded
 * cells, not live platform data. No inference, network or persistence.
 *
 * The TOP POSTS sheet has two independent top-50 rankings in A:C and E:G;
 * column D is an ignored export artifact and some entries can predate the
 * selected reporting period. Do not sum top-post values into daily totals.
 */
export type WorkbookRows = Record<string, ReadonlyArray<ReadonlyArray<unknown>>>;
export interface LinkedInDailyObservation {
  date: string;
  impressions: number;
  engagements: number;
  newFollowers: number | null;
}
export interface LinkedInRankedPost {
  url: string;
  publishedOn: string;
  impressions: number | null;
  engagements: number | null;
}
export interface LinkedInDemographic {
  category: string;
  value: string;
  reportedPercentage: string;
}
export interface LinkedInExportPreview {
  format: "linkedin-aggregate-analytics-v1";
  period: { start: string; end: string };
  discovery: { impressions: number; membersReached: number };
  followers: { asOf: string; total: number };
  daily: LinkedInDailyObservation[];
  topPosts: LinkedInRankedPost[];
  audienceDemographics: LinkedInDemographic[];
  contentDemographics: LinkedInDemographic[];
  warnings: string[];
  provenance: "manual-linkedIn-export";
}

const expectedSheets = [
  "DISCOVERY", "ENGAGEMENT", "TOP POSTS", "FOLLOWERS",
  "AUDIENCE DEMOGRAPHICS", "CONTENT DEMOGRAPHICS",
] as const;
const cell = (row: ReadonlyArray<unknown> | undefined, index: number): string =>
  String(row?.[index] ?? "").trim();
const normalized = (value: string): string => value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();

function isoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || year < 1900 || year > 9999) {
    throw new Error("Invalid LinkedIn export calendar date.");
  }
  return date.toISOString().slice(0, 10);
}
function parseDate(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value < 2_958_465) {
    // Excel 1900 date system, accounting for its historic leap-year error.
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const v = String(value ?? "").trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  throw new Error("Invalid " + label + " date in LinkedIn export.");
}
function integer(value: unknown, label: string): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid " + label + ".");
  const raw = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,14}|[1-9]\d{0,2}(?:,\d{3})+)$/.test(raw)) throw new Error("Invalid " + label + ".");
  const number = Number(raw.replace(/,/g, ""));
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid " + label + ".");
  return number;
}
function header(row: ReadonlyArray<unknown> | undefined, labels: string[], offset = 0): boolean {
  return labels.every((label, i) => normalized(cell(row, i + offset)) === normalized(label));
}
function relevantRows(rows: ReadonlyArray<ReadonlyArray<unknown>>, from: number, cols: number) {
  return rows.slice(from).filter(row => Array.from({ length: cols }, (_, i) => cell(row, i)).some(Boolean));
}
function canonicalPostUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 1500) throw new Error("Invalid LinkedIn post URL.");
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("Invalid LinkedIn post URL."); }
  if (url.protocol !== "https:" || !["www.linkedin.com", "linkedin.com"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.port || !/^\/(?:posts\/|feed\/update\/)/.test(url.pathname)) {
    throw new Error("Invalid LinkedIn post URL.");
  }
  url.hostname = "www.linkedin.com";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}
function demographics(rows: ReadonlyArray<ReadonlyArray<unknown>>, name: string): LinkedInDemographic[] {
  if (!header(rows[0], ["Top Demographics", "Value", "Percentage"])) {
    throw new Error(name + " has unexpected headings.");
  }
  if (rows.length > 205) throw new Error(name + " has too many rows.");
  return relevantRows(rows, 1, 3).map((row, index) => {
    const category = cell(row, 0), value = cell(row, 1), reportedPercentage = cell(row, 2);
    if (!category || !value || category.length > 120 || value.length > 200 ||
        !/^(?:\d{1,3}%|< ?1%)$/.test(reportedPercentage)) {
      throw new Error("Invalid " + name + " row " + (index + 2) + ".");
    }
    if (reportedPercentage.endsWith("%") && !reportedPercentage.startsWith("<") &&
        Number(reportedPercentage.slice(0, -1)) > 100) {
      throw new Error("Invalid " + name + " percentage.");
    }
    return { category, value, reportedPercentage };
  });
}

/** Parser-agnostic, strict normalization. Never treats an unknown as zero. */
export function normalizeLinkedInAnalyticsExport(untrusted: WorkbookRows): LinkedInExportPreview {
  if (!untrusted || typeof untrusted !== "object" || Array.isArray(untrusted)) {
    throw new Error("LinkedIn export workbook sheets are required.");
  }
  const byName = new Map<string, ReadonlyArray<ReadonlyArray<unknown>>>();
  for (const [name, rows] of Object.entries(untrusted)) {
    if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !Array.isArray(row) || row.length > 64)) {
      throw new Error("Invalid LinkedIn worksheet size.");
    }
    const key = name.trim().toUpperCase();
    if (byName.has(key)) throw new Error("Duplicate worksheet: " + key);
    byName.set(key, rows);
  }
  for (const sheet of expectedSheets) {
    if (!byName.has(sheet)) throw new Error("LinkedIn export is missing " + sheet + " worksheet.");
  }
  const sheet = (name: typeof expectedSheets[number]) => byName.get(name)!;
  const discovery = sheet("DISCOVERY");
  if (normalized(cell(discovery[0], 0)) !== "overall performance" ||
      normalized(cell(discovery[1], 0)) !== "impressions" ||
      normalized(cell(discovery[2], 0)) !== "members reached") {
    throw new Error("DISCOVERY worksheet has unexpected headings.");
  }
  const dates = /^(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})$/.exec(cell(discovery[0], 1));
  if (!dates) throw new Error("DISCOVERY reporting period is unavailable.");
  const start = parseDate(dates[1], "report start"), end = parseDate(dates[2], "report end");
  if (end < start) throw new Error("Reporting period is reversed.");
  const impressions = integer(discovery[1]?.[1], "overall impressions");
  const membersReached = integer(discovery[2]?.[1], "members reached");

  const engagement = sheet("ENGAGEMENT");
  if (!header(engagement[0], ["Date", "Impressions", "Engagements"])) {
    throw new Error("ENGAGEMENT worksheet has unexpected headings.");
  }
  const daily = new Map<string, LinkedInDailyObservation>();
  for (const [index, row] of relevantRows(engagement, 1, 3).entries()) {
    const date = parseDate(row[0], "engagement");
    if (date < start || date > end || daily.has(date)) throw new Error("Out-of-period or duplicate ENGAGEMENT date at row " + (index + 2) + ".");
    daily.set(date, {
      date, impressions: integer(row[1], "daily impressions"),
      engagements: integer(row[2], "daily engagements"), newFollowers: null,
    });
  }
  const followerRows = sheet("FOLLOWERS");
  const followerMatch = /^total followers on (.+)$/i.exec(cell(followerRows[0], 0));
  if (!followerMatch || !header(followerRows[2], ["Date", "New followers"])) {
    throw new Error("FOLLOWERS worksheet has unexpected headings.");
  }
  const followerAsOf = parseDate(followerMatch[1], "follower total");
  const total = integer(followerRows[0]?.[1], "total followers");
  const followerDays = new Map<string, number>();
  for (const [index, row] of relevantRows(followerRows, 3, 2).entries()) {
    const date = parseDate(row[0], "follower");
    if (date < start || date > end || followerDays.has(date)) throw new Error("Out-of-period or duplicate FOLLOWERS date at row " + (index + 4) + ".");
    followerDays.set(date, integer(row[1], "new followers"));
    const present = daily.get(date);
    if (present) present.newFollowers = followerDays.get(date)!;
  }

  const tops = sheet("TOP POSTS");
  const topHeader = tops.findIndex(row => header(row, ["Post URL", "Post Publish Date", "Engagements"]) &&
    header(row, ["Post URL", "Post Publish Date", "Impressions"], 4));
  if (topHeader < 0 || topHeader > 9) throw new Error("TOP POSTS rankings have unexpected headings.");
  const posts = new Map<string, LinkedInRankedPost>();
  let seenEngagements = 0, seenImpressions = 0;
  for (const row of tops.slice(topHeader + 1)) {
    for (const [urlCol, dateCol, metricCol, metric] of [
      [0, 1, 2, "engagements"], [4, 5, 6, "impressions"],
    ] as const) {
      const urlText = cell(row, urlCol);
      // LinkedIn exports can fill unused cells with a repeated numeric placeholder.
      if (!urlText || /^\d+$/.test(urlText)) continue;
      const url = canonicalPostUrl(urlText);
      const publishedOn = parseDate(row[dateCol], "post publication");
      const value = integer(row[metricCol], "post " + metric);
      const previous = posts.get(url);
      if (previous && previous.publishedOn !== publishedOn) throw new Error("Conflicting publication dates for one post.");
      if (previous && previous[metric] !== null) throw new Error("Duplicate " + metric + " ranking for one post.");
      posts.set(url, {
        url, publishedOn,
        engagements: metric === "engagements" ? value : (previous?.engagements ?? null),
        impressions: metric === "impressions" ? value : (previous?.impressions ?? null),
      });
      if (metric === "engagements") seenEngagements++;
      else seenImpressions++;
    }
  }
  if (seenEngagements > 50 || seenImpressions > 50) throw new Error("TOP POSTS exceeds the export's 50-post ranking limit.");
  const warnings: string[] = [];
  const dailyRows = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = dailyRows.reduce((s, row) => s + row.impressions, 0);
  if (sum !== impressions) warnings.push("Daily impression total differs from the DISCOVERY total; verify the reporting windows.");
  if (dailyRows.length !== followerDays.size || [...followerDays.keys()].some(date => !daily.has(date))) {
    warnings.push("Follower and engagement reporting dates do not fully overlap.");
  }
  if ([...posts.values()].some(post => post.publishedOn < start || post.publishedOn > end)) {
    warnings.push("TOP POSTS includes publication dates outside the selected reporting period. Rankings are not additive daily totals.");
  }
  if (seenEngagements !== seenImpressions) {
    warnings.push("TOP POSTS contains different coverage in engagement and impression rankings. Missing metrics remain unknown.");
  }
  return {
    format: "linkedin-aggregate-analytics-v1",
    period: { start, end },
    discovery: { impressions, membersReached },
    followers: { asOf: followerAsOf, total },
    daily: dailyRows,
    topPosts: [...posts.values()].sort((a, b) => (b.impressions ?? -1) - (a.impressions ?? -1) || a.url.localeCompare(b.url)),
    audienceDemographics: demographics(sheet("AUDIENCE DEMOGRAPHICS"), "AUDIENCE DEMOGRAPHICS"),
    contentDemographics: demographics(sheet("CONTENT DEMOGRAPHICS"), "CONTENT DEMOGRAPHICS"),
    warnings,
    provenance: "manual-linkedIn-export",
  };
}
