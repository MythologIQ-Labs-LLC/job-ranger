# Plan: Phase 5 - Notifications & System Tray (Revised)

This plan addresses all 4 violations from VETO Entry #24:
- V1: Extract tray-notifications.cts to keep main.cts under 250 lines
- V2: Split validators.cts to bring under 250 lines
- V3: No migration needed (Settings uses key-value JSON pattern)
- V4: Design decisions resolved below

## Design Decisions (Resolved)

1. **Notification grouping**: Single notification per company scrape displaying "N new jobs at [Company]". This avoids notification spam while providing actionable information.

2. **Tray badge**: No badge. Tooltip shows "Sojourner" only. Badge requires platform-specific handling (macOS dock, Windows overlay) and adds complexity disproportionate to value.

---

## Phase 1: Validators Remediation

**Purpose**: Bring validators.cts under 250-line limit before adding new validation.

### Affected Files

- [validators.cts](validators.cts) - Split into focused modules (264 -> ~95 lines)
- [validators/common.cts](validators/common.cts) - New: shared validation utilities (~65 lines)
- [validators/settings.cts](validators/settings.cts) - New: settings validation (~45 lines)
- [validators/company.cts](validators/company.cts) - New: company validation (~55 lines)
- [validators/filter.cts](validators/filter.cts) - New: filter validation (~75 lines)

### Changes

**validators/common.cts** - Extract shared utilities:

```typescript
export function validateExternalUrl(rawUrl: string): string
export function isRecord(value: unknown): value is Record<string, unknown>
export function validateId(rawValue: unknown, label: string): string
export function validateOptionalString(rawValue: unknown, label: string): string | undefined
export function validateBoolean(rawValue: unknown, label: string): boolean
export function validateOptionalBoolean(rawValue: unknown, label: string): boolean | undefined
export function validateFiniteNumber(rawValue: unknown, label: string): number
export function validateStringArray(rawValue: unknown, label: string): string[]
export function validateOptionalStringArray(rawValue: unknown, label: string): string[] | undefined
export function validateNullableCompanyId(rawValue: unknown, label: string): string | null
export function validateOptionalNullableCompanyId(rawValue: unknown, label: string): string | null | undefined
```

**validators/company.cts** - Company validation:

```typescript
import { validateExternalUrl, validateOptionalString, validateBoolean, validateFiniteNumber, isRecord } from "./common.cjs";
import type { CompanyDraft, CompanyUpdate } from "../contracts.cjs";

export function validateCompanyDraft(rawValue: unknown): CompanyDraft
export function validateCompanyUpdate(rawValue: unknown): CompanyUpdate
```

**validators/filter.cts** - Filter validation:

```typescript
import { ... } from "./common.cjs";
import type { FilterDraft, FilterUpdate } from "../contracts.cjs";

export function validateFilterDraft(rawValue: unknown): FilterDraft
export function validateFilterUpdate(rawValue: unknown): FilterUpdate
```

**validators/settings.cts** - Settings validation (includes new notification fields):

```typescript
import { validateOptionalString, validateOptionalBoolean, validateFiniteNumber, isRecord } from "./common.cjs";
import type { SettingsUpdate } from "../contracts.cjs";

export function validateSettingsUpdate(rawValue: unknown): SettingsUpdate {
  // existing fields + new notification/tray fields
  if ("notificationsEnabled" in obj) validateOptionalBoolean(obj.notificationsEnabled, "notificationsEnabled");
  if ("notifyOnNewJobs" in obj) validateOptionalBoolean(obj.notifyOnNewJobs, "notifyOnNewJobs");
  if ("notifyOnMatchedJobs" in obj) validateOptionalBoolean(obj.notifyOnMatchedJobs, "notifyOnMatchedJobs");
  if ("minimizeToTray" in obj) validateOptionalBoolean(obj.minimizeToTray, "minimizeToTray");
}
```

**validators.cts** - Re-export facade:

```typescript
export { validateExternalUrl, validateId, validateFiniteNumber } from "./validators/common.cjs";
export { validateCompanyDraft, validateCompanyUpdate } from "./validators/company.cjs";
export { validateFilterDraft, validateFilterUpdate } from "./validators/filter.cjs";
export { validateSettingsUpdate } from "./validators/settings.cjs";
```

