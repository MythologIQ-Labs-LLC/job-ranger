import { useEffect, useRef, useState } from "react";
import { Bell, Database, Save, Settings2, SwatchBook } from "lucide-react";
import { BackupRestorePanel } from "../components/BackupRestorePanel";
import { DemoLimitations } from "../components/DemoLimitations";
import { RuntimePanel } from "../components/RuntimePanel";
import { useRuntimeInfo } from "../services/runtime";
import { JsonResumePanel } from "../components/JsonResumePanel";
import { Layout } from "../components/Layout";
import { useAppContext } from "../context/AppContext";
import { useTheme } from "../theme/ThemeProvider";
import { getSourceProfile, type Settings as RuntimeSettings } from "../types";

const fallbackSettings: RuntimeSettings = {
  userAgent: "Job Ranger Desktop/1.0",
  maxConcurrentScrapes: 2,
  scrapeTimeoutMs: 20000,
  retryCount: 1,
  scrapeCooldownMinutes: 30,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMinutes: 60,
  notificationsEnabled: false,
  notifyOnNewJobs: true,
  notifyOnMatchedJobs: true,
  minimizeToTray: false,
};

// Each section saves only its own fields, so saving one section neither persists
// nor discards unsaved edits in the other.
const runtimeFields = ["userAgent", "maxConcurrentScrapes", "scrapeTimeoutMs", "retryCount"] as const;
const notificationFields = ["notificationsEnabled", "notifyOnNewJobs", "notifyOnMatchedJobs", "minimizeToTray"] as const;
type SectionFields = typeof runtimeFields | typeof notificationFields;

