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
from unittest import mock


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
        self.assertEqual(result["confirmation"], "pending")
        self.assertEqual((self.root / "data/stockanalysis/a.json").read_text(), '{"value":2}\n')
        run("git", "add", "--", "data/stockanalysis", cwd=self.root)
        self.helper.audit_staged_paths(self.root, self.artifact)

    def test_source_growth_after_hash_fails_pack_with_path_and_sizes(self) -> None:
        target = self.candidate / "data/stockanalysis/a.json"
        target.write_text('{"value":2}\n')
        original_sha256_file = self.helper.sha256_file
        grew = False

        def hash_then_grow(path: Path) -> str:
            nonlocal grew
            digest = original_sha256_file(path)
            if path == target and not grew:
                with path.open("ab") as handle:
                    handle.write(b'{"late":1}\n')
                grew = True
            return digest

        with mock.patch.object(self.helper, "sha256_file", side_effect=hash_then_grow):
            with self.assertRaisesRegex(
                ValueError,
                (
                    "artifact source changed after initial hash and before copy: "
                    "data/stockanalysis/a.json; size_at_hash=12; size_before_copy=23"
                ),
            ):
                self.pack()
        self.assertFalse((self.artifact / "manifest.json").exists())

    def test_hash_before_copy_mutant_recreates_self_inconsistent_artifact(self) -> None:
        target = self.candidate / "data/stockanalysis/a.json"
        target.write_text('{"value":2}\n')
        original_sha256_file = self.helper.sha256_file
        grew = False

        def hash_then_grow(path: Path) -> str:
            nonlocal grew
            digest = original_sha256_file(path)
            if path == target and not grew:
                with path.open("ab") as handle:
                    handle.write(b'{"late":1}\n')
                grew = True
            return digest

        def unsafe_hash_before_copy(
            *,
            source: Path,
            target: Path,
            rel: str,
            size_at_hash: int,
            digest_at_hash: str,
            mtime_ns_at_hash: int,
            inode_at_hash: int,
        ) -> tuple[int, str, int, int, int]:
            del rel, size_at_hash, mtime_ns_at_hash, inode_at_hash
            target.parent.mkdir(parents=True, exist_ok=True)
            self.helper.shutil.copy2(source, target)
            copied_source = source.stat()
            return (
                copied_source.st_size,
                digest_at_hash,
                copied_source.st_size,
                copied_source.st_mtime_ns,
                copied_source.st_ino,
            )

        with (
            mock.patch.object(self.helper, "sha256_file", side_effect=hash_then_grow),
            mock.patch.object(
                self.helper,
                "copy_file_consistently",
                side_effect=unsafe_hash_before_copy,
            ),
        ):
            manifest = self.pack()

        row = manifest["files"][0]
        packed = self.artifact / "files" / row["path"]
        self.assertNotEqual(row["sha256"], original_sha256_file(packed))
        with self.assertRaisesRegex(
            ValueError,
            "artifact hash or size mismatch: data/stockanalysis/a.json",
        ):
            self.apply()
        print("mutation hash-before-copy: pack_succeeded=true manifest_matches_payload=false")

    def test_source_growth_after_copy_fails_before_manifest(self) -> None:
        target = self.candidate / "data/stockanalysis/a.json"
        target.write_text('{"value":2}\n')
        original_copy = self.helper.copy_file_consistently
        grew = False

        def copy_then_grow(**kwargs):
            nonlocal grew
            result = original_copy(**kwargs)
            if kwargs["source"] == target and not grew:
                with target.open("ab") as handle:
                    handle.write(b'{"late":1}\n')
                grew = True
            return result

        with mock.patch.object(
            self.helper,
            "copy_file_consistently",
            side_effect=copy_then_grow,
        ):
            with self.assertRaisesRegex(
                ValueError,
                (
                    "artifact source changed after copy and before manifest: "
                    "data/stockanalysis/a.json; size_after_copy=12; "
                    "size_before_manifest=23"
                ),
            ):
                self.pack()

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

    def test_public_mirror_tree_is_ignored_by_construction_and_fails_closed_on_extraction(self) -> None:
        public_dir = self.root / "100xfenok-next/public/data"
        public_dir.mkdir(parents=True)
        (public_dir / ".gitkeep").write_text("placeholder\n")
        computed_dir = public_dir / "computed"
        computed_dir.mkdir()
        (computed_dir / "signals.json").write_text('{"mirror":true}\n')
        manifest_path = self.root / "data/admin/lane-commit-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["workflows"][WORKFLOW]["stages"]["always_if_exists"].append(
            {"kind": "directory", "path": "100xfenok-next/public/data", "required": False}
        )
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        run(
            "git", "add", "--",
            "100xfenok-next/public/data", "data/admin/lane-commit-manifest.json",
            cwd=self.root,
        )
        run("git", "commit", "-qm", "add public mirror tree", cwd=self.root)
        self.base = run("git", "rev-parse", "HEAD", cwd=self.root)

        self.helper.seed_candidate(self.root, self.candidate, WORKFLOW, replace=True)
        (self.candidate / "data/stockanalysis/a.json").write_text('{"value":2}\n')
        packed = self.pack()

        self.assertEqual(packed["paths"], ["data/stockanalysis/a.json"])
        self.assertFalse((self.candidate / "100xfenok-next/public").exists())
        self.assertFalse((self.artifact / "files/100xfenok-next/public/data/.gitkeep").exists())
        self.assertFalse((self.artifact / "files/100xfenok-next/public/data/computed/signals.json").exists())
        self.assertEqual(self.apply()["status"], "applied")

        artifact_manifest = json.loads((self.artifact / "manifest.json").read_text())
        injected = "100xfenok-next/public/data/.gitkeep"
        artifact_manifest["paths"].append(injected)
        artifact_manifest["files"].append({"path": injected, "sha256": "0" * 64, "size": 0})
        artifact_manifest["file_count"] += 1
        (self.artifact / "manifest.json").write_text(json.dumps(artifact_manifest))
        payload = self.artifact / "files" / injected
        payload.parent.mkdir(parents=True)
        payload.write_text("x")
        with self.assertRaisesRegex(ValueError, "public path is forbidden"):
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
        self.assertEqual(result["confirmation"], "not_confirmed")
        self.assertEqual(target.read_bytes(), before)

    def test_post_publish_readback_confirms_current_etf_detail_success_attempt(self) -> None:
        shard_path = self.root / "data/admin/data-supply-state/detection-attempts/stockanalysis_etf_detail.json"
        shard_path.parent.mkdir(parents=True, exist_ok=True)
        shard_path.write_text(json.dumps({
            "schema_version": "data-supply-detection-attempt-shard/v2",
            "lane_id": "stockanalysis_etf_detail",
            "attempts": [{
                "lane_id": "stockanalysis_etf_detail",
                "member_id": None,
                "attempt_id": "stockanalysis-etf_detail-1000-1",
                "observed_at": "2026-08-14T13:00:44Z",
                "execution": "returned",
                "exception_kind": None,
                "http_status": None,
                "auth": "not_applicable",
                "rate_limited": False,
                "decode": "ok",
                "payload": "non_empty",
                "assertions": [
                    {"id": "etf_detail_requested", "passed": True},
                    {"id": "etf_detail_written", "passed": True},
                    {"id": "etf_detail_failed", "passed": True},
                ],
                "candidates": 1,
                "retry_count": 0,
                "latency_ms": 577118,
                "outcome": "success",
            }],
        }, indent=2) + "\n")

        result = self.helper.verify_etf_detail_attempt(
            repo_root=self.root,
            run_id="1000",
            run_attempt=1,
        )
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["confirmation"], "confirmed")
        self.assertEqual(result["attempt_id"], "stockanalysis-etf_detail-1000-1")

        shard = json.loads(shard_path.read_text())
        shard["attempts"][0]["attempt_id"] = "stockanalysis-etf_detail-999-1"
        shard_path.write_text(json.dumps(shard))
        with self.assertRaisesRegex(ValueError, "current ETF detail attempt"):
            self.helper.verify_etf_detail_attempt(
                repo_root=self.root,
                run_id="1000",
                run_attempt=1,
            )

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
