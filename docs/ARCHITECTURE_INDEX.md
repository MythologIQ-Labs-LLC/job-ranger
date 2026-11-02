# Canonical Architecture Index

**Authority:** canonical routing document for Sojourner architecture decisions (legacy repository identifier: `job-ranger`).  
**Effective decision:** 2026-10-16 (owner direction); ARCH-001, ARCH-002 and ARCH-006 amended 2026-11-02 (owner direction: Windows first).  
**Status:** active on `main` since PR #335 (2026-10-16).

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
| ARCH-001 | **A signed Windows application is the primary product deliverable; the Progressive Web App continues as the universal, cross-environment channel.** Sojourner: Employment Toolkit (historically Job Ranger) ships first as a Windows installer. The browser PWA, including the bounded interactive demonstration linked from MythologIQ Studio, is kept and must not regress. | Windows releases are the Electron NSIS installer, Authenticode-signed with the MythologIQ Labs Azure Artifact Signing profile (publisher `MythologIQ Labs, LLC`) under the [Windows code signing standard](https://github.com/MythologIQ-Labs-LLC/Myth-Tech-Forge/blob/main/docs/WINDOWS_CODE_SIGNING_STANDARD.md). They are built and signed only by `release-build.yml` from a release tag, after owner approval of the `release` environment, which holds the GitHub OIDC sign-in (no client secret). Microsoft Store, macOS and Linux native packages stay out of scope unless separately approved. |
| ARCH-002 | **Electron is the Windows product runtime and remains the shared-core engineering harness.** | Electron test lanes are Windows release gates. The installed app's storage identity (`com.jobranger.app`, its user-data folder, `.jobranger` archives) does not change without a qualified migration, so existing v1.2.0 users upgrade in place. |
| ARCH-003 | **Demo is a deliberately limited real PWA experience**, separate from claims of full product availability. | Studio is a marketing/link handoff, not a second application runtime. Demo data must be identified and isolated; features not supported in browser must not be promised. Hosting and Studio production edits require explicit owner approval. |
| ARCH-004 | **Canonical career data stays user-owned and deterministic.** | Providers, agents, inference and external services cannot silently promote unverified facts, mutate canonical career truth, mass-apply or upload career data without specific human consent. |
| ARCH-005 | **Google Drive export, when shipped, requires a browser-appropriate OAuth flow and explicit artifact-level approval.** | Desktop loopback OAuth, native `safeStorage`, and Electron-only PR #334 do not satisfy PWA Drive acceptance. Browser credentials cannot rely on a packaged client secret. |
| ARCH-006 | **No unqualified publication claims.** | PWA browser production build, origin, service worker, persistence, privacy and security must be verified before an externally accessible demo or release is announced. A Windows installer is called signed only after `signtool verify /pa` passes with signer `MythologIQ Labs, LLC` and a timestamp, recorded in the release evidence. |

## Canonical domain routing

| Domain | Canonical reference | Interpretation / supersession |
| --- | --- | --- |
| Product mission, career truth and authority | [`ARCHITECTURE_PLAN.md`](./ARCHITECTURE_PLAN.md); [`CONCEPT.md`](./CONCEPT.md) | Product authority remains normative subject to ARCH-001–006. |
| Runtime boundaries, browser data, worker adapters, PWA security | [`design/PWA_RUNTIME.md`](./design/PWA_RUNTIME.md) | PWA runtime mechanics remain normative; older localhost-only/default-self-hosted distribution assumption is superseded by ARCH-001/003. |
| Distribution and release channel policy | **This index (ARCH-001–003)** | [`design/DISTRIBUTION_ARCHITECTURE.md`](./design/DISTRIBUTION_ARCHITECTURE.md) is a **historical, superseded 2026-10-05 dual-channel decision**. Its PWA implementation evidence remains useful; its Microsoft Store mainstream commitment does not apply, and its description of the NSIS installer as an unsigned advanced/test artifact is superseded by ARCH-001. |
| Windows packaging and signing | `electron-builder.windows.cjs`, `scripts/windows-sign.cjs`, `scripts/verify-windows-distribution.ps1`, `.github/workflows/release-build.yml`; the [Windows code signing standard](https://github.com/MythologIQ-Labs-LLC/Myth-Tech-Forge/blob/main/docs/WINDOWS_CODE_SIGNING_STANDARD.md) | The signed NSIS installer is the supported Windows channel (ARCH-001). [`design/MICROSOFT_STORE_PACKAGING.md`](./design/MICROSOFT_STORE_PACKAGING.md) stays a **historical engineering reference**; the Store is not a shipping channel. |
| Studio/demo PWA build identity and handoff | [Issue #311](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/311), and [`integrations/MYTHOLOGIQ_STUDIO_PWA_HANDOFF.md`](./integrations/MYTHOLOGIQ_STUDIO_PWA_HANDOFF.md) **when merged** | Draft branch `feature/studio-pwa-handoff-contract` is not normative until merged and qualified. |
| Inference trust limits | [`design/INFERENCE_CONTRACT.md`](./design/INFERENCE_CONTRACT.md) | Optional and proposal-only; no mandatory inference dependency in core PWA. |
| User stories and career workflow correctness | [`design/UNIVERSAL_USER_STORIES.md`](./design/UNIVERSAL_USER_STORIES.md) | Core deterministic acceptance, within browser-relevant scope. |
| Google Drive artifact consent/export | [Issue #314](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/314) for pending implementation; future reviewed **PWA** normative contract | Existing Electron-only docs/code and draft #315 are partial/historical implementation references, not a PWA shipping claim. |
| Governance process and compliance | [`GOVERNANCE_INDEX.md`](./GOVERNANCE_INDEX.md), [`../GOVERNANCE.md`](../GOVERNANCE.md) | Governance index covers evidence, policy and workflow; **not** an alternative architecture index. |
| Release acceptance and deployment permission | [`RELEASE_READINESS.md`](./RELEASE_READINESS.md): **Current PWA release acceptance** for the PWA; for Windows, section **7. Windows direct-download (NSIS) package validation** plus the signing evidence above | Until that document is revised, its section 7 is reinstated as the Windows release gate, with signing **required** for any published installer (its "advanced/test channel" label is superseded). The Store (7a), macOS (8) and notarization checklists stay historical. |
| Actual repo vs published state | [`SYSTEM_STATE.md`](./SYSTEM_STATE.md), [`../CHANGELOG.md`](../CHANGELOG.md) | Factual snapshots, not independent architecture decisions. |

## Explicit supersession register

| Former claim or decision | Status effective 2026-10-16 | Replacement |
| --- | --- | --- |
| 2026-10-05 PWA **plus Microsoft Store native** dual-channel architecture | **Superseded** for future product distribution | ARCH-001, ARCH-002 |
| "Windows Store remains a first-class native runtime" | **Superseded** | Signed direct-download Windows installer (ARCH-001) |
| Unsigned desktop v1.3.0 release-candidate and native signing roadmap | **Withdrawn 2026-10-16; signed Windows delivery reinstated 2026-11-02** | ARCH-001: signed installer through the OIDC release pipeline; an unsigned installer is never published |
| 2026-10-16 ARCH-001 "PWA is the sole intended product runtime and distribution channel" | **Superseded 2026-11-02** (owner: a Windows signer now exists; Windows is the primary focus and the PWA continues) | ARCH-001 (Windows first, PWA continuing) |
| 2026-10-16 ARCH-002 "Electron is an internal engineering harness" only | **Superseded 2026-11-02** | ARCH-002 (Windows product runtime and engineering harness) |
| PWA primarily localhost/self-hosted indefinitely, no hosted experience until external demand | **Superseded as exclusive rollout assumption** | Prepare separately approved HTTPS-hosted demo, with privacy and origin gates |
| Native Google Desktop OAuth client required to release Job Ranger | **Superseded for PWA release** | Browser-specific web OAuth requirement if Drive is enabled |
| #334 native Drive CI green = web Drive feature delivered | **Invalid inference** | Browser Drive must be separately implemented and validated |
| Existing v1.2.0 installer release | **Historical fact, not current roadmap** | A previously published artifact does not define supported future distribution |

## Commercial brand decision boundary (owner update: 2026-10-28)

**The owner-selected product identity is Sojourner, displayed as `Sojourner: Employment Toolkit`.** This replaces the former public-facing name `Job Ranger`. The October 16 pending-name instruction and earlier Pathwise/Trailmark candidate research are superseded for **product naming** by [issue #339](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/339). MythologIQ Labs, LLC remains the corporate maintainer.

**Implementation approval is not a trademark-clearance or production-deployment approval.** The existing repository slug, package/runtime identifiers, PWA storage namespace and origin, service-worker update identity, legacy `.jobranger` archives and historical release links remain unchanged until a separately qualified compatibility migration. Make user-visible Sojourner copy and cohesive replacement artwork in one bounded, reviewed rebrand candidate; do not ship a mixed Job Ranger/Sojourner UI, reset existing user data, or rename OAuth redirect origins or signing IDs as a cosmetic operation. New public hosting, Studio production changes, DNS, trademark representations and launch communication retain their separate approval gates. The runtime decision is ARCH-001 (Windows first, PWA continuing, since 2026-11-02); Google Drive delivery scope is unchanged.

## Change control

1. Propose changes through a reviewed PR that changes **this index first or in the same atomic PR** as any designated canonical domain document.
2. Record decision, reason, effective date, prior authority, affected interfaces, supersession and verification evidence.
3. Update index links and affected user-facing documentation in the same delivery slice. Do not leave contradictory normative entries knowingly active.
4. A draft PR, issue comment or older architecture plan cannot silently override this index. Raise the conflict for explicit review.
5. Do not repurpose unrelated historical documents as current policy, and do not delete implementation/test evidence merely because product distribution changed.
