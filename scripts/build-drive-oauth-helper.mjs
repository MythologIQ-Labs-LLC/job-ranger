#!/usr/bin/env node
/**
 * Build a separately hosted, static Google OAuth helper.
 * Do NOT copy these files into dist-pwa/ or publish on the Career Ops origin.
 * Required public configuration (not secrets):
 * SOJOURNER_DRIVE_APP_ORIGIN, SOJOURNER_DRIVE_HELPER_ORIGIN,
 * SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_ID.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "tools", "drive-oauth-helper");
const output = path.join(root, "build", "drive-oauth-helper");
const app = (process.env.SOJOURNER_DRIVE_APP_ORIGIN ?? "").trim();
const helper = (process.env.SOJOURNER_DRIVE_HELPER_ORIGIN ?? "").trim();
const client = (process.env.SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_ID ?? "").trim();

function exactOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value &&
      url.pathname === "/" && url.search === "" && url.hash === "" &&
      url.username === "" && url.password === "";
  } catch { return false; }
}
if (!exactOrigin(app) || !exactOrigin(helper) || app === helper ||
    !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(client)) {
  throw new Error("The app and helper require DIFFERENT exact HTTPS origins and a valid public Google Web client ID.");
}
if (process.env.SOJOURNER_DRIVE_GOOGLE_WEB_CLIENT_SECRET) {
  throw new Error("Do not place Google client secrets in a browser-only OAuth helper.");
}
const csp = [
  "default-src 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "connect-src https://accounts.google.com/gsi/ https://oauth2.googleapis.com",
  "frame-src https://accounts.google.com/gsi/",
  "style-src 'self' https://accounts.google.com/gsi/style",
  "img-src 'self' data: https://accounts.google.com/gsi/",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "require-trusted-types-for 'script'",
].join("; ");
const headers = [
  "/*",
  "  Content-Security-Policy: " + csp,
  "  Cross-Origin-Opener-Policy: same-origin-allow-popups",
  "  Cross-Origin-Resource-Policy: same-origin",
  "  Referrer-Policy: no-referrer",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Cache-Control: no-store",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "",
].join("\n");
mkdirSync(output, { recursive: true });
for (const file of ["index.html", "helper.mjs"]) {
  // Source must be shipped unchanged. The output contains no PWA assets or data.
  copyFileSync(path.join(source, file), path.join(output, file));
}
writeFileSync(path.join(output, "config.mjs"),
  "export const APP_ORIGIN = " + JSON.stringify(app) + ";\n" +
  "export const GOOGLE_WEB_CLIENT_ID = " + JSON.stringify(client) + ";\n");
writeFileSync(path.join(output, "_headers"), headers);
// A localhost file/preview is not proof of hosted headers or real Google OAuth.
const outputFiles = ["index.html", "helper.mjs", "config.mjs", "_headers"];
if (outputFiles.some(file => !readFileSync(path.join(output, file)).length)) {
  throw new Error("Incomplete isolated OAuth helper build.");
}
process.stdout.write("Isolated OAuth helper built: " + outputFiles.join(", ") +
  ". Deploy ONLY to " + helper + " after CSP/COOP and OAuth origin qualification.\n");
