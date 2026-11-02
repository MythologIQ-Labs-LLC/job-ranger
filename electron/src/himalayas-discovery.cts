/**
 * Bounded acquisition and normalization of the first-party Himalayas jobs API.
 * Do not turn discovered job data into Career Evidence or an approved monitor.
 * Spec: https://himalayas.app/docs/remote-jobs-api
 *
 * Privacy: Sojourner reads the unfiltered browse endpoint and filters by
 * target-role title locally. No search terms, locations or other user-derived
 * values are ever placed in a Himalayas request; the only query parameters are
 * the fixed page size and the opaque cursor Himalayas itself returned.
 */
import { fetchDiscoveryJson } from "./source-discovery-fetch.cjs";

export const HIMALAYAS_BROWSE_ENDPOINT = "https://himalayas.app/jobs/api";
/** The browse endpoint's documented maximum page size. */
export const HIMALAYAS_PAGE_SIZE = 20;
/** Sequential pages read per discovery run; bounds requests to the shared public allowance. */
export const HIMALAYAS_MAX_PAGES = 5;
/** Per-page body cap. A live 20-job page was about 171 KB on 2026-11-02. */
export const HIMALAYAS_MAX_RESPONSE_BYTES = 1024 * 1024;

const MAX_JOBS_PER_PAGE = 100;
const MAX_LOCATIONS = 250;
const MAX_TIMEZONES = 50;
const LISTED_RESTRICTIONS = 3;
const EARLIEST_PUBLICATION_MS = Date.UTC(2000, 0, 1);
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const CURSOR_PATTERN = /^[A-Za-z0-9_=+/-]{1,512}$/;
const UTC_OFFSET_PATTERN = /^UTC[+-](0[0-9]|1[0-4]):(00|30|45)$/;
const NUMERIC_OFFSET_PATTERN = /^[+-]?\d{1,2}(\.\d{1,2})?$/;

/**
 * A restriction list as published, capped for display. `total` is the
 * provider's full entry count, so a truncated list still renders truthfully.
 */
export interface HimalayasRestrictions {
  entries: string[];
  total: number;
}

export interface HimalayasNormalizedJob {
  guid: string;
  title: string;
  companyName: string;
  opportunityUrl: string;
  locationRestrictions: HimalayasRestrictions | null;
  timezoneRestrictions: HimalayasRestrictions | null;
  employmentType: string | null;
  publishedAt: string | null;
  summary: string;
}

