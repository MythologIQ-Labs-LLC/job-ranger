# Contributing to Job Ranger

Thanks for helping improve Job Ranger. The project is intentionally consumer-facing: contributions should make the job-search experience more reliable, understandable, private, and usable by people who do not have software-development expertise.

## Before you start

Use an issue before beginning work that changes product behavior, architecture, persistence, security boundaries, packaging, or major dependencies.

Small documentation corrections and narrowly scoped bug fixes may use a lighter maintainer path when the intent and risk are obvious.

Security vulnerabilities should follow [SECURITY.md](./SECURITY.md), not a public issue containing exploit details.

## Product boundaries

Contributions should preserve these principles:

- Core functionality remains useful without a remote inference provider.
- Local-first behavior is the default unless an explicit product decision changes it.
- Career Evidence owns factual career truth; goals/preferences do not silently become evidence.
- Preferences do not silently become hard constraints.
- The UI should describe user intent, not implementation jargon.
- Opportunity assessment, resume, credential, application-material, and career claims must be evidence-aware and must not invent user experience.
- Unsupported source types fail honestly rather than report fabricated success.
- Unknown information remains unknown rather than becoming fake precision.
- Consequential source/application actions require user authority.
- Autonomous mass auto-apply is not a current product goal.

## Development setup

Prerequisites:

- Node.js `>=22.12.0`;
- npm;
- `sqlite3` on `PATH`, or `SQLITE3_PATH` configured explicitly.

```bash
npm ci
npm run repo:health
npm run electron:dev
```

The authoritative privileged Electron source lives under `electron/src/**`. Generated runtime output lives under `electron-runtime/**` and should not be hand-edited or committed as an independent source of truth.

## Change expectations

A material change should:

1. Explain the user or maintenance problem being solved.
2. Keep implementation no broader than necessary.
3. Update affected current documentation when behavior, architecture, packaging, security, or public claims change.
4. Preserve security/authority boundaries unless the change explicitly and intentionally modifies them.
5. Include or update tests where behavior can reasonably be automated.
6. Record the validation actually performed.
7. Avoid mixing unrelated dependency, formatting, product, and documentation work.
8. Preserve licensing/attribution requirements at the exact code/asset boundary.

For user-facing visual changes, include screenshots when they materially help review.

## Validation and GitHub Actions budget

The project deliberately preserves GitHub Actions budget. Hosted CI/CD is not required for every routine documentation change or every iteration of release preparation.

When appropriate, the maintainer may run validation manually in an isolated environment.

Manual validation should record:

- environment;
- exact commands/checks;
- results;
- anything that could not be executed.

For code changes, the normal local baseline is:

```bash
npm ci
npm run typecheck
npm run build
npm run test
npm run test:unit
npm run test:e2e
```

`npm run repo:health` combines typecheck, production build, desktop compilation, and backend/smoke coverage.

Do not claim a hosted gate passed when it was intentionally not run.

## Optional local evidence verifier (development only)

The standalone [local evidence checker](./scripts/local_evidence_cli.py) verifies **declared, literal source facts** from exact committed Git objects without network access or third-party Python packages. It is optional and does not enforce pull requests or satisfy Qor governance gates.

Run the [four-claim sample inventory](./docs/examples/local-evidence-sample.evidence.json) from a checkout containing this tool (Git 2.44+ recommended, Python 3.10+):

```sh
SHA=$(git rev-parse HEAD)
python scripts/local_evidence_cli.py --repo . --head "$SHA" --inventory docs/examples/local-evidence-sample.evidence.json
```

On Windows PowerShell:

```powershell
$sha = git rev-parse HEAD
py -3 scripts/local_evidence_cli.py --repo . --head $sha --inventory docs/examples/local-evidence-sample.evidence.json
```

The sample pins source claims to a known ancestor commit and should report four verified claims. The inventory itself is read from the **explicit** `--head` commit. A failure, missing object, or incomplete clone must be investigated, not interpreted as a PASS. The [research/validation record](./docs/research/LOCAL_EVIDENCE_CLI_267.md) explains the exact schema, operating assumptions, tests and limits. **Human judgments, omitted claims and plan prose are not checked.**

## Pull requests

Use pull requests when they improve review, collaboration, risk management, or release evidence.

A documentation-only maintainer remediation may be merged directly when opening a pull request would consume unnecessary hosted Actions budget. The same truth/review standard still applies.

## Dependency changes

Patch/minor updates may be grouped when compatibility permits.

Major-version changes are migrations, not routine hygiene. Review:

- runtime requirements;
- ESM/CJS boundaries;
- packaging impact;
- Electron compatibility;
- native dependencies;
- release behavior;
- security findings.

Do not use `npm audit fix --force` as a substitute for dependency analysis.

A vulnerability exception must be narrow, documented, and removed when the supported upstream fix becomes available.

## Documentation standards

Use the status vocabulary from [GOVERNANCE.md](./GOVERNANCE.md):

- **shipped**: present in a published release;
- **implemented on main**: merged but not necessarily released;
- **candidate / next**: plausible evidence-backed follow-on work;
- **deferred**: intentionally not active;
- **rejected / non-goal**: outside current governance;
- **historical**: provenance only.

Do not turn planning language into product claims.

Current documentation authority is indexed in [docs/README.md](./docs/README.md). Before a release, use [docs/RELEASE_READINESS.md](./docs/RELEASE_READINESS.md).

## Licensing

By contributing, you agree that your contribution may be distributed under the repository's GNU Affero General Public License v3.0 only (AGPL-3.0-only).

Do not copy third-party code/assets into Job Ranger unless the exact license permits the intended use and attribution obligations are preserved. The repository license does not automatically replace or override the terms of bundled templates, fonts, models, datasets, dependencies, or hosted services.

Substantial adopted/adapted work should be reflected in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) where required.

## Community

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
