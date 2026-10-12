# Job Ranger Help

Job Ranger is a local-first application for discovering, evaluating, preparing for, and tracking job opportunities.

This guide describes the **stable published release (v1.2.0)**. It also explains how the newer Microsoft Store app and web app behave. Both are implemented in the repository but are **not yet published**: the Store app awaits certification, and the web app has no public site yet but can be self-hosted on your own computer (see below).

## Which version am I using?

The latest stable public release is **v1.2.0**, available as direct-download installers for:

- Windows x64;
- macOS Apple Silicon (arm64);
- macOS Intel (x64).

v1.2.0 installers are unsigned. See the trust notes in the README and [`docs/TESTER_INSTALLATION.md`](./docs/TESTER_INSTALLATION.md).

### Newer ways to run Job Ranger (not yet published)

| Way | Status | Where your data lives |
| --- | --- | --- |
| **Microsoft Store app** (Windows) | Package built and validated; Store certification pending | In the Store app's private storage on this PC |
| **Web app** (Chrome or Edge on Windows, macOS, or Linux; Firefox and Safari are not yet validated) | No public site yet. You can self-host it locally at `http://localhost:4174`; see *Running the web app locally* below | In this browser profile's private storage for that exact address. Nothing is uploaded |
| Direct-download installers | Advanced/test use going forward | In your user profile's Job Ranger folder |

Each installation keeps its own data. Move data between them with a portable `.jobranger` backup (see *Backup and restore*). Settings → **This installation** shows which one you are using, its version and build, and where its data lives.

The web app supports the same Career Ops workflow, with a few browser limits:
- It cannot monitor career sites that need a full browser window (for example Workday or iCIMS pages). It can read the Greenhouse, Lever, Ashby, and SmartRecruiters job-board APIs.
- It checks sources only while it is open.
- It has no system tray or desktop notifications.
- "Show file" becomes "Download file".
- It cannot export resume PDFs that contain right-to-left (Arabic, Hebrew) or Indic (for example Devanagari) text; use the Windows app for those. Other scripts (accented Latin, Greek, Cyrillic, Thai, Chinese, Japanese, Korean) are supported.
- The first export that uses a new script must be online so the matching font can be downloaded and verified. After that it works offline.

#### Running the web app locally

Until a public site exists, you can run the web app on your own computer. You need Node.js 22.12 or newer and a copy of the repository:

```bash
npm ci
npm run selfhost:pwa
```

Then open **http://localhost:4174** in Chrome or Edge. Your data belongs to that exact address, so always use the same one. If the port is busy, Job Ranger stops with an error instead of quietly moving to another port, where your data would look missing. Before upgrading or experimenting, export a `.jobranger` backup. Do not clear this site's browser storage unless you mean to delete your local Job Ranger data.

## Workflow

### 1. First-run onboarding

New users can begin in several ways:

- **Resume first** — import an existing resume and review extracted Career Evidence.
- **No resume** — enter Career Evidence directly.
- **Goal first** — define the type of work you want before your career record is complete.

Partial setup remains valid.

### 2. Target Tracks

Use **Target Tracks** to keep separate job-search directions.

Where supported, choices preserve their meaning as:

- **Required** — hard constraint;
- **Preferred** — meaningful but not automatically disqualifying;
- **Target** — desired or aspirational value.

### 3. Career Evidence

Career Evidence is Job Ranger's factual career record.

Evidence can include employment, skills, education, projects, achievements, credentials/licenses, publications, volunteer/nontraditional work, and portfolio/work-sample references.

Imported evidence begins as a proposal. Only evidence you confirm or author directly may support factual application claims.

Evidence can be corrected, rejected, merged, or superseded without erasing history.

### 4. Resume import

Job Ranger supports:

- DOCX;
- text-bearing PDF;
- plain text;
- pasted text.

Original source artifacts are preserved before interpretation. Job Ranger records hashes, parser metadata, extraction history, and duplicate state.

Image-only/scanned documents surface **OCR required** rather than silently uploading them to a hosted OCR service.

### 5. Companies and source discovery

Use **Companies** to:

- add recognized employer career sources manually;
- discover opportunities from configured discovery providers;
- review provenance/support information;
- explicitly approve a discovered employer source before monitoring.

