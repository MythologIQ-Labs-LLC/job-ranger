<p align="center">
  <img src="docs/assets/branding/sojourner-banner.png" alt="Sojourner: Employment Toolkit. Local-first tools for a more thoughtful job search." width="100%" />
</p>

<p align="center">
  <a href="#get-sojourner"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20web%20(PWA)-2563eb.svg" alt="Platforms: Windows and web (PWA)" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-15803d.svg" alt="License: AGPL-3.0-only" /></a>
  <img src="https://img.shields.io/badge/data-stays%20on%20your%20device-0f766e.svg" alt="Your data stays on your device" />
  <img src="https://img.shields.io/badge/account-not%20required-0f172a.svg" alt="No account required" />
</p>

<p align="center">
  <strong>Decide where you want to go, judge each opportunity on the evidence, and apply with materials that are true.</strong><br />
  Sojourner is an open-source, local-first career companion from MythologIQ Labs, LLC.
</p>

<p align="center">
  <a href="#see-it-in-action">Tour</a> ·
  <a href="#get-sojourner">Get Sojourner</a> ·
  <a href="#what-sojourner-does">Features</a> ·
  <a href="#privacy-and-security">Privacy</a> ·
  <a href="#development">Develop</a> ·
  <a href="./HELP.md">Help</a>
</p>

---

Job searching runs on clerical work: re-checking the same boards, rewriting the same facts, forgetting which resume went where. Sojourner takes that load off you without taking the decisions away from you. It is built for **quality over quantity**. A few well-understood opportunities that fit your direction, your evidence and your constraints beat a long queue of weak matches.

- **Truthful by design.** Your resume and application materials draw only on facts you have confirmed. The Truth Gate blocks anything you have not.
- **Honest about uncertainty.** Each listing gets separate verdicts for eligibility, evidence, career fit and preferences. Blockers and unknowns are named, not buried in one score.
- **Yours, locally.** Your career data lives on your device. There is no Sojourner account, no telemetry, and no AI subscription required.
- **You stay in charge.** Sojourner never applies to jobs for you, never sends messages for you, and never uploads anything without your explicit approval.

## See it in action

<p align="center">
  <a href="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/video/sojourner-walkthrough.mp4">
    <img src="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/video/sojourner-walkthrough-poster.png" alt="Sojourner walkthrough video poster: select to download the 82-second tour" width="85%" />
  </a>
  <br />
  <sub><a href="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/video/sojourner-walkthrough.mp4">Download the 82-second walkthrough</a> (MP4, 1600×900) · <a href="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/video/sojourner-walkthrough.vtt">captions</a> · <a href="https://github.com/MythologIQ-Labs-LLC/sojourner/blob/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/video/sojourner-walkthrough-transcript.md">transcript</a></sub>
</p>

Everything shown uses fictional sample data (Morgan Rivera, Harbor Health). No real person's career data appears.

### 1. Choose a direction

Target Tracks keep the path you are on separate from the one you are moving toward. Each track has its own roles, locations and constraints.

<img src="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/screenshots/career-direction.png" alt="Sojourner Target Tracks with a selected career direction and a separate current track" width="100%" />

### 2. Judge a listing on the evidence

The opportunity assessment reports eligibility, evidence coverage, career alignment and preferences separately. It names the blockers and the unknowns instead of hiding them behind one opaque score.

<img src="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/screenshots/opportunity-assessment.png" alt="Sojourner opportunity assessment showing evidence and eligibility categories" width="100%" />

### 3. Keep a factual record of your experience

Career Evidence turns a resume, pasted history or direct entry into facts you can review, correct and trace back to their source.

<img src="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/screenshots/career-evidence.png" alt="Sojourner Career Evidence review showing editable work history facts" width="100%" />

### 4. Prepare a resume that is true

Drafts are assembled only from confirmed facts. The Truth Gate checks every claim before you export an ATS-friendly PDF.

<img src="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/screenshots/resume-truth-gate.png" alt="Sojourner resume builder showing verification of a truthful draft" width="100%" />

### 5. Track what happens next

Each application keeps its status, notes, contacts, milestones and the exact resume version you sent. Sojourner records it; it never submits anything for you.

<img src="https://raw.githubusercontent.com/MythologIQ-Labs-LLC/sojourner/863a5509a4b0ebeb1935f238b776b8c5ceb44b66/screenshots/deliberate-application.png" alt="Sojourner Applications view tracking a fictional job opportunity and its resume versions" width="100%" />

## Get Sojourner

Sojourner is a **Windows application first**. The same app also runs as a **progressive web app (PWA)** for other platforms.

