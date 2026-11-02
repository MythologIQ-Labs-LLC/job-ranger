/**
 * Browser-safe, local-only document text extraction for the Sojourner web
 * runtime. This is the web counterpart of the Electron runtime's native
 * Anydoc parser. It never sends documents anywhere and never runs OCR.
 *
 * Dependencies are injected so the same logic is exercised by Node tests.
 * Only erasable TypeScript syntax is used.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DocumentFailureCode =
  | "ocr-required"
  | "encrypted"
  | "malformed"
  | "unsupported"
  | "resource-limit"
  | "parser-failure";

export class DocumentTextError extends Error {
  code: DocumentFailureCode;
  pages: number[];
  constructor(message: string, code: DocumentFailureCode, pages: number[] = []) {
    super(message);
    this.name = "DocumentTextError";
    this.code = code;
    this.pages = pages;
  }
}

export const MAX_DOCX_XML_BYTES = 32 * 1024 * 1024;
export const MAX_DOCX_ENTRIES = 2_000;
export const MAX_PDF_PAGES = 60;

export type DetectedDocumentFormat = "pdf" | "docx" | "cfb" | "unknown";

export function detectDocumentFormat(bytes: Uint8Array): DetectedDocumentFormat {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "docx";
  }
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return "cfb";
  }
  return "unknown";
}

function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const needle = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) needle[index * 2] = text.charCodeAt(index);
  outer: for (let offset = 0; offset + needle.length <= bytes.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** Compound File Binary containers are either encrypted OOXML or legacy Word. */
export function classifyCompoundFile(bytes: Uint8Array): DocumentTextError {
  if (containsUtf16(bytes, "EncryptionInfo") || containsUtf16(bytes, "EncryptedPackage")) {
    return new DocumentTextError(
      "This document is encrypted or password-protected. Save an unlocked copy and import that file instead.",
      "encrypted",
    );
  }
  return new DocumentTextError(
    "Legacy Word (.doc) files are not supported. Save the resume as DOCX or PDF and import that file instead.",
    "unsupported",
  );
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity] ?? match;
  });
}

/**
 * Converts WordprocessingML `word/document.xml` into Markdown-flavoured text:
 * heading styles become `#` headings, list paragraphs become `- ` items, tabs
 * and breaks are preserved. Formatting-only constructs are ignored.
 */
export function wordDocumentXmlToText(xml: string): string {
  const body = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const paragraphs = body.match(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const style = paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    const isList = /<w:numPr\b/.test(paragraph) || /^List/i.test(style);
    const headingLevel = style.match(/^(?:Heading|Title)(\d)?$/i);
    let text = "";
    const tokens = paragraph.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith("<w:tab")) text += "\t";
      else if (token.startsWith("<w:br") || token.startsWith("<w:cr")) text += "\n";
      else text += decodeXmlText(token.replace(/^<w:t\b[^>]*>/, "").replace(/<\/w:t>$/, ""));
    }
    const trimmed = text.replace(/[  ]+$/g, "");
    if (!trimmed.trim()) {
      lines.push("");
      continue;
    }
    if (headingLevel) {
      const level = Math.min(Math.max(Number(headingLevel[1] ?? 1), 1), 6);
      lines.push(`${"#".repeat(level)} ${trimmed.trim()}`);
    } else if (isList) {
      lines.push(`- ${trimmed.trim()}`);
    } else {
      lines.push(trimmed);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface UnzipEntryInfo {
  name: string;
  size: number;
  originalSize: number;
}

/** `fflate.unzipSync`-compatible signature. */
export type UnzipSync = (
  data: Uint8Array,
  options: { filter: (file: UnzipEntryInfo) => boolean },
) => Record<string, Uint8Array>;

export function extractDocxText(bytes: Uint8Array, unzipSync: UnzipSync): string {
  let entryCount = 0;
  let oversized = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        if (entryCount > MAX_DOCX_ENTRIES) {
          oversized = true;
          return false;
        }
        if (file.name !== "word/document.xml") return false;
        if (file.originalSize > MAX_DOCX_XML_BYTES) {
          oversized = true;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    throw new DocumentTextError(
      `This document is malformed or incomplete and could not be read safely.${error instanceof Error ? ` (${error.message})` : ""}`,
      "malformed",
    );
  }
  if (oversized) {
    throw new DocumentTextError("This document exceeded a safe local parsing limit.", "resource-limit");
  }
  const documentXml = files["word/document.xml"];
  if (!documentXml) {
    throw new DocumentTextError(
      "This document is malformed or incomplete: the Word document part (word/document.xml) is missing.",
      "malformed",
    );
  }
  if (documentXml.length > MAX_DOCX_XML_BYTES) {
    throw new DocumentTextError("This document exceeded a safe local parsing limit.", "resource-limit");
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(documentXml);
  } catch {
    throw new DocumentTextError("This document is malformed or incomplete and could not be read safely.", "malformed");
  }
  return wordDocumentXmlToText(xml);
}

/** Hardened pdf.js options: no eval, no font-face injection, no XFA, no scripting. */
export const PDFJS_SAFE_OPTIONS = {
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  enableXfa: false,
  disableAutoFetch: true,
  disableStream: true,
  stopAtErrors: false,
  isOffscreenCanvasSupported: false,
  verbosity: 0,
} as const;

export interface PdfTextResult {
  text: string;
  pageCount: number;
  emptyPages: number[];
}

export async function extractPdfText(bytes: Uint8Array, pdfjs: any): Promise<PdfTextResult> {
  let document: any;
  try {
    document = await pdfjs.getDocument({ ...PDFJS_SAFE_OPTIONS, data: new Uint8Array(bytes) }).promise;
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "PasswordException") {
      throw new DocumentTextError(
        "This document is encrypted or password-protected. Save an unlocked copy and import that file instead.",
        "encrypted",
      );
    }
    if (name === "InvalidPDFException" || name === "FormatError") {
      throw new DocumentTextError("This document is malformed or incomplete and could not be read safely.", "malformed");
    }
    throw new DocumentTextError(
      error instanceof Error ? error.message : "The document parser failed unexpectedly.",
      "parser-failure",
    );
  }
  try {
    const pageCount = document.numPages as number;
    if (pageCount > MAX_PDF_PAGES) {
      throw new DocumentTextError("This document exceeded a safe local parsing limit.", "resource-limit");
    }
    const pages: string[] = [];
    const emptyPages: number[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      page.cleanup?.();
      const normalized = text.replace(/[ \t]+\n/g, "\n").trim();
      if (!normalized) emptyPages.push(pageNumber);
      pages.push(normalized);
    }
    return { text: pages.filter(Boolean).join("\n\n"), pageCount, emptyPages };
  } finally {
    await document.destroy?.();
  }
}
