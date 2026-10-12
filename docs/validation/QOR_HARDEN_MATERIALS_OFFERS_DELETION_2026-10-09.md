# QOR Harden: destructive cover-letter and offer actions

**Date:** 2026-10-09. **Scope:** existing Application Materials and Search Context/Offer panels. **Parent:** #194. **Issue:** #207.

## Findings before repair

- A cover-letter version's Trash control immediately called the canonical delete without confirmation. `ApplicationMaterialsPanel.remove` swallowed delete failures and left the user with a generic panel error, with no pending lock, explicit retry, or record-specific consent. An additional list refresh could make a successful delete appear to have failed.
- Offer removal immediately invoked `void insights.deleteOffer()` and removed saved compensation, deadlines and private negotiation terms with no confirm boundary. Rejections were not handled by that click handler.
- Existing `ConfirmDialog` (introduced under #193, including keyboard focus and pending guard from #198) already supplies the required explicit user review and failure-visible transactional shell. A new confirmation implementation is unnecessary.

These are confirmed source-level destructive safety and error-handling gaps, not new product requirements.

## Repair contract

1. Review a **specific numbered cover-letter draft** before deletion. Warn about permanent removal of that version's text and evidence links, clarify that other versions and canonical Career Evidence remain. No deletion on Cancel/Escape.
2. Only the canonical `applicationMaterials.delete(id)` may remove a draft; when it resolves, prune that specific ID from the displayed list. If it rejects, leave the record and confirmation open with visible error and retry. A separate list-refresh outage cannot misrepresent a completed mutation.
3. Review removal of offer data (pay, bonus, benefits, dates and private negotiation notes). The confirmation must be inaccessible during pending API persistence, and remain open on failure with Cancel/Retry.
4. Preserve the independent application's remaining history and never create another durable data store, inferred recommendation, or Truth Gate authority.

## Evidence and test scope

`tests/pwa/materials-offer-deletion-safety.spec.ts` seeds a fixture-backed tracked job and user-authored evidence in the real PWA workspace, creates two distinct versioned cover-letter drafts, and stores private offer terms. The browser tests exercise actual UI controls, verify that Cancel preserves both drafts, deliberately reject version deletion then retry against the exact selected version, verify the other version survives, and verify Career Evidence survives. For offer removal, cancel first, reject a held backend call, prove Escape cannot dismiss a pending operation and private terms survive, then retry successfully and check SQLite after a full reload.

Exact-head CI must pass Windows + Linux PWA suites, Electron E2E, repository health/typecheck, CodeQL, upgrades, and packaged Windows Store installation smoke. Manual screen-reader and end-user exploratory QA are *not* implied by CI success.

## Remaining known risks

- This does not address interrupted unacknowledged notes/status edits, beforeunload/browser crashes, or every residual deletion action in G4. Address separately and reproduce before remediation.
- The shipped version remains local-first and deterministic; inference contracts and Truth Gate were not touched.
- QOR Harden governing runtime tool was not directly executed in the GitHub-only session, so do not assert a governance signature.

**Overall release readiness: INCONCLUSIVE.**
