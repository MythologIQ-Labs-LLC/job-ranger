#!/usr/bin/env python3
"""Experimental local-only v3 evidence verifier; NOT a PR gate or Qor seal.

Reads a v3 inventory and immutable source blobs from explicit git objects.
No project source, plan, workflow, or inventory commands are executed.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SHA = re.compile(r"[0-9a-f]{40}\Z")
SEGMENT = re.compile(r"[A-Za-z0-9_.][A-Za-z0-9_.-]*\Z")
IDENT = re.compile(r"[a-z0-9][a-z0-9-]{0,48}\Z")
MAX_INVENTORY = 64 * 1024
MAX_SOURCE = 2 * 1024 * 1024
MAX_ERRORS = 30
GIT_COMMANDS = {'cat-file', 'ls-tree', 'merge-base'}
GIT_TIMEOUT_SECONDS = 30


class CheckError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CheckError(message)


def immutable_sha(value: object) -> str:
    require(isinstance(value, str) and SHA.fullmatch(value) is not None,
            'revision must be an exact lowercase 40-character SHA')
    return value


def safe_path(value: object) -> str:
    require(isinstance(value, str) and 0 < len(value) <= 300,
            'path must be a bounded repository-relative string')
    require(all(SEGMENT.fullmatch(piece) and piece not in ('.', '..')
                for piece in value.split('/')),
            'path contains a forbidden segment or Git option')
    return value


def git_executable() -> str:
    # A bare 'git' would let Windows CreateProcess (or a relative POSIX PATH entry) run a
    # git binary from the caller's directory, such as the checkout being checked.
    name = 'git.exe' if os.name == 'nt' else 'git'
    for entry in os.environ.get('PATH', '').split(os.pathsep):
        candidate = os.path.join(entry.strip('"'), name)
        if os.path.isabs(candidate) and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise CheckError('Git executable could not be started')


def git(repo: Path, *args: str, allowed_failure: bool = False) -> bytes | None:
    require(args and args[0] in GIT_COMMANDS, 'unsupported Git operation')
    env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'TMP', 'TEMP')
           if key in os.environ}
    # A partial clone would otherwise fetch inventory-selected missing objects through the
    # repository's configured transport. GIT_NO_LAZY_FETCH needs Git 2.44+;
    # protocol.allow=never also refuses any transport on older Git. Replace refs and the
    # deprecated graft file both rewrite ancestry, so neither is honored.
    env.update(GIT_NO_REPLACE_OBJECTS='1', GIT_GRAFT_FILE=os.devnull, GIT_CONFIG_NOSYSTEM='1', GIT_NO_LAZY_FETCH='1',
               GIT_CONFIG_GLOBAL=os.devnull, GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    try:
        result = subprocess.run([git_executable(), '-C', str(repo), '-c', 'core.fsmonitor=false',
                                 '-c', 'protocol.allow=never', '--no-pager', *args],
                                env=env, capture_output=True, check=False, stdin=subprocess.DEVNULL,
                                timeout=GIT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise CheckError(f'Git object query timed out after {GIT_TIMEOUT_SECONDS} seconds') from exc
    except OSError as exc:
        raise CheckError('Git executable could not be started') from exc
    if result.returncode:
        if allowed_failure:
            return None
        raise CheckError('immutable Git object query failed')
    return result.stdout


def verified_commit(repo: Path, value: object) -> str:
    sha = immutable_sha(value)
    require(git(repo, 'cat-file', '-t', sha, allowed_failure=True) == b'commit\n',
            'revision does not identify an existing commit')
    return sha


def regular_blob(repo: Path, commit: str, path: str, limit: int) -> bytes:
    listing = git(repo, 'ls-tree', '-z', commit, '--', path)
    require(bool(listing), 'immutable path does not exist')
    rows = listing.split(b'\0')
    require(len(rows) == 2 and rows[-1] == b'', 'ambiguous Git path')
    meta, sep, name = rows[0].partition(b'\t')
    require(sep == b'\t' and name == path.encode('utf-8'), 'Git path mismatch')
    parts = meta.split(b' ')
    require(len(parts) == 3, 'malformed Git tree entry')
    mode, kind, oid = parts
    require(mode in (b'100644', b'100755') and kind == b'blob',
            'path is not a regular Git blob (symlink/gitlink/type change refused)')
    require(re.fullmatch(rb'[0-9a-f]{40}', oid) is not None, 'invalid Git object id')
    size = git(repo, 'cat-file', '-s', oid.decode('ascii'))
    require(size is not None and size.strip().isdigit(), 'Git blob size unavailable')
    require(int(size.strip()) <= limit, f'blob exceeds {"2 MiB" if limit == MAX_SOURCE else "64 KiB"} limit')
    data = git(repo, 'cat-file', 'blob', oid.decode('ascii'))
    require(data is not None and len(data) <= limit, 'Git blob exceeds configured limit')
    return data


def no_duplicates(items: list[tuple[str, object]]) -> dict:
    d = {}
    for key, value in items:
        # Keys are untrusted: ascii() escapes newlines, terminal controls and non-ASCII.
        require(key not in d, f'duplicate JSON key: {ascii(key[:30])}')
        d[key] = value
    return d


def decode_json(data: bytes) -> object:
    try:
        return json.loads(data.decode('utf-8', 'strict'), object_pairs_hook=no_duplicates,
                          parse_constant=lambda value: (_ for _ in ()).throw(CheckError('non-finite number forbidden')))
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise CheckError('invalid UTF-8 JSON inventory') from exc


def fields(record: object, allowed: set[str], required: set[str]) -> dict:
    require(isinstance(record, dict), 'record must be an object')
    require(required <= record.keys() and record.keys() <= allowed,
            'record contains missing or unexpected fields')
    return record


def check_inventory(doc: object) -> tuple[list[dict], list[dict]]:
    doc = fields(doc, {'schema_version', 'plan', 'claims', 'judgments'},
                 {'schema_version', 'plan', 'claims', 'judgments'})
    require(type(doc['schema_version']) is int and doc['schema_version'] == 3,
            'schema_version 3 is required, legacy payloads are unsupported')
    safe_path(doc['plan'])
    require(doc['plan'].endswith('.md'), 'plan must identify a Markdown path (not interpreted here)')
    claims, judgments = doc['claims'], doc['judgments']
    require(isinstance(claims, list) and 1 <= len(claims) <= 200,
            'claims must contain between 1 and 200 records')
    require(isinstance(judgments, list) and len(judgments) <= 50,
            'judgments must be a list with no more than 50 records')
    seen = set()
    for claim in claims:
        require(isinstance(claim, dict), 'claim must be an object')
        kind = claim.get('kind')
        allowed = {
            'line-equals': {'line', 'text'}, 'text-present': {'text'},
            'text-absent': {'text'}, 'file-lines': {'predicate'},
        }
        require(isinstance(kind, str) and kind in allowed, 'unsupported claim kind (function/import/enum/test outcomes never verified)')
        common = {'id', 'kind', 'commit', 'path', 'purpose'}
        fields(claim, common | allowed[kind], common | allowed[kind])
        require(isinstance(claim['id'], str) and IDENT.fullmatch(claim['id']) is not None,
                'invalid claim id')
        require(claim['id'] not in seen, 'duplicate claim/judgment id')
        seen.add(claim['id'])
        immutable_sha(claim['commit'])
        safe_path(claim['path'])
        require(isinstance(claim['purpose'], str) and 8 <= len(claim['purpose']) <= 300,
                'claim purpose must be 8-300 characters')
        if kind in ('line-equals', 'text-present', 'text-absent'):
            value = claim['text']
            require(isinstance(value, str) and 1 <= len(value) <= 500 and '\r' not in value and '\n' not in value,
                    'text must be a single nonempty line <=500 characters')
        if kind == 'line-equals':
            require(type(claim['line']) is int and 1 <= claim['line'] <= 1000000,
                    'line must be a positive bounded integer')
        if kind == 'file-lines':
            predicate = fields(claim['predicate'], {'operator', 'value'}, {'operator', 'value'})
            require(predicate['operator'] in ('equals', 'at-most') and
                    type(predicate['value']) is int and 0 <= predicate['value'] <= 1000000,
                    'file-lines requires an explicit valid predicate')
    for record in judgments:
        fields(record, {'id', 'statement', 'owner', 'rationale'},
               {'id', 'statement', 'owner', 'rationale'})
        ident = record['id']
        require(isinstance(ident, str) and IDENT.fullmatch(ident) is not None and ident not in seen,
                'duplicate or invalid judgment id')
        seen.add(ident)
        for field, low, high in [('statement', 8, 300), ('owner', 2, 80), ('rationale', 40, 1000)]:
            value = record[field]
            require(isinstance(value, str) and low <= len(value) <= high and '\n' not in value,
                    f'invalid {field} value')
    return claims, judgments


def check_claim(repo: Path, head: str, claim: dict) -> None:
    commit = verified_commit(repo, claim['commit'])
    require(git(repo, 'merge-base', '--is-ancestor', commit, head, allowed_failure=True) is not None,
            'claim revision is not an ancestor of explicit head')
    source = regular_blob(repo, commit, claim['path'], MAX_SOURCE)
    try:
        text = source.decode('utf-8', 'strict')
    except UnicodeError as exc:
        raise CheckError('source is not UTF-8 text') from exc
    kind = claim['kind']
    if kind == 'text-present':
        require(claim['text'] in text, 'literal text is absent')
    elif kind == 'text-absent':
        require(claim['text'] not in text, 'prohibited literal text is present')
    elif kind == 'line-equals':
        lines = text.split('\n')
        if text.endswith('\n'):
            lines.pop()
        require(claim['line'] <= len(lines) and lines[claim['line'] - 1].removesuffix('\r') == claim['text'],
                'line is absent or differs from literal expectation')
    elif kind == 'file-lines':
        count = text.count('\n') + int(bool(text) and not text.endswith('\n'))
        pred = claim['predicate']
        matches = count == pred['value'] if pred['operator'] == 'equals' else count <= pred['value']
        require(matches, 'immutable file-line predicate failed')


def run(repo: Path, head: str, inventory: str) -> int:
    try:
        verified_commit(repo, head)
        data = regular_blob(repo, head, safe_path(inventory), MAX_INVENTORY)
        claims, judgments = check_inventory(decode_json(data))
    except CheckError as exc:
        print('FAILED: ' + str(exc)[:300])
        return 1
    verified = 0
    errors = []
    for claim in claims:
        try:
            check_claim(repo, head, claim)
            verified += 1
        except CheckError as exc:
            if len(errors) < MAX_ERRORS:
                errors.append(f'{claim["id"]}: {str(exc)[:240]}')
    print(f'Local immutable evidence: VERIFIED {verified}/{len(claims)} declared claims')
    for error in errors:
        print('FAILED: ' + error)
    if len(claims) - verified > len(errors):
        print(f'TRUNCATED: {len(claims) - verified - len(errors)} additional claim errors')
    print(f'Judgments: {len(judgments)} NOT CHECKED')
    print('Prose, citation/plan structure and missing facts: NOT CHECKED')
    print('Governance: local-only; no PR coverage, required-check status, Qor PASS, or remediation closure')
    return 1 if verified != len(claims) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--inventory', required=True)
    args = parser.parse_args(argv)
    try:
        return run(args.repo, immutable_sha(args.head), safe_path(args.inventory))
    except CheckError as exc:
        print('FAILED: ' + str(exc)[:300])
        return 1


if __name__ == '__main__':
    sys.exit(main())
