/**
 * Local-only Google OAuth helper proof server (#264).
 *
 * Never deploy this development HTTP server publicly. It serves a separate
 * origin from the PWA and reproduces auth-helper/_headers protections without
 * any backend account system or access to local Career Ops data.
 *
 * Required: JOB_RANGER_GOOGLE_WEB_CLIENT_ID (PUBLIC Web app OAuth client ID),
 *           JOB_RANGER_PWA_ORIGIN (exact http://localhost:4174 by default).
 * Optional: JOB_RANGER_AUTH_HELPER_PORT (default 4175).
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../auth-helper");
const PORT = Number(process.env.JOB_RANGER_AUTH_HELPER_PORT ?? "4175");
const PWA_ORIGIN = (process.env.JOB_RANGER_PWA_ORIGIN ?? "http://localhost:4174").trim();
const CLIENT_ID = (process.env.JOB_RANGER_GOOGLE_WEB_CLIENT_ID ?? "").trim();

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error("Helper port must be an integer between 1024 and 65535.");
}
if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(CLIENT_ID)) {
  throw new Error("A Google-issued PUBLIC Web OAuth client ID is required.");
}
const app = new URL(PWA_ORIGIN);
if (app.origin !== PWA_ORIGIN || app.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname) ||
    app.port === String(PORT)) {
  throw new Error("Use an exact, separate local HTTP origin for Job Ranger PWA.");
}

const lines = readFileSync(path.join(ROOT, "_headers"), "utf8").split("\n");
const headerValues = {};
for (const line of lines) {
  const match = /^  ([A-Za-z-]+): (.+)$/.exec(line);
  if (match) headerValues[match[1]] = match[2];
}
if (!headerValues["Content-Security-Policy"]?.includes("frame-ancestors 'none'") ||
    headerValues["Cross-Origin-Opener-Policy"] !== "unsafe-none" ||
    !headerValues["Content-Security-Policy"].includes("trusted-types job-ranger-auth-gis")) {
  throw new Error("The helper hosting security contract is invalid.");
}

const known = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/helper.mjs", ["helper.mjs", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

export function createIsolatedAuthHelperServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const common = {
      ...headerValues,
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (request.method !== "GET" || url.search || url.hash) {
      response.writeHead(400, common);
      response.end("Invalid helper request.");
      return;
    }
    if (url.pathname === "/config.mjs") {
      // Public identifiers only; not an OAuth client secret or bearer token.
      const config = [
        "export const GOOGLE_WEB_CLIENT_ID = " + JSON.stringify(CLIENT_ID) + ";",
        "export const JOB_RANGER_APP_ORIGIN = " + JSON.stringify(PWA_ORIGIN) + ";",
      ].join("\n");
      response.writeHead(200, { ...common, "Content-Type": "text/javascript; charset=utf-8" });
      response.end(config + "\n");
      return;
    }
    const entry = known.get(url.pathname);
    if (!entry) {
      response.writeHead(404, common);
      response.end("Not found.");
      return;
    }
    const [filename, mime] = entry;
    response.writeHead(200, { ...common, "Content-Type": mime });
    response.end(readFileSync(path.join(ROOT, filename)));
  });
}

// Importing this module for tests never starts a listener.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = createIsolatedAuthHelperServer();
  server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write("Job Ranger isolated OAuth helper listening on http://localhost:" + PORT +
      "/ (local browser research only)\n");
  });
}
