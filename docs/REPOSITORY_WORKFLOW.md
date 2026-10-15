# GitHub workspace workflow

This is the operational companion to [GOVERNANCE.md](../GOVERNANCE.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md). It manages delivery state and owner
accountability, not product truth. The release and data-authority contracts still win.

## One backlog, distinguish what can ship

| State | Meaning | Next owner action |
| --- | --- | --- |
| **Active** | A maintainer owns a bounded implementation with an agreed acceptance gate | Work, validate, merge, reconcile and close |
| **Ready** | Implementable and prioritized, not yet in an active slot | Select an owner and move to active |
| **Blocked** | Specific missing evidence, provider rights, security decision or dependency | Record blocker, owner, next checkpoint |
| **Research** | Question/experiment, not approved production code | Record ruling in parent; close/defer proposal |
| **Deferred** | Valid future idea, deliberately not being worked on | Keep documented without implying near-term delivery |
| **Superseded** | Replaced by an exact, linked surviving issue/branch | Comment the replacement and close old ticket |
| **Completed** | Acceptance satisfied in merged main and issues reconciled | Close with main SHA and evidence |

Labels are the preferred machine-readable metadata. **One** \`status:*\` and **one**
\`area:*\` per open issue/PR. For active work require a GitHub assignee (an
accountable owner), a parent issue and a concrete acceptance criterion. A
research issue can remain deferred; it is not automatically an active task.

Minimal label vocabulary (create once in the repository settings by a maintainer
with permission):

- States: \`status:active\`, \`status:ready\`, \`status:blocked\`, \`status:research\`, \`status:deferred\`.
- Areas: \`area:core\`, \`area:ux\`, \`area:release\`, \`area:providers\`, \`area:integrations\`, \`area:personal-brand\`, \`area:governance\`.

Do not turn these into a maze of dozens of priority labels. **These labels
must actually exist before relying on label-based board searches**. Existing
issues have not been silently relabeled.

## Work in progress and branch policy

**At most three actively developed feature PRs at a time**, plus explicit
security/critical-data-loss exceptions. This is not a requirement to close
every deferred design draft immediately or restrict legitimate future ideas.
Before a new feature PR, find an existing parent, name an owner and explain
which active slot it replaces or why the exception is needed. Prefer one
candidate and one acceptance path over stacked planning/prototype/test-only PRs.

A PR is not delivery. A local test on an isolated head is not integration.
A PR merged into \`main\` is not automatically a published release. For
superseded PRs, record the exact surviving candidate and what **remains
unmerged**, then close without deleting historical branches or approval evidence.

Issue and PR lifecycle:

1. **Intake:** check duplicates, assign area/state, record user problem,
   owner, acceptance and negative/recovery tests. The issue templates help.
2. **Selection:** explicitly activate up to three bounded feature lanes.
   Security, reliability and data loss outrank visual polish.
3. **Implementation:** local-first/Truth Gate and user authorization are
   invariant; cite exact SHA, test outputs and known failures.
4. **Review:** run current-base combination checks. Do not merge an old
   independently green branch without testing its reconciled result.
5. **Merge:** update \`main\` only with owner acceptance. Budget and required
   checks must be considered; use a single safe atomic commit for trivial
   documentation correction only when governance permits.
6. **Closeout:** record merge SHA, regression test result and release caveat;
   close delivered issues, close superseded PRs, update the parent checklist.
7. **Release:** separate immutable artifacts, PWA hosting and Studio CTA
   approvals. Do not claim a public demo from a branch or video alone.

Every Friday or at each release-candidate checkpoint, review stale drafts
(14 days without activity is a **review prompt**, not an automatic closure),
duplicate branch heads, unassigned active work, open bugs claiming fixed
behavior, and older issues whose merged PR was not linked/closed. Preserve
security holds and qualified external-provider/legal issues until resolved.

## Low-cost read-only audit

With GitHub CLI authenticated locally:

\`\`\`bash
npm run repo:hygiene
npm run repo:hygiene:test
node scripts/repo-hygiene-audit.mjs --json
\`\`\`

Offline reproducibility is supported by:
\`node scripts/repo-hygiene-audit.mjs --snapshot local-snapshot.json --json\`
where the JSON has \`issues\` and \`prs\` arrays using GitHub CLI list fields.

The audit **never changes GitHub state**. A missing status label flags
untriaged work, not a false assertion that a draft is ready. Counts include
issues and PRs separately (GitHub's generic issue listing includes PRs).
The three-PR cap uses only explicitly \`status:active\` PRs, not every
open draft. Stale draft flags are informational.

Useful queue views, once labels are configured:
[open issues](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues?q=is%3Aissue+is%3Aopen),
[open PRs](https://github.com/MythologIQ-Labs-LLC/job-ranger/pulls?q=is%3Apr+is%3Aopen),
[active work](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues?q=is%3Aopen+label%3Astatus%3Aactive),
[blocked work](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues?q=is%3Aopen+label%3Astatus%3Ablocked).

## Actions budget is a real acceptance constraint

Normal \`push: main\` and \`pull_request\` workflows may schedule costly
Linux/Windows tests, even if nobody manually clicked Run. Avoid creating
validation-only PRs solely to purchase hosted CI. Do not disable critical
checks or claim them passing when skipped. Coordinate with the separate CI
budget repair (#263) before altering workflow triggers. Documentation-only
governance work can use the existing maintainer direct-merge exception, with
local evidence and an explicitly budget-aware commit.

## First-pass backlog cleanup, October 2026

Evidence and the changing counts live on
[issue #194](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues/194),
rather than in a perpetually stale count in this guide.

High-impact active delivery references: #194 reliability and data integrity;
#248 UI/branding with explicit icon-asset merge gate; #130/#311 PWA and
MythologIQ Studio handoff; #295 demo **after** integrated acceptance.
Drive/OAuth #249/#286, provider #136, application assistance #228 and the
inference candidates remain distinct research/blocked lanes until approved,
not all simultaneous delivery commitments.
