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

def git(repo: Path, *args: str) -> str:
    p = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, check=True)
    return p.stdout.strip()

class LocalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='job-ranger-evidence-')
        self.repo = Path(self.tmp.name)
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'config', 'user.email', 'test@example.invalid')
        (self.repo / 'src').mkdir()
        (self.repo / 'docs').mkdir()
        (self.repo / 'src' / 'core.txt').write_text('first\nsecond\n', encoding='utf-8')
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

    def run_cli(self, sha, path='docs/claims.evidence.json'):
        return subprocess.run([sys.executable, str(CLI), '--repo', str(self.repo), '--head', sha,
                               '--inventory', path], capture_output=True, text=True)

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

    def test_symlink_source_blob_rejected(self):
        (self.repo / 'src' / 'link.txt').symlink_to('core.txt')
        git(self.repo, 'add', 'src/link.txt')
        git(self.repo, 'commit', '-qm', 'symlink')
        link_sha = git(self.repo, 'rev-parse', 'HEAD')
        inv = json.loads(json.dumps(self.good)); inv['claims'][0]['path'] = 'src/link.txt'
        inv['claims'][0]['commit'] = link_sha
        r = self.run_cli(self.commit_inventory(inv))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('regular', r.stdout.lower())

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
