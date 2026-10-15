"""Pull-request plan-claims gate, run from the protected base revision.

The workflow (.github/workflows/plan-claims-gate.yml) checks out the BASE revision
and runs this file from it. The PR head is fetched as git objects only. It is
never checked out, imported or executed. Every PR gets a completed status:
- no governed file changed: success with an explicit "not applicable" message;
- otherwise: every gated plan at the head is verified with this base-revision
  checker, so a PR that weakens scripts/plan_claims_*.py cannot certify itself.

Changes to the enforcer itself are reported as needing code-owner review, which
the main ruleset must enforce (dependency D1).

Usage: python3 scripts/plan_claims_gate.py --repo DIR --base SHA --head SHA
Exit status: 0 pass or not applicable, 1 gate failure, 2 invalid revisions.
"""
from __future__ import annotations

import argparse
import re
import subprocess  # noqa: F401  (tests observe process creation through this module)
import sys
from pathlib import Path

import plan_claims_check as pcc
from plan_claims_schema import SHA_RE, PlanClaimsError

GOVERNED = tuple(re.compile(p) for p in (
    r"docs/plan-qor-phase[^/]*\.md", r"scripts/plan_claims_[^/]*\.py", r"tests/test_plan_claims_[^/]*\.py",
    r"tests/plan_claims_fixture\.py", r"\.github/workflows/[^/]+\.ya?ml", r"\.github/CODEOWNERS"))
GATE_WORKFLOW = ".github/workflows/plan-claims-gate.yml"
SPOOF_RE = re.compile(r"(?m)^\s*(?:name:\s*[\"']?plan-claims-gate[\"']?|[\"']?plan-claims-gate[\"']?\s*:)\s*$")
ENFORCER = GOVERNED[1:]


def is_governed(path: str) -> bool:
    return any(p.fullmatch(path) for p in GOVERNED)


def _lines(result: subprocess.CompletedProcess) -> list[str]:
    if result.returncode != 0:
        raise PlanClaimsError("R4", f"git query failed: {result.stderr.decode('utf-8', 'replace').strip()[:200]}")
    return [p.decode("utf-8", "replace") for p in result.stdout.split(b"\0") if p]


def changed_files(repo: Path, base: str, head: str) -> list[str]:
    merge_base = pcc._git(repo, "merge-base", base, head).stdout.decode("ascii", "replace").strip()
    if not SHA_RE.fullmatch(merge_base):
        raise PlanClaimsError("R4", f"no merge base between {base} and {head}")
    return _lines(pcc._git(repo, "diff", "--name-only", "-z", "--no-renames", merge_base, head))


def plans_at(repo: Path, head: str) -> list[str]:
    names = _lines(pcc._git(repo, "ls-tree", "-z", "--name-only", head, "--", "docs/"))
    gated = []
    for name in names:
        base = name.rsplit("/", 1)[-1]
        if base.startswith("plan-qor-phase") and base.endswith(".md"):
            match = pcc.PLAN_NAME_RE.fullmatch(base)
            if not match or int(match.group(1)) >= pcc.FIRST_GATED_PHASE:
                gated.append(name)
    return sorted(gated)


def spoofing_workflows(repo: Path, head: str, changed: list[str]) -> list[str]:
    """Changed workflows (other than the gate itself) that would publish a check named plan-claims-gate."""
    spoofs = []
    for path in changed:
        if not re.fullmatch(r"\.github/workflows/[^/]+\.ya?ml", path) or path == GATE_WORKFLOW:
            continue
        if pcc._git(repo, "ls-tree", "-z", head, "--", path).stdout and SPOOF_RE.search(
                pcc.read_blob(repo, {"id": path, "commit": head, "path": path})):
            spoofs.append(path)
    return spoofs


def _verify_head_plan(repo: Path, head: str, path: str) -> list[str]:
    text = pcc.read_blob(repo, {"id": path, "commit": head, "path": path})
    return pcc.verify_text(repo, path.rsplit("/", 1)[-1], text)


def evaluate_pull_request(repo: Path, base: str, head: str) -> int:
    governed = [p for p in changed_files(repo, base, head) if is_governed(p)]
    if not governed:
        print("plan-claims-gate: not applicable (no governed plan, enforcer or workflow file changed)")
        return 0
    spoofs = spoofing_workflows(repo, head, governed)
    for path in spoofs:
        print(f"plan-claims-gate: FAIL {path} would publish a spoofed plan-claims-gate check")
    enforcer = [p for p in governed if any(e.fullmatch(p) for e in ENFORCER)]
    if enforcer:
        print("plan-claims-gate: enforcer files changed " + ", ".join(enforcer)
              + "; verified with the base-revision checker; merging requires code-owner review")
    results = [pcc.report(path, lambda path=path: _verify_head_plan(repo, head, path)) for path in plans_at(repo, head)]
    return 0 if all(results) and not spoofs else 1


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    try:
        for sha in (args.base, args.head):
            if not SHA_RE.fullmatch(sha):
                raise PlanClaimsError("R4", f"{sha!r} is not a full 40-character lowercase SHA")
            pcc.resolve_commit(repo, sha)
        return evaluate_pull_request(repo, args.base, args.head)
    except PlanClaimsError as error:
        print(f"plan-claims-gate: {error}")
        return 2 if "[R4]" in str(error) else 1


if __name__ == "__main__":
    sys.exit(main())
