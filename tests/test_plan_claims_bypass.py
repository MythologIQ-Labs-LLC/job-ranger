"""V1 (VETO #104): each reported claims-completeness bypass must fail independently."""
from __future__ import annotations

import json
import unittest

from plan_claims_fixture import REPO, GateTestCase

RATIONALE = "Design limit chosen for request budget; not an observation of current code."
BASE = "ebfd7c9abb0468bf8aef01442781ecfd60f5477a"  # phase-17 baseline merge-base; ancestor of this branch


class ReportedBypasses(GateTestCase):
    def test_bypass_1_reused_claim_id_on_unrelated_false_prose_fails(self):
        extra = f"- `core-ipc.cts:93` at `{self.f.sha7}` passes the runtime kind [claim:core-size].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "referenced on 2 lines")

    def test_bypass_1_single_unrelated_claim_reference_fails(self):
        plan = self.f.plan(manifest=self.f.manifest())
        text = plan.read_text(encoding="utf-8").replace(
            self.f.size_line(), f"- `core-ipc.cts:93` at `{self.f.sha7}` passes the runtime kind [claim:core-size].\n")
        plan.write_text(text, encoding="utf-8", newline="\n")
        self.rejects(plan, "R1", "unbound assertion (file:line citation)")

    def test_bypass_1_claim_on_line_without_its_assertion_fails(self):
        plan = self.f.plan(manifest=self.f.manifest())
        plan.write_text(plan.read_text(encoding="utf-8").replace(
            self.f.size_line(), f"- The design is sound at `{self.f.sha7}` [claim:core-size].\n"), encoding="utf-8", newline="\n")
        self.rejects(plan, "R1", "not bound")

    def test_bypass_2_blanket_judgment_reused_or_unscoped_fails(self):
        blanket = {"id": "all", "statement": "At most 3 role searches", "rationale": RATIONALE}
        two = "- At most 3 role searches [judgment:all].\n- Lists hold 149 entries [judgment:all].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(judgments=[blanket]), extra=two), "R1", "referenced on 2 lines")
        unscoped = "- Lists hold 149 entries [judgment:all].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(judgments=[blanket]), extra=unscoped), "R1", "statement")
        mechanical = {"id": "all", "statement": "`src/core.ts:3` declares it", "rationale": RATIONALE}
        cite = "- `src/core.ts:3` declares it [judgment:all].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(judgments=[mechanical]), extra=cite), "R1", "unbound assertion")

    def test_bypass_3_empty_manifest_with_empirical_prose_fails(self):
        empty = {"version": 2, "commits": {}, "claims": [], "judgments": []}
        plan = self.f.plan(manifest=empty)
        plan.write_text(plan.read_text(encoding="utf-8").replace(
            self.f.size_line(), "- The parser covers 37 cases and line 75 checks it.\n"), encoding="utf-8", newline="\n")
        self.rejects(plan, "R1", "non-empty manifest")

    def test_bypass_4_fenced_assertions_are_scanned(self):
        fenced = "```text\n`src/core.ts` is 99 lines\n```\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=fenced), "R1", "unbound")

    def test_bypass_4_unclosed_fence_fails(self):
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra="```\n- hidden 37 lines\n"), "R1", "unclosed code fence")

    def test_manifest_block_inside_canonical_section_fails(self):
        plan = self.f.plan(manifest=self.f.manifest())
        plan.write_text(plan.read_text(encoding="utf-8").replace("## Plan Claims\n\n", ""), encoding="utf-8", newline="\n")
        self.rejects(plan, "R1", "manifest must sit outside canonical sections")


class DetectorRecall(GateTestCase):
    MISSED_BEFORE = ["- The existing assertion at line 75 stays.\n", "- Routers at lines 58, 59 and 128 change.\n",
                     "- Split the 167-line handler.\n", "- The fixture has 3 rows.\n", "- These cases currently fail.\n",
                     "- The regression cases already pass.\n", "- Three call sites are the only callers.\n"]

    def test_previously_missed_forms_require_binding(self):
        for extra in self.MISSED_BEFORE:
            with self.subTest(extra=extra):
                self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1")

    def test_unit_test_vectors_are_specifications_but_classifications_are_not(self):
        vectors = "### Unit Tests\n\n- `pubDate: 1789962228` -> `\"2026-09-21T03:43:48.000Z\"`\n\n"
        self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest(), phase_body=vectors)), ["core-size"])
        red = "### Unit Tests\n\n- `pubDate: 1789962228` is red-first\n\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), phase_body=red), "R1", "test classification")


