# QOR Research: Resume and Import Intelligence

**Status:** Research synthesis for planned Sojourner resume/import intelligence  
**Date:** 2026-09-24  
**Scope:** Resume creation, resume import, tailoring, ATS compatibility, human review, specialized formats, evidence integrity, and integration into the Sojourner application lifecycle.

## Executive conclusion

Sojourner should not build a "resume generator" as a document-first feature.

It should build a **candidate evidence system** that can import, normalize, verify, select, tailor, and render truthful career evidence into different resume artifacts for different application contexts.

The resume is an output. The durable product asset is the evidence behind it.

That distinction matters because there is no single universally optimal resume. A document that is easy for an Applicant Tracking System to parse is not necessarily the best document for a hiring manager to evaluate. A federal resume has explicit qualification requirements that differ from an ordinary private-sector resume. An academic CV is a different artifact again. A career changer may benefit from skills-forward organization while a candidate with a linear work history may be better served by reverse chronology.

Sojourner therefore needs a context-aware resume intelligence layer, not one template with increasingly elaborate conditionals.

## Research question

What should Sojourner know, preserve, verify, and vary in order to help a person create or import a modern resume that remains truthful, parseable, relevant, readable, and appropriate for the actual hiring context?

## Research model: the resume has multiple consumers

A useful resume must survive several different readers, sometimes in sequence.

### 1. Parser / Applicant Tracking System

The parser cares primarily about whether information can be extracted reliably into structured fields.

Current guidance from MIT, Greenhouse, and Workday converges on several practical constraints:

- use selectable text rather than image-only content;
- prefer common supported document formats such as PDF and DOC/DOCX;
- use clear, standard section structure;
- avoid layouts that depend on tables, text boxes, sidebars, columns, graphics, or embedded text in images;
- do not place critical contact information only in headers, footers, or unusual containers;
- use ordinary fonts and predictable reading order;
- follow the application system's requested file type when one is specified.

This is not evidence that every ATS behaves identically. In fact, MIT explicitly notes that ATS is an umbrella category covering many different products and in-house systems, which is a reason to optimize for robust structure instead of trying to game one hypothetical scoring algorithm.

### 2. Automated matching / AI screening

Modern hiring systems increasingly do more than extract fields. They compare skills, experience, qualifications, and semantic similarity between a candidate and a role.

NACE's 2026 Job Outlook research reports growing employer adoption of skills-based hiring. LinkedIn's current recruiter tooling similarly describes candidate evaluation in terms of qualifications, evidence, skills, and semantic retrieval rather than simple keyword identity.

Implication for Sojourner:

- exact terminology still matters when the employer names an explicit requirement;
- semantic equivalents matter too;
- the system should understand skill evidence and transferable experience, not merely count words;
- keyword coverage should be advisory, not a gameable resume score;
- unsupported requirements must remain gaps rather than becoming generated claims.

### 3. Recruiter / initial human screen

The recruiter's problem is speed and clarity.

Harvard and MIT both emphasize that a resume must be concise, easy to skim, relevant to the target, fact-based, and organized so important information is immediately visible. Career-Ops operationalizes this as a "top third" or rapid-clarity gate.

The precise folklore around a universal six-second scan should not become a scientific claim in Sojourner. The useful design principle is simpler:

> The first visible portion of the resume should quickly establish what the candidate is targeting, why they plausibly fit, and where the proof is.

For Sojourner this suggests a deterministic recruiter-read audit based on information hierarchy rather than a magical fixed number of seconds.

### 4. Hiring manager / domain reviewer

The hiring manager cares less about formatting mechanics and more about whether the candidate has done work at the necessary level.

The strongest evidence is contextual:

- what problem or responsibility existed;
- what the candidate actually did;
- scale and constraints;
- tools or methods where relevant;
- impact, result, or operational outcome;
- degree of ownership;
- evidence of the specific requirements that create risk for this role.

Career-Ops' optional hiring-manager audit is especially valuable here. Its central idea is strong: a fact checker can establish that a bullet is truthful, but cannot establish that it is the *right* bullet for this role. Relevance and seniority require a different review.

