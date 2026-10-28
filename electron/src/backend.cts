import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Company,
  CompanySourceType,
  CompanyDraft,
  CompanyUpdate,
  Filter,
  FilterDraft,
  FilterUpdate,
  Job,
  ScrapeRun,
  Settings,
  SettingsUpdate,
  SystemStatus,
} from "../../src/shared/contracts.js";
import {
  canRunSourceType,
  getSourceProfile,
  sourceProfiles,
} from "../../src/shared/contracts.js";
import { migrations } from "./migrations.cjs";
import { describeRepairFailures, repairStoredNulTextOnce } from "./nul-text.cjs";
import { FEATURE_MIGRATION_VERSIONS } from "./feature-migrations.cjs";
import { JobScoutRepository } from "./repository.cjs";
import {
  detectSourceFromUrl,
  scraperAdapters,
  type ScrapedJob,
} from "./scrapers.cjs";
import { resolveSqliteBinary, sql, SqliteClient } from "./sqlite.cjs";
import { classifySourceFailure } from "./source-diagnostics.cjs";
import {
  checkScrapeGuard,
  shouldOpenCircuit,
  calculateCircuitOpenUntil,
} from "./scrape-guard.cjs";

const defaultSettings: Settings = {
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

function normalizeList(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

function matchesFilter(job: ScrapedJob, filter: Filter): boolean {
  if (!filter.isActive) {
    return false;
  }

  const haystack = `${job.title} ${job.descriptionSnippet}`.toLowerCase();
  const location = job.location.toLowerCase();
  const title = job.title.toLowerCase();

  const containsAll = (terms: string[], target: string) =>
    terms.every((term) => target.includes(term.toLowerCase()));
  const containsNone = (terms: string[], target: string) =>
    terms.every((term) => !target.includes(term.toLowerCase()));

  if (!containsAll(filter.titleInclude, title)) {
    return false;
  }
  if (!containsNone(filter.titleExclude, title)) {
    return false;
  }
  if (!containsAll(filter.keywordsInclude, haystack)) {
    return false;
  }
  if (!containsNone(filter.keywordsExclude, haystack)) {
    return false;
  }
  if (filter.salaryMin && (!job.salaryMin || job.salaryMin < filter.salaryMin)) {
    return false;
  }
  if (filter.locationInclude.length > 0 && !containsAll(filter.locationInclude, location)) {
    return false;
  }
  if (!containsNone(filter.locationExclude, location)) {
    return false;
  }

  return true;
}

interface PendingScrape {
  companyId: string;
}

interface ScrapeListener {
  resolve: (run: ScrapeRun) => void;
  reject: (error: unknown) => void;
}

export interface BrowserPageLoaderOptions {
  timeoutMs: number;
  userAgent: string;
}

export type BrowserPageLoader = (
  url: string,
  options: BrowserPageLoaderOptions,
) => Promise<string>;

interface BackendOptions {
  dataDirectory: string;
  fetchImpl?: typeof fetch;
  sqliteBinaryPath?: string;
  schedulerEnabled?: boolean;
  browserPageLoader?: BrowserPageLoader;
  runtimeLabel?: SystemStatus["backend"];
  /** Restricts the advertised runnable source types (web runtime). */
  runnableSourceTypes?: readonly CompanySourceType[];
}

export class JobScoutBackend {
  private sqliteBinaryPath = "";
  private sqlite!: SqliteClient;
  private repository!: JobScoutRepository;
  private readonly fetchImpl: typeof fetch;
  private readonly schedulerEnabled: boolean;
  private readonly browserPageLoader?: BrowserPageLoader;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pendingQueue: PendingScrape[] = [];
  private readonly queuedCompanyIds = new Set<string>();
  private readonly inFlightCompanyIds = new Set<string>();
  private readonly scrapeListeners = new Map<string, ScrapeListener[]>();
  private runningScrapes = 0;
  private readonly databasePath: string;

  constructor(private readonly options: BackendOptions) {
    this.databasePath = path.join(this.options.dataDirectory, "jobscout.sqlite3");
    this.fetchImpl = this.options.fetchImpl ?? fetch;
    this.schedulerEnabled = this.options.schedulerEnabled ?? true;
    this.browserPageLoader = this.options.browserPageLoader;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.options.dataDirectory, { recursive: true });
    this.sqliteBinaryPath =
      this.options.sqliteBinaryPath ?? (await resolveSqliteBinary());
    this.sqlite = new SqliteClient(this.databasePath, this.sqliteBinaryPath);
    this.repository = new JobScoutRepository(this.sqlite);

    await this.runMigrations();
    // Text stored with NUL before #297 would read back cut off on the desktop engine.
    const unrepaired = await repairStoredNulTextOnce(this.sqlite);
    if (unrepaired.length > 0) {
      console.error(`Some stored text with NUL characters could not be repaired: ${describeRepairFailures(unrepaired)}`);
    }
    await this.repository.updateSettings(defaultSettings, {});

    if (this.schedulerEnabled) {
      await this.reschedule();
    }
  }

  async dispose(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.pendingQueue.length = 0;
    this.queuedCompanyIds.clear();
    this.inFlightCompanyIds.clear();
    this.scrapeListeners.clear();
  }

  async getSystemStatus(platform: string): Promise<SystemStatus> {
    return {
      backend: this.options.runtimeLabel ?? "electron-ipc",
      platform,
      databasePath: this.databasePath,
      sqliteBinaryPath: this.sqliteBinaryPath,
      supportedSources: Object.values(sourceProfiles)
        .filter((profile) => profile.canRun)
        .filter(
          (profile) =>
            !this.options.runnableSourceTypes ||
            this.options.runnableSourceTypes.includes(profile.type),
        )
        .map((profile) => profile.type),
    };
  }

  async listCompanies(): Promise<Company[]> {
    return this.repository.listCompanies();
  }

  async createCompany(draft: CompanyDraft): Promise<Company> {
    const normalizedDraft: CompanyDraft = {
      ...draft,
      name: draft.name.trim(),
      url: draft.url.trim(),
      frequencyMinutes: Math.max(15, Math.floor(draft.frequencyMinutes)),
    };
    const detected = detectSourceFromUrl(normalizedDraft.url);
    const company = await this.repository.createCompany(
      normalizedDraft,
      detected.sourceType,
      detected.sourceIdentifier,
    );
    await this.reschedule();
    return company;
  }

  async updateCompany(id: string, update: CompanyUpdate): Promise<Company> {
    const current = await this.repository.getCompanyById(id);
    if (!current) {
      throw new Error(`Company ${id} not found`);
    }

    const nextUrl = update.url?.trim() ?? current.url;
    const detected = detectSourceFromUrl(nextUrl);
    const company = await this.repository.updateCompany(
      id,
      {
        ...update,
        frequencyMinutes:
          update.frequencyMinutes === undefined
            ? undefined
            : Math.max(15, Math.floor(update.frequencyMinutes)),
      },
      detected.sourceType,
      detected.sourceIdentifier,
    );
    await this.reschedule();
    return company;
  }

  async deleteCompany(id: string): Promise<void> {
    await this.repository.deleteCompany(id);
    await this.reschedule();
  }

  async listJobs(): Promise<Job[]> {
    return this.repository.listJobs();
  }

  async markJobSeen(id: string): Promise<Job> {
    return this.repository.markJobSeen(id);
  }

  async listFilters(): Promise<Filter[]> {
    return this.repository.listFilters();
  }

  async createFilter(draft: FilterDraft): Promise<Filter> {
    return this.repository.createFilter({
      ...draft,
      name: draft.name.trim(),
      titleInclude: normalizeList(draft.titleInclude),
      titleExclude: normalizeList(draft.titleExclude),
      keywordsInclude: normalizeList(draft.keywordsInclude),
      keywordsExclude: normalizeList(draft.keywordsExclude),
      locationInclude: normalizeList(draft.locationInclude),
      locationExclude: normalizeList(draft.locationExclude),
    });
  }

  async updateFilter(id: string, update: FilterUpdate): Promise<Filter> {
    return this.repository.updateFilter(id, {
      ...update,
      titleInclude: update.titleInclude ? normalizeList(update.titleInclude) : undefined,
      titleExclude: update.titleExclude ? normalizeList(update.titleExclude) : undefined,
      keywordsInclude: update.keywordsInclude
        ? normalizeList(update.keywordsInclude)
        : undefined,
      keywordsExclude: update.keywordsExclude
        ? normalizeList(update.keywordsExclude)
        : undefined,
      locationInclude: update.locationInclude
        ? normalizeList(update.locationInclude)
        : undefined,
      locationExclude: update.locationExclude
        ? normalizeList(update.locationExclude)
        : undefined,
    });
  }

  async deleteFilter(id: string): Promise<void> {
    await this.repository.deleteFilter(id);
  }

  async getSettings(): Promise<Settings> {
    return this.repository.getSettings(defaultSettings);
  }

  async updateSettings(update: SettingsUpdate): Promise<Settings> {
    const nextSettings = await this.repository.updateSettings(defaultSettings, update);
    await this.reschedule();
    return nextSettings;
  }

  async listRecentScrapeRuns(limit = 10): Promise<ScrapeRun[]> {
    return this.repository.listRecentScrapeRuns(limit);
  }

  async runCompanyScrape(companyId: string): Promise<ScrapeRun> {
    return this.enqueueScrape(companyId);
  }

  private async runMigrations(): Promise<void> {
    await this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    );

    const appliedRows = await this.sqlite.queryAll<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version ASC;",
    );
    const applied = new Set(appliedRows.map((row) => row.version));
    const knownVersions = new Set([
      ...migrations.map((migration) => migration.version),
      ...FEATURE_MIGRATION_VERSIONS,
    ]);
    const unknown = appliedRows
      .map((row) => row.version)
      .filter((version) => !knownVersions.has(version));
    if (unknown.length > 0) {
      // Never run an older build against data upgraded by a newer one: in
      // both runtimes (and across PWA service-worker rollbacks) that could
      // silently corrupt Career Evidence. Fail closed and explain.
      throw new Error(
        `This Sojourner workspace was upgraded by a newer version (database schema ${Math.max(...unknown)}). Update Sojourner to open it; your data has not been changed.`,
      );
    }

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      await this.sqlite.exec(migration.sql);
      await this.sqlite.exec(
        sql`
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (${migration.version}, ${migration.name}, ${new Date().toISOString()});
        `,
      );
    }
  }

  private async reschedule(): Promise<void> {
    if (!this.schedulerEnabled) {
      return;
    }

    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();

    const companies = await this.repository.listCompanies();
    for (const company of companies) {
      if (!company.isActive) {
        continue;
      }

      const intervalMs = Math.max(15, company.frequencyMinutes) * 60 * 1000;
      const timer = setInterval(() => {
        void this.enqueueScheduledScrape(company.id);
      }, intervalMs);
      this.timers.set(company.id, timer);
    }
  }

  private async enqueueScheduledScrape(companyId: string): Promise<void> {
    if (this.queuedCompanyIds.has(companyId) || this.inFlightCompanyIds.has(companyId)) {
      return;
    }

    this.pendingQueue.push({ companyId });
    this.queuedCompanyIds.add(companyId);
    try {
      await this.processQueue();
    } catch {
      this.dropPendingScrape(companyId);
    }
  }

  private enqueueScrape(companyId: string): Promise<ScrapeRun> {
    const promise = new Promise<ScrapeRun>((resolve, reject) => {
      const listeners = this.scrapeListeners.get(companyId) ?? [];
      listeners.push({ resolve, reject });
      this.scrapeListeners.set(companyId, listeners);
    });

    if (!this.queuedCompanyIds.has(companyId) && !this.inFlightCompanyIds.has(companyId)) {
      this.pendingQueue.push({ companyId });
      this.queuedCompanyIds.add(companyId);
    }

    void this.processQueue().catch((error) => {
      this.dropPendingScrape(companyId);
      this.rejectScrapeListeners(companyId, error);
    });
    return promise;
  }

  private async processQueue(): Promise<void> {
    // Nothing to start: do not touch the database. (A read here after the
    // last scrape was delivered raced callers that dispose the backend.)
    if (this.pendingQueue.length === 0) {
      return;
    }
    const settings = await this.getSettings();

    while (
      this.runningScrapes < settings.maxConcurrentScrapes &&
      this.pendingQueue.length > 0
    ) {
      const next = this.pendingQueue.shift();
      if (!next) {
        return;
      }

      this.queuedCompanyIds.delete(next.companyId);
      this.inFlightCompanyIds.add(next.companyId);
      this.runningScrapes += 1;

      void this.performScrape(next.companyId)
        .then((run) => {
          this.resolveScrapeListeners(next.companyId, run);
        })
        .catch((error) => {
          this.rejectScrapeListeners(next.companyId, error);
        })
        .finally(() => {
          this.inFlightCompanyIds.delete(next.companyId);
          this.runningScrapes -= 1;
          // Continue with queued scrapes; a failure to start them is reported
          // to their callers instead of escaping as an unhandled rejection.
          return this.processQueue().catch((error) => {
            for (const entry of this.pendingQueue.splice(0)) {
              this.queuedCompanyIds.delete(entry.companyId);
              this.rejectScrapeListeners(entry.companyId, error);
            }
          });
        });
    }
  }

  private resolveScrapeListeners(companyId: string, run: ScrapeRun): void {
    const listeners = this.scrapeListeners.get(companyId) ?? [];
    this.scrapeListeners.delete(companyId);
    for (const listener of listeners) {
      listener.resolve(run);
    }
  }

  private rejectScrapeListeners(companyId: string, error: unknown): void {
    const listeners = this.scrapeListeners.get(companyId) ?? [];
    this.scrapeListeners.delete(companyId);
    for (const listener of listeners) {
      listener.reject(error);
    }
  }

  private dropPendingScrape(companyId: string): void {
    const queueIndex = this.pendingQueue.findIndex((entry) => entry.companyId === companyId);
    if (queueIndex >= 0) {
      this.pendingQueue.splice(queueIndex, 1);
    }
    this.queuedCompanyIds.delete(companyId);
  }

  private async performScrape(companyId: string): Promise<ScrapeRun> {
    const company = await this.repository.getCompanyById(companyId);
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }

    const run = await this.repository.createScrapeRun(companyId);
    const startedAt = new Date().toISOString();
    const profile = getSourceProfile(company.sourceType);
    const settings = await this.getSettings();

    const guard = checkScrapeGuard(company, settings);
    if (!guard.canScrape) {
      const message = guard.reason === "cooldown"
        ? `Scrape skipped: cooldown until ${guard.waitUntil}`
        : `Scrape skipped: circuit open until ${guard.waitUntil}`;
      const diagnosticCode = guard.reason === "cooldown" ? "cooldown" : "circuit-open";
      return this.repository.finalizeScrapeRun(run.id, "skipped", 0, 0, diagnosticCode, message, message);
    }

    if (!company.sourceIdentifier) {
      const message = "No source identifier could be derived from this URL.";
      await this.repository.setCompanyRunState(companyId, "unsupported", startedAt, message);
      return this.repository.finalizeScrapeRun(run.id, "unsupported", 0, 0, "unsupported-source", message, message);
    }

    if (!canRunSourceType(company.sourceType)) {
      const message = `${profile.label} was detected, but no reliable extraction path is available yet.`;
      await this.repository.setCompanyRunState(companyId, "unsupported", startedAt, message);
      return this.repository.finalizeScrapeRun(run.id, "unsupported", 0, 0, "unsupported-source", message, message);
    }

    if (profile.extractionMode === "browser" && !this.browserPageLoader) {
      const message = "Browser-backed extraction is not available in this environment.";
      await this.repository.setCompanyRunState(companyId, "unsupported", startedAt, message);
      return this.repository.finalizeScrapeRun(run.id, "unsupported", 0, 0, "browser-unavailable", message, message);
    }

    try {
      const adapter = scraperAdapters[company.sourceType as keyof typeof scraperAdapters];
      if (!adapter) {
        throw new Error(`${profile.label} does not have a configured scraper adapter.`);
      }

      const scrapedJobs = await adapter.scrape(company.sourceIdentifier, {
        fetchImpl: this.fetchImpl,
        userAgent: settings.userAgent,
        timeoutMs: settings.scrapeTimeoutMs,
        retryCount: settings.retryCount,
        loadPageHtml: this.browserPageLoader
          ? (url) =>
              this.browserPageLoader!(url, {
                timeoutMs: settings.scrapeTimeoutMs,
                userAgent: settings.userAgent,
              })
          : undefined,
      });

      const filters = await this.repository.listFilters();
      const relevantFilters = filters.filter(
        (filter) => !filter.companyId || filter.companyId === company.id,
      );

      let matchedCount = 0;
      for (const scrapedJob of scrapedJobs) {
        const matchedFilterCount = relevantFilters.filter((filter) =>
          matchesFilter(scrapedJob, filter),
        ).length;

        if (matchedFilterCount > 0) {
          matchedCount += 1;
        }

        await this.repository.upsertJob({
          companyId: company.id,
          sourceJobId: scrapedJob.sourceJobId,
          sourceType: scrapedJob.sourceType,
          title: scrapedJob.title,
          location: scrapedJob.location,
          employmentType: scrapedJob.employmentType,
          url: scrapedJob.url,
          descriptionSnippet: scrapedJob.descriptionSnippet,
          descriptionText: scrapedJob.descriptionText,
          sourceCompleteness: scrapedJob.sourceCompleteness,
          extractionVersion: scrapedJob.extractionVersion,
          salaryMin: scrapedJob.salaryMin,
          salaryMax: scrapedJob.salaryMax,
          salaryCurrency: scrapedJob.salaryCurrency,
          salaryText: scrapedJob.salaryText,
          postDate: scrapedJob.postDate,
          lastSeenAt: new Date().toISOString(),
          matchedFilterCount,
        });
      }

      await this.repository.deactivateMissingJobs(
        company.id,
        scrapedJobs.map((job: ScrapedJob) => job.sourceJobId),
      );

      await this.repository.resetFailures(company.id);
      await this.repository.setCompanyRunState(company.id, "success", startedAt, null);
      const diagnosticCode = scrapedJobs.length > 0 ? "success-with-results" : "success-empty";
      const diagnosticMessage = scrapedJobs.length > 0
        ? `Source retrieved successfully; ${scrapedJobs.length} job${scrapedJobs.length === 1 ? "" : "s"} collected.`
        : "Source retrieved successfully and returned zero jobs. This is different from an extraction or retrieval failure.";
      return this.repository.finalizeScrapeRun(
        run.id,
        "success",
        scrapedJobs.length,
        matchedCount,
        diagnosticCode,
        diagnosticMessage,
        null,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown scrape failure";
      const diagnostic = classifySourceFailure(error);
      await this.repository.incrementFailures(company.id);
      const updated = await this.repository.getCompanyById(company.id);
      if (updated && shouldOpenCircuit(updated.consecutiveFailures, settings.circuitBreakerThreshold)) {
        const openUntil = calculateCircuitOpenUntil(settings.circuitBreakerCooldownMinutes);
        await this.repository.openCircuit(company.id, openUntil);
      }
      await this.repository.setCompanyRunState(company.id, "failure", startedAt, diagnostic.message);
      return this.repository.finalizeScrapeRun(
        run.id, "failure", 0, 0, diagnostic.code, diagnostic.message, message,
      );
    }
  }
}


