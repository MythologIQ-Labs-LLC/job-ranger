import type { CompanySourceType } from "../../src/shared/contracts.js";
import type { ScrapedJob } from "./scrapers.cjs";
import { parseSalary } from "./salary-parser.cjs";

export function toSourceText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function toSnippet(value: string | null | undefined): string {
  const stripped = toSourceText(value);
  return stripped.length <= 220 ? stripped : `${stripped.slice(0, 217).trimEnd()}...`;
}

function absoluteUrl(baseUrl: string, href: string): string | null {
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}

function normalizeJobTitle(value: string): string {
  return toSourceText(value).replace(/\s+/g, " ").trim();
}

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  } catch { return url; }
}

function collectJobPostingNodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(collectJobPostingNodes);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const graph = record["@graph"];
  const collected = graph ? collectJobPostingNodes(graph) : [];
  if (record["@type"] === "JobPosting") return [record, ...collected];
  return Object.values(record).flatMap(collectJobPostingNodes).concat(collected);
}

function extractJsonLdJobs(baseUrl: string, html: string, sourceType: CompanySourceType): ScrapedJob[] {
  const jobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    const rawBlock = match[1]?.trim();
    if (!rawBlock) continue;
    try {
      const postings = collectJobPostingNodes(JSON.parse(rawBlock) as unknown);
      for (const posting of postings) {
        const title = typeof posting.title === "string" ? posting.title.trim() : "";
        const jobUrlRaw = typeof posting.url === "string" ? posting.url : baseUrl;
        const jobUrl = absoluteUrl(baseUrl, jobUrlRaw);
        if (!title || !jobUrl || seenUrls.has(jobUrl)) continue;

        let location = "Unspecified";
        const locationValue = posting.jobLocation;
        if (Array.isArray(locationValue) && locationValue.length > 0) {
          const addr = (locationValue[0] as Record<string, unknown>).address as Record<string, unknown> | undefined;
          const parts = [
            typeof addr?.addressLocality === "string" ? addr.addressLocality : null,
            typeof addr?.addressRegion === "string" ? addr.addressRegion : null,
            typeof addr?.addressCountry === "string" ? addr.addressCountry : null,
          ].filter((p): p is string => Boolean(p));
          if (parts.length > 0) location = parts.join(", ");
        }

        const description = typeof posting.description === "string" ? posting.description : "";
        const descriptionText = toSourceText(description);
        const salary = parseSalary(description);

        jobs.push({
          sourceJobId: typeof posting.identifier === "string" ? posting.identifier : slugFromUrl(jobUrl),
          sourceType,
          title,
          location,
          employmentType: typeof posting.employmentType === "string" ? posting.employmentType : null,
          url: jobUrl,
          descriptionSnippet: toSnippet(description),
          descriptionText,
          sourceCompleteness: descriptionText ? "full" : "listing-only",
          extractionVersion: "jsonld-v1",
          salaryMin: salary?.min ?? null,
          salaryMax: salary?.max ?? null,
          salaryCurrency: salary?.currency ?? null,
          salaryText: salary?.text ?? null,
          postDate: typeof posting.datePosted === "string" ? posting.datePosted : null,
        });
        seenUrls.add(jobUrl);
      }
    } catch { continue; }
  }
  return jobs;
}

function isLikelyJobLink(url: string, title: string): boolean {
  const haystack = `${url} ${title}`.toLowerCase();
  const hasPositive = /(job|career|position|opening|opportunit|requisition|posting|vacanc|role)/.test(haystack);
  const hasNegative = /(benefit|culture|blog|news|investor|privacy|cookie|login|sign-?in|faq|alert|search all jobs)/.test(haystack);
  return hasPositive && !hasNegative;
}

function extractAnchorJobs(baseUrl: string, html: string, sourceType: CompanySourceType): ScrapedJob[] {
  const jobs: ScrapedJob[] = [];
  const seenUrls = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1];
    const title = normalizeJobTitle(match[2] ?? "");
    const jobUrl = absoluteUrl(baseUrl, href);
    if (!jobUrl || title.length < 3 || seenUrls.has(jobUrl) || !isLikelyJobLink(jobUrl, title)) continue;

    jobs.push({
      sourceJobId: slugFromUrl(jobUrl),
      sourceType,
      title,
      location: "Unspecified",
      employmentType: null,
      url: jobUrl,
      descriptionSnippet: `Extracted from ${new URL(baseUrl).hostname}`,
      descriptionText: title,
      sourceCompleteness: "listing-only",
      extractionVersion: "anchor-v1",
      salaryMin: null, salaryMax: null, salaryCurrency: null, salaryText: null,
      postDate: null,
    });
    seenUrls.add(jobUrl);
  }
  return jobs;
}

export function extractJobsFromHtml(baseUrl: string, html: string, sourceType: CompanySourceType): ScrapedJob[] {
  const jsonLdJobs = extractJsonLdJobs(baseUrl, html, sourceType);
  const anchorJobs = extractAnchorJobs(baseUrl, html, sourceType);
  const merged = [...jsonLdJobs];
  const seenIds = new Set(jsonLdJobs.map((j) => j.sourceJobId));
  for (const job of anchorJobs) {
    if (!seenIds.has(job.sourceJobId)) { merged.push(job); seenIds.add(job.sourceJobId); }
  }
  return merged.slice(0, 200);
}