### 5. Specialized gatekeeper

Some applications impose domain-specific document rules.

Examples:

- **Federal hiring:** USAJOBS now limits federal resumes to two pages, expects explicit evidence against qualifications, and may require hours per week, dates, grade/series, education, licenses, and other details that ordinary private-sector resumes do not.
- **Academic/research hiring:** an academic CV is intentionally comprehensive, can be much longer, and may require publications, presentations, grants, teaching, research, service, affiliations, and references.
- **Creative/portfolio-driven work:** the resume may remain structurally conservative while portfolio evidence carries a larger share of proof.
- **International markets:** conventions differ by country, including terminology, page size, photo expectations, personal information norms, and CV/resume meaning.

Sojourner should model these as **document contexts**, not occupations baked into the product.

## Resume formats and what they are actually for

### Reverse chronological

This should remain the default professional resume projection for most users.

Advantages:

- familiar to recruiters;
- easy to understand quickly;
- preserves career chronology;
- works well when recent experience is relevant;
- aligns with the default advice from MIT, Harvard, Penn, and other major career centers.

### Functional / skills-based

This format shifts emphasis from employers and dates toward skill clusters.

It can be useful when:

- the candidate has limited conventional work history;
- relevant evidence is distributed across volunteering, projects, training, military experience, caregiving, contract work, or unrelated jobs;
- the candidate is making a substantial career change.

It should not erase chronology or become a mechanism for hiding facts. A safer Sojourner default for career changers may be a **hybrid** rather than a pure functional resume.

### Combination / hybrid

This combines an evidence-forward skills or qualifications section with a recognizable reverse-chronological experience history.

This is likely the most useful alternative projection for Sojourner because it can foreground transferable evidence without sacrificing chronology or parser clarity.

### Targeted

"Targeted" is better understood as a **tailoring strategy** than a layout format.

A targeted resume selects, orders, and phrases truthful evidence for a specific role or role family. Any of the layout types above can be targeted.

### Federal

Federal resume output must be treated as its own rule set rather than a styled version of a private-sector resume.

Current USAJOBS guidance includes:

- maximum two pages;
- clear evidence for the listed qualifications;
- employer, title, dates, and hours/week for relevant work;
- federal series/grade where applicable;
- required education, certifications, and licensure when qualification depends on them;
- plain language and explicit terminology;
- application-specific tailoring.

### Academic / research CV

An academic CV is a separate document family.

Its purpose is to present a fuller academic record rather than a concise selected argument. Common components include:

- education;
- research;
- teaching;
- publications;
- presentations;
- grants/fellowships;
- awards;
- service;
- affiliations;
- technical/research methods;
- references.

Section order should vary based on the kind of institution and role, for example research-intensive versus teaching-intensive.

## Resume length: do not encode folklore as a universal rule

The research does not support one hard page-count rule for all resumes.

Useful defaults are contextual:

- students and early-career candidates often benefit from one page;
- experienced candidates commonly use one or two pages depending on relevant history;
- specialized or advanced candidates may need two pages;
- federal resumes currently have a hard two-page maximum under USAJOBS rules;
- academic CVs are variable-length and can be substantially longer.

Sojourner should therefore implement **context-sensitive guidance and warnings**, not a global one-page or two-page hard gate.

## Section strategy: modular, not mandatory

A robust resume model should not assume every user has or needs every section.

### Usually present

- identity / contact block;
- enough dated experience or activity to establish chronology and evidence.

### Common but contextual

- professional summary / qualifications summary;
- skills;
- education;
- certifications / licenses;
- projects;
- leadership;
- volunteer/community work;
- awards;
- publications;
- patents;
- languages;
- portfolio or professional links.

A trade professional may derive more value from licenses and equipment/domain experience than from an Education section. A senior operator may not need a Projects section. A recent graduate may place Education high on the page. An academic CV may contain sections that would be absurd on a retail supervisor's resume.

Sojourner should model sections as projections from evidence, with context-specific ordering rules.

## The content atom: evidence, not prose

The fundamental internal object should be an evidence record.

A useful conceptual shape is:

