"""Fail-closed JavaScript/TypeScript tokenizer for read-only span and import checks.

It tokenizes strings, template literals (including nested ${...} expressions),
regular-expression literals, comments, identifiers, numbers and punctuators.
Whether a "/" starts a regex or is division is decided from the previous token.
If that context is ambiguous (after "}" or after "++"/"--"), the tokenizer
raises ValueError instead of guessing. It is not a full parser.
"""
from __future__ import annotations

import bisect
import re
from typing import NamedTuple

IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")
NUMBER_RE = re.compile(r"\d[\w.]*|\.\d\w*")
REGEX_KEYWORDS = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case",
                  "do", "else", "yield", "await", "extends"}
CONTROL_KEYWORDS = {"if", "while", "for", "with"}
REGEX_AFTER_PUNCT = set("(,=:[!&|?{;+-*%<>~^") | {"=>", "${"}


class Token(NamedTuple):
    kind: str  # ident | num | str | template | regex | punct | ctrl-close | tmpl-open | tmpl-close
    value: str
    line: int


def _string_end(text: str, i: int) -> int:
    quote, j = text[i], i + 1
    while j < len(text) and text[j] != quote:
        if text[j] == "\n":
            raise ValueError(f"unterminated string at offset {i}")
        j += 2 if text[j] == "\\" else 1
    if j >= len(text):
        raise ValueError(f"unterminated string at offset {i}")
    return j + 1


def _template_chunk(text: str, i: int) -> tuple[int, bool]:
    """Scan template characters from i; return (index after chunk, True if a ${ was opened)."""
    while i < len(text):
        if text[i] == "\\":
            i += 2
        elif text[i] == "`":
            return i + 1, False
        elif text.startswith("${", i):
            return i + 2, True
        else:
            i += 1
    raise ValueError("unterminated template literal")


def _regex_end(text: str, i: int) -> int:
    j, in_class = i + 1, False
    while j < len(text) and text[j] != "\n":
        if text[j] == "\\":
            j += 2
            continue
        if text[j] == "[":
            in_class = True
        elif text[j] == "]":
            in_class = False
        elif text[j] == "/" and not in_class:
            j += 1
            while j < len(text) and text[j].isalpha():
                j += 1
            return j
        j += 1
    raise ValueError(f"unterminated regular expression at offset {i}")


def _slash_is_regex(prev: Token | None) -> bool:
    if prev is None:
        return True
    if prev.kind in ("ctrl-close", "tmpl-open"):
        return True
    if prev.kind in ("num", "str", "template", "regex", "tmpl-close"):
        return False
    if prev.kind == "ident":
        return prev.value in REGEX_KEYWORDS
    if prev.value == "}" or prev.value in ("++", "--"):
        raise ValueError(f"ambiguous '/' after {prev.value!r} on line {prev.line}")
    if prev.value in (")", "]"):
        return False
    return prev.value in REGEX_AFTER_PUNCT


class _Lexer:
    def __init__(self, text: str):
        self.text, self.i, self.tokens = text, 0, []
        self.newlines = [m.start() for m in re.finditer("\n", text)]
        self.braces: list[str] = []
        self.parens: list[bool] = []

    def emit(self, kind: str, value: str, start: int) -> None:
        self.tokens.append(Token(kind, value, bisect.bisect_left(self.newlines, start) + 1))

    def prev(self, back: int = 1) -> Token | None:
        return self.tokens[-back] if len(self.tokens) >= back else None

    def template(self, start: int, opener: str) -> None:
        end, opened = _template_chunk(self.text, start)
        literal = opener == "template" and not opened
        self.emit("tmpl-open" if opened else opener, self.text[start:end - 1] if literal else "`", start)
        if opened:
            self.braces.append("${")
        self.i = end

    def close_brace(self) -> None:
        if not self.braces:
            raise ValueError("unbalanced '}'")
        if self.braces.pop() == "${":
            self.template(self.i + 1, "tmpl-close")
        else:
            self.emit("punct", "}", self.i)
            self.i += 1

    def punct(self, c: str) -> None:
        start, two = self.i, self.text[self.i:self.i + 2]
        if two in ("=>", "++", "--"):
            self.emit("punct", two, start)
            self.i += 2
            return
        if c == "(":
            prev = self.prev()
            self.parens.append(bool(prev and prev.kind == "ident" and prev.value in CONTROL_KEYWORDS))
        elif c == ")":
            if not self.parens:
                raise ValueError("unbalanced ')'")
            self.emit("ctrl-close" if self.parens.pop() else "punct", ")", start)
            self.i += 1
            return
        elif c == "{":
            self.braces.append("{")
        self.emit("punct", c, start)
        self.i += 1

    def step(self) -> None:
        text, i = self.text, self.i
        c = text[i]
        if c.isspace() or c == "﻿":
            self.i += 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            self.i = len(text) if end < 0 else end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end < 0:
                raise ValueError("unterminated comment")
            self.i = end + 2
        elif c in "'\"":
            self.i = _string_end(text, i)
            self.emit("str", text[i + 1:self.i - 1], i)
        elif c == "`":
            self.template(i + 1, "template")
        elif c == "}":
            self.close_brace()
        elif c == "/" and _slash_is_regex(self.prev()):
            self.i = _regex_end(text, i)
            self.emit("regex", text[i:self.i], i)
        else:
            self.word_or_punct(c)

    def word_or_punct(self, c: str) -> None:
        for kind, pattern in (("ident", IDENT_RE), ("num", NUMBER_RE)):
            m = pattern.match(self.text, self.i)
            if m and (kind == "ident" or c.isdigit() or c == "."):
                self.emit(kind, m.group(), self.i)
                self.i = m.end()
                return
        self.punct(c)


def tokenize(text: str) -> list[Token]:
    lexer = _Lexer(text)
    while lexer.i < len(text):
        lexer.step()
    if lexer.braces or lexer.parens:
        raise ValueError("unbalanced brackets at end of file")
    return lexer.tokens
