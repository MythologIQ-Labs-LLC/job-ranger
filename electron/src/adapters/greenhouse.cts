import type { ScraperAdapter, ScraperContext, ScrapedJob } from "../scrapers.cjs";
import { fetchJson, toSnippet, parseSalary, toSourceText } from "../scrapers.cjs";

interface GreenhouseResponse {
  jobs: Array<{
    id: number;
    title: string;
    location?: { name?: string };
    absolute_url: string;
    content?: string;
    updated_at?: string;
  }>;
}

/**
 * The Greenhouse Job Board API returns `content` as entity-escaped HTML
 * (`&lt;p&gt;...`). Unescape it once so tag stripping and requirement
 * extraction see real structure instead of one undifferentiated blob.
 */
export function unescapeGreenhouseContent(content: string | undefined): string | undefined {
  if (!content || !/&lt;|&gt;/.test(content)) return content;
  return content
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export const greenhouseAdapter: ScraperAdapter = {
  sourceType: "greenhouse",
  async scrape(sourceIdentifier: string, context: ScraperContext): Promise<ScrapedJob[]> {
    const response = await fetchJson<GreenhouseResponse>(
      `https://boards-api.greenhouse.io/v1/boards/${sourceIdentifier}/jobs?content=true`,
      context,
    );

    return response.jobs.map((job) => {
      const content = unescapeGreenhouseContent(job.content);
      const descriptionText = toSourceText(content);
      const salary = parseSalary(content);
      return {
        sourceJobId: String(job.id),
        sourceType: "greenhouse",
        title: job.title.trim(),
        location: job.location?.name?.trim() || "Unspecified",
        employmentType: null,
        url: job.absolute_url,
        descriptionSnippet: toSnippet(content),
        descriptionText,
        sourceCompleteness: descriptionText ? "full" : "listing-only",
        extractionVersion: "greenhouse-api-v2",
        salaryMin: salary?.min ?? null,
        salaryMax: salary?.max ?? null,
        salaryCurrency: salary?.currency ?? null,
        salaryText: salary?.text ?? null,
        postDate: job.updated_at ?? null,
      };
    });
  },
};
