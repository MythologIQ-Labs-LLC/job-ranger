# Local evidence checker research spike (#267)

**Status:** optional, unmerged, local-only technical experiment. NOT a Qor gate, PR status check, approved design, release feature, or remediation closure.

## Scope

The Python standard-library verifier reads one typed v3 evidence inventory from an immutable Git commit selected by an explicit full lowercase 40-character `--head` argument. Claims identify an exact committed path and a full ancestor commit. The tool checks only four supported forms: `line-equals`, literal `text-present`, literal `text-absent`, and whole `file-lines` with explicit `equals`/`at-most`. It does **not** read working-tree inventory bytes, load PR-authored scripts, resolve mutable refs, run a plan's commands, inspect arbitrary prose, parse Markdown, decide PR applicability, produce GitHub checks, or attest user approval.

Unknown claim kinds (`function-lines`, `import-edge`, `enum-values`, `test-outcome`), executable fields (`argv`, `command`, `setup`), duplicate JSON keys, extra fields, symlinks, traversal paths, oversized blobs and non-ancestor refs are rejected. A locally verified literal is not proof that a plan is truthful or complete. Judgment records are counted as NOT CHECKED. The checker never grants permissions or changes a checkout.

## Usage

From a **local checkout**, supply an actual committed v3 JSON evidence file. Do not use the literal `HEAD` argument:

```sh
SHA=$(git rev-parse HEAD)
python scripts/local_evidence_cli.py --repo . --head "$SHA" --inventory docs/example.evidence.json
```

Example data (placeholder SHA, not a factual repository claim):

```json
{
  "schema_version": 3,
  "plan": "docs/plan-qor-phase18-example.md",
  "claims": [
    {
      "id": "example-text",
      "kind": "text-present",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "path": "docs/README.md",
      "text": "Job Ranger",
      "purpose": "Illustrative exact source text check"
    }
  ],
  "judgments": []
}
```

## Local validation

```sh
python -m unittest discover -s tests -p 'test_local_evidence_cli.py' -v
```

The first 12 adversarial test methods passed together in a local temporary-Git-repository fixture. A subsequent thirteenth test, covering non-string claim kinds, passed separately after a bounded input-handling correction. A later attempt to rerun the full 13-method suite did not finish in the current runner's allotted execution time, so **do not claim a single exact-head 13/13 run**. The affected source and tests can be independently rerun on a development workstation. No hosted CI runs were requested.

GitHub blob hashes were verified against locally tested source for the initial 12-test version (`032f7a0d7c7c631e1e8ecf12424215be60c5dff9`, test blob `9dd2f7e5655c08aaa49c94f07467cce9185670b7`). The latest one-line source guard and additional test require an exact-head combined re-run.

Uses Python 3.10+ and Git, no installed `markdown-it-py` or `mdurl` and no network access. These previously approved parser dependencies remain available to a future independently authorized governance design, but **are not necessary** to check local typed source facts.

## Not solved

Phase 18 VETO #114 remains binding: the proposed PR gate had a multiple-merge-base applicability bypass (F1), Git mode/type changes not handled (F1b), corpus conversion gaps (F2), and filename-rule drift (F3). A local CLI deliberately makes **no PR applicability claims** and does not address those vetoes. Do not wire this code to Actions or mark D1, D2, D3 complete. Phase 17 VETO #108, both pending shadow events, PRs #232/#233/#238 and WWR HOLD remain unchanged.

Before merge or governance use, obtain a fresh independent code/security review and run the exact branch tests from a complete checkout. This spike was not emitted or accepted by the Qor governance runtime.
