<p align="center">
  <img src="docs/assets/branding/job-ranger-banner.png" alt="Job Ranger - Find Your Next Opportunity" width="100%" />
</p>

# Job Ranger

**Find the opportunities worth your time.**

Job Ranger is a free, open-source, local-first Career Ops companion. It helps you work out where you want to go next, understand whether an opportunity fits, prepare truthful application materials and keep track of your search. **Fewer applications, better decisions.**

No mass auto-apply, invented qualifications, required AI subscription or Job Ranger account for the core workflow.

## What can Job Ranger help me do?

- **Choose a direction.** Start from your goals, an existing resume or your own account of your experience. Your next job does not have to look like your last one.
- **Understand your options.** Define career targets, work arrangements, pay, locations and what matters most to you.
- **Evaluate opportunities.** Review eligibility, experience evidence, preferences, blockers and unknowns separately, rather than trusting a mysterious match score.
- **Prepare honest applications.** Create resumes and supporting materials from career facts you've reviewed and confirmed.
- **Stay organized.** Track opportunities, applications, submitted documents, interviews, contacts and follow-ups.
- **Keep control of your information.** The core app works locally, with explicit import/export and portable backups.

Job Ranger does not promise interviews or replace your judgment. It helps you make informed decisions about where to spend your effort.

## See the actual application

The walkthrough and screenshots below were recorded from a working build **using fictional sample data**. They are not mockups or evidence of a public hosted release.

**[Watch the 85-second walkthrough](./docs/assets/demo/job-ranger-demo.webm)**

| Choose a direction | Review an opportunity | Track an application |
| --- | --- | --- |
| ![Career direction with two target tracks](./docs/assets/screenshots/career-direction.png) | ![Opportunity assessment with separate evidence and alignment signals](./docs/assets/screenshots/opportunity-assessment.png) | ![Application record with its submitted document](./docs/assets/screenshots/deliberate-application.png) |

## How do I try Job Ranger today?

Job Ranger is still in active development. The latest **published** release is [v1.2.0](https://github.com/MythologIQ-Labs-LLC/job-ranger/releases/tag/v1.2.0), dated October 5, 2026. Its historical Windows and macOS installers are **unsigned/unnotarized** and are not the planned mainstream installation method. Do not disable operating-system protections to install them.

The newer web/PWA experience is **implemented but not yet publicly hosted or released as a mainstream channel**. For technically comfortable testers, it can run locally in Chrome or Edge; see the [step-by-step self-hosting guide](./docs/SELF_HOSTING.md). That path currently requires Node.js and npm.

**What's next:** a browser-accessible version and a Microsoft Store release remain subject to testing, trust checks and release approval. There is no public "Try now" link yet. We will not direct you to a non-existent hosted app.

## What stays on my device?

The current core stores your career information locally rather than in a Job Ranger cloud account. On the web/PWA runtime, data belongs to **that specific browser profile and site origin**, not automatically to all your devices. Export a `.jobranger` backup before moving browsers, changing origins or clearing browser data.

Refreshing external job listings involves requests to permitted job sources. Browser security and provider restrictions mean that some sites cannot be checked from the web version; some types of monitoring require the Windows app. Background monitoring while your browser is closed is not available in the web runtime. These limits are shown rather than hidden.

Optional hosted monitoring and other convenience services are **ideas for future evaluation**, not features or paid plans available today. Job Ranger's free deterministic core does not depend on them.

## Help, details and source code

- [Self-hosting and backup instructions](./docs/SELF_HOSTING.md)
- [Current product capabilities and limitations](./docs/SYSTEM_STATE.md)
- [Security information and reporting](./SECURITY.md)
- [Issue tracker and feedback](https://github.com/MythologIQ-Labs-LLC/job-ranger/issues)
- **[Developer and coding-agent documentation](./README.developer.md)** (architecture, setup, tests, governance, releases)
- [How to contribute](./CONTRIBUTING.md)

Job Ranger is maintained by MythologIQ Labs, LLC and is developed under [AGPL-3.0-only](./LICENSE). Published v1.2.0 and earlier versions retain their original MIT grants; see [license history](./LICENSE_HISTORY.md). The product name and official distribution identity are governed by [trademark terms](./TRADEMARKS.md).
