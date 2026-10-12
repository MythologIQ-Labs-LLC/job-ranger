# Local evidence checker research spike (#267)

**Status:** optional, unmerged, local-only technical experiment. NOT a Qor gate, PR status check, approved design, release feature, or remediation closure.

## What it verifies

`scripts/local_evidence_cli.py` (Python standard library only) reads one typed v3 evidence inventory from an immutable Git commit named by an exact `--head` SHA. It then checks each declared claim against a regular blob at an exact path in an exact claim commit. That commit must be an ancestor of (or equal to) `--head`.

| Kind | Verified when |
| --- | --- |
| `line-equals` | Line `line` (1-based) of the UTF-8 blob equals `text`. Lines split on `\n`. One trailing `\r` is removed per line, so CRLF files compare like LF files. A final newline does not create an extra line. |
| `text-present` | `text` occurs literally (exact code points, no Unicode normalization, case-sensitive) in the UTF-8 blob. |
| `text-absent` | The path exists as a regular UTF-8 blob and `text` does not occur literally in it. A missing path **fails**; it is not treated as absence. |
| `file-lines` + `equals`/`at-most` | Count of `\n`, plus one if the blob is non-empty and lacks a final newline, equals / is at most `value`. Empty blob = 0 lines. Lone `\r` is not a line break. |

What fails closed:

- Non-UTF-8 blobs fail every kind, including `text-absent`.
- A UTF-8 BOM is kept as part of line 1.
- Symlinks (`120000`), gitlinks (`160000`) and trees fail.
- Commit SHAs that name a tag, tree or blob object fail.

Output reports `VERIFIED n/m declared claims`, one `FAILED: <id>: <reason>` line per failed claim (at most 30), and `TRUNCATED: k additional claim errors` when more failed. Exit code is `0` only when every declared claim verified; `1` otherwise, including all input errors; argparse usage errors exit `2`.

### Always NOT CHECKED

- Human judgments (counted only).
- Prose completeness.
- Missing empirical assertions.
- Markdown or plan structure. The `plan` field must be a safe `.md` path; it is neither read nor interpreted.
- PR applicability.
- GitHub required-check enforcement.
- Qor remediation closure.

A verified literal is not proof that a plan is truthful or complete.

## Usage

