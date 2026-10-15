"""V1-A / V1-C (VETO #106): the scanner must agree with rendered Markdown or fail closed.

Each case hides a false fact that a reader would see inside a canonical section.
Payload shapes reproduce the independent reviewer's probes p03-p19.
"""
from __future__ import annotations

import unittest

from plan_claims_fixture import GateTestCase

FALSE = "- `src/core.ts:99` is `nope`; the handler is red-first.\n"


class RenderingAgreement(GateTestCase):
    def assert_fails(self, extra: str = "", fragment: str = "", **parts):
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra, **parts), "R1", fragment)

    def test_p03_html_comment_hiding_a_heading(self):
        self.assert_fails("<!--\n## Notes\n-->\n" + FALSE, "HTML")

    def test_p18_html_block_hiding_a_heading(self):
        self.assert_fails("<pre>\n## Notes\n</pre>\n" + FALSE, "HTML")

    def test_inline_html_outside_code_spans(self):
        self.assert_fails("- the handler <b>is</b> fine\n", "HTML")

    def test_autolinks_and_generics_in_code_spans_are_allowed(self):
        extra = "- See <https://example.com/x> and `Promise<void>` for context.\n"
        self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest(), extra=extra)), ["core-size"])

    def test_p04_tilde_line_inside_backtick_fence_is_content_not_a_closer(self):
        self.assert_fails("```text\n~~~\n## Notes\n" + FALSE + "~~~\n```\n")

    def test_p19_four_backtick_fence_is_rejected(self):
        self.assert_fails("````text\n```\n## Notes\n" + FALSE + "```\n````\n", "fence")

    def test_tilde_and_indented_fences_are_rejected(self):
        self.assert_fails("~~~\n" + FALSE + "~~~\n", "fence")
        self.assert_fails("  ```\n" + FALSE + "  ```\n", "fence")

    def test_longer_closing_fence_inside_a_fence_is_rejected(self):
        self.assert_fails("```\n" + FALSE + "````\n", "fence")

    def test_p14_indented_atx_heading_is_rejected(self):
        self.assert_fails("## Notes\n\n ## Locked Decisions\n\n" + FALSE, "heading")

    def test_p15_canonical_name_at_another_heading_level_is_rejected(self):
        self.assert_fails("## Notes\n\n#### Locked Decisions\n\n" + FALSE, "level-2")

    def test_setext_heading_is_rejected(self):
        self.assert_fails("Notes\n-----\n" + FALSE, "setext")

    def test_late_level_one_heading_is_rejected(self):
        self.assert_fails("# Appendix\n" + FALSE, "level-1")

    def test_p05_formfeed_and_unicode_line_separators_are_rejected(self):
        for separator in ("\x0c", " ", " ", "\x0b", "\x85", "\r"):
            with self.subTest(separator=repr(separator)):
                self.assert_fails("- see below" + separator + "## Notes\n" + FALSE, "line separator")

    def test_p06_crlf_plans_are_scanned_like_lf(self):
        plan = self.f.plan(manifest=self.f.manifest(), extra=FALSE)
        plan.write_bytes(plan.read_bytes().replace(b"\n", b"\r\n"))
        self.rejects(plan, "R1", "unbound")
        valid = self.f.plan(manifest=self.f.manifest())
        valid.write_bytes(valid.read_bytes().replace(b"\n", b"\r\n"))
        self.assertEqual(self.ok(valid), ["core-size"])

    def test_p13_indented_code_and_p12_tables_are_scanned(self):
        self.assert_fails("    src/core.ts:99 -> nope\n", "unbound")
        self.assert_fails("| file | line |\n| --- | --- |\n| core.ts | 93 |\n", "unbound")


class UnitTestExemption(GateTestCase):
    def test_p07_tests_heading_is_not_the_unit_tests_heading(self):
        body = "### Tests\n\n- Himalayas returns 37 zones and 251 entries.\n\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), phase_body=body), "R1", "unbound")

    def test_p07b_heading_containing_test_substring_is_not_exempt(self):
        body = "### Attestation\n\n- Himalayas returns 37 zones and 251 entries.\n\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), phase_body=body), "R1", "unbound")

    def test_unit_tests_exempt_only_code_span_vectors_not_prose_numbers(self):
        vectors = "### Unit Tests\n\n- `pubDate: 1789962228` -> `\"2026-09-21T03:43:48.000Z\"`\n\n"
        self.assertEqual(self.ok(self.f.plan(manifest=self.f.manifest(), phase_body=vectors)), ["core-size"])
        prose = "### Unit Tests\n\n- The fixture has 3 rows and 37 zones.\n\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), phase_body=prose), "R1", "unbound")


class NewlyDetectedForms(GateTestCase):
    def test_p09_github_line_anchor_citations_need_claims(self):
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra="- `src/core.ts#L93` sets it.\n"), "R1", "unbound")
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra="- core.ts L93-L120 is the handler.\n"), "R1", "unbound")

    def test_p17_sole_caller_wording_needs_a_scoped_judgment(self):
        extra = "- the sole caller of small is main.cts; nothing else invokes it.\n"
        self.rejects(self.f.plan(manifest=self.f.manifest(), extra=extra), "R1", "unbound")


if __name__ == "__main__":
    unittest.main()
