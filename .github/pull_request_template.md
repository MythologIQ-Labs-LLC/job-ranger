## Why this change exists

User problem, parent issue, and the smallest necessary scope:

Refs #

## Delivery state

- [ ] **Ready for review**: exact head and required local acceptance evidence are provided
- [ ] **Draft / research only**: NOT mergeable or shippable (explain decision still needed)
- [ ] **Blocked**: named blocker, owner and next action are documented

Choose **exactly one** state above. Drafts are not release-ready simply because tests pass.

## Change and trust boundaries

- Actual source changes and out-of-scope areas:
- Local-first persistence, Career Evidence/Truth Gate, user consent and source provenance implications:
- Public claims/README/Help/migrations affected (or none):

## Evidence at exact commit

- HEAD SHA:
- OS / Node / SQLite / browser or Electron versions:
- Commands run and results:
- PWA, Electron, backup/restore, negative-path and accessibility gates applicable:
- Checks **not run**, known flakiness and unresolved failures:
- Screenshots or artifacts, where meaningful:
- Independent review/ruling:

No green claim without recorded evidence. Tests on an earlier head do not qualify this head.

## Merge and closeout

- [ ] Merge base checked against current main; conflicts and combined behavior qualified
- [ ] Acceptance criteria satisfied and parent issue checklist reconciled
- [ ] Old stacked/prototype/validation-only PRs identified for closeout
- [ ] GitHub Actions budget impact understood (push to main may trigger hosted workflows)
- [ ] This is not claiming Studio/public deployment or a published release

**Closes #** (only when the complete issue is delivered)
**Partial #** (if the parent must stay open)
**Replaces #** (if this supersedes a prior candidate)

After merge: record main SHA and accepted tests in the issue. Close only completed work.