```text
CandidateEvidence
  id
  type
  source
  sourceArtifact
  sourceLocation
  verificationState
  confidence
  organization
  roleOrContext
  startDate
  endDate
  action
  responsibility
  skillIds[]
  toolsOrMethods[]
  scope[]
  outcome[]
  metrics[]
  credential[]
  artifacts[]
  userNotes
```

This is not intended as the final database schema. It is the architectural boundary.

A generated resume bullet should retain references to the evidence records that support it.

That allows Sojourner to answer:

- Where did this claim come from?
- Is it verified or inferred?
- Did the user explicitly confirm it?
- Which source resume contained it?
- Which generated applications used it?
- Did tailoring merely rephrase evidence or materially alter meaning?

## Resume import: preserve before interpreting

Import should have four distinct stages.

### Stage 1: Preserve the source artifact

The original resume should be stored immutably or content-addressed before normalization.

The system should preserve:

- original filename;
- content hash;
- file type;
- import time;
- extracted text;
- parser warnings;
- later structured interpretation.

The original file is evidence. The normalized representation is an interpretation of that evidence.

### Stage 2: Extract

Initial supported import formats should prioritize text-bearing formats with predictable extraction:

- PDF with selectable text;
- DOCX;
- plain text / pasted content.

Image-only PDFs and scanned images should be detected as low-confidence or unsupported in the first implementation rather than silently producing garbage. OCR can be added later as an explicit capability with confidence and review.

### Stage 3: Normalize with confidence

Extracted content should be mapped into candidate evidence records with field-level confidence.

Examples:

- high confidence: clearly labeled employer + title + date range;
- medium confidence: a bullet appears associated with a role but layout is ambiguous;
- low confidence: an unlabeled number might be a metric, date, phone number, or unrelated text.

### Stage 4: Human confirmation

Low-confidence interpretation should be shown to the user for correction.

Import must never silently turn an ambiguous phrase into a skill, credential, accomplishment, date, or ownership claim.

## Writing strong evidence statements

Across Yale, MIT, Harvard, Penn, and Career-Ops, the exact mnemonic changes but the structure converges.

Examples include:

- Action + Project + Result;
- PAR: Project/Problem + Action + Result;
- SCO: Skill + Context + Outcome;
- X/Y/Z-style impact framing.

Sojourner should not worship one mnemonic. It should score for the underlying dimensions:

1. **Action:** what did the person actually do?
2. **Context:** where, for whom, or under what constraint?
3. **Skill/method:** what capability did the work demonstrate?
4. **Scope:** how large, complex, risky, frequent, or broad was it?
5. **Outcome:** what changed?
6. **Evidence:** what factual detail supports the claim?

Quantification is useful when real and meaningful, but fake precision is worse than no number.

Valid scope may be expressed through:

- team size;
- customer volume;
- revenue or budget;
- geographic area;
- systems/equipment supported;
- number of locations;
- throughput;
- uptime;
- response time;
- error reduction;
- cycle time;
- compliance results;
- project duration;
- stakeholders;
- complexity or criticality.

## Hard skills and soft skills should be represented differently

Penn's guidance is especially useful here:

- objective/measurable skills can appear in a Skills section;
- softer skills such as communication, leadership, collaboration, and teamwork are stronger when demonstrated through experience rather than merely listed.

Sojourner should therefore distinguish:

- **declared/verified skills** appropriate for a skills list;
- **demonstrated competencies** supported by evidence statements;
- **inferred capabilities** that require user confirmation before becoming profile facts.

## Tailoring: selection and translation, not invention

A safe tailoring pipeline should be explicit.

### Step 1: Analyze the target job

Separate requirements into:

- explicit must-have requirements;
- preferred requirements;
- responsibilities;
- domain vocabulary;
- credentials/licenses;
- tools/technologies;
- seniority/scope signals;
- logistics.

### Step 2: Map each requirement to candidate evidence

Classify each as:

- **direct evidence**;
- **supported equivalent / transferable evidence**;
- **ambiguous, ask user**;
- **gap / unsupported**.

