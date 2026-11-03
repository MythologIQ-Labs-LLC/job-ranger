# Plan: Phase 5 - Notifications & System Tray

## Open Questions

1. **Notification grouping**: Should multiple new jobs from the same company be grouped into a single notification, or should each job trigger its own notification?
2. **Tray icon badge**: Should the tray icon show a badge/count of new jobs, or just indicate "new jobs available" without a number?

---

## Phase 1: Notification Infrastructure

### Affected Files

- [contracts.cts](contracts.cts) - Add notification settings types
- [backend.cts](backend.cts) - Add notification event emission after successful scrapes
- [main.cts](main.cts) - Add native notification dispatch, IPC handlers for notification settings

### Changes

**contracts.cts** - Extend `Settings` and `SettingsUpdate`:

```typescript
export interface Settings {
  // ... existing fields
  notificationsEnabled: boolean;
  notifyOnNewJobs: boolean;
  notifyOnMatchedJobs: boolean;
}
```

**backend.cts** - Add notification payload return from `performScrape`:

```typescript
interface ScrapeNotification {
  companyName: string;
  newJobCount: number;
  matchedJobCount: number;
}
```

Modify `performScrape` to track new jobs (jobs not previously seen) by comparing against existing `sourceJobId` values before upserting. Return notification payload alongside `ScrapeRun`.

**main.cts** - Add notification dispatch:

```typescript
import { Notification } from "electron";

function showJobNotification(payload: ScrapeNotification, settings: Settings): void {
  if (!settings.notificationsEnabled) return;
  if (payload.newJobCount === 0 && !settings.notifyOnMatchedJobs) return;

  const notification = new Notification({
    title: `${payload.companyName}`,
    body: formatNotificationBody(payload, settings),
    silent: false,
  });
  notification.show();
}
```

### Unit Tests

- [tests/notification-payload.test.cjs](tests/notification-payload.test.cjs) - Test that `performScrape` correctly identifies new vs. existing jobs and returns accurate `newJobCount`

---

## Phase 2: System Tray

### Affected Files

- [main.cts](main.cts) - Add tray creation, menu, and window visibility toggle
- [contracts.cts](contracts.cts) - Add `minimizeToTray` setting

### Changes

**contracts.cts** - Add tray setting:

```typescript
export interface Settings {
  // ... existing fields
  minimizeToTray: boolean;
}
```

**main.cts** - Create tray with context menu:

```typescript
import { Tray, Menu, nativeImage } from "electron";

let tray: Tray | null = null;

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(moduleDirectory, "../ICON.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  tray.setToolTip("Sojourner");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Sojourner", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));

  tray.on("click", () => mainWindow?.show());
}
```

**main.cts** - Handle minimize-to-tray:

```typescript
mainWindow.on("close", async (event) => {
  const settings = await backend?.getSettings();
  if (settings?.minimizeToTray && !app.isQuitting) {
    event.preventDefault();
    mainWindow?.hide();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
});
```

### Unit Tests

- [tests/tray-menu.test.cjs](tests/tray-menu.test.cjs) - Test that tray context menu items trigger correct actions (mock Electron APIs)

---

## Phase 3: Settings UI Integration

### Affected Files

- [src/pages/Settings.tsx](src/pages/Settings.tsx) - Add notification and tray settings section
- [validators.cts](validators.cts) - Add validation for new settings fields

### Changes

**Settings.tsx** - Add new settings section:

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
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={form.notificationsEnabled}
        onChange={(e) => setForm(f => ({ ...f, notificationsEnabled: e.target.checked }))}
        className="checkbox-shell"
      />
      <span>Enable desktop notifications</span>
    </label>
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={form.notifyOnNewJobs}
        onChange={(e) => setForm(f => ({ ...f, notifyOnNewJobs: e.target.checked }))}
        className="checkbox-shell"
        disabled={!form.notificationsEnabled}
      />
      <span>Notify when new jobs are found</span>
    </label>
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={form.notifyOnMatchedJobs}
        onChange={(e) => setForm(f => ({ ...f, notifyOnMatchedJobs: e.target.checked }))}
        className="checkbox-shell"
        disabled={!form.notificationsEnabled}
      />
      <span>Notify when jobs match filters</span>
    </label>
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={form.minimizeToTray}
        onChange={(e) => setForm(f => ({ ...f, minimizeToTray: e.target.checked }))}
        className="checkbox-shell"
      />
      <span>Minimize to system tray on close</span>
    </label>
  </div>
</section>
```

**validators.cts** - Add validation for new boolean settings:

```typescript
export function validateSettingsUpdate(raw: unknown): SettingsUpdate {
  // ... existing validation
  if ("notificationsEnabled" in obj) {
    validateBoolean(obj.notificationsEnabled, "notificationsEnabled");
  }
  if ("notifyOnNewJobs" in obj) {
    validateBoolean(obj.notifyOnNewJobs, "notifyOnNewJobs");
  }
  if ("notifyOnMatchedJobs" in obj) {
    validateBoolean(obj.notifyOnMatchedJobs, "notifyOnMatchedJobs");
  }
  if ("minimizeToTray" in obj) {
    validateBoolean(obj.minimizeToTray, "minimizeToTray");
  }
  return obj as SettingsUpdate;
}
```

### Unit Tests

- [tests/settings-validation.test.cjs](tests/settings-validation.test.cjs) - Test that new boolean settings are validated correctly, reject non-boolean values

---

## Summary

| Phase | Scope | Files Modified |
|-------|-------|----------------|
| 1 | Notification infrastructure | contracts.cts, backend.cts, main.cts |
| 2 | System tray | main.cts, contracts.cts |
| 3 | Settings UI | Settings.tsx, validators.cts |

**Total new lines**: ~120 backend, ~60 frontend
**New dependencies**: None (uses Electron built-ins)
