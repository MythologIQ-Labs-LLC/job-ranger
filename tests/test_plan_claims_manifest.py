"""R1 core: manifest schema, canonical sections and claim binding.

Full suite: python -m unittest discover -s tests -p "test_plan_claims_*.py"
"""
from __future__ import annotations

import json
import unittest

from plan_claims_fixture import GateTestCase

RATIONALE = "Design limit chosen for request budget; not an observation of current code."


class ManifestCore(GateTestCase):
    def test_fully_referenced_manifest_passes(self):
        self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest())), ["core-size"])

    def test_one_trivial_claim_with_undeclared_false_prose_fails(self):
        extra = "- `src/core.ts:99` defines a 164-entry list and `foo.cts` is 37 lines.\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "unbound")

    def test_undeclared_enum_literal_fails(self):
        extra = '- The runtime kind is "desktop" | "web".\n'
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "enum literal")

    def test_undeclared_red_first_classification_fails(self):
        extra = "- The 51-zone test is red-first.\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "test classification")

    def test_red_first_cannot_be_waived_as_judgment(self):
        judgment = {"id": "tz-red", "statement": "The 51-zone test is red-first", "rationale": RATIONALE}
        extra = "- The 51-zone test is red-first [judgment:tz-red].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(judgments=[judgment]), extra=extra), "R1", "trusted harness")

    def test_missing_reference_fails(self):
        extra = f"- `src/core.ts:3` at `{self.f.sha7}` declares small [claim:no-such-claim].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "missing")

    def test_orphan_manifest_entry_fails(self):
        orphan = {"id": "orphan", "kind": "text-present", "commit": self.f.sha, "path": "src/core.ts", "text": "small"}
        self.rejects(self.f.plan(manifest=self.f.manifest([orphan])), "R1", "orphan")

    def test_duplicate_ids_fail(self):
        dup = {"id": "core-size", "kind": "file-lines", "commit": self.f.sha, "path": "src/core.ts", "max": 9}
        self.rejects(self.f.plan(manifest=self.f.manifest([dup])), "R1", "duplicate")

    def test_scoped_judgment_passes_and_short_rationale_fails(self):
        good = {"id": "searches", "statement": "At most 3 role searches", "rationale": RATIONALE}
        extra = "- At most 3 role searches run per discovery [judgment:searches].\n"
        self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest(judgments=[good]), extra=extra)),
                         ["core-size", "searches"])
        short = dict(good, rationale="because")
        self.rejects(self.f.plan(manifest=self.f.manifest(judgments=[short]), extra=extra), "SCHEMA", "rationale")

    def test_missing_canonical_section_fails(self):
        plan = self.f.plan(manifest=self.f.manifest())
        plan.write_text(plan.read_text(encoding="utf-8").replace("## CI Commands", "## Commands"), encoding="utf-8", newline="\n")
        self.rejects(plan, "R1", "CI Commands")

    def test_history_section_is_not_canonical(self):
        lead = "## Iteration history\n\n- Iteration 2 claimed 164 entries at line 75.\n\n"
        self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest(), lead=lead)), ["core-size"])

    def test_gated_phase_needs_manifest_and_pre_gate_phase_is_grandfathered(self):
        self.rejects(self.f.plan(phase=17), "R1", "no qor-plan-claims")
        self.assertEqual(self.ok(self.f.plan(phase=16)), [])

    def test_zero_padded_phase_name_cannot_claim_grandfathering(self):
        path = self.f.repo / "docs" / "plan-qor-phase016-x.md"
        path.parent.mkdir(exist_ok=True)
        path.write_text("# Plan\n", encoding="utf-8", newline="\n")
        self.rejects(path, "R1", "not a governed plan name")

    def test_read_only_kinds_evaluate_against_the_commit(self):
        sha, s7 = self.f.sha, self.f.sha7
        claims = [
            {"id": "enum", "kind": "enum-values", "commit": sha, "path": "src/core.ts", "type": "RuntimeKind", "values": ["web", "electron"]},
            {"id": "edge", "kind": "import-edge", "commit": sha, "path": "src/core.ts", "specifier": "./helper.cjs", "present": True},
            {"id": "line", "kind": "line-equals", "commit": sha, "path": "src/core.ts", "line": 3, "text": "export function small(a: string) {"},
            {"id": "fn", "kind": "function-lines", "commit": sha, "path": "src/core.ts", "function": "small", "max": 6, "equals": 6},
        ]
        extra = (f'- `RuntimeKind` at `{s7}` is "electron" | "web" [claim:enum].\n'
                 f"- `core.ts` at `{s7}` imports `./helper.cjs` [claim:edge].\n"
                 f"- `src/core.ts:3` at `{s7}` declares the function [claim:line].\n"
                 f"- `small` at `{s7}` is 6 lines [claim:fn].\n")
        self.assertEqual(len(self.ok(self.f.plan(manifest=self.f.manifest(claims), extra=extra))), 5)
        wrong = dict(claims[0], values=["desktop", "web"])
        line = f'- `RuntimeKind` at `{s7}` is "desktop" | "web" [claim:enum].\n'
        self.rejects(self.f.plan(manifest=self.f.manifest([wrong]), extra=line), "R1", "enum values")
        too_long = {k: v for k, v in claims[3].items() if k != "equals"} | {"max": 5}
        line = f"- `small` at `{s7}` is at most 5 lines [claim:fn].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest([too_long]), extra=line), "R1", "6 lines exceeds 5")


class SchemaHardening(GateTestCase):
    def _manifest_text(self, raw: str):
        plan = self.f.plan(manifest=self.f.manifest())
        text = plan.read_text(encoding="utf-8")
        start = text.index("```json qor-plan-claims\n") + len("```json qor-plan-claims\n")
        plan.write_text(text[:start] + raw + text[text.index("\n```", start):], encoding="utf-8", newline="\n")
        return plan

    def test_hostile_json_shapes_are_coded_rejections(self):
        for raw in ['{"version": 2, "commits": {}, "claims": [{"kind": []}], "judgments": []}',
                    '{"version": ' + "9" * 5000 + "}", "[" * 100000 + "]" * 100000,
                    '{"version": 2, "commits": {}, "claims": [], "judgments": [{"id": "j", "statement": 5, "rationale": []}]}']:
            self.rejects(self._manifest_text(raw), "SCHEMA")

    def test_judgment_rationales_must_be_distinct(self):
        judgments = [{"id": "a", "statement": "At most 3 role searches", "rationale": RATIONALE},
                     {"id": "b", "statement": "up to 2 retries", "rationale": RATIONALE}]
        extra = "- At most 3 role searches [judgment:a].\n- Allow up to 2 retries [judgment:b].\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(judgments=judgments), extra=extra), "R1", "rationale")

    def test_all_digit_prefix_of_a_declared_commit_is_not_a_number(self):
        import plan_claims_prose as prose
        sha = "4072030" + "a" * 33
        self.assertEqual(prose.analyse("- Size at `4072030` holds.", False, frozenset({sha}))[1], [])
        self.assertNotEqual(prose.analyse("- Size at `4072030` holds.", False, frozenset())[1], [])

    def test_manifest_json_round_trips(self):
        plan = self.f.plan(manifest=self.f.manifest())
        block = plan.read_text(encoding="utf-8").split("```json qor-plan-claims\n")[1].split("\n```")[0]
        self.assertEqual(json.loads(block)["claims"][0]["id"], "core-size")


if __name__ == "__main__":
    unittest.main()
