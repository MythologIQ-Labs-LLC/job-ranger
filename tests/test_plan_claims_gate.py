"""V3/R2 (VETO #104): an always-reporting, base-revision, tamper-resistant gate; V4 Razor limits."""
from __future__ import annotations

import ast
import re
import subprocess
import sys
import unittest
from unittest import mock

from plan_claims_fixture import REPO, GateTestCase
import plan_claims_gate as gate  # noqa: E402

TAMPERED = "def verify_text(*args, **kwargs):\n    return []\n\ndef verify_plan(*args, **kwargs):\n    return []\n"
WORKFLOW = REPO / ".github" / "workflows" / "plan-claims-gate.yml"


class GateDecision(GateTestCase):
    def run_gate(self, base: str, head: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(REPO / "scripts" / "plan_claims_gate.py"), "--repo", str(self.f.repo),
                               "--base", base, "--head", head], capture_output=True, text=True)

    def test_unrelated_change_completes_with_truthful_not_applicable_success(self):
        head = self.f.commit_files({"src/other.ts": "export const x = 1;\n"})
        run = self.run_gate(self.f.sha, head)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        self.assertIn("not applicable", run.stdout)

    def test_valid_governed_plan_passes_and_invalid_plan_fails(self):
        valid = self.f.plan_text(self.f.manifest())
        head = self.f.commit_files({"docs/plan-qor-phase17-x.md": valid})
        self.assertEqual(self.run_gate(self.f.sha, head).returncode, 0)
        bad = self.f.commit_files({"docs/plan-qor-phase17-x.md": valid.replace("is 8 lines", "is 3 lines")})
        run = self.run_gate(head, bad)
        self.assertEqual(run.returncode, 1, run.stdout)
        self.assertIn("[R1]", run.stdout)

    def test_head_that_weakens_the_checker_cannot_self_certify(self):
        invalid = self.f.plan_text(self.f.manifest(), extra="- `src/core.ts` is 99 lines.\n")
        head = self.f.commit_files({"scripts/plan_claims_check.py": TAMPERED, "scripts/plan_claims_gate.py": "print('ok')\n",
                                    "docs/plan-qor-phase17-x.md": invalid})
        with mock.patch.object(gate.subprocess, "run", wraps=subprocess.run) as spy:
            code = gate.main(["--repo", str(self.f.repo), "--base", self.f.sha, "--head", head])
        self.assertEqual(code, 1)
        for call in spy.call_args_list:
            argv = call.args[0]
            self.assertEqual(argv[0], "git")
            self.assertFalse(any(str(a).startswith(f"{head}:scripts") for a in argv), argv)
        self.assertIn("plan_claims_check", gate.pcc.__name__)
        self.assertNotEqual(gate.pcc.verify_text.__code__.co_argcount, 0)

    def test_enforcer_change_is_flagged_for_code_owner_review(self):
        head = self.f.commit_files({"scripts/plan_claims_check.py": TAMPERED})
        run = self.run_gate(self.f.sha, head)
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertIn("code-owner review", run.stdout)

    def test_workflow_that_spoofs_the_required_check_name_fails(self):
        for body in ("jobs:\n  plan-claims-gate:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: 'true'\n",
                     "jobs:\n  other:\n    name: plan-claims-gate\n    runs-on: ubuntu-24.04\n"):
            with self.subTest(body=body):
                head = self.f.commit_files({".github/workflows/ci-extra.yml": body})
                run = self.run_gate(self.f.sha, head)
                self.assertEqual(run.returncode, 1, run.stdout)
                self.assertIn("spoof", run.stdout)

    def test_non_sha_revisions_are_rejected(self):
        for base, head in [("HEAD", self.f.sha), (self.f.sha, "main"), (self.f.sha[:7], self.f.sha)]:
            self.assertEqual(self.run_gate(base, head).returncode, 2)