Requirements: Python 3.10+ (exercised on 3.11.9 only), and Git in an absolute `PATH` directory (relative `PATH` entries and the caller's current directory are never searched). Git 2.44+ is recommended so that `GIT_NO_LAZY_FETCH` applies; on older Git, `-c protocol.allow=never` refuses fetches unless repository-local config re-allows a protocol (for example `protocol.file.allow=always`). Exercised on Git 2.55.0.windows.3 only. No network access, no third-party packages.

```sh
SHA=$(git rev-parse HEAD)
python scripts/local_evidence_cli.py --repo . --head "$SHA" --inventory docs/example.evidence.json
```

`--head` must be a full lowercase 40-character SHA of a commit; `HEAD`, branch names, tags and abbreviations are rejected. The inventory is read from that commit, not from the working tree.

Example inventory (placeholder SHA, not a factual repository claim):

```json
{
  "schema_version": 3,
  "plan": "docs/plan-qor-phase18-example.md",
  "claims": [
    {
      "id": "example-text",
      "kind": "text-present",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "path": "docs/README.md",
      "text": "Job Ranger",
      "purpose": "Illustrative exact source text check"
    }
  ],
  "judgments": []
}
```

## Input contract and limits

**Inventory blob**

- At most 64 KiB, strict UTF-8 JSON.
- Rejected: duplicate keys at any depth, `NaN`/`Infinity`, and parser failures (excess nesting, integers over Python's digit limit).
- Top level must be exactly `schema_version` (integer `3`), `plan`, `claims` and `judgments`.

**Claims**

- 1–200 claims.
- Each claim has exactly `id`, `kind`, `commit`, `path`, `purpose`, plus the fields its kind requires: `line`+`text`, `text`, or `predicate`.
- Unknown kinds and extra fields are rejected, including executable-looking ones (`command`, `argv`, `setup`).
- `id` matches `[a-z0-9][a-z0-9-]{0,48}` and is unique across claims and judgments.
- `commit` is a full lowercase SHA.
- `path` is at most 300 characters of `/`-separated `[A-Za-z0-9_.][A-Za-z0-9_.-]*` segments, excluding `.` and `..`. That rules out absolute paths, traversal, leading `-` and pathspec magic.
- `purpose` is 8–300 characters.
- `text` is 1–500 characters on a single line.
- `line` is 1–1,000,000.
- `predicate` is exactly `{operator: equals|at-most, value: 0–1,000,000}`. Booleans and floats are not integers.

**Judgments and sources**

- 0–50 judgments.
- Each judgment has exactly `id`, `statement` (8–300), `owner` (2–80) and `rationale` (40–1000), none containing a `\n` line feed (a `\r` is not rejected; judgments are never printed).
- Source blobs are at most 2 MiB; the size is checked with `cat-file -s` before the content is read.

**Measured worst case**

200 claims × 2 MiB blobs (≈1,000 Git processes) took 16.8 s locally on Windows.

**Upper bound**

The per-call timeout bounds a stalled repository at 30 s × roughly 5 Git calls per claim.

## Trust boundary

The operator, the local repository and its `.git` directory, Python and Git are trusted. The inventory and the committed source blobs are untrusted data.

The checker:

- **runs only** `git cat-file`, `git ls-tree` and `git merge-base`, with argument values validated as SHAs or safe paths. Inventory data selects objects, never operations. Git is resolved to an absolute path from absolute `PATH` entries only, so a `git`/`git.exe` committed in the checkout and run from its root is never executed. Nothing from the repository is executed or checked out, and the working tree is not modified.
- **isolates Git:**
  - The environment is minimal, so inherited `GIT_DIR` and `GIT_CONFIG_*` are dropped.
  - System and global Git config are ignored.
  - `core.fsmonitor` is off.
  - Replace refs **and** the deprecated `info/grafts` file are ignored, so local history rewrites cannot forge ancestry.
  - Lazy fetch is disabled and every transport is refused, so a partial clone cannot be made to contact a remote or mutate its object store.
  - Terminal prompts and stdin are closed.
  - Every Git call has a 30 s timeout.
- **reports only bounded text:**
  - Diagnostics are fixed messages plus validated claim ids.
  - The one inventory-derived string, a duplicate key, is truncated to 30 characters and `ascii()`-escaped, so inventory data cannot inject lines, terminal escapes or non-encodable characters.
  - Source content is never printed.

**Residual trust assumptions**

- Repository-local `.git/config` is still honored, as Git requires to read the repository. The Git commands used do not run hooks, filters, pagers or transports.
- Shallow boundaries can make a true ancestor look unrelated. This fails closed.
- A repository owned by another user needs a `safe.directory` entry, which global config would normally hold. Without it the checker fails closed.

## Test commands and results

```sh
python -m py_compile scripts/local_evidence_cli.py
python -m py_compile tests/test_local_evidence_cli.py
python -m unittest discover -s tests -p "test_local_evidence_cli.py" -v
```

All results below are local execution on Windows 11, Python 3.11.9 and Git 2.55.0.windows.3. **No hosted CI was run.**

**Baseline, `a157390`**

- 13 tests ran in 10.8 s with no hang: 12 passed, 1 errored.
- The error was in `test_symlink_source_blob_rejected`: `os.symlink` needs a privilege Windows does not grant by default (`WinError 1314`).
- The earlier report of a full-suite run exceeding the runner's limit was **not reproduced**, and its cause cannot be established after the fact.
- A demonstrated weakness: the fixture used the developer's global Git config. Under a commit-signing global config, all 13 tests errored. With an interactive signing program, `git commit` can block on a passphrase prompt.

**Red-first**

- Against `a157390`, 7 of the new tests failed for the intended reasons:
  - `VERIFIED 4/4` after a lazy fetch.
  - A forged `VERIFIED` line.
  - Raw ANSI escapes.
  - Two `UnicodeEncodeError` tracebacks.
  - An empty stdout plus a traceback for missing Git.
  - A missing timeout contract.
- The graft test failed separately with `VERIFIED 4/4`.
- After the independent review, the caller-directory Git test failed against `bded6d4`: `FAILED: revision does not identify an existing commit`, because the planted binary ran instead of Git.

**After repair**

- 23/23 OK in about 23 s.
- 23/23 OK with `NoDefaultCurrentDirectoryInExePath` removed and a hostile commit-signing `GIT_CONFIG_GLOBAL`.

## Hardening record (QOR Harden methodology, component scope, repair disposition)

The [canonical `/qor-harden` skill](https://github.com/MythologIQ-Labs-LLC/Qor-logic/blob/main/qor/skills/sdlc/qor-harden/SKILL.md) and its `implementation-quality-sweep.md` taxonomy were applied as a **methodology**. The Qor governance runtime was not executed on this spike branch. No ledger entry, runtime receipt, seal or gate PASS exists or is claimed.

| ID | Severity | Behavior, evidence, consequence | Repair and validation |
| --- | --- | --- | --- |
| IQ-TRUST-001 | MAJOR | **Behavior:** in a `--filter=blob:none` clone, inventory-selected missing objects were fetched through the configured promisor transport. **Evidence:** the blob was absent before the run and present after. With a stalled `core.sshCommand`, the CLI was still running after 60 s. **Consequence:** this broke the read-only/offline contract and let inventory data trigger a transport. | `GIT_NO_LAZY_FETCH=1` and `-c protocol.allow=never`; each alone was verified to block the fetch. Covered by `test_partial_clone_never_fetches_missing_objects`. |
| IQ-RESOURCE-001 | MAJOR | **Behavior:** Git subprocesses had no timeout and inherited stdin. **Evidence:** the indefinite hang above. | 30 s per-call timeout raising a controlled failure, plus `stdin=DEVNULL`. Covered by `test_git_timeout_is_a_controlled_failure` (unit-level, via a near-zero timeout). |
| IQ-TRUST-002 | MINOR | **Behavior:** a `.git/info/grafts` line spliced an unrelated commit under `--head`, so a non-ancestor claim reported `VERIFIED 4/4`. Replace refs were already disabled for the same reason. **Consequence:** this needs local `.git` write access, which the trust model already grants. | `GIT_GRAFT_FILE` points at the null device. Covered by `test_local_grafts_cannot_forge_claim_ancestry`, which includes a no-graft control. |
| IQ-TRUST-003 | MAJOR | **Found by the independent review; my own probe missed it** because this session sets `NoDefaultCurrentDirectoryInExePath=1`. **Behavior:** `subprocess.run(['git', ...])` let Windows `CreateProcess` search the caller's current directory before `PATH`. **Evidence:** with the variable unset and the CLI run from a directory containing `git.exe`, the planted binary ran instead of Git. **Consequence:** the documented `--repo .` invocation from a checkout root could execute committed repository content. | `git_executable()` resolves `git`/`git.exe` from absolute `PATH` entries only. Covered by `test_git_in_caller_directory_is_never_executed`, which includes a control proving a bare `git` would hit the planted file. |
| IQ-OBSERVE-001 | MAJOR | **Behavior:** the duplicate-key message echoed the raw key. **Evidence:** `"\nVERIFIED 4/4 declared claims"` printed a forged success line; ANSI escapes reached stdout; `U+202E` and CJK keys crashed with `UnicodeEncodeError` on a cp1252 pipe. | `ascii()` escaping. Covered by `test_untrusted_json_keys_cannot_forge_output_lines`. |
| IQ-CORRECT-001 | MINOR | **Behavior:** with Git missing from `PATH`, the CLI printed a `FileNotFoundError` traceback and empty stdout. The exit code was non-zero, so there was no false success. | `OSError` becomes `FAILED: Git executable could not be started`. Covered by `test_unavailable_git_is_a_controlled_failure`. |
| IQ-COMPLETE-001 | MAJOR (test validity) | **Behavior:** the symlink test needed an OS privilege and errored on default Windows. No gitlink test existed. **Consequence:** the refusal of non-regular entries was unproven on that platform. | Entries are written with `update-index --cacheinfo`, so the test needs no OS symlink; it covers both symlinks and gitlinks. |
| IQ-CORRECT-002 | MAJOR (test validity) | **Behavior:** the fixture's Git used global/system config and inherited stdin, and child processes had no timeout. **Evidence:** 13/13 errors under a commit-signing global config. **Consequence:** a plausible but unproven source of the earlier runner timeout. | Hermetic fixture environment, `stdin` closed, 120 s timeout per child process. |
| IQ-MAINTAIN-001 | MINOR | **Behavior:** `check_inventory` had an unused `expected_path` parameter. | Removed. |

Additional coverage, green before and after the repairs:

- Commit-object type validation (tag, tree and blob SHAs).
- Malformed inventory bytes: invalid UTF-8, 60,000-deep nesting, a 5,000-digit integer, `NaN`, and a blob over 64 KiB.
- 16 line-semantics boundary cases (see table above).
- 45 failures with truthful `TRUNCATED: 15` and exit 1.

**Rejected candidates**

- No option or pathspec injection was found; validation precedes every Git argument.
- No other uncontrolled exception path was found in input validation.

**Residual sweep after repair**

- Every Git call still fails closed. A timeout or `OSError` raises even on `allowed_failure` paths rather than reading as "not an ancestor".
- No new output path carries untrusted text.
- The tests assert behavior through the CLI process, except the timeout mapping, which is tested at unit level.
- No out-of-scope files changed.

**Ship assessment for this component, within local-only scope:** YES after the independent review below (round 2 PASS).

**Test limit:** `test_partial_clone_never_fetches_missing_objects` stops at the missing inventory blob, so the claim-blob fetch path is covered only by the shared `git()` controls.

## Independent review

The review used a fresh-context subagent. It was read-only on the checkout, its probes ran in a scratch directory, and it took no GitHub actions.

**Round 1, `bded6d4`: VETO**

- 22/22 tests passed.
- These held under probing:
  - SHA and object-type enforcement.
  - Refs named with 40 hex characters.
  - Replace objects, corrupt objects and missing objects.
  - Malformed JSON, wrong types and duplicate ids.
  - Path, pathspec and option injection.
  - Lazy-fetch isolation. With neither mitigation the fetch reproduced; each mitigation alone blocks it.
  - Repository and `.git` hashes are identical before and after a run.
- One confirmed MAJOR defect: D1 (the caller-directory `git.exe`, now IQ-TRUST-003). The doc also falsely claimed that case had been refuted.

**Correction pass `f0be4e6`, the only amendment round**

- D1 was fixed and the doc corrected.

**Round 2, `f0be4e6`: PASS**

- The D1 reproduction now gives `VERIFIED 1/1`.
- The new test fails against `bded6d4` and passes against `f0be4e6`.
- 23/23 tests pass, with and without `NoDefaultCurrentDirectoryInExePath`.
- `PATH` edge cases either resolve the real Git or fail closed without a traceback. The cases were quoted entries, trailing separators, empty entries, `.`, a drive-relative `C:`, a leading space and `git.cmd` only.
- `git.cmd`-only was already unsupported before the fix.
- No scope expansion.

**Remaining observations (not defects)**

- The worst-case timeout ceiling is loose: 200 × about 5 calls × 30 s.
- `PATH` is re-scanned on every Git call; the cost is negligible.
- A root-relative `PATH` entry such as `\tools` is treated as absolute. The operator's `PATH` is trusted.
- Repository-local config can weaken `protocol.allow=never` on Git older than 2.44.
- The partial-clone test stops at the inventory blob.
- Red-first evidence for the non-ASCII crash depends on a cp1252 pipe.

**Ship assessment**

- **YES** for the bounded local-only component: an optional, standalone, read-only checker of typed local evidence.
- **Not** an approval of any PR gate, Qor seal, or governance closure.

## Not solved

Phase 18 VETO #114 remains binding. The proposed PR gate had these findings:

- F1: a multiple-merge-base applicability bypass.
- F1b: unhandled Git mode/type changes.
- F2: corpus/schema conversion gaps.
- F3: filename and governed-path drift.

This local CLI makes **no PR applicability claims** and does not resolve those findings.

Do not wire it to Actions or mark D1, D2 or D3 complete. These remain unchanged:

- Phase 17 VETO #108.
- Both pending Phase 16 shadow events.
- PRs #232, #233 and #238.
- The WWR HOLD.

This spike was not emitted or accepted by the Qor governance runtime.
