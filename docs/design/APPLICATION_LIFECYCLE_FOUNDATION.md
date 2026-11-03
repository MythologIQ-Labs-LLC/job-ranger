# Application lifecycle foundation

Issue: #65

## Purpose

Sojourner already owns tracked applications and exact resume artifact links. This R5 foundation makes that lifecycle usable without turning Applications into a generic CRM or task manager.

The bounded lifecycle model adds three application-specific concerns:

1. **People**: recruiters, hiring managers, interviewers, or other contacts attached to one application.
2. **Events**: interviews, follow-ups, deadlines, offer milestones, and other meaningful application events.
3. **Reminders**: an optional reminder timestamp attached to an application event. Reminders are native Sojourner state, not a generic workflow engine.

Exact submitted resume history remains owned by the existing `application_artifact_links` authority and is surfaced read-only through the lifecycle view.

## Authority boundaries

- Career Evidence remains factual career truth.
- Applications remain the job-search lifecycle authority.
- Resume artifacts remain immutable/versioned application materials.
- Lifecycle contacts and events describe what happened around an application; they do not become Career Evidence.
- A reminder never silently changes application status or Career Evidence.
- Deleting an application cascades its contacts, events, reminders, and artifact links.

## Persistence

The lifecycle subsystem uses the existing SQLite database and `schema_migrations` ledger. Its bounded schema migration is registered as version `1001` to avoid colliding with the sequential core migration stream while remaining idempotent and auditable.

Tables:

- `application_contacts`
- `application_events`

The existing `application_artifact_links` + `resume_artifacts` tables provide exact submitted-file history. No duplicate artifact store is introduced.

## Event semantics

Supported event kinds:

- follow-up
- interview
- deadline
- offer
- other

Each event has:

- event timestamp;
- optional reminder timestamp;
- optional completion timestamp;
- notes.

A reminder cannot occur after its event. Completion is explicit and reversible.

## UX rule

Applications stays compact by default. Lifecycle details are progressively disclosed per application so a user can track the process without every application card becoming a miniature CRM dashboard.

## Validation

Repository health covers:

- IPC validation;
- migration registration;
- contact/event/reminder persistence across restart;
- exact submitted-artifact history;
- reminder timing invariants;
- lifecycle cascade cleanup when an application is deleted.

Electron E2E covers the ordinary Applications workflow for submitted artifact visibility, adding a contact, adding an interview reminder, reload persistence, and event completion.

## Not in this tranche

This foundation intentionally does not yet implement:

- cover letters or additional application-material projections;
- interview-preparation generation;
- reusable Career Stories;
- offer/negotiation detail models beyond an event milestone;
- repeated-gap analytics;
- search outcome analytics/strategy feedback;
- backup/restore or JSON Resume interoperability.

Those R5 capabilities should build on this lifecycle state rather than inventing parallel records.
