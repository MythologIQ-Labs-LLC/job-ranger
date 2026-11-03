# Functional Design: Career Evidence and Resume Intelligence

**Status:** Accepted implementation architecture for the next Sojourner product program  
**Date:** 2026-09-24  
**Scope:** Candidate evidence, resume import, tailoring, review, rendering, and application linkage.

## 1. Product decision

Sojourner will not implement a document-first "resume builder" as the architectural center of this phase.

The product will implement a **Career Evidence domain**. Resumes are versioned projections of that evidence for a particular purpose and opportunity.

The durable model is:

```text
Source Artifact
      ↓
Candidate Evidence
      ↓
Target Requirements ↔ Evidence Mapping
      ↓
Resume Projection
      ↓
Truth / Parseability / Relevance Review
      ↓
Resume Artifact
      ↓
Application
```

This architecture is occupation-agnostic, inference-optional, and independent of any one parser, template language, LLM, or external career tool.

The product-wide Technical Capability Catalog reconciliation in `../research/SOJOURNER_CAPABILITY_CATALOG_RECONCILIATION.md` is controlling context for external-tool selection. Sojourner keeps a native vertical core and adopts external capabilities only at narrow replaceable seams.

## 2. Functional goals

A user should be able to:

1. import an existing resume without losing the original;
2. review what Sojourner believes the resume says;
3. correct ambiguous or wrong interpretations;
4. accumulate verified career evidence over time;
5. create a resume from verified evidence even when no AI provider is configured;
6. tailor a resume to a tracked job without inventing qualifications;
7. see which job requirements have direct evidence, transferable evidence, uncertainty, or no support;
8. export an ATS-safe PDF;
9. know which exact resume version was used for an application;
10. later use that same evidence and sent-resume version for interview preparation and follow-up.

## 3. Selected architecture, not a tool collection

The QOR and Technical Capability Catalog research surfaced multiple overlapping tools. The design intentionally narrows them.

### Selected for implementation evaluation

**Resume/document import:** `firecrawl/anydoc` is the preferred R1 candidate, subject to a bounded parser benchmark before dependency adoption.

Reasons:

- MIT license;
- first-party Node binding fits Electron directly;
- local deterministic conversion;
- DOC/DOCX and text-PDF support in one adapter;
- content-based format detection;
- explicit `NeedsOcr`, `Encrypted`, `Malformed`, and resource-limit failure classes;
- no model or cloud service required for ordinary imports.

### Selected as native Sojourner behavior

- candidate evidence model;
- source provenance and verification state;
- requirement-to-evidence mapping;
- truthful tailoring rules;
- ATS/parseability audit;
- application-scoped resume versioning;
- reviewer/relevance audit contract;
- Career Profile synchronization;
- application linkage.

Career-Ops informs several of these mechanisms, but no Career-Ops runtime will be embedded.

### Selected rendering strategy for the first release

Use **Sojourner's existing Electron/Chromium runtime** to render ATS-safe HTML/CSS into PDF through a hidden isolated rendering window and Electron PDF printing.

Reasons:

- no second document-rendering runtime;
- Chromium already ships with the application;
- selectable text;
- CSS control for Letter/A4 and print styles;
- simple renderer isolation;
- lower packaging burden than adding Typst immediately.

The renderer contract stays abstract so Typst or another engine can be adopted later if benchmarking demonstrates a material advantage.

### Selected output verification strategy

If `anydoc` passes the R1 benchmark, use the same parser to re-read generated PDFs and compare the extracted content/order with the intended resume projection.

This consolidates two capabilities:

- input normalization;
- generated-PDF parseability verification.

LiteParse remains a benchmark/fallback candidate only if the default parser cannot adequately validate PDF reading order.

### Reference only

- EasyPeasyCV: editing/local-state UX patterns.
- Tailit: schema-validation, truthful transformation, adapter architecture, JSON Resume interoperability patterns.
- Docling: advanced parser benchmark.
- MarkItDown: parser benchmark/fallback comparison.
- PaddleOCR: later OCR evaluation.

