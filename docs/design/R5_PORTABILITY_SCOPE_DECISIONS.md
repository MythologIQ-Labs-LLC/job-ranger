# R5 portability and interoperability scope decisions

Issue owner: #65  
Program owner: #59  
Universal downstream owner: #88

## Decision summary

R5 closes with three distinct portability boundaries:

1. **Sojourner backup/restore** is the durable protection path for canonical local state and managed artifacts.
2. **JSON Resume** is an optional structured interoperability adapter over Career Evidence, not a competing truth store.
3. **OCR and DOCX output remain deferred** until product evidence demonstrates that their added dependency, security, testing, and maintenance costs solve a material user problem that current paths do not.

## JSON Resume

### Import

- the selected JSON file is preserved as a managed source artifact;
- supported standard sections are converted to `imported` candidate evidence;
- imported evidence remains non-authoritative until the user confirms or edits it;
- a name found under `basics.name` is returned as a proposal only and does not silently overwrite Career Profile;
- unsupported standard sections remain preserved in the source artifact and generate explicit warnings rather than invented mappings;
- duplicate source bytes reuse the existing source artifact/evidence rather than creating duplicate truth candidates.

Adapter v1 maps conservative standard sections:

- `work` -> role plus achievement proposals;
- `education` -> education proposals;
- `skills` -> skill proposals;
- `certificates` -> credential proposals;
- `projects` -> project proposals;
- `publications` -> publication proposals.

Adapter v1 deliberately does not auto-convert `volunteer`, `awards`, `languages`, `interests`, or `references`. The source remains preserved so later adapter evolution can revisit those fields without data loss.

### Export

- only `user-confirmed` and `user-authored` Career Evidence participates;
- Career Profile contributes non-evidentiary basic identity/location fields only;
- evidence is emitted only where Sojourner has an unambiguous standard section mapping;
- evidence with no unambiguous standard mapping is omitted with a visible count/warning;
- Sojourner-specific provenance, verification state, requirement mappings, application state, and source lineage are not smuggled into unrelated JSON Resume fields;
- the export points to the canonical JSON Resume schema URL but does not claim a schema version it does not own.

JSON Resume therefore remains a lossy interchange projection by design. The complete portable Sojourner record is the versioned backup bundle.

## OCR decision

**Status: deferred, not required for R5 completion.**

Current resume import already handles DOCX, plain text, pasted text, and text-bearing PDF. Image-only/scanned PDF is preserved and surfaced as `needs-ocr` rather than silently failing or transmitting the document elsewhere.

OCR does not earn a built-in dependency in R5 because:

- no governed user-story or fixture result demonstrates that scanned/image-only resumes are a current critical-path blocker;
- adding local OCR would materially increase packaged size and platform-specific dependency/testing surface;
- remote OCR would require explicit disclosure/consent and a new privacy boundary for highly sensitive career documents;
- manual/pasted text remains a deterministic fallback.

Reopen OCR only with concrete demand evidence such as repeated import failures in real usage or fixture expansion showing image-only documents are necessary for a critical user group. Any remote OCR proposal must remain opt-in and must not establish factual truth directly.

## DOCX output decision

**Status: deferred, not required for R5 completion.**

Current application artifacts have a deterministic ATS-safe PDF path plus structured JSON Resume interoperability. A DOCX renderer would add another rendering stack, another artifact-parseability surface, and another platform compatibility obligation.

DOCX output should be promoted only when measured user demand demonstrates a material need that PDF plus JSON Resume cannot satisfy, for example employers explicitly requiring editable DOCX uploads at meaningful frequency.

If promoted later, DOCX must remain a projection from Career Evidence, pass the same Truth Gate, receive format-specific parseability validation, remain versioned/immutable once submitted, and preserve exact application linkage.

## Cross-career validation relationship

R5 functionality does not introduce occupation-specific truth rules. The governed fixtures under #87 remain the cross-career regression contract. R5 consumers operate on the same universal entities:

- Career Evidence;
- requirements and mappings;
- target tracks;
- applications/lifecycle state;
- source/source-class metadata;
- versioned application artifacts.

The R5 implementation is therefore applicable to hourly/local, trades, healthcare, technical, recent-graduate, executive, career-change, federal/government, contractor/freelance, and nonlinear-history contexts without adding core occupation-specific branches. Broader end-to-end fixture-driven Electron UX validation remains owned by #87 rather than being duplicated inside #65.

## Completion evidence

R5 portability acceptance is satisfied when repository health proves:

- backup/restore round-trips canonical state and rebases managed artifact paths across installation roots;
- tampered backup content is rejected;
- JSON Resume import preserves the original source and creates only review-required candidate evidence;
- JSON Resume import cannot silently overwrite Career Profile;
- JSON Resume export contains only confirmed/user-authored evidence;
- unsupported current evidence is explicitly omitted rather than invented into a standard field;
- JSON Resume duplicate import is idempotent;
- ordinary repository health and Electron E2E remain green.
