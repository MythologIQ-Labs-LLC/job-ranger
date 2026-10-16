# Canonical Architecture Index

**Authority:** canonical routing document for Job Ranger architecture decisions.  
**Effective decision:** 2026-10-16 (owner direction).  
**Status:** proposed on this branch until merged into `main`.

## Mandatory resolution rule

**All normative architecture interpretation starts here.** This index identifies the document authoritative for each architecture domain. A document, issue, draft, historical ADR, old release note, or implementation plan that contradicts the effective decisions here **is superseded for architecture** and must not be used to authorize new design or release obligations.

The index is the **single architecture decision router**, not a claim that every linked document is already internally consistent. Where an older canonical document contradicts an explicit current decision below, the supersession below controls until its source document is revised. Document conflicts must be flagged and corrected; do not silently infer authorization from contradictory text.

Truth is still distinguished by type:
- **Architecture policy:** this index and the active, index-designated normative documents.
- **Implemented capability:** exact current `main` source and tests; these may show legacy code, not permission to ship it.
- **Published reality:** actual publicly available build/deployment and tested behavior, not release plans.
- **Planned work:** proposals and draft branches are nonauthoritative until approved and integrated.

## Effective, binding decisions

| ID | Decision | Consequence |
| --- | --- | --- |
| ARCH-001 | **Progressive Web App is the sole intended product runtime and distribution channel.** Browser-accessible Job Ranger, including a bounded interactive demonstration linked from MythologIQ Studio, is the target. | No product roadmap commitment to a packaged Electron/NSIS/AppX/Microsoft Store/macOS desktop app. No native signing, notarization, Store certification, or installer release gate. |
| ARCH-002 | **Electron is an internal engineering harness**, retained when useful for local testing, simulation and regression qualification. | Keep working Electron tests and useful implementation components; do not label them supported end-user distribution. |
| ARCH-003 | **Demo is a deliberately limited real PWA experience**, separate from claims of full product availability. | Studio is a marketing/link handoff, not a second application runtime. Demo data must be identified and isolated; features not supported in browser must not be promised. Hosting and Studio production edits require explicit owner approval. |
| ARCH-004 | **Canonical career data stays user-owned and deterministic.** | Providers, agents, inference and external services cannot silently promote unverified facts, mutate canonical career truth, mass-apply or upload career data without specific human consent. |
| ARCH-005 | **Google Drive export, when shipped, requires a browser-appropriate OAuth flow and explicit artifact-level approval.** | Desktop loopback OAuth, native `safeStorage`, and Electron-only PR #334 do not satisfy PWA Drive acceptance. Browser credentials cannot rely on a packaged client secret. |
| ARCH-006 | **No unqualified publication claims.** | PWA browser production build, origin, service worker, persistence, privacy and security must be verified before an externally accessible demo or release is announced. |

## Canonical domain routing

| Domain | Canonical reference | Interpretation / supersession |
| --- | --- | --- |
| Product mission, career truth and authority | [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md); [`CONCEPT.md`](./CONCEPT.md) | Product authority remains normative subject to ARCH-001–006. |
| Runtime boundaries, browser data, worker adapters, PWA security | [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md) | PWA runtime mechanics remain normative; older localhost-only/default-self-hosted distribution assumption is superseded by ARCH-001/003. |
| Distribution and release channel policy | **This index (ARCH-001–003)** | [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md) is a **historical, superseded 2026-10-05 dual-channel decision**. Its PWA implementation evidence remains useful; its Microsoft Store/NSIS mainstream commitments do not apply. |
| Native packaging, signing, Store | [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md) | **Historical engineering reference only**; no shipping authority under ARCH-001/002. |
| Studio/demo PWA build identity and handoff | [Issue #311](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/311), and [`integrations/MYTHOLOGIQ_STUDIO_PWA_HANDOFF.md`](./integrations/MYTHOLOGIQ_STUDIO_PWA_HANDOFF.md) **when merged** | Draft branch `feature/studio-pwa-handoff-contract` is not normative until merged and qualified. |
| Inference trust limits | [`design/INFERENCE_CONTRACT.md`](./design/INFERENCE_CONTRACT.md) | Optional and proposal-only; no mandatory inference dependency in core PWA. |
| User stories and career workflow correctness | [`design/UNIVERSAL_USER_STORIES.md`](./design/UNIVERSAL_USER_STORIES.md) | Core deterministic acceptance, within browser-relevant scope. |
| Google Drive artifact consent/export | [Issue #314](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/314) for pending implementation; future reviewed **PWA** normative contract | Existing Electron-only docs/code and draft #315 are partial/historical implementation references, not a PWA shipping claim. |
| Governance process and compliance | [`GOVERNANCE_INDEX.md`](./GOVERNANCE_INDEX.md), [`../GOVERNANCE.md`](../GOVERNANCE.md) | Governance index covers evidence, policy and workflow; **not** an alternative architecture index. |
| PWA release acceptance and deployment permission | [`RELEASE_READINESS.md`](./RELEASE_READINESS.md), section **Current PWA release acceptance** | Native installer, Store, signing and notarization checklists below that section are historical, not PWA release gates. |
| Actual repo vs published state | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md), [`../CHANGELOG.md`](../CHANGELOG.md) | Factual snapshots, not independent architecture decisions. |

## Explicit supersession register

| Former claim or decision | Status effective 2026-10-16 | Replacement |
| --- | --- | --- |
| 2026-10-05 PWA **plus Microsoft Store native** dual-channel architecture | **Superseded** for future product distribution | ARCH-001, ARCH-002 |
| "Windows Store remains a first-class native runtime" | **Superseded** | Electron internal testing only |
| Unsigned desktop v1.3.0 release-candidate and native signing roadmap | **Withdrawn as product delivery goal** | Qualify actual PWA/browser build |
| PWA primarily localhost/self-hosted indefinitely, no hosted experience until external demand | **Superseded as exclusive rollout assumption** | Prepare separately approved HTTPS-hosted demo, with privacy and origin gates |
| Native Google Desktop OAuth client required to release Job Ranger | **Superseded for PWA release** | Browser-specific web OAuth requirement if Drive is enabled |
| #334 native Drive CI green = web Drive feature delivered | **Invalid inference** | Browser Drive must be separately implemented and validated |
| Existing v1.2.0 installer release | **Historical fact, not current roadmap** | A previously published artifact does not define supported future distribution |

## Change control

1. Propose changes through a reviewed PR that changes **this index first or in the same atomic PR** as any designated canonical domain document.
2. Record decision, reason, effective date, prior authority, affected interfaces, supersession and verification evidence.
3. Update index links and affected user-facing documentation in the same delivery slice. Do not leave contradictory normative entries knowingly active.
4. A draft PR, issue comment or older architecture plan cannot silently override this index. Raise the conflict for explicit review.
5. Do not repurpose unrelated historical documents as current policy, and do not delete implementation/test evidence merely because product distribution changed.