### Explicitly not selected

- a general-purpose agent framework;
- a cloud resume service;
- hosted OCR by default;
- a separate Python document-processing sidecar for the first implementation;
- a second canonical resume schema such as JSON Resume;
- a large third-party template pack;
- a proprietary ATS score;
- autonomous application submission.

### Dependency consolidation rule

A second parser, renderer, model runtime, or external service is not added merely because it covers a neighboring capability. It must close a benchmarked product gap that the selected/native path cannot meet at acceptable quality.

In practical terms:

- `anydoc` should handle import and, if its benchmark permits, generated-PDF verification;
- Electron/Chromium should handle initial PDF rendering;
- Sojourner should own evidence/mapping/artifact state;
- Career-Ops, Tailit, and EasyPeasyCV remain mechanism donors rather than embedded products;
- OCR, DOCX output, richer parser fallback, and external research remain separately justified later capabilities.

## 4. Domain model

The following names describe bounded domain objects, not final SQL column definitions.

### 4.1 SourceArtifact

Represents an original user-provided source.

```text
SourceArtifact
  id
  kind                 resume | certificate | transcript | note | other
  originalName
  mediaType
  detectedFormat
  contentHash
  filePath
  byteSize
  importedAt
  parserId
  parserVersion
  extractionState
  warnings[]
```

Rules:

- preserve the original before interpreting it;
- store content by managed application path, not an arbitrary user path that may disappear;
- use a content hash for duplicate detection and provenance;
- do not rewrite the original source in place.

Large original files should remain managed files in Sojourner's data directory. SQLite stores metadata and relationships rather than becoming an accidental blob warehouse.

### 4.2 ExtractionSnapshot

Records what a parser returned for one artifact.

```text
ExtractionSnapshot
  id
  sourceArtifactId
  parserId
  parserVersion
  rawText
  structuredPayload
  createdAt
  warnings[]
```

This allows parsing to be rerun later without pretending that a new parser result was always the original interpretation.

### 4.3 CandidateEvidence

The canonical durable career fact/evidence object.

```text
CandidateEvidence
  id
  evidenceType
  subjectType           role | skill | credential | education | project | achievement | publication | other
  organization
  titleOrName
  startDate
  endDate
  statement
  action
  context
  skills[]
  methodsOrTools[]
  scope[]
  outcomes[]
  metrics[]
  verificationState     imported | user-confirmed | user-authored | inferred-pending | rejected
  confidence
  createdAt
  updatedAt
```

Evidence is not required to populate every analytical field. A simple confirmed fact is valid evidence.

### 4.4 EvidenceSourceLink

Links normalized evidence back to source material.

```text
EvidenceSourceLink
  evidenceId
  sourceArtifactId
  extractionSnapshotId
  sourceLocator
  sourceText
  relation               extracted | supports | contradicts | supersedes
```

The source locator may be a page number, extracted block index, paragraph/bullet index, or other parser-specific location.

### 4.5 JobRequirement

Normalized requirement extracted from a Sojourner job record.

```text
JobRequirement
  id
  jobId
  kind                   must-have | preferred | responsibility | credential | logistics
  text
  normalizedTerm
  importance
  sourceText
```

Deterministic extraction can start with explicit sections/terms. Optional inference may enrich this later.

### 4.6 RequirementEvidenceMap

The key truth boundary between a role and the candidate.

```text
RequirementEvidenceMap
  jobRequirementId
  evidenceId?
  classification         direct | transferable | ambiguous | gap
  explanation
  createdBy              deterministic | inference | user
  userConfirmed
```

A `gap` cannot silently become resume content.

### 4.7 ResumeProjection

A structured selection/ordering of evidence for one purpose.

```text
ResumeProjection
  id
  candidateProfileId
  jobId?
  context                private-sector | hybrid | federal | academic
  pageFormat             letter | a4
  sourceProjectionId?
  status                 draft | reviewed | finalized
  sections[]
  selectedEvidenceIds[]
  createdAt
  updatedAt
```

