"""Read-only evaluation of claims against blob text. Pure: no I/O, no execution.

Function spans and import edges come from the fail-closed tokenizer in
plan_claims_tokens.py. Any construct it cannot classify makes the claim
unverifiable; it never yields a smaller measurement.
"""
from __future__ import annotations

import re

from plan_claims_tokens import Token, tokenize

CODE_SUFFIXES = (".ts", ".cts", ".mts", ".js", ".cjs", ".mjs")
OPENERS, CLOSERS = {"(": ")", "[": "]", "<": ">"}, {")", "]", ">"}
TYPE_LITERAL_PRECEDERS = {":", "|", "&", ",", "<", "(", "=>"}


def _is(tok: Token, value: str) -> bool:
    return tok.kind in ("punct", "ctrl-close", "ident") and tok.value == value


def _match_paren(toks: list[Token], i: int) -> int:
    depth = 0
    for j in range(i, len(toks)):
        depth += {"(": 1, ")": -1}.get(toks[j].value, 0) if toks[j].kind in ("punct", "ctrl-close") else 0
        if depth == 0:
            return j
    raise ValueError("unbalanced parameter list")


def _body_open(toks: list[Token], i: int, arrow: bool) -> int:
    """i is the index after the parameters' ')'; return the index of the body '{' or raise."""
    if not arrow and _is(toks[i], "{"):
        return i
    if not arrow and not _is(toks[i], ":"):
        raise ValueError("unsupported tokens between parameters and body")
    depth = 0
    for j in range(i, len(toks)):
        tok = toks[j]
        if tok.kind == "punct" and tok.value in OPENERS:
            depth += 1
        elif tok.kind in ("punct", "ctrl-close") and tok.value in CLOSERS:
            depth -= 1
        elif depth == 0 and arrow and _is(tok, "=>"):
            if j + 1 < len(toks) and _is(toks[j + 1], "{"):
                return j + 1
            raise ValueError("expression-bodied arrow functions are not supported")
        elif depth == 0 and not arrow and _is(tok, "{"):
            if toks[j - 1].value in TYPE_LITERAL_PRECEDERS:
                raise ValueError("object-literal return type is not supported")
            return j
    raise ValueError("function body not found")


def _declarations(toks: list[Token], name: str) -> list[tuple[int, int, bool]]:
    """Return (start index, index of '(' of the parameters, is_arrow) per declaration of name."""
    found = []
    for k in range(len(toks) - 3):
        t = toks[k]
        if _is(t, "function"):
            n = k + 2 if _is(toks[k + 1], "*") else k + 1
            if toks[n].kind == "ident" and toks[n].value == name:
                found.append((k, n + 1, False))
        elif t.kind == "ident" and t.value in ("const", "let", "var") and toks[k + 1].value == name and _is(toks[k + 2], "="):
            n = k + 4 if _is(toks[k + 3], "async") else k + 3
            if _is(toks[n], "function"):
                continue
            found.append((k, n, True))
    return found


def _skip_generics(toks: list[Token], i: int) -> int:
    """i indexes '<'; return the index after the matching '>', failing closed on nested signatures."""
    depth = 0
    for j in range(i, len(toks)):
        if toks[j].value in ("(", "{", "=>") and toks[j].kind == "punct":
            raise ValueError("generic parameters containing (, { or => are not supported")
        depth += {"<": 1, ">": -1}.get(toks[j].value, 0) if toks[j].kind == "punct" else 0
        if depth == 0:
            return j + 1
    raise ValueError("unbalanced generic parameters")


def function_lines(text: str, name: str) -> int:
    toks = tokenize(text)
    decls = _declarations(toks, name)
    if len(decls) != 1:
        raise ValueError(f"expected one declaration of {name}, found {len(decls)}")
    start, param, arrow = decls[0]
    if _is(toks[param], "<"):
        param = _skip_generics(toks, param)
    if not _is(toks[param], "("):
        raise ValueError(f"unsupported declaration form for {name}")
    open_brace = _body_open(toks, _match_paren(toks, param) + 1, arrow)
    depth = 0
    for j in range(open_brace, len(toks)):
        depth += {"{": 1, "}": -1}.get(toks[j].value, 0) if toks[j].kind == "punct" else 0
        if depth == 0:
            first = start - 1 if start and toks[start - 1].value in ("export", "async", "default") else start
            first = first - 1 if first and toks[first - 1].value == "export" else first
            return toks[j].line - toks[first].line + 1
    raise ValueError("unbalanced function body")


def import_specifiers(text: str) -> set[str]:
    toks, specs = tokenize(text), set()
    for k, tok in enumerate(toks[:-1]):
        if tok.kind != "ident" or (k and toks[k - 1].value == "."):
            continue
        nxt = toks[k + 1]
        if tok.value in ("from", "import") and nxt.kind == "str":
            specs.add(nxt.value)
        elif tok.value in ("import", "require") and _is(nxt, "(") and k + 2 < len(toks):
            if toks[k + 2].kind not in ("str", "template"):
                raise ValueError(f"non-literal module specifier on line {toks[k + 2].line}")
            specs.add(toks[k + 2].value)
    return specs


def _enum_problem(text: str, claim: dict) -> str | None:
    m = re.search(rf"(?m)^\s*(?:export\s+)?type\s+{re.escape(claim['type'])}\s*=\s*([^;]*);", text)
    body = m.group(1) if m else ""
    if not re.fullmatch(r"\s*\|?\s*\"[^\"]*\"(?:\s*\|\s*\"[^\"]*\")*\s*", body):
        return f"type {claim['type']} is not a string-literal union"
    found = re.findall(r"\"([^\"]*)\"", body)
    if set(found) == set(claim["values"]):
        return None
    return f"enum values are {sorted(found)}"


def _size_problem(text: str, claim: dict) -> str | None:
    count = len(text.splitlines()) if claim["kind"] == "file-lines" else function_lines(text, claim["function"])
    if count > claim["max"]:
        return f"{count} lines exceeds {claim['max']}"
    if claim.get("equals") not in (None, count):
        return f"{count} lines, expected {claim['equals']}"
    return None


def _evaluate(text: str, claim: dict) -> str | None:
    kind = claim["kind"]
    if kind in ("function-lines", "import-edge") and not claim["path"].endswith(CODE_SUFFIXES):
        return f"unsupported file type for {kind}: {claim['path']}"
    if kind == "line-equals":
        lines = text.split("\n")
        actual = lines[claim["line"] - 1].rstrip("\r") if claim["line"] <= len(lines) else None
        return None if actual == claim["text"] else f"line {claim['line']} is {actual!r}"
    if kind in ("text-present", "text-absent"):
        want_present = kind == "text-present"
        if (claim["text"] in text) == want_present:
            return None
        return "text missing" if want_present else "text present"
    if kind == "enum-values":
        return _enum_problem(text, claim)
    if kind == "import-edge":
        present = claim["specifier"] in import_specifiers(text)
        return None if present == claim["present"] else f"import of {claim['specifier']} present={present}"
    return _size_problem(text, claim)


def evaluate(text: str, claim: dict) -> str | None:
    try:
        return _evaluate(text, claim)
    except (ValueError, IndexError, RecursionError) as error:
        return f"cannot be verified (fail closed): {error}"
