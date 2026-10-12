"""R3 (no author-controlled execution) and R4 (immutable commit references)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import unittest
from unittest import mock

from plan_claims_fixture import REPO, GateTestCase, git, pcc, snapshot

READ_ONLY_SUBCOMMANDS = {"cat-file", "ls-tree"}


def _subcommand(argv: list) -> str:
    return argv[argv.index("--no-pager") + 1]


class R3NoAuthorExecution(GateTestCase):
    PAYLOADS = [
        {"kind": "command", "argv": ["bash", "-c", "touch {s}"]},
        {"kind": "command", "argv": ["python", "-c", "open(r'{s}','w')"]},
        {"kind": "command", "argv": ["npm", "run", "evil"], "setup": [["npm", "ci"]]},
        {"kind": "command", "argv": ["cmd", "/c", "type nul > {s}"]},
        {"kind": "file-lines", "argv": ["sh", "-c", "touch {s}"]},
        {"kind": "file-lines", "output_regex": ".*", "run": "touch {s}"},
    ]

    def test_executable_payloads_rejected_before_any_process_runs(self):
        for raw in self.PAYLOADS:
            payload = json.loads(json.dumps(raw).replace("{s}", str(self.f.sentinel).replace("\\", "/")))
            claim = {"id": "evil", "commit": self.f.sha, "path": "src/core.ts", "max": 9, **payload}
            for version in (1, 2):
                plan = self.f.plan(manifest=dict(self.f.manifest([claim]), version=version))
                with mock.patch.object(pcc.subprocess, "run", wraps=subprocess.run) as spy:
                    self.rejects(plan, "SCHEMA")
                self.assertEqual(spy.call_count, 0, f"process started for {payload}")
                self.assertFalse(self.f.sentinel.exists(), f"payload executed: {payload}")

    def test_legacy_v1_command_manifest_is_not_executed(self):
        sentinel = str(self.f.sentinel).replace("\\", "/")
        legacy = {"version": 1, "claims": [{"id": "evil", "kind": "command", "ref": self.f.sha,
                                            "argv": [sys.executable, "-c", f"open(r'{sentinel}', 'w').close()"], "expect": "pass"}]}
        self.rejects(self.f.plan(manifest=legacy), "SCHEMA")
        self.assertFalse(self.f.sentinel.exists())

    def test_hostile_blob_content_is_only_read(self):
        claim = {"id": "hostile", "kind": "text-present", "commit": self.f.sha, "path": "src/hostile.txt", "text": "$(touch"}
        extra = f"- `src/hostile.txt:1` at `{self.f.sha7}` holds shell text [claim:hostile].\n"
        line = {"id": "hostile", "kind": "line-equals", "commit": self.f.sha, "path": "src/hostile.txt", "line": 1,
                "text": f"$(touch {self.f.sentinel})"}
        for c in (claim, line):
            plan = self.f.plan(manifest=self.f.manifest([c]), extra=extra if c is line else
                               f"- `src/hostile.txt` at `{self.f.sha7}` contains `$(touch` [claim:hostile].\n")
            with mock.patch.object(pcc.subprocess, "run", wraps=subprocess.run) as spy:
                try:
                    pcc.verify_plan(self.f.repo, plan)
                except pcc.PlanClaimsError:
                    pass
            self.assertFalse(self.f.sentinel.exists())
            for call in spy.call_args_list:
                self.assertEqual(call.args[0][0], "git")
                self.assertIn(_subcommand(call.args[0]), READ_ONLY_SUBCOMMANDS)
                self.assertIs(call.kwargs.get("shell", False), False)

    def test_traversal_option_and_absolute_paths_rejected_without_git(self):
        for bad in ["../x.ts", "/etc/passwd", "-c", "src/../core.ts", "C:/x", "src\\core.ts", "src:core.ts", "", "src//core.ts", "./x"]:
            claim = {"id": "p", "kind": "file-lines", "commit": self.f.sha, "path": bad, "max": 9}
            with mock.patch.object(pcc.subprocess, "run", wraps=subprocess.run) as spy:
                self.rejects(self.f.plan(manifest=self.f.manifest([claim])), "R3", "path")
            self.assertEqual(spy.call_count, 0, bad)

    def test_dotfile_paths_are_claimable(self):
        claim = {"id": "dot", "kind": "file-lines", "commit": self.f.sha, "path": ".github/x.yml", "max": 9}
        self.rejects(self.f.plan(manifest=self.f.manifest([claim])), "R1", "orphan")

    def test_symlink_blob_rejected(self):
        claim = {"id": "link", "kind": "file-lines", "commit": self.f.sha, "path": "src/link.ts", "max": 8, "equals": 8}
        extra = f"- `src/link.ts` is 8 lines at `{self.f.sha7}` [claim:link].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest([claim]), extra=extra), "R3", "regular file")

    def test_successful_run_writes_nothing(self):
        plan = self.f.plan(manifest=self.f.manifest())
        before = snapshot(self.f.repo)
        self.ok(plan)
        self.assertEqual(before, snapshot(self.f.repo))

    def test_caller_git_environment_cannot_redirect_reads(self):
        other = self.f.root / "other"
        other.mkdir()
        git(other, "init", "-q")
        with mock.patch.dict(os.environ, {"GIT_DIR": str(other / ".git"), "GIT_CONFIG_COUNT": "1",
                                          "GIT_CONFIG_KEY_0": "core.pager", "GIT_CONFIG_VALUE_0": "evil"}):
            self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest())), ["core-size"])

    def test_pathologically_long_canonical_line_fails_fast(self):
        extra = "- " + "a" * 40000 + "\n"
        start = time.monotonic()
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "too long")
        self.assertLess(time.monotonic() - start, 5)

    def test_cli_output_is_safe_on_legacy_console_encoding(self):
        plan = self.f.plan(manifest=self.f.manifest(), extra="- caf\u00e9 \u00b7 has 37 lines\n")
        run = subprocess.run([sys.executable, str(REPO / "scripts" / "plan_claims_check.py"), "--repo", str(self.f.repo), str(plan)],
                             capture_output=True, env={**os.environ, "PYTHONIOENCODING": "cp1252"})
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertNotIn(b"Traceback", run.stderr)


class R4ImmutableRefs(GateTestCase):
    def test_non_sha_refs_rejected_without_git(self):
        sha = self.f.sha
        for ref in ["HEAD", "master", "v1", sha[:7], "HEAD~1", sha + "^", sha.upper(), sha[:39], "@"]:
            manifest = self.f.manifest([{"id": "r", "kind": "file-lines", "commit": ref, "path": "src/core.ts", "max": 9}])
            manifest["commits"]["other"] = ref
            with mock.patch.object(pcc.subprocess, "run", wraps=subprocess.run) as spy:
                self.rejects(self.f.plan(manifest=manifest), "R4", "40-character")
            self.assertEqual(spy.call_count, 0, ref)

    def test_full_sha_must_be_an_existing_commit_object(self):
        for oid in [self.f.blob, "0" * 40]:
            manifest = self.f.manifest()
            manifest["commits"]["other"] = oid
            self.rejects(self.f.plan(manifest=manifest, extra=f"- Other revision `{oid}`.\n"), "R4", "commit object")

    def test_claim_commit_must_be_declared_and_recorded_in_prose(self):
        manifest = self.f.manifest()
        manifest["commits"] = {}
        self.rejects(self.f.plan(manifest=manifest), "R4", "not declared")
        plan = self.f.plan(manifest=self.f.manifest())
        text = plan.read_text(encoding="utf-8")
        plan.write_text(text.replace(f"Revision `{self.f.sha}`.\n", ""), encoding="utf-8")
        self.rejects(plan, "R4", "not recorded")

    def test_no_checkout_worktree_or_override(self):
        with mock.patch.dict(os.environ, {"QOR_CLAIMS_CHECKOUT_" + self.f.sha[:7]: str(self.f.root / "dirty")}):
            with mock.patch.object(pcc.subprocess, "run", wraps=subprocess.run) as spy:
                self.ok(self.f.plan(manifest=self.f.manifest()))
        flat = [arg for call in spy.call_args_list for arg in call.args[0]]
        self.assertNotIn("worktree", flat)
        self.assertNotIn("checkout", flat)
        self.assertEqual(git(self.f.repo, "worktree", "list").count("\n"), 0)


if __name__ == "__main__":
    unittest.main()
