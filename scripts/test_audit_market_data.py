#!/usr/bin/env python3
"""Contract checks for market data audit readiness gates."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).resolve().parents[1]
AUDIT_PATH = ROOT / "scripts" / "audit-market-data.py"


def load_audit_module():
    spec = importlib.util.spec_from_file_location("market_data_audit", AUDIT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load audit module from {AUDIT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class MarketDataAuditTest(unittest.TestCase):
    def setUp(self) -> None:
        self.audit = load_audit_module()
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = self.root / "data"
        self.public_data = self.root / "public" / "data"
        self.audit.DATA = self.data
        self.audit.NEXT_PUBLIC_DATA = self.public_data
        self._write_minimal_fixture()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_minimal_fixture(self) -> None:
        write_json(
            self.data / "stockanalysis" / "etf_universe.json",
            {
                "counts": {"records": 3},
                "records": [{"ticker": "AAA"}, {"ticker": "BBB"}, {"ticker": "CCC"}],
            },
        )
        for ticker in ("AAA", "BBB", "CCC"):
            write_json(self.data / "stockanalysis" / "etfs" / f"{ticker}.json", {"ticker": ticker})
        (self.data / "stockanalysis" / "stocks").mkdir(parents=True)
        write_json(
            self.data / "stockanalysis" / "backfill" / "index_offset_0_limit_3.json",
            {
                "counts": {"ok": 3, "failed": 0, "hard_failed": 0},
                "results": [
                    {"ticker": "AAA", "status": "ok"},
                    {"ticker": "BBB", "status": "ok"},
                    {"ticker": "CCC", "status": "ok"},
                ],
            },
        )
        write_json(self.data / "computed" / "market_facts" / "index.json", {"count": 3, "rows": [], "coverage": {}})
        (self.data / "computed" / "market_facts" / "tickers").mkdir(parents=True)
        write_json(self.data / "computed" / "market_source_parity.json", {"summary": {}, "generated_at": "2026-06-18T00:00:00Z"})
        write_json(self.data / "stockanalysis" / "index.json", {"generated_at": "2026-06-18T00:00:00Z", "counts": {}})
        (self.public_data / "stockanalysis" / "backfill").mkdir(parents=True)

    def test_ready_when_expected_chunks_complete_and_no_transients(self) -> None:
        payload = self.audit.build_payload()

        self.assertTrue(payload["backfill"]["ready_for_finalize"])
        self.assertEqual(payload["backfill"]["transient_file_count"], 0)

    def test_transient_backfill_files_block_finalize_readiness(self) -> None:
        (self.data / "stockanalysis" / "backfill" / "index_offset_0_limit_3.json.partial.1").write_text("{}", encoding="utf-8")
        (self.public_data / "stockanalysis" / "backfill" / "index_offset_0_limit_3.json.ignored").write_text("{}", encoding="utf-8")

        payload = self.audit.build_payload()

        self.assertFalse(payload["backfill"]["ready_for_finalize"])
        self.assertEqual(payload["backfill"]["transient_file_count"], 2)
        self.assertEqual(
            payload["backfill"]["transient_files"]["source"],
            ["backfill/index_offset_0_limit_3.json.partial.1"],
        )
        self.assertEqual(
            payload["backfill"]["transient_files"]["public"],
            ["backfill/index_offset_0_limit_3.json.ignored"],
        )

    def test_incremental_etf_audit_waits_before_first_run(self) -> None:
        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "waiting")
        self.assertFalse(payload["incremental_etf"]["has_run_evidence"])
        self.assertFalse(payload["incremental_etf"]["proof_file_exists"])
        self.assertIn("incremental_latest_missing", payload["incremental_etf"]["notes"])

    def test_incremental_etf_audit_warns_when_pending_details_remain(self) -> None:
        write_json(
            self.data / "stockanalysis" / "backfill" / "incremental_latest.json",
            {
                "generated_at": "2026-06-18T01:00:00Z",
                "counts": {"candidates": 4, "selected": 2, "missing": 1, "fallback_retry": 1, "stale": 0},
            },
        )
        write_json(
            self.data / "stockanalysis" / "index.json",
            {
                "generated_at": "2026-06-18T01:01:00Z",
                "counts": {
                    "etfs_stockanalysis_ok": 1,
                    "etfs_yahoo_fallback_ok": 1,
                    "etfs_still_pending": 1,
                    "hard_failed": 0,
                },
            },
        )
        write_json(
            self.data / "computed" / "market_facts" / "index.json",
            {"count": 3, "rows": [], "coverage": {"stockanalysis_yf_fallback": 1}},
        )

        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "warn")
        self.assertTrue(payload["incremental_etf"]["has_run_evidence"])
        self.assertTrue(payload["incremental_etf"]["proof_file_exists"])
        self.assertIn("pending_details_remain", payload["incremental_etf"]["notes"])

    def test_incremental_etf_audit_reports_pending_ledger_cooldown(self) -> None:
        write_json(
            self.data / "stockanalysis" / "backfill" / "incremental_latest.json",
            {
                "generated_at": "2026-06-18T01:00:00Z",
                "counts": {
                    "candidates": 4,
                    "selected": 2,
                    "missing": 2,
                    "fallback_retry": 0,
                    "stale": 0,
                    "cooldown_skipped": 3,
                },
            },
        )
        write_json(
            self.data / "stockanalysis" / "backfill" / "pending_ledger.json",
            {
                "counts": {"tracked": 5, "cooldown": 3},
                "entries": {},
            },
        )
        write_json(
            self.data / "stockanalysis" / "index.json",
            {
                "generated_at": "2026-06-18T01:01:00Z",
                "counts": {
                    "incremental_etf_backfill_selected": 2,
                    "etfs_stockanalysis_ok": 2,
                    "etfs_yahoo_fallback_ok": 0,
                    "etfs_still_pending": 0,
                    "hard_failed": 0,
                },
            },
        )

        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "warn")
        self.assertEqual(payload["incremental_etf"]["counts"]["cooldown_skipped"], 3)
        self.assertEqual(payload["incremental_etf"]["counts"]["pending_ledger_tracked"], 5)
        self.assertEqual(payload["incremental_etf"]["counts"]["pending_ledger_cooldown"], 3)
        self.assertIn("cooldown_active", payload["incremental_etf"]["notes"])

    def test_incremental_etf_audit_passes_when_proof_has_no_pending_or_hard_failures(self) -> None:
        write_json(
            self.data / "stockanalysis" / "backfill" / "incremental_latest.json",
            {
                "generated_at": "2026-06-18T01:00:00Z",
                "counts": {"candidates": 2, "selected": 2, "missing": 1, "fallback_retry": 1, "stale": 0},
            },
        )
        write_json(
            self.data / "stockanalysis" / "index.json",
            {
                "generated_at": "2026-06-18T01:01:00Z",
                "counts": {
                    "incremental_etf_backfill_selected": 2,
                    "etfs_stockanalysis_ok": 1,
                    "etfs_yahoo_fallback_ok": 1,
                    "etfs_still_pending": 0,
                    "hard_failed": 0,
                },
            },
        )
        write_json(
            self.data / "computed" / "market_facts" / "index.json",
            {"count": 3, "rows": [], "coverage": {"stockanalysis_yf_fallback": 1}},
        )

        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "pass")
        self.assertEqual(payload["incremental_etf"]["counts"]["selected"], 2)
        self.assertEqual(payload["incremental_etf"]["counts"]["market_facts_yf_fallback"], 1)
        self.assertEqual(payload["incremental_etf"]["notes"], [])

    def test_incremental_etf_audit_warns_when_proof_not_reflected_in_fetch_index(self) -> None:
        write_json(
            self.data / "stockanalysis" / "backfill" / "incremental_latest.json",
            {
                "generated_at": "2026-06-18T01:00:00Z",
                "counts": {"candidates": 2, "selected": 2},
            },
        )
        write_json(
            self.data / "stockanalysis" / "index.json",
            {
                "generated_at": "2026-06-18T01:01:00Z",
                "counts": {
                    "etfs_stockanalysis_ok": 2,
                    "etfs_yahoo_fallback_ok": 0,
                    "etfs_still_pending": 0,
                    "hard_failed": 0,
                },
            },
        )

        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "warn")
        self.assertIn("incremental_not_reflected_in_fetch_index", payload["incremental_etf"]["notes"])

    def test_incremental_etf_audit_warns_when_fetch_index_is_missing(self) -> None:
        (self.data / "stockanalysis" / "index.json").unlink()
        write_json(
            self.data / "stockanalysis" / "backfill" / "incremental_latest.json",
            {
                "generated_at": "2026-06-18T01:00:00Z",
                "counts": {"candidates": 2, "selected": 2},
            },
        )

        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "warn")
        self.assertFalse(payload["incremental_etf"]["index_file_exists"])
        self.assertIn("stockanalysis_index_missing", payload["incremental_etf"]["notes"])

    def test_incremental_etf_audit_fails_on_hard_failures(self) -> None:
        write_json(
            self.data / "stockanalysis" / "backfill" / "incremental_latest.json",
            {
                "generated_at": "2026-06-18T01:00:00Z",
                "counts": {"candidates": 2, "selected": 2},
            },
        )
        write_json(
            self.data / "stockanalysis" / "index.json",
            {
                "generated_at": "2026-06-18T01:01:00Z",
                "counts": {"hard_failed": 1, "etfs_still_pending": 0},
            },
        )

        payload = self.audit.build_payload()

        self.assertEqual(payload["incremental_etf"]["status"], "fail")
        self.assertEqual(payload["incremental_etf"]["counts"]["hard_failed"], 1)


if __name__ == "__main__":
    unittest.main()
