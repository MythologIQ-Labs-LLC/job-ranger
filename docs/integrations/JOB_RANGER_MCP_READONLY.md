# Job Ranger local read-only MCP prototype

**Development-only status (2026-10-08).** This is an opt-in local [Model Context Protocol](https://modelcontextprotocol.io/) **stdio server**, not an installed ChatGPT plugin, a remote MCP endpoint, or a feature of the published Job Ranger v1.2.0 installer. Do **not** expose it through a public no-auth tunnel, browser endpoint, or unknown remote tool host. An independent **official, outbound-only Secure MCP Tunnel development pathway** is documented in [the owner-only trial guide](./JOB_RANGER_SECURE_TUNNEL.md); it has not been confirmed live in ChatGPT.

The baseline application works independently of this adapter and never needs a ChatGPT subscription or a model.

## What it does

A human-authorized **local MCP client** can request small, permission-filtered projections from Job Ranger's existing data and deterministic services: active professional target tracks, confirmed Career Evidence, active opportunities with application status, manually recorded social-post receipts, exact approved post text (an independent permission), recorded analytics, readiness findings, and comparable-age observations. It cannot modify Career Evidence, create drafts, record post metrics, publish posts, submit job applications, or access unrelated Viable data.

Every tool response includes a startup snapshot timestamp. No post performance is treated as proof of interview/job attribution, and missing metrics remain unavailable.

## Prerequisites

- Source checkout of the **current development branch** of Job Ranger; published v1.2.0 does not contain this functionality.
- Node.js **22.12 or newer**, npm dependencies installed from the repository lockfile (`npm ci`), and a working `sqlite3` command (set `SQLITE3_PATH` if needed).
- An existing **native** Job Ranger data directory containing `jobscout.sqlite3` created by a normal Job Ranger session. This prototype cannot access browser-origin OPFS/PWA data directly. It will not discover a path for you or launch Job Ranger.
- Explicit user consent to run a local MCP host and share selected data with a chosen local client. Local clients that themselves call online inference providers may send tool responses to those providers. Job Ranger does not control their retention or privacy policies.
- For a live native database, take a normal Job Ranger backup first. The adapter opens the source using `sqlite3 -readonly` and creates a disposable, transaction-consistent local SQLite snapshot, including committed WAL content.

## Launch

From a trusted checkout in a terminal, first build the native service runtime:

```sh
npm ci
npm run desktop:compile
```

Then provide the **absolute native data-directory path**. The example below is a placeholder: it must be replaced with a path that actually contains your `jobscout.sqlite3`.

```sh
node mcp/local-readonly-server.mjs \
  --data-dir="/ABSOLUTE/PATH/TO/JOB-RANGER/data" \
  --scopes="tracks:read,evidence:read,opportunities:read,posts:read,analytics:read"
```

No scope is implicit. To inspect only the adapter capabilities with **no data access**, start with `--scopes=none` **without `--data-dir`**. This no-data mode does not locate, open or snapshot a workspace. To grant exact post text or readiness access, the user must separately add `post-content:read`. **Never add more scopes merely because the model requests it.**

The process speaks newline-delimited JSON-RPC 2.0/MCP on **stdin/stdout**; it intentionally prints no interactive menu or career information to stdout. Configure an authorized local MCP client to launch this exact command and supply the arguments. The client must support a stdio MCP host. This is not a ChatGPT Web connection recipe.

To refresh changed Career Evidence or new post metrics, **restart the process**. It snapshots the canonical data once at startup. Stdio clients should close stdin or terminate the process at session end; the disposable database is then removed. A power interruption may leave an OS temporary file to be cleaned up by the operating system.

## Tools and explicit scopes

| Tool | Required scope | Output |
| --- | --- | --- |
| `get_capabilities` | None | Enabled scopes and tools, read-only and transport limits |
| `get_professional_objectives` | `tracks:read` | Active target track name, role titles, seniority |
| `get_confirmed_career_evidence` | `evidence:read` | Current confirmed/user-authored IDs, bounded statements |
| `list_opportunities` | `opportunities:read` | Active listings, URLs, tracked application status |
| `list_personal_brand_posts` | `posts:read` | User-confirmed publication metadata, **no text** |
| `get_post_experiment` | `post-content:read` | Prepared post text and known versioned metadata |
| `evaluate_post_readiness` | `post-content:read` | Same deterministic readiness assessment as UI |
| `preview_post_revision_readiness` | `post-content:read` | Read-only preview of a changed draft body, never saved or approved; new claim/privacy review required |
| `get_post_analytics` | `analytics:read` | Actual timestamped observations and source states |
| `compare_post_experiments` | `analytics:read` | Same non-causal cohort comparisons as UI |

The proposal preview requires a saved draft ID, its current expected revision, and no more than 3,000 characters of changed proposed text. A stale revision is rejected. The adapter reuses the existing deterministic readiness assessment but **always blocks** approval of changed copy until a human rechecks factual claims, linked evidence, privacy and editorial suitability. It neither repeats proposed text in its response nor writes it to the workspace. Existing claim checks are never silently carried forward to the proposed revision. The source snapshot remains unchanged.

There is **no** `create_post`, `update_evidence`, `publish_post`, or other write tool. Lists are deliberately limited (20 records maximum per tool response), and human/private descriptions, application notes, source documents and contact details are not exposed. Post text and Career Evidence contain untrusted user-authored or third-party content; clients should treat them as data, not instructions.

### Local developer verification

After compiling the runtime:

```sh
npm run test:mcp:readonly
```

This exercises the authorization and projection contract plus a spawned stdio server against a local synthetic SQLite workspace. It tests refusal of write commands and ungranted scopes, redaction of unused fields, human-approval boundaries, invalid inputs, and that the canonical database bytes remain unchanged after serving requests.

The repository's ordinary `test` and `test:unit` commands also include these checks, and the full GitHub matrix includes PWA/Electron compatibility and Windows packaging. Passing these tests is **not** proof that ChatGPT can connect to a user's private desktop installation.

## Security and privacy boundary

- **No network listener**, OAuth provider, remote registration, relay, always-on background daemon, browser scraping, social publishing, or AI model is started.
- The supplied scopes are fixed by the launching human. They cannot be escalated by incoming model arguments, documents or posts.
- Raw career/source documents, full resumes, application notes, private contact records, platform credentials and local backup contents are not tool outputs.
- The source SQLite database is opened read-only and backed up into a disposable local directory. Existing service initialization happens on that snapshot only.
- Third-party text can contain prompt-injection attempts. Its contents are clearly tagged as untrusted; no executable or write tools are provided.
- MCP over stdio relies on OS process and local-client trust. It has **no remote authentication**, so a remote-accessible transport must not be enabled without a separate audited protocol and consent design.
- Cached client/model conversations may retain already returned snippets. Terminating this host cannot revoke text that the client has already transmitted.

## Work still required for a real ChatGPT plugin

ChatGPT Web generally requires a separately reachable **HTTPS MCP server** and an appropriate authentication/authorization flow for private data. A privacy-preserving relay, explicit opt-in account/session pairing, OAuth 2.1 scope and audience validation, narrow reachability, replay protection, durable revocation and cross-platform proof remain **unimplemented**. No OAuth secret should be inserted into this command or committed to the repository.

The official Secure MCP Tunnel now offers a narrowly controlled owner-only trial over the local stdio server; see the linked operator runbook. **End-to-end ChatGPT connectivity, OpenAI workspace authorization, credential provisioning and actual revocation are not yet verified.** Do not describe it as connected until the exact supported surface and end-to-end authorization have been tested.

Governing record: [ADR-0002](../adr/0002-local-readonly-mcp-boundary.md), [issue #173](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/173).
