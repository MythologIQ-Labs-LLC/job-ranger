# QOR Harden: Job Ranger adversarial review and isolated Drive OAuth reliability

**Date:** 2026-10-11  
**Status:** implemented only on unmerged `harden/264-isolated-drive-oauth`; **not accepted, merged, deployed or shipped**  
**Owning repository program:** [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194)  
**Security slice:** [#264](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/264), related OAuth prototype [draft #261](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/261), provider contract [draft #262](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/262) and budget-control [draft #263](https://github.com/MythologIQ-Labs-LLC/job-ranger/pull/263)

## Invocation, scope and authority

The user requested **adversarial review first**, then **/qor-harden applied to Job Ranger**. The independent adversarial finding snapshot was written in issue #264 **before repair commits**.

The exact canonical skill was read from `MythologIQ-Labs-LLC/Qor-logic/qor/skills/sdlc/qor-harden/SKILL.md` (Git blob `61671bd179ea1c0a50f1ef2409ddbfade41d3e64`) with its normative `qor/references/doctrine-code-quality.md` and `qor/references/implementation-quality-sweep.md`. Apply all nine IQ taxonomy dimensions, never infer authorship or transform heuristic matches into findings.

- **Repository-wide reconnaissance / governance:** inspect `main` contracts, accepted dual Electron+PWA delivery, QOR hardening owner #194, credential/snapshot decision tickets, available test and CI evidence, and unmerged Drive/CI changes.
- **Executable /qor-harden repair scope:** the **changeset/component** consisting of the unmerged #264 isolated OAuth parent, helper, tests and status documentation, compared with unchanged `main`. The parent PWA security policy and Settings build gate are inspected for authority but are **not accepted** or promoted by this hardening.
- **Disposition:** adversarial `review` first (no code edits), followed by `repair` of confirmed, in-scope implementation failures and minimal negative tests.
- **Authority constraints:** preserve default PWA CSP/COOP; no automatic uploads or token persistence; no changes to Career Evidence or Truth Gate; no Electron retirement, OAuth scope broadening, production hosting, dependency upgrades, releases or CI budget escalation.
- **Governance-health limitation:** the Qor runtime/CLI was **not installed** in the available container, so its governance-health command, gate receipt and lifecycle ledger were **not executed or simulated**. Following the skill methodology and authoring this report does not produce a formal Qor runtime gate.

## Adversarial findings and QOR classifications

| ID | Severity | Dimension | Confirmed evidence / consequence | Repair disposition |
| --- | --- | --- | --- | --- |
| **IQ-RESOURCE-001** | **MAJOR** | Resource lifetime, correctness | `src/pwa/drive/isolated-auth-popup.ts` registers a message handler **before** `window.open()` outside the try block. When open throws `SecurityError`, listener remains and status incorrectly stays `not_connected`. This was **reproduced before repair** against the previous local source: exception `SecurityError`, listener count 1, phase `not_connected`. | Caught the opener exception, clear listener/token, report recoverable action needed, negative test added. |
| **IQ-CONTRACT-001** | **MAJOR** | Browser message boundary | The exact child WindowProxy `postMessage(INIT)` could throw after COOP/navigation changes, leaving an uncaught message event and hanging authorizing state until timeout. | Catch message handoff, invalidate pending attempt and popup, expose immediate retryable error, negative test added. |
| **IQ-OBSERVE-001** | **MAJOR** | Truthful failures / CSP | In `auth-helper/helper.mjs`, dynamic Google script creation, `trustedScriptUrl()` or DOM insertion could synchronously throw; loading control already disabled and helper stayed at a false pending status. | Catch dynamic script setup failures and return controlled provider error with no token; tests reject Trusted Types and DOM injection. |
| **IQ-OBSERVE-002** | **MAJOR** | Residual reliability / opener lifecycle | During residual sweep, `sendReady`, `initialized` and `finish` each called `window.opener.postMessage` without handling a thrown WindowProxy. A severed opener could abort helper module evaluation or misleadingly report authorized after a failed final handoff. | One bounded `postToApp` safe delivery path; initial handshake fails without scheduling repeat polling, initialized failure is visible, token-delivery failure never displays success; three negative tests added. |
| **IQ-MAINTAIN-001** | **MINOR** | Documentation authority | `docs/research/ISOLATED_GOOGLE_DRIVE_AUTH_CHANNEL.md` claimed no Settings connection even though the unmerged branch conditionally renders `IsolatedGoogleDrivePanel` in PWA Settings. | Corrected status to **opt-in research UI on branch, disabled in ordinary builds, not shipped**. |

**Confirmed total:** 0 CRITICAL, **4 MAJOR**, **1 MINOR**, 0 other confirmed blockers in the executable slice. All five have bounded repairs on this branch. No major architecture or unrelated feature work was introduced.

## Nine-dimension QOR residual sweep

| Dimension | Relevant result |
| --- | --- |
| `IQ-COMPLETE` | No Drive API or upload is implemented; documentation/user copy must still describe **authorization proof only**. Real-browser and real-provider behavior remain unproven. |
| `IQ-CORRECT` | Confirmed exception/state bugs repaired. The event-driven popup and helper still require actual Chromium/window lifecycle validation. |
| `IQ-TRUST` | Exact origin, WindowProxy, nonce, `drive.file` scope, no token in UI state/URL/storage, separate helper origin and unchanged default app CSP preserved. **Observation:** `withTokenForUserAction` exposes a bearer token to an arbitrary future callback; there is no cloud operation caller yet. Its name does not prove per-archive human consent. #257 must establish the signed-off byte+destination authorization boundary before exposing it to uploads. |
| `IQ-CONTEXT` | The shared domain Truth Gate and established `.jobranger` archive stay authoritative. Draft #261's same-origin GIS approach and #264 isolated approach are alternatives, **not two approved login systems**. No duplicate integration is merged. |
| `IQ-COMPLEX` | Single additional helper delivery function is justified by three independent message paths; no new SDK/provider/folder abstractions added by this repair. |
| `IQ-RESOURCE` | Failed popup open and message delivery now clean up window handlers/pending state; negative tests verify cleanup. Timer behavior with real COOP popups remains a browser gate. |
| `IQ-CONTRACT` | Confirmed Google GIS `TokenClientConfig.include_granted_scopes: false` is a documented option in the Google JS reference; `TokenResponse.scope` and `expires_in` exist. The user must still validate actual consent/browser quirks before merge. |
| `IQ-MAINTAIN` | Corrected research status, no orphaned new dependency or generalized auth factory. |
| `IQ-OBSERVE` | Failed opener, script policy, acknowledgement and delivery are rendered as actionable non-success. Logs never print an access token. No false provider-verified status is introduced. |

**Not confirmed as defects and not opportunistically rewritten:** hypothetical third-party malice, guessed Google consent/CSP incompatibility, lint preferences, alternate identity models, entire repo performance problems without execution evidence.

## Verification performed, and not performed

### Before/after behavior

- **Before:** local Node reproduction against original popup code: `window.open` throws `SecurityError`, listener count **1**, view `not_connected`. This is a concrete regression against the cleanup contract.
- **After:** focused local Node + VM mirrored-implementation tests with `node --experimental-strip-types --experimental-vm-modules --test` targeting popup, channel, helper, combined handshake and helper HTTP server suites: **34 tests passed, 0 failed**.
- **After:** targeted `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --lib ES2022,DOM` on the popup, receiver and PWA policy passed locally using TypeScript 5.8.3. `node --check` passed for helper JavaScript and local helper server.
- The local checkout is a **reduced test fixture**, not the complete GitHub repository. Repairs were mirrored from reviewed remote source into it. Therefore these are **targeted local regression results**, not a claimed exact-head `npm run typecheck`, `npm run repo:health`, packaged Electron, or PWA production build. Committed tests should be rerun against the complete exact branch before review/merge.
- The older static source policy test's fourth case relies on a full repository checkout and was not runnable in the reduced fixture. Existing PWA CI successes on **different PR heads** are not interchangeable with current branch validation.
- **Browser gate:** Chromium navigation is blocked by administrator policy in this sandbox, including local origins. No actual dual-origin popup proof, trusted headers in a real browser, Google-issued OAuth client consent, Drive API round-trip, Google revocation, Firefox/Safari, OS package or external agent consumption was performed.
- **Hosted budget:** the branch is intentionally not a PR and GitHub Actions must not be started for every small security repair. A single final candidate run can be arranged after real browser verification and review, using draft/ready guard #263 if accepted.

## Ship assessment and handoff

**/qor-harden ship verdict for the isolated Google OAuth slice: `NO` for production.** The five confirmed implementation defects are repaired in the candidate code, but unfulfilled **real-browser/real-provider and independent security-review** acceptance gates block a production claim or merge. The main PWA's default security behavior remains unchanged.

**Whole Job Ranger repository verdict: `INCONCLUSIVE`.** Repository-wide governance and critical cross-runtime contracts were inspected, but no full checkout, regression suite, end-user QA matrix, Windows packaged runtime, or Qor governance-health pass was available here. No claim of complete repository hardening is warranted by this bounded session.

The owning follow-ups are #264 for two-origin real-browser proof, #258 for actual Google OAuth consent/connection state, #257 for per-snapshot approval and destination/provider integrity, #255 for backup-versus-agent export, #263 for cost-aware CI, and #194 for whole-app hardening and release readiness. **Do not merge, close these tickets, or claim cloud backup availability from this report alone.**
