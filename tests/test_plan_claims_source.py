"""V2 (VETO #104): function spans come from a JS/TS tokenizer that fails closed."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import plan_claims_source as src  # noqa: E402


def body(lines: int, inner: str) -> str:
    filler = "".join(f"  const v{i} = {i};\n" for i in range(lines - 2 - (inner.count("\n") + 1)))
    return f"export function target(x: string) {{\n{inner}\n{filler}}}\n"


class FunctionSpan(unittest.TestCase):
    def span(self, text: str, name: str = "target") -> int:
        return src.function_lines(text, name)

    def test_reviewer_counterexample_regex_literal_with_brace(self):
        text = body(104, "  const parts = x.split(/}/);")
        self.assertEqual(self.span(text), 104)
        claim = {"kind": "function-lines", "function": "target", "max": 40, "path": "a.ts"}
        self.assertEqual(src.evaluate(text, claim), "104 lines exceeds 40")

    def test_regex_escapes_classes_and_flags(self):
        for inner in ["  const a = /\\/}/g;", "  const b = /[}{]/u.test(x);", "  return x.replace(/\\{+/, '}');"]:
            with self.subTest(inner=inner):
                self.assertEqual(self.span(body(10, inner)), 10)

    def test_strings_comments_and_nested_templates(self):
        inner = ("  const s = '}' + \"{\";  // } {\n  /* { */\n"
                 "  const t = `${ { a: `}${x}` }.a }}`;")
        self.assertEqual(self.span(body(12, inner)), 12)

    def test_division_after_identifiers_and_parens(self):
        inner = "  const r = (x.length + 1) / 2 / x.length;\n  if (r) /}/.test(x);"
        self.assertEqual(self.span(body(9, inner)), 9)

    def test_arrow_function_declaration_and_nested_blocks(self):
        text = ("export const target = async (a: number): Promise<void> => {\n"
                "  [1, 2].forEach((n) => { if (n) { for (;;) { break; } } });\n"
                "  const o = { k: { j: 1 } };\n}\n")
        self.assertEqual(self.span(text), 4)

    def test_ambiguous_slash_after_block_fails_closed(self):
        with self.assertRaises(ValueError):
            self.span("export function target() {\n  if (x) {}\n  /}/.test(y);\n}\n")

    def test_postfix_increment_then_slash_fails_closed(self):
        with self.assertRaises(ValueError):
            self.span("export function target(i) {\n  return i++ / 2;\n}\n")

    def test_object_literal_return_type_fails_closed(self):
        with self.assertRaises(ValueError):
            self.span("export function target(): { a: string } {\n  return { a: '' };\n}\n")

    def test_unterminated_tokens_fail_closed(self):
        for broken in ["'}", "`${x", "/}", "/* }"]:
            with self.subTest(broken=broken), self.assertRaises(ValueError):
                self.span(f"export function target() {{\n  const z = {broken}\n}}\n")

    def test_duplicate_or_missing_declaration_fails_closed(self):
        with self.assertRaises(ValueError):
            self.span(body(5, "") + body(5, ""))
        with self.assertRaises(ValueError):
            self.span("const other = 1;\n")

    def test_unsupported_file_type_is_not_measured(self):
        claim = {"kind": "function-lines", "function": "target", "max": 40, "path": "a.tsx"}
        self.assertIn("unsupported", src.evaluate(body(5, ""), claim))


class GenericsAndTemplates(unittest.TestCase):
    """V2 (VETO #106): reviewer counterexamples that previously verified falsely."""

    FILLER = "".join(f"  const v{i} = {i};\n" for i in range(100))

    def test_generic_constraint_containing_arrow_fails_closed(self):
        arrow = "export const big = <T extends (a: number) => { x: number }>(p: T) => {\n" + self.FILLER + "  return p;\n};\n"
        decl = "export function big<T extends (a: number) => { x: number }>(p: T) {\n" + self.FILLER + "  return p;\n}\n"
        for text in (arrow, decl):
            with self.subTest(text=text[:40]), self.assertRaises(ValueError):
                src.function_lines(text, "big")
            claim = {"kind": "function-lines", "function": "big", "max": 40, "path": "a.ts"}
            self.assertIn("cannot be verified", src.evaluate(text, claim))

    def test_simple_generics_are_still_measured(self):
        text = "export const big = async <T,>(p: T) => {\n" + self.FILLER + "  return p;\n};\n"
        self.assertEqual(src.function_lines(text, "big"), 103)
        decl = "export function big<T extends string>(p: T) {\n" + self.FILLER + "  return p;\n}\n"
        self.assertEqual(src.function_lines(decl, "big"), 103)

    def test_template_literal_specifiers_are_import_edges(self):
        for text in ("const lp = require(`left-pad`);\n", "const m = await import(`left-pad`);\n"):
            claim = {"kind": "import-edge", "specifier": "left-pad", "present": False, "path": "a.ts"}
            with self.subTest(text=text):
                self.assertIn("present=True", src.evaluate(text, claim))

    def test_non_literal_specifier_fails_closed(self):
        for text in ("const m = require(name);\n", "const m = await import(`${base}/x`);\n"):
            claim = {"kind": "import-edge", "specifier": "left-pad", "present": False, "path": "a.ts"}
            with self.subTest(text=text):
                self.assertIn("cannot be verified", src.evaluate(text, claim))


class ImportEdges(unittest.TestCase):
    def test_imports_in_comments_and_strings_do_not_count(self):
        text = '// import { x } from "./ghost.cjs";\nconst s = "require(\'./ghost.cjs\')";\nimport { y } from "./real.cjs";\n'
        claim = {"kind": "import-edge", "specifier": "./ghost.cjs", "present": False, "path": "a.ts"}
        self.assertIsNone(src.evaluate(text, claim))
        self.assertIsNone(src.evaluate(text, dict(claim, specifier="./real.cjs", present=True)))

    def test_require_and_dynamic_import_are_edges(self):
        text = 'const a = require("./a.cjs");\nconst b = await import("./b.cjs");\nexport * from "./c.cjs";\n'
        for spec in ("./a.cjs", "./b.cjs", "./c.cjs"):
            claim = {"kind": "import-edge", "specifier": spec, "present": True, "path": "a.ts"}
            self.assertIsNone(src.evaluate(text, claim), spec)


if __name__ == "__main__":
    unittest.main()
