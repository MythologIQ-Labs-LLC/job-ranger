# Plan: Phase 4 - Caching & Circuit Breaker

## Open Questions

None - requirements are clear from ARCHITECTURE_PLAN.md.

---

## Phase 1: Add Circuit Breaker State to Company

### Affected Files

- `contracts.cts` - Add circuit breaker fields to Company interface
- `migrations.cts` - Add migration for new columns
- `repository.cts` - Update Company mapping and circuit breaker methods

### Changes

**contracts.cts** - Add to Company interface:

```typescript
export interface Company {
  // ... existing fields ...
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
}
```

**migrations.cts** - Add migration v3:

```typescript
{
  version: 3,
  up: `
    ALTER TABLE companies ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE companies ADD COLUMN circuit_open_until TEXT;
  `,
}
```

**repository.cts** - Update `rowToCompany`:

```typescript
consecutiveFailures: row.consecutive_failures ?? 0,
circuitOpenUntil: row.circuit_open_until ?? null,
```

Add new methods:

```typescript
async incrementFailures(companyId: string): Promise<void> {
  await this.client.execute(sql`
    UPDATE companies
    SET consecutive_failures = consecutive_failures + 1
    WHERE id = ${companyId}
  `);
}

async resetFailures(companyId: string): Promise<void> {
  await this.client.execute(sql`
    UPDATE companies
    SET consecutive_failures = 0, circuit_open_until = NULL
    WHERE id = ${companyId}
  `);
}

async openCircuit(companyId: string, until: string): Promise<void> {
  await this.client.execute(sql`
    UPDATE companies
    SET circuit_open_until = ${until}
    WHERE id = ${companyId}
  `);
}
```

### Unit Tests

- `tests/circuit-breaker.test.cjs`
  - `incrementFailures` increases counter
  - `resetFailures` clears counter and circuitOpenUntil
  - `openCircuit` sets circuitOpenUntil timestamp

---

## Phase 2: Add Caching Settings

### Affected Files

- `contracts.cts` - Add caching settings to Settings interface
- `backend.cts` - Update defaultSettings

### Changes

**contracts.cts** - Extend Settings:

```typescript
export interface Settings {
  // ... existing fields ...
  scrapeCooldownMinutes: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMinutes: number;
}
```

**backend.cts** - Update defaultSettings:

```typescript
const defaultSettings: Settings = {
  userAgent: "Sojourner Desktop/1.0",
  maxConcurrentScrapes: 2,
  scrapeTimeoutMs: 20000,
  retryCount: 1,
  scrapeCooldownMinutes: 30,
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMinutes: 60,
};
```

### Unit Tests

- No new tests needed - settings are passive data

---

## Phase 3: Implement Caching and Circuit Breaker Logic

### Affected Files

- `scrape-guard.cts` (NEW) - Caching and circuit breaker pure functions
- `backend.cts` - Integrate guards into scrape flow

### Changes

Create **scrape-guard.cts**:

```typescript
import type { Company, Settings } from "./contracts.cjs";

export interface ScrapeGuardResult {
  canScrape: boolean;
  reason: "ok" | "cooldown" | "circuit-open";
  waitUntil: string | null;
}

export function checkScrapeGuard(
  company: Company,
  settings: Settings,
  now: Date = new Date()
): ScrapeGuardResult {
  // Check circuit breaker
  if (company.circuitOpenUntil) {
    const openUntil = new Date(company.circuitOpenUntil);
    if (now < openUntil) {
      return { canScrape: false, reason: "circuit-open", waitUntil: company.circuitOpenUntil };
    }
  }

  // Check cooldown (only for successful scrapes)
  if (company.lastRunStatus === "success" && company.lastRunAt) {
    const lastRun = new Date(company.lastRunAt);
    const cooldownMs = settings.scrapeCooldownMinutes * 60 * 1000;
    const nextAllowed = new Date(lastRun.getTime() + cooldownMs);
    if (now < nextAllowed) {
      return { canScrape: false, reason: "cooldown", waitUntil: nextAllowed.toISOString() };
    }
  }

  return { canScrape: true, reason: "ok", waitUntil: null };
}

export function shouldOpenCircuit(
  consecutiveFailures: number,
  threshold: number
): boolean {
  return consecutiveFailures >= threshold;
}

export function calculateCircuitOpenUntil(
  cooldownMinutes: number,
  now: Date = new Date()
): string {
  return new Date(now.getTime() + cooldownMinutes * 60 * 1000).toISOString();
}
```

Update **backend.cts** `executeScrape` method:

```typescript
import { checkScrapeGuard, shouldOpenCircuit, calculateCircuitOpenUntil } from "./scrape-guard.cjs";

// At start of executeScrape, after getting company:
const settings = await this.getSettings();
const guard = checkScrapeGuard(company, settings);
if (!guard.canScrape) {
  const message = guard.reason === "cooldown"
    ? `Scrape skipped: cooldown until ${guard.waitUntil}`
    : `Scrape skipped: circuit open until ${guard.waitUntil}`;
  return this.repository.finalizeScrapeRun(run.id, "skipped", 0, 0, message);
}

// On success (before return):
await this.repository.resetFailures(company.id);

// On failure (in catch block):
await this.repository.incrementFailures(company.id);
const updatedCompany = await this.repository.getCompany(company.id);
if (updatedCompany && shouldOpenCircuit(
  updatedCompany.consecutiveFailures,
  settings.circuitBreakerThreshold
)) {
  const openUntil = calculateCircuitOpenUntil(settings.circuitBreakerCooldownMinutes);
  await this.repository.openCircuit(company.id, openUntil);
}
```

### Unit Tests

- `tests/scrape-guard.test.cjs`
  - `checkScrapeGuard` returns "ok" for fresh company
  - `checkScrapeGuard` returns "cooldown" when within cooldown period
  - `checkScrapeGuard` returns "circuit-open" when circuit is open
  - `checkScrapeGuard` allows scrape after cooldown expires
  - `checkScrapeGuard` allows scrape after circuit closes
  - `shouldOpenCircuit` returns true when threshold reached
  - `shouldOpenCircuit` returns false below threshold
  - `calculateCircuitOpenUntil` returns correct future timestamp

---

## Summary

| Phase | Files Changed | New Files | Lines Added |
|-------|---------------|-----------|-------------|
| 1 | contracts.cts, migrations.cts, repository.cts | 0 | ~35 |
| 2 | contracts.cts, backend.cts | 0 | ~10 |
| 3 | backend.cts | scrape-guard.cts (~45) | ~65 |

**Total estimated**: ~110 lines across 5 files

All functions remain under 40 lines. No new dependencies.
