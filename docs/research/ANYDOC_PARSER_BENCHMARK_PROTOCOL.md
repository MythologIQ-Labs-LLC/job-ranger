# Anydoc Parser Benchmark Protocol

**Issue:** #61  
**Candidate:** `@firecrawl/anydoc@0.2.4`  
**Status:** executable adoption benchmark, not product dependency

## Purpose

This benchmark decides whether Sojourner should adopt `@firecrawl/anydoc` as its default local document parser for the first Resume Import slice.

A parser converts documents. It does not establish career truth. Passing this benchmark does not permit extracted claims to become confirmed Candidate Evidence without user authority.

## Candidate boundary

The candidate is executed from a pinned package version through `npx` for benchmark purposes. It is intentionally not added to Sojourner runtime dependencies until the adoption gate is satisfied.

Plain text and pasted text use Sojourner's native text path and are not counted as evidence that the parser adds value.

Hosted OCR is disabled. Image-only PDFs must produce an explicit local failure that Sojourner can normalize to `ocr-required`; the benchmark must not silently send a personal document to a hosted service.

## Synthetic corpus

The committed manifest covers:

- HVAC technician DOCX;
- registered nurse DOCX;
- administrative/operations PDF with two employers to test reading order and bullet-to-role association;
- career-changer PDF;
- federal-style plain text with hours/week;
- image-only PDF;
- encrypted PDF;
- malformed DOCX;
- unsupported binary input.

All names and organizations are fictional. Binary files are generated from the committed fixture generator before execution so no personal resume data enters the benchmark.

## Pass conditions

For successful imports:

- 100% of required benchmark phrases survive extraction;
- required role/bullet phrases remain in expected reading order;
- prohibited/invented claims do not appear;
- process exit status is successful.

For failure fixtures:

- image-only PDF -> `ocr-required`;
- encrypted PDF -> `encrypted`;
- malformed DOCX -> `malformed`;
- unknown binary -> `unsupported`.

A generic parser failure is not an acceptable substitute when the product can reasonably provide a more actionable state.

Latency is measured after warming the pinned CLI so package acquisition is excluded. Initial conservative gates are:

- median successful Anydoc fixture <= 3000 ms;
- maximum successful Anydoc fixture <= 5000 ms.

These are adoption gates for the CLI benchmark, not product-runtime targets. Direct Node binding performance should be measured again if Anydoc is incorporated.

## Package and license evidence

The benchmark records npm metadata for the exact package/version, including declared license, engine requirement, dependency metadata, and unpacked package size where npm exposes it.

Before production incorporation, review must also confirm:

- upstream repository license at the adopted revision/tag;
- npm package license identity;
- native binary distribution boundary;
- transitive/native dependency notices if any;
- Electron Builder behavior on supported desktop targets.

## Platform strategy

The first benchmark run is a single Linux job to avoid wasting GitHub Actions budget while basic quality/failure behavior is still unknown.

Do not launch a Windows/macOS matrix merely to discover that the candidate fails corpus correctness on Linux. Cross-platform package validation is required before final parser adoption, but occurs only after the candidate clears the content/failure gate.

## Reproduction

1. Install benchmark-only Python fixture dependencies from `tests/fixtures/career-evidence/parser-benchmark/requirements.txt`.
2. Run `python scripts/generate-resume-parser-fixtures.py`.
3. Run `node scripts/benchmark-resume-parser.mjs`.
4. Inspect the JSON report under `tests/fixtures/career-evidence/parser-benchmark/results/`.
5. Use `--strict` only when a known-good baseline has been established and should become a gate.

## Promotion rule

Anydoc should become a product dependency only after:

1. corpus correctness and actionable failure states pass;
2. package/license review is complete;
3. direct Node binding integration is proven in Electron;
4. supported Windows/macOS packaging is proven;
5. the import service preserves the original artifact before interpretation and persists parser-versioned ExtractionSnapshots;
6. no hosted OCR/inference occurs without explicit user disclosure and action.
