"""R1: bind empirical assertions in canonical plan sections to typed claims. Pure: no I/O.

Structure comes from plan_claims_markdown.scan, a restricted subset that fails
closed.

Binding rules:
- Each detected assertion instance must bind to exactly one unused,
  type-compatible claim on its own line.
- The subject is taken from the assertion itself:
  - a citation or grep carries its own path;
  - a line reference needs exactly one file named on the line;
  - a size, enum, import or text assertion needs a backticked subject directly
    before it, with no other identifier in between.
- Revision: a SHA prefix of the claim's commit must appear on the line.
- Property: exact sizes bind only to `equals`; "at most N" and "under N" bind to
  `max`.
- Each id is referenced once.
- Each judgment quotes its line verbatim and covers exactly one non-mechanical
  number or exhaustiveness phrase.

Detection is lexical. Numbers written as words, for example, are not detected,
so the independent auditor remains responsible for undetected prose.
"""
from __future__ import annotations

import posixpath
import re
from collections import Counter

from plan_claims_markdown import blank_code_spans, scan
from plan_claims_schema import _fail

REF_RE = re.compile(r"\[(claim|judgment):([a-z0-9][a-z0-9-]{0,48})\]")
HEX_RE = re.compile(r"\b[0-9a-f]{7,40}\b")
FILE_RE = re.compile(r"[\w./-]*\w\.[A-Za-z][A-Za-z0-9]{0,5}\b")
SPAN_RE = re.compile(r"`([^`]+)`")
IDENTIFIER_RE = re.compile(r"\b[a-z]+[A-Z]\w*\b|\b\w*[_$]\w*\b|" + FILE_RE.pattern)
FORMS = (
    ("grep evidence", re.compile(r"`git show ([0-9a-f]{7,40}):([^`\s|]+)[^`]*` -> `(\d+):([^`]*)`")),
    ("file:line citation", re.compile(r"([\w./-]+\.[A-Za-z][A-Za-z0-9]{0,5})(?::|#L)(\d+)\b")),
    ("line reference", re.compile(r"\blines? (\d+(?:(?:, | and | to |-)\d+)*)\b|\bL(\d+)(?:-L(\d+))?\b")),
    ("size", re.compile(r"\b(\d[\d,]*)[ -]lines?\b")),
    ("enum literal", re.compile(r"\"[^\"\s|]{1,40}\"(?: ?\| ?\"[^\"\s|]{1,40}\")+")),
    ("import", re.compile(r"\bimports? `([^`]{1,200})`|\brequire\(\s*[\"']([^\"']{1,200})[\"']")),
    ("text", re.compile(r"\b(contains|does not contain|lacks) `([^`]{1,500})`")),
    ("test classification", re.compile(r"(?i)\bred-first\b|\bregression-lock\b|\bfails? (?:red|by name)\b"
                                       r"|\b(?:already|currently|still) (?:pass(?:es|ing)?|fail(?:s|ing)?|red|green)\b")),
    ("import graph", re.compile(r"(?i)\bimport (?:cycle|edge)s?\b")),
    ("exhaustiveness", re.compile(r"(?i)\b(?:only|sole) (?:callers?|importers?|call sites?|usages?|users?)\b"
                                  r"|\bno other (?:callers?|importers?|usages?)\b|\bnothing else (?:calls|invokes|imports|uses)\b")),
)
JUDGMENT_FORMS = {"import graph", "exhaustiveness"}
NEEDS_SPAN_SUBJECT = {"size", "enum literal", "import", "text"}
EXEMPT = re.compile("|".join([
    r"\b[0-9a-f]{40}\b", r"\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,39}\b", r"#\d+",
    r"\b(?:Phase|phase|Step|Steps|[Ii]teration|Entry|Entries|Amendment|PR|issue)s? #?\d+(?:\.\d+)*",
    r"\bv?\d+\.\d+\.\d+\b", r"\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?Z?)?\b", r"^\s*\d+\.\s",
    FILE_RE.pattern, r"\bUTC[+-]\d+(?:[.:]\d+)?", r"\b[A-Za-z_]+\d+\w*\b", r"\b\d+(?:st|nd|rd|th)\b",
]), re.M)
NUMBER_RE = re.compile(r"\d[\d,.]*")
MAX_QUALIFIER = re.compile(r"(?:at most|up to|no more than|<=)\s*$")
BELOW_QUALIFIER = re.compile(r"(?:under|below|fewer than|less than|<)\s*$")


