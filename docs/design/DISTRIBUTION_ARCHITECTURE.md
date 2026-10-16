# Distribution Architecture

> **SUPERSEDED for current product distribution (2026-10-16).** This documents the historical 2026-10-05 dual-channel decision. The authoritative replacement is [Canonical Architecture Index](../ARCHITECTURE_INDEX.md), ARCH-001–003: PWA-only user distribution; Electron retained as an internal testing harness; no native app/Store/signing release track. Statements below about a first-class Microsoft Store app, localhost-only rollout assumptions, and required native distribution are **historical**, not normative. Preserve technical implementation evidence as history.


**Status:** Accepted architectural direction  
**Decision date:** 2026-10-05  
**Applies after:** v1.2.0  
**Related issues:** #125, #130, #133

## Decision

Job Ranger will use a dual-channel distribution architecture:

1. **Cross-platform primary runtime:** an installable local-first web application / Progressive Web App (PWA). Before demonstrated external demand, the default delivery model is self-hosted on the user's own localhost rather than a public cloud origin.
2. **Windows native mainstream:** a Microsoft Store package produced from the existing Electron application, initially using the established electron-builder v26 `appx` target unless implementation evidence justifies a different Store package target.

PWA-first does **not** mean cloud-hosted-first. A public HTTPS origin is a distribution milestone for ordinary external users, not a prerequisite for development, dogfooding, trusted testing, or product-demand validation.

The PWA is not a reduced or promotional edition. It is intended to become a first-class Job Ranger runtime with functional parity wherever browser capabilities can safely provide the required behavior.

The Windows Store application remains a first-class native runtime where native capabilities materially improve the product.

## Implementation status

