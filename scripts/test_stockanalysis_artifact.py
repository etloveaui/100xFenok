#!/usr/bin/env python3
"""Safety contracts for the StockAnalysis acquire/publish artifact boundary."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts" / "stockanalysis_artifact.py"
WORKFLOW = ".github/workflows/fetch-stockanalysis.yml"


def load_helper():
    spec = importlib.util.spec_from_file_location("stockanalysis_artifact", HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load helper from {HELPER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(*args: str, cwd: Path) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


class StockAnalysisArtifactTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.helper = load_helper()

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()
        (self.root / "data/admin").mkdir(parents=True)
        (self.root / "data/admin/data-supply-state").mkdir(parents=True)
        (self.root / "data/admin/data-supply-state/state.json").write_text('{"state":1}\n')
        (self.root / "data/stockanalysis").mkdir(parents=True)
        (self.root / "data/stockanalysis/a.json").write_text('{"value":1}\n')
        (self.root / "data/admin/lane-commit-manifest.json").write_text(
            json.dumps({
                "schema_version": "lane-commit-manifest/v1",
                "workflows": {
                    WORKFLOW: {
                        "exclude": [{"kind": "file", "path": "data/stockanalysis/excluded.json", "required": False}],
                        "lanes": ["stockanalysis_etf_universe"],
                        "stages": {
                            "always_if_exists": [
                                {"kind": "directory", "path": "data/stockanalysis", "required": True},
                                {"kind": "directory", "path": "data/admin/data-supply-state", "required": True},
                            ],
                            "required_on_success": [],
                            "success_if_exists": [],
                            "success_verify_not_plan_if_exists": [],
                        },
                    },
                },
            }, indent=2) + "\n"
        )
        run("git", "init", "-q", cwd=self.root)
        run("git", "config", "user.email", "artifact@example.test", cwd=self.root)
        run("git", "config", "user.name", "Artifact Test", cwd=self.root)
        run("git", "add", ".", cwd=self.root)
        run("git", "commit", "-qm", "base", cwd=self.root)
        self.base = run("git", "rev-parse", "HEAD", cwd=self.root)
        self.candidate = Path(self.tmp.name) / "candidate"
        self.artifact = Path(self.tmp.name) / "artifact"
        self.helper.seed_candidate(self.root, self.candidate, WORKFLOW)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def pack(self, *, run_number: int = 10, run_attempt: int = 1):
        return self.helper.pack_artifact(
            repo_root=self.root,
            candidate_root=self.candidate,
            artifact_root=self.artifact,
            workflow=WORKFLOW,
            base_sha=self.base,
            run_id="1000",
            run_number=run_number,
            run_attempt=run_attempt,
            artifact_name=f"stockanalysis-1000-{run_attempt}",
        )

    def apply(self, *, run_number: int = 10, run_attempt: int = 1, replace_fn=os.replace):
        return self.helper.apply_artifact(
            repo_root=self.root,
            artifact_root=self.artifact,
            workflow=WORKFLOW,
            run_id="1000",
            run_number=run_number,
            run_attempt=run_attempt,
            artifact_name=f"stockanalysis-1000-{run_attempt}",
            artifact_digest="a" * 64,
            replace_fn=replace_fn,
        )

    def test_fresh_apply_and_exact_stage_audit(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        manifest = self.pack()
        self.assertEqual(manifest["paths"], ["data/stockanalysis/a.json"])
        result = self.apply()
        self.assertEqual(result["status"], "applied")
        self.assertEqual((self.root / "data/stockanalysis/a.json").read_text(), '{"value":2}\n')
        run("git", "add", "--", "data/stockanalysis", cwd=self.root)
        self.helper.audit_staged_paths(self.root, self.artifact)

    def test_runtime_lock_files_are_not_artifact_payload(self) -> None:
        repo_lock = self.root / "data/admin/data-supply-state/v1/domains/stock_detail/.lock"
        candidate_lock = self.candidate / "data/admin/data-supply-state/v1/domains/stock_detail/.lock"
        entity_lock = self.candidate / "data/admin/data-supply-state/v1/providers/stockanalysis/stock_detail/.locks/AAPL.lock"
        repo_lock.parent.mkdir(parents=True)
        candidate_lock.parent.mkdir(parents=True)
        repo_lock.write_text("repo-lock\n")
        candidate_lock.write_text("candidate-lock\n")
        entity_lock.parent.mkdir(parents=True)
        entity_lock.write_text("entity-lock\n")
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')

        manifest = self.pack()

        self.assertEqual(manifest["paths"], ["data/stockanalysis/a.json"])
        self.assertFalse((self.artifact / "files/data/admin/data-supply-state/v1/domains/stock_detail/.lock").exists())
        self.assertFalse((self.artifact / "files/data/admin/data-supply-state/v1/providers/stockanalysis/stock_detail/.locks/AAPL.lock").exists())
        self.assertEqual(self.apply()["status"], "applied")

        manifest_path = self.artifact / "manifest.json"
        tampered = json.loads(manifest_path.read_text())
        lock_rel = "data/admin/data-supply-state/v1/domains/stock_detail/.lock"
        tampered["paths"].append(lock_rel)
        tampered["files"].append({"path": lock_rel, "sha256": "0" * 64, "size": 0})
        tampered["file_count"] += 1
        manifest_path.write_text(json.dumps(tampered))
        with self.assertRaisesRegex(ValueError, "runtime lock"):
            self.apply()

    def test_stage_audit_rejects_same_path_with_different_staged_bytes(self) -> None:
        target = self.candidate / "data/stockanalysis/a.json"
        target.write_text('{"value":2}\n')
        self.pack()
        self.apply()
        staged_target = self.root / "data/stockanalysis/a.json"
        staged_target.write_text('{"value":999}\n')
        run("git", "add", "--", "data/stockanalysis/a.json", cwd=self.root)
        with self.assertRaisesRegex(ValueError, "staged blob does not exactly match"):
            self.helper.audit_staged_paths(self.root, self.artifact)

    def test_candidate_and_artifact_roots_reject_repository_ancestors(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            self.helper.seed_candidate(self.root, self.root.parent, WORKFLOW)
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            self.helper.pack_artifact(
                repo_root=self.root,
                candidate_root=self.candidate,
                artifact_root=self.root.parent,
                workflow=WORKFLOW,
                base_sha=self.base,
                run_id="1000",
                run_number=10,
                run_attempt=1,
                artifact_name="stockanalysis-1000-1",
            )

    def test_disjoint_main_change_is_allowed(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        self.pack()
        (self.root / "unrelated.txt").write_text("new\n")
        run("git", "add", "unrelated.txt", cwd=self.root)
        run("git", "commit", "-qm", "unrelated", cwd=self.root)
        self.assertEqual(self.apply()["status"], "applied")

    def test_overlap_and_change_then_revert_are_rejected_without_mutation(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        self.pack()
        target = self.root / "data/stockanalysis/a.json"
        target.write_text('{"value":9}\n')
        run("git", "add", "data/stockanalysis/a.json", cwd=self.root)
        run("git", "commit", "-qm", "newer", cwd=self.root)
        target.write_text('{"value":1}\n')
        run("git", "add", "data/stockanalysis/a.json", cwd=self.root)
        run("git", "commit", "-qm", "revert bytes", cwd=self.root)
        before = target.read_bytes()
        result = self.apply()
        self.assertEqual(result["status"], "stale")
        self.assertEqual(target.read_bytes(), before)

    def test_newer_publish_trailer_rejects_older_artifact_lane_wide(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        self.pack(run_number=10)
        (self.root / "unrelated.txt").write_text("published\n")
        run("git", "add", "unrelated.txt", cwd=self.root)
        run(
            "git", "commit", "-qm",
            "publish\n\nStockAnalysis-Run-Number: 11\nStockAnalysis-Run-Attempt: 1\nStockAnalysis-Run-ID: 1100",
            cwd=self.root,
        )
        result = self.apply(run_number=10)
        self.assertEqual(result["status"], "stale")
        self.assertIn("newer accepted publish", result["reason"])

    def test_newer_no_change_acceptance_marker_rejects_older_artifact(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        self.pack(run_number=10)
        run(
            "git", "commit", "--allow-empty", "-qm",
            "no-change marker\n\nStockAnalysis-Run-Number: 11\n"
            "StockAnalysis-Run-Attempt: 1\nStockAnalysis-Run-ID: 1100\n"
            f"StockAnalysis-Artifact-Digest: {'b' * 64}",
            cwd=self.root,
        )
        result = self.apply(run_number=10)
        self.assertEqual(result["status"], "stale")
        self.assertIn("newer accepted publish 11/1", result["reason"])

    def test_context_hash_and_duplicate_path_tampering_fail_closed(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        self.pack()
        manifest_path = self.artifact / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["run_id"] = "wrong"
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "run_id"):
            self.apply()

        # Repack cleanly and make two spellings normalize to the same leaf.
        import shutil
        shutil.rmtree(self.artifact)
        self.pack()
        manifest = json.loads(manifest_path.read_text())
        manifest["files"].append({**manifest["files"][0], "path": "data/stockanalysis/./a.json"})
        manifest["paths"].append("data/stockanalysis/./a.json")
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "normalized|duplicate"):
            self.apply()

    def test_archive_entry_types_limits_public_excluded_and_deletion_are_rejected(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        (self.candidate / "data/stockanalysis/excluded.json").write_text("{}\n")
        with self.assertRaisesRegex(ValueError, "excluded"):
            self.pack()

        (self.candidate / "data/stockanalysis/excluded.json").unlink()
        (self.candidate / "data/stockanalysis/a.json").unlink()
        with self.assertRaisesRegex(ValueError, "deletion"):
            self.pack()

        self.helper.seed_candidate(self.root, self.candidate, WORKFLOW, replace=True)
        link = self.candidate / "data/stockanalysis/link.json"
        link.symlink_to("a.json")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.pack()

        link.unlink()
        fifo = self.candidate / "data/stockanalysis/fifo"
        os.mkfifo(fifo)
        self.assertTrue(stat.S_ISFIFO(fifo.lstat().st_mode))
        with self.assertRaisesRegex(ValueError, "regular"):
            self.pack()

    def test_hardlink_target_symlink_digest_and_size_limit_fail_closed(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        hardlink = self.candidate / "data/stockanalysis/hardlink.json"
        os.link(self.candidate / "data/stockanalysis/a.json", hardlink)
        with self.assertRaisesRegex(ValueError, "hardlink"):
            self.pack()
        hardlink.unlink()
        self.pack()

        with self.assertRaisesRegex(ValueError, "digest"):
            self.helper.apply_artifact(
                repo_root=self.root,
                artifact_root=self.artifact,
                workflow=WORKFLOW,
                run_id="1000",
                run_number=10,
                run_attempt=1,
                artifact_name="stockanalysis-1000-1",
                artifact_digest="not-a-digest",
            )

        target = self.root / "data/stockanalysis/a.json"
        target.unlink()
        target.symlink_to("elsewhere.json")
        with self.assertRaisesRegex(ValueError, "target symlink"):
            self.apply()
        target.unlink()
        target.write_text('{"value":1}\n')

        original_limit = self.helper.MAX_TOTAL_BYTES
        self.helper.MAX_TOTAL_BYTES = 0
        try:
            with self.assertRaisesRegex(ValueError, "size"):
                self.apply()
        finally:
            self.helper.MAX_TOTAL_BYTES = original_limit

    def test_non_ancestor_base_and_injected_apply_failure_restore_exactly(self) -> None:
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        (self.candidate / "data/stockanalysis/b.json").write_text('{"value":3}\n')
        self.pack()
        before = (self.root / "data/stockanalysis/a.json").read_bytes()
        calls = 0

        def fail_second(src, dst):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("injected apply failure")
            os.replace(src, dst)

        with self.assertRaisesRegex(OSError, "injected"):
            self.apply(replace_fn=fail_second)
        self.assertEqual((self.root / "data/stockanalysis/a.json").read_bytes(), before)
        self.assertFalse((self.root / "data/stockanalysis/b.json").exists())

        manifest_path = self.artifact / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["base_sha"] = "0" * 40
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "base"):
            self.apply()


if __name__ == "__main__":
    unittest.main()
