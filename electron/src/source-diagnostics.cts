import type { SourceDiagnosticCode } from "../../src/shared/contracts.js";

export interface SourceFailureDiagnostic {
  code: SourceDiagnosticCode;
  message: string;
}

export function classifySourceFailure(error: unknown): SourceFailureDiagnostic {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const value = raw.toLowerCase();

  if (error instanceof Error && error.name === "AbortError" || /timeout|timed out|aborted/.test(value)) {
    return { code: "timeout", message: "The source did not respond before the configured timeout." };
  }
  if (/cross-origin/.test(value)) {
    return { code: "browser-unavailable", message: "The web app cannot read this source because the site does not allow cross-origin access from browsers. The Windows app can monitor it." };
  }
  if (/http\s+(401|403)\b/.test(value)) {
    return { code: "access-blocked", message: "The source refused automated access. Sojourner did not bypass the site's access controls." };
  }
  if (/http\s+429\b|rate.?limit/.test(value)) {
    return { code: "rate-limited", message: "The source is rate-limiting requests. Try again later or reduce check frequency." };
  }
  if (/private|loopback|link-local|reserved|public network|network policy|unsafe destination/.test(value)) {
    return { code: "network-policy-blocked", message: "Sojourner blocked this request because the destination failed the acquisition network policy." };
  }
  if (/no job listings extracted|dedicated adapter may be required/.test(value)) {
    return { code: "extraction-failed", message: "The source loaded, but Sojourner could not reliably extract job listings from its current page shape." };
  }
  if (/json|parse|parser|unexpected token/.test(value)) {
    return { code: "parser-failed", message: "The source returned data Sojourner could not parse reliably." };
  }
  if (/http\s+\d+|fetch|network|enotfound|econn|socket/.test(value)) {
    return { code: "retrieval-failed", message: "Sojourner could not retrieve this source reliably." };
  }
  return { code: "unknown-failure", message: "The source check failed for an unclassified reason. The technical detail is preserved in local run history." };
}
