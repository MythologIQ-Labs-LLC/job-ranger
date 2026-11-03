# QOR Research Addendum: Technical Capability Catalog Harvest

**Status:** Research candidate harvest for the Resume / Import Intelligence program  
**Date:** 2026-09-24  
**Source:** Maintained Creator Technical Resource Catalog plus primary repository/license verification for the strongest candidates.

## Purpose

Sojourner already has access to a maintained technical capability catalog that tracks canonical resource identity, license, maturity, data boundary, authority, adoption burden, and suggested disposition. Resume intelligence should use that work rather than rediscovering document and career tooling from scratch.

This addendum applies a bounded filter to catalog resources relevant to:

- resume/CV creation and tailoring;
- PDF/DOC/DOCX import;
- structured document extraction;
- ATS/readability validation;
- local document processing;
- evidence/provenance preservation;
- PDF/rendering architecture;
- OCR as a later capability.

Anything incorporated into Sojourner must preserve Sojourner's MIT licensing boundary. Resources with incompatible, noncommercial, source-available, proprietary, or materially custom terms may still be studied as references, but their code/assets must not be copied into the product.

## Decision vocabulary

- **Adopt candidate** — suitable for an implementation spike and possible direct dependency or code reuse, subject to benchmark and attribution.
- **Adapt/reference** — useful architecture, UX, schema, or algorithm source; copy only after file-level licensing review.
- **Benchmark** — useful comparison implementation, but likely too heavy or mismatched as a direct dependency.
- **Defer** — potentially useful later, not justified in the first import slice.
- **Reject direct reuse** — licensing or product-boundary mismatch prevents incorporation into the MIT product.

## Selection principle

The goal is not to build a parser collection.

Sojourner should prefer **one best-fit default parser** and add another only when a measured product gap justifies the additional packaging, security, licensing, and maintenance burden.

The same principle applies to rendering. Tailit's Typst architecture is useful evidence, but Sojourner already ships Chromium through Electron. The first resume renderer should therefore reuse the existing runtime unless a benchmark demonstrates that a second rendering engine materially improves output quality or reliability.

## Strongest catalog candidates

### 1. anydoc — OSS-0772

**Repository:** `firecrawl/anydoc`  
**License:** MIT  
**Disposition:** **Preferred R1 adoption candidate, pending benchmark**

Why it is unusually well aligned:

- Rust core with first-party Node.js bindings, avoiding a Python sidecar for Sojourner's Electron runtime;
- parses DOC, DOCX, DOCM, RTF, OpenDocument, EPUB, CSV, text PDFs, and additional office formats;
- content-based format detection rather than trusting filename extensions;
- common document model plus consistent Markdown serialization;
- local conversion is deterministic and non-ML;
- explicit conversion failures distinguish unsupported, encrypted, malformed, resource-limited, and OCR-required inputs;
- Node conversion runs off the event loop;
- WebAssembly path exists for possible future renderer/process isolation.

Important boundary:

- scanned/image-only PDF OCR is **not local** when using anydoc's hosted OCR option; it sends the whole document to Firecrawl Parse;
- Sojourner must therefore keep hosted OCR disabled by default. `NeedsOcr` should become a visible import state, not an automatic network fallback.

Recommended spike:

1. Import DOCX and text PDF bytes through the Node binding.
2. Preserve source hash and original bytes before conversion.
3. Record parser name/version and warnings in the import record.
4. Compare extracted text/structure against the benchmark corpus.
5. Validate malformed/encrypted/resource-limit behavior with adversarial fixtures.
6. Re-parse Sojourner-generated PDFs and evaluate whether the same dependency can serve output parseability verification.

### 2. EasyPeasyCV — OSS-1325

**Repository:** `goncalojbsousa/EasyPeasyCV`  
**License:** MIT  
**Disposition:** **Adapt/reference**

High-value patterns:

- no-account resume editing;
- local browser persistence;
- structured resume editing with reorderable sections and entries;
- portable XML import/export;
- client-side PDF generation;
- multilingual user-facing resume UX;
- explicit privacy boundary with no server persistence.

