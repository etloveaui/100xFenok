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


if __name__ == "__main__":
    unittest.main()
