#!/usr/bin/env python3
"""Deterministic LKG/recovery contracts for StockAnalysis producer artifacts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = ROOT / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from stockanalysis_recovery_state import (  # noqa: E402
    StockAnalysisRecoveryStateStore,
    validate_controlled_failure_scope,
)


def write_json(path: Path, payload: dict) -> bytes:
    payload_bytes = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload_bytes)
    return payload_bytes


def stock_payload(ticker: str, source_as_of: str) -> dict:
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "source_as_of": source_as_of,
        "fetched_at": f"{source_as_of[:10]}T23:00:00Z",
        "normalized": {
            "overview": {"marketCap": 1},
            "quote": {"symbol": ticker, "uid": ticker, "p": 10, "cl": 9},
            "history": [{"t": source_as_of[:10], "c": 10}],
        },
    }


def financial_payload(ticker: str, period_as_of: str) -> dict:
    statement = {
        "ticker": ticker,
        "statement": "financials",
        "period": "annual",
        "periods": [period_as_of, "2025-12-31"],
        "rows": [{"field": "revenue", "values": [2, 1]}],
    }
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "fetched_at": f"{period_as_of}T23:00:00Z",
        "statements": {"annual": {"income": statement}},
        "summary": {"annual": {"income": {"period_count": 2}}},
    }


def surface_payload(name: str, fetched_at: str, row: str) -> dict:
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "surface": name,
        "group": "events",
        "priority": "high",
        "role": "fixture",
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": fetched_at,
        "endpoint": f"/{name}",
        "url": f"https://stockanalysis.com/{name}",
        "format": "svelte_devalue",
        "counts": {"records": 1},
        "records": [{"symbol": row}],
        "metadata": {},
    }


class StockAnalysisRecoveryStateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data_root = self.root / "data" / "stockanalysis"
        self.state_root = self.root / "data" / "admin" / "stockanalysis-recovery"
        self.store = StockAnalysisRecoveryStateStore(self.state_root, self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    @staticmethod
    def run_context(run_id: str, *, attempt: int = 1) -> dict:
        return {
            "run_id": run_id,
            "run_attempt": attempt,
            "event_name": "workflow_dispatch",
            "schedule": "",
            "natural": False,
            "observed_at": "2026-07-15T08:00:00Z",
        }

    def seed_lane(self) -> dict[tuple[str, str], bytes]:
        return {
            ("stock", "AAPL"): write_json(
                self.data_root / "stocks" / "AAPL.json",
                stock_payload("AAPL", "2026-07-14T20:00:00Z"),
            ),
            ("financial", "AAPL"): write_json(
                self.data_root / "financials" / "AAPL.json",
                financial_payload("AAPL", "2026-06-30"),
            ),
            ("surface", "actions_recent"): write_json(
                self.data_root / "surfaces" / "actions_recent.json",
                surface_payload("actions_recent", "2026-07-15T07:00:00Z", "AAPL"),
            ),
        }

    def test_bootstrap_and_failure_retain_exact_sha_bound_lkg_and_retry(self) -> None:
        seeded = self.seed_lane()
        self.assertEqual(self.store.bootstrap_existing(self.run_context("bootstrap")), 3)

        for (kind, entity), expected_bytes in seeded.items():
            state = self.store.record_failure(
                kind,
                entity,
                "controlled failure injection",
                self.run_context("chaos-1"),
                controlled=True,
            )
            lkg_path = self.state_root / "lkg" / kind / f"{entity}.json"
            self.assertEqual(state["resolution_state"], "lkg_primary")
            self.assertTrue(state["retry"])
            self.assertEqual(lkg_path.read_bytes(), expected_bytes)
            self.assertEqual(
                state["lkg"]["payload_sha256"],
                hashlib.sha256(expected_bytes).hexdigest(),
            )
            self.assertEqual(state["current"], state["lkg"])
            self.assertEqual(state["latest_failure"]["run_id"], "chaos-1")

        index = self.store.rebuild_index(self.run_context("chaos-1"))
        self.assertEqual(index["counts"]["lkg"], 3)
        self.assertEqual(index["counts"]["retry"], 3)
        self.assertEqual(index["current_attempt"]["failed"], 3)
        self.assertEqual(index["degraded_tickers"], ["AAPL"])
        self.assertEqual(index["degraded_surfaces"], ["actions_recent"])
        self.assertEqual(self.store.assess_current_attempt(index)["status"], "degraded")

    def test_recovery_requires_source_advancement_then_records_failure_provenance(self) -> None:
        self.seed_lane()
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        self.store.record_failure(
            "stock", "AAPL", "controlled failure injection", self.run_context("chaos-2"), controlled=True
        )
        self.store.record_failure(
            "financial", "AAPL", "controlled failure injection", self.run_context("chaos-2"), controlled=True
        )
        self.store.record_failure(
            "surface", "actions_recent", "controlled failure injection", self.run_context("chaos-2"), controlled=True
        )

        self.assertFalse(
            self.store.recovery_candidate_advances(
                "stock", "AAPL", stock_payload("AAPL", "2026-07-14T20:00:00Z")
            )
        )
        self.assertFalse(
            self.store.recovery_candidate_advances(
                "financial", "AAPL", financial_payload("AAPL", "2026-06-30")
            )
        )
        advanced = {
            "stock": stock_payload("AAPL", "2026-07-15T20:00:00Z"),
            "financial": financial_payload("AAPL", "2026-07-15"),
            "surface": surface_payload("actions_recent", "2026-07-15T08:05:00Z", "MSFT"),
        }
        for kind, payload in advanced.items():
            entity = "actions_recent" if kind == "surface" else "AAPL"
            self.assertTrue(self.store.recovery_candidate_advances(kind, entity, payload))
            write_json(self.store.canonical_path(kind, entity), payload)
            state = self.store.record_success(kind, entity, payload, self.run_context("real-2"))
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])
            self.assertEqual(state["recovered_from_run_id"], "chaos-2")
            self.assertEqual(state["last_recovered_failure"]["run_id"], "chaos-2")

        index = self.store.rebuild_index(self.run_context("real-2"))
        self.assertEqual(index["current_attempt"]["recovered"], 3)
        self.assertEqual(index["recovered_tickers"], ["AAPL"])
        self.assertEqual(index["recovered_surfaces"], ["actions_recent"])
        self.assertEqual(self.store.assess_current_attempt(index)["status"], "ready")

    def test_existing_payload_loss_is_corruption(self) -> None:
        self.seed_lane()
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        (self.data_root / "stocks" / "AAPL.json").write_text("{broken", encoding="utf-8")
        state = self.store.record_failure(
            "stock", "AAPL", "decode collapse", self.run_context("broken-1")
        )
        self.assertEqual(state["resolution_state"], "unavailable")
        self.assertTrue(state["latest_failure"]["data_loss"])
        index = self.store.rebuild_index(self.run_context("broken-1"))
        assessment = self.store.assess_current_attempt(index)
        self.assertEqual(assessment["status"], "corrupt")
        self.assertEqual(assessment["exit_code"], 2)

    def test_systemic_auth_failure_is_corruption_even_with_retained_lkg(self) -> None:
        self.seed_lane()
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        state = self.store.record_failure(
            "stock",
            "AAPL",
            "HTTP Error 401: Unauthorized",
            self.run_context("auth-1"),
        )
        self.assertTrue(self.store.valid_retained_lkg("stock", "AAPL", state))
        assessment = self.store.assess_current_attempt(
            self.store.rebuild_index(self.run_context("auth-1"))
        )
        self.assertEqual(assessment["status"], "corrupt")
        self.assertEqual(assessment["exit_code"], 2)
        self.assertIn("authentication", assessment["reasons"][0])

    def test_controlled_failure_scope_is_dispatch_only_and_explicit(self) -> None:
        validate_controlled_failure_scope(
            {"AAPL"}, {"AAPL", "MSFT"}, {"actions_recent"}, {"actions_recent", "earnings_calendar"},
            event_name="workflow_dispatch",
        )
        cases = [
            ({"AAPL"}, {"AAPL"}, set(), set(), "schedule", "workflow_dispatch"),
            ({"AAPL"}, {"MSFT"}, set(), set(), "workflow_dispatch", "explicit --stocks"),
            (set(), set(), {"actions_recent"}, {"earnings_calendar"}, "workflow_dispatch", "explicit --surfaces"),
        ]
        for tickers, selected, surfaces, selected_surfaces, event_name, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_controlled_failure_scope(
                    tickers, selected, surfaces, selected_surfaces, event_name=event_name
                )


if __name__ == "__main__":
    unittest.main()
