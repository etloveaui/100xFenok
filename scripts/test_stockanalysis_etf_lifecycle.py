#!/usr/bin/env python3
"""Orphans retain their data and can only leave membership with evidence."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stockanalysis_etf_lifecycle import Inputs, membership, record_probe, automatic_evidence
from stockanalysis_recovery_state import StockAnalysisRecoveryStateStore


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def detail(ticker, history="2026-08-01"):
    return {"schema_version": "stockanalysis/v1", "source": "stockanalysis", "asset_type": "etf", "ticker": ticker,
            "fetched_at": "2026-10-10T00:00:00Z", "source_as_of": history,
            "raw": {"history_periods": {"daily_1y": [{"t": history, "c": 10}]}},
            "normalized": {"overview": {}, "history_periods": {"daily_1y": [{"t": history, "c": 10}]}}}


class OrphanLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.out = self.root / "data/stockanalysis"
        self.store = StockAnalysisRecoveryStateStore(self.root / "data/admin/stockanalysis-recovery", self.root)
        for file in ["etf_universe.json", "surfaces/etf_screener.json"]:
            write(self.out / file, {"records": [{"ticker": "KNOWN"}]})
        write(self.out / "etfs/KNOWN.json", detail("KNOWN"))
        write(self.out / "etfs/LOST.json", detail("LOST"))
        spec = importlib.util.spec_from_file_location("orphan_fetcher", Path(__file__).with_name("fetch-stockanalysis.py"))
        self.fetcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.fetcher)

    def tearDown(self):
        self.tmp.cleanup()

    def observe(self, day, result=None, event="schedule"):
        result = result or {"provider_availability_status": "absent", "provider_availability_reason": "provider_coverage_gap", "provider_response": "HTTP 404", "provider_absence_endpoint": "/etf/lost/__data.json"}
        run = {"event_name": event, "observed_at": f"2026-10-{day:02d}T23:20:00Z"}
        if event == "schedule" and result.get("canonical_write") is not True:
            self.store.record_failure("etf", "LOST", "HTTP 404", run)
        return record_probe(self.store, "LOST", result, run, ["etf_universe", "etf_screener"])

    def test_derived_orphans_exclude_verified_classes_and_returned_members_rejoin_selector(self):
        write(self.out / "etfs/DEFI.json", detail("DEFI"))
        summary = membership(Inputs(self.root), "2026-10-11T00:00:00Z")
        self.assertEqual([r["ticker"] for r in summary["orphans"]], ["LOST"])
        self.assertEqual(set(summary["exclusions"]), {"DEFI"})
        with patch.object(self.fetcher, "OUT_DIR", self.out), patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={}):
            plan = self.fetcher.incremental_etf_backfill_candidates(None, 400, 720, now_dt=datetime(2026, 10, 11, tzinfo=timezone.utc), natural_general_priority=True, selected_etf_state={}, pending_ledger={})
        self.assertEqual(next(r for r in plan["selected"] if r["ticker"] == "LOST")["selection_bucket"], "orphan_probe")
        result = {"canonical_write": True, "provider": "stockanalysis", "error": None}
        life = self.observe(11, result)
        self.assertEqual(life["status"], "live")
        summary = membership(Inputs(self.root), "2026-10-12T00:00:00Z")
        self.assertEqual(summary["orphans"], [])
        self.assertEqual(summary["live_catalogue_gaps"][0]["missing_catalogues"], ["etf_universe", "etf_screener"])
        with patch.object(self.fetcher, "OUT_DIR", self.out), patch.object(self.fetcher, "latest_stockanalysis_etf_detail_observations", return_value={}):
            plan = self.fetcher.incremental_etf_backfill_candidates(None, 400, 720, now_dt=datetime(2026, 10, 12, tzinfo=timezone.utc), natural_general_priority=True, selected_etf_state={}, pending_ledger={})
        returned = next(r for r in plan["selected"] if r["ticker"] == "LOST")
        self.assertEqual(returned["source"], "lifecycle_live")
        self.assertNotEqual(returned["selection_bucket"], "orphan_probe")

    def test_probe_and_retry_reserves_progress_when_source_debt_fills_budget(self):
        def row(ticker, reason, age=0, failures=0):
            return {"ticker": ticker, "reason": reason, "age_hours": age, "prior_failures": failures,
                    "priority": 1, "reason_priority": 1, "last_attempt_utc": "2026-10-10T00:00:00Z"}
        probes = [row(f"P{i:03d}", "lifecycle_probe") for i in range(100)]
        debts = [row(f"D{i:03d}", "missing") for i in range(330)]
        retries = [row(f"R{i:03d}", "pending_retry", failures=1) for i in range(10)]
        contexts = {r["ticker"]: {"sources": {"new_etfs"}} for r in debts}
        selected, policy = self.fetcher.select_natural_general_incremental_candidates(debts + retries + probes, contexts, now_dt=datetime(2026, 10, 11, tzinfo=timezone.utc), limit=400)
        self.assertEqual(len(selected), 400)
        self.assertEqual(policy["selected_counts"]["orphan_probe"], 60)
        self.assertEqual(policy["selected_counts"]["pending_retry"], 10)
        selected, policy = self.fetcher.select_natural_general_incremental_candidates(debts + retries + probes, contexts, now_dt=datetime(2026, 10, 11, tzinfo=timezone.utc), limit=340)
        self.assertEqual(len(selected), 340)
        self.assertEqual(policy["selected_counts"]["orphan_probe"], 10)
        self.assertEqual(policy["selected_counts"]["pending_retry"], 10)
        self.assertEqual(policy["selected_counts"]["new_listings"], 320)

    def test_three_distinct_scheduled_days_keep_real_bytes_and_support_live_return(self):
        before = (self.out / "etfs/LOST.json").read_bytes()
        self.assertEqual(self.observe(11)["status"], "unresolved")
        self.assertEqual(len(self.observe(11)["attempts"]), 1)
        self.assertIsNone(self.observe(12, event="workflow_dispatch"))
        self.assertEqual(self.observe(12)["status"], "unresolved")
        life = self.observe(13)
        self.assertEqual(life["status"], "closed")
        self.assertEqual(life["last_history_as_of"], "2026-08-01")
        state = self.store._load_state("etf", "LOST")
        self.assertFalse(state["retry"])
        self.assertIsNotNone(automatic_evidence("LOST", state, "2026-10-14T00:00:00Z"))
        self.assertEqual((self.out / "etfs/LOST.json").read_bytes(), before)
        state["etf_lifecycle"]["attempts"][1] = state["etf_lifecycle"]["attempts"][0]
        self.assertIsNone(automatic_evidence("LOST", state, "2026-10-14T00:00:00Z"))
        self.assertEqual(self.observe(14, {"canonical_write": True, "provider": "stockanalysis", "error": None})["status"], "live")

    def test_transport_failure_and_recent_or_missing_history_cannot_close_member(self):
        self.observe(11); self.observe(12)
        self.assertEqual(self.observe(13, {"error": "HTTP 429"})["attempts"], [])
        self.assertEqual(self.observe(13, {"provider_availability_status": "absent", "provider_availability_reason": "provider_coverage_gap",
            "provider_response": "HTTP 404", "provider_absence_endpoint": "/etf/lost/holdings/__data.json"})["attempts"], [])
        write(self.out / "etfs/LOST.json", detail("LOST", "2026-10-09"))
        for day in [14, 15, 16]:
            life = self.observe(day)
        self.assertEqual(life["status"], "unresolved")
        payload = detail("LOST"); payload["raw"] = {}; payload["normalized"] = {"overview": {}}
        write(self.out / "etfs/LOST.json", payload)
        self.assertEqual(self.observe(17)["status"], "unresolved")


if __name__ == "__main__":
    unittest.main()
