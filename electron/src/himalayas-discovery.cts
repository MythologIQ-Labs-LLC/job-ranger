/**
 * Bounded normalization of the first-party Himalayas jobs API.
 * Do not turn discovered job data into Career Evidence or an approved monitor.
 * Spec: https://himalayas.app/docs/remote-jobs-api
 */
export interface HimalayasNormalizedJob {
  guid: string;
  title: string;
  companyName: string;
  opportunityUrl: string;
  locationRestrictions: string[] | null;
  timezoneRestrictions: string[] | null;
  employmentType: string | null;
  publishedAt: string | null;
  summary: string;
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

function restrictionList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 12) return null;
  const result: string[] = [];
  for (const part of value) {
    const text = shortText(part, 80);
    if (!text) return null;
    result.push(text);
  }
  return result;
}

function publicationDate(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

export function normalizeHimalayasResponse(raw: unknown): HimalayasNormalizedJob[] {
  const envelope = record(raw);
  if (!envelope || !Array.isArray(envelope.jobs)) {
    throw new Error("Himalayas payload must contain a jobs array");
  }
  if (envelope.jobs.length > 100) throw new Error("Himalayas response contains too many jobs");

  const results: HimalayasNormalizedJob[] = [];
  const seen = new Set<string>();
  for (const rawJob of envelope.jobs) {
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
      locationRestrictions: restrictionList(item.locationRestrictions),
      timezoneRestrictions: restrictionList(item.timezoneRestrictions),
      employmentType: shortText(item.employmentType) ?? null,
      publishedAt: publicationDate(item.pubDate),
      summary: shortText(item.excerpt, 4000) ?? shortText(item.description, 4000) ?? "",
    });
  }
  return results;
}
