"""Restricted-Markdown structure scan for governed plans (R1, VETO #106 V1-A). Pure: no I/O.

The scanner and a CommonMark renderer must see the same section for every line.
So this module accepts only a small Markdown subset and fails closed on anything
a renderer could interpret differently:
- ATX headings at column 0 only; canonical section names only as level-2
  headings; at most one level-1 title, and only as the first heading.
- Fences only as exactly three backticks at column 0, closed by exactly three
  backticks. Tilde, longer, and indented fences are rejected.
- No setext underlines, no raw HTML outside code spans (autolinks are allowed),
  and no line separators other than LF or CRLF.
Fenced content inside canonical sections is scanned like any other line.
"""
from __future__ import annotations

import re
from typing import NamedTuple

from plan_claims_schema import _fail

CANONICAL_TITLES = ("Locked Decisions", "Definition of Done", "CI Commands", "Phase ")
MAX_LINE = 2000
SEPARATORS = re.compile("[\x0b\x0c\x85  ]|\r(?!\n)")
HEADING_RE = re.compile(r"^( {0,3})(#{1,6})(?:[ \t]+(.*?))?[ \t]*$")
FENCE_RE = re.compile(r"^ {0,3}(?:`{3,}|~{3,})")
SETEXT_RE = re.compile(r"^ {0,3}(?:=+|-+)[ \t]*$")
CODE_SPAN_RE = re.compile(r"(`+)(?:(?!\1).)+?\1")
AUTOLINK_RE = re.compile(r"<https?://[^\s<>]+>")
HTML_RE = re.compile(r"<(?:!--|[A-Za-z/!?])")


class Line(NamedTuple):
    number: int
    text: str
    unit_tests: bool


class _State:
    def __init__(self):
        self.canonical = self.tests = self.seen_heading = False
        self.prev_blank = True
        self.fence: int | None = None
        self.found: set[str] = set()
        self.out: list[Line] = []


def blank_code_spans(line: str) -> str:
    return CODE_SPAN_RE.sub(lambda m: " " * len(m.group()), line)


def _heading(st: _State, number: int, level: int, title: str) -> None:
    canonical_name = next((t for t in CANONICAL_TITLES if title.startswith(t)), None)
    if level == 1 and st.seen_heading:
        _fail("R1", f"only one leading level-1 title is allowed (line {number})")
    if level != 2 and canonical_name:
        _fail("R1", f"canonical section names must be level-2 headings (line {number})")
    st.seen_heading = True
    if level <= 2:
        st.canonical, st.tests = level == 2 and canonical_name is not None, False
        st.found.update([canonical_name] if level == 2 and canonical_name else [])
    elif level == 3:
        st.tests = title == "Unit Tests"


def _fenced(st: _State, number: int, line: str) -> None:
    if line.rstrip() == "```":
        st.fence = None
        return
    if FENCE_RE.match(line) and set(line.strip()) <= {"`"}:
        _fail("R1", f"ambiguous closing fence at line {number}; close with exactly ``` at column 0")
    if st.canonical:
        st.out.append(Line(number, line, False))


def _structural(st: _State, number: int, line: str) -> None:
    if FENCE_RE.match(line):
        if not re.match(r"```(?!`)", line):
            _fail("R1", f"unsupported fence form at line {number}; only ``` at column 0 is allowed")
        st.fence = number
        return
    if HTML_RE.search(AUTOLINK_RE.sub(" ", blank_code_spans(line))):
        _fail("R1", f"raw HTML at line {number} is not allowed in governed plans")
    heading = HEADING_RE.match(line)
    if heading:
        if heading.group(1):
            _fail("R1", f"indented heading at line {number} is not allowed")
        _heading(st, number, len(heading.group(2)), (heading.group(3) or "").strip())
        st.prev_blank = False
        return
    if SETEXT_RE.match(line) and not st.prev_blank:
        _fail("R1", f"setext heading or ambiguous underline at line {number} is not allowed")
    st.prev_blank = not line.strip()
    if st.canonical:
        if len(line) > MAX_LINE:
            _fail("R1", f"line {number} is too long to analyse ({len(line)} > {MAX_LINE} characters)")
        st.out.append(Line(number, line, st.tests))


def scan(text: str, manifest_lines: range) -> list[Line]:
    if SEPARATORS.search(text):
        _fail("R1", "unsupported line separator or control character; only LF or CRLF line endings are allowed")
    st = _State()
    for number, line in enumerate(text.replace("\r\n", "\n").split("\n"), 1):
        if number in manifest_lines:
            if st.fence is not None:
                _fail("R1", f"unclosed code fence opened at line {st.fence}")
            if st.canonical:
                _fail("R1", "the qor-plan-claims manifest must sit outside canonical sections")
        elif st.fence is not None:
            _fenced(st, number, line)
        else:
            _structural(st, number, line)
    if st.fence is not None:
        _fail("R1", f"unclosed code fence opened at line {st.fence}")
    missing = [t.strip() for t in CANONICAL_TITLES if t not in st.found]
    if missing:
        _fail("R1", f"plan is missing canonical sections: {', '.join(missing)}")
    return st.out
