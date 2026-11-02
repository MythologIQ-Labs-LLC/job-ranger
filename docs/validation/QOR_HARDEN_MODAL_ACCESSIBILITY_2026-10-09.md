# QOR Harden: shared modal keyboard and small-screen repair

**Status:** proposed changeset, not yet merged or shipped  
**Date:** 2026-10-09  
**Owner:** [#197](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/197), under [#194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194)  
**Method:** Qor-logic `/qor-harden` implementation-quality doctrine and sweep (focused component, repair disposition).

## Confirmed before changing the code

`src/components/Modal.tsx` declared `role="dialog"` and `aria-modal="true"`, but did not move focus on opening, constrain Tab/Shift+Tab, or restore focus to the launching control. For a keyboard user, an open dialog could leave focus in a now-obscured section of the app, and moving through controls could escape the overlay. The component also centered unconstrained forms in a fixed full-screen layer; the lower controls could extend past a short screen without a reliable dialog scroll area.

These are **IQ-CORRECT** (interactive contract), **IQ-CONTRACT** (ARIA semantics vs actual keyboard behavior), and **IQ-COMPLETE** (unreachable form actions) confirmed gaps. `Modal` has multiple real consumers including Filters, Companies and the existing `ConfirmDialog` component. This repair does not attempt to change the `ConfirmDialog` async semantics proposed separately in #193.

## Smallest repair

- Focus the first visible enabled form input when one exists, otherwise the first actionable control. Do not use app-global state to track focus.
- Capture Tab/Shift+Tab at the dialog boundary only while open. Cycle the currently enabled and visible focusable elements rather than hard-coding the first or last button.
- Escape invokes the latest passed `onClose` callback; close guards and mutation authority remain owned by their callers. Focus returns to the invoking element if it still exists.
- Keep modal width sizes unchanged; constrain dialog height to viewport with a scrollable contents section. Normal non-modal pages do not gain new scrolling containers.
- Use the title element as the accessible name via `aria-labelledby`; no dependencies added.

## Behavioral verification

`tests/pwa/modal-accessibility.spec.ts` checks keyboard opening, first-field focus, Shift+Tab to close, Tab wrapping at both ends, Escape close, focus restoration, Cancel with no unintended persistence, and reachability of bottom-of-form actions on a 375px × 400px viewport.

Qualify the exact branch head using Linux and Windows PWA browser tests, Electron E2E, repository-health, release upgrades and static analysis. No automated claim of a complete screen-reader accessibility audit.

## Residual checks

This is a bounded **focused component** pass, not complete A11y. Screen-reader output, reduced-motion, external hardware keyboard peculiarities, nested modal stacks and non-modal keyboard usability remain to be evaluated independently. In all cases, reject regressions in Truth Gate, Career Evidence authority and legitimate cancellation.

**Ship verdict: INCONCLUSIVE until exact-head CI, independent review and manually checking real keyboard interaction.**
