import { BrowserWindow } from "electron";
import type { BrowserPageLoaderOptions } from "./backend.cjs";
import {
  AcquisitionNetworkPolicyError,
  assertPublicAcquisitionUrl,
  validateAcquisitionUrlSyntax,
} from "./acquisition-network-policy.cjs";
import { createPinnedFetch } from "./pinned-fetch.cjs";

interface BrowserLoadOptions {
  url: string;
  waitSelectors: string[];
  maxWaitMs: number;
  enableScroll: boolean;
  maxScrollIterations: number;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelectors(
  webContents: Electron.WebContents,
  selectors: string[],
  maxWaitMs: number,
): Promise<boolean> {
  if (selectors.length === 0) return true;

  const checkScript = `
    (function() {
      const selectors = ${JSON.stringify(selectors)};
      return selectors.some(s => document.querySelector(s) !== null);
    })()
  `;

  const startTime = Date.now();
  const pollInterval = 200;

  while (Date.now() - startTime < maxWaitMs) {
    const found = await webContents.executeJavaScript(checkScript, true);
    if (found) return true;
    await delay(pollInterval);
  }
  return false;
}

async function scrollToLoadAll(
  webContents: Electron.WebContents,
  maxIterations: number,
): Promise<void> {
  let previousHeight = 0;
  let unchangedCount = 0;

  for (let i = 0; i < maxIterations; i++) {
    const currentHeight = await webContents.executeJavaScript(
      "document.body ? document.body.scrollHeight : 0",
      true,
    );

    if (currentHeight === previousHeight) {
      unchangedCount++;
      if (unchangedCount >= 2) break;
    } else {
      unchangedCount = 0;
    }

    previousHeight = currentHeight;
    await webContents.executeJavaScript(
      "window.scrollTo(0, document.body ? document.body.scrollHeight : 0);",
      true,
    );
    await delay(800);
  }
}

interface BrowserSession {
  window: BrowserWindow;
  finalize: (handler: () => void) => void;
}

async function extractHtmlAfterLoad(
  webContents: Electron.WebContents,
  options: Pick<BrowserLoadOptions, "waitSelectors" | "maxWaitMs" | "enableScroll" | "maxScrollIterations">,
): Promise<string> {
  await delay(1200);
  await waitForSelectors(webContents, options.waitSelectors, options.maxWaitMs);

  if (options.enableScroll) {
    await scrollToLoadAll(webContents, options.maxScrollIterations);
  }

  const html = await webContents.executeJavaScript(
    "document.documentElement ? document.documentElement.outerHTML : ''",
    true,
  );
  return String(html);
}

function attachNavigationGuard(webContents: Electron.WebContents): void {
  webContents.on("will-navigate", (event, targetUrl) => {
    try {
      validateAcquisitionUrlSyntax(targetUrl);
    } catch {
      event.preventDefault();
    }
  });
}

function isNonNetworkBrowserUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "data:" || protocol === "blob:" || protocol === "about:";
  } catch {
    return false;
  }
}

function attachNetworkSchemeGuard(
  webContents: Electron.WebContents,
  onPolicyViolation: () => void,
): void {
  webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (isNonNetworkBrowserUrl(details.url)) {
      callback({ cancel: false });
      return;
    }

    try {
      validateAcquisitionUrlSyntax(details.url);
      callback({ cancel: false });
    } catch {
      callback({ cancel: true });
      onPolicyViolation();
    }
  });
}

export function createPinnedProtocolHandler(
  pinnedFetch: typeof fetch = createPinnedFetch(),
): (request: Request) => Promise<Response> {
  return async (request) => {
    const safeUrl = validateAcquisitionUrlSyntax(request.url).toString();
    const body = request.method === "GET" || request.method === "HEAD" || request.body === null
      ? undefined
      : Buffer.from(await request.arrayBuffer());

    return pinnedFetch(safeUrl, {
      method: request.method,
      headers: request.headers,
      body,
      redirect: "manual",
      signal: request.signal,
    });
  };
}

function attachPinnedProtocolTransport(webContents: Electron.WebContents): () => void {
  const handler = createPinnedProtocolHandler();
  const protocol = webContents.session.protocol;
  protocol.handle("http", handler);
  protocol.handle("https", handler);

  return () => {
    protocol.unhandle("http");
    protocol.unhandle("https");
  };
}

function createBrowserSession(
  partition: string,
  options: { userAgent: string; maxWaitMs: number },
  reject: (reason: Error) => void,
): BrowserSession {
  let finished = false;
  let didFinishLoad = false;
  const window = createScraperWindow(partition, options.userAgent);
  const detachPinnedTransport = attachPinnedProtocolTransport(window.webContents);

  const finalize = (handler: () => void): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutHandle);
    detachPinnedTransport();
    window.removeAllListeners();
    window.webContents.removeAllListeners();
    if (!window.isDestroyed()) window.destroy();
    handler();
  };

  const timeoutHandle = setTimeout(() => {
    finalize(() => reject(new Error("Browser-backed extraction timed out.")));
  }, options.maxWaitMs + 8000);

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    if (errorCode === -3 && didFinishLoad) return;
    finalize(() => reject(new Error(`Browser-backed extraction failed: ${errorDescription}`)));
  });

  window.webContents.once("did-finish-load", () => { didFinishLoad = true; });

  attachNetworkSchemeGuard(window.webContents, () => {
    finalize(() => reject(new AcquisitionNetworkPolicyError()));
  });

  return { window, finalize };
}

function createScraperWindow(partition: string, userAgent: string): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: true,
      webSecurity: true,
      partition,
    },
  });
  window.webContents.setUserAgent(userAgent);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
}

export async function loadPageHtmlWithOptions(
  options: BrowserLoadOptions & { userAgent: string },
): Promise<string> {
  const url = await assertPublicAcquisitionUrl(options.url);
  const partition = `sojourner-scraper-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise<string>((resolve, reject) => {
    const session = createBrowserSession(partition, options, reject);
    attachNavigationGuard(session.window.webContents);

    session.window.webContents.once("did-finish-load", () => {
      void extractHtmlAfterLoad(session.window.webContents, options)
        .then((html) => session.finalize(() => resolve(html)))
        .catch((err) => session.finalize(() => reject(err instanceof Error ? err : new Error(String(err)))));
    });

    void session.window.loadURL(url).catch((err) => {
      session.finalize(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}

export async function loadPageHtmlInHiddenWindow(
  rawUrl: string,
  options: BrowserPageLoaderOptions,
): Promise<string> {
  return loadPageHtmlWithOptions({
    url: rawUrl,
    userAgent: options.userAgent,
    waitSelectors: [],
    maxWaitMs: options.timeoutMs,
    enableScroll: true,
    maxScrollIterations: 3,
  });
}
