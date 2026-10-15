"""Read-only plan-claims gate for governed plans (phase 17 onward).

A gated plan carries one ```json qor-plan-claims manifest (version 2) outside its
canonical sections.

The gate never runs plan-supplied commands. It reads immutable git objects with
fixed `git cat-file` / `git ls-tree` calls only, in a scrubbed environment.

It enforces:
- a closed schema;
- full 40-hex commit SHAs that are declared and recorded in the prose;
- typed, subject-bound claims for every detected empirical assertion in canonical
  sections (plan_claims_prose.py);
- verified evaluation of each claim (plan_claims_source.py).

Lexical detection cannot certify arbitrary prose, so the independent auditor
still owns undeclared or judgment-only assertions.

Usage: python scripts/plan_claims_check.py [--repo DIR] [PLAN ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from plan_claims_prose import check_completeness
from plan_claims_schema import SHA_RE, PlanClaimsError, _fail, validate_manifest
from plan_claims_source import evaluate

FIRST_GATED_PHASE = 17
BLOCK_RE = re.compile(r"```json qor-plan-claims\r?\n(.*?)\r?\n```", re.S)
PLAN_NAME_RE = re.compile(r"plan-qor-phase([1-9]\d*)-[A-Za-z0-9._-]+\.md")
GIT_ENV = {"GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_NO_REPLACE_OBJECTS": "1",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "LC_ALL": "C"}
PASSTHROUGH_ENV = ("PATH", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE", "TEMP", "TMP")


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    argv = ["git", "-C", str(repo), "-c", "core.fsmonitor=false", "--literal-pathspecs", "--no-pager", *args]
    env = {k: os.environ[k] for k in PASSTHROUGH_ENV if k in os.environ} | GIT_ENV
    return subprocess.run(argv, capture_output=True, env=env, check=False)


def resolve_commit(repo: Path, sha: str) -> None:
    result = _git(repo, "cat-file", "-t", sha)
    if result.returncode != 0 or result.stdout.strip() != b"commit":
        _fail("R4", f"{sha} does not resolve to a commit object")


def read_blob(repo: Path, claim: dict) -> str:
    listed = _git(repo, "ls-tree", "-z", claim["commit"], "--", claim["path"]).stdout.split(b"\0")[0]
    if not listed:
        _fail("R1", f"claim {claim['id']}: {claim['path']} does not exist at {claim['commit']}")
    meta, _, name = listed.partition(b"\t")
    mode, kind, oid = meta.decode("ascii", "replace").split(" ")
    if name.decode("utf-8", "replace") != claim["path"] or kind != "blob" or mode not in ("100644", "100755") or not SHA_RE.fullmatch(oid):
        _fail("R3", f"claim {claim['id']}: {claim['path']} is not a regular file at {claim['commit']}")
    try:
        return _git(repo, "cat-file", "blob", oid).stdout.decode("utf-8")
    except UnicodeDecodeError:
        _fail("R3", f"claim {claim['id']}: {claim['path']} is not UTF-8 text")


def _load_manifest(text: str, phase: int) -> tuple[dict | None, range]:
    blocks = list(BLOCK_RE.finditer(text))
    if not blocks:
        if phase >= FIRST_GATED_PHASE:
            _fail("R1", f"phase {phase} plan has no qor-plan-claims manifest")
        return None, range(0)
    if len(blocks) > 1:
        _fail("SCHEMA", "plan has more than one qor-plan-claims block")
    try:
        raw = json.loads(blocks[0].group(1))
    except (ValueError, RecursionError) as error:
        raise PlanClaimsError("SCHEMA", f"manifest is not valid JSON ({type(error).__name__})") from None
    first = text.count("\n", 0, blocks[0].start()) + 1
    return validate_manifest(raw), range(first, first + blocks[0].group(0).count("\n") + 1)


def verify_text(repo: Path, name: str, text: str) -> list[str]:
    match = PLAN_NAME_RE.fullmatch(name)
    if not match:
        _fail("R1", f"{name} is not a governed plan name (plan-qor-phaseNN-slug.md, no leading zeros)")
    manifest, manifest_lines = _load_manifest(text, int(match.group(1)))
    if manifest is None:
        return []
    prose = BLOCK_RE.sub("", text)
    check_completeness(text, prose, manifest, manifest_lines)
    for label, sha in manifest["commits"].items():
        if sha not in prose:
            _fail("R4", f"commit {label} {sha} is not recorded in the plan prose")
    for sha in sorted(set(manifest["commits"].values())):
        resolve_commit(repo, sha)
    for claim in manifest["claims"]:
        if claim["kind"] == "test-outcome":
            _fail("R1", f"claim {claim['id']}: test-outcome needs trusted harness evidence; none exists yet (dependency D3)")
        problem = evaluate(read_blob(repo, claim), claim)
        if problem:
            _fail("R1", f"claim {claim['id']} does not reproduce at {claim['commit']}: {problem}")
    return [c["id"] for c in manifest["claims"]] + [j["id"] for j in manifest["judgments"]]


def verify_plan(repo: Path, plan_path: Path) -> list[str]:
    try:
        text = plan_path.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        _fail("R1", f"{plan_path.name} is not UTF-8 text")
    return verify_text(repo, plan_path.name, text)


def gated_plans(repo: Path) -> list[Path]:
    plans = [p for p in (repo / "docs").glob("plan-qor-phase*.md")]
    gated = [p for p in plans if not PLAN_NAME_RE.fullmatch(p.name) or int(PLAN_NAME_RE.fullmatch(p.name).group(1)) >= FIRST_GATED_PHASE]
    return sorted(gated)


def report(name: str, check) -> bool:
    try:
        print(f"PASS {name}: {len(check())} claims/judgments")
        return True
    except PlanClaimsError as error:
        print(f"FAIL {name}: {error}")
        return False


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=".")
    parser.add_argument("plans", nargs="*")
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    plans = [Path(p) for p in args.plans] or gated_plans(repo)
    results = [report(plan.name, lambda plan=plan: verify_plan(repo, plan)) for plan in plans]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
