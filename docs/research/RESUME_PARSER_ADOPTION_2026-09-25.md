# Resume parser adoption decision

**Date:** 2026-09-25  
**R1 issue:** #61  
**Candidate:** `@firecrawl/anydoc@0.2.4`  
**Decision:** Selected as the default DOCX / text-bearing PDF parser candidate for R1 integration.

## Boundary

Selection does not make parser output authoritative career evidence.

The import boundary remains:

```text
source artifact
  -> preserve + hash
  -> deterministic extraction
  -> parser-versioned extraction snapshot
  -> proposed Candidate Evidence
  -> human confirm / edit / reject / merge
  -> confirmed career evidence
```

Plain text and pasted text use Sojourner's native text path. Anydoc is only required where document extraction earns its keep, initially DOCX and text-bearing PDF.

Scanned or image-only PDF must surface `ocr-required`. Hosted OCR is not enabled by default. No inference provider is required for import or extraction.

## Bounded benchmark

The committed benchmark corpus is synthetic and non-personal. It covers:

- HVAC technician DOCX;
- registered nurse DOCX;
- multi-role operations PDF;
- career-changer PDF;
- plain text / federal-style evidence;
- image-only PDF;
- encrypted PDF;
- malformed DOCX;
- unsupported binary input.

The acceptance harness checks:

- required phrase completeness;
- role / bullet reading order;
- absence of prohibited invented phrases;
- explicit failure classification;
- warmed parser latency;
- package metadata and platform-native dependency selection.

## Linux x64 full-corpus result

Environment: Ubuntu 24.04, Node 22.12.0, x64.

- fixtures: 9
- passed: 9
- failed: 0
- required phrase coverage on supported DOCX/PDF fixtures: 100%
- required reading-order coverage: 100%
- forbidden invented phrases detected: 0
- median warmed parser latency: 706.07 ms
- maximum warmed parser latency: 716.32 ms
- image-only PDF: `ocr-required`
- encrypted PDF: `encrypted`
- malformed DOCX: `malformed`
- unsupported binary: `unsupported`
- candidate gate: PASS

The malformed-DOCX benchmark initially exposed a harness-normalization gap because Anydoc reported `missing required part: word/document.xml`. The harness was corrected to normalize that actionable parser message as `malformed`; the parser behavior itself did not change.

## macOS arm64 result

Environment: macOS 15.7.9, Node 22.12.0, arm64.

Smoke fixtures:

- HVAC DOCX: PASS, 928.23 ms
- operations PDF: PASS, 627.22 ms

Selected native package:

- `@firecrawl/anydoc-darwin-arm64@0.2.4`
- license: MIT
- native unpacked size: 7,008,205 bytes
- wrapper unpacked size: 57,136 bytes
- projected parser package footprint: 7,065,341 bytes (~6.74 MiB)

## Windows x64 result

Environment: Windows Server 2025, Node 22.12.0, x64.

Smoke fixtures:

- HVAC DOCX: PASS
- operations PDF: PASS

The first Windows smoke invocation measured 8.506 s because the audit intentionally invoked the pinned package through `npx` without a warm-up and therefore included package acquisition / cold CLI startup. The second document completed in 1.476 s. Runtime integration will install the dependency with the application, so the first `npx` acquisition cost is not representative of normal product parsing latency.

Selected native package:

- `@firecrawl/anydoc-win32-x64-msvc@0.2.4`
- license: MIT
- native unpacked size: 8,276,356 bytes
- wrapper unpacked size: 57,136 bytes
- projected parser package footprint: 8,333,492 bytes (~7.95 MiB)

## License and transitive boundary

`@firecrawl/anydoc@0.2.4` reports MIT and Node `>=20`.

The package exposes no ordinary dependency chain in the benchmark metadata. Its platform support is provided through pinned optional native packages, all at version `0.2.4`:

| Package | License | Unpacked bytes |
| --- | --- | ---: |
| `@firecrawl/anydoc-darwin-x64` | MIT | 7,457,690 |
| `@firecrawl/anydoc-darwin-arm64` | MIT | 7,008,205 |
| `@firecrawl/anydoc-linux-x64-gnu` | MIT | 8,190,015 |
| `@firecrawl/anydoc-linux-arm64-gnu` | MIT | 7,223,106 |
| `@firecrawl/anydoc-linux-x64-musl` | MIT | 8,207,795 |
| `@firecrawl/anydoc-linux-arm64-musl` | MIT | 7,231,750 |
| `@firecrawl/anydoc-win32-x64-msvc` | MIT | 8,276,356 |

No license exception is required for the currently observed package boundary.

## Adoption decision

Anydoc 0.2.4 clears the bounded parser adoption gate strongly enough to become Sojourner's default local parser for DOCX and text-bearing PDF in R1.

Reasons:

1. It preserved all expected factual content in the benchmark corpus.
2. It preserved required role / bullet reading order.
3. It did not introduce prohibited evidence.
4. It produced actionable failure signals for OCR-required, encrypted, malformed, and unsupported inputs.
5. Warmed Linux latency is comfortably below the R1 thresholds.
6. Windows x64 and macOS arm64 smoke tests passed.
7. The wrapper and all observed native platform packages report MIT.
8. The projected platform footprint is small enough for a desktop application.

## Integration gate still required

Selection is not permission to skip product packaging proof.

The R1 integration PR that first adds `@firecrawl/anydoc@0.2.4` to Sojourner must still prove:

- Electron Builder includes the correct native package for the target platform;
- the packaged application can invoke extraction from its installed runtime;
- actual packaged-size delta is recorded;
- no Firecrawl API key, hosted OCR, or hosted inference is required for local extraction;
- original artifacts are preserved and hashed before parsing;
- durable extraction snapshots record parser name/version and warnings;
- parser output remains proposed evidence until user confirmation.

If those product-level checks fail, this selection must be revisited rather than patched around with a second parser stack.