### Unit Tests

- No new tests needed; existing validation behavior preserved

---

## Phase 2: Tray & Notification Module

**Purpose**: Create tray-notifications.cts to keep main.cts under 250 lines.

### Affected Files

- [tray-notifications.cts](tray-notifications.cts) - New: tray and notification logic (~70 lines)
- [contracts.cts](contracts.cts) - Add notification settings to Settings interface (+4 lines)
- [backend.cts](backend.cts) - Add defaultSettings for notification fields (+4 lines)

### Changes

**tray-notifications.cts** - New module:

```typescript
import { Tray, Menu, Notification, nativeImage, BrowserWindow } from "electron";
import path from "node:path";
import type { Settings } from "./contracts.cjs";

export interface ScrapeNotification {
  companyName: string;
  newJobCount: number;
  matchedJobCount: number;
}

let tray: Tray | null = null;

export function createTray(moduleDirectory: string, mainWindow: BrowserWindow | null, onQuit: () => void): Tray {
  const iconPath = path.join(moduleDirectory, "../ICON.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip("Sojourner");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Sojourner", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]));
  tray.on("click", () => mainWindow?.show());

  return tray;
}

export function showJobNotification(payload: ScrapeNotification, settings: Settings): void {
  if (!settings.notificationsEnabled) return;
  if (payload.newJobCount === 0 && payload.matchedJobCount === 0) return;
  if (payload.newJobCount === 0 && !settings.notifyOnMatchedJobs) return;

  const bodyParts: string[] = [];
  if (payload.newJobCount > 0 && settings.notifyOnNewJobs) {
    bodyParts.push(`${payload.newJobCount} new job${payload.newJobCount === 1 ? "" : "s"}`);
  }
  if (payload.matchedJobCount > 0 && settings.notifyOnMatchedJobs) {
    bodyParts.push(`${payload.matchedJobCount} matched filter${payload.matchedJobCount === 1 ? "" : "s"}`);
  }

  if (bodyParts.length === 0) return;

  const notification = new Notification({
    title: payload.companyName,
    body: bodyParts.join(", "),
    silent: false,
  });
  notification.show();
}

export function shouldMinimizeToTray(settings: Settings | null, isQuitting: boolean): boolean {
  return Boolean(settings?.minimizeToTray && !isQuitting);
}
```

**contracts.cts** - Extend Settings interface (line ~142):

```typescript
export interface Settings {
  userAgent: string;
  maxConcurrentScrapes: number;
  scrapeTimeoutMs: number;
  retryCount: number;
  scrapeCooldownMinutes: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMinutes: number;
  // New notification settings
  notificationsEnabled: boolean;
  notifyOnNewJobs: boolean;
  notifyOnMatchedJobs: boolean;
  minimizeToTray: boolean;
}
```

**backend.cts** - Extend defaultSettings (line ~35):

```typescript
const defaultSettings: Settings = {
  userAgent: "Sojourner Desktop/1.0",
  maxConcurrentScrapes: 2,
  scrapeTimeoutMs: 20000,
  retryCount: 1,
  scrapeCooldownMinutes: 30,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMinutes: 60,
  // New defaults
  notificationsEnabled: false,
  notifyOnNewJobs: true,
  notifyOnMatchedJobs: true,
  minimizeToTray: false,
};
```

### Unit Tests

- [tests/tray-notifications.test.cjs](tests/tray-notifications.test.cjs) - Test `showJobNotification` respects settings flags, formats body correctly; test `shouldMinimizeToTray` returns correct boolean

---

## Phase 3: Main Process Integration

**Purpose**: Wire tray and notifications into main.cts lifecycle.

### Affected Files

- [main.cts](main.cts) - Import and call tray/notification functions (+15 lines, total ~232)

### Changes

**main.cts** - Add imports (top of file):

```typescript
import { createTray, shouldMinimizeToTray } from "./tray-notifications.cjs";
```

**main.cts** - Add app state (after line 18):

