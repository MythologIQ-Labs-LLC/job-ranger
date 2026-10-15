# Job Ranger repository instructions for coding agents

**Audience:** AI coding agents, automation, and engineering assistants working in this repository. The root `README.md` is deliberately written for people evaluating or using Job Ranger. It is **not** your engineering entry point.

## Required preflight before proposing, changing, reviewing, or merging implementation

1. Read [`README.developer.md`](./README.developer.md) in full for the developer reference and command map.
2. Read [`docs/README.md`](./docs/README.md) for document authority and current contracts.
3. Read [`GOVERNANCE.md`](./GOVERNANCE.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`SECURITY.md`](./SECURITY.md), as relevant to your task.
4. Check [`docs/SYSTEM_STATE.md`](./docs/SYSTEM_STATE.md), relevant source, latest issue/PR state and validation evidence before making release or feature claims.
5. For PWA, Store or deployment changes, read [`docs/design/DISTRIBUTION_ARCHITECTURE.md`](./docs/design/DISTRIBUTION_ARCHITECTURE.md), [`docs/design/PWA_RUNTIME.md`](./docs/design/PWA_RUNTIME.md) and [`docs/DISTRIBUTION_TRUST.md`](./docs/DISTRIBUTION_TRUST.md).

## Non-negotiable development boundaries

- **Authority:** Career Evidence is factual authority only when user-confirmed or user-authored. Target Tracks and aspirations are intent, not factual employment evidence. Do not let inference, imports or agents silently approve career claims.
- **Deterministic-first:** maintain a useful local core independent of remote AI, hosted accounts and future subscriptions.
- **Consent:** no automated applications, unsolicited posting, third-party credentials or collection of private data without the explicit governed user-approved path.
- **Web versus native:** do not claim that a PWA can bypass browser CORS or perform reliable closed-browser monitoring; do not relabel planned remote monitoring or provider connectors as implemented.
- **Canonical data:** the browser's OPFS is origin-scoped. Do not silently move data between origins, centralize career records, change migrations or weaken portable-backup checks.
- **Status claims:** distinguish published, implemented, validated candidate, planned and deferred. Do not describe the Microsoft Store app, public PWA, hosted monitoring, SaaS pricing or ChatGPT plugin as live without evidence.
- **Release and spend controls:** GitHub Actions budget is constrained. Prefer local checks, small isolated commits, and review before creating PRs or touching CI. A successful local check is not a hosted CI pass. Do not deploy, publish, merge, or change paid services without current explicit authority.
- **Source validation:** record exact code and tests examined. Do not treat past plans, marketing copy or a passing pipeline as proof of production behavior.

If these instructions conflict with a specific human owner's current instruction, clarify authority and preserve higher-priority safety and data-integrity boundaries. Do not resolve discrepancies by silently weakening governance.
