# Product Concept

## Purpose

Sojourner helps ordinary job seekers discover, monitor, evaluate, prepare for, and manage paths to employment from a private desktop workspace without requiring software-development expertise, a cloud account, or an AI provider just to get started.

Sojourner is a **Career Ops** product, not an application-volume optimizer. Its job is to help the user understand who they are, what kind of work and environment they want, which career directions deserve investment, which companies and people may provide useful paths, and which opportunities are worth pursuing intentionally.

The resume is evidence about the person. It is not the person's identity, and it is not the sole input to discovery.

The product's preferred progression is:

> **Person → Career Direction → Companies → People → Opportunities → Applications**

That sequence is directional rather than mandatory. A user may enter through an existing job, a company, a contact, a resume, or a career goal. Sojourner should still orient the workflow around finding a good path to employment rather than maximizing the number of applications sent.

The product is not built around one occupation, one employment model, or one conventional career path. Its user-facing contract is defined through universal user stories and validated against materially different career contexts.

## North-star user story

> **US-0:** As a job seeker, I want Sojourner to adapt to the way my career works without requiring me to understand how Sojourner works.

The full catalog lives in [`design/UNIVERSAL_USER_STORIES.md`](./design/UNIVERSAL_USER_STORIES.md).

## Product shape

The latest published release is **v1.2.0**, which ships the workflow below as a desktop app. Current `main` adds a local-first web/PWA runtime and Microsoft Store packaging that are not yet published.

The implemented workflow now spans:

- progressive onboarding;
- multiple Target Tracks;
- local Career Evidence import and direct authoring;
- source monitoring plus partial consumer source discovery;
- explainable opportunity assessment;
- evidence-backed resume creation and tailoring;
- exact submitted-artifact history;
- application contacts, milestones, reminders, interviews, and offers;
- evidence-grounded interview preparation;
- reusable Career Stories;
- evidence-grounded application materials;
- Search Insights and recurring-gap analysis;
- verified local backup/restore;
- JSON Resume interoperability.

This breadth does not change the product's authority model. Career Evidence remains factual truth; Target Tracks remain intent; Applications own lifecycle state; external services remain adapters.

## Design principles

### Quality over quantity

Sojourner should optimize for **qualified, intentional progress**, not activity volume.

Application count is not a success metric by itself. A smaller set of well-understood opportunities that fit the user's direction, constraints, evidence, and preferences is preferable to a large queue of weak matches.

The product should reduce the cost of good judgment rather than remove judgment from the process. Discovery, monitoring, analysis, preparation, reminders, and path-finding can be highly automated. Consequential external actions remain intentional and user-controlled.

When future Career Ops capabilities expand beyond specific openings, they should help the user identify promising companies, relationships, introductions, communities, recruiters, hiring managers, professional-presence opportunities, or other legitimate paths to employment without encouraging indiscriminate or automated outreach.

Professional presence is part of Career Ops when the objective is the person's career rather than marketing a product. Sojourner may guide evidence-backed personal content, exact user-approved publication, and analytics-based learning about professional discovery and career outcomes. That capability must remain useful without inference and must not become a general company-brand or product-marketing system. The accepted boundary is [ADR-0001](./adr/0001-personal-brand-publishing-and-analytics.md).

### Person before resume

Sojourner should learn from more than the document representing the user's previous work.

Career Evidence establishes what the user can truthfully prove. Career Profile, Target Tracks, preferences, constraints, outcomes, and user-authored career direction describe what the user wants to become and how they want to work.

Experience is evidence for future choices, not a command to repeat the past indefinitely.

### Consumer first

A person looking for work should not need to understand GitHub, Node.js, YAML, scraping architecture, model providers, agent terminology, or ATS vendor taxonomy to use Sojourner.

Implementation sophistication should reduce user cognitive load rather than export it into the interface.

### Universal core, bounded extensions

Sojourner models the person, the opportunity, and the evidence without assuming what a “normal” career looks like.

The core remains shared across career contexts. Occupation-specific concepts such as licenses, clearances, shift requirements, grade systems, portfolios, or specialized document formats may be represented through bounded vocabularies/rules where evidence demonstrates the need.

Universality does not justify an unbounded entity/attribute/value model that erases meaning merely because it can technically store anything.

### Local first

Core search state belongs on the user's machine by default.

A remote service must earn its place through a concrete benefit, explicit disclosure, and security/privacy review. Backup/restore exists before cloud sync because portability is useful without requiring an account.

