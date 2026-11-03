# ADR-0001: Personal-brand publishing and analytics authority

- Status: Accepted
- Date: 2026-10-08
- Supersedes: None
- Superseded by: None

## Context

Sojourner owns Career Ops: career direction, factual Career Evidence, opportunity evaluation, application materials, application lifecycle, search learning, and the user's decisions about where to spend professional effort.

Professional presence is part of that system.

A person's public writing, project demonstrations, technical commentary, career observations, and other professional content can affect recruiter discovery, reputation, network growth, inbound conversations, and future opportunities. Managed publishing is therefore useful, but scheduling alone is not the differentiated value. The important capability is learning which professional communication improves the user's career outcomes.

Viable is also developing social publishing and analytics, but its authority is productization: product truth, marketability, campaigns, distribution, and product-market learning. Using Viable as the canonical personal-brand system would cross that product boundary.

The same provider APIs may therefore be appropriate in both products. Architectural duplication is acceptable when it preserves product authority and prevents one product from becoming a required subsystem of the other.

## Decision

Sojourner will treat personal-brand publishing and analytics as a bounded Career Ops domain.

The required baseline is deterministic and inference-free. Sojourner must not require an LLM or other model to create a Presence Brief, guide the user's composition, check evidence/readiness, approve exact content, publish it, collect analytics, calculate metrics, compare cohorts, or produce threshold-based advisory learning. A future optional language-assistance feature may be added only as a proposal layer under the existing inference contract and may not replace or weaken this deterministic path.

Its purpose is to help a person make evidence-backed professional communication decisions and learn which content improves professional discovery and career outcomes.

Sojourner does not become a general marketing platform, company-page campaign manager, product-launch operating system, or multi-brand social suite.

The canonical loop is:

```text
Career direction / Career Evidence / professional objective
  -> personal-brand hypothesis
  -> evidence-backed draft
  -> human review and approval
  -> publish
  -> provider evidence
  -> time-series analytics snapshots
  -> personal-brand interpretation
  -> career outcome
  -> learning
  -> next professional communication decision
```

### Domain ownership

Sojourner may own:

- personal professional positioning;
- target-audience intent such as recruiters, hiring managers, peers, founders, or a technical community;
- evidence-backed professional topics;
- publishing to an individual's supported social profile;
- personal-post analytics;
- professional-profile analytics;
- career-relevant conversion evidence;
- recommendations about future personal-brand content.

Sojourner does not own:

- a product's ICP;
- product positioning;
- company/organization social strategy;
- launch campaigns;
- product-market conversion;
- organization-page analytics;
- generalized brand or marketing operations.

A user's own project may appear in Sojourner content when it is being used as truthful evidence of the person's work, expertise, or professional identity. That does not transfer product-marketing authority into Sojourner.

### Career truth and drafting

Personal-brand content must inherit Sojourner's truth boundary.

Career Evidence may support claims about:

- work performed;
- projects built;
- outcomes achieved;
- skills demonstrated;
- credentials;
- publications;
- other factual professional evidence.

Inference may propose wording only under the existing inference contract. It may not invent accomplishments, employers, metrics, relationships, credentials, or expertise.

A social post is not automatically Career Evidence. Published content may reference Career Evidence, and later professional outcomes may become evidence of public work or professional activity only through an explicit evidence workflow.

### Publication experiment record

Each personal-brand publication should preserve:

- professional objective;
- selected Target Track when relevant;
- intended audience;
- exact approved content/version;
- topic/professional theme;
- hook/opening archetype;
- tone;
- format/media;
- scheduled time, actual publication time, and timezone;
- provider publication identifier;
- source Career Evidence or project references;
- experiment hypothesis;
- expected career outcome.

### Analytics snapshots

Sojourner should preserve time-stamped snapshots rather than only the latest metric totals.

Where provider access supports them, snapshots may include:

- impressions;
- members/users reached;
- in-network versus out-of-network distribution;
- reactions;
- comments;
- reposts/shares;
- saves;
- sends;
- link clicks;
- video plays/watch time;
- profile views attributable to content;
- followers gained from content.

Each observation retains source, timestamp, window, evidence state, and any provider limitation.

Unavailable is not zero.

If demographic analytics are unavailable through a supported API, a manually recorded demographic observation may be stored as manual evidence, clearly distinguished from provider-connected metrics.

### Derived measures

Sojourner may calculate:

- impressions per member reached;
- early distribution velocity;
- out-of-network share;
- engagement per member reached;
- comment rate;
- repost rate;
- save rate;
- profile-view conversion;
- follower conversion;
- link-click conversion;
- career-outcome conversion.

Derived metrics must identify their inputs and formula.

### Career outcomes

The highest-value signals are professional outcomes rather than raw attention.

Where observable or user-recorded, Sojourner may track:

- recruiter profile visits;
- relevant new followers or connections;
- recruiter or hiring-manager inbound messages;
- portfolio or GitHub visits attributable to a post;
- invitations to discuss work;
- interviews;
- referrals;
- consulting or speaking inquiries;
- job opportunities;
- other user-defined career outcomes.

Sojourner must not assume every social interaction is career value. Audience relevance and stated objective matter.

### Learning and recommendations

Sojourner may recommend:

- professional themes;
- hook families;
- tone;
- post format;
- timing windows;
- media choice;
- content cadence;
- follow-up topics.

Recommendations are advisory.

Sojourner must not infer a universal best posting time from generic social-media advice, nor claim one post proves causality.

Timing recommendations require repeated comparable observations. Topic, hook, tone, format, media, audience, and time should be treated as separate experiment variables where practical.

A high-engagement post that attracts an audience poorly aligned with the user's career direction may be scored as weak personal-brand performance. A lower-reach post that produces recruiter interest, relevant followers, or opportunities may be scored as high-value.

### Publishing authority

Publishing is an externally consequential action.

Sojourner must require explicit user approval for the exact content and destination before publication unless a future bounded scheduling policy is separately approved by architecture and product governance.

The first implementation should favor exact approved content over execution-time rewriting.

Automatic retries must not create duplicate public posts after an ambiguous provider outcome.

### Provider capability boundary

Provider adapters must distinguish:

- authentication/identity;
- publishing;
- publication identity retrieval;
- post analytics;
- profile analytics;
- media analytics;
- comment/content retrieval;
- demographic analytics.

Successful publication does not imply analytics entitlement.

For LinkedIn, self-service posting permissions and vetted Community Management analytics access are separate capabilities. Sojourner must represent that distinction directly.

### Boundary with Viable

Sojourner and Viable may both implement LinkedIn/social publishing and analytics.

This is acceptable and intentional.

- Sojourner optimizes the professional presence of a person.
- Viable optimizes the market presence of a product.
- Sojourner does not depend on Viable.
- Viable does not depend on Sojourner.
- Credentials, workspaces, publication records, analytics, and learning remain product-local.
- No product may silently read the other's canonical state.
- A future shared library is permitted only for stateless/mechanical provider protocol code. It must not own Career Ops semantics, productization semantics, approval policy, storage, or recommendation logic.

If one personal-profile post could plausibly serve both purposes, the user's declared intent determines which product owns the workflow. A post about a project as evidence of the user's expertise belongs in Sojourner. A post intended to acquire users or validate product positioning belongs in Viable.

## Consequences

### Positive

- personal branding becomes a coherent Career Ops capability rather than a detached social scheduler;
- Sojourner can learn from real professional outcomes, not just application outcomes;
- the same Career Evidence truth boundary protects public professional claims;
- timing, topic, hook, and format recommendations can become user-specific over time;
- provider metrics are separated from career value;
- manual analytics remain possible when provider access is unavailable;
- Sojourner and Viable retain clean product boundaries even when capabilities overlap.

### Negative

- social-provider functionality may be duplicated across Sojourner and Viable;
- provider integrations add credential, permission, quota, and policy maintenance;
- some valuable LinkedIn analytics may require app approval unavailable to ordinary users or developers;
- demographic and qualitative comment analysis may remain partially manual;
- causal learning requires enough comparable posts and cannot be rushed;
- career outcomes may require user confirmation when provider attribution is unavailable.

## Alternatives considered

### Use Viable for personal branding

Rejected. Viable is a productization operating system. Making it the personal-brand authority would collapse a deliberate product boundary.

### Keep Sojourner limited to job applications

Rejected. Professional discovery and positioning affect career outcomes before an application exists and therefore fit the broader Career Ops model.

### Add only a generic social scheduler

Rejected. Scheduling is commodity plumbing. The differentiated value is evidence-backed content plus career-specific analytics and learning.

### Share one social workspace with Viable

Rejected. That would create cross-product authority, privacy, migration, and coupling problems. Similar provider mechanics do not justify shared canonical state.

### Optimize for impressions or engagement rate

Rejected. Reach and engagement are intermediate signals. Sojourner should optimize for professional positioning and career-relevant outcomes.

### Automatically generate and publish based on analytics

Rejected. Analytics can recommend the next experiment but do not create publication authority.

## Implementation implications

- introduce a Personal Brand / Professional Presence bounded context in the Sojourner architecture;
- add a publication experiment record linked optionally to Target Tracks, Career Evidence, projects, and professional objectives;
- add exact-content approval and provider destination records;
- add provider-neutral publishing and analytics capability interfaces;
- keep credentials outside portable career data and store only opaque references where native secure storage is available;
- add immutable/time-stamped analytics snapshots;
- support manual metric/demographic entry with explicit provenance when connected analytics are unavailable;
- add deterministic derived-metric calculations;
- add career-outcome events and user confirmation where attribution is uncertain;
- add comparison views by objective, audience, topic, hook, format, and timing window;
- keep recommendations explainable and advisory;
- reuse the existing inference contract for optional drafting assistance;
- preserve local-first behavior and avoid requiring a hosted Sojourner account;
- do not introduce a Viable runtime dependency.

## Related requirements and documents

- `docs/CONCEPT.md`;
- `docs/ARCHITECTURE_PLAN.md`;
- `docs/design/INFERENCE_CONTRACT.md`;
- `docs/design/CAREER_EVIDENCE_PERSISTENCE_CONTRACT.md`;
- `docs/design/SEARCH_LEARNING.md`;
- `docs/DISTRIBUTION_TRUST.md`;
- Viable ADR-0011: productization publishing analytics and learning authority.
