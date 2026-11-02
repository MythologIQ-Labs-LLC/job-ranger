import { promises as fs } from "node:fs";
import {
  formatFromBytes,
  toMarkdown,
  type ConvertErrorCode,
} from "@firecrawl/anydoc";
import { replaceNul, unreadableCharactersWarning } from "./nul-text.cjs";

export const RESUME_PARSER_ID = "@firecrawl/anydoc";
export const RESUME_PARSER_VERSION = "0.2.4";

export type ResumeParserFailureCode =
  | "ocr-required"
  | "encrypted"
  | "malformed"
  | "unsupported"
  | "resource-limit"
  | "parser-failure";

export interface ResumeParserResult {
  parserId: typeof RESUME_PARSER_ID;
  parserVersion: typeof RESUME_PARSER_VERSION;
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

type AnydocError = Error & {
  code?: ConvertErrorCode | string;
  pages?: unknown;
};

function normalizePages(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (page): page is number => Number.isInteger(page) && page > 0,
  );
}

export function normalizeResumeParserError(error: unknown): ResumeParserError {
  const source: AnydocError =
    error instanceof Error
      ? (error as AnydocError)
      : Object.assign(new Error(String(error)), { code: undefined, pages: undefined });
  const code = source.code;
  const pages = normalizePages(source.pages);

  switch (code) {
    case "needsOcr":
      return new ResumeParserError(
        pages.length > 0
          ? `This PDF needs OCR on page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}. OCR is not sent to a hosted service automatically.`
          : "This PDF contains image-only content that needs OCR. OCR is not sent to a hosted service automatically.",
        "ocr-required",
        pages,
        { cause: source },
      );
    case "encrypted":
      return new ResumeParserError(
        "This document is encrypted or password-protected. Save an unlocked copy and import that file instead.",
        "encrypted",
        pages,
        { cause: source },
      );
    case "malformed":
    case "missingPart":
      return new ResumeParserError(
        "This document is malformed or incomplete and could not be read safely.",
        "malformed",
        pages,
        { cause: source },
      );
    case "unsupported":
      return new ResumeParserError(
        "This document format is not supported for resume import.",
        "unsupported",
        pages,
        { cause: source },
      );
    case "resourceLimit":
      return new ResumeParserError(
        "This document exceeded a safe local parsing limit.",
        "resource-limit",
        pages,
        { cause: source },
      );
    case "io":
    case "hosted":
    default:
      return new ResumeParserError(
        source.message || "The document parser failed unexpectedly.",
        "parser-failure",
        pages,
        { cause: source },
      );
  }
}

export async function extractResumeDocument(
  filePath: string,
): Promise<ResumeParserResult> {
  const bytes = await fs.readFile(filePath);
  const format = formatFromBytes(bytes);
  if (format !== "docx" && format !== "pdf") {
    throw new ResumeParserError(
      "R1 resume import supports DOCX, text-bearing PDF, plain text, and pasted text.",
      "unsupported",
    );
  }

  try {
    // Anydoc 0.2.4's local Node API is deterministic and does not invoke hosted OCR.
    // Image-only PDFs surface as needsOcr and remain an explicit user-facing state.
    // Unmapped glyphs can surface as NUL, which the desktop database cannot read back (#297).
    const extracted = replaceNul(await toMarkdown(filePath));
    const rawText = extracted.text;
    if (!rawText.trim()) {
      throw new ResumeParserError(
        "No meaningful text could be extracted from this document.",
        "malformed",
      );
    }

    return {
      parserId: RESUME_PARSER_ID,
      parserVersion: RESUME_PARSER_VERSION,
      detectedFormat: format,
      rawText,
      warnings: extracted.replaced > 0 ? [unreadableCharactersWarning(extracted.replaced)] : [],
    };
  } catch (error) {
    if (error instanceof ResumeParserError) throw error;
    throw normalizeResumeParserError(error);
  }
}