Discovery and monitoring remain separate. Finding a job at an employer does not silently convert the employer into a trusted monitored source.

**Unqualified development candidate (issue #136; not in the published release):** the desktop implementation is being expanded to search Himalayas for selected target-role titles. Results must credit and link back to Himalayas, and location restrictions are not promises of eligibility. The web/PWA runtime cannot call that JSON API directly because Himalayas disallows browser CORS, so the candidate skips that source and shows an explicit coverage warning. We Work Remotely RSS remains under separate assessment. See `docs/validation/source-discovery-tranche-2-candidate.md`.

Arbitrary generic career-site hostnames remain manual-review/non-runnable in v1.2.0.

### 6. Source snapshots and diagnostics

v1.2.0 preserves canonical collected job-source snapshots with retrieval metadata, hashes, completeness state, and change history. Requirement analysis reasons over preserved source text rather than only a short listing snippet.

Acquisition outcomes distinguish states such as:

- success;
- success with zero jobs;
- cooldown/circuit state;
- unsupported source;
- browser unavailable;
- network-policy rejection;
- access denied;
- rate limiting;
- timeout/retrieval failure;
- extraction/parser failure.

This prevents “zero jobs” from pretending every source run succeeded normally.

### 7. Opportunity assessment

For a selected Target Track, Job Ranger separates:

- **Eligibility**;
- **Evidence coverage**;
- **Career alignment**;
- **Preference alignment**;
- **Blockers**;
- **Unknowns**.

Unknown information remains unknown instead of being converted into fake precision.

### 8. Resume workspace

Job Ranger can create a deterministic resume from confirmed Career Evidence with:

- ATS-oriented templates;
- target-job evidence selection;
- deterministic tailoring;
- evidence links;
- Truth Gate;
- isolated Chromium PDF rendering;
- Parseability Gate;
- versioned immutable artifacts;
- exact application-artifact linkage.

A tailored resume may emphasize supported evidence. It may not invent experience.

The **Truth Gate** blocks export when a statement lacks confirmed Career Evidence, or when you edited a statement to add words or numbers that its linked evidence does not contain. If it flags an edit, either reword the statement using what your evidence says or add the missing fact to your Career Evidence first. In builds after v1.2.0 this check also covers non-Latin text (for example Chinese, Japanese, Korean, Cyrillic, Arabic, or accented words) and single-digit numbers.

The **Parseability Gate** re-reads the generated PDF the way an applicant-tracking system would and blocks export if your name, contact details, or statement text did not survive. In builds after v1.2.0 it checks non-Latin text too. Right-to-left and Indic text cannot be checked reliably by PDF parsers, so for those Job Ranger shows an advisory asking you to open the PDF and check it yourself before submitting.

### 9. Applications

Applications can preserve:

- lifecycle status;
- notes;
- exact submitted resume artifact;
- contacts;
- interviews/milestones;
- deadlines/follow-up events;
- reminders;
- target-track association;
- offer/negotiation state;
- prepared application materials.

Job Ranger does not submit applications for you.

### 10. Interview preparation

Interview preparation is grounded in the tracked job, confirmed Career Evidence, requirement/evidence mappings, and the exact resume Job Ranger recorded as submitted.

It distinguishes what the employer saw, additional confirmed evidence, later-corrected evidence, and real gaps.

### 11. Career Stories

Career Stories provide reusable evidence-linked narratives for interviews/application preparation. Later factual changes can make older stories visibly stale.

### 12. Application materials

Job Ranger can prepare versioned evidence-grounded application materials. If supporting Career Evidence changes, prior drafts remain historical and are marked stale rather than silently rewritten.

### 13. Search Insights

Search Insights summarizes observed search state such as applications by Target Track/source/status, interview/offer outcomes, recurring unsupported requirements, and evidence-based strategy signals above bounded sample thresholds.

These are observations, not causal hiring claims. Raw application count is not treated as success.

### 14. Backup and restore

Job Ranger provides versioned local backup/restore with:

- SQLite snapshot;
- managed artifacts;
- integrity hashes;
- staged restore;
- path rebasing when restored to another data root;
- rollback preservation until the restored state is validated.

Builds after v1.2.0 (including the Store app and the web app) save a backup as a single **`.jobranger` file**. The same file restores into the Windows app or the web app, which is how you move your data between installations. Restores check every file's integrity and refuse backups that are corrupted, were modified by another tool, or were created by a newer Job Ranger version.

v1.2.0 backups are folders. In the Windows app, restore one by selecting the `manifest.json` inside the folder.

**Microsoft Store app and an older desktop installation:** the two do not share data. In the Store app, Settings → **This installation** → **Import desktop data and restart** copies your desktop data into the Store app. Your desktop installation is not changed. Uninstalling the Store app deletes its data, so create a backup first.

**Web app storage:** browsers can clear site data under storage pressure unless they grant *persistent storage*. Use Settings → **This installation** → **Request persistent storage**, install the web app if your browser offers it, and export backups regularly.

### 15. JSON Resume interoperability

JSON Resume import/export is a portability adapter, not Job Ranger's canonical data model.

Imported JSON Resume facts still require user authority before becoming factual Career Evidence.

## Source-support labels

### Supported

A structured adapter exists and is the preferred acquisition path.

Current structured families:

- Greenhouse;
- Lever;
- SmartRecruiters;
- Ashby.

### Detected

Job Ranger recognizes a known provider/vendor portal and can attempt its governed extraction path. Reliability varies by site implementation.

Examples include Workday, iCIMS, BambooHR, Taleo, Oracle Careers, and Microsoft Careers.

### Browser required

A recognized portal requires the constrained rendered-browser path.

### Manual review

Job Ranger does not claim a reliable automated path. Arbitrary generic career-site hostnames remain manual review in v1.2.0.

## Acquisition security

v1.2.0 uses connection-level anti-rebinding protection for governed automated acquisition.

Policy resolution produces the exact approved public address set. Direct sockets connect only to approved addresses while TLS continues to verify the original hostname. Redirects are independently approved/pinned, and isolated browser HTTP/HTTPS document/subresource requests are routed through the governed transport.

Do not treat a source's ability to open in your normal browser as proof that Job Ranger should automatically retrieve it.

## Privacy and data storage

Job Ranger is local first.

The desktop app keeps structured career/search state behind the Electron/SQLite boundary, including Career Profile, Target Tracks, Applications, Career Evidence/provenance, job source snapshots, requirements/mappings, resumes, lifecycle records, Career Stories, application materials, and insights state.

Managed source/resume artifacts are stored in Job Ranger's local data/artifact directory rather than uploaded to a hosted Job Ranger account.

Core functionality does not require a remote inference provider.

In the web app, the same data lives in the browser's private storage for the Job Ranger site (origin-private file system) on your device. The web app's security policy allows outbound requests only to the public job-board APIs it reads. Your resumes, Career Evidence, and applications never leave the device unless you download a file.

## Installing v1.2.0 safely

v1.2.0 direct-download installers are unsigned. Before running one, verify its platform SHA-256 file and release manifest from the same GitHub Release.

### Windows 11

An unsigned build may be allowed through an OS-native SmartScreen per-file flow on some systems. If Smart App Control blocks the app or Windows provides no safe per-file/per-app override, stop. The unsigned installer is not supported on that configuration. The Microsoft Store app will be the supported path once it is certified.

Do not disable Smart App Control, SmartScreen, or Defender globally merely to run Job Ranger.

### macOS

After verifying the checksum, attempt to open Job Ranger normally. If macOS blocks the unnotarized build and offers **System Settings → Privacy & Security → Open Anyway**, an informed user may use that bounded exception. Native macOS packages are not planned going forward; macOS users will be served by the web app.

Do not disable Gatekeeper globally or recursively strip quarantine metadata.

See [`docs/TESTER_INSTALLATION.md`](./docs/TESTER_INSTALLATION.md) and [`docs/DISTRIBUTION_TRUST.md`](./docs/DISTRIBUTION_TRUST.md).

## Troubleshooting

### I do not see jobs

Check:

1. the source URL points to a real careers/jobs page;
2. the source is active;
3. the latest acquisition status/diagnostic;
4. the source support state is not `manual-review`;
5. filters are not excluding results;
6. the third-party portal has not changed underneath its extraction path.

### Job Ranger found no requirements for a job

That does not prove the employer has no requirements. Review the preserved source snapshot and original posting; missing/partial source content remains an explicit uncertainty.

### Eligibility says Unclear

Job Ranger is missing a required fact, sufficient confirmed Career Evidence, or a clear interpretation. Unknown is intentionally different from mismatch.

### Imported resume evidence is not being used

Imported evidence is not factual authority until you review and confirm it.

### A credential is not supporting a job

Check its structured state. Expired, inactive, or pending credentials do not qualify merely because the name matches.

### An old application material or Career Story is marked stale

Supporting Career Evidence changed after the material/story was prepared. Review current evidence rather than assuming old wording is still factual.

### A source is unsupported or blocked

That is an intentional reliability/security state. Review the user-facing diagnostic and source support classification rather than trying to bypass acquisition policy.

### Notifications are not appearing

Confirm notifications are enabled in Job Ranger and allowed by the operating system. In the web app, desktop notifications and the system tray are not available.

### Web app: "Job Ranger is open in another tab or window"

Only one tab can use the browser's local Job Ranger workspace at a time, which protects your data from conflicting writes. Close the other tab; the waiting tab continues automatically.

### Web app: "A change could not be saved to browser storage"

The browser refused to store the change, usually because storage is full. Your previous saved data is unchanged. Export a backup, free storage for the site (or for the browser), then retry.

### Web app: "Job Ranger could not open its local workspace"

This browser mode does not provide the durable private storage Job Ranger needs (for example some private-browsing windows). Job Ranger will not fall back to temporary storage that could lose your data. Use a normal window of a current browser. If the message appears after an update, choose **Repair app shell**; this keeps your data.

### Web app: "A new version of Job Ranger is ready"

Choose **Reload to update** when convenient. Updates never change your data until the new version opens it, and Job Ranger refuses to open data written by a newer version rather than risk damaging it.

### Closing the window exits the app

Enable **Minimize to system tray on close** in Settings if you want Job Ranger to remain available in the tray.

### Windows says SQLite is missing

Windows installers (v1.1.2 and later) and the Microsoft Store package bundle the SQLite runtime. Developers running from source still need `sqlite3` on `PATH` or `SQLITE3_PATH` set explicitly. The web app uses a built-in SQLite engine.

### macOS warns about the application

v1.2.0 for macOS is unsigned/unnotarized under a documented exception. Follow only the bounded guidance above. Going forward, macOS users will use the web app.

## Frequently asked questions

### Does Job Ranger auto-apply for me?

No. Autonomous mass application submission is an explicit non-goal.

### Does Job Ranger invent qualifications or networking relationships?

No. Career claims require confirmed/user-authored Career Evidence, and the product design prohibits invented relationships/referrals/familiarity.

### Does Job Ranger upload my career/search history to a hosted account?

No hosted Job Ranger account is required by the current product.

### Does Job Ranger use AI?

Core functionality does not require remote inference. Any future optional external provider must be explicit and governed.

### Can Job Ranger read scanned/image-only resumes?

Not currently. Those imports surface an OCR-required state.

### Can Job Ranger export DOCX resumes?

Not currently. PDF is the governed resume output.

### Is every recognized dynamic careers site guaranteed to work?

No. Third-party portals vary and change. Job Ranger exposes support and reliability states specifically to avoid promising otherwise.

### Why is a generic employer career page marked manual review?

v1.2.0 deliberately automates recognized/governed source families rather than treating every arbitrary careers-looking hostname as an acceptable privileged acquisition target.

### Is Linux supported?

No. Linux packaging was evaluated and deferred until real user demand justifies the additional support surface.

## Developer appendix

### Requirements

- Node.js `>=22.12.0`;
- npm;
- `sqlite3` on `PATH`, or `SQLITE3_PATH` explicitly set.

### Common commands

```bash
npm ci
npm run repo:health
npm run test:unit
npm run test:e2e
npm run electron:dev
npm run electron:build:win
npm run electron:build:mac
```

For current architecture and release rules, see:

- [README.md](./README.md)
- [docs/SYSTEM_STATE.md](./docs/SYSTEM_STATE.md)
- [docs/ARCHITECTURE_PLAN.md](./docs/ARCHITECTURE_PLAN.md)
- [docs/RELEASE_READINESS.md](./docs/RELEASE_READINESS.md)
- [docs/DISTRIBUTION_TRUST.md](./docs/DISTRIBUTION_TRUST.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