def _blank(work: str, span: tuple[int, int]) -> str:
    return work[:span[0]] + " " * (span[1] - span[0]) + work[span[1]:]


def analyse(line: str, unit_tests: bool, commits: frozenset = frozenset()) -> tuple[list, list]:
    """Return ([(form, match)], [pending (start, end) spans that only a judgment may cover])."""
    work = REF_RE.sub(lambda m: " " * len(m.group()), line)
    found, pending = [], []
    for form, pattern in FORMS:
        for m in list(pattern.finditer(work)):
            (pending if form in JUDGMENT_FORMS else found).append(m.span() if form in JUDGMENT_FORMS else (form, m))
            work = _blank(work, m.span())
    for m in list(HEX_RE.finditer(work)):
        if any(sha.startswith(m.group()) for sha in commits):
            work = _blank(work, m.span())
    if unit_tests:
        work = blank_code_spans(work)
    residual = EXEMPT.sub(lambda m: " " * len(m.group()), work)
    return found, pending + [m.span() for m in NUMBER_RE.finditer(residual)]


def _span_subject(line: str, start: int, commits: frozenset) -> str | None:
    spans = [m for m in SPAN_RE.finditer(line[:start]) if not any(c.startswith(m.group(1)) for c in commits)]
    if not spans:
        return None
    between = line[spans[-1].end():start]
    between = HEX_RE.sub(" ", SPAN_RE.sub(lambda m: m.group() if not HEX_RE.fullmatch(m.group(1)) else " ", between))
    return None if IDENTIFIER_RE.search(between) or "`" in between else spans[-1].group(1)


def subject(form: str, m: re.Match, line: str, number: int, commits: frozenset) -> str | None:
    if form in NEEDS_SPAN_SUBJECT:
        found = _span_subject(line, m.start(), commits)
    elif form == "line reference":
        files = {posixpath.basename(f) for f in FILE_RE.findall(REF_RE.sub(" ", line))}
        found = files.pop() if len(files) == 1 else None
    else:
        return None
    if found is None:
        _fail("R1", f"ambiguous or missing subject for {form} at line {number}: name exactly one subject in backticks directly before it")
    return found


def _subject_ok(claim: dict, name: str | None) -> bool:
    if name is None:
        return True
    if claim["kind"] == "function-lines":
        return claim["function"] == name
    if claim["kind"] == "enum-values":
        return claim["type"] == name
    path = claim.get("path", "")
    return name in (path, posixpath.basename(path)) or path.endswith("/" + name)


def _size_ok(claim: dict, line: str, m: re.Match, value: int) -> bool:
    before = line[:m.start()]
    if MAX_QUALIFIER.search(before):
        return claim["max"] == value
    if BELOW_QUALIFIER.search(before):
        return claim["max"] == value - 1
    return claim.get("equals") == value


def _property_ok(form: str, m: re.Match, claim: dict, line: str, item: str) -> bool:
    kind = claim["kind"]
    if form == "grep evidence":
        return (kind == "line-equals" and claim["commit"].startswith(m.group(1)) and claim["path"] == m.group(2)
                and claim["line"] == int(m.group(3)) and claim["text"] == m.group(4))
    if form == "file:line citation":
        return kind == "line-equals" and claim["line"] == int(item) and _subject_ok(claim, m.group(1))
    if form == "line reference":
        return kind == "line-equals" and claim["line"] == int(item)
    if form == "size":
        return kind in ("file-lines", "function-lines") and _size_ok(claim, line, m, int(item))
    if form == "enum literal":
        return kind == "enum-values" and set(re.findall(r"\"([^\"]*)\"", m.group())) == set(claim["values"])
    negated = bool(re.search(r"\b(?:not|no|never)\b", line[max(0, m.start() - 30):m.start()]))
    if form == "import":
        return kind == "import-edge" and claim["specifier"] == item and claim["present"] == (not negated)
    want = "text-absent" if m.group(1) in ("does not contain", "lacks") else "text-present"
    return kind == want and claim["text"] == item


def _items(form: str, m: re.Match) -> list[str]:
    if form == "line reference":
        return [n for n in (m.groups()) if n and n.isdigit()] if m.group(3) else re.findall(r"\d+", m.group(1))
    groups = {"size": lambda: [m.group(1).replace(",", "")], "file:line citation": lambda: [m.group(2)],
              "import": lambda: [m.group(1) or m.group(2)], "text": lambda: [m.group(2)]}
    return groups.get(form, lambda: [m.group()])()


