import { DriveError, classifyGoogleResponse } from "./drive-errors.cjs";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleTransportOptions {
  fetch: FetchLike;
  allowedOrigins: readonly string[];
  defaultTimeoutMs?: number;
}

export interface GoogleRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

export interface GoogleResponse<T> {
  status: number;
  body: T;
}

/**
 * The single egress point for every Google request made by Job Ranger.
 * It refuses any origin outside the exact allowlist (checked before each
 * request), never follows redirects, and enforces a timeout.
 */
export class GoogleTransport {
  private readonly allowed: ReadonlySet<string>;
  private readonly defaultTimeoutMs: number;

  constructor(private readonly options: GoogleTransportOptions) {
    this.allowed = new Set(options.allowedOrigins);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  assertAllowed(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DriveError("invalid_request", "Job Ranger refused a malformed Google address.");
    }
    if (!this.allowed.has(parsed.origin) || parsed.username || parsed.password) {
      throw new DriveError("invalid_request", `Job Ranger refused to contact ${parsed.origin}; only Google sign-in and Drive are allowed.`);
    }
    return parsed;
  }

  /** Sends one request and parses a JSON (or empty) body. Non-2xx responses throw a classified DriveError. */
  async request<T>(url: string, options: GoogleRequestOptions = {}): Promise<GoogleResponse<T>> {
    this.assertAllowed(url);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.options.fetch(url, {
          method: options.method ?? "GET",
          headers: options.headers,
          body: options.body as RequestInit["body"],
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        throw timedOut
          ? new DriveError("timeout", "Google did not answer in time. Retry when your connection is stable.")
          : new DriveError("network", "Job Ranger could not reach Google. Check your connection, then retry.");
      }
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw timedOut
          ? new DriveError("timeout", "Google did not finish answering in time. Retry when your connection is stable.")
          : new DriveError("network", "The connection to Google was interrupted. Retry when your connection is stable.");
      }
      let body: unknown = null;
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          if (response.ok) throw new DriveError("invalid_response", "Google returned an unreadable response.", response.status);
        }
      }
      if (response.status < 200 || response.status >= 300) {
        throw classifyGoogleResponse(response.status, body as Parameters<typeof classifyGoogleResponse>[1]);
      }
      return { status: response.status, body: body as T };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

export const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" } as const;