class RealPhase17Facts(GateTestCase):
    def _real_plan(self, ipc_lines: int, ipc_max: int):
        b7 = BASE[:7]
        qualifier = "at most " if ipc_lines == ipc_max else ""
        claims = [
            {"id": "provider-id", "kind": "line-equals", "commit": BASE, "path": "src/shared/source-discovery.ts", "line": 3,
             "text": 'export type SourceDiscoveryProviderId = "public-job-feeds";'},
            {"id": "limit", "kind": "line-equals", "commit": BASE, "path": "electron/src/source-discovery-validator.cts", "line": 39,
             "text": "  const limit = Math.min(40, Math.max(1, rawLimit));"},
            {"id": "runtime", "kind": "enum-values", "commit": BASE, "path": "src/shared/runtime.ts", "type": "RuntimeKind", "values": ["electron", "web"]},
            {"id": "ipc", "kind": "function-lines", "commit": BASE, "path": "electron/src/core-ipc.cts", "function": "registerCoreIpcHandlers", "max": ipc_max}
            | ({"equals": ipc_lines} if ipc_lines != ipc_max else {}),
            {"id": "dpjf", "kind": "function-lines", "commit": BASE, "path": "electron/src/source-discovery.cts", "function": "discoverPublicJobFeeds", "max": 60, "equals": 56},
            {"id": "scrapers", "kind": "import-edge", "commit": BASE, "path": "electron/src/source-discovery.cts", "specifier": "./scrapers.cjs", "present": True},
            {"id": "no-himalayas", "kind": "import-edge", "commit": BASE, "path": "electron/src/source-discovery.cts", "specifier": "./himalayas-discovery.cjs", "present": False},
        ]
        extra = (f"- Baseline commit `{BASE}`.\n"
                 f"- `src/shared/source-discovery.ts:3` at `{b7}` fixes the provider id [claim:provider-id].\n"
                 f"- `git show {b7}:electron/src/source-discovery-validator.cts | grep -n 'Math.min'` -> `39:  const limit = Math.min(40, Math.max(1, rawLimit));` [claim:limit].\n"
                 f'- `RuntimeKind` at `{b7}` is "electron" | "web" [claim:runtime].\n'
                 f"- `registerCoreIpcHandlers` at `{b7}` is {qualifier}{ipc_lines} lines [claim:ipc].\n"
                 f"- `discoverPublicJobFeeds` at `{b7}` is 56 lines [claim:dpjf].\n"
                 f"- `source-discovery.cts` at `{b7}` imports `./scrapers.cjs` [claim:scrapers].\n"
                 f"- `source-discovery.cts` at `{b7}` does not import `./himalayas-discovery.cjs` [claim:no-himalayas].\n")
        manifest = {"version": 2, "commits": {"baseline": BASE}, "claims": claims, "judgments": []}
        return self.f.plan(manifest=json.loads(json.dumps(manifest)), extra=extra)

    def test_real_phase17_facts_reproduce_from_immutable_objects(self):
        plan = self._real_plan(161, 200)
        plan.write_text(plan.read_text(encoding="utf-8").replace(self.f.size_line(), ""), encoding="utf-8", newline="\n")
        self.assertEqual(len(self.ok(plan, repo=REPO)), 7)

    def test_false_real_size_claim_is_rejected(self):
        plan = self._real_plan(40, 40)
        plan.write_text(plan.read_text(encoding="utf-8").replace(self.f.size_line(), ""), encoding="utf-8", newline="\n")
        self.rejects(plan, "R1", "161 lines exceeds 40", repo=REPO)


class SubjectAndPropertyBinding(GateTestCase):
    """V1-B (VETO #106): subjects come from the assertion itself; exact sizes bind only to equals."""

    def _plan(self, claims: list, extra: str, judgments: list | None = None):
        return self.f.plan(manifest=self.f.manifest(claims, judgments), extra=extra)

    def test_s2_line_reference_with_two_candidate_files_is_ambiguous(self):
        claim = {"id": "ln", "kind": "line-equals", "commit": self.f.sha, "path": "src/core.ts", "line": 3,
                 "text": "export function small(a: string) {"}
        extra = f"- In `core.ts`, line 3 declares it (see helper.cjs) at `{self.f.sha7}` [claim:ln].\n"
        self.rejects(self._plan([claim], extra), "R1", "subject")

    def test_s3_size_without_an_anchored_subject_cannot_bind_a_named_claim(self):
        claim = {"id": "fn", "kind": "function-lines", "commit": self.f.sha, "path": "src/core.ts", "function": "small", "max": 6, "equals": 6}
        extra = f"- registerCoreIpcHandlers is 6 lines at `{self.f.sha7}`, unlike `small` [claim:fn].\n"
        self.rejects(self._plan([claim], extra), "R1", "subject")

    def test_identifier_between_subject_and_size_is_ambiguous(self):
        claim = {"id": "fn", "kind": "function-lines", "commit": self.f.sha, "path": "src/core.ts", "function": "small", "max": 6, "equals": 6}
        extra = f"- `small` at `{self.f.sha7}` like helperFunction is 6 lines [claim:fn].\n"
        self.rejects(self._plan([claim], extra), "R1", "subject")

    def test_p02_exact_size_cannot_bind_a_max_only_claim(self):
        claim = {"id": "big", "kind": "file-lines", "commit": self.f.sha, "path": "src/hostile.txt", "max": 500}
        extra = f"- `src/hostile.txt` is exactly 500 lines at `{self.f.sha7}` [claim:big].\n"
        self.rejects(self._plan([claim], extra), "R1", "unbound")
        bounded = f"- `src/hostile.txt` is at most 500 lines at `{self.f.sha7}` [claim:big].\n"
        self.assertEqual(self.ok(self._plan([claim], bounded)), ["core-size", "big"])

    def test_p11_one_judgment_cannot_cover_several_numbers(self):
        judgment = {"id": "j", "statement": "returns 37 zones and 251 entries",
                    "rationale": "Observed live payload counts, reviewed by the independent auditor."}
        extra = "- Himalayas returns 37 zones and 251 entries [judgment:j].\n"
        self.rejects(self._plan([], extra, [judgment]), "R1", "exactly one")


if __name__ == "__main__":
    unittest.main()
