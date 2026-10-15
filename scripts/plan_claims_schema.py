"""Closed schema for qor-plan-claims manifests (version 2). Pure: no I/O."""
from __future__ import annotations

import re

SHA_RE = re.compile(r"[0-9a-f]{40}")
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,48}")
SEGMENT_RE = re.compile(r"[A-Za-z0-9_.][A-Za-z0-9_.-]*")
IDENT_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
COMMON = {"id", "kind", "commit"}
KINDS = {
    "line-equals": ({"path", "line", "text"}, set()),
    "text-present": ({"path", "text"}, set()),
    "text-absent": ({"path", "text"}, set()),
    "file-lines": ({"path", "max"}, {"equals"}),
    "function-lines": ({"path", "function", "max"}, {"equals"}),
    "enum-values": ({"path", "type", "values"}, set()),
    "import-edge": ({"path", "specifier", "present"}, set()),
    "test-outcome": ({"suite", "assertion", "outcome"}, set()),
}


class PlanClaimsError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"[{code}] {message}")


def _fail(code: str, message: str) -> None:
    raise PlanClaimsError(code, message)


def _check_path(claim_id: str, path: object) -> None:
    if not isinstance(path, str) or not path or len(path) > 300:
        _fail("R3", f"claim {claim_id}: path must be a non-empty repository-relative string")
    if not all(SEGMENT_RE.fullmatch(s) and s not in (".", "..") for s in path.split("/")):
        _fail("R3", f"claim {claim_id}: path {path!r} is not a safe repository-relative path")


def _check_fields(claim: dict) -> None:
    cid, kind = claim["id"], claim["kind"]
    if "path" in claim:
        _check_path(cid, claim["path"])
    ints = [k for k in ("line", "max", "equals") if k in claim]
    if any(type(claim[k]) is not int or claim[k] < (1 if k == "line" else 0) for k in ints):
        _fail("SCHEMA", f"claim {cid}: line/max/equals must be non-negative integers")
    if "text" in claim and (not isinstance(claim["text"], str) or not claim["text"] or "\n" in claim["text"] or len(claim["text"]) > 500):
        _fail("SCHEMA", f"claim {cid}: text must be one non-empty line of at most 500 chars")
    for key in ("function", "type"):
        if key in claim and not (isinstance(claim[key], str) and IDENT_RE.fullmatch(claim[key])):
            _fail("SCHEMA", f"claim {cid}: {key} must be an identifier")
    if kind == "enum-values":
        values = claim["values"]
        if not isinstance(values, list) or not values or not all(isinstance(v, str) and v for v in values) or len(set(values)) != len(values):
            _fail("SCHEMA", f"claim {cid}: values must be a non-empty list of unique strings")
    if kind == "import-edge" and (type(claim["present"]) is not bool or not isinstance(claim["specifier"], str)
                                  or not re.fullmatch(r"[A-Za-z0-9@._/-]{1,200}", claim["specifier"])):
        _fail("SCHEMA", f"claim {cid}: import-edge needs a literal specifier and boolean present")
    if kind == "test-outcome" and claim["outcome"] not in ("pass", "fail"):
        _fail("SCHEMA", f"claim {cid}: outcome must be pass or fail")


def _validate_claim(claim: object, commits: dict) -> None:
    if not isinstance(claim, dict) or not isinstance(claim.get("kind"), str) or claim["kind"] not in KINDS:
        _fail("SCHEMA", "unsupported claim kind")
    required, optional = KINDS[claim["kind"]]
    extra = set(claim) - COMMON - required - optional
    if extra or not (COMMON | required) <= set(claim):
        _fail("SCHEMA", f"claim {claim.get('id')!r} ({claim['kind']}): unexpected {sorted(extra)} or missing fields")
    if not isinstance(claim["id"], str) or not ID_RE.fullmatch(claim["id"]):
        _fail("SCHEMA", f"invalid claim id {claim['id']!r}")
    if not isinstance(claim["commit"], str) or not SHA_RE.fullmatch(claim["commit"]):
        _fail("R4", f"claim {claim['id']}: commit must be a full 40-character lowercase SHA")
    if claim["commit"] not in commits.values():
        _fail("R4", f"claim {claim['id']}: commit {claim['commit']} is not declared in commits")
    _check_fields(claim)


def _validate_judgment(item: object) -> None:
    if not isinstance(item, dict) or set(item) != {"id", "statement", "rationale"}:
        _fail("SCHEMA", "judgment must have exactly id, statement, rationale")
    if not all(isinstance(item[k], str) for k in item) or not ID_RE.fullmatch(item["id"]):
        _fail("SCHEMA", "judgment id, statement and rationale must be strings with a valid id")
    if not 8 <= len(item["statement"]) <= 300 or "\n" in item["statement"]:
        _fail("SCHEMA", f"judgment {item['id']}: statement must be one line of 8-300 characters")
    if len(item["rationale"].strip()) < 40:
        _fail("SCHEMA", f"judgment {item['id']}: rationale must be at least 40 characters")


def _validate(manifest: object) -> dict:
    if not isinstance(manifest, dict) or manifest.get("version") != 2:
        _fail("SCHEMA", "manifest must be an object with version 2")
    if set(manifest) != {"version", "commits", "claims", "judgments"}:
        _fail("SCHEMA", f"manifest keys must be exactly version, commits, claims, judgments; got {sorted(manifest)}")
    commits, claims, judgments = manifest["commits"], manifest["claims"], manifest["judgments"]
    if not isinstance(commits, dict) or not all(isinstance(v, str) for v in commits.values()):
        _fail("SCHEMA", "commits must map labels to SHA strings")
    for label, sha in commits.items():
        if not SHA_RE.fullmatch(sha):
            _fail("R4", f"commit {label}={sha!r} must be a full 40-character lowercase SHA")
    if not isinstance(claims, list) or not isinstance(judgments, list):
        _fail("SCHEMA", "claims and judgments must be lists")
    for claim in claims:
        _validate_claim(claim, commits)
    for item in judgments:
        _validate_judgment(item)
    return manifest


def validate_manifest(manifest: object) -> dict:
    try:
        return _validate(manifest)
    except (TypeError, KeyError, AttributeError, ValueError, RecursionError) as error:
        raise PlanClaimsError("SCHEMA", f"malformed manifest: {type(error).__name__}") from None
