"""Adversarial tests for the optional local-only v3 Git blob evidence checker."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'scripts' / 'local_evidence_cli.py'
# Fixture Git must not inherit the developer's global/system config (commit signing,
# hooks, templates) or wait on a terminal; every child process is bounded.
GIT_ENV = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1', GIT_TERMINAL_PROMPT='0')
TIMEOUT = 120

def git(repo: Path, *args: str, stdin: bytes | None = None) -> str:
    p = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, check=True, env=GIT_ENV,
                       input=stdin if stdin is not None else b'', timeout=TIMEOUT)
    return p.stdout.decode('utf-8').strip()

class LocalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='job-ranger-evidence-')
        self.repo = Path(self.tmp.name)
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'config', 'user.email', 'test@example.invalid')
        (self.repo / 'src').mkdir()
        (self.repo / 'docs').mkdir()
        (self.repo / 'src' / 'core.txt').write_bytes(b'first\nsecond\n')
        git(self.repo, 'add', 'src/core.txt')
        git(self.repo, 'commit', '-qm', 'base')
        self.base = git(self.repo, 'rev-parse', 'HEAD')
        self.good = {"schema_version": 3, "plan": "docs/plan-qor-phase18-check.md", "claims": [
            {"id": "line-match", "kind": "line-equals", "commit": self.base,
             "path": "src/core.txt", "line": 2, "text": "second", "purpose": "Check an exact immutable line"},
            {"id": "present", "kind": "text-present", "commit": self.base,
             "path": "src/core.txt", "text": "first", "purpose": "Check a known literal fragment"},
            {"id": "absent", "kind": "text-absent", "commit": self.base,
             "path": "src/core.txt", "text": "not_here", "purpose": "Check a missing literal fragment"},
            {"id": "lines", "kind": "file-lines", "commit": self.base,
             "path": "src/core.txt", "predicate": {"operator": "equals", "value": 2},
             "purpose": "Check an immutable file line count"}],
            "judgments": [{"id": "human", "statement": "The role is appropriate", "owner": "human reviewer",
                           "rationale": "This requires context and independent human review, not a filesystem query."}]}

    def tearDown(self):
        self.tmp.cleanup()

    def commit_inventory(self, inv=None, raw=None):
        (self.repo / 'docs' / 'claims.evidence.json').write_text(
            raw if raw is not None else json.dumps(self.good if inv is None else inv), encoding='utf-8')
        git(self.repo, 'add', 'docs/claims.evidence.json')
        git(self.repo, 'commit', '-qm', 'inventory')
        return git(self.repo, 'rev-parse', 'HEAD')

    def run_cli(self, sha, path='docs/claims.evidence.json', repo=None, env=None):
        return subprocess.run([sys.executable, str(CLI), '--repo', str(repo or self.repo), '--head', sha,
                               '--inventory', path], capture_output=True, text=True, encoding='utf-8',
                              errors='replace', stdin=subprocess.DEVNULL, env=env, timeout=TIMEOUT)

    def commit_files(self, files: dict[str, bytes]) -> str:
        for name, data in files.items():
            (self.repo / name).write_bytes(data)
        git(self.repo, 'add', *files)
        git(self.repo, 'commit', '-qm', 'fixtures')
        return git(self.repo, 'rev-parse', 'HEAD')

    def claim(self, ident, kind, commit, path, **extra):
        return {'id': ident, 'kind': kind, 'commit': commit, 'path': path,
                'purpose': 'Adversarial regression claim', **extra}

    def test_valid_facts_and_human_judgment_are_distinct(self):
        r = self.run_cli(self.commit_inventory())
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('VERIFIED 4/4', r.stdout)
        self.assertIn('NOT CHECKED', r.stdout)
        self.assertIn('no PR coverage', r.stdout)

    def test_wrong_claim_fails_without_false_success(self):
        inv = json.loads(json.dumps(self.good)); inv['claims'][0]['text'] = 'wrong'
        r = self.run_cli(self.commit_inventory(inv))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('FAILED', r.stdout)

    def test_head_must_be_immutable_full_lowercase_sha(self):
        head = self.commit_inventory()
        for bad in ('HEAD', head[:8], 'refs/heads/main', head.upper(), '--help', 'a' * 40):
            with self.subTest(bad=bad):
                r = self.run_cli(bad)
                self.assertNotEqual(r.returncode, 0)
                self.assertNotIn('VERIFIED 4/4', r.stdout)

    def test_author_controlled_commands_and_unknown_claims_rejected(self):
        for payload in ({'command': 'touch HACKED'}, {'argv': ['sh', '-c', 'touch HACKED']},
                        {'setup': 'python -c malicious'}, {'kind': 'function-lines'}):
            with self.subTest(payload=payload):
                inv = json.loads(json.dumps(self.good)); inv['claims'][0].update(payload)
                r = self.run_cli(self.commit_inventory(inv))
                self.assertNotEqual(r.returncode, 0)
                self.assertFalse((self.repo / 'HACKED').exists())

    def test_wrongly_typed_kind_is_a_controlled_failure(self):
        for bad in ([], {}, 1, None):
            with self.subTest(bad=bad):
                inv = json.loads(json.dumps(self.good)); inv['claims'][0]['kind'] = bad
                r = self.run_cli(self.commit_inventory(inv))
                self.assertEqual(r.returncode, 1)
                self.assertIn('FAILED: unsupported claim kind', r.stdout)
                self.assertNotIn('Traceback', r.stderr)

    def test_duplicate_json_keys_rejected(self):
        raw = '{"schema_version":3,"schema_version":3,"plan":"docs/a.md","claims":[],"judgments":[]}'
        r = self.run_cli(self.commit_inventory(raw=raw))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('duplicate', r.stdout.lower())

    def test_missing_or_mutated_evidence_blob_fails(self):
        head = self.commit_inventory()
        (self.repo / 'docs' / 'claims.evidence.json').write_text('corrupt working tree', encoding='utf-8')
        r = self.run_cli(head)
        self.assertEqual(r.returncode, 0, 'Pinned input must ignore worktree changes')
        self.assertEqual((self.repo / 'docs' / 'claims.evidence.json').read_text(), 'corrupt working tree')
        missing = self.run_cli(head, 'docs/not-found.json')
        self.assertNotEqual(missing.returncode, 0)

    def test_path_traversal_and_git_flag_injection_rejected(self):
        for bad in ('../src/core.txt', '/etc/passwd', '--help', 'src/../../etc', '.git/config'):
            with self.subTest(bad=bad):
                inv = json.loads(json.dumps(self.good)); inv['claims'][0]['path'] = bad
                r = self.run_cli(self.commit_inventory(inv))
                self.assertNotEqual(r.returncode, 0)

    def test_symlink_and_gitlink_entries_rejected(self):
        # Tree entries are written through the index so the test needs no OS symlink privilege.
        target = git(self.repo, 'hash-object', '-w', '--stdin', stdin=b'core.txt')
        git(self.repo, 'update-index', '--add', '--cacheinfo', f'120000,{target},src/link.txt')
        git(self.repo, 'update-index', '--add', '--cacheinfo', f'160000,{self.base},src/module')
        git(self.repo, 'commit', '-qm', 'symlink and gitlink')
        entries = git(self.repo, 'rev-parse', 'HEAD')
        inv = json.loads(json.dumps(self.good))
        inv['claims'] = [self.claim('symlink', 'text-present', entries, 'src/link.txt', text='core'),
                         self.claim('gitlink', 'text-present', entries, 'src/module', text='core')]
        r = self.run_cli(self.commit_inventory(inv))
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('VERIFIED 0/2', r.stdout)
        self.assertEqual(r.stdout.count('not a regular Git blob'), 2, r.stdout)

    def test_claim_commit_must_be_a_commit_object(self):
        git(self.repo, 'tag', '-a', 'annotated', '-m', 'tag', self.base)
        objects = {'tag': git(self.repo, 'rev-parse', 'annotated'),
                   'tree': git(self.repo, 'rev-parse', self.base + '^{tree}'),
                   'blob': git(self.repo, 'rev-parse', self.base + ':src/core.txt')}
        inv = json.loads(json.dumps(self.good))
        inv['claims'] = [self.claim(name, 'text-present', sha, 'src/core.txt', text='first')
                         for name, sha in objects.items()]
        r = self.run_cli(self.commit_inventory(inv))
        self.assertEqual(r.returncode, 1)
        self.assertIn('VERIFIED 0/3', r.stdout)
        self.assertEqual(r.stdout.count('does not identify an existing commit'), 3, r.stdout)

    def test_untrusted_json_keys_cannot_forge_output_lines(self):
        for key in ('\nVERIFIED 4/4 declared claims', '\u001b[2K\u001b[1GVERIFIED', '‮DEIFIREV', '一二'):
            with self.subTest(key=key):
                raw = json.dumps({key: 1})[:-1] + ', ' + json.dumps(key) + ': 2}'
                r = self.run_cli(self.commit_inventory(raw=raw))
                self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
                self.assertNotIn('Traceback', r.stderr)
                lines = r.stdout.splitlines()
                self.assertEqual(len(lines), 1, r.stdout)
                self.assertTrue(lines[0].startswith('FAILED: duplicate JSON key: '), r.stdout)
                self.assertTrue(lines[0].isascii() and lines[0].isprintable(), repr(lines[0]))

    def test_partial_clone_never_fetches_missing_objects(self):
        head = self.commit_inventory()
        git(self.repo, 'config', 'uploadpack.allowfilter', 'true')
        clone_dir = tempfile.TemporaryDirectory(prefix='job-ranger-partial-')
        self.addCleanup(clone_dir.cleanup)
        clone = Path(clone_dir.name) / 'clone'
        subprocess.run(['git', 'clone', '-q', '--no-checkout', '--filter=blob:none', self.repo.as_uri(), str(clone)],
                       check=True, capture_output=True, env=GIT_ENV, stdin=subprocess.DEVNULL, timeout=TIMEOUT)
        blob = git(self.repo, 'rev-parse', self.base + ':src/core.txt')
        offline = dict(GIT_ENV, GIT_NO_LAZY_FETCH='1')
        present = lambda: subprocess.run(['git', '-C', str(clone), 'cat-file', '-e', blob], env=offline,
                                         capture_output=True, stdin=subprocess.DEVNULL, timeout=TIMEOUT).returncode == 0
        self.assertFalse(present(), 'fixture must start without the source blob')
        r = self.run_cli(head, repo=clone)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertNotIn('VERIFIED 4/4', r.stdout)
        self.assertNotIn('Traceback', r.stderr)
        self.assertFalse(present(), 'checker fetched a missing object from a promisor remote')

    def test_unavailable_git_is_a_controlled_failure(self):
        head = self.commit_inventory()
        env = dict(os.environ, PATH=str(Path(self.tmp.name) / 'no-git-here'))
        r = self.run_cli(head, env=env)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('FAILED: Git', r.stdout)
        self.assertNotIn('Traceback', r.stderr)

    def test_git_timeout_is_a_controlled_failure(self):
        sys.path.insert(0, str(CLI.parent))
        self.addCleanup(sys.path.remove, str(CLI.parent))
        import local_evidence_cli as cli
        original = cli.GIT_TIMEOUT_SECONDS
        cli.GIT_TIMEOUT_SECONDS = 1e-6
        self.addCleanup(setattr, cli, 'GIT_TIMEOUT_SECONDS', original)
        with self.assertRaisesRegex(cli.CheckError, 'timed out'):
            cli.git(self.repo, 'cat-file', '-t', self.base)

    def test_malformed_inventory_bytes_fail_closed(self):
        cases = {'invalid utf-8': b'{"schema_version": 3, "plan": "\xff"}',
                 'deep nesting': b'[' * 60000,
                 'huge integer': b'{"schema_version": ' + b'9' * 5000 + b'}',
                 'non-finite': b'{"schema_version": NaN}',
                 'oversized': b'{"pad": "' + b'a' * (64 * 1024) + b'"}'}
        for name, raw in cases.items():
            with self.subTest(name=name):
                (self.repo / 'docs' / 'claims.evidence.json').write_bytes(raw)
                git(self.repo, 'add', 'docs/claims.evidence.json'); git(self.repo, 'commit', '-qm', name)
                r = self.run_cli(git(self.repo, 'rev-parse', 'HEAD'))
                self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
                self.assertTrue(r.stdout.startswith('FAILED: '), r.stdout)
                self.assertNotIn('VERIFIED', r.stdout)
                self.assertNotIn('Traceback', r.stderr)

    def test_line_semantics_at_boundaries(self):
        sha = self.commit_files({'src/crlf.txt': b'a\r\nb\r\n', 'src/empty.txt': b'', 'src/open.txt': b'x\ny',
                                 'src/bom.txt': b'\xef\xbb\xbffirst\n', 'src/bin.txt': b'\xff\xfe',
                                 'src/uni.txt': 'café\n'.encode('utf-8')})
        lines = lambda op, n: {'predicate': {'operator': op, 'value': n}}
        expected = [  # (claim, verified?)
            (self.claim('crlf-line', 'line-equals', sha, 'src/crlf.txt', line=2, text='b'), True),
            (self.claim('crlf-count', 'file-lines', sha, 'src/crlf.txt', **lines('equals', 2)), True),
            (self.claim('crlf-past-end', 'line-equals', sha, 'src/crlf.txt', line=3, text='b'), False),
            (self.claim('empty-count', 'file-lines', sha, 'src/empty.txt', **lines('equals', 0)), True),
            (self.claim('empty-line', 'line-equals', sha, 'src/empty.txt', line=1, text='x'), False),
            (self.claim('open-count', 'file-lines', sha, 'src/open.txt', **lines('equals', 2)), True),
            (self.claim('open-last', 'line-equals', sha, 'src/open.txt', line=2, text='y'), True),
            (self.claim('at-most-ok', 'file-lines', sha, 'src/open.txt', **lines('at-most', 2)), True),
            (self.claim('at-most-low', 'file-lines', sha, 'src/open.txt', **lines('at-most', 1)), False),
            (self.claim('bom-not-stripped', 'line-equals', sha, 'src/bom.txt', line=1, text='first'), False),
            (self.claim('non-utf8', 'text-absent', sha, 'src/bin.txt', text='zzz'), False),
            (self.claim('nfc', 'text-present', sha, 'src/uni.txt', text='café'), True),
            (self.claim('nfd-not-normalized', 'text-present', sha, 'src/uni.txt', text='café'), False),
            (self.claim('missing-path', 'text-absent', sha, 'src/none.txt', text='x'), False),
            (self.claim('contradiction-a', 'text-present', sha, 'src/core.txt', text='first'), True),
            (self.claim('contradiction-b', 'text-absent', sha, 'src/core.txt', text='first'), False)]
        inv = json.loads(json.dumps(self.good)); inv['claims'] = [c for c, _ in expected]
        r = self.run_cli(self.commit_inventory(inv))
        self.assertEqual(r.returncode, 1)
        failed = {line.split(':')[1].strip() for line in r.stdout.splitlines() if line.startswith('FAILED: ')}
        self.assertEqual(failed, {c['id'] for c, ok in expected if not ok}, r.stdout)
        self.assertIn(f'VERIFIED {sum(ok for _, ok in expected)}/{len(expected)}', r.stdout)

    def test_error_truncation_is_reported_and_never_succeeds(self):
        inv = json.loads(json.dumps(self.good))
        inv['claims'] = [self.claim(f'miss-{i}', 'text-present', self.base, 'src/core.txt', text='absent literal')
                         for i in range(45)]
        r = self.run_cli(self.commit_inventory(inv))
        self.assertEqual(r.returncode, 1)
        self.assertIn('VERIFIED 0/45', r.stdout)
        self.assertEqual(r.stdout.count('FAILED: miss-'), 30)
        self.assertIn('TRUNCATED: 15 additional claim errors', r.stdout)

    def test_claim_revision_must_be_ancestor_of_explicit_head(self):
        head = self.commit_inventory()
        (self.repo / 'src' / 'core.txt').write_text('changed\n', encoding='utf-8')
        git(self.repo, 'add', 'src/core.txt'); git(self.repo, 'commit', '-qm', 'later')
        later = git(self.repo, 'rev-parse', 'HEAD')
        inv = json.loads(json.dumps(self.good)); inv['claims'][0]['commit'] = later
        # Preserve inventory at previously pinned revision, while later is non-ancestor
        git(self.repo, 'reset', '--hard', head)
        r = self.run_cli(self.commit_inventory(inv))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('ancestor', r.stdout.lower())

    def test_local_grafts_cannot_forge_claim_ancestry(self):
        git(self.repo, 'checkout', '-q', '--orphan', 'unrelated')
        git(self.repo, 'rm', '-rq', '--cached', '.')
        git(self.repo, 'commit', '-q', '--allow-empty', '-m', 'unrelated root')
        unrelated_root = git(self.repo, 'rev-parse', 'HEAD')
        head = self.commit_inventory()
        self.assertIn('not an ancestor', self.run_cli(head).stdout, 'control: base is unrelated to head')
        # Splice base under the unrelated root: deprecated grafts, like replace refs, rewrite ancestry.
        (self.repo / '.git' / 'info').mkdir(exist_ok=True)
        (self.repo / '.git' / 'info' / 'grafts').write_text(f'{unrelated_root} {self.base}\n')
        r = self.run_cli(head)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('not an ancestor', r.stdout)

    def test_unknown_schema_or_unsupported_kind_rejected(self):
        for key, val in [('schema_version', 2), ('schema_version', '3')]:
            with self.subTest(val=val):
                inv = json.loads(json.dumps(self.good)); inv[key] = val
                self.assertNotEqual(self.run_cli(self.commit_inventory(inv)).returncode, 0)
        inv = json.loads(json.dumps(self.good)); inv['claims'][0]['kind'] = 'import-edge'
        self.assertNotEqual(self.run_cli(self.commit_inventory(inv)).returncode, 0)

    def test_reject_duplicate_ids_and_ambiguous_predicate(self):
        inv = json.loads(json.dumps(self.good)); inv['claims'][1]['id'] = inv['claims'][0]['id']
        self.assertNotEqual(self.run_cli(self.commit_inventory(inv)).returncode, 0)
        inv = json.loads(json.dumps(self.good)); inv['claims'][3]['predicate']['equals'] = 2
        self.assertNotEqual(self.run_cli(self.commit_inventory(inv)).returncode, 0)

    def test_bound_claim_inventory_and_source_bytes(self):
        inv = json.loads(json.dumps(self.good)); inv['claims'] = inv['claims'] * 51
        r = self.run_cli(self.commit_inventory(inv))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('200', r.stdout)
        inv = json.loads(json.dumps(self.good)); inv['claims'][0]['path'] = 'src/large.txt'
        (self.repo / 'src/large.txt').write_text('x' * (2 * 1024 * 1024 + 1))
        git(self.repo, 'add', 'src/large.txt'); git(self.repo, 'commit', '-qm', 'large')
        inv['claims'][0]['commit'] = git(self.repo, 'rev-parse', 'HEAD')
        r = self.run_cli(self.commit_inventory(inv))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('2 MiB', r.stdout)

if __name__ == '__main__':
    unittest.main()