class WorkflowArchitecture(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_reports_on_every_pull_request_from_the_protected_base(self):
        self.assertRegex(self.text, r"(?m)^  pull_request_target:")
        self.assertNotRegex(self.text, r"(?m)^\s+paths(-ignore)?:")
        self.assertRegex(self.text, r"(?m)^  plan-claims-gate:\n    name: plan-claims-gate$")
        self.assertIn("ref: ${{ github.event.pull_request.base.sha }}", self.text)

    def test_least_privilege_and_no_execution_of_pull_request_content(self):
        self.assertRegex(self.text, r"(?m)^permissions:\n  contents: read$")
        self.assertIn("persist-credentials: false", self.text)
        self.assertNotIn("head.ref", self.text)
        self.assertNotRegex(self.text, r"ref:\s*\$\{\{\s*github\.event\.pull_request\.head")
        self.assertNotIn("secrets.", self.text)
        for line in self.text.splitlines():
            if line.strip().startswith("run:"):
                self.assertNotIn("${{", line, "untrusted expression interpolated into a shell")
        for bypass in ("continue-on-error", "|| true", "|| exit 0", "set +e"):
            self.assertNotIn(bypass, self.text)
        self.assertIn("python3 scripts/plan_claims_gate.py", self.text)

    def test_codeowners_cover_every_governed_path(self):
        owners = (REPO / ".github" / "CODEOWNERS").read_text(encoding="utf-8")
        for pattern in ("/docs/plan-qor-phase*.md", "/scripts/plan_claims_*.py", "/tests/test_plan_claims_*.py",
                        "/tests/plan_claims_fixture.py", "/.github/workflows/", "/.github/CODEOWNERS"):
            self.assertRegex(owners, rf"(?m)^{re.escape(pattern)}\s+@\S+")
        for governed in ("docs/plan-qor-phase17-x.md", "scripts/plan_claims_check.py", ".github/CODEOWNERS",
                         ".github/workflows/plan-claims-gate.yml", "tests/test_plan_claims_gate.py"):
            self.assertTrue(gate.is_governed(governed), governed)
        self.assertFalse(gate.is_governed("src/pages/Companies.tsx"))


class RazorLimits(unittest.TestCase):
    FILES = sorted(list((REPO / "scripts").glob("plan_claims_*.py")) + list((REPO / "tests").glob("test_plan_claims_*.py"))
                   + [REPO / "tests" / "plan_claims_fixture.py"])

    def test_files_functions_and_ternaries_within_limits(self):
        for path in self.FILES:
            text = path.read_text(encoding="utf-8")
            self.assertLessEqual(len(text.splitlines()), 250, path.name)
            for node in ast.walk(ast.parse(text)):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    self.assertLessEqual(node.end_lineno - node.lineno + 1, 40, f"{path.name}:{node.name}")
                    self.assertLessEqual(_depth(node), 3, f"nesting depth in {path.name}:{node.name}")
                if isinstance(node, ast.IfExp):
                    nested = [n for n in ast.walk(node) if isinstance(n, ast.IfExp) and n is not node]
                    self.assertEqual(nested, [], f"nested ternary in {path.name}:{node.lineno}")

    def test_depth_measure_detects_four_levels(self):
        deep = "def f(a):\n    for x in a:\n        for y in x:\n            if y:\n                if y > 1:\n                    return y\n"
        self.assertEqual(_depth(ast.parse(deep).body[0]), 4)
        chain = "def g(a):\n    if a == 1:\n        return 1\n    elif a == 2:\n        return 2\n    elif a == 3:\n        return 3\n"
        self.assertEqual(_depth(ast.parse(chain).body[0]), 1)


BLOCKS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith, ast.Try, ast.Match)


def _depth(node: ast.AST, level: int = 0) -> int:
    deepest = level
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        is_elif = isinstance(node, ast.If) and isinstance(child, ast.If) and node.orelse == [child]
        deepest = max(deepest, _depth(child, level + (isinstance(child, BLOCKS) and not is_elif)))
    return deepest


if __name__ == "__main__":
    unittest.main()
