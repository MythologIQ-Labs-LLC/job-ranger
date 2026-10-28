/**
 * Web runtime adapter replacing the Electron native (Anydoc) resume parser.
 * Same exported contract as electron/src/resume-parser.cts.
 *
 * - DOCX: bounded local unzip (fflate) + WordprocessingML text extraction.
 * - PDF: Mozilla pdf.js text layer with eval/font-face/XFA disabled.
 * - Image-only pages surface as the explicit `ocr-required` state; OCR is never
 *   sent to a hosted service.
 */
import { unzipSync } from "fflate";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { promises as fs } from "./node-fs";
import {
  classifyCompoundFile,
  detectDocumentFormat,
  DocumentTextError,
  extractDocxText,
  extractPdfText,
  type DocumentFailureCode,
} from "../runtime/document-text";

// pdf.js runs in-thread inside the Job Ranger runtime worker (already off the
// UI thread): exposing its message handler makes pdf.js skip creating a
// nested worker, which keeps the CSP/Trusted Types surface minimal.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

export const RESUME_PARSER_ID = "job-ranger-web-document-parser";
export const RESUME_PARSER_VERSION = `1.0.0+pdfjs-${pdfjs.version}`;

export type ResumeParserFailureCode = DocumentFailureCode;

export interface ResumeParserResult {
  parserId: typeof RESUME_PARSER_ID;
  parserVersion: string;
  detectedFormat: "docx" | "pdf";
  rawText: string;
  warnings: string[];
}

export class ResumeParserError extends Error {
  constructor(
    message: string,
    readonly code: ResumeParserFailureCode,
    readonly pages: number[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResumeParserError";
  }
}

export function normalizeResumeParserError(error: unknown): ResumeParserError {
  if (error instanceof ResumeParserError) return error;
  if (error instanceof DocumentTextError) {
    return new ResumeParserError(error.message, error.code, error.pages, { cause: error });
  }
  return new ResumeParserError(
    error instanceof Error && error.message ? error.message : "The document parser failed unexpectedly.",
    "parser-failure",
    [],
    { cause: error },
  );
}

export async function extractResumeDocument(filePath: string): Promise<ResumeParserResult> {
  const bytes = (await fs.readFile(filePath)) as Uint8Array;
  const format = detectDocumentFormat(bytes);
  try {
    if (format === "cfb") throw classifyCompoundFile(bytes);
    if (format !== "docx" && format !== "pdf") {
      throw new ResumeParserError(
        "R1 resume import supports DOCX, text-bearing PDF, plain text, and pasted text.",
        "unsupported",
      );
    }
    let rawText: string;
    const warnings: string[] = [];
    if (format === "docx") {
      rawText = extractDocxText(bytes, unzipSync);
    } else {
      const pdf = await extractPdfText(bytes, pdfjs);
      if (pdf.emptyPages.length === pdf.pageCount) {
        throw new ResumeParserError(
          pdf.pageCount === 1
            ? "This PDF contains image-only content that needs OCR. OCR is not sent to a hosted service automatically."
            : `This PDF needs OCR on pages ${pdf.emptyPages.join(", ")}. OCR is not sent to a hosted service automatically.`,
          "ocr-required",
          pdf.emptyPages,
        );
      }
      if (pdf.emptyPages.length > 0) {
        warnings.push(
          `Page${pdf.emptyPages.length === 1 ? "" : "s"} ${pdf.emptyPages.join(", ")} had no extractable text and may need OCR; review imported evidence for missing content.`,
        );
      }
      rawText = pdf.text;
    }
    // Unmapped glyphs can surface as NUL, which the desktop database cannot read back (#297);
    // show them as U+FFFD, as the desktop parser does.
    let unreadable = 0;
    rawText = rawText.replace(/\u0000/g, () => {
      unreadable += 1;
      return "\uFFFD";
    });
    if (unreadable > 0) {
      warnings.push(
        `${unreadable} character${unreadable === 1 ? "" : "s"} in this document could not be read and ${unreadable === 1 ? "is" : "are"} shown as \uFFFD; review imported evidence for missing content.`,
      );
    }
    if (!rawText.trim()) {
      throw new ResumeParserError("No meaningful text could be extracted from this document.", "malformed");
    }
    return {
      parserId: RESUME_PARSER_ID,
      parserVersion: RESUME_PARSER_VERSION,
      detectedFormat: format,
      rawText,
      warnings,
    };
  } catch (error) {
    throw normalizeResumeParserError(error);
  }
}