The projection stores structured content intent. It is not HTML/PDF.

### 4.8 ResumeStatement

Represents text derived from one or more evidence records.

```text
ResumeStatement
  id
  projectionId
  section
  order
  text
  evidenceIds[]
  generationMode         deterministic | assisted | user-authored
  userEdited
```

Hard invariant:

> Every factual resume statement must reference supporting evidence or be explicitly user-authored and confirmed before finalization.

### 4.9 ResumeArtifact

Represents an exported file.

```text
ResumeArtifact
  id
  projectionId
  version
  format                 pdf | html | future-docx
  filePath
  contentHash
  pageCount
  truthGateResult
  parseabilityResult
  relevanceReviewResult?
  createdAt
```

### 4.10 ApplicationArtifactLink

Links the exact sent document to an application.

```text
ApplicationArtifactLink
  applicationId
  resumeArtifactId
  purpose                submitted | recruiter-copy | interview-copy | other
  recordedAt
```

This allows later interview prep to reason from the resume that was actually sent.

## 5. Persistence architecture

The Career Evidence domain belongs behind the desktop backend and SQLite boundary.

It should **not** be renderer-local.

The resume phase should therefore be sequenced after, or deliberately combined with, the planned migration of Career Profile and Applications into the backend.

Recommended ownership:

```text
React renderer
    │
    │ typed IPC
    ▼
CareerEvidenceService
    ├── ArtifactRepository
    ├── EvidenceRepository
    ├── RequirementRepository
    ├── ResumeRepository
    └── ApplicationRepository
          │
          ▼
        SQLite
          +
managed artifact directory
```

The service boundary allows parsing/rendering engines to be swapped without exposing their representation to the UI.

## 6. Import flow

### 6.1 First implementation formats

Support:

- DOCX;
- text-bearing PDF;
- plain text;
- pasted text.

Do not make scanned/image-only documents a hidden degraded path.

### 6.2 Flow

```text
User selects file
   ↓
size/type precheck
   ↓
copy to managed artifact storage
   ↓
SHA-256 hash + SourceArtifact record
   ↓
ImportAdapter.parse()
   ↓
ExtractionSnapshot
   ↓
normalizer proposes CandidateEvidence
   ↓
confidence classification
   ↓
user confirmation screen
   ↓
confirmed evidence persisted
   ↓
Career Profile derived/updated
```

### 6.3 Import states

The UI must distinguish:

- imported successfully;
- imported with review required;
- OCR required;
- password/encryption blocked;
- malformed/unsupported;
- resource/safety limit exceeded;
- parser failure.

"Upload failed" is not an acceptable universal diagnostic.

### 6.4 OCR boundary

R1 does not automatically send any resume to a hosted OCR service.

If the parser reports `NeedsOcr`:

- preserve the source;
- display that text could not be read locally;
- allow manual/pasted text as fallback;
- defer OCR capability until a separate evaluated implementation slice.

## 7. Candidate evidence review UX

The first import experience should be conversational in spirit but deterministic in authority.

Recommended UI buckets:

- **Looks good** — high-confidence extracted facts;
- **Please check** — ambiguous dates, title/employer association, metrics, or section mapping;
- **Not imported** — unsupported or unreadable content.

The user can:

- confirm;
- edit;
- reject;
- merge duplicate evidence;
- mark a fact as no longer current without deleting provenance.

A parser result does not become truth merely because its confidence is high.

## 8. Career Profile relationship

Career Profile becomes a user-friendly projection of the broader evidence store rather than a separate island of truth.

Examples:

- target roles/preferences remain profile-owned preferences;
- confirmed certifications can be derived from evidence;
- confirmed skills can be surfaced from evidence;
- role history can be derived from evidence;
- compensation/location preferences remain profile preferences, not evidence.

The user must always be able to edit profile preferences directly.

## 9. Resume creation without inference

Sojourner must be able to produce a useful resume with no configured AI provider.

Deterministic creation should support:

- choosing a document context;
- selecting relevant roles/evidence;
- reverse-chronological ordering;
- section inclusion/omission rules;
- simple evidence statement templates;
- user editing;
- ATS-safe rendering;
- truth and parseability checks.

This establishes a fully usable base product.

## 10. Optional inference role

Inference may assist with:

- mapping semantically equivalent experience to job requirements;
- proposing adjacent/transferable evidence;
- rewriting confirmed facts into concise resume language;
- identifying buried evidence;
- suggesting section ordering;
- optional hiring-manager/relevance review.

Inference may not:

- create employers, dates, credentials, metrics, tools, ownership, or outcomes unsupported by evidence;
- convert a gap into a supported requirement;
- silently send career data to a remote provider;
- overwrite source evidence.

All inference outputs are structured proposals that must pass runtime validation and evidence linking.

## 11. Tailoring flow

```text
Tracked job
   ↓
normalize requirements
   ↓
map requirements to evidence
   ├── direct
   ├── transferable
   ├── ambiguous → ask
   └── gap
   ↓
select strongest supported evidence
   ↓
create ResumeProjection
   ↓
write/rewrite ResumeStatements
   ↓
Truth Gate
   ↓
Render
   ↓
Parseability Gate
   ↓
Optional Relevance Review
   ↓
User finalizes
   ↓
ResumeArtifact linked to Application
```

The user sees gaps before finalization.

## 12. Three distinct review systems

### 12.1 Truth Gate — blocking

Question:

> Is every factual claim supported by confirmed evidence?

Checks:

- every generated factual statement has evidence IDs;
- source evidence is not rejected;
- dates/metrics/credentials exist in evidence;
- assisted language does not introduce unsupported named skills or outcomes;
- user-authored additions require explicit confirmation.

A failure blocks finalization.

#### 12.1.1 Unsupported-edit check across scripts

For a user-edited statement, every content-bearing term of the edited text must
appear in the linked Career Evidence (statement, organization, title, skills,
methods/tools, scope, outcomes, metrics). Terms are produced by a script-aware
tokenizer (`electron/src/truth-gate-tokens.cts`, built on the shared script
classification in `electron/src/text-tokens.cts`; the Parseability Gate uses its own `parseability-text.cts`) after NFKC normalization and
lowercasing, so full-width forms and composed/decomposed characters compare
equal. Single letters are ignored in alphabetic scripts (Han is checked per
character by design; Hangul stems and Thai-family segments have no length
filter), but single digits (ASCII or any other decimal digit) are always terms, so changing "5 engineers" to
"9 engineers" is flagged. Before this, one-character tokens were dropped, so
single-digit changes passed. Numbers are compared literally: "5" in an edit
is not supported by "five" in evidence, and vice versa.

| Text | Term | Match against evidence |
| --- | --- | --- |
| Pure-ASCII word | legacy token (`[a-z0-9+#.-]`, edge `.`/`-` trimmed, length > 1 or a single digit, English stoplist) | exact |
| Other alphabetic word (accented Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, …) | whole word, split on `.`/`-`, length > 1, small per-language function-word stoplist | exact; Latin/Greek/Cyrillic also accent-folded; Arabic/Hebrew also with attached proclitics (و/ال/ب…, ו/ה/ב…) removed |
| Han (Chinese, Japanese kanji) | each character, minus grammatical characters (的, 了, 和, 与, 在, 是 …) | character occurs in evidence |
| Hiragana | ignored (particles, okurigana) | — |
| Katakana | whole run (`・` removed) | substring of evidence |
| Hangul | word with attached particles/endings (은/는, 을/를, 에서, 했습니다 …) stripped | stem is a substring of evidence |
| Thai, Lao, Khmer, Myanmar | `Intl.Segmenter` word segments, Thai function-word stoplist | substring of evidence |