function pick(source: RuntimeSettings, fields: SectionFields): Partial<RuntimeSettings> {
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

function sectionDiffers(a: RuntimeSettings, b: RuntimeSettings, fields: SectionFields): boolean {
  return fields.some((field) => a[field] !== b[field]);
}

export function Settings() {
  const { settings, systemStatus, updateSettings, refreshing } = useAppContext();
  const { theme, setTheme, themes } = useTheme();
  const runtime = useRuntimeInfo();
  const webRuntime = runtime?.kind === "web";
  const [form, setForm] = useState<RuntimeSettings>(settings ?? fallbackSettings);
  const lastSaved = useRef<RuntimeSettings | null>(settings);

  // Refresh each section from saved settings unless it has unsaved edits.
  useEffect(() => {
    if (!settings) return;
    const previous = lastSaved.current;
    lastSaved.current = settings;
    setForm((current) => {
      if (!previous) return settings;
      const next = { ...current };
      for (const fields of [runtimeFields, notificationFields]) {
        if (!sectionDiffers(current, previous, fields)) Object.assign(next, pick(settings, fields));
      }
      return next;
    });
  }, [settings]);

  const saved = settings ?? fallbackSettings;
  const notificationsDirty = sectionDiffers(form, saved, notificationFields);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await updateSettings(pick(form, runtimeFields));
    } catch {
      // updateSettings already shows the failure; the form keeps the unsaved values.
    }
  };

  const saveNotifications = async () => {
    try {
      await updateSettings(pick(form, notificationFields));
    } catch {
      // updateSettings already shows the failure; the status stays "unsaved".
    }
  };

  return (
    <Layout>
      <section className="panel panel-strong px-6 py-7 sm:px-8">
        <h1 className="page-title">Shape the workspace around how you actually review opportunities.</h1>
        <p className="page-copy">
          Themes are functional, not cosmetic flourishes. Pick the one that makes your review rhythm calmer, then tune the runtime so scrapes behave the way you expect.
        </p>
      </section>
      <DemoLimitations />

      <div className="mt-8 space-y-8">
        <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="flex items-center gap-3">
              <SwatchBook className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-2xl font-semibold">Functional themes</h2>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Each theme is tuned for a specific kind of session: careful sourcing, deep focus, or calm maintenance.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {themes.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                aria-pressed={theme === option.id}
                className={`theme-card text-left ${theme === option.id ? "theme-card-active" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{option.label}</h3>
                  {theme === option.id && <span className="soft-badge soft-badge-success">Active</span>}
                </div>
                <div className="theme-palette-preview mt-3 flex h-4 overflow-hidden rounded-md" aria-hidden="true">
                  <span style={{ flex: 6, backgroundColor: option.colors.canvas }} />
                  <span style={{ flex: 3, backgroundColor: option.colors.sidebar }} />
                  <span style={{ flex: 1, backgroundColor: option.colors.primary }} />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">{option.story}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Settings2 className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-2xl font-semibold">Runtime behavior</h2>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              These values define how assertive the local worker should be when polling and retrying supported sources.
            </p>
          </div>
          <form onSubmit={(event) => void handleSubmit(event)} className="panel panel-strong p-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="settings-user-agent" className="block text-sm font-medium">User agent</label>
                <input
                  id="settings-user-agent"
                  type="text"
                  value={form.userAgent}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, userAgent: event.target.value }))
                  }
                  className="input-shell mt-1"
                />
              </div>
              <div>
                <label htmlFor="settings-max-concurrent" className="block text-sm font-medium">Max concurrent scrapes</label>
                <input
                  id="settings-max-concurrent"
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxConcurrentScrapes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxConcurrentScrapes: Number(event.target.value),
                    }))
                  }
                  className="input-shell mt-1"
                />
              </div>
              <div>
                <label htmlFor="settings-timeout" className="block text-sm font-medium">Timeout (ms)</label>
                <input
                  id="settings-timeout"
                  type="number"
                  min={1000}
                  step={1000}
                  value={form.scrapeTimeoutMs}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scrapeTimeoutMs: Number(event.target.value),
                    }))
                  }
                  className="input-shell mt-1"
                />
              </div>
              <div>
                <label htmlFor="settings-retry-count" className="block text-sm font-medium">Retry count</label>
                <input
                  id="settings-retry-count"
                  type="number"
                  min={0}
                  max={5}
                  value={form.retryCount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      retryCount: Number(event.target.value),
                    }))
                  }
                  className="input-shell mt-1"
                />
              </div>
              <div className="panel panel-muted flex items-center rounded-2xl px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                Smaller timeouts make failures surface faster. Higher retries trade speed for resilience.
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="submit" disabled={refreshing} className="primary-button disabled:opacity-60">
                <Save className="h-4 w-4" />
                Save runtime settings
              </button>
            </div>
          </form>
        </section>

        <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-2xl font-semibold">Notifications</h2>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Control when Job Ranger alerts you about new opportunities.
            </p>
          </div>
          <div className="panel panel-strong p-6 space-y-4">
            {webRuntime && (
              <p className="text-sm text-[var(--color-text-secondary)]" data-testid="web-notification-limit">
                The web app does not show desktop notifications or a system tray icon. These preferences are saved with your
                data but have no effect here.
              </p>
            )}
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
              <span className={`text-sm ${!form.notificationsEnabled ? "opacity-50" : ""}`}>
                Notify when new jobs are found
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notifyOnMatchedJobs}
                disabled={!form.notificationsEnabled}
                onChange={(e) => setForm((f) => ({ ...f, notifyOnMatchedJobs: e.target.checked }))}
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] disabled:opacity-50"
              />
              <span className={`text-sm ${!form.notificationsEnabled ? "opacity-50" : ""}`}>
                Notify when jobs match filters
              </span>
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
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--color-border)] pt-4">
              <p
                role="status"
                aria-label="Notification settings save status"
                className={`mr-auto text-sm ${notificationsDirty ? "text-[var(--color-warning)]" : "text-[var(--color-text-secondary)]"}`}
              >
                {notificationsDirty ? "Unsaved notification changes." : "All notification changes saved."}
              </p>
              <button
                type="button"
                disabled={refreshing || !notificationsDirty}
                onClick={() => void saveNotifications()}
                className="primary-button disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                Save notification settings
              </button>
            </div>
          </div>
        </section>

        <RuntimePanel />
        <BackupRestorePanel />
        <JsonResumePanel />

        <section className="grid grid-cols-1 gap-8 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-2xl font-semibold">Backend facts</h2>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              A concise source of truth for where the Alpha runtime stores and executes its work.
            </p>
          </div>
          <div className="panel panel-strong p-6">
            <dl className="space-y-4 text-sm text-[var(--color-text-secondary)]">
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Database path</dt>
                <dd className="mt-1 break-all">{systemStatus?.databasePath ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">SQLite binary</dt>
                <dd className="mt-1 break-all">{systemStatus?.sqliteBinaryPath ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--color-text-primary)]">Supported source adapters</dt>
                <dd className="mt-1">{systemStatus?.supportedSources.map((type) => getSourceProfile(type).label).join(", ") ?? "Loading..."}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </Layout>
  );
}
