/**
 * Standalone, opt-in two-origin browser acceptance test for #264.
 * Run locally: node tests/research/isolated-google-auth.browser.mjs
 * Not included in npm test / GitHub Actions. No real Google credentials.
 */
import { chromium } from "playwright";
import ts from "typescript";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const helperRoot = path.join(ROOT, "auth-helper");
let helperContentSecurityPolicy = "";
function js(source) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  }}).outputText.replaceAll('"./isolated-auth-channel.ts"', '"./isolated-auth-channel.mjs"');
}
async function listen(handler) {
  const server = createServer(async (req, res) => {
    try { await handler(new URL(req.url ?? "/", "http://localhost"), res); }
    catch { res.writeHead(404); res.end("Not found"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  return { origin: "http://127.0.0.1:" + address.port,
    close: () => new Promise(resolve => server.close(resolve)) };
}
function respond(res, text, contentType = "text/javascript; charset=utf-8", coop = "unsafe-none") {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": coop,
    "X-Frame-Options": "DENY",
    ...(coop === "unsafe-none" ? { "Content-Security-Policy": helperContentSecurityPolicy } : {}),
  });
  res.end(text);
}
async function run() {
  const headerFile = await readFile(path.join(helperRoot, "_headers"), "utf8");
  const policyLine = headerFile.split("\n").find(line => line.trimStart().startsWith("Content-Security-Policy:"));
  if (!policyLine) throw new Error("Missing helper CSP hosting contract");
  helperContentSecurityPolicy = policyLine.trim().slice("Content-Security-Policy:".length).trim();
  if (!helperContentSecurityPolicy.includes("frame-ancestors 'none'") ||
      helperContentSecurityPolicy.includes("'unsafe-inline'")) {
    throw new Error("Helper CSP must reject embedding and inline scripts");
  }
  let parentOrigin = "";
  const helper = await listen(async (url, res) => {
    if (url.pathname === "/config.mjs") {
      return respond(res, 'export const GOOGLE_WEB_CLIENT_ID="123-example.apps.googleusercontent.com"; export const JOB_RANGER_APP_ORIGIN=' + JSON.stringify(parentOrigin) + ';');
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!["index.html", "style.css", "helper.mjs"].includes(file)) throw Error("Unknown helper asset");
    const content = await readFile(path.join(helperRoot, file));
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" :
      file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    respond(res, content, type);
  });
  const pageHost = await listen(async (url, res) => {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return respond(res, '<!doctype html><html><body><button id="connect">Connect Google Drive</button><p id="state">Not connected</p><script type="module" src="/entry.mjs"></script></body></html>',
        "text/html; charset=utf-8", "same-origin-allow-popups");
    }
    if (url.pathname === "/entry.mjs") {
      const entry = 'import {IsolatedDriveAuthPopup} from "/isolated-auth-popup.mjs";' +
        'const c = new IsolatedDriveAuthPopup(' + JSON.stringify(helper.origin) + ',v=>document.querySelector("#state").textContent=v.phase+": "+v.message);' +
        'window.__jr=c;document.querySelector("#connect").addEventListener("click",()=>c.connectFromUserClick());';
      return respond(res, entry, "text/javascript; charset=utf-8", "same-origin-allow-popups");
    }
    const source = url.pathname === "/isolated-auth-popup.mjs" ? "isolated-auth-popup.ts" :
      url.pathname === "/isolated-auth-channel.mjs" ? "isolated-auth-channel.ts" : null;
    if (!source) throw Error("Unknown app asset");
    return respond(res, js(await readFile(path.join(ROOT, "src/pwa/drive", source), "utf8")),
      "text/javascript; charset=utf-8", "same-origin-allow-popups");
  });
  parentOrigin = pageHost.origin;
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.JOB_RANGER_PW_CHROMIUM || undefined });
    const context = await browser.newContext();
    const external = [];
    context.on("request", request => {
      const origin = new URL(request.url()).origin;
      if (origin !== parentOrigin && origin !== helper.origin) external.push(request.url());
    });
    await context.addInitScript((helperOrigin) => {
      if (location.origin !== helperOrigin) return;
      // Mock Google GIS only. No live OAuth or cloud account is used.
      window.google = { accounts: { oauth2: { initTokenClient(options) {
        if (options.scope !== "https://www.googleapis.com/auth/drive.file" ||
            options.include_granted_scopes !== false) throw Error("Scope expanded");
        return { requestAccessToken() {
          options.callback({ access_token: "FAKE_LOCAL_BROWSER_TOKEN",
            scope: options.scope, expires_in: 3600 });
        }};
      }}}};
    }, helper.origin);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", err => errors.push(String(err)));
    await page.goto(parentOrigin);
    const pending = page.waitForEvent("popup");
    await page.locator("#connect").click();
    const popup = await pending;
    popup.on("pageerror", err => errors.push(String(err)));
    await popup.locator("#load").click();
    await popup.locator("#authorize").click();
    await page.getByText("authorized_unverified:", { exact: false }).waitFor();
    const state = await page.locator("#state").textContent();
    assert.ok(state?.includes("No files were uploaded."), state);
    assert.ok(!state?.includes("FAKE_LOCAL_BROWSER_TOKEN"));
    assert.equal(await page.evaluate(() => window.__jr.snapshot().phase), "authorized_unverified");
    assert.deepEqual(external, [], "No external Google or data requests are expected in mock mode");
    assert.deepEqual(errors, []);
    console.log("PASS: isolated popup, exact origin handshake, scope and UI token privacy");
    await context.close();
  } finally {
    await browser?.close();
    await Promise.allSettled([pageHost.close(), helper.close()]);
  }
}
await run();