Career-Ops' `existing / supportedByResume / gap` model is a strong precedent and should be adapted into Sojourner's native architecture.

### Step 3: Select and reorder

Choose the evidence that matters for this target rather than rewriting every historical fact.

### Step 4: Translate vocabulary carefully

If the job description uses a standard term that accurately describes the user's existing experience, Sojourner may use that term.

Example:

- source evidence: "serviced rooftop units and diagnosed electrical faults"
- target vocabulary: "commercial HVAC troubleshooting"
- legitimate tailoring: use the broader standard term because the evidence supports it.

Illegitimate tailoring would add BAS programming, refrigeration licensing, leadership, or a metric that never existed in the evidence.

### Step 5: Preserve the diff

Every tailored artifact should retain:

- source/master version;
- target job;
- selected evidence IDs;
- generated text;
- user edits;
- fact-gate result;
- ATS/structure result;
- final exported artifact;
- which application used it.

This is a natural fit for Sojourner because it already owns the application lifecycle.

## ATS compatibility should be deterministic and advisory

Career-Ops has a useful `verify-ats` pattern: structural checks are deterministic and separate from language-model writing.

Sojourner should implement its own native ATS/readability verifier that checks things such as:

- text layer exists;
- reading order is sane;
- standard headings where appropriate;
- no critical information is trapped in an image/header/footer;
- no hidden text or keyword stuffing;
- supported font embedding;
- no layout tables/multi-column structures in the ATS-safe export;
- contact data is extractable;
- exported file type matches the target application requirement;
- plain-text extraction resembles the visible document.

Important correction to avoid copying blindly from Career-Ops:

Education, Skills, or Work Experience should not be globally hard-required sections. Their requirement must depend on the document context and available evidence.

## Human-readability audit should be separate from ATS audit

A resume can parse perfectly and still be bad.

Sojourner should keep at least three separate review dimensions:

### Truth gate

Does every factual claim have evidence?

This should be hard-gated.

### Parseability gate

Will common systems plausibly extract the document correctly?

This can usually be advisory, except for critical failures such as image-only output or missing readable text.

### Relevance / reviewer gate

Does the document make a persuasive truthful case for this specific target?

This should be advisory and user-controlled.

Career-Ops' hiring-manager audit is a useful concept, especially the insistence that the reviewer context be role/company grounded and separate from the writer. Sojourner can eventually implement this as an optional advanced review without making inference mandatory for basic resume creation.

## Rendering architecture

Content and presentation must be separated.

Conceptually:

```text
source artifacts
      ↓
candidate evidence store
      ↓
target-job requirement map
      ↓
resume projection
      ↓
truth / structure / relevance checks
      ↓
renderer
      ├── ATS-safe PDF
      ├── DOCX
      ├── human-polished PDF
      ├── federal resume
      └── academic CV
```

The canonical content should not live only inside HTML, Markdown, DOCX, or PDF.

## Recommended initial renderers

### 1. ATS-safe professional resume

Default private-sector format:

- single column;
- conservative typography;
- configurable one/two-page target;
- modular sections;
- PDF + DOCX output;
- no critical content in headers/footers;
- plain-text extraction validation.

### 2. Hybrid career-transition resume

Same evidence model, different projection:

- qualifications/evidence summary near the top;
- skills or capability clusters where useful;
- chronological employment retained below;
- transferable evidence emphasized without obscuring dates.

### 3. Federal resume

Own ruleset based on USAJOBS requirements.

### 4. Academic/research CV

Own schema and flexible-length renderer.

Creative resume variants should come later. For many creative roles the safer strategy is still an ATS-safe resume plus a strong portfolio link rather than a highly decorative resume forced through an ATS.

## AI / inference boundary

Inference should improve the experience, not own the truth.

Good uses:

- identify likely section boundaries during import;
- suggest transferable skills from evidence;
- propose clearer accomplishment wording;
- suggest questions when an accomplishment lacks context or outcome;
- explain why evidence maps to a target requirement;
- generate alternate truthful phrasings;
- run an optional recruiter/hiring-manager review.

Bad uses:

- silently create skills;
- invent metrics;
- upgrade ownership or seniority;
- infer licenses/certifications as facts;
- convert a target-role keyword into claimed experience;
- replace ambiguous dates with guessed dates;
- rewrite source evidence without preserving provenance.

The user should be able to see and approve any new fact entering the canonical evidence store.

## Career-Ops: what Sojourner should harvest

Career-Ops is MIT licensed and contains several mature ideas worth adapting.

### Strong candidates to harvest conceptually or directly

- application-scoped resume artifact bundles;
- JD archival alongside each application;
- requirement-to-evidence classification;
- explicit unsupported-gap handling;
- deterministic fact verification before final render;
- deterministic ATS/structure verification;
- optional keyword coverage without making it the truth score;
- template/content separation;
- page-limit warnings rather than one universal limit;
- target-role relevance ordering;
- recruiter-side rapid-clarity review;
- optional hiring-manager audit after fact verification;
- preservation of what changed between tailored versions.

### Things Sojourner should not copy as universal policy

- tech-oriented section ordering;
- globally mandatory Education, Skills, Projects, or Work Experience sections;
- a fixed summary formula;
- a single typography/visual style;
- hard-coded project emphasis;
- assumptions that portfolio/GitHub evidence matters to every candidate;
- the idea that ATS optimization is equivalent to keyword density.

The value of Career-Ops here is the **pipeline discipline**, not its original candidate defaults.

## Proposed Sojourner domain model

The resume feature should probably introduce four durable domain concepts.

### Candidate Source Artifact

Original uploaded or pasted material.

### Candidate Evidence

Normalized, provenance-linked facts and accomplishment evidence.

### Resume Projection

A selected/ordered presentation of candidate evidence for a context or target role.

### Resume Artifact

The rendered PDF/DOCX plus audit results, hash, target application, and version history.

That separation allows a user to import one old resume, add facts once, and generate many application-specific outputs without losing the distinction between original evidence and generated prose.

## Product UX implications

The primary UI should not ask users to understand ATS theory.

A normal workflow could be:

1. **Add your resume** or **build from scratch**.
2. Sojourner extracts what it can.
3. User reviews uncertain facts.
4. Sojourner builds a reusable career evidence profile.
5. On a job page, user selects **Prepare application**.
6. Sojourner shows:
   - strong evidence;
   - missing/uncertain requirements;
   - proposed resume version;
   - plain-language changes from the source version.
7. User reviews and exports.
8. The exact resume version is attached to that application record.

Advanced controls can expose document type, template, page preference, and reviewer audits without making them first-run requirements.

## Benchmark corpus required before implementation is considered mature

Resume intelligence should be tested against deliberately different synthetic candidates rather than the developer's own career.

At minimum:

- skilled-trade technician;
- nurse or allied-health professional;
- retail/customer-service manager;
- warehouse/logistics worker;
- administrative/operations professional;
- software engineer;
- experienced program/product manager;
- recent graduate with limited paid work;
- career changer;
- senior executive;
- academic researcher;
- federal applicant.

Each benchmark should include:

- source resume or raw career facts;
- target JD;
- known gaps;
- expected evidence mappings;
- prohibited fabricated claims;
- expected document context;
- expected section choices;
- expected page guidance;
- parseability fixtures;
- expected final artifact metadata.

This is the resume equivalent of preventing Sojourner from accidentally becoming "HVAC + software developers: the application."

## Recommended implementation sequence

### Phase R0 — research and contract freeze

- finish research corpus;
- freeze terminology;
- define evidence/provenance contract;
- define document-context rules;
- define what is deterministic versus inference-assisted.

### Phase R1 — import and evidence normalization

- source artifact storage;
- PDF/DOCX/text extraction;
- confidence-aware normalization;
- user correction flow;
- canonical evidence persistence in SQLite.

### Phase R2 — resume builder from evidence

- build/edit evidence manually;
- ATS-safe professional renderer;
- PDF + DOCX;
- section-order and page guidance;
- deterministic truth and parseability gates.

### Phase R3 — target-job tailoring