| Option | Best for | Status |
| --- | --- | --- |
| **Windows installer** | Everyday use on Windows 10 and 11 | Every release is code-signed by **MythologIQ Labs, LLC**, and that signature is verified before publication. The first signed alpha is **v1.0.0-alpha.1** (a pre-release, being prepared). Watch [Releases](https://github.com/MythologIQ-Labs-LLC/sojourner/releases) for it. |
| **Run it locally in your browser** | Trying Sojourner today on any desktop with Chrome or Edge | Available now from source. See the quick start below. |
| **Hosted web app** | Use without installing anything | Planned. It needs a production web origin and broader browser validation first. |

> Earlier releases were published as **Job Ranger**, a separate product line. They are archived as `job-ranger-v*` git tags (for example `job-ranger-v1.2.0`) and are no longer offered as downloads; their installers were **unsigned**. Please wait for the signed Sojourner release rather than turning off SmartScreen or other platform protections. If you use Job Ranger v1.2.0, the Sojourner installer is built to upgrade it in place and keep your data; create a backup first.

### Quick start: run Sojourner locally

You need [Node.js](https://nodejs.org/) 22.12 or newer and Git. The full beginner-friendly guide is in [SELF_HOSTING.md](./docs/SELF_HOSTING.md).

```bash
git clone https://github.com/MythologIQ-Labs-LLC/sojourner.git
cd sojourner
npm ci
npm run selfhost:pwa
```

Open **http://localhost:4174** and, if you like, install it as an app from Chrome or Edge.

- **Keep the same address.** Browser storage is tied to `http://localhost:4174`, so Sojourner refuses to fall back to another port.
- **Updates replace the app, never your data.** Your workspace lives in your browser's private storage (OPFS).
- **Back up before experiments.** Settings → **Create backup** writes a portable `.jobranger` file. It is also how you move to the Windows app or another browser.
- **Recovery is built in.** If the workspace database is ever damaged, Sojourner leaves it untouched and offers to restore from a backup on the startup screen.

## What Sojourner does

| Area | What you get |
| --- | --- |
| **Career direction** | Multiple Target Tracks (current, adjacent, stretch, target), each with explicit roles and constraints. A preference never silently turns into a requirement. |
| **Career Evidence** | Resume import and direct entry feed a reviewable record of facts, with provenance, corrections, and merge/supersede history across roles, credentials, projects and achievements. |
| **Opportunity discovery** | Structured job sources for Greenhouse, Lever, SmartRecruiters and Ashby, plus the public Remote OK and Arbeitnow feeds. Governed, browser-backed paths cover recognized portals such as Workday and iCIMS. A source is monitored only after you approve it. |
| **Opportunity assessment** | Separate verdicts for eligibility, evidence coverage, career alignment and preferences, with blockers and unknowns stated plainly. |
| **Resumes** | Deterministic, ATS-friendly PDFs; target-specific tailoring; the Truth Gate and Parseability Gate; versioning; and the exact file you sent, kept with each application. |
| **Application materials** | Cover letters built from your evidence. They are flagged as stale when that evidence changes, and they copy to your clipboard only when ready. |
| **Applications** | Status, notes, contacts, milestones, reminders, follow-ups, interviews, offers and negotiation, all recorded by you. |
| **Interview preparation** | Grounded in the actual job, your confirmed evidence, the requirement mapping and the resume you submitted. |
| **Stories and insights** | Evidence-linked career stories, recurring-gap analysis and observed outcomes, without treating correlation as destiny. |
| **Personal Brand** | Manual-first LinkedIn post drafting with readiness checks and exact-copy approval, plus analytics from your own LinkedIn exports. There is no account connection and no automatic posting. |
| **Backup and portability** | Verified backup and staged restore, JSON Resume interoperability, and portable `.jobranger` archives that move between the Windows app and the PWA. |
| **Google Drive export** *(opt-in, off by default)* | Send one verified resume PDF to your own Drive, with approval each time and only the narrow `drive.file` permission. It is enabled once the Google OAuth client is provisioned ([#252](https://github.com/MythologIQ-Labs-LLC/sojourner/issues/252)). |

**Not goals:** mass auto-apply, invented qualifications or relationships, silent uploads to AI providers, and a single score posing as hiring truth.

## Principles

1. **Quality over quantity.** Measure progress by qualified, intentional applications, not by volume.
2. **Career Evidence is the authority.** Imported facts start as proposals. Only facts you confirm can support a claim.
3. **Preferences are not constraints.** Remote preference, pay targets, commute and schedule keep their exact meaning.
4. **Explain uncertainty.** Missing job data stays missing instead of becoming false precision.
5. **Useful before AI.** The core workflow needs no AI provider. Any optional integration stays a narrow, disclosed adapter.
6. **You decide.** Sojourner discovers, organizes, explains, prepares and reminds. Consequential actions remain yours.

## Privacy and security

- **Local by default.** The Windows app keeps your workspace in local SQLite behind a typed IPC boundary. The PWA keeps it in browser-private storage (SQLite WASM on OPFS). Serving the PWA from a website never makes that server the owner of your career data.
- **No telemetry, no account.** Nothing about you leaves your device unless you explicitly export or share it.
- **Governed job fetching.** The desktop app fetches sources through a governed transport that pins each connection to vetted public addresses. The PWA may reach only an allowlist of job-board APIs, under a strict CSP with Trusted Types.
- **Narrow integrations.** Google Drive export uses only the `drive.file` scope, and Google sign-in runs on a separate helper origin, isolated from your workspace.
- **Signed Windows releases.** Installers and executables are Authenticode-signed by MythologIQ Labs, LLC, with each signature verified (`signtool verify /pa`, signer and timestamp) before publication.

See [SECURITY.md](./SECURITY.md) to report a vulnerability, and [DISTRIBUTION_TRUST.md](./docs/DISTRIBUTION_TRUST.md) for release provenance.

## How it is built

One Career Ops core with two runtime surfaces, so the Windows app and the PWA can never become different products with different career logic.

```text
React product UI
  targeting · jobs · applications · evidence · resume · interview prep · insights · settings
                              │
                     typed runtime boundary
                              │
                   shared Career Ops core
  repositories · migrations · domain services · validators
  requirements · assessment · Truth Gate · Parseability Gate
  application lifecycle · backup · interoperability
                 │                               │
        Windows (Electron)                  Web (PWA)
        native SQLite                       SQLite WASM + OPFS
        managed files                       browser-local artifacts
        governed acquisition                service worker + strict CSP
```

Architecture decisions are recorded in the [Canonical Architecture Index](./docs/ARCHITECTURE_INDEX.md); the runtime and parity details are in [PWA_RUNTIME.md](./docs/design/PWA_RUNTIME.md) and [ARCHITECTURE_PLAN.md](./docs/ARCHITECTURE_PLAN.md).

## Project status

| | |
| --- | --- |
| **Development line** | `1.0.0-alpha.1`, the first Sojourner release: the signed Windows release pipeline, the PWA runtime, workspace recovery, Google Drive export (off by default), and the Sojourner rename. |
| **Latest published release** | None yet for Sojourner. Job Ranger releases (last: v1.2.0, October 5, 2026, unsigned) are archived as `job-ranger-v*` tags. |
| **Next release** | **v1.0.0-alpha.1**, the first signed alpha: a Windows installer published as a GitHub pre-release, built and signed by the [release workflow](./.github/workflows/release-build.yml) only after owner approval. |
| **Other platforms** | macOS and Linux are served by the PWA. Native packages are not planned. |

The factual snapshot lives in [SYSTEM_STATE.md](./docs/SYSTEM_STATE.md); history is in [CHANGELOG.md](./CHANGELOG.md); release gates are in [RELEASE_READINESS.md](./docs/RELEASE_READINESS.md).

## Development

Requirements: Node.js `>=22.12.0`, npm, and a `sqlite3` binary on `PATH` or named by `SQLITE3_PATH`. The desktop tests and the Electron app need it.

```bash
npm ci
npm run repo:health          # typecheck, desktop and web builds, full test suite
npm run test:e2e             # Windows (Electron) Playwright suite
npm run test:pwa:e2e         # web (PWA) Playwright suite in Chromium
npm run electron:dev         # run the desktop app with hot reload
npm run dev:pwa              # run the PWA dev server
npm run electron:build:win   # build the Windows installer (signed only by the release workflow)
```

<details>
<summary>More commands and developer tools</summary>

```bash
npm run test:unit            # fast unit suites
npm run build:pwa            # production PWA build -> dist-pwa/
npm run preview:pwa          # serve an existing build at http://localhost:4174
npm run test:pwa:engine      # shared-core suites on the SQLite WASM engine
npm run demo:record          # re-record the walkthrough with the fictional fixture
npm run demo:screenshots     # regenerate the tour screenshots
```

**Local MCP reader (developer preview).** An opt-in, read-only MCP stdio adapter lets a local agent client you authorize query bounded Career Evidence, objectives, opportunities and post readiness from the Windows app's workspace. It starts with zero data scopes and cannot edit records, approve posts, publish or send messages. It is not a published ChatGPT plugin. See [the adapter guide](./docs/integrations/JOB_RANGER_MCP_READONLY.md) and [ADR-0002](./docs/adr/0002-local-readonly-mcp-boundary.md).

</details>

Start with the [documentation index](./docs/README.md) and the [repository workflow](./docs/REPOSITORY_WORKFLOW.md) before opening an issue or pull request.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Outside contributions require agreement to the [Contributor License Agreement](./CLA.md). You keep ownership, and MythologIQ Labs, LLC may distribute your contribution under AGPL-3.0-only and commercial terms.

Governance and truth-in-status rules are in [GOVERNANCE.md](./GOVERNANCE.md). Brand assets and usage are in [BRANDING.md](./docs/BRANDING.md) and [TRADEMARKS.md](./TRADEMARKS.md). Third-party attribution is in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

Sojourner is open source under the [GNU Affero General Public License v3.0 only](./LICENSE). Commercial use and paid distribution are permitted, and covered modified versions remain subject to AGPL source-sharing. Versions released under MIT, including v1.2.0, keep their MIT grants ([LICENSE_HISTORY.md](./LICENSE_HISTORY.md)). The Sojourner name is governed separately by [TRADEMARKS.md](./TRADEMARKS.md).

<sub>Sojourner was previously named Job Ranger. The repository, `MythologIQ-Labs-LLC/sojourner`, was renamed on 2026-11-02. Compatibility identifiers (the app ID, storage names and `.jobranger` archives) keep their original names so existing installations and backups keep working.</sub>
