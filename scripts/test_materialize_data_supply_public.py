#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import canonical_json_bytes, canonical_sha256
from materialize_data_supply_public import (
    ENROLLMENT_SCHEMA,
    INDEX_SCHEMA,
    MaterializationError,
    PublicDataSupplyMaterializer,
    SELECTED_ENTRY_KEYS,
    UNAVAILABLE_ENTRY_KEYS,
    index_content_sha256,
)


def pretty_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


class CountingStateReader:
    def __init__(self, active: dict):
        self.active = active
        self.calls = 0

    def read_active_domain(self, domain: str) -> dict:
        self.calls += 1
        if domain != "etf_detail":
            raise AssertionError(domain)
        return copy.deepcopy(self.active)


class MaterializerFixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="r2-4-materializer-")
        self.repo = Path(self.temp.name)
        self.state_root = self.repo / "data/admin/data-supply-state/v1"
        self.canonical_root = self.repo / "data/computed/data-supply/etf-detail"
        self.public_data_root = self.repo / "100xfenok-next/public/data"
        self.transaction_id = "1" * 64
        self.manifest_sha = "2" * 64
        self.payloads: dict[str, bytes] = {}
        self.current: dict[str, dict] = {}
        self.recovery: dict[str, dict] = {}
        self._seed_selection("FRESH", "fresh_fallback", "provider_object", "2026-07-10T00:00:00Z")
        self._seed_selection("LKG", "lkg_fallback", "provider_lkg", "2026-07-01T00:00:00Z")
        self.recovery["UNAV"] = {"consecutive_green": 0, "last_transition": "unavailable"}
        self._write_state_files()
        self._write_clean_usage_manifests()
        self._git_init_and_add()

    def close(self):
        self.temp.cleanup()

    @property
    def tickers(self) -> list[str]:
        return sorted(self.recovery)

    @property
    def membership_sha(self) -> str:
        return canonical_sha256(self.tickers)

    @property
    def active(self) -> dict:
        return {
            "transaction_id": self.transaction_id,
            "manifest_sha256": self.manifest_sha,
            "current": copy.deepcopy(self.current),
            "lkg": {},
            "recovery": copy.deepcopy(self.recovery),
            "decision": {},
            "manifest": {},
            "retained_generation_ids": [self.transaction_id],
        }

    def materializer(self, *, failpoint=None, require_git_tracking=True):
        reader = CountingStateReader(self.active)
        materializer = PublicDataSupplyMaterializer(
            repo_root=self.repo,
            state_reader=reader,
            expected_enrollment_count=len(self.tickers),
            expected_membership_sha256=self.membership_sha,
            failpoint=failpoint,
            require_git_tracking=require_git_tracking,
        )
        return materializer, reader

    def _seed_selection(self, ticker: str, state: str, ref_kind: str, source_as_of: str):
        payload = {
            "schema_version": "yf-etf-detail/v1",
            "ticker": ticker,
            "asset_type": "etf",
            "source_provider": "yahoo_finance",
            "detail_status": "yf_fallback",
            "source_as_of": source_as_of,
            "fetched_at": source_as_of,
            "normalized": {"history_periods": {"daily_1y": [{"date": "2026-01-02", "close": 10.0}]}},
            "raw": {"fixture": True},
        }
        body = pretty_bytes(payload)
        sha = hashlib.sha256(body).hexdigest()
        if ref_kind == "provider_lkg":
            rel = f"providers/yahoo_finance/etf_detail/lkg/{ticker}/objects/{sha}.json"
        else:
            rel = f"providers/yahoo_finance/etf_detail/objects/{ticker}/{sha}.json"
        target = self.state_root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        self.payloads[ticker] = body
        self.current[ticker] = {
            "schema_version": "data-supply-selection/v1",
            "domain": "etf_detail",
            "entity": ticker,
            "provider": "yahoo_finance",
            "provider_path": f"data/yf/etf-details/{ticker}.json",
            "provider_schema": "yf-etf-detail/v1",
            "payload_sha256": sha,
            "payload_ref": {"kind": ref_kind, "path": rel, "sha256": sha},
            "source_as_of": source_as_of,
            "observed_at": "2026-07-11T00:00:00Z",
            "selected_at": "2026-07-11T00:00:00Z",
            "resolution_state": state,
            "reason_code": f"fixture_{state}",
            "fallback_depth": 2,
            "age_seconds": 0,
        }
        self.recovery[ticker] = {"consecutive_green": 0, "last_transition": f"fixture_{state}"}

    def _write_state_files(self):
        domain = self.state_root / "domains/etf_detail"
        generation = domain / "generations" / self.transaction_id
        generation.mkdir(parents=True, exist_ok=True)
        (domain / "active.json").write_bytes(pretty_bytes({
            "schema_version": "data-supply-active/v1",
            "domain": "etf_detail",
            "transaction_id": self.transaction_id,
            "generation_manifest_sha256": self.manifest_sha,
            "decision": {},
            "retained_generation_ids": [self.transaction_id],
        }))
        for name, payload in {
            "manifest": {},
            "current": self.current,
            "lkg": {},
            "recovery": self.recovery,
            "decision": {},
        }.items():
            (generation / f"{name}.json").write_bytes(pretty_bytes(payload))

    def _write_clean_usage_manifests(self):
        for path in (
            self.repo / "data/admin/data-usage-manifest.json",
            self.public_data_root / "admin/data-usage-manifest.json",
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(pretty_bytes({"schema_version": "fixture/v1", "paths": ["computed/safe.json"]}))

    def _git_init_and_add(self):
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        subprocess.run(["git", "add", "data/admin/data-supply-state", "data/admin/data-usage-manifest.json"], cwd=self.repo, check=True)

    def copy_projection_public(self):
        target = self.public_data_root / "computed/data-supply/etf-detail"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.canonical_root, target)

    def seed_stockanalysis_reconcile(self):
        root = self.repo / "data/stockanalysis/etfs"
        public = self.public_data_root / "stockanalysis/etfs"
        root.mkdir(parents=True, exist_ok=True)
        public.mkdir(parents=True, exist_ok=True)
        primary = pretty_bytes({
            "schema_version": "stockanalysis/v1",
            "ticker": "IEFA",
            "asset_type": "etf",
            "source": "stockanalysis",
        })
        (root / "IEFA.json").write_bytes(primary)
        (public / "IEFA.json").write_bytes(primary)
        for ticker in self.tickers:
            legacy = pretty_bytes({
                "schema_version": "stockanalysis/v1",
                "ticker": ticker,
                "asset_type": "etf",
                "source": "yahoo_finance",
                "source_provider": "yahoo_finance",
                "detail_status": "yf_fallback",
            })
            (public / f"{ticker}.json").write_bytes(legacy)