The architecture is implemented on the post-v1.2.0 development line (merged via #142; evidence: [`../validation/DISTRIBUTION_IMPLEMENTATION_2026-10-05.md`](../validation/DISTRIBUTION_IMPLEMENTATION_2026-10-05.md)). Status words follow [`../SYSTEM_STATE.md`](../SYSTEM_STATE.md): *implemented* means merged; *shipped* requires a published supported channel.

| Track | State | Evidence / remaining external step |
| --- | --- | --- |
| Shared core and runtime adapters | Implemented | Shared modules run unchanged in both runtimes. `src/pwa/adapter-map.ts` is enforced by `tests/runtime-adapter-contract.test.mjs`. 18 shared-core suites pass on the SQLite WASM engine |
| Web/PWA runtime | Implemented, **not deployed** | Design and parity matrix: [`PWA_RUNTIME.md`](./PWA_RUNTIME.md). The browser suite runs in CI (`pwa.yml`). A production deployment needs a header-capable HTTPS origin (`deploy-pwa.yml`). Firefox, Safari, and real-device install validation are pending |
| Portable data boundary | Implemented | `.jobranger` archive. Electron→PWA, PWA→Electron, and corruption/version rejection are tested in the browser suite |
| Microsoft Store package | Implemented; package validation in CI; **certification pending** | Design: [`MICROSOFT_STORE_PACKAGING.md`](./MICROSOFT_STORE_PACKAGING.md). `windows-store-package.yml` builds, verifies, installs, and smoke-tests inside the package context. Partner Center identity, submission, and certification remain external |
| Store/NSIS coexistence | Implemented | Isolated Store data root; explicit read-only import of historical NSIS data; uninstall behavior recorded by CI |
| Provenance | Implemented | SHA-256 files, release manifests (`windows`, `windows-store`, `web`), and GitHub artifact attestations. Azure Artifact Signing is opt-in only (`vars.JOB_RANGER_REQUIRE_WINDOWS_SIGNING`) |
| Native macOS / Linux | Not part of the target architecture | macOS release job runs only on manual dispatch, for historical/advanced use |

## Why this decision exists

Public code-signing certificates are useful for publisher identity and native OS trust, but they are not the only defensible software-distribution trust model and must not become a mandatory economic or operational dependency for Job Ranger.

The accepted model separates:

- **distribution trust**: how an ordinary user obtains and installs Job Ranger safely;
- **artifact provenance**: how a build can be traced to source and release automation;
- **runtime security**: what authority the application receives after installation;
- **product architecture**: which capabilities genuinely require a privileged native runtime.

This prevents certificate acquisition from becoming a release gate when a platform-owned trusted distribution channel or sandboxed web runtime can provide a better user experience.

## Supported distribution model

### Cross-platform PWA

The PWA is the primary cross-platform distribution target.

Target environments include modern supported browsers on:

- Windows;
- macOS;
- Linux;
- other desktop environments where required browser APIs are available and validated.

The PWA should be installable where the browser/OS supports installation or standalone web-app behavior. Ordinary browser use remains valid where installation is unavailable.

The PWA must preserve Job Ranger's local-first principle. Web delivery does **not** imply that Career Evidence, applications, resumes, or other personal career data become server-authoritative.

### Pre-demand localhost distribution

Until there is evidence that public distribution is warranted, Job Ranger may be built and served entirely on the user's own machine.

- `localhost` / loopback is the preferred dogfood and trusted-tester origin.
- Each tester runs their own local instance; one developer machine is not treated as a shared LAN production host.
- The project must use a stable canonical localhost origin for persisted test profiles. Because browser storage is origin-bound, the local server must not silently change hostnames or ports when its configured port is occupied.
- A busy configured port should fail with a clear recovery message rather than quietly selecting a different port and making existing local data appear missing.
- Ordinary interaction, domain logic, SQLite-WASM/OPFS persistence, IndexedDB state, service-worker behavior, and offline use remain local. The static server only serves the application shell and updates.
- Moving later from localhost to a public HTTPS origin is an origin migration. Users migrate through the versioned `.jobranger` portable backup/import contract rather than by assuming browser storage transfers between origins.

This local self-hosted stage is deliberately cheap. Public hosting is earned by external demand, not required to discover whether that demand exists.

### Windows Microsoft Store

The Microsoft Store is the primary supported native Windows distribution channel.

The Store path should:

- package the existing Electron application for Store certification;
- use the Store's package signing/certification trust path rather than requiring Job Ranger to own a separate public code-signing certificate for the Store-delivered package;
- use Store-managed installation/update behavior;
- preserve Job Ranger's current Electron security boundaries;
- validate packaged SQLite, local data paths, backup/restore, document import/export, source acquisition, and upgrade behavior under packaged-app constraints.

The initial implementation should prefer the already-established electron-builder v26 `appx` target evaluated in #133 rather than changing packaging infrastructure merely for naming consistency. A later MSIX migration is allowed only when the toolchain is mature enough and the change earns its migration/testing cost.

## Runtime architecture direction

The current product is Electron-first. That is implementation truth, not a permanent architectural requirement.

The accepted evolution is toward a shared domain/application core consumed by multiple runtimes:

```text
                         ┌─────────────────────────────┐
                         │   Job Ranger domain/core    │
                         │                             │
                         │ Career Evidence             │
                         │ Target Tracks               │
                         │ Opportunities / assessment  │
                         │ Applications / lifecycle    │
                         │ Resume / materials          │
                         │ Stories / interview prep    │
                         │ Search Insights             │
                         └──────────────┬──────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
                    ▼                                       ▼
        ┌────────────────────────┐              ┌────────────────────────┐
        │ Web / PWA runtime      │              │ Windows native runtime │
        │                        │              │ Electron + Store       │
        │ Browser storage        │              │ SQLite                 │
        │ OPFS / IndexedDB       │              │ Native filesystem      │
        │ Service worker         │              │ Native integrations    │
        │ Browser file APIs      │              │ Packaged app services  │
        └────────────────────────┘              └────────────────────────┘
```

The shared core owns domain rules. Runtime adapters own environment-specific persistence, filesystem, packaging, notification, and acquisition mechanics.

No runtime may become a second source of product truth.

## PWA capability requirements

Before the PWA can be called mainstream, implementation must explicitly evaluate and validate at least:

- local durable persistence using browser-supported storage such as OPFS and/or IndexedDB;
- migration/versioning semantics comparable to the current SQLite schema discipline;
- resume and Career Evidence import from user-selected files;
- deterministic PDF generation and the existing Truth/Parseability guarantees, or a documented equivalent boundary;
- backup/export and restore/import without hidden server dependency;
- source discovery and source acquisition within browser networking/security constraints;
- offline/limited-connectivity behavior where practical;
- service-worker update behavior that cannot silently corrupt local state;
- notification/reminder capability and its browser limitations;
- credential/secret handling without weakening current security assumptions;
- accessibility and browser compatibility;
- storage quota/eviction behavior and clear user-facing backup guidance.

A native-only capability must be identified as such because of a concrete platform limitation, not because the current Electron implementation happens to use Node.js.

## Capability parity rule

The product contract is shared across runtimes.

The PWA should provide the same meaningful Career Ops workflows wherever technically reasonable. It must not become a permanently diminished "Job Ranger Lite" edition.

Acceptable differences are environment capabilities, for example:

- filesystem access;
- background scheduling;
- notification behavior;
- browser automation/acquisition limits;
- operating-system integrations.

Any runtime-specific limitation must be explicit in UI/help text and must not silently weaken Career Evidence authority, Truth Gate behavior, or user-control boundaries.

## Persistence boundary

The current Electron runtime continues to use SQLite and managed local artifacts.

The PWA may use a different persistence engine, but canonical domain semantics must remain stable across runtimes. Persistence adapters must preserve:

- record identity;
- evidence provenance and lineage;
- application history;
- immutable submitted-artifact relationships;
- migration/version semantics;
- backup/export integrity.

Cross-runtime migration or interchange should use a versioned portable backup/export contract rather than coupling one runtime directly to another runtime's database implementation.

## Trust model

### Microsoft Store

For the Store-delivered Windows application, Store certification and Microsoft-managed signing are the normal-user installation trust boundary.

Repository provenance remains independently valuable and should continue to include checksums, manifests, immutable release/tag relationships, packaged-runtime smoke, and additional attestations where useful.

### PWA

During development, dogfooding, and trusted testing, loopback localhost is the accepted local trust boundary. Public network distribution is not required at this stage.

For a publicly distributed PWA, the trust boundary is HTTPS origin identity plus the application's deployment/provenance controls.

The PWA **public production** path must therefore include:

- HTTPS only;
- strict security headers/CSP appropriate to the runtime;
- controlled production deployment;
- immutable/versioned build identity;
- auditable source-to-deployment provenance;
- safe service-worker update and rollback behavior;
- no silent transmission of local career data merely because the application is web-delivered.

### Direct GitHub native binaries

Direct native GitHub release binaries may continue to exist for development, testing, archival, or advanced-user purposes.

They are **not** the preferred ordinary-user installation path unless they independently satisfy the applicable public OS trust requirements.

An unsigned direct binary must be labeled honestly. Documentation must never instruct users to disable SmartScreen, Smart App Control, Defender, Gatekeeper, or equivalent security globally.

## Platform scope

### Windows

Supported native platform through Microsoft Store.

Windows may also use the PWA.

### macOS

No native macOS distribution is currently planned.

macOS users are served through the PWA/web runtime when browser capability and validation support the required workflow.

Apple Developer ID membership, native notarization, and native macOS packaging are therefore not required dependencies for the accepted distribution architecture.

### Linux

No native Linux package is currently planned.

Linux users are served through the PWA/web runtime where validated.

A native Linux package requires future evidence that its user value justifies the packaging/support burden.

## Explicitly rejected or de-scoped paths

### SignPath

SignPath is not part of the Job Ranger distribution strategy.

It must not be introduced as a substitute signing dependency unless a future explicit architecture decision reverses this disposition.

### Azure Artifact Signing

Azure Artifact Signing is no longer a required release dependency.

Existing integration may remain in the repository as dormant/optional direct-distribution infrastructure where keeping it is low-cost, but inability to obtain or maintain an Azure Public Trust certificate profile must not block the Store or PWA paths.

### Apple Developer ID / native macOS distribution

Native macOS Developer ID signing/notarization is de-scoped under the current platform strategy.

It may be reconsidered only if demonstrated macOS-native demand justifies the annual program cost and ongoing build/test/support surface.

## Release policy implications

The repository must distinguish four states:

1. **Local self-hosted PWA candidate**: a validated build served on the user's own loopback origin for development, dogfooding, or trusted testing. This is not a public hosted release.
2. **Published supported channel**: a production HTTPS PWA deployment and/or certified Microsoft Store package intended for ordinary users.
3. **Validated native candidate**: a packaged binary that passed repository/package tests but is not yet Store-certified or otherwise publicly trusted.
4. **Advanced/test artifact**: a direct artifact retained for development, troubleshooting, archival, or informed testing.

A GitHub Release containing an unsigned native installer does not, by itself, make that installer the recommended mainstream distribution channel.

The historical v1.2.0 release remains immutable and accurately documented. This decision changes the forward distribution architecture; it does not rewrite v1.2.0 history.

## Implementation sequence

### Track A: Microsoft Store

1. produce an AppX proof-of-concept using the pinned Electron/electron-builder toolchain;
2. validate manifest identity/capabilities;
3. validate SQLite and local artifact paths inside the packaged environment;
4. validate import/export, backup/restore, source acquisition, and resume generation;
5. validate upgrade/coexistence/migration behavior from the existing direct installer where relevant;
6. complete Partner Center submission/certification;
7. record clean Windows installation and first-launch evidence;
8. make the Store package the recommended Windows-native installation path.

### Track B: PWA

1. inventory Electron-only assumptions and privileged APIs;
2. separate shared domain/application services from Electron adapters;
3. define browser persistence and portable-backup boundaries;
4. prove one end-to-end local-first Career Ops workflow in the browser runtime;
5. provide a stable localhost self-host path for dogfood and trusted testers without requiring public infrastructure;
6. close capability gaps iteratively without weakening domain/security invariants;
7. validate installability, offline/update behavior, storage durability, and cross-browser constraints;
8. introduce a public HTTPS host only when external distribution is justified, then validate origin migration through the portable backup contract;
9. promote the public PWA to mainstream only after parity/limitation and deployment-trust evidence are documented.

The two tracks may proceed independently. Neither is a prerequisite for beginning the other.

## Architecture invariants

This distribution decision does not change the core product governance:

1. Career Evidence remains factual authority.
2. Personal career data remains local-first by default.
3. Runtime adapters do not become domain authorities.
4. No runtime may silently submit applications or other consequential external actions.
5. Browser delivery does not imply cloud-authoritative storage.
6. Store certification does not replace repository provenance or runtime security controls.
7. Public code-signing certificates are optional implementation tools, not foundational product dependencies.
8. Platform-specific functionality must earn its complexity through user value.

## Supersession

This decision supersedes the previous forward assumption that Job Ranger must complete both Azure Artifact Signing for normal Windows distribution and Apple Developer ID/notarization for normal macOS distribution.

Historical implementation and release evidence for those paths remains valid historical evidence and should not be deleted merely because the product direction changed.