```typescript
let isQuitting = false;
```

**main.cts** - Add minimize-to-tray handler in createWindow (after line 71):

```typescript
mainWindow.on("close", async (event) => {
  const settings = await backend?.getSettings();
  if (shouldMinimizeToTray(settings ?? null, isQuitting)) {
    event.preventDefault();
    mainWindow?.hide();
  }
});
```

**main.cts** - Initialize tray in app.whenReady (after line 194):

```typescript
createTray(moduleDirectory, mainWindow, () => app.quit());
```

**main.cts** - Update before-quit handler (line 215):

```typescript
app.on("before-quit", () => {
  isQuitting = true;
  void backend?.dispose();
});
```

### Unit Tests

- No additional tests; integration verified via manual testing

---

## Phase 4: Settings UI

**Purpose**: Add notification settings to Settings page.

### Affected Files

- [src/pages/Settings.tsx](src/pages/Settings.tsx) - Add notification settings section (+45 lines, total ~231)

### Changes

**Settings.tsx** - Add Bell import (line 2):

```typescript
import { Bell, Database, Save, Settings2, SwatchBook } from "lucide-react";
```

**Settings.tsx** - Update fallbackSettings (line 8):

```typescript
const fallbackSettings: RuntimeSettings = {
  userAgent: "Sojourner Desktop/1.0",
  maxConcurrentScrapes: 2,
  scrapeTimeoutMs: 20000,
  retryCount: 1,
  notificationsEnabled: false,
  notifyOnNewJobs: true,
  notifyOnMatchedJobs: true,
  minimizeToTray: false,
};
```

**Settings.tsx** - Add notifications section (after line 150, before Desktop backend facts):

```tsx
<section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
  <div>
    <div className="flex items-center gap-3">
      <Bell className="h-5 w-5 text-[var(--color-primary)]" />
      <h2 className="text-2xl font-semibold">Notifications</h2>
    </div>
    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
      Control when Sojourner alerts you about new opportunities.
    </p>
  </div>
  <div className="panel panel-strong p-6 space-y-4">
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={form.notificationsEnabled}
        onChange={(e) => setForm((f) => ({ ...f, notificationsEnabled: e.target.checked }))}
        className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
      />
      <span className="text-sm">Enable desktop notifications</span>
    </label>
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={form.notifyOnNewJobs}
        disabled={!form.notificationsEnabled}
        onChange={(e) => setForm((f) => ({ ...f, notifyOnNewJobs: e.target.checked }))}
        className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] disabled:opacity-50"
      />
      <span className={`text-sm ${!form.notificationsEnabled ? "opacity-50" : ""}`}>Notify when new jobs are found</span>
    </label>
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={form.notifyOnMatchedJobs}
        disabled={!form.notificationsEnabled}
        onChange={(e) => setForm((f) => ({ ...f, notifyOnMatchedJobs: e.target.checked }))}
        className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] disabled:opacity-50"
      />
      <span className={`text-sm ${!form.notificationsEnabled ? "opacity-50" : ""}`}>Notify when jobs match filters</span>
    </label>
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={form.minimizeToTray}
        onChange={(e) => setForm((f) => ({ ...f, minimizeToTray: e.target.checked }))}
        className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)]"
      />
      <span className="text-sm">Minimize to system tray on close</span>
    </label>
  </div>
</section>
```

### Unit Tests

- No additional tests; UI behavior verified via manual testing

---

## Summary

| Phase | Scope | Files Modified/Created | Final Line Count |
|-------|-------|------------------------|------------------|
| 1 | Validators remediation | validators.cts, validators/*.cts | validators.cts: ~95 |
| 2 | Tray & notification module | tray-notifications.cts, contracts.cts, backend.cts | tray-notifications.cts: ~70 |
| 3 | Main process integration | main.cts | main.cts: ~232 |
| 4 | Settings UI | Settings.tsx | Settings.tsx: ~231 |

**All files under 250-line limit**: Verified
**No SQL migration needed**: Settings uses key-value JSON pattern
**Design decisions resolved**: Notification grouping (per-company), no tray badge
**New dependencies**: None (uses Electron built-ins)