Sojourner should inspect the implementation for interaction patterns and serialization decisions, not adopt EasyPeasyCV's resume object as the Sojourner domain model. Sojourner's canonical model must remain evidence/provenance-first rather than document-first.

### 3. Tailit — OSS-1373

**Repository:** `sardorml/tailit`  
**License:** MIT for application code  
**Disposition:** **Adapt/reference; selective code candidate**

High-value patterns:

- JSON Resume plus Zod validation;
- LLM output revalidation instead of trusting raw model responses;
- requirement-aware truthful tailoring;
- explicit gap reporting rather than fabrication;
- live preview and Typst-based selectable-text PDF output;
- structured template adapters;
- browser-local resume state.

Important boundaries:

- the workflow sends resume/job text to Groq for rewriting, which is not acceptable as an implicit Sojourner baseline;
- job extraction can use external Jina Reader;
- the 65 bundled templates are **not one homogeneous MIT asset set**. Tailit's README explicitly says third-party templates, fonts, and Typst Universe packages retain their own licenses.

Recommendation:

- harvest schema-validation, diff/tailoring, and adapter concepts;
- consider JSON Resume as an import/export interchange format;
- do **not** make JSON Resume Sojourner's canonical evidence model;
- do not bulk-copy Tailit templates. Review any desired template individually;
- do not adopt Typst merely because Tailit uses it. Sojourner's first renderer should use the existing Electron/Chromium runtime and keep the renderer contract replaceable.

### 4. Career-Ops — AC-0008 / upstream `career-ops-hq/career-ops`

**License:** MIT  
**Disposition:** **Adapt/reference; selective code candidate**

Career-Ops remains the strongest domain-specific source for:

- requirement-to-evidence mapping;
- truth/fabrication gating;
- ATS structural checks;
- application-scoped resume artifacts;
- target-specific evidence ordering;
- hiring-manager review as a separate relevance layer;
- preservation of unsupported requirements as explicit gaps.

Sojourner should continue to harvest these mechanisms natively rather than embedding the Career-Ops runtime or exposing its CLI/file-oriented UX.

### 5. MarkItDown — OSS-0041

**Repository:** `microsoft/markitdown`  
**License:** MIT  
**Disposition:** **Benchmark / possible fallback only if justified**

Useful for:

- heterogeneous office/document conversion to Markdown;
- mature, highly adopted input-normalization behavior;
- plugin-oriented conversion architecture.

Burden/caveat:

- Python integration is less natural for the Electron desktop than anydoc's Node binding;
- optional MarkItDown OCR currently pulls in PyMuPDF, whose AGPL/commercial licensing materially changes the boundary.

Recommendation: benchmark local core conversion, but do not enable or inherit the optional OCR dependency without a separate license review. Do not ship it beside anydoc unless the benchmark demonstrates a meaningful uncovered format/quality gap.

### 6. Docling — OSS-0096

**Repository:** `docling-project/docling`  
**License:** MIT  
**Disposition:** **Advanced parser benchmark, not default**

Strengths:

- richer layout reconstruction and reading-order analysis;
- tables and heterogeneous file formats;
- local/air-gapped operation;
- structured Markdown/HTML/JSON-like outputs;
- OCR/VLM extension paths.

Trade-off:

Docling is substantially heavier than the first Sojourner import need and introduces Python/model packaging concerns. It is more attractive as a benchmark or advanced fallback than as the default R1 parser.

Model/OCR components also require their own license review. MIT on the Docling repository does not magically relicense separately distributed models.

### 7. LiteParse — OSS-0044

**Repository:** `run-llama/liteparse`  
**License:** Apache-2.0  
**Disposition:** **PDF spatial/read-order benchmark**

Potential Sojourner value:

- fast local PDF extraction;
- spatial/bounding-box output;
- reading-order evidence for ATS parseability checks;
- Rust core with Node/WASM surfaces;
- local/air-gapped use.

This may prove more useful for **verifying PDF output and reading order** than for general resume import.