def _candidates(form: str, m: re.Match, item: str, ctx: dict) -> list[str]:
    claims, line = ctx["claims"], ctx["line"]
    if form == "test classification":
        return [c for c in ctx["free"] if claims[c]["kind"] == "test-outcome"]
    return [c for c in ctx["free"] if claims[c]["kind"] != "test-outcome"
            and any(claims[c]["commit"].startswith(p) for p in ctx["prefixes"])
            and _subject_ok(claims[c], ctx["subject"]) and _property_ok(form, m, claims[c], line, item)]


def _bind_claims(number: int, line: str, found: list, refs: list, claims: dict, commits: frozenset) -> None:
    ctx = {"claims": claims, "line": line, "prefixes": HEX_RE.findall(line),
           "free": [i for t, i in refs if t == "claim"]}
    for form, m in found:
        ctx["subject"] = subject(form, m, line, number, commits)
        for item in _items(form, m):
            match = _candidates(form, m, item, ctx)
            if not match and form == "test classification":
                _fail("R1", f"test classification at line {number} needs a test-outcome claim backed by a trusted harness (D3)")
            if not match:
                _fail("R1", f"unbound assertion ({form}) at line {number}: {m.group()[:100]}")
            ctx["free"].remove(match[0])
    if ctx["free"]:
        _fail("R1", f"claim {ctx['free'][0]} on line {number} is not bound to a compatible assertion")


def _bind_judgments(number: int, line: str, pending: list, refs: list, judgments: dict) -> None:
    clean = REF_RE.sub(lambda m: " " * len(m.group()), line)
    spans = {}
    for j in (i for t, i in refs if t == "judgment"):
        start = clean.find(judgments[j]["statement"])
        if start < 0:
            _fail("R1", f"judgment {j} statement is not quoted verbatim from line {number}")
        spans[j] = (start, start + len(judgments[j]["statement"]))
    covered = Counter()
    for s, e in pending:
        owner = [j for j, (a, b) in spans.items() if a <= s and e <= b]
        if not owner:
            _fail("R1", f"unbound assertion (number or exhaustiveness) at line {number}: {clean[s:e]!r} needs a claim or a scoped judgment")
        covered[owner[0]] += 1
    for j in spans:
        if covered[j] != 1:
            _fail("R1", f"judgment {j} at line {number} must cover exactly one non-mechanical assertion (covers {covered[j]})")


def _check_ids(manifest: dict, prose: str, lines: list) -> None:
    ids = [c["id"] for c in manifest["claims"]] + [j["id"] for j in manifest["judgments"]]
    if len(ids) != len(set(ids)):
        _fail("R1", f"duplicate claim or judgment ids: {sorted({i for i in ids if ids.count(i) > 1})}")
    rationales = [j["rationale"].strip().lower() for j in manifest["judgments"]]
    if len(rationales) != len(set(rationales)):
        _fail("R1", "judgment rationales must be specific to each assertion, not copied")
    canonical_refs = [r for line in lines for r in REF_RE.findall(line.text)]
    if len(canonical_refs) != len(REF_RE.findall(prose)):
        _fail("R1", "claim or judgment references outside canonical sections cannot bind to an assertion")
    for (t, i), count in Counter(canonical_refs).items():
        if count > 1:
            _fail("R1", f"{t} {i} referenced on {count} lines (one assertion per entry)")
    declared = {("claim", c["id"]) for c in manifest["claims"]} | {("judgment", j["id"]) for j in manifest["judgments"]}
    if set(canonical_refs) - declared:
        _fail("R1", f"missing claim or judgment for references {sorted(set(canonical_refs) - declared)}")
    if declared - set(canonical_refs):
        _fail("R1", f"orphan manifest entries never referenced by the plan: {sorted(declared - set(canonical_refs))}")


def check_completeness(text: str, prose: str, manifest: dict, manifest_lines: range) -> None:
    lines = scan(text, manifest_lines)
    commits = frozenset(manifest["commits"].values())
    analysed = [(line, *analyse(line.text, line.unit_tests, commits)) for line in lines]
    if any(found or pending for _, found, pending in analysed) and not (manifest["claims"] or manifest["judgments"]):
        _fail("R1", "empirical assertions require a non-empty manifest of bound claims")
    _check_ids(manifest, prose, lines)
    claims = {c["id"]: c for c in manifest["claims"]}
    judgments = {j["id"]: j for j in manifest["judgments"]}
    for line, found, pending in analysed:
        refs = REF_RE.findall(line.text)
        _bind_claims(line.number, line.text, found, refs, claims, commits)
        _bind_judgments(line.number, line.text, pending, refs, judgments)