Trade-off: the check is aimed at new *content-bearing* material — new Han
characters, words, loanwords, Latin terms (certification acronyms, tools),
non-ASCII numbers — while tolerating particles, word order changes, and
conjugation in languages without stable word boundaries. It cannot detect a new
claim assembled only from characters or words that already appear in the
evidence (for example recombining existing Han characters), and fully
hiragana-written content words are not checked. English behaviour is identical
to the previous ASCII tokenizer except that single digits are now terms. Function words in languages that are written in
plain ASCII (Spanish `de`, German `und`, …) are not stoplisted, to avoid
changing English behaviour; they normally appear in same-language evidence.
Inflection differences in alphabetic languages (`managed` vs `manage`,
`руководил` vs `руководство`) are flagged, as before for English.

### 12.2 Parseability Gate — blocking on critical failures, advisory otherwise

Checks the exported artifact rather than merely trusting the source template.

Initial checks:

- PDF contains extractable text;
- contact block is extractable;
- expected section text exists;
- reading order is materially consistent with projection order;
- no hidden/white-font keyword content;
- no critical evidence disappears during rendering;
- page count is within context guidance;
- generated file can be re-parsed successfully.

If `anydoc` is adopted, re-parse the PDF through the same import engine and compare normalized output to the projection.

Implemented text comparison (`electron/src/parseability-text.cts`, shared by both runtimes):

- Tokens are Unicode letters, marks, and digits (NFKC, lower case), so accented Latin, Greek, Cyrillic, Hangul, and other spaced scripts are verified word by word. For ASCII text the tokens are identical to the original `[a-z0-9+#.-]` tokenizer.
- Chinese, Japanese, Thai, Lao, Khmer, and Myanmar are compared one grapheme at a time, because line wrapping may break anywhere inside them.
- Right-to-left and Indic scripts are not used for coverage. PDF text extraction of shaped and bidirectional text differs between parsers: Chromium PDFs parsed by Anydoc returned Hebrew in visual order and reordered Arabic letters. Such content raises an advisory `unverified-script` issue asking the user to check the PDF, instead of a critical failure or silent acceptance.

### 12.3 Relevance Review — advisory

Question:

> Does this truthful, parseable resume make the strongest case for this target?

Deterministic checks can cover:

- strongest target evidence appears early;
- explicit must-have requirements with evidence are visible;
- unsupported requirements are not implied;
- duplicate/low-value statements are minimized.

Optional inference can add a grounded reviewer audit later.

## 13. Rendering

### 13.1 Initial renderer

Use a dedicated hidden `BrowserWindow` with:

- `sandbox: true`;
- `nodeIntegration: false`;
- `contextIsolation: true`;
- no external navigation;
- no remote resources;
- locally packaged fonts/assets only.

Render a structured resume projection into Sojourner-owned HTML/CSS and export with Electron PDF printing.

### 13.2 Template system

Templates are lightweight Sojourner-owned adapters:

```text
ResumeProjection
    ↓
TemplateAdapter
    ↓
render model
    ↓
HTML/CSS
    ↓
PDF
```

Initial templates should be few and intentional:

1. ATS-safe standard;
2. ATS-safe compact;
3. human-polished conservative.

Do not ship dozens of templates simply because another project has dozens of templates.

### 13.3 Template licensing

Every imported third-party template requires individual license review. A host project's MIT license does not relicense bundled third-party templates/fonts.

Prefer Sojourner-owned templates for the initial release.

## 14. JSON Resume interoperability

JSON Resume is useful as an interchange format because ecosystem tools already support it.

It should be implemented later as:

- import adapter;
- export adapter.

It is **not** the canonical Sojourner data model because it does not provide the provenance/verification relationships required by Career Evidence.

## 15. Security model

Resume files are untrusted input.

Requirements:

- size limits;
- decompression/nesting limits;
- no macro execution;
- no embedded-link execution;
- content-based format detection;
- no automatic remote fetches;
- parser execution outside renderer privileges;
- safe managed filenames;
- path traversal prevention;
- preserve errors and warnings;
- no silent hosted OCR;
- no silent inference upload.

Where practical, parsing should execute in a constrained worker/child-process boundary so malformed document processing cannot crash or block the Electron main loop.

## 16. Functional screens

### Career Profile