### Deterministic before inferential

Discovery, persistence, monitoring, evidence review, requirement mapping, opportunity assessment, resume creation/tailoring, application materials, interview prep, Career Stories, lifecycle tracking, and Search Insights all have deterministic paths.

Optional inference may improve semantic interpretation or language later, but it should make Sojourner more capable rather than deciding whether the product is usable.

### Evidence before confidence

Sojourner must not invent user experience, credentials, compensation, employer requirements, application history, relationships, referrals, or outcomes.

Career Evidence, not a resume or model response, is the canonical factual career domain.

Imported information remains proposed until the user grants factual authority. Historical materials preserve what was true/used at the time and can become visibly stale when current evidence changes.

### Preferences are not constraints

Remote work, compensation, commute, schedule, employment arrangement, and similar search choices must preserve their intended strength. A preference is not silently promoted to a blocker.

### Explain fit, do not simulate certainty

Sojourner separates:

- eligibility;
- evidence coverage;
- career alignment;
- preference alignment;
- blockers;
- unknowns.

Unknown information remains unknown. A single opaque percentage must not be presented as a hiring prediction or universal truth.

### Honest source support

Career sites vary wildly.

Sojourner distinguishes structured supported adapters, detected best-effort paths, browser-required sources, and manual-review cases. Discovery remains separate from acquisition, and a discovered source does not become trusted/monitored without explicit user approval.

### User authority

Sojourner is a decision-support tool.

It can find, organize, explain, prepare, remind, preserve, analyze, and eventually surface useful relationship paths. The user remains responsible for consequential external actions, including submitting an application or contacting another person.

### Historical truth matters

The product must preserve what actually happened:

- what source text Sojourner saw;
- what Career Evidence existed at the time;
- what resume was submitted;
- what application material was prepared;
- how evidence was corrected later;
- what outcomes were observed.

A later correction should improve current truth without rewriting history.

## What Sojourner is not

Sojourner is not currently:

- a recruiter-facing applicant tracking system;
- a hosted job-search social network;
- a mandatory cloud-account product;
- an AI-only career assistant;
- an autonomous mass-application bot;
- an application-throughput optimizer;
- a system for high-volume automated networking or outreach;
- a guarantee that every third-party career page can be extracted successfully;
- a prediction engine that can know whether an employer will hire the user;
- a collection of occupation-specific profile forks;
- a generic agent/runtime platform looking for a reason to exist.

## Current product frontier

The completion of the Universal User Stories and Career Evidence programs does not mean there are no remaining ideas.

The strongest current **needed** gaps are:

1. fuller/canonical job-description preservation where source capabilities permit it;
2. better dynamic-source failure diagnostics and reliability measurement;
3. publishing a new release containing the product already implemented on `main`.

Current **candidate** ideas include broader discovery providers, faster arbitrary-job capture, reusable application-question answers, bounded user-controlled form assistance, broader Career Ops relationship/networking paths, company targeting before a specific opening exists, calendar mirroring, and mock-interview practice.

Personal Brand / Professional Presence is no longer merely a candidate product idea: its architecture is accepted under ADR-0001, while implementation remains pending under issue #171. The first planned slice is deterministic composition guidance and exact-content approval, followed by manual analytics/learning before connected provider work.

Issue [#121](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/121) governs the next design pass for relationship-path discovery and intentional pursuit. It is a candidate direction, not a claim that those capabilities are already implemented.

Current **deferred** capabilities include remote inference, OCR, DOCX resume export, specialized federal/academic document projections, cloud sync, and Linux packaging until evidence justifies the complexity.

See [`PRODUCT_GAP_REVIEW.md`](./PRODUCT_GAP_REVIEW.md).

## Success standard

The practical acceptance test remains:

> Can a nontechnical job seeker install Sojourner, understand what to do next, identify worthwhile paths and opportunities, prepare truthful materials, and manage their search without needing the person who built it sitting beside them?

The quality test is:

> Does Sojourner help the user make better career decisions and produce qualified downstream progress without training them to treat application count as achievement?

The universality test remains:

> Does that workflow stay coherent when the user is hourly, salaried, licensed, portfolio-heavy, early-career, executive, changing careers, seeking government work, contracting, or returning after a nonlinear career history?

The release test adds a final question:

> Can the repository prove that the downloadable installer actually contains the capabilities the documentation claims it contains?

If any answer is no, the product still has work to do regardless of how elegant the architecture looks on a diagram.
