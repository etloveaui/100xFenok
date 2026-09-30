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
    StockAnalysisRecoveryStateError,
    StockAnalysisRecoveryStateStore,
    payload_source_fields,
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


def etf_payload(ticker: str, source_as_of: str | None) -> dict:
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "etf",
        "ticker": ticker,
        "source_as_of": source_as_of,
        "fetched_at": "2026-07-15T23:00:00Z",
        "normalized": {"overview": {"aum": 1}},
    }


def surface_payload(name: str, fetched_at: str, row: str, provider_date: str = "2026-07-14") -> dict:
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
        "records": [{"symbol": row, "date": provider_date}],
        "metadata": {},
    }


def universe_payload(fetched_at: str, *tickers: str) -> dict:
    records = [
        {"ticker": ticker, "name": f"{ticker} ETF", "source_page": 1}
        for ticker in sorted(tickers)
    ]
    return {
        "schema_version": "stockanalysis/v1",
        "source": "stockanalysis",
        "asset_type": "etf",
        "generated_at": fetched_at,
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": fetched_at,
        "endpoint": "/etf/",
        "counts": {"records": len(records), "pages": 1},
        "warnings": [],
        "pages": [{"page": 1, "path": "/etf/", "record_count": len(records)}],
        "records": records,
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

    def test_same_source_date_recovers_for_any_execution_context(self):
        payload = stock_payload("AAPL", "2026-07-14T20:00:00Z")
        path = self.data_root / "stocks" / "AAPL.json"
        original = write_json(path, payload)
        for context in ({}, {"event_name": "workflow_dispatch"},
                        {"event_name": "schedule", "run_attempt": 2}):
            self.store.record_failure("stock", "AAPL", "HTTP 503", context)
            self.assertTrue(self.store.recovery_candidate_advances("stock", "AAPL", payload))
            state = self.store.record_success("stock", "AAPL", payload, context)
            self.assertFalse(state["retry"])
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual((self.state_root / "lkg/stock/AAPL.json").read_bytes(), original)
            self.assertEqual(state["current"]["source_as_of"], payload["source_as_of"])

    def test_older_candidate_is_rejected_before_good_bytes_change(self):
        good = stock_payload("AAPL", "2026-07-14T20:00:00Z")
        path = self.data_root / "stocks/AAPL.json"
        original = write_json(path, good)
        self.store.record_failure("stock", "AAPL", "HTTP 503", {})
        self.assertFalse(self.store.recovery_candidate_advances(
            "stock", "AAPL", stock_payload("AAPL", "2026-07-13T20:00:00Z")))
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual((self.state_root / "lkg/stock/AAPL.json").read_bytes(), original)



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
            self.assertIn("controlled failure", state["latest_failure"]["error"])

        index = self.store.rebuild_index(self.run_context("chaos-1"))
        self.assertEqual(index["counts"]["lkg"], 3)
        self.assertEqual(index["counts"]["retry"], 3)
        self.assertEqual(index["current_results"]["failed"], 3)
        self.assertEqual(index["degraded_tickers"], ["AAPL"])
        self.assertEqual(index["degraded_surfaces"], ["actions_recent"])
        self.assertEqual(self.store.assess_current_attempt(index)["status"], "degraded")

    def test_provider_row_dates_supply_strict_advancement_markers(self) -> None:
        stock = stock_payload("AAPL", "2026-07-14T20:00:00Z")
        stock["source_as_of"] = None
        stock["normalized"]["quote"]["td"] = "2026-07-14"
        stock["normalized"]["history"] = [{"t": "2026-07-13", "c": 10}]
        surface = surface_payload(
            "actions_recent", "2026-07-15T07:00:00Z", "AAPL", "Jul 14, 2026"
        )
        self.assertEqual(
            payload_source_fields("stock", stock)["source_as_of"],
            "2026-07-14T00:00:00Z",
        )
        self.assertEqual(
            payload_source_fields("surface", surface)["source_as_of"],
            "2026-07-14T00:00:00Z",
        )






    def test_upcoming_calendar_events_do_not_invent_source_freshness(self):
        payload = surface_payload("earnings_calendar", "2026-07-15T07:00:00Z", "AAPL", "2099-01-01")
        self.assertIsNone(payload_source_fields("surface", payload)["source_as_of"])
        self.assertTrue(self.store.recovery_candidate_advances("surface", "earnings_calendar", payload))
        path = self.data_root / "surfaces/earnings_calendar.json"
        original = write_json(path, payload)
        self.store.bootstrap_existing({})
        state_path = self.state_root / "states/surface/earnings_calendar.json"
        legacy_state = json.loads(state_path.read_bytes())
        legacy_state["current"]["source_as_of"] = "2099-01-01T00:00:00Z"
        write_json(state_path, legacy_state)
        self.assertTrue(self.store.recovery_candidate_advances("surface", "earnings_calendar", payload))
        self.store.record_failure("surface", "earnings_calendar", "HTTP 503", {})
        self.assertEqual((self.state_root / "lkg/surface/earnings_calendar.json").read_bytes(), original)
        state = self.store.record_success("surface", "earnings_calendar", payload, {})
        self.assertIsNone(state["current"]["source_as_of"])
        self.assertEqual(state["current"]["fetched_at"], payload["fetched_at"])
        self.assertEqual(json.loads(path.read_bytes())["records"][0]["date"], "2099-01-01")

    def test_upcoming_ipo_calendar_events_do_not_invent_source_freshness(self):
        payload = surface_payload("ipos_calendar", "2026-07-15T07:00:00Z", "NEW")
        payload["format"] = "html_table"
        payload["records"] = [{"symbol": "NEW", "ipo_date": "Sep 30, 2099"}]
        self.assertIsNone(payload_source_fields("surface", payload)["source_as_of"])
        self.assertTrue(self.store.recovery_candidate_advances("surface", "ipos_calendar", payload))
        path = self.data_root / "surfaces/ipos_calendar.json"
        original = write_json(path, payload)
        self.store.bootstrap_existing({})
        state_path = self.state_root / "states/surface/ipos_calendar.json"
        legacy_state = json.loads(state_path.read_bytes())
        legacy_state["current"]["source_as_of"] = "2099-09-30T00:00:00Z"
        write_json(state_path, legacy_state)
        self.assertTrue(self.store.recovery_candidate_advances("surface", "ipos_calendar", payload))
        self.store.record_failure("surface", "ipos_calendar", "HTTP 503", {})
        self.assertEqual((self.state_root / "lkg/surface/ipos_calendar.json").read_bytes(), original)
        state = self.store.record_success("surface", "ipos_calendar", payload, {})
        self.assertIsNone(state["current"]["source_as_of"])
        self.assertEqual(json.loads(path.read_bytes())["records"][0]["ipo_date"], "Sep 30, 2099")
        for candidate in ({**payload, "source_as_of": "2099-01-01T00:00:00Z"},
                          {**payload, "fetched_at": "2099-01-01T00:00:00Z"}):
            self.assertFalse(self.store.recovery_candidate_advances("surface", "ipos_calendar", candidate))

    def test_calendar_still_refuses_future_provider_source_or_observation(self):
        payload = surface_payload("earnings_calendar", "2026-07-15T07:00:00Z", "AAPL", "2099-01-01")
        for candidate in ({**payload, "source_as_of": "2099-01-01T00:00:00Z"},
                          {**payload, "fetched_at": "2099-01-01T00:00:00Z"}):
            with self.subTest(candidate=candidate):
                self.assertFalse(self.store.recovery_candidate_advances("surface", "earnings_calendar", candidate))

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

    def test_universe_failure_retains_exact_lkg_and_names_retry_then_recovers(self) -> None:
        entity = "etf_universe"
        canonical = self.data_root / "etf_universe.json"
        expected_lkg = write_json(
            canonical,
            universe_payload("2026-07-15T07:00:00Z", "AAA", "BBB"),
        )
        self.assertEqual(self.store.bootstrap_existing(self.run_context("bootstrap")), 1)

        state = self.store.record_failure(
            "universe",
            entity,
            "TimeoutError: transient universe timeout",
            self.run_context("universe-failed"),
        )
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertEqual(
            (self.state_root / "lkg" / "universe" / f"{entity}.json").read_bytes(),
            expected_lkg,
        )
        self.assertEqual(self.store.retry_entities("universe"), {entity})

        failed_index = self.store.rebuild_index(self.run_context("universe-failed"))
        self.assertIn(
            {"artifact_kind": "universe", "entity": entity},
            failed_index["retry_artifacts"],
        )
        self.assertEqual(failed_index["degraded_universes"], [entity])
        self.assertEqual(
            self.store.assess_current_attempt(failed_index),
            {
                "status": "degraded",
                "exit_code": 0,
                "artifacts": ["universe:etf_universe"],
                "reasons": [],
            },
        )

        advanced = universe_payload("2026-07-15T08:05:00Z", "AAA", "BBB", "CCC")
        write_json(canonical, advanced)
        recovered = self.store.record_success(
            "universe",
            entity,
            advanced,
            {
                **self.run_context("universe-recovered"),
                "event_name": "schedule",
                "natural": True,
            },
        )
        self.assertEqual(recovered["resolution_state"], "fresh_primary")
        self.assertFalse(recovered["retry"])
        recovered_index = self.store.rebuild_index(self.run_context("universe-recovered"))
        self.assertEqual(recovered_index["degraded_universes"], [])

    def test_reconcile_current_payload_sha_fails_closed_and_distinguishes_noop(self) -> None:
        entity = "etf_universe"
        canonical = self.data_root / "etf_universe.json"
        write_json(canonical, universe_payload("2026-07-15T07:00:00Z", "AAA"))
        self.store.bootstrap_existing(self.run_context("bootstrap"))

        self.assertFalse(
            self.store.reconcile_current_payload_sha256("universe", entity),
            "matching canonical bytes are a no-op, not a reconciliation failure",
        )
        state_path = self.state_root / "states" / "universe" / f"{entity}.json"
        state_path.unlink()
        with self.assertRaisesRegex(StockAnalysisRecoveryStateError, "missing recovery state"):
            self.store.reconcile_current_payload_sha256("universe", entity)

        state_path.write_text("{broken", encoding="utf-8")
        with self.assertRaisesRegex(StockAnalysisRecoveryStateError, "malformed recovery state"):
            self.store.reconcile_current_payload_sha256("universe", entity)

        self.store.bootstrap_existing(self.run_context("rebootstrap"))
        canonical.unlink()
        with self.assertRaisesRegex(StockAnalysisRecoveryStateError, "canonical payload is unreadable"):
            self.store.reconcile_current_payload_sha256("universe", entity)

    def test_reconcile_current_payload_sha_preserves_degraded_lkg_binding(self) -> None:
        entity = "etf_universe"
        canonical = self.data_root / "etf_universe.json"
        payload = universe_payload("2026-07-15T07:00:00Z", "AAA")
        write_json(canonical, payload)
        self.store.bootstrap_existing(self.run_context("bootstrap"))
        self.store.record_failure(
            "universe",
            entity,
            "controlled failure",
            self.run_context("controlled-failure"),
            controlled=True,
        )

        reclassified = {**payload, "classification_refreshed_at": "2026-07-15T08:00:00Z"}
        write_json(canonical, reclassified)

        self.assertFalse(
            self.store.reconcile_current_payload_sha256("universe", entity),
            "a degraded current pointer must remain bound to its retained LKG",
        )
        state = json.loads(
            (self.state_root / "states" / "universe" / f"{entity}.json").read_text()
        )
        self.assertEqual(state["current"], state["lkg"])
        self.assertTrue(self.store.valid_retained_lkg("universe", entity, state))




if __name__ == "__main__":
    unittest.main()