Apache-2.0 is compatible with Sojourner's MIT project, but Apache attribution/NOTICE obligations must be preserved where applicable.

Do not adopt it if the selected default parser can adequately verify the generated PDF itself.

### 8. Unstructured — OSS-0098

**Repository:** `Unstructured-IO/unstructured`  
**License:** Apache-2.0  
**Disposition:** **Benchmark / reference**

Strong broad document-partitioning and preprocessing implementation, but its Python/Docker-oriented footprint is likely excessive for a consumer Electron application. Keep it in the parser benchmark rather than adopting it by default.

### 9. PaddleOCR — OSS-0099

**Repository:** `PaddlePaddle/PaddleOCR`  
**License:** Apache-2.0  
**Disposition:** **Defer to OCR phase**

This is the strongest cataloged permissively licensed OCR/document-AI candidate for scanned or image-only resumes. It is far too large to smuggle into the first import implementation simply because OCR would be nice to have.

Recommended boundary for R1:

> Detect `NeedsOcr` and explain it accurately. Do not solve OCR until the core evidence import model is proven.

A later OCR phase should compare PaddleOCR, Docling OCR paths, platform-native options, and packaging footprint before adoption.

### 10. OpenReader — OSS-1378

**Repository:** `richardr1126/openreader`  
**License:** MIT  
**Disposition:** **Reference only**

Its layout-aware PDF/DOCX ingestion is relevant, but the application is primarily a text-to-speech/document-reader product. It is useful for document UX and parsing comparisons, not a likely Sojourner dependency.

## Explicit non-adoption / licensing boundaries

### Universal Résumé Template — OSS-1363

**License:** CC BY-NC-SA 1.0 / noncommercial share-alike  
**Decision:** **Reject direct reuse**

Useful visual/print reference only. Its noncommercial/share-alike terms are inappropriate for incorporation into Sojourner's MIT code/template baseline.

### MinerU — OSS-0097

**License:** Apache-derived custom terms with commercial thresholds/attribution requirements  
**Decision:** **Reject as default direct dependency**

It may remain a parser benchmark, but there is no reason to accept a custom licensing boundary when strong MIT/Apache alternatives exist for this product.

### Anthropic Skills document skills — OSS-0587

**License:** mixed; production DOCX/PDF/PPTX/XLSX skills are source-available rather than open source  
**Decision:** **No direct incorporation**

The skills can inform workflow research where allowed, but their availability in a public repository does not make them MIT-compatible.

### Hireflow ATS Resume Checker — MM-0016

**License:** proprietary/commercial  
**Decision:** **Reference only**

Useful as a UX/heuristic comparison. Its score should not be treated as ground truth and its implementation is not reusable.

### Creator mass-application workflows — AC-0041 / AC-0094 / AC-0109

**License:** proprietary or no license stated  
**Decision:** **Research/adversarial examples only**

They are useful for understanding resume transformation and authorization failure modes, not as code sources.

## Recommended Sojourner import architecture after catalog review

The catalog supports a layered adapter architecture, but not a permanently multi-parser runtime.

```text
source artifact
    ↓
format sniff / safety precheck
    ↓
ImportAdapter
    └── selected default parser
          ↓
raw extraction + parser evidence
    ↓
normalization into Candidate Evidence
    ↓
human confirmation
```

Alternative parsers remain development benchmarks or future fallbacks until evidence requires them.

A parser is not allowed to create profile truth merely because it returned structured output.

Every import result should retain:

- source artifact hash;
- source MIME/format plus detected format;
- parser/adaptor identity and version;
- extracted raw text/structure;
- parser warnings/errors;
- field-level interpretation confidence;
- user confirmations/corrections;
- provenance links from normalized evidence back to source locations.

## Security boundary for untrusted resumes

Resume files are untrusted input.

The importer should therefore:

- never execute macros or embedded code;
- never automatically open embedded links;
- apply decompression/nesting/resource limits;
- reject or isolate encrypted/malformed content;
- parse in a constrained worker/process boundary where practical;
- preserve parser errors rather than silently dropping content;
- avoid automatic network fallbacks;
- never send a resume to hosted OCR or an LLM without a deliberate, visible user decision.

