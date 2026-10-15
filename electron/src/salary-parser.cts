export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string;
  period: "year" | "month" | "hour";
  /** The matched amount or range only. */
  raw: string;
  /**
   * The amount with a pay period written right next to it ("$24 per hour", "Hourly rate: $24"),
   * for storing as the listing's salary text; otherwise the same as `raw`. The assessment reads the
   * pay basis from this text, so dropping the period made hourly listings unknown (#216).
   */
  text: string;
}

// Abbreviations (hr, yr, mo) count only after "/", "per", "a(n)" or "each", so "$5,000 HR referral"
// is not hourly; "a year ago" is not a pay period.
const PERIOD_AFTER =
  /^[ \t]*(?:(?:USD|CAD|EUR|GBP|AUD)[ \t]*)?(?:(?:\/|per\b|an?\b|each\b)[ \t]*(?:hour|hr|year|yr|annum|month|mo)|hourly|yearly|annually|monthly|p\.a\.?)(?![a-z])(?![ \t]+ago\b)\.?/i;
const PERIOD_BEFORE =
  /\b(?:hourly|annual(?:ly)?|yearly|monthly)(?:[ \t]+(?:base[ \t]+)?(?:rate|pay|salary|wage|compensation))?[ \t]*(?:of|is|:)?[ \t]*$/i;
// A period belongs to the amount only within the same line, paragraph or list item.
const BLOCK_BOUNDARY = /<\/?(?:p|li|ul|ol|div|br|h[1-6]|tr|td|th|table|section|article)\b[^>]*>|[\r\n]/gi;

function inlineText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ");
}

function untilBlockBoundary(text: string): string {
  BLOCK_BOUNDARY.lastIndex = 0;
  const boundary = BLOCK_BOUNDARY.exec(text);
  return boundary ? text.slice(0, boundary.index) : text;
}

function sinceBlockBoundary(text: string): string {
  let start = 0;
  BLOCK_BOUNDARY.lastIndex = 0;
  for (let boundary = BLOCK_BOUNDARY.exec(text); boundary; boundary = BLOCK_BOUNDARY.exec(text)) {
    start = boundary.index + boundary[0].length;
  }
  return text.slice(start);
}

/** Extends the matched amount to a pay period written directly before or after it, ignoring inline markup. */
function withAdjacentPeriod(source: string, start: number, end: number): string {
  const followingRaw = untilBlockBoundary(source.slice(end, end + 80));
  const precedingRaw = sinceBlockBoundary(source.slice(Math.max(0, start - 80), start));
  const following = inlineText(followingRaw);
  const preceding = inlineText(precedingRaw);
  const after = following.match(PERIOD_AFTER);
  const before = preceding.match(PERIOD_BEFORE);
  // Without markup in between, keep the listing's own wording and spacing ("$24/hr").
  const prefix = before ? (preceding === precedingRaw ? before[0] : `${before[0].trim()} `) : "";
  const suffix = after ? (following === followingRaw ? after[0] : ` ${after[0].trim()}`) : "";
  return `${prefix}${source.slice(start, end)}${suffix}`.trim();
}

const CURRENCY_PATTERNS: Record<string, RegExp> = {
  USD: /\$|USD|U\.S\.|US\s*dollars?/i,
  EUR: /\u20AC|EUR|euros?/i,
  GBP: /\u00A3|GBP|pounds?/i,
  CAD: /CA\$|CAD|canadian\s*dollars?/i,
  AUD: /AU\$|AUD|australian\s*dollars?/i,
};

const PERIOD_PATTERNS: Record<string, RegExp> = {
  year: /\b(year|yr|annual|p\.?a\.?|per\s*annum)\b/i,
  month: /\b(month|mo|monthly)\b/i,
  hour: /\b(hour|hr|hourly)\b/i,
};

function detectCurrency(text: string): string {
  for (const [code, pattern] of Object.entries(CURRENCY_PATTERNS)) {
    if (pattern.test(text)) return code;
  }
  return "USD";
}

function detectPeriod(text: string): "year" | "month" | "hour" {
  for (const [period, pattern] of Object.entries(PERIOD_PATTERNS)) {
    if (pattern.test(text)) return period as "year" | "month" | "hour";
  }
  return "year";
}

function parseNumericValue(text: string): number | null {
  const cleaned = text.replace(/[$\u20AC\u00A3,\s]/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*[kK]?/);
  if (!match) return null;
  let value = parseFloat(match[1]);
  if (/[kK]/.test(cleaned)) value *= 1000;
  return isFinite(value) ? value : null;
}

export function parseSalary(text: string | null | undefined): ParsedSalary | null {
  if (!text) return null;

  const rangeMatch = text.match(
    /[$\u20AC\u00A3]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?[kK]?)\s*[-\u2013\u2014to]+\s*[$\u20AC\u00A3]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?[kK]?)/
  );

  if (rangeMatch) {
    return {
      min: parseNumericValue(rangeMatch[1]),
      max: parseNumericValue(rangeMatch[2]),
      currency: detectCurrency(text),
      period: detectPeriod(text),
      raw: rangeMatch[0],
      text: withAdjacentPeriod(text, rangeMatch.index ?? 0, (rangeMatch.index ?? 0) + rangeMatch[0].length),
    };
  }

  const singleMatch = text.match(
    /[$\u20AC\u00A3]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?[kK]?)/
  );

  if (singleMatch) {
    const value = parseNumericValue(singleMatch[1]);
    return {
      min: value,
      max: value,
      currency: detectCurrency(text),
      period: detectPeriod(text),
      raw: singleMatch[0],
      text: withAdjacentPeriod(text, singleMatch.index ?? 0, (singleMatch.index ?? 0) + singleMatch[0].length),
    };
  }

  return null;
}