- requirement extraction;
- evidence mapping;
- gap disclosure;
- role-specific selection and ordering;
- versioned application-scoped resume artifacts;
- user-visible diff.

### Phase R4 — advanced contexts

- hybrid/career-change projection;
- federal resume;
- academic CV;
- international market rules.

### Phase R5 — optional inference intelligence

- evidence clarification prompts;
- transferable-skill suggestions;
- accomplishment rewrite assistance;
- recruiter/hiring-manager audits;
- interview preparation seeded from the exact resume that was sent.

## Research verdict

The planned roadmap item should be renamed mentally from **Resume / Import Intelligence** to something closer to **Career Evidence and Resume Intelligence**.

The differentiator is not that Sojourner can generate a prettier PDF. Hundreds of products can do that.

The differentiator is that Sojourner can know:

- what the user has actually done;
- where each claim came from;
- what a particular opportunity requires;
- what evidence supports those requirements;
- what is missing;
- how the same truthful evidence should be presented to different consumers;
- which exact resume version was sent with which application;
- how that evidence should carry forward into interviews, follow-ups, negotiation, and future opportunities.

That turns resume building from an isolated document task into part of the Sojourner job-search system.

## Primary research sources

- MIT Career Advising & Professional Development, "Resumes": https://capd.mit.edu/resources/resumes/
- MIT CAPD, "Make your resume ATS-friendly": https://capd.mit.edu/resources/make-your-resume-ats-friendly/
- MIT CAPD, 2026 resume resources and tailoring/ATS guidance: https://capd.mit.edu/blog/2026/06/23/interphase-2026-resume-resources/
- Harvard FAS Mignone Center, "Harvard College Guide to Creating a Strong Resume": https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/
- University of Pennsylvania Career Services, resume guidance: https://careerservices.upenn.edu/channels/resume/
- University of Pennsylvania Career Services, graduate/postdoc resume guide: https://careerservices.upenn.edu/resources/resume-guide-for-graduate-students-and-postdocs/
- University of Pennsylvania Career Services, STEM CV guidance: https://careerservices.upenn.edu/stemcv/
- Yale Office of Career Strategy, "Writing Impactful Resume Bullets": https://ocs.yale.edu/resources/writing-impactful-resume-bullets/
- Yale Office of Career Strategy, resume resources: https://ocs.yale.edu/channels/resumes/
- Berkeley Career Engagement, resume format guidance: https://www.career.berkeley.edu/prepare-for-success/resumes/
- USAJOBS Help Center, federal resume requirements: https://help.usajobs.gov/faq/application/documents/resume/what-to-include
- USAJOBS Help Center, automated/human resume review myth guidance: https://help.usajobs.gov/working-in-government/myths/resume-scanned-for-keywords
- Greenhouse Support, supported resume upload formats: https://support.greenhouse.io/hc/en-us/articles/360052218132-Supported-formats-for-resumes-cover-letters-and-other-candidate-uploads
- Greenhouse Support, resume parse failure modes: https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse
- Workday Administrator Guide, resume parsing: https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/candidates/set-up-prospects-and-candidates/hdc1552497830785.html
- NACE, 2026 skills-based hiring adoption: https://naceweb.org/job-market/trends-and-predictions/employer-use-of-skills-based-hiring-practices-grows
- LinkedIn Engineering, semantic search for Hiring Assistant: https://www.linkedin.com/blog/engineering/ai/semantic-search-for-ai-agents-at-scale-retrieval-and-ranking-for-linkedins-hiring-assistant
- LinkedIn Engineering, Hiring Assistant candidate evaluation design: https://www.linkedin.com/blog/engineering/ai/how-we-engineered-linkedins-hiring-assistant
- Career-Ops repository: https://github.com/career-ops-hq/career-ops
- Career-Ops ATS mode: `modes/ats.md`
- Career-Ops PDF/tailoring pipeline: `modes/pdf.md`
- Career-Ops hiring-manager audit: `modes/pdf/hm-audit.md`
- Career-Ops JD skill-gap analyzer: `jd-skill-gap.mjs`
- Career-Ops fact-verification boundary: `verify-cv-facts.mjs`
