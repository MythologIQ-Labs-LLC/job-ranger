/**
 * Strict, bounded parser for the first-party We Work Remotely RSS 2.0 feed.
 * Supports ordinary XML text, CDATA, basic entities and simple attributes.
 * Rejects DTDs, external entities, malformed nesting and oversized feeds.
 * It is deliberately NOT a general-purpose XML or HTML parser.
 */
const MAX_XML_CHARS = 1_048_576;
const MAX_ITEMS = 200;
const ITEM_FIELDS = new Set(["title", "link", "guid", "pubDate", "region", "country", "type", "description"]);

export interface WwrNormalizedJob {
  title: string;
  employerName: string;
  url: string;
  region: string | null;
  country: string | null;
  employmentType: string | null;
  publishedAt: string | null;
  summary: string;
}

function decodeEntities(text: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);)/i.test(text)) {
    throw new Error("Unsupported XML entity");
  }
  return text.replace(/&((?:amp|lt|gt|quot|apos)|(?:#x[0-9a-f]+)|(?:#[0-9]+));/gi, (_whole, key: string) => {
    switch (key) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const value = key.startsWith("#x") || key.startsWith("#X")
          ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
        if (!Number.isFinite(value) || value < 0x20 || value > 0x10ffff ||
            (value >= 0xd800 && value <= 0xdfff)) {
          throw new Error("Invalid XML numeric entity");
        }
        return String.fromCodePoint(value);
      }
    }
  });
}

function safeText(raw: string | undefined, max = 300): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/\s+/g, " ");
  return value && value.length <= max ? value : null;
}

function wwrUrl(raw: string | undefined): string | null {
  const source = safeText(raw, 2048);
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !["weworkremotely.com", "www.weworkremotely.com"].includes(url.hostname) ||
        !/^\/remote-jobs\/[^/]+\/?$/.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedItem(fields: Partial<Record<string, string>>): WwrNormalizedJob | null {
  const combined = safeText(fields.title);
  const url = wwrUrl(fields.link);
  if (!combined || !url) return null;
  const separator = combined.indexOf(": ");
  if (separator < 1) return null;
  const employerName = safeText(combined.slice(0, separator));
  const title = safeText(combined.slice(separator + 2));
  if (!employerName || !title) return null;
  const date = safeText(fields.pubDate);
  const parsed = date ? Date.parse(date) : NaN;
  return {
    title,
    employerName,
    url,
    region: safeText(fields.region) ?? null,
    country: safeText(fields.country) ?? null,
    employmentType: safeText(fields.type) ?? null,
    publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    summary: (fields.description ?? "").slice(0, 6000),
  };
}

export function parseWwrFeed(xml: string): WwrNormalizedJob[] {
  if (typeof xml !== "string" || xml.length > MAX_XML_CHARS) {
    throw new Error("WWR feed too large");
  }
  const stack: string[] = [];
  const jobs: WwrNormalizedJob[] = [];
  const seen = new Set<string>();
  let itemCount = 0;
  let fields: Partial<Record<string, string>> | null = null;
  let capture: string | null = null;
  let captured = "";
  let hadChannel = false;

  // Only data in a direct item field can be projected into the candidate.
  function text(value: string, cdata: boolean): void {
    if (capture) captured += cdata ? value : decodeEntities(value);
    else if (value.trim() && stack.length === 0) throw new Error("Unexpected XML text");
    else if (!cdata && value.includes("&")) decodeEntities(value);
  }

  let position = 0;
  while (position < xml.length) {
    const open = xml.indexOf("<", position);
    if (open === -1) {
      text(xml.slice(position), false);
      position = xml.length;
      break;
    }
    text(xml.slice(position, open), false);
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0) throw new Error("Unclosed XML CDATA");
      text(xml.slice(open + 9, end), true);
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) throw new Error("Unclosed XML comment");
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<?xml ", open) && !stack.length && !hadChannel) {
      const end = xml.indexOf("?>", open + 6);
      if (end < 0) throw new Error("Invalid XML declaration");
      position = end + 2;
      continue;
    }
    if (xml.startsWith("<!", open) || xml.startsWith("<?", open)) {
      throw new Error("Forbidden XML declaration or entity");
    }
    const end = xml.indexOf(">", open + 1);
    if (end < 0) throw new Error("Unclosed XML tag");
    const tag = xml.slice(open + 1, end);
    const match = /^(\/?)([A-Za-z_][\w:.-]*)(?:\s+[^<>]*?)?(\/?)$/.exec(tag);
    if (!match) throw new Error("Invalid XML tag");
    const [, closing, name, selfClose] = match;
    if (closing && selfClose) throw new Error("Invalid closing XML tag");

    if (closing) {
      if (stack.pop() !== name) throw new Error("Malformed XML nesting");
      if (capture === name && stack.length === 3 && stack[2] === "item") {
        if (fields && fields[name] === undefined) fields[name] = captured;
        capture = null;
        captured = "";
      } else if (name === "item" && stack.length === 2) {
        if (fields) {
          const job = normalizedItem(fields);
          if (job && !seen.has(job.url)) {
            seen.add(job.url);
            jobs.push(job);
          }
        }
        fields = null;
      }
    } else {
      if (capture) throw new Error("Unsupported nested XML item field");
      const parent = stack[stack.length - 1];
      if (stack.length === 0 && name !== "rss") throw new Error("WWR feed is not RSS");
      if (stack.length === 1 && name === "channel") hadChannel = true;
      if (stack.length === 2 && parent === "channel" && name === "item") {
        if (++itemCount > MAX_ITEMS) throw new Error("WWR feed has too many items");
        fields = {};
      }
      stack.push(name);
      if (stack.length === 4 && stack[2] === "item" && ITEM_FIELDS.has(name)) {
        capture = name;
        captured = "";
      }
      if (selfClose) {
        if (capture === name) {
          if (fields && fields[name] === undefined) fields[name] = "";
          capture = null;
        }
        if (name === "item") fields = null;
        stack.pop();
      }
    }
    position = end + 1;
  }

  if (stack.length || !hadChannel || xml.indexOf("<rss") < 0 || capture) {
    throw new Error("Invalid or unclosed RSS document");
  }
  return jobs;
}
