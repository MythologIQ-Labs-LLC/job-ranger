"""Shared fixture for the plan-claims gate test suites (not itself a test module)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
import plan_claims_check as pcc  # noqa: E402

CORE = (
    'import { helper } from "./helper.cjs";\n'
    'export type RuntimeKind = "electron" | "web";\n'
    "export function small(a: string) {\n"
    '  const s = "}{";\n'
    "  // } comment brace\n"
    "  const t = `${a}}`;\n"
    "  return s + t;\n"
    "}\n"
)
HOSTILE = "$(touch {s})\n`touch {s}`\n; python -c \"open(r'{s}','w')\"\n"
SECTIONS = ("## Phase 1: Work\n\n### Affected Files\n\n- src/core.ts\n\n{phase}"
            "## Definition of Done\n\n- D1: done\n\n## CI Commands\n\n- `npm test`\n\n")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                          text=True, encoding="utf-8").stdout.strip()


class Fixture:
    def __init__(self, root: Path):
        self.root, self.repo, self.sentinel = root, root / "repo", root / "SENTINEL"
        (self.repo / "src").mkdir(parents=True)
        (self.repo / "src" / "core.ts").write_text(CORE, encoding="utf-8", newline="\n")
        (self.repo / "src" / "hostile.txt").write_text(HOSTILE.format(s=self.sentinel), encoding="utf-8", newline="\n")
        git(self.repo, "init", "-q")
        git(self.repo, "add", "-A")
        oid = git(self.repo, "hash-object", "-w", "src/core.ts")
        git(self.repo, "update-index", "--add", "--cacheinfo", f"120000,{oid},src/link.ts")
        self._commit("fixture")
        git(self.repo, "tag", "v1")
        self.sha = git(self.repo, "rev-parse", "HEAD")
        self.sha7 = self.sha[:7]
        self.blob = git(self.repo, "rev-parse", "HEAD:src/core.ts")

    def _commit(self, message: str) -> str:
        git(self.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", message)
        return git(self.repo, "rev-parse", "HEAD")

    def commit_files(self, files: dict, message: str = "change") -> str:
        for rel, body in files.items():
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8", newline="\n")
        git(self.repo, "add", "-A")
        return self._commit(message)

    def size_line(self) -> str:
        return f"- `src/core.ts` is 8 lines at `{self.sha7}` [claim:core-size].\n"

    def plan_text(self, manifest: dict | None = None, extra: str = "", lead: str = "", phase_body: str = "") -> str:
        body = (f"# Plan\n\n{lead}## Locked Decisions\n\n- Revision `{self.sha}`.\n{self.size_line()}{extra}\n"
                + SECTIONS.format(phase=phase_body))
        if manifest is not None:
            body += "## Plan Claims\n\n```json qor-plan-claims\n" + json.dumps(manifest, indent=1) + "\n```\n"
        return body

    def plan(self, phase: int = 17, manifest: dict | None = None, **parts) -> Path:
        path = self.repo / "docs" / f"plan-qor-phase{phase}-x.md"
        path.parent.mkdir(exist_ok=True)
        path.write_text(self.plan_text(manifest, **parts), encoding="utf-8", newline="\n")
        return path

    def manifest(self, claims: list | None = None, judgments: list | None = None, size: bool = True) -> dict:
        base = [{"id": "core-size", "kind": "file-lines", "commit": self.sha, "path": "src/core.ts", "max": 8, "equals": 8}]
        return {"version": 2, "commits": {"fixture": self.sha},
                "claims": (base if size else []) + (claims or []), "judgments": judgments or []}


def snapshot(repo: Path) -> tuple:
    git_dir = repo / ".git"
    files = sorted((str(p.relative_to(git_dir)), p.stat().st_size, p.stat().st_mtime_ns)
                   for p in git_dir.rglob("*") if p.is_file())
    status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"], check=True, capture_output=True,
                            text=True, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}).stdout
    return files, status


class GateTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="qor-claims-test-")
        self.f = Fixture(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def ok(self, plan: Path, repo: Path | None = None) -> list:
        return pcc.verify_plan(repo or self.f.repo, plan)

    def rejects(self, plan: Path, code: str, fragment: str = "", repo: Path | None = None) -> str:
        with self.assertRaises(Exception) as caught:
            pcc.verify_plan(repo or self.f.repo, plan)
        message = str(caught.exception)
        self.assertIn(f"[{code}]", message)
        self.assertIn(fragment, message)
        return message