class PublicDataSupplyMaterializerTests(unittest.TestCase):
    def setUp(self):
        self.fixture = MaterializerFixture()

    def tearDown(self):
        self.fixture.close()

    def test_bootstrap_materializes_one_snapshot_exact_payloads_and_cross_bound_guard(self):
        materializer, reader = self.fixture.materializer()
        result = materializer.write_canonical(
            generated_at="2026-07-11T01:00:00Z",
            bootstrap_enrollment=True,
        )
        self.assertEqual(reader.calls, 1)
        self.assertEqual(result["counts"], {"enrolled": 3, "selected": 2, "unavailable": 1, "payloads": 2})
        for ticker, expected in self.fixture.payloads.items():
            self.assertEqual((self.fixture.canonical_root / f"payloads/{ticker}.json").read_bytes(), expected)

        enrollment = json.loads((self.fixture.canonical_root / "enrollment.json").read_text())
        index = json.loads((self.fixture.canonical_root / "index.json").read_text())
        self.assertEqual(enrollment["schema_version"], ENROLLMENT_SCHEMA)
        self.assertEqual(index["schema_version"], INDEX_SCHEMA)
        self.assertEqual(enrollment["tickers"], self.fixture.tickers)
        self.assertEqual(enrollment["membership_sha256"], self.fixture.membership_sha)
        self.assertEqual(enrollment["index_sha256"], index["index_sha256"])
        self.assertEqual(index_content_sha256(index), index["index_sha256"])
        self.assertEqual(index["resolution_state_counts"], {
            "fresh_fallback": 1,
            "fresh_primary": 0,
            "lkg_fallback": 1,
            "lkg_primary": 0,
            "unavailable": 1,
        })
        self.assertNotIn("provider", index["entries"]["FRESH"])
        self.assertEqual(set(index["entries"]["FRESH"]), SELECTED_ENTRY_KEYS)
        self.assertEqual(set(index["entries"]["UNAV"]), UNAVAILABLE_ENTRY_KEYS)
        self.assertIsNone(index["entries"]["UNAV"]["payload_path"])

    def test_check_is_read_only_and_clock_changes_only_projection_metadata(self):
        materializer, _ = self.fixture.materializer()
        materializer.write_canonical(generated_at="2026-07-11T01:00:00Z", bootstrap_enrollment=True)
        before = {path.relative_to(self.fixture.canonical_root): path.read_bytes()
                  for path in self.fixture.canonical_root.rglob("*") if path.is_file()}
        checked, reader = self.fixture.materializer()
        checked.check(generated_at="2026-07-11T01:00:00Z")
        self.assertEqual(reader.calls, 1)
        after = {path.relative_to(self.fixture.canonical_root): path.read_bytes()
                 for path in self.fixture.canonical_root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

        later, _ = self.fixture.materializer()
        first_projection = materializer.build_projection(generated_at="2026-07-11T01:00:00Z")
        later_projection = later.build_projection(generated_at="2026-07-12T01:00:00Z")
        self.assertEqual(first_projection.payloads, later_projection.payloads)
        for ticker in self.fixture.current:
            first = first_projection.index["entries"][ticker]
            second = later_projection.index["entries"][ticker]
            self.assertEqual(first["source_as_of"], second["source_as_of"])
            self.assertEqual(first["payload_sha256"], second["payload_sha256"])

    def test_both_lkg_roles_preserve_exact_payload_and_source_stamp(self):
        fallback, _ = self.fixture.materializer()
        fallback_projection = fallback.build_projection(generated_at="2026-07-11T01:00:00Z")
        promoted_active = self.fixture.active
        promoted_active["current"]["LKG"]["resolution_state"] = "lkg_primary"
        promoted, _ = self.fixture.materializer()
        promoted.state_reader = CountingStateReader(promoted_active)
        promoted_projection = promoted.build_projection(generated_at="2026-07-12T01:00:00Z")
        self.assertEqual(promoted.state_reader.calls, 1)
        self.assertEqual(fallback_projection.payloads["LKG"], promoted_projection.payloads["LKG"])
        self.assertEqual(
            fallback_projection.index["entries"]["LKG"]["source_as_of"],
            promoted_projection.index["entries"]["LKG"]["source_as_of"],
        )
        self.assertEqual(fallback_projection.index["entries"]["LKG"]["provider_role"], "fallback")
        self.assertEqual(promoted_projection.index["entries"]["LKG"]["provider_role"], "primary")

    def test_bootstrap_digest_and_existing_membership_fail_closed(self):
        wrong = PublicDataSupplyMaterializer(
            repo_root=self.fixture.repo,
            state_reader=CountingStateReader(self.fixture.active),
            expected_enrollment_count=3,
            expected_membership_sha256="f" * 64,
        )
        with self.assertRaisesRegex(MaterializationError, "membership digest"):
            wrong.write_canonical(generated_at="2026-07-11T01:00:00Z", bootstrap_enrollment=True)
        self.assertFalse(self.fixture.canonical_root.exists())

        good, _ = self.fixture.materializer()
        good.write_canonical(generated_at="2026-07-11T01:00:00Z", bootstrap_enrollment=True)
        enrollment_path = self.fixture.canonical_root / "enrollment.json"
        enrollment = json.loads(enrollment_path.read_text())
        enrollment["tickers"] = ["DRIFT"]
        enrollment_path.write_bytes(pretty_bytes(enrollment))
        with self.assertRaises(MaterializationError):
            good.write_canonical(generated_at="2026-07-11T02:00:00Z", bootstrap_enrollment=False)

    def test_corrupt_missing_escaping_symlink_and_untracked_refs_preserve_previous_tree(self):
        good, _ = self.fixture.materializer()
        good.write_canonical(generated_at="2026-07-11T01:00:00Z", bootstrap_enrollment=True)
        baseline = (self.fixture.canonical_root / "index.json").read_bytes()
        selection = self.fixture.current["FRESH"]
        object_path = self.fixture.state_root / selection["payload_ref"]["path"]

        cases = []
        cases.append(("corrupt", lambda: object_path.write_bytes(object_path.read_bytes() + b" ")))

        def missing():
            object_path.unlink()
        cases.append(("missing", missing))

        for name, mutate in cases:
            with self.subTest(name=name):
                original = self.fixture.payloads["FRESH"]
                object_path.parent.mkdir(parents=True, exist_ok=True)
                object_path.write_bytes(original)
                mutate()
                materializer, _ = self.fixture.materializer()
                with self.assertRaises(MaterializationError):
                    materializer.write_canonical(generated_at="2026-07-11T02:00:00Z")
                self.assertEqual((self.fixture.canonical_root / "index.json").read_bytes(), baseline)

        object_path.write_bytes(self.fixture.payloads["FRESH"])
        outside = self.fixture.repo / "outside.json"
        outside.write_bytes(self.fixture.payloads["FRESH"])
        object_path.unlink()
        object_path.symlink_to(outside)
        with self.assertRaisesRegex(MaterializationError, "symlink|regular"):
            self.fixture.materializer()[0].write_canonical(generated_at="2026-07-11T02:00:00Z")
        self.assertEqual((self.fixture.canonical_root / "index.json").read_bytes(), baseline)

        object_path.unlink()
        object_path.write_bytes(self.fixture.payloads["FRESH"])
        subprocess.run(["git", "rm", "--cached", "-q", str(object_path.relative_to(self.fixture.repo))], cwd=self.fixture.repo, check=True)
        with self.assertRaisesRegex(MaterializationError, "Git-tracked"):
            self.fixture.materializer()[0].write_canonical(generated_at="2026-07-11T02:00:00Z")

        escaping = copy.deepcopy(self.fixture.active)
        escaping["current"]["FRESH"]["payload_ref"]["path"] = "../outside.json"
        with self.assertRaisesRegex(MaterializationError, "safe relative path|identity mismatch"):
            PublicDataSupplyMaterializer(
                repo_root=self.fixture.repo,
                state_reader=CountingStateReader(escaping),
                expected_enrollment_count=len(self.fixture.tickers),
                expected_membership_sha256=self.fixture.membership_sha,
            ).write_canonical(generated_at="2026-07-11T02:00:00Z")
        self.assertEqual((self.fixture.canonical_root / "index.json").read_bytes(), baseline)

    def test_privacy_tokens_and_data_supply_collision_fail_before_write(self):
        selection = self.fixture.current["FRESH"]
        original_selection = copy.deepcopy(selection)
        for mutation in (
            lambda payload: payload.update({"data_supply": {"forbidden": True}}),
            lambda payload: payload["raw"].update({"path": "admin/data-supply-state/v1/secret"}),
        ):
            selection.clear()
            selection.update(copy.deepcopy(original_selection))
            payload = json.loads(self.fixture.payloads["FRESH"])
            mutation(payload)
            body = pretty_bytes(payload)
            sha = hashlib.sha256(body).hexdigest()
            ref = selection["payload_ref"]
            new_rel = str(Path(ref["path"]).parent / f"{sha}.json")
            new_path = self.fixture.state_root / new_rel
            new_path.write_bytes(body)
            subprocess.run(["git", "add", str(new_path.relative_to(self.fixture.repo))], cwd=self.fixture.repo, check=True)
            selection["payload_sha256"] = sha
            selection["payload_ref"] = {**ref, "path": new_rel, "sha256": sha}
            with self.assertRaises(MaterializationError):
                self.fixture.materializer()[0].write_canonical(
                    generated_at="2026-07-11T02:00:00Z",
                    bootstrap_enrollment=True,
                )
            self.assertFalse(self.fixture.canonical_root.exists())

        selection.clear()
        selection.update(copy.deepcopy(original_selection))
        selection["reason_code"] = "https://private.example/observation"
        with self.assertRaisesRegex(MaterializationError, "private token"):
            self.fixture.materializer()[0].write_canonical(
                generated_at="2026-07-11T02:00:00Z",
                bootstrap_enrollment=True,
            )
        self.assertFalse(self.fixture.canonical_root.exists())

    def test_reconcile_validates_full_plan_resumes_partial_unlink_and_is_idempotent(self):
        materializer, _ = self.fixture.materializer()
        materializer.write_canonical(generated_at="2026-07-11T01:00:00Z", bootstrap_enrollment=True)
        self.fixture.copy_projection_public()
        self.fixture.seed_stockanalysis_reconcile()

        def fail_after_first(point: str):
            if point == "public_unlink_1":
                raise RuntimeError("fixture crash")

        crashing, _ = self.fixture.materializer(failpoint=fail_after_first)
        with self.assertRaisesRegex(RuntimeError, "fixture crash"):
            crashing.reconcile_public()
        remaining = sorted(path.stem for path in (self.fixture.public_data_root / "stockanalysis/etfs").glob("*.json") if path.stem != "IEFA")
        self.assertEqual(len(remaining), 2)

        resumed, reader = self.fixture.materializer()
        result = resumed.reconcile_public()
        self.assertEqual(reader.calls, 1)
        self.assertEqual(result["stale_deleted"], 2)
        self.assertEqual(result["postcondition"], {
            "public_stockanalysis_true_primary": 1,
            "public_stockanalysis_yahoo": 0,
            "public_projection_payloads": 2,
            "public_status_rows": 3,
        })
        self.assertEqual(resumed.reconcile_public()["stale_deleted"], 0)

    def test_reconcile_rejects_out_of_set_and_primary_difference_without_deletion(self):
        materializer, _ = self.fixture.materializer()
        materializer.write_canonical(generated_at="2026-07-11T01:00:00Z", bootstrap_enrollment=True)
        self.fixture.copy_projection_public()
        self.fixture.seed_stockanalysis_reconcile()
        public = self.fixture.public_data_root / "stockanalysis/etfs"
        bad = public / "BAD.json"
        bad.write_bytes(pretty_bytes({
            "schema_version": "stockanalysis/v1", "ticker": "BAD", "asset_type": "etf",
            "source": "yahoo_finance", "source_provider": "yahoo_finance", "detail_status": "yf_fallback",
        }))
        before = sorted(path.name for path in public.glob("*.json"))
        with self.assertRaises(MaterializationError):
            materializer.reconcile_public()
        self.assertEqual(sorted(path.name for path in public.glob("*.json")), before)

        bad.unlink()
        (public / "IEFA.json").write_bytes(b"{}\n")
        with self.assertRaises(MaterializationError):
            materializer.reconcile_public()
        self.assertEqual(len(list(public.glob("*.json"))), 4)


def run_real_baseline_reconcile_fixture(root: Path) -> None:
    if (root / ".git").exists():
        raise AssertionError(f"real baseline fixture must not contain an existing Git repository: {root}")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(
        ["git", "add", "data/admin/data-supply-state", "data/admin/data-usage-manifest.json"],
        cwd=root,
        check=True,
    )
    materializer = PublicDataSupplyMaterializer(repo_root=root)
    result = materializer.reconcile_public()
    expected = {
        "public_stockanalysis_true_primary": 4731,
        "public_stockanalysis_yahoo": 0,
        "public_projection_payloads": 506,
        "public_status_rows": 718,
    }
    if result["postcondition"] != expected:
        raise AssertionError(f"real baseline postcondition mismatch: {result['postcondition']!r}")
    second = materializer.reconcile_public()
    if second["stale_deleted"] != 0:
        raise AssertionError(f"real baseline reconciliation is not idempotent: {second!r}")


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--real-baseline-reconcile-root")
    args, remaining = parser.parse_known_args()
    if args.real_baseline_reconcile_root:
        if remaining:
            raise SystemExit(f"unexpected arguments: {remaining}")
        run_real_baseline_reconcile_fixture(Path(args.real_baseline_reconcile_root).resolve())
        print("test-materialize-data-supply-public real baseline: ok")
        return 0
    unittest.main(argv=[sys.argv[0], *remaining])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
