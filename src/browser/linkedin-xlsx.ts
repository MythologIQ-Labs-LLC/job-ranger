/**
 * Browser-local XLSX reader for LinkedIn's six-sheet export. Parses only a
 * strict subset of Office Open XML with bounded strings and ZIP contents.
 * Deliberately does not call DOMParser, an HTML sink blocked by the PWA's
 * Trusted Types policy. No scripts, formulas, entities, DTDs or network I/O.
 */
import { unzipSync } from "fflate";
import type { WorkbookRows } from "../shared/linkedin-analytics";

const MAX_FILE = 4 * 1024 * 1024;
const MAX_XML = 8 * 1024 * 1024;
const MAX_TOTAL = 18 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

function decodedXml(bytes: Uint8Array, name: string): string {
  const source = decoder.decode(bytes);
  if (/<!/i.test(source)) throw new Error("Unsupported XML markup in " + name + ".");
  return source;
}
function unescapeXml(raw: string): string {
  // Decode XML's five predefined entities and explicit numeric characters.
  // Unknown entities are rejected, never expanded recursively.
  const entities = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;
  const remainder = raw.replace(entities, "");
  if (remainder.includes("&") || remainder.includes("<")) {
    throw new Error("Unsupported XML entity or text markup in LinkedIn export.");
  }
  return raw.replace(entities, (_match, code: string) => {
    const named: Record<string, string> = {
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    };
    if (Object.hasOwn(named, code)) return named[code];
    const point = Number.parseInt(code.startsWith("#x") ? code.slice(2) : code.slice(1), code.startsWith("#x") ? 16 : 10);
    if (!Number.isInteger(point) || point === 0 || point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)) throw new Error("Invalid XML numeric character.");
    return String.fromCodePoint(point);
  });
}
function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let left = source;
  while (left.trim()) {
    const match = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(left);
    if (!match || Object.hasOwn(result, match[1])) throw new Error("Invalid XLSX XML attributes.");
    result[match[1]] = unescapeXml(match[3]);
    left = left.slice(match[0].length);
  }
  return result;
}
type ElementParts = { attrs: Record<string, string>; body: string };
function elements(source: string, tag: string): ElementParts[] {
  const name = "(?:[A-Za-z_][\\w.-]*:)?" + tag;
  const expression = new RegExp("<" + name + "\\b([^>]*)>([\\s\\S]*?)<\\/" + name + "\\s*>", "g");
  return [...source.matchAll(expression)].map(match => ({ attrs: attributes(match[1]), body: match[2] }));
}
function emptyElements(source: string, tag: string): Record<string, string>[] {
  const name = "(?:[A-Za-z_][\\w.-]*:)?" + tag;
  const expression = new RegExp("<" + name + "\\b([^>]*)\\/>", "g");
  return [...source.matchAll(expression)].map(match => attributes(match[1]));
}
function textValue(body: string, tag: string): string {
  const matches = elements(body, tag);
  return matches.map(el => unescapeXml(el.body)).join("");
}
function requiredFile(entries: Record<string, Uint8Array>, path: string): Uint8Array {
  const entry = entries[path];
  if (!entry) throw new Error("LinkedIn XLSX is missing " + path + ".");
  return entry;
}
function column(ref: string): number {
  const match = /^([A-Z]{1,2})[1-9]\d*$/.exec(ref);
  if (!match) throw new Error("Unsupported XLSX cell reference.");
  const index = match[1].split("").reduce((value, ch) => value * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  if (index >= 64) throw new Error("XLSX exceeds column limit.");
  return index;
}
function readStrings(entries: Record<string, Uint8Array>): string[] {
  if (!entries["xl/sharedStrings.xml"]) return [];
  const source = decodedXml(entries["xl/sharedStrings.xml"], "sharedStrings.xml");
  const items = elements(source, "si");
  if (items.length > 100_000) throw new Error("Too many XLSX shared strings.");
  return items.map(si => textValue(si.body, "t"));
}
function readSheet(bytes: Uint8Array, shared: string[], name: string): unknown[][] {
  const source = decodedXml(bytes, name);
  const data = elements(source, "sheetData");
  if (data.length !== 1) throw new Error("Invalid XLSX sheetData element.");
  const rows = elements(data[0].body, "row");
  if (rows.length > 1000) throw new Error("LinkedIn XLSX exceeds row limit.");
  const result: unknown[][] = [];
  let nextRow = 0;
  for (const row of rows) {
    const rawIndex = row.attrs.r;
    const index = rawIndex ? Number(rawIndex) - 1 : nextRow;
    if (!Number.isSafeInteger(index) || index < nextRow || index >= 1000) {
      throw new Error("Invalid or duplicate XLSX row number.");
    }
    const values: unknown[] = [];
    for (const entry of elements(row.body, "c")) {
      if (elements(entry.body, "f").length || emptyElements(entry.body, "f").length) {
        throw new Error("Formula cells are not supported in LinkedIn analytics imports.");
      }
      if (!entry.attrs.r) throw new Error("XLSX cell address is missing.");
      const col = column(entry.attrs.r);
      if (values[col] !== undefined) throw new Error("Duplicate XLSX cell address.");
      const type = entry.attrs.t ?? "n";
      const raw = textValue(entry.body, "v");
      let value: unknown = null;
      if (type === "s") {
        if (!/^\d+$/.test(raw) || Number(raw) >= shared.length) throw new Error("Invalid XLSX shared string index.");
        value = shared[Number(raw)];
      } else if (type === "inlineStr") {
        value = textValue(entry.body, "t");
      } else if (type === "n") {
        if (raw) {
          const number = Number(raw);
          if (!Number.isFinite(number)) throw new Error("Invalid numeric XLSX cell.");
          value = number;
        }
      } else if (type === "str") {
        value = raw;
      } else if (type === "b") {
        value = raw === "1";
      } else if (type === "e") {
        throw new Error("Excel error cells are not accepted.");
      } else {
        throw new Error("Unsupported XLSX cell encoding: " + type + ".");
      }
      values[col] = value;
    }
    result[index] = values;
    nextRow = index + 1;
  }
  return Array.from({ length: result.length }, (_, i) => result[i] ?? []);
}
function targetPath(target: string): string {
  const path = target.startsWith("/") ? target.slice(1) :
    target.startsWith("xl/") ? target : "xl/" + target;
  if (!/^xl\/worksheets\/[a-zA-Z0-9_.-]+\.xml$/.test(path) || path.includes("..")) {
    throw new Error("External or unsupported XLSX worksheet relationship.");
  }
  return path;
}

/** The original workbook stays local and never becomes a code or HTML sink. */
export function readLinkedInXlsx(buffer: ArrayBuffer): WorkbookRows {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 100 || buffer.byteLength > MAX_FILE) {
    throw new Error("Select a valid LinkedIn .xlsx export under 4 MB.");
  }
  let count = 0, expanded = 0;
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: file => {
      count++;
      if (count > 150) throw new Error("XLSX contains too many ZIP entries.");
      const size = file.originalSize;
      if (!Number.isSafeInteger(size) || size > MAX_XML || size < 0) throw new Error("XLSX XML entry exceeds size limits.");
      const allow = /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[a-zA-Z0-9_.-]+\.xml)$/.test(file.name);
      if (allow) {
        expanded += size;
        if (expanded > MAX_TOTAL) throw new Error("XLSX content exceeds extraction limit.");
      }
      return allow;
    },
  });
  const workbook = decodedXml(requiredFile(entries, "xl/workbook.xml"), "workbook.xml");
  const relationships = decodedXml(requiredFile(entries, "xl/_rels/workbook.xml.rels"), "workbook.xml.rels");
  const targets = new Map(emptyElements(relationships, "Relationship")
    .filter(rel => rel.TargetMode !== "External")
    .map(rel => [rel.Id, rel.Target]));
  const names = emptyElements(workbook, "sheet");
  if (!names.length || names.length > 20) throw new Error("LinkedIn XLSX contains an unexpected sheet count.");
  const shared = readStrings(entries);
  const result: WorkbookRows = {};
  for (const item of names) {
    const name = item.name, id = item["r:id"];
    if (!name || !id || name.length > 80 || Object.hasOwn(result, name)) {
      throw new Error("Invalid XLSX worksheet identity.");
    }
    const target = targets.get(id);
    if (!target) throw new Error("XLSX worksheet relationship is missing.");
    result[name] = readSheet(requiredFile(entries, targetPath(target)), shared, name);
  }
  return result;
}