This is relevant even for permissively licensed parsers. A license is not a sandbox. Humanity has already tested that hypothesis extensively.

## Rendering implications from the catalog

Tailit and EasyPeasyCV reinforce a useful separation:

- canonical data should be structured;
- templates should be adapters/renderers, not storage formats;
- generated outputs should remain selectable text;
- live preview and export should derive from the same structured projection when possible.

For Sojourner, however, the canonical structure must be **Candidate Evidence**, not JSON Resume, Typst data, XML, HTML, or a PDF model.

Recommended relationships:

```text
Candidate Evidence (canonical)
    ├── JSON Resume import/export adapter
    ├── resume projection
    │     ├── ATS-safe renderer
    │     ├── polished renderer
    │     ├── federal renderer
    │     └── academic CV renderer
    └── application evidence/history
```

JSON Resume is attractive as an interoperability surface because other tools already use it. It is not sufficient as the provenance-rich internal career record Sojourner needs.

For the initial renderer, reuse Electron/Chromium and Sojourner-owned HTML/CSS templates. Revisit Typst only if rendering benchmarks or future DOC/PDF requirements show a material advantage.

## Proposed R1 tool bake-off

Before adopting a parser dependency, run a bounded benchmark on the synthetic corpus proposed in the primary QOR research.

Minimum competitors:

1. anydoc;
2. MarkItDown;
3. Docling;
4. LiteParse for PDF-specific/read-order cases;
5. current simple extraction baseline, if one exists.

Score each on:

- text completeness;
- role/date/bullet association;
- reading order;
- list preservation;
- section-boundary preservation;
- table/column failure behavior;
- encrypted/malformed handling;
- scan detection;
- runtime footprint;
- cold/warm latency;
- Electron packaging complexity;
- fully local operation;
- license and transitive-license clarity;
- ability to re-parse generated Sojourner PDFs for output verification.

The winner does not need the most features. It needs the best product fit for ordinary resume imports.

## License-governance requirements for implementation

For every adopted external component:

1. verify the license from the primary repository at the version actually adopted;
2. review transitive and bundled asset/model licenses when they are not covered by the root license;
3. record the dependency or copied/modified source in `THIRD_PARTY_NOTICES.md`;
4. retain required MIT/Apache notices;
5. record whether Sojourner copied code, modified code, imported an asset, or only uses the project as a runtime dependency/reference;
6. do not import a template pack merely because the host application itself is MIT;
7. rerun the check when upgrading across a license or packaging boundary.

## Resulting shortlist

### Advance into R0/R1 evaluation

- **anydoc** — preferred default-import candidate, pending benchmark.
- **EasyPeasyCV** — structured editing/local UX reference.
- **Tailit** — schema/tailoring/template-adapter reference, selective MIT code candidate.
- **Career-Ops** — domain logic source for truth, relevance, ATS, and application-scoped artifacts.
- **LiteParse** — PDF spatial/read-order benchmark only.
- **Docling** — advanced parser benchmark.
- **MarkItDown** — normalization benchmark/fallback candidate.

### Later capability lane

- **PaddleOCR** — scan/OCR evaluation.
- **Unstructured** — broad parser benchmark when advanced ingestion is justified.
- **OpenReader** — layout/document UX reference.

### Explicitly do not incorporate

- Universal Résumé Template code/assets under its noncommercial/share-alike license.
- MinerU as a default dependency under its custom commercial terms.
- source-available Anthropic production document skills.
- proprietary ATS/resume services or no-license creator workflows.

## Architectural consequence

The capability catalog reinforces the primary QOR conclusion:

> Sojourner should own the candidate-evidence and application lifecycle. External tools may help ingest, validate, or render documents, but no parser, resume schema, template engine, LLM workflow, or third-party career application should become the product's canonical source of truth.

That keeps the architecture user-agnostic, renderer-agnostic, inference-optional, and replaceable at every external capability boundary.
