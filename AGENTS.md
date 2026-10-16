# Job Ranger agent working agreement

Start with [docs/ARCHITECTURE_INDEX.md](./docs/ARCHITECTURE_INDEX.md), [GOVERNANCE.md](./GOVERNANCE.md), [docs/REPOSITORY_WORKFLOW.md](./docs/REPOSITORY_WORKFLOW.md), and [CONTRIBUTING.md](./CONTRIBUTING.md).

- Read exact current \`main\` and parent issue before modifying code. Reuse
  active delivery branches; do not proliferate duplicate PRs.
- Favor functional correctness, data integrity, local-first privacy, recovery
  and user-owned canonical career truth over visual polish.
- No inference or imported data may silently rewrite verified Career Evidence.
- Do not claim an unmerged branch is in main, or main is published software.
- No mass auto-apply, unsolicited remote synchronization, or third-party
  credential handling without explicit reviewed scope.
- Keep no more than three active feature PRs, excluding explicitly approved
  security/critical-data-loss work. Draft experiments should not masquerade
  as release candidates.
- Before requesting a merge, give exact head and base SHAs, local commands,
  results, known failures, Windows/PWA coverage if applicable, and Actions
  cost. Avoid triggering hosted CI on every iteration.
- After an approved merge, update and close fulfilled issues and superseded
  PRs with evidence, without deleting historical branches.
- Do not make CI green by relaxing the test oracle or modifying the claim.
  Reproduce intermittent defects and address their actual root causes.