Add:

- Career Evidence summary;
- Resume/experience import action;
- confirmed skills/credentials/history derived from evidence;
- unresolved import-review count.

### Evidence Review

New workflow surface:

- imported artifact summary;
- extracted career timeline;
- skills/credentials;
- ambiguous facts;
- source/provenance view;
- confirm/edit/reject controls.

### Resume Workspace

New top-level or context-linked surface:

- master/current resume projections;
- create resume;
- tailor for tracked application;
- compare versions;
- truth/parseability/relevance status;
- preview;
- export;
- show which applications used a version.

### Find Jobs

For tracked/reviewed jobs:

- requirement coverage summary;
- evidence-backed fit details;
- visible gaps;
- `Prepare resume` action.

### Applications

Add:

- attached resume artifact/version;
- application date;
- follow-up date;
- future interview-prep entry point using the exact sent artifact.

## 17. Benchmark corpus

Before freezing import behavior, test at least:

- skilled-trade technician;
- nurse/allied-health worker;
- retail/service manager;
- warehouse/logistics worker;
- administrative/operations professional;
- software engineer;
- experienced people manager;
- recent graduate;
- career changer;
- senior executive;
- academic/research candidate;
- federal applicant.

Document fixtures should include:

- clean one-column DOCX;
- clean text PDF;
- two-column PDF;
- header/footer-heavy resume;
- sparse resume;
- long resume;
- resume with tables;
- image-only/scanned PDF;
- malformed file;
- password-protected/encrypted file.

## 18. Parser acceptance gate

`anydoc` becomes the production dependency only if the benchmark establishes acceptable product behavior.

Evaluate against:

- extraction completeness;
- bullet-to-role association;
- section preservation;
- date/title/employer preservation;
- reading order;
- error-state clarity;
- malicious/malformed resource handling;
- latency;
- memory footprint;
- Windows/macOS Electron packaging;
- transitive license clarity;
- ability to re-parse Sojourner-generated PDFs.

Only introduce a second parser if there is a demonstrated gap important enough to justify the maintenance burden.

## 19. Implementation sequence

### R0 — contract freeze

- migrate Career Profile and Applications to backend/SQLite or deliberately complete those migrations as the opening implementation slice;
- finalize domain object contracts;
- define SQLite migrations;
- define managed artifact directory layout;
- create benchmark corpus;
- define truth/parseability test fixtures;
- define inference data-disclosure boundary.

### R1 — import and evidence

- parser bake-off;
- adopt preferred parser only after acceptance;
- SourceArtifact + ExtractionSnapshot;
- evidence normalization;
- evidence confirmation UI;
- profile synchronization.

### R2 — requirement mapping

- JobRequirement normalization;
- deterministic requirement/evidence mapping;
- gap/ambiguous UX;
- application linkage.

### R3 — deterministic resume creation

- ResumeProjection + ResumeStatement;
- Sojourner-owned ATS-safe templates;
- Chromium PDF renderer;
- Truth Gate;
- PDF re-parse/Parseability Gate;
- artifact versioning.

### R4 — target-specific tailoring

- role-specific evidence selection;
- deterministic vocabulary translation;
- optional inference provider interface;
- evidence-bound assisted rewriting;
- relevance review.

### R5 — lifecycle integration

- application artifact history;
- interview-prep handoff;
- repeated gap analysis;
- follow-up/application-material history;
- JSON Resume interoperability;
- evaluate OCR and DOCX output as separately justified capabilities.

## 20. Definition of done for the first resume milestone

The milestone is not complete merely because Sojourner can generate a PDF.

It is complete when a nontechnical user can:

1. import a normal DOCX or text PDF;
2. understand what was extracted;
3. correct ambiguous facts;
4. produce a resume without configuring AI;
5. tailor it to a tracked job without unsupported claims;
6. see unresolved gaps;
7. export a selectable-text ATS-safe PDF;
8. pass the truth gate;
9. pass critical parseability checks;
10. attach the exact exported version to the application.

That is the minimum coherent product loop.