export interface HimalayasFetchResult {
  jobs: HimalayasNormalizedJob[];
  pagesRead: number;
  warnings: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function shortText(value: unknown, limit = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= limit ? text : null;
}

/** Countries arrive as names; the documented object form carries a `name`. */
function locationEntry(value: unknown): string | null {
  return shortText(value, 80) ?? shortText(record(value)?.name, 80);
}

function formatOffset(hours: number): string | null {
  if (!Number.isFinite(hours) || hours < -12 || hours > 14) return null;
  return `UTC${hours < 0 ? "-" : "+"}${Math.abs(hours)}`;
}

/** Live values are numeric hour offsets; the documented form is a UTC offset string. */
function timezoneEntry(value: unknown): string | null {
  if (typeof value === "number") return formatOffset(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (UTC_OFFSET_PATTERN.test(text)) return text;
  return NUMERIC_OFFSET_PATTERN.test(text) ? formatOffset(Number(text)) : null;
}

/**
 * Accept long lists and keep only the first `cap` entries, recording the full
 * count. Any malformed entry makes eligibility unknown (null) rather than
 * silently narrowing or widening it; the listing itself is still kept.
 */
function restrictions(
  value: unknown,
  cap: number,
  entry: (part: unknown) => string | null,
): HimalayasRestrictions | null {
  if (!Array.isArray(value)) return null;
  const entries: string[] = [];
  for (const part of value) {
    const text = entry(part);
    if (!text) return null;
    if (entries.length < cap) entries.push(text);
  }
  return { entries, total: value.length };
}

/** Himalayas documents `pubDate` as Unix seconds; millisecond values are tolerated. */
export function publicationDate(value: unknown, nowMs = Date.now()): string | null {
  let ms: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === "string" && value.trim()) {
    ms = Date.parse(value);
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms < EARLIEST_PUBLICATION_MS || ms > nowMs + FUTURE_TOLERANCE_MS) {
    return null;
  }
  return new Date(ms).toISOString();
}

function himalayasListingUrl(value: unknown): string | null {
  const raw = shortText(value, 2000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        !["himalayas.app", "www.himalayas.app"].includes(parsed.hostname) || parsed.port) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function jobsArray(raw: unknown): unknown[] {
  const envelope = record(raw);
  if (!envelope || !Array.isArray(envelope.jobs)) {
    throw new Error("Himalayas payload must contain a jobs array");
  }
  if (envelope.jobs.length > MAX_JOBS_PER_PAGE) throw new Error("Himalayas response contains too many jobs");
  return envelope.jobs;
}

export function normalizeHimalayasResponse(raw: unknown, nowMs = Date.now()): HimalayasNormalizedJob[] {
  const results: HimalayasNormalizedJob[] = [];
  const seen = new Set<string>();
  for (const rawJob of jobsArray(raw)) {
    const item = record(rawJob);
    if (!item) continue;
    const guid = shortText(item.guid, 400);
    const title = shortText(item.title);
    const companyName = shortText(item.companyName);
    const opportunityUrl = himalayasListingUrl(item.applicationLink);
    if (!guid || !title || !companyName || !opportunityUrl || seen.has(guid)) continue;
    seen.add(guid);
    results.push({
      guid,
      title,
      companyName,
      opportunityUrl,
      locationRestrictions: restrictions(item.locationRestrictions, MAX_LOCATIONS, locationEntry),
      timezoneRestrictions: restrictions(item.timezoneRestrictions, MAX_TIMEZONES, timezoneEntry),
      employmentType: shortText(item.employmentType) ?? null,
      publishedAt: publicationDate(item.pubDate, nowMs),
      summary: shortText(item.excerpt, 4000) ?? shortText(item.description, 4000) ?? "",
    });
  }
  return results;
}

/** The provider-issued pagination cursor, or null when absent or not an opaque token. */
export function himalayasNextCursor(raw: unknown): string | null {
  const cursor = record(raw)?.nextCursor;
  return typeof cursor === "string" && CURSOR_PATTERN.test(cursor) ? cursor : null;
}

/** Browse-page URL. Only the fixed page size and a provider-issued cursor are sent. */
export function himalayasPageUrl(cursor: string | null): string {
  const url = new URL(HIMALAYAS_BROWSE_ENDPOINT);
  url.searchParams.set("limit", String(HIMALAYAS_PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);
  return url.toString();
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read up to HIMALAYAS_MAX_PAGES of the most recent listings, sequentially.
 * A failure on the first page rejects; a later failure keeps earlier pages.
 */
export async function fetchHimalayasJobs(fetchImpl: typeof fetch, nowMs = Date.now()): Promise<HimalayasFetchResult> {
  const jobs: HimalayasNormalizedJob[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pagesRead = 0;
  while (pagesRead < HIMALAYAS_MAX_PAGES) {
    let page: HimalayasNormalizedJob[];
    let raw: unknown;
    try {
      raw = await fetchDiscoveryJson<unknown>(himalayasPageUrl(cursor), fetchImpl, HIMALAYAS_MAX_RESPONSE_BYTES);
      page = normalizeHimalayasResponse(raw, nowMs);
    } catch (error) {
      if (pagesRead === 0) throw error;
      warnings.push(`Himalayas stopped after ${pagesRead} page${pagesRead === 1 ? "" : "s"}: ${reason(error)}`);
      break;
    }
    pagesRead += 1;
    for (const job of page) {
      if (seen.has(job.guid)) continue;
      seen.add(job.guid);
      jobs.push(job);
    }
    cursor = himalayasNextCursor(raw);
    if (!cursor) break;
  }
  return { jobs, pagesRead, warnings };
}

function listRestrictions(list: HimalayasRestrictions): string {
  const shown = list.entries.slice(0, LISTED_RESTRICTIONS).join(", ");
  const more = list.total - Math.min(list.total, LISTED_RESTRICTIONS);
  return more > 0 ? `${shown} and ${more} more` : shown;
}

export function himalayasLocation(job: HimalayasNormalizedJob): string {
  const regions = job.locationRestrictions;
  const timezones = job.timezoneRestrictions;
  if (!regions) return "Remote · eligibility unspecified";
  if (regions.total === 0 && timezones?.total === 0) return "Worldwide remote";

  const parts = ["Remote", regions.total ? listRestrictions(regions) : "countries unrestricted"];
  if (timezones?.total) parts.push(`${listRestrictions(timezones)} time zone`);
  else if (timezones === null) parts.push("time zone eligibility unspecified");
  return parts.join(" · ");
}
