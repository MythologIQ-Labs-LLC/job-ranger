# Plan: V1 Remediation - Split loadPageHtmlWithOptions

## Open Questions

None. The violation is clear: `loadPageHtmlWithOptions` is 63 lines (max: 40). The function must be split without changing behavior.

## Phase 1: Extract Three Helper Functions

### Affected Files

- `browser-loader.cts` - Extract 3 functions, reduce `loadPageHtmlWithOptions` to 18 lines

### Changes

**1. Add `extractHtmlAfterLoad`** (16 lines):

```typescript
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
```

**2. Add `attachNavigationGuard`** (9 lines):

```typescript
function attachNavigationGuard(webContents: Electron.WebContents): void {
  webContents.on("will-navigate", (event, targetUrl) => {
    try {
      validateExternalUrl(targetUrl);
    } catch {
      event.preventDefault();
    }
  });
}
```

**3. Add `BrowserSession` interface and `createBrowserSession`** (28 lines):

```typescript
interface BrowserSession {
  window: BrowserWindow;
  finalize: (handler: () => void) => void;
}

function createBrowserSession(
  partition: string,
  options: { userAgent: string; maxWaitMs: number },
  reject: (reason: Error) => void,
): BrowserSession {
  let finished = false;
  const window = createScraperWindow(partition, options.userAgent);

  const finalize = (handler: () => void): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutHandle);
    window.removeAllListeners();
    window.webContents.removeAllListeners();
    if (!window.isDestroyed()) window.destroy();
    handler();
  };

  const timeoutHandle = setTimeout(() => {
    finalize(() => reject(new Error("Browser-backed extraction timed out.")));
  }, options.maxWaitMs + 8000);

  return { window, finalize };
}
```

**4. Refactor `loadPageHtmlWithOptions`** (18 lines):

```typescript
export async function loadPageHtmlWithOptions(
  options: BrowserLoadOptions & { userAgent: string },
): Promise<string> {
  const url = validateExternalUrl(options.url);
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
```

### Line Count Verification

| Function | Lines | Status |
|----------|-------|--------|
| `extractHtmlAfterLoad` | 16 | ≤40 ✓ |
| `attachNavigationGuard` | 9 | ≤40 ✓ |
| `createBrowserSession` | 28 | ≤40 ✓ |
| `loadPageHtmlWithOptions` | 18 | ≤40 ✓ |

**Arithmetic**:
- Current: 63 lines
- Extracted: 16 + 9 + 28 = 53 lines moved out
- Remaining + new orchestration: 18 lines
- **COMPLIANT**: 18 ≤ 40 ✓

### Unit Tests

- `browser-loader.test.ts` - Test extracted functions independently:
  - `extractHtmlAfterLoad`: Verify delay, waitForSelectors, scrollToLoadAll calls, HTML return
  - `attachNavigationGuard`: Verify valid URLs pass, invalid URLs get preventDefault
  - `createBrowserSession`: Verify window creation, finalize cleanup, timeout behavior

## Phase 2: Remove did-fail-load Handler Complexity

### Affected Files

- `browser-loader.cts` - Simplify error handling

### Changes

The `did-fail-load` handler needs to be attached in `createBrowserSession`. Update:

```typescript
function createBrowserSession(
  partition: string,
  options: { userAgent: string; maxWaitMs: number },
  reject: (reason: Error) => void,
): BrowserSession {
  let finished = false;
  let didFinishLoad = false;
  const window = createScraperWindow(partition, options.userAgent);

  const finalize = (handler: () => void): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutHandle);
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

  return { window, finalize };
}
```

**Updated `createBrowserSession` metrics**: 32 lines (still ≤40 ✓)

### Unit Tests

None for this phase. Compilation and line count verification only.

---

## Summary

**Before**: `loadPageHtmlWithOptions` = 63 lines (VIOLATION)

**After**:
| Function | Lines |
|----------|-------|
| `loadPageHtmlWithOptions` | 18 |
| `createBrowserSession` | 32 |
| `attachNavigationGuard` | 9 |
| `extractHtmlAfterLoad` | 16 |

**Total new lines**: 75 (file grows from 157 to ~170 lines, under 250 limit)

**All functions ≤40 lines**: ✓

The extraction follows Simple Made Easy principles:
- **Uncomplicating**: Lifecycle (session), navigation (guard), extraction (HTML) are separated
- **Value-oriented**: `BrowserSession` is a simple data structure with a cleanup function
- **Composable**: Each extracted function can be tested independently
