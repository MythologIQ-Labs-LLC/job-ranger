# ADR-0002: Local read-only MCP adapter as the first external-agent boundary

**Status:** Accepted for implementation in development; not a released or verified ChatGPT Web connector  
**Date:** 2026-10-08  
**Related:** [ChatGPT integration issue #173](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/173), [Personal Brand ADR-0001](./0001-personal-brand-publishing-and-analytics.md)

## Context

Sojourner is a standalone, local-first Career Ops application. Career Evidence,
Target Tracks, job opportunities, application records and Personal Brand posts are
owned by its deterministic application services and user-controlled database.
Connecting inference must not create a second workspace, require accounts, or
allow models to approve or mutate canonical career claims.

ChatGPT Web cannot ordinarily call a user's local database or anonymous
`localhost` service. A reachable HTTPS endpoint plus authenticated/scoped
access are separate capabilities. Implementing a read-only MCP transport
**does not establish ChatGPT app installation, compatibility, or reachability**.

## Decision

Build a **local, opt-in stdio MCP 2025-06-18 prototype**, using the same
compiled Sojourner Career, Sojourner, and Personal Brand backend service
methods already used by the application's human workflows. Keep it isolated
from both Electron user interface privileges and browser OPFS storage.

* An explicit, absolute `--data-dir` and **named `--scopes`** are required
  at process startup. The process does not auto-discover a user's workspace.
  It refuses unknown scopes and never grants additional scopes by tool input.
* SQLite `-readonly .backup` creates a transaction-consistent disposable
  local snapshot. Application services initialize **only against the copy**,
  with schedulers and network fetch disabled. They never receive the canonical
  database path for writes. Results identify the snapshot capture instant.
* Stdio is the only transport; it does not bind any TCP port or accept HTTP,
  HTTPS, inbound OAuth callbacks, background polling, or unauthenticated
  remote connections. OS process access and explicit client startup are the
  trust boundary of this *local-only prototype*. No OAuth is claimed.
* The adapter exposes only explicitly registered **read-only MCP tools**.
  Evidence must already be user-confirmed/user-authored. Tool result fields
  are allowlisted, bounded, provenance-tagged, and label user/third-party
  prose as untrusted data. No prompts from a job description, evidence
  statement, or post body are treated as instructions.
* For draft readiness and age-based Personal Brand comparisons, invoke the
  same deterministic `assessPersonalBrandDraft` and
  `buildPersonalBrandLearningReport` modules used by Sojourner.
  Human editorial approval, exact-content publication, provider access,
  career writes, and analytics imports remain inaccessible to this adapter.
* A snapshot deliberately becomes stale after startup; the user restarts
  the MCP process to refresh data. A future live session must use verified
  service/authorization boundaries rather than copying this shortcut into
  a remote persistent server.

## Scope controls

| Scope | Allowed queries | Deliberately omitted |
| --- | --- | --- |
| `tracks:read` | Active target track IDs, names, roles and seniority | Address, constraints, pay floor |
| `evidence:read` | Up to 20 current confirmed evidence IDs and short statements | Source artifacts, full resume, drafts, private documents |
| `opportunities:read` | Up to 20 active observed job titles/links and tracked status | Application notes, contacts, job description raw HTML |
| `posts:read` | Up to 20 manual publication receipts | Post body, notes and analytics |
| `post-content:read` | Exact previously prepared post, draft readiness/metadata | Editing, approval, private source artifacts |
| `analytics:read` | At most 20 snapshots/post and same-age observational comparison | Imported analytics, inferred conversions, fake zeros |

`get_capabilities` is the single tool when no scopes are authorized. Every
scope is selected at launch, not by natural-language model output.

## Threats and countermeasures

* **Prompt injection:** All user and scraped strings are untrusted tool data.
  No shell, file-write, automation, system-prompt, or outbound HTTP tool exists.
* **Unwanted disclosure:** Explicit startup permission, bounded lists,
  restricted fields, no logs of career records, snapshot lifetime, no public
  endpoint. A local client allowed to read a scope may still transmit results
  to its inference provider. Users must approve that client separately.
* **Improper writes or schema upgrades:** Copy canonical SQLite to an isolated
  temporary database with `-readonly` source access and use existing service
  reads only on the snapshot. Source-byte fingerprint regression checks protect
  against accidental canonical modification in test conditions.
* **Privilege escalation:** Tool discovery is scope filtered. Calls to
  ungranted tools are denied server-side, as are unknown mutation commands.
  No input can alter startup scopes.
* **False status claims:** Source is a captured database snapshot; publication
  receipts remain user-confirmed, observations preserve unavailable vs zero.
  An MCP-compatible local server is *not* evidence of a functioning ChatGPT
  Web app or a correctly configured OAuth/relay workflow.

## Consequences and explicit follow-on gates

1. Demonstrate the stdio server under an authorized local MCP client, with
   permission-denied, injection, snapshot-safety and service-parity tests.
2. Independently validate a supported ChatGPT custom app connection via
   **reachable HTTPS plus correctly scoped OAuth 2.1** (or a future platform
   capability), verified user consent, revocation, replay protection,
   minimal relay data retention, and shutdown/session expiration.
3. Only after end-to-end auth and read-only proof introduce any writes. These
   require explicit user authorization, expected revisions, idempotency,
   deterministic Truth Gate validation and local audit trail. No model-owned
   self-approval, bulk career-evidence mutations, or direct social publishing.

**Rejected alternatives:** exposing SQLite or an unauthenticated loopback
HTTP port; uploading the full workspace to a hosted replica by default;
creating a model-owned knowledge store; claiming this prototype is a ChatGPT
plugin installed or working on ChatGPT Web.

See [Local MCP usage and status](../integrations/SOJOURNER_MCP_READONLY.md).
