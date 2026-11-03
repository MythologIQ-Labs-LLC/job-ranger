# Plan: Phase 11 - Public-review README with curated screenshots

**change_class**: hotfix

**doc_tier**: minimal

**pr_target**: phase/10-public-demo-harness (PR #155, rebased onto the stack)

**iteration**: 2 (amended after the plan audit VETO recorded at META_LEDGER Entry #59)

Completes PR #155 ("Make Sojourner easier to evaluate and self-host") on top of the functional stack (#158-#161). It adds three curated product screenshots produced by the demo harness, points every live repository reference at `MythologIQ-Labs-LLC/sojourner`, and corrects one distribution statement.

## Open Questions

None.

## Evidence

- PR #155 changes `README.md` and adds `docs/SELF_HOSTING.md`, in two commits by Kevin Knapp (`4f0e2f3`, `28ed96e`) based on `main` at `970c2c3`.
  - On this branch they are cherry-picked unchanged onto `phase/10-public-demo-harness` as `aedf75f` and `d3b31c2`.
  - No stack commit touches either file.
- README and SELF_HOSTING claims checked on 2026-10-07; all hold except the line corrected by LD6:
  - v1.2.0 is the stable release (`CHANGELOG.md:72-74`);
  - v1.3.0 is an unpublished candidate (`CHANGELOG.md:24`);
  - the PWA is implemented and not deployed;
  - Store certification is pending;
  - no hosted service exists;
  - `npm run selfhost:pwa` exists (`package.json:42`);
  - the PWA serves on port 4174 (`vite.pwa.config.ts` preview settings).
- The demo recording's screenshots (`build/demo/screenshots/`, Phase 10 take 11) contain the recording's cursor overlay and caption.
- Live references to the previous repository owner, found with `git grep -n -i "knapp-kevin"` across the repository excluding dated records (`docs/validation/`, `docs/research/`, `docs/design/`) and governance logs (`docs/META_LEDGER.md`, `docs/SHADOW_GENOME.md`, `docs/plan-qor-*`, `.qor/`):
  - `docs/CONCEPT.md:172` - issue link `https://github.com/Knapp-Kevin/sojourner/issues/121`
  - `docs/DISTRIBUTION_TRUST.md:140` - `gh attestation verify <artifact> --repo Knapp-Kevin/sojourner`
  - `docs/RELEASE_READINESS.md:217` - the same command in the release checklist
  - `docs/TESTER_INSTALLATION.md:20` - the same command in tester guidance
  - `vite.pwa.config.ts:151` - `sourceRepository: process.env.GITHUB_REPOSITORY ?? "Knapp-Kevin/sojourner"` (the `build-info.json` value for builds made outside GitHub Actions)
- No artifact has a GitHub attestation yet. Attestations begin with v1.3.0 (`CHANGELOG.md:24` "Not yet published", `CHANGELOG.md:52` "GitHub artifact attestations for released artifacts"), and v1.2.0 was promoted from pre-existing rc.5 artifacts (`CHANGELOG.md:74`). The first attested artifacts will come from workflows in `MythologIQ-Labs-LLC/sojourner`, and `.github/workflows/deploy-pwa.yml:61` already verifies with `--repo "${{ github.repository }}"`.
- `README.md:300` says "Native Linux and macOS packaging are not planned." That contradicts `CHANGELOG.md:59`, which says native macOS packages are still built on manual dispatch, and v1.2.0's published macOS packages.

## Locked Decisions

- LD1: Curated screenshots come from a separate, unrecorded harness pass, `scripts/demo/screenshots.spec.ts`, run by `npm run demo:screenshots`. It uses the same fixture and the same production web build, in Canopy at 1600x900. It installs no cursor and no caption, gates every shot with `waitForDemoReady`, and fails on page or console errors. The three shots:
  1. **Career direction:** Target Tracks with the target track open, page at top.
  2. **Opportunity assessment:** Find Jobs with the assessment expanded, scrolled so its header and the four status badges sit at the top of the viewport.
  3. **Deliberate application:** reached through the real UI (Prepare resume, Create truthful draft, Export verified PDF), then Applications with status Applied and Application details open on "Submitted files".

  Output: `build/demo/curated/`. The recorded demo is unchanged.
- LD2: The context setup the story and screenshot passes share (the routed Greenhouse listing and the Canopy/onboarding init script) moves from `scripts/demo/story.spec.ts` into `scripts/demo/fixture.ts` as `prepareDemoContext(context)`. Both specs import it. Importing from `story.spec.ts` would register its test a second time.
- LD3: The three accepted images are committed as `docs/assets/screenshots/career-direction.png`, `opportunity-assessment.png` and `deliberate-application.png`, beside `docs/assets/branding/`.
- LD4: README gains a short "See it in action" section after "A typical workflow". It shows the three images with one-line captions, states that they use fictional data, and gives `npm run demo:record` for the full walkthrough. It makes no hosted-demo claim.
- LD5: All five live old-owner sites point at `MythologIQ-Labs-LLC/sojourner`:
  - the CONCEPT issue link;
  - the three `gh attestation verify --repo` commands, matching `deploy-pwa.yml:61`;
  - the `vite.pwa.config.ts` `sourceRepository` fallback.

  Dated records in `docs/validation/`, `docs/research/` and `docs/design/` keep their original links, as evidence recorded on their dates; GitHub redirects them.
- LD6: `README.md:300` matches `CHANGELOG.md:59`: native Linux packaging is not planned; native macOS packages are built only on manual dispatch, and macOS users are served by the web app going forward.
- LD7: `docs/SELF_HOSTING.md` is registered in `docs/GOVERNANCE_INDEX.md` Tier 5 (reference material).

## Phase 1: Curated screenshots, repository references and README

### Unit Tests

- `scripts/demo/screenshots.spec.ts` is its own acceptance check. Each shot asserts:
  - the route;
  - the page heading;
  - visible seeded content;
  - for the assessment shot, the four status badges and the Epic EHR gap;
  - for the application shot, Applied and "Submitted files";
  - Canopy;
  - no page or console error;
  - no demo overlay element (`#demo-cursor`, `#demo-caption`, `#demo-title-card`, `#demo-freeze`) in the document at capture time.
- `npm run demo:record` still passes after the `prepareDemoContext` move, as a regression check on the recorder.
- `npm run build:pwa` writes `build-info.json` with `sourceRepository` `MythologIQ-Labs-LLC/sojourner` when `GITHUB_REPOSITORY` is unset.

### Affected Files

- `scripts/demo/screenshots.spec.ts` (new).
- `scripts/demo/fixture.ts` - `prepareDemoContext(context)`.
- `scripts/demo/story.spec.ts` - uses `prepareDemoContext`; its local `prepare` is removed.
- `scripts/demo/playwright.demo.config.ts` - `testMatch` covers both specs.
- `package.json`:
  - `demo:record` names `scripts/demo/story.spec.ts` explicitly;
  - new `demo:screenshots`: `npm run build:pwa && playwright test --config scripts/demo/playwright.demo.config.ts scripts/demo/screenshots.spec.ts`.
- `docs/assets/screenshots/career-direction.png`, `opportunity-assessment.png`, `deliberate-application.png` (new).
- `README.md` - "See it in action" section; line 300 (LD6).
- `docs/CONCEPT.md`, `docs/DISTRIBUTION_TRUST.md`, `docs/RELEASE_READINESS.md`, `docs/TESTER_INSTALLATION.md`, `vite.pwa.config.ts` - repository owner (LD5).
- `docs/GOVERNANCE_INDEX.md` - `docs/SELF_HOSTING.md` in Tier 5; Phase 11 plan row.
- `CHANGELOG.md` - Unreleased documentation entry.

## Feature Inventory Touches

None. Documentation, repository references and a capture tool only.

## Definition of Done

### Deliverable: Public-review README

- **D1**: The README shows three curated, overlay-free screenshots of the real build, in Canopy with fictional data, explaining what Sojourner does. Every live repository reference names `MythologIQ-Labs-LLC/sojourner`. The macOS packaging statement matches CHANGELOG.
- **D2**: The files above exist. `npm run demo:screenshots` writes the three images, and the README references the committed copies.
- **D3**: Ledger plan/audit/implement/seal entries; governance index and CHANGELOG updated.
- **D4**:
  - `npm run demo:screenshots` and `npm run demo:record` pass.
  - Each committed image is inspected at full size: correct state, no overlay, no clipped primary content, no known visual defect.
  - Every README image path resolves to a file.
  - The repository-wide old-owner grep from Evidence returns no live references.
  - `build-info.json` shows the new owner.
  - `npm test` and `npm run typecheck` pass.

## CI Commands

- `npm run demo:screenshots` - curated screenshots with readiness and theme checks.
- `npm run demo:record` - recorder regression after the shared-setup move.
- `npm test` - unit suite.
- `npm run typecheck` - TypeScript, including `vite.pwa.config.ts`.
