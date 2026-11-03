# Career Evidence Persistence Contract

**Status:** R0 implementation contract  
**Program:** #59 Career Evidence and Resume Intelligence  
**Slice:** #60 Durable Career Intelligence persistence and Career Evidence contract freeze

## Purpose

This document freezes the persistence and authority boundary required before Sojourner begins resume import.

Sojourner must not create a second temporary career-data store for imported resumes. Career Profile preferences, Applications, future Career Evidence, source artifacts, resume projections, and exported artifacts all live behind the trusted desktop backend boundary.

## Authority model

Sojourner owns three related but distinct domains:

- **Career Profile** owns user intent and preferences such as target roles, geography, compensation, commute, and work preferences.
- **Career Evidence** owns factual career history and provenance.
- **Applications** own the job-search lifecycle and link jobs to the exact materials and milestones used during the process.

A parser result is not truth. An inference result is not truth. A rendered resume is not truth.

Confirmed/user-authored Career Evidence is the factual authority for generated application claims.

## Durable storage boundary

All three domains are backend-owned and SQLite-backed.

```text
React renderer
    │
    │ typed preload / IPC
    ▼
CareerBackend
    │
    ├── CareerRepository
    │       │
    │       ▼
    │   sojourner.sqlite3
    │
    └── managed artifact directory
            data/artifacts/
```

The renderer does not directly read or write SQLite or arbitrary files.

## v1.1 localStorage migration

v1.1.x stored Career Profile and Applications in renderer `localStorage` under:

- `sojourner.career-profile.v1`
- `sojourner.applications.v1`

The R0 upgrade bridge follows this order:

1. renderer reads the legacy keys;
2. legacy profile shape is normalized to current Career Profile v2;
3. renderer sends the migration payload through typed IPC;
4. backend validates the payload as untrusted input;
5. backend imports the profile only when no durable profile already exists;
6. backend inserts applications idempotently;
7. renderer removes legacy keys only after the backend confirms success.

If import fails, the legacy keys remain available for retry.

A legacy payload must never overwrite a newer durable Career Profile.

## Managed artifact directory

Large source/generated files do not belong in SQLite blobs.

The canonical managed directory is:

```text
<userData>/data/artifacts/
```

Future artifact implementations must:

- copy/import files into a Sojourner-controlled location before interpretation;
- use generated safe internal filenames rather than trusting user-provided paths;
- retain the original display filename separately as metadata;
- calculate a content hash before normalization;
- prevent path traversal;
- never execute document macros or embedded code;
- never automatically open embedded links;
- keep source artifacts immutable after import;
- create new artifacts/versions rather than rewriting historical outputs in place.

The current R0 backend creates this directory. File import begins in R1.

## Career Evidence contracts

The shared TypeScript contracts are canonical application contracts for the R0 boundary:

- `SourceArtifact`
- `ExtractionSnapshot`
- `CandidateEvidence`
- `EvidenceSourceLink`
- `JobRequirement`
- `RequirementEvidenceMap`
- `ResumeProjection`
- `ResumeStatement`
- `ResumeArtifact`
- `ApplicationArtifactLink`

The SQLite migration creates corresponding durable tables so later slices evolve an existing governed schema rather than inventing storage ad hoc.

R0 freezes semantic ownership, identifiers, provenance, and authority rules. Later slices may add columns/indexes through explicit migrations when implementation evidence requires them.

## Provenance invariant

Every factual generated resume statement must be supportable by confirmed/user-authored Career Evidence.

The baseline deterministic rule is:

```text
user-confirmed evidence  -> may support factual claim
user-authored evidence   -> may support factual claim
imported evidence         -> cannot support factual claim until confirmed
inferred-pending evidence -> cannot support factual claim until confirmed
rejected evidence         -> cannot support factual claim
missing evidence          -> cannot support factual claim
```

This invariant remains blocking even when optional inference is introduced later.

## Application snapshot rule

When a user tracks a currently collected job, the backend derives the application snapshot from Sojourner's own job/company records rather than accepting title/company/URL as renderer authority.

Applications preserve the snapshot fields needed to remain useful even if the source job is later deactivated or removed.

Legacy applications are imported as historical snapshots because their source job may no longer exist.

## Inference and privacy boundary

R0 does not implement an inference provider.

Future remote inference must satisfy all of the following before personal career data leaves the machine:

1. the user intentionally invokes or enables the capability;
2. Sojourner identifies the provider/data boundary;
3. the user is told what career data will be transmitted;
4. the provider receives the minimum material required for the requested operation;
5. returned factual claims remain proposals until evidence-linked and validated;
6. deterministic Sojourner functionality remains available when no provider is configured.

The same disclosure rule applies to future hosted OCR.

## Synthetic benchmark corpus

`tests/fixtures/career-evidence/benchmark-corpus.json` is the initial occupation-diverse, non-personal benchmark corpus.

It deliberately includes software, skilled trades, licensed healthcare, retail/service management, logistics, administration/operations, recent graduate, career change, senior leadership, academic, and federal contexts.

The corpus exists to catch architecture that accidentally assumes one profession, one resume shape, or one kind of evidence.

## Migration governance

Career schemas evolve only through numbered migrations.

R0 adds:

- migration 3: Career Profile and Applications persistence;
- migration 4: Career Evidence contract tables.

A migration is complete only when a clean database and an already-migrated database both initialize successfully and persistence survives backend restart.

## R0 completion evidence

The R0 test gate must prove at minimum:

- migrations 3 and 4 apply;
- Career Profile saves and reloads after restart;
- Applications save/update/reload after restart;
- application creation uses authoritative job/company data;
- legacy migration is idempotent and does not overwrite an existing durable profile;
- managed artifact directory exists;
- all Career Evidence tables exist;
- unconfirmed/imported evidence cannot support factual generated claims.
