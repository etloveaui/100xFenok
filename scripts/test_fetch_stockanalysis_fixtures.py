#!/usr/bin/env python3
"""Fixture smoke checks for StockAnalysis fetcher parser contracts."""

from __future__ import annotations

import importlib.util
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.error


ROOT = Path(__file__).resolve().parents[1]
FETCHER_PATH = ROOT / "scripts" / "fetch-stockanalysis.py"
FIXTURE_DIR = ROOT / "scripts" / "fixtures" / "stockanalysis"


def weekday_rows(start: str, count: int) -> list[dict]:
    cursor = datetime.fromisoformat(f"{start}T00:00:00+00:00")
    rows = []
    while len(rows) < count:
        if cursor.weekday() < 5:
            rows.append({"t": cursor.date().isoformat(), "c": 100 + len(rows)})
        cursor += timedelta(days=1)
    return rows


def sampled_weekday_rows(start: str, end: str, count: int) -> list[dict]:
    cursor = datetime.fromisoformat(f"{start}T00:00:00+00:00")
    end_dt = datetime.fromisoformat(f"{end}T00:00:00+00:00")
    dates = []
    while cursor <= end_dt:
        if cursor.weekday() < 5:
            dates.append(cursor.date().isoformat())
        cursor += timedelta(days=1)
    if count >= len(dates):
        selected = dates
    else:
        selected = [dates[round(index * (len(dates) - 1) / (count - 1))] for index in range(count)]
    return [{"t": value, "c": 100 + index} for index, value in enumerate(selected)]


def load_fetcher_module():
    spec = importlib.util.spec_from_file_location("stockanalysis_fetcher", FETCHER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load fetcher module from {FETCHER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StockanalysisFetcherFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fetcher = load_fetcher_module()

    def test_attempt_tracker_emits_empty_yahoo_and_http_universe_with_distinct_ids(self) -> None:
        original_run = self.fetcher.subprocess.run
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)

        self.fetcher.subprocess.run = fake_run
        try:
            tracker = self.fetcher.StockAnalysisAttemptTracker()
            tracker.configure(active=True, yahoo_enabled=True, run_id="123", run_attempt=1)
            tracker.start_universe()
            tracker.record_universe_http(200, [{"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust"}])
            tracker.emit()
        finally:
            self.fetcher.subprocess.run = original_run

        self.assertEqual(len(calls), 2)
        by_lane = {
            args[args.index("--lane") + 1]: (args, json.loads(kwargs["input"]))
            for args, kwargs in calls
        }
        yahoo_args, yahoo = by_lane["yahoo_etf_fallback"]
        universe_args, universe = by_lane["stockanalysis_etf_universe"]
        self.assertEqual(yahoo["candidate_count"], 0)
        self.assertEqual(yahoo["observations"], [])
        self.assertEqual(universe["observations"][0]["status_code"], 200)
        self.assertNotEqual(
            yahoo_args[yahoo_args.index("--attempt-id") + 1],
            universe_args[universe_args.index("--attempt-id") + 1],
        )

    def test_attempt_tracker_does_not_mislabel_disabled_gap_as_empty(self) -> None:
        original_run = self.fetcher.subprocess.run
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)

        self.fetcher.subprocess.run = fake_run
        try:
            tracker = self.fetcher.StockAnalysisAttemptTracker()
            tracker.configure(active=True, yahoo_enabled=False, run_id="124", run_attempt=1)
            tracker.record_yahoo_candidate()
            tracker.emit()
        finally:
            self.fetcher.subprocess.run = original_run

        self.assertEqual(len(calls), 1)
        envelope = json.loads(calls[0][1]["input"])
        self.assertEqual(envelope["candidate_count"], 1)
        self.assertFalse(envelope["fallback_enabled"])
        self.assertEqual(envelope["observations"], [])

    def test_attempt_tracker_emits_honest_empty_set_when_fallback_is_disabled(self) -> None:
        original_run = self.fetcher.subprocess.run
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)

        self.fetcher.subprocess.run = fake_run
        try:
            tracker = self.fetcher.StockAnalysisAttemptTracker()
            tracker.configure(active=True, yahoo_enabled=False, run_id="125", run_attempt=1)
            tracker.emit()
        finally:
            self.fetcher.subprocess.run = original_run

        self.assertEqual(len(calls), 1)
        envelope = json.loads(calls[0][1]["input"])
        self.assertEqual(envelope["candidate_count"], 0)
        self.assertFalse(envelope["fallback_enabled"])
        self.assertEqual(envelope["observations"], [])

    def test_yahoo_normal_returned_error_preserves_execution_and_library_evidence(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_tracker = self.fetcher.ATTEMPT_TRACKER

        class ReturnedErrorYahooModule:
            @staticmethod
            def fetch_with_retry(*_args, **_kwargs):
                return None, 17, "provider returned no data", {
                    "attempts_used": 3,
                    "latency_ms": 17,
                    "failures": [],
                }

        tracker = self.fetcher.StockAnalysisAttemptTracker()
        tracker.configure(active=True, yahoo_enabled=True, run_id="126", run_attempt=1)
        tracker.record_yahoo_candidate()
        self.fetcher.ATTEMPT_TRACKER = tracker
        self.fetcher.load_yf_finance_module = lambda: ReturnedErrorYahooModule
        try:
            with self.assertRaisesRegex(RuntimeError, "provider returned no data"):
                self.fetcher.fetch_yahoo_etf_fallback("MISS", mirror_public=False)
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.ATTEMPT_TRACKER = original_tracker

        self.assertEqual(tracker.yahoo_observations, [{
            "execution": "returned",
            "exception_kind": None,
            "retry_count": 2,
            "latency_ms": 17.0,
            "outcome": "error",
        }])

    def test_universe_post_fetch_type_error_is_worst_folded(self) -> None:
        original_fetch = self.fetcher.fetch_etf_universe
        original_write = self.fetcher.write_payload
        original_tracker = self.fetcher.ATTEMPT_TRACKER
        tracker = self.fetcher.StockAnalysisAttemptTracker()
        tracker.configure(active=True, yahoo_enabled=False, run_id="127", run_attempt=1)
        tracker.start_universe()
        tracker.record_universe_http(200, [{"ticker": "SPY", "name": "SPY ETF"}])
        self.fetcher.ATTEMPT_TRACKER = tracker
        self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: {"records": []}
        self.fetcher.write_payload = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            TypeError("post-fetch write failed")
        )
        try:
            with self.assertRaisesRegex(TypeError, "post-fetch write failed"):
                self.fetcher.fetch_etf_universe_with_recovery(
                    1,
                    1,
                    0,
                    False,
                    recovery_store=None,
                    recovery_run=None,
                )
        finally:
            self.fetcher.fetch_etf_universe = original_fetch
            self.fetcher.write_payload = original_write
            self.fetcher.ATTEMPT_TRACKER = original_tracker

        self.assertEqual(tracker.universe_observations[-1], {
            "execution": "threw",
            "exception_kind": "unexpected",
        })

    def test_endpoint_canary_failure_emits_non_ready_r4_producer_failure(self) -> None:
        original_canary = self.fetcher.run_endpoint_canary
        original_write = self.fetcher.write_payload
        original_run = self.fetcher.subprocess.run
        original_argv = sys.argv
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)

        self.fetcher.run_endpoint_canary = lambda *_args, **_kwargs: {
            "status": "blocked",
            "counts": {"ready": 0, "probes": 1, "blocked": 1},
        }
        self.fetcher.write_payload = lambda *_args, **_kwargs: None
        self.fetcher.subprocess.run = fake_run
        sys.argv = [
            "fetch-stockanalysis.py",
            "--endpoint-canary",
            "--stocks-only",
            "--run-id",
            "canary-test",
        ]
        try:
            with self.assertRaises(SystemExit) as caught:
                self.fetcher.main()
        finally:
            self.fetcher.run_endpoint_canary = original_canary
            self.fetcher.write_payload = original_write
            self.fetcher.subprocess.run = original_run
            sys.argv = original_argv

        self.assertEqual(caught.exception.code, 3)
        self.assertEqual(len(calls), 1)
        envelope = json.loads(calls[0][1]["input"])
        self.assertEqual(envelope["candidate_count"], 0)
        self.assertEqual(envelope["observations"], [])
        self.assertEqual(envelope["producer_failure"], {
            "execution": "threw",
            "exception_kind": "unexpected",
        })

    def test_svelte_devalue_surface_fixture(self) -> None:
        payload = json.loads((FIXTURE_DIR / "new_etfs__data.fixture.json").read_text(encoding="utf-8"))
        decoded = self.fetcher.extract_svelte_node(payload, ("data",))

        self.assertEqual(decoded["data"][0]["s"], "AAA")
        self.assertEqual(decoded["data"][1]["n"], "Beta Balance ETF")
        self.assertEqual(decoded["dataPoints"], ["s", "n", "as"])

    def test_etf_detail_svelte_contract_fixtures_and_provenance(self) -> None:
        overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        od = self.fetcher.validate_svelte_detail_contract(overview, "overview")
        hd = self.fetcher.validate_svelte_detail_contract(holdings, "holdings")
        self.assertEqual(od["holdingsTable"]["holdings"][0]["s"], "AAPL")
        self.assertEqual(hd["holdings"][0]["s"], "AAPL")
        self.assertEqual(hd["countries"][0]["country"], "United States")

        sparse = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        sparse["nodes"][-1]["data"][0]["sectors"] = -1
        sparse["nodes"][-1]["data"][0]["countries"] = -1
        sparse_decoded = self.fetcher.validate_svelte_detail_contract(sparse, "holdings")
        self.assertIsNone(sparse_decoded["sectors"])
        self.assertIsNone(sparse_decoded["countries"])

        sparse_overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        sparse_overview["nodes"][-1]["data"][0]["holdings"] = -1
        sparse_overview["nodes"][-1]["data"][0]["holdingsTable"] = -1
        sparse_overview["nodes"][-1]["data"][0]["inception"] = -1
        sparse_overview_decoded = self.fetcher.validate_svelte_detail_contract(sparse_overview, "overview")
        self.assertIsNone(sparse_overview_decoded["holdings"])
        self.assertIsNone(sparse_overview_decoded["holdingsTable"])
        self.assertIsNone(sparse_overview_decoded["inception"])

    def test_empty_holdings_node_requires_explicit_overview_unavailable_profile(self) -> None:
        empty_holdings = {
            "nodes": [
                {"data": [{"info": 1}, {"type": 2, "ticker": 3}, "etf", "NEW"]},
            ]
        }
        original_fetch_json = self.fetcher.fetch_json
        try:
            self.fetcher.fetch_json = lambda _path, _timeout: empty_holdings
            with self.assertRaisesRegex(ValueError, "missing_required"):
                self.fetcher.fetch_svelte_detail("NEW", "holdings", 1)
            path, decoded = self.fetcher.fetch_svelte_detail(
                "NEW", "holdings", 1, allow_unavailable=True
            )
        finally:
            self.fetcher.fetch_json = original_fetch_json
        self.assertEqual(path, "/etf/new/holdings/__data.json")
        self.assertEqual(decoded, {})

    def test_sparse_holdings_contract_accepts_provider_partial_metadata(self) -> None:
        sparse = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        for key in ("count", "countries", "date"):
            sparse["nodes"][-1]["data"][0].pop(key)

        decoded = self.fetcher.validate_svelte_detail_contract(sparse, "holdings")

        self.assertIsInstance(decoded["holdings"], list)
        self.assertIsInstance(decoded["sectors"], list)
        self.assertNotIn("count", decoded)
        self.assertNotIn("countries", decoded)
        self.assertNotIn("date", decoded)

    def test_initial_detail_reconcile_emits_honest_stockanalysis_partial(self) -> None:
        original_fetch_svelte = self.fetcher.fetch_svelte_detail
        original_fetch_json = self.fetcher.fetch_json
        original_fetch_history = self.fetcher.fetch_etf_history_periods
        history_called = False

        def fake_fetch_svelte(ticker: str, surface: str, _timeout: int, **_kwargs):
            if surface == "overview":
                return f"/etf/{ticker.lower()}/__data.json", {
                    "holdings": 2,
                    "holdingsTable": None,
                    "inception": "Jan 1, 2024",
                }
            return f"/etf/{ticker.lower()}/holdings/__data.json", {
                "holdings": [{"s": "GLD", "n": "SPDR Gold Shares", "w": 100}],
                "sectors": [],
            }

        def fake_fetch_json(_path: str, _timeout: int) -> dict:
            self.fail("initial reconcile must not fetch quote or history endpoints")

        def fake_fetch_history(_ticker: str, _timeout: int):
            nonlocal history_called
            history_called = True
            return {}, {}, {}

        self.fetcher.fetch_svelte_detail = fake_fetch_svelte
        self.fetcher.fetch_json = fake_fetch_json
        self.fetcher.fetch_etf_history_periods = fake_fetch_history
        try:
            payload = self.fetcher.fetch_etf(
                "AAAU",
                1,
                include_history=False,
                include_quote=False,
                allow_partial_holdings=True,
            )
        finally:
            self.fetcher.fetch_svelte_detail = original_fetch_svelte
            self.fetcher.fetch_json = original_fetch_json
            self.fetcher.fetch_etf_history_periods = original_fetch_history

        self.assertFalse(history_called)
        self.assertEqual(payload["detail_status"], "stockanalysis_partial")
        self.assertIn("history_deferred_initial_reconcile", payload["partial_reason_codes"])
        self.assertIn("quote_deferred_initial_reconcile", payload["partial_reason_codes"])
        self.assertIn("holdings_count_unavailable", payload["partial_reason_codes"])
        self.assertIn("holdings_date_unavailable", payload["partial_reason_codes"])
        self.assertIn("holdings_countries_unavailable", payload["partial_reason_codes"])
        self.assertEqual(payload["normalized"]["holding_count"], 1)
        self.assertIsNone(payload["source_as_of"])
        self.assertEqual(
            payload["source_as_of_reason"],
            "provider detail response carries no market or holdings observation date",
        )

    def test_reconcile_accepts_valid_overview_when_holdings_surface_omits_holdings(self) -> None:
        original_fetch_svelte = self.fetcher.fetch_svelte_detail

        def fake_fetch_svelte(ticker: str, surface: str, _timeout: int, **_kwargs):
            if surface == "overview":
                return f"/etf/{ticker.lower()}/__data.json", {
                    "holdings": 12,
                    "holdingsTable": {"count": 12},
                    "inception": "Jan 1, 2026",
                }
            raise ValueError(
                "svelte_contract_drift:holdings:missing_required:holdings"
            )

        self.fetcher.fetch_svelte_detail = fake_fetch_svelte
        try:
            with self.assertRaisesRegex(ValueError, "missing_required:holdings"):
                self.fetcher.fetch_etf("AAOX", 1, include_history=False)
            payload = self.fetcher.fetch_etf(
                "AAOX",
                1,
                include_history=False,
                include_quote=False,
                allow_partial_holdings=True,
            )
        finally:
            self.fetcher.fetch_svelte_detail = original_fetch_svelte

        self.assertEqual(payload["detail_status"], "stockanalysis_partial")
        self.assertEqual(payload["normalized"]["holdings"], [])
        self.assertIn("holdings_unavailable", payload["partial_reason_codes"])
        self.assertIn(
            "holdings_surface_omits_holdings",
            payload["partial_reason_codes"],
        )
        self.assertIsNone(payload["source_as_of"])

    def test_reconcile_uses_provider_overview_holdings_updated_as_source_date(self) -> None:
        original_fetch_svelte = self.fetcher.fetch_svelte_detail

        def fake_fetch_svelte(ticker: str, surface: str, _timeout: int, **_kwargs):
            if surface == "overview":
                return f"/etf/{ticker.lower()}/__data.json", {
                    "holdings": 12,
                    "holdingsTable": {"count": 12, "updated": "Jul 10, 2026"},
                    "inception": "Jan 1, 2026",
                }
            raise ValueError(
                "svelte_contract_drift:holdings:missing_required:holdings"
            )

        self.fetcher.fetch_svelte_detail = fake_fetch_svelte
        try:
            payload = self.fetcher.fetch_etf(
                "AAOX",
                1,
                include_history=False,
                include_quote=False,
                allow_partial_holdings=True,
            )
        finally:
            self.fetcher.fetch_svelte_detail = original_fetch_svelte

        self.assertEqual(payload["source_as_of"], "2026-07-10T00:00:00Z")
        self.assertNotIn("source_as_of_reason", payload)
        self.fetcher.validate_stockanalysis_etf_payload("AAOX", payload)

    def test_etf_history_expected_400_is_recorded_as_unavailable_not_schema_drift(self) -> None:
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                if "period=Daily" in path:
                    raise urllib.error.HTTPError(path, 400, "not indexed", {}, None)
                return {"status": 200, "data": []}
            self.fetcher.fetch_json = fake_fetch_json
            paths, periods, errors = self.fetcher.fetch_etf_history_periods("NEW", 1)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(periods["daily_1y"], [])
        self.assertEqual(errors["daily_1y"]["reason_code"], "http_400")
        self.assertEqual(errors["daily_1y"]["path"], paths["daily_1y"])
        self.assertEqual(periods["monthly_1y"], [])

    def test_etf_detail_svelte_contract_fails_closed(self) -> None:
        for payload in ({}, {"nodes": []}, {"nodes": [{"data": [[{"x": 1}]]}]}):
            with self.assertRaises(ValueError):
                self.fetcher.validate_svelte_detail_contract(payload, "overview")

        wrong_type = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        wrong_type["nodes"][-1]["data"][1] = "two"
        with self.assertRaisesRegex(ValueError, "invalid_type:count"):
            self.fetcher.validate_svelte_detail_contract(wrong_type, "holdings")

    def test_etf_detail_paths_use_lowercase_svelte_routes(self) -> None:
        overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        calls = []
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                calls.append(path)
                if path == "/etf/vymi/__data.json":
                    return overview
                if path == "/etf/vymi/holdings/__data.json":
                    return holdings
                raise AssertionError(f"unexpected endpoint: {path}")

            self.fetcher.fetch_json = fake_fetch_json
            overview_path, _ = self.fetcher.fetch_svelte_detail("VYMI", "overview", 1)
            holdings_path, _ = self.fetcher.fetch_svelte_detail("VYMI", "holdings", 1)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(overview_path, "/etf/vymi/__data.json")
        self.assertEqual(holdings_path, "/etf/vymi/holdings/__data.json")
        self.assertFalse(any("/api/symbol/e/" in path for path in calls))

    def test_endpoint_canary_covers_current_detail_quote_and_history_contracts(self) -> None:
        overview = json.loads((FIXTURE_DIR / "etf_overview__data.fixture.json").read_text())
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        calls = []
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                calls.append(path)
                if path.endswith("/holdings/__data.json"):
                    return holdings
                if path.endswith("/__data.json"):
                    return overview
                if "/api/quotes/e/" in path:
                    return {"status": 200, "data": {"p": 100.0, "pd": 99.0}}
                if "/history?" in path:
                    return {"status": 200, "data": [{"t": "2026-07-10", "c": 100.0}]}
                raise AssertionError(path)

            self.fetcher.fetch_json = fake_fetch_json
            payload = self.fetcher.run_endpoint_canary(1, ("VYMI",))
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["counts"], {"probes": 4, "ready": 4, "blocked": 0})
        self.assertEqual({row["surface"] for row in payload["results"]}, {
            "overview", "holdings", "quote", "history_daily_1y",
        })
        self.assertFalse(any("/api/symbol/e/VYMI/overview" in path for path in calls))
        self.assertFalse(any("/api/symbol/e/VYMI/holdings" in path for path in calls))

    def test_endpoint_canary_reports_http_and_schema_drift_reason_codes(self) -> None:
        holdings = json.loads((FIXTURE_DIR / "etf_holdings__data.fixture.json").read_text())
        original_fetch_json = self.fetcher.fetch_json
        try:
            def fake_fetch_json(path: str, _timeout: int) -> dict:
                if path.endswith("/holdings/__data.json"):
                    return holdings
                if path.endswith("/__data.json"):
                    return {"nodes": []}
                if "/api/quotes/e/" in path:
                    raise urllib.error.HTTPError(path, 404, "missing", {}, None)
                return {"status": 200, "data": []}

            self.fetcher.fetch_json = fake_fetch_json
            payload = self.fetcher.run_endpoint_canary(1, ("VYMI",))
        finally:
            self.fetcher.fetch_json = original_fetch_json

        reasons = {row["surface"]: row["reason_code"] for row in payload["results"]}
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(reasons["overview"], "schema_drift")
        self.assertEqual(reasons["quote"], "http_404")
        self.assertEqual(reasons["history_daily_1y"], "schema_drift")

    def test_etf_universe_html_fixture(self) -> None:
        html = (FIXTURE_DIR / "etf_universe.fixture.html").read_text(encoding="utf-8")
        rows = self.fetcher.parse_etf_universe_page(html, page=3)

        self.assertEqual([row["ticker"] for row in rows], ["SPY", "TQQQ"])
        self.assertEqual(rows[0]["name"], "SPDR S&P 500 ETF Trust")
        self.assertEqual(rows[0]["aum"], 601_200_000_000.0)
        self.assertEqual(rows[1]["source_page"], 3)

    def test_etf_universe_record_count_uses_payload_and_file_fallback(self) -> None:
        self.assertEqual(self.fetcher.etf_universe_record_count({"counts": {"records": 7}, "records": []}), 7)
        self.assertEqual(self.fetcher.etf_universe_record_count({"records": [{"ticker": "AAA"}, {"ticker": "BBB"}]}), 2)

        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                out_dir.mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({"counts": {"records": 3}, "records": [{"ticker": "AAA"}]}),
                    encoding="utf-8",
                )

                self.assertEqual(self.fetcher.etf_universe_record_count(None), 3)
        finally:
            self.fetcher.OUT_DIR = original_out_dir

    def test_etf_universe_refuses_truncated_pagination(self) -> None:
        original_fetch_text = self.fetcher.fetch_text
        original_parse = self.fetcher.parse_etf_universe_page
        try:
            self.fetcher.fetch_text = lambda _path, _timeout: (
                '<link rel="next" href="https://stockanalysis.com/etf/?page=2">'
            )
            self.fetcher.parse_etf_universe_page = lambda _html, page: [
                {"ticker": "AAA", "name": "Alpha ETF", "source_page": page}
            ]
            with self.assertRaisesRegex(RuntimeError, "refusing to publish a truncated discovery"):
                self.fetcher.fetch_etf_universe(max_pages=1, timeout=1, sleep=0)
            with self.assertRaisesRegex(ValueError, "at least 1"):
                self.fetcher.fetch_etf_universe(max_pages=0, timeout=1, sleep=0)
        finally:
            self.fetcher.fetch_text = original_fetch_text
            self.fetcher.parse_etf_universe_page = original_parse

    def test_universe_transient_failure_retains_lkg_and_recovers_with_provenance(self) -> None:
        original_fetch = self.fetcher.fetch_etf_universe
        original_dirs = (
            self.fetcher.OUT_DIR,
            self.fetcher.PUBLIC_DIR,
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = (
                root / "data" / "admin" / "stockanalysis-recovery"
            )
            canonical = self.fetcher.OUT_DIR / "etf_universe.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "generated_at": "2026-07-15T07:00:00Z",
                "source_as_of": None,
                "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-07-15T07:00:00Z",
                "endpoint": "/etf/",
                "counts": {"records": 1, "pages": 1},
                "warnings": [],
                "pages": [{"page": 1, "path": "/etf/", "record_count": 1}],
                "records": [{"ticker": "AAA", "name": "AAA ETF", "source_page": 1}],
            }
            self.fetcher.write_json(canonical, lkg_payload)
            expected_lkg = canonical.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                self.fetcher.STOCKANALYSIS_RECOVERY_ROOT, root
            )
            bootstrap = {
                "run_id": "bootstrap",
                "run_attempt": 1,
                "event_name": "local",
                "observed_at": "2026-07-15T07:00:00Z",
            }
            failed_run = {
                "run_id": "universe-failed",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-07-15T08:00:00Z",
            }
            recovered_run = {
                "run_id": "universe-recovered",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-07-15T08:05:00Z",
            }
            store.bootstrap_existing(bootstrap)
            try:
                self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: (_ for _ in ()).throw(
                    TimeoutError("transient universe timeout")
                )
                failed = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=failed_run,
                )
                self.assertIsNone(failed)
                self.assertEqual(canonical.read_bytes(), expected_lkg)
                self.assertEqual(
                    (
                        store.root
                        / "lkg"
                        / "universe"
                        / "etf_universe.json"
                    ).read_bytes(),
                    expected_lkg,
                )
                failed_index = store.rebuild_index(failed_run)
                self.assertEqual(
                    store.assess_current_attempt(failed_index)["status"], "degraded"
                )

                advanced = {
                    **lkg_payload,
                    "generated_at": "2026-07-15T08:05:00Z",
                    "fetched_at": "2026-07-15T08:05:00Z",
                    "counts": {"records": 2, "pages": 1},
                    "pages": [{"page": 1, "path": "/etf/", "record_count": 2}],
                    "records": [
                        {"ticker": "AAA", "name": "AAA ETF", "source_page": 1},
                        {"ticker": "BBB", "name": "BBB ETF", "source_page": 1},
                    ],
                }
                self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: advanced
                recovered = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=recovered_run,
                )
            finally:
                self.fetcher.fetch_etf_universe = original_fetch
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
                ) = original_dirs

            self.assertEqual(recovered, advanced)
            state = json.loads(
                (store.root / "states" / "universe" / "etf_universe.json").read_text()
            )
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])
            self.assertEqual(state["recovered_from_run_id"], "universe-failed")

    def test_universe_controlled_failure_retains_lkg_before_fetch_then_recovers(self) -> None:
        original_fetch = self.fetcher.fetch_etf_universe
        original_dirs = (
            self.fetcher.OUT_DIR,
            self.fetcher.PUBLIC_DIR,
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.STOCKANALYSIS_RECOVERY_ROOT = (
                root / "data" / "admin" / "stockanalysis-recovery"
            )
            canonical = self.fetcher.OUT_DIR / "etf_universe.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1",
                "source": "stockanalysis",
                "asset_type": "etf",
                "generated_at": "2026-07-16T07:00:00Z",
                "source_as_of": None,
                "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-07-16T07:00:00Z",
                "endpoint": "/etf/",
                "counts": {"records": 1, "pages": 1},
                "warnings": [],
                "pages": [{"page": 1, "path": "/etf/", "record_count": 1}],
                "records": [{"ticker": "AAA", "name": "AAA ETF", "source_page": 1}],
            }
            self.fetcher.write_json(canonical, lkg_payload)
            expected_lkg = canonical.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                self.fetcher.STOCKANALYSIS_RECOVERY_ROOT, root
            )
            bootstrap = {
                "run_id": "bootstrap",
                "run_attempt": 1,
                "event_name": "local",
                "observed_at": "2026-07-16T07:00:00Z",
            }
            chaos_run = {
                "run_id": "universe-chaos",
                "run_attempt": 1,
                "event_name": "workflow_dispatch",
                "natural": False,
                "observed_at": "2026-07-16T08:00:00Z",
            }
            recovered_run = {
                "run_id": "universe-recovered",
                "run_attempt": 1,
                "event_name": "schedule",
                "natural": True,
                "observed_at": "2026-07-16T08:05:00Z",
            }
            store.bootstrap_existing(bootstrap)
            try:
                def _fail_if_called(*_args, **_kwargs):
                    raise AssertionError(
                        "controlled failure must raise before fetch_etf_universe runs"
                    )

                self.fetcher.fetch_etf_universe = _fail_if_called
                failed = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=chaos_run,
                    controlled_failure=True,
                )
                self.assertIsNone(failed)
                # LKG retained; the on-disk canonical payload was never overwritten.
                self.assertEqual(canonical.read_bytes(), expected_lkg)
                self.assertEqual(
                    (
                        store.root / "lkg" / "universe" / "etf_universe.json"
                    ).read_bytes(),
                    expected_lkg,
                )
                chaos_state = json.loads(
                    (store.root / "states" / "universe" / "etf_universe.json").read_text()
                )
                self.assertEqual(chaos_state["resolution_state"], "lkg_primary")
                self.assertTrue(chaos_state["retry"])
                self.assertTrue(chaos_state["latest_failure"]["controlled"])
                self.assertIn(
                    "controlled failure injection for universe:etf_universe",
                    chaos_state["latest_failure"]["error"],
                )
                failed_index = store.rebuild_index(chaos_run)
                self.assertEqual(
                    store.assess_current_attempt(failed_index)["status"], "degraded"
                )

                advanced = {
                    **lkg_payload,
                    "generated_at": "2026-07-16T08:05:00Z",
                    "fetched_at": "2026-07-16T08:05:00Z",
                    "counts": {"records": 2, "pages": 1},
                    "pages": [{"page": 1, "path": "/etf/", "record_count": 2}],
                    "records": [
                        {"ticker": "AAA", "name": "AAA ETF", "source_page": 1},
                        {"ticker": "BBB", "name": "BBB ETF", "source_page": 1},
                    ],
                }
                self.fetcher.fetch_etf_universe = lambda *_args, **_kwargs: advanced
                recovered = self.fetcher.fetch_etf_universe_with_recovery(
                    100,
                    1,
                    0,
                    False,
                    recovery_store=store,
                    recovery_run=recovered_run,
                )
            finally:
                self.fetcher.fetch_etf_universe = original_fetch
                (
                    self.fetcher.OUT_DIR,
                    self.fetcher.PUBLIC_DIR,
                    self.fetcher.STOCKANALYSIS_RECOVERY_ROOT,
                ) = original_dirs

            self.assertEqual(recovered, advanced)
            state = json.loads(
                (store.root / "states" / "universe" / "etf_universe.json").read_text()
            )
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])
            self.assertEqual(state["recovered_from_run_id"], "universe-chaos")

    def test_weekly_workflow_uses_fixed_complete_discovery_ceiling(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        self.assertIn("20 23 * * 0", workflow)
        self.assertIn('INPUT_MAX_UNIVERSE_PAGES="100"', workflow)
        self.assertNotIn("STOCKANALYSIS_WEEKLY_MAX_UNIVERSE_PAGES", workflow)

    def test_discovery_growth_delta_planner_stays_bounded_and_outside_source_writer(self) -> None:
        fixture = json.loads((FIXTURE_DIR / "core_basket_discovery_growth.fixture.json").read_text(encoding="utf-8"))
        planner = ROOT / "scripts" / "plan-stockanalysis-core-basket-delta.mjs"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            basket_path = tmp_path / "basket.json"
            fetched_path = tmp_path / "fetched.txt"
            delta_path = tmp_path / "delta.txt"
            basket_path.write_text(
                json.dumps({"daily_refresh_universe": {"tickers": fixture["selected_tickers"]}}),
                encoding="utf-8",
            )
            fetched_path.write_text("\n".join(fixture["fetched_tickers"]) + "\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "node",
                    str(planner),
                    "--basket",
                    str(basket_path),
                    "--fetched",
                    str(fetched_path),
                    "--output",
                    str(delta_path),
                    "--limit",
                    "40",
                    "--json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            plan = json.loads(result.stdout)
            self.assertEqual(plan["delta_tickers"], fixture["expected_delta_tickers"])
            self.assertEqual(delta_path.read_text(encoding="utf-8").splitlines(), fixture["expected_delta_tickers"])

            basket_path.write_text(
                json.dumps({"daily_refresh_universe": {"tickers": [f"NEW{i:02d}" for i in range(40)]}}),
                encoding="utf-8",
            )
            fetched_path.write_text("", encoding="utf-8")
            at_limit = subprocess.run(
                [
                    "node",
                    str(planner),
                    "--basket",
                    str(basket_path),
                    "--fetched",
                    str(fetched_path),
                    "--output",
                    str(delta_path),
                    "--limit",
                    "40",
                    "--json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(at_limit.stdout)["delta_count"], 40)

            basket_path.write_text(
                json.dumps({"daily_refresh_universe": {"tickers": [f"NEW{i:02d}" for i in range(41)]}}),
                encoding="utf-8",
            )
            fetched_path.write_text("", encoding="utf-8")
            overflow = subprocess.run(
                [
                    "node",
                    str(planner),
                    "--basket",
                    str(basket_path),
                    "--fetched",
                    str(fetched_path),
                    "--output",
                    str(delta_path),
                    "--limit",
                    "40",
                    "--json",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(overflow.returncode, 0)
            self.assertIn("delta 41 exceeds limit 40", overflow.stderr)

        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        self.assertNotIn("Fetch discovered Core Daily Basket delta once", workflow)
        self.assertNotIn("plan-stockanalysis-core-basket-delta.mjs", workflow)

        primary_step = workflow.split("- name: Run StockAnalysis fetch", 1)[1]
        primary_step = primary_step.split("- name: Refresh history-gap plan after live backfill", 1)[0]
        self.assertIn('ARGS="$ARGS --fail-on-error"', primary_step)

        manifest = (ROOT / ".github" / "workflows" / "update-manifest.yml").read_text(encoding="utf-8")
        self.assertIn("node scripts/build-fenok-etf-core-daily-basket.mjs --check", manifest)

    def test_central_writer_refreshes_daily1y_report_before_coverage_builder(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fenok-edge-krx-daily.yml").read_text(encoding="utf-8")
        report_command = "npm --prefix 100xfenok-next run build:history-gap-daily1y"
        coverage_command = "node scripts/build-fenok-edge-coverage-index.mjs"
        self.assertNotIn(report_command, workflow)
        self.assertNotIn(coverage_command, workflow)

        manifest = (ROOT / ".github" / "workflows" / "update-manifest.yml").read_text(encoding="utf-8")
        initial_build = manifest.split("      - name: Check if manifest changed", 1)[0]
        self.assertEqual(initial_build.count(report_command), 1)
        self.assertEqual(initial_build.count(coverage_command), 1)
        self.assertLess(initial_build.index(report_command), initial_build.index(coverage_command))

    def test_central_writer_builds_history_and_signals_before_etf_basket(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        report_command = "npm --prefix 100xfenok-next run build:history-gap-daily1y"
        signal_command = "node scripts/build-fenok-etf-signals.mjs"
        basket_command = "node scripts/build-fenok-etf-core-daily-basket.mjs --check"
        self.assertNotIn(report_command, workflow)
        self.assertNotIn(signal_command, workflow)

        manifest = (ROOT / ".github" / "workflows" / "update-manifest.yml").read_text(encoding="utf-8")
        initial_build = manifest.split("      - name: Check if manifest changed", 1)[0]
        self.assertEqual(initial_build.count(report_command), 1)
        self.assertEqual(initial_build.count(signal_command), 1)
        self.assertEqual(initial_build.count(basket_command), 1)
        self.assertLess(initial_build.index(signal_command), initial_build.index(basket_command))
        self.assertLess(initial_build.index(signal_command), initial_build.index(report_command))
        self.assertLess(initial_build.index(report_command), initial_build.index(basket_command))

        retry_build = manifest.split("      - name: Commit and push manifest (with rebase retry)", 1)[1]
        self.assertEqual(retry_build.count(report_command), 1)
        self.assertEqual(retry_build.count(signal_command), 1)
        self.assertEqual(retry_build.count(basket_command), 1)
        self.assertLess(retry_build.index(signal_command), retry_build.index(report_command))
        self.assertLess(retry_build.index(report_command), retry_build.index(basket_command))

        projection_command = "rsync -a --checksum --delete data/stockanalysis/ 100xfenok-next/public/data/stockanalysis/"
        override_command = "(cd 100xfenok-next && node sync-static-overrides.mjs)"
        kpi_command = "npm --prefix 100xfenok-next run build:fenok-data-health-kpi"
        retry_build = manifest.split("          for attempt in 1 2 3; do", 1)[1]
        self.assertLess(initial_build.index(projection_command), initial_build.index(kpi_command))
        self.assertLess(retry_build.index(projection_command), retry_build.index(kpi_command))
        self.assertLess(initial_build.index(projection_command), initial_build.index(override_command))
        self.assertLess(initial_build.index(override_command), initial_build.index(kpi_command))
        self.assertLess(retry_build.index(projection_command), retry_build.index(override_command))
        self.assertLess(retry_build.index(override_command), retry_build.index(kpi_command))
        self.assertEqual(manifest.count(override_command), 2)
        self.assertNotIn("sync-public-data.mjs --write", manifest)
        self.assertEqual(manifest.count("check-fenok-public-mirror-guard.mjs"), 2)
        self.assertEqual(manifest.count("100xfenok-next/public/data/stockanalysis/ \\"), 3)

        def path_lines(block: str) -> list[str]:
            return [line.strip().removesuffix("\\").strip() for line in block.splitlines() if line.strip()]

        initial_paths = path_lines(manifest.split("git diff --quiet \\", 1)[1].split("&& echo", 1)[0])
        retry_region = manifest.split("          for attempt in 1 2 3; do", 1)[1]
        retry_paths = path_lines(retry_region.split("if git diff --quiet \\", 1)[1].split("; then", 1)[0])
        staged_paths = path_lines(retry_region.split("git add -- \\", 1)[1].split("git commit -m", 1)[0])
        self.assertEqual(initial_paths, retry_paths)
        self.assertEqual(retry_paths, staged_paths)

    def test_generic_html_table_fixture(self) -> None:
        html = (FIXTURE_DIR / "generic_table.fixture.html").read_text(encoding="utf-8")
        tables = self.fetcher.parse_html_tables(html)

        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]["headers"], ["Symbol", "Company Name", "% Change"])
        self.assertEqual(tables[0]["records"][0]["symbol"], "NVDA")
        self.assertEqual(tables[0]["records"][0]["symbol_href"], "https://stockanalysis.com/stocks/nvda/")
        self.assertEqual(tables[0]["records"][0]["pct_change"], "2.5%")

    def test_surface_name_dedupe_and_validation(self) -> None:
        names = self.fetcher.parse_surface_names("new_etfs,new_etfs,earnings_calendar", "core")
        self.assertEqual(names, ["new_etfs", "earnings_calendar"])

        with self.assertRaises(SystemExit):
            self.fetcher.parse_surface_names("missing_surface", "core")

    def test_collection_date_rejects_future_and_malformed_values(self) -> None:
        self.assertEqual(self.fetcher.collection_date("2026-07-09T01:00:00Z"), "2026-07-09")
        self.assertIsNone(self.fetcher.collection_date("2026-02-31T00:00:00Z"))
        self.assertIsNone(self.fetcher.collection_date("2026-07-09junk"))
        self.assertIsNone(self.fetcher.collection_date("2099-01-01T00:00:00Z"))

    def test_surface_stamp_map_uses_consumer_ownership_and_rejects_unproven_prior_stamps(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                consumers = {
                    "surfaces": [
                        {"surface": "event_a", "consumers": [{"route": "/market/events"}]},
                        {"surface": "event_b", "consumers": [{"route": "/market/events"}]},
                        {"surface": "sector_a", "consumers": [{"route": "/sectors"}]},
                        {"surface": "etf_a", "consumers": [{"route": "/etfs"}]},
                    ]
                }
                (out_dir / "surface_consumers.json").write_text(json.dumps(consumers), encoding="utf-8")
                for name, stamp in {"event_a": "2026-07-09T01:00:00Z", "event_b": "2026-07-08T01:00:00Z", "sector_a": "2026-07-07T01:00:00Z", "etf_a": "2026-07-06T01:00:00Z"}.items():
                    (out_dir / "surfaces" / f"{name}.json").write_text(
                        json.dumps({"source_as_of": stamp, "fetched_at": "2026-07-12T00:00:00Z"}),
                        encoding="utf-8",
                    )
                ok_rows = [{"surface": name, "status": "ok", "error": None} for name in ("event_a", "event_b", "sector_a", "etf_a")]
                stamps = self.fetcher.build_surface_stamp_map([row["surface"] for row in ok_rows], ok_rows, None)
                self.assertEqual(stamps, {"market_events": "2026-07-08", "sectors": "2026-07-07", "etf_center": "2026-07-06"})

                duplicated_results = [*ok_rows, ok_rows[0]]
                duplicated = self.fetcher.build_surface_stamp_map(
                    [row["surface"] for row in duplicated_results], duplicated_results, None
                )
                self.assertIsNone(duplicated["market_events"], "duplicate result rows fail the affected domain closed")

                prior = {"source_as_of": {"market_events": "2026-06-30", "sectors": "2026-06-29", "etf_center": "2026-06-28"}}
                partial = self.fetcher.build_surface_stamp_map(["event_a"], [ok_rows[0]], prior)
                self.assertEqual(
                    partial,
                    {"market_events": None, "sectors": None, "etf_center": None},
                    "partial domains do not inherit legacy stamps without provider evidence",
                )

                failed_rows = [*ok_rows]
                failed_rows[1] = {"surface": "event_b", "status": "error", "error": "fixture"}
                failed = self.fetcher.build_surface_stamp_map([row["surface"] for row in failed_rows], failed_rows, prior)
                self.assertIsNone(failed["market_events"], "known full-domain failure clears the domain stamp")

                malformed_consumers = json.loads(json.dumps(consumers))
                malformed_consumers["surfaces"][0]["consumers"] = [{}]
                (out_dir / "surface_consumers.json").write_text(json.dumps(malformed_consumers), encoding="utf-8")
                self.assertEqual(
                    self.fetcher.build_surface_stamp_map([], [], prior),
                    {"market_events": None, "sectors": None, "etf_center": None},
                    "malformed ownership fails every domain closed",
                )

                consumers["surfaces"].append({"surface": "event_a", "consumers": [{"route": "/market/events"}]})
                (out_dir / "surface_consumers.json").write_text(json.dumps(consumers), encoding="utf-8")
                self.assertEqual(
                    self.fetcher.build_surface_stamp_map([], [], prior),
                    {"market_events": None, "sectors": None, "etf_center": None},
                    "duplicate ownership fails every domain closed",
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

    def test_etf_classification_preserves_collection_stamp(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.fetcher.OUT_DIR = Path(tmp) / "data"
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public"
                self.fetcher.OUT_DIR.mkdir(parents=True)
                payload = {"source_as_of": "2026-07-08", "records": [{"ticker": "AAA", "name": "AAA ETF"}], "counts": {}}
                (self.fetcher.OUT_DIR / "etf_universe.json").write_text(json.dumps(payload), encoding="utf-8")
                self.fetcher.classify_existing_etf_catalog("etf_universe.json", mirror_public=False)
                classified = json.loads((self.fetcher.OUT_DIR / "etf_universe.json").read_text(encoding="utf-8"))
                self.assertEqual(classified["source_as_of"], "2026-07-08")
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

    def test_parse_history_periods_dedupe_and_validation(self) -> None:
        periods = self.fetcher.parse_history_periods("monthly_3y,monthly_3y,monthly_5y")
        self.assertEqual(periods, ("monthly_3y", "monthly_5y"))

        with self.assertRaises(SystemExit):
            self.fetcher.parse_history_periods("monthly_99y")

    def test_workflow_history_gaps_only_passes_yahoo_fallback(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(encoding="utf-8")
        marker = 'elif [ "${INPUT_HISTORY_GAPS_ONLY:-false}" = "true" ]; then'
        branch = workflow.split(marker, 1)[1].split("else", 1)[0]

        self.assertIn("--history-gaps-only", branch)
        self.assertIn("--yf-etf-fallback", branch)

    def test_select_base_etfs_uses_default_focus_set_without_incremental_only(self) -> None:
        etfs = self.fetcher.select_base_etfs(
            [],
            stocks_only=False,
            universe_backfill=False,
            incremental_etf_backfill=True,
            incremental_etf_only=False,
        )

        self.assertIn("SPY", etfs)
        self.assertIn("QQQ", etfs)

    def test_select_base_etfs_incremental_only_skips_default_focus_set(self) -> None:
        etfs = self.fetcher.select_base_etfs(
            [],
            stocks_only=False,
            universe_backfill=False,
            incremental_etf_backfill=True,
            incremental_etf_only=True,
        )

        self.assertEqual(etfs, [])

    def test_select_base_etfs_incremental_only_keeps_explicit_etfs(self) -> None:
        etfs = self.fetcher.select_base_etfs(
            ["AAA", "BBB"],
            stocks_only=False,
            universe_backfill=False,
            incremental_etf_backfill=True,
            incremental_etf_only=True,
        )

        self.assertEqual(etfs, ["AAA", "BBB"])

    def test_financial_statement_fixture_contract(self) -> None:
        payload = json.loads((FIXTURE_DIR / "aapl_income_annual__data.fixture.json").read_text(encoding="utf-8"))
        decoded = self.fetcher.extract_financial_node(payload)
        normalized = self.fetcher.normalize_financial_statement("AAPL", "income", decoded)

        self.fetcher.validate_financial_statement(normalized)
        self.assertEqual(normalized["ticker"], "AAPL")
        self.assertEqual(normalized["period"], "annual")
        self.assertGreaterEqual(normalized["field_count"], 20)
        self.assertGreaterEqual(len(normalized["periods"]), 3)
        self.assertTrue(all(len(row["values"]) == len(normalized["periods"]) for row in normalized["rows"]))

    def test_devalue_negative_special_values_decode_as_none(self) -> None:
        decoded = self.fetcher.decode_svelte_data([
            {"value": -6, "ref": 1},
            "ok",
        ])

        self.assertIsNone(decoded["value"])
        self.assertEqual(decoded["ref"], "ok")

    def test_financial_rows_are_padded_to_period_count(self) -> None:
        normalized = self.fetcher.normalize_financial_statement(
            "GOOGL",
            "ratios",
            {
                "statement": "ratios",
                "period": "quarterly",
                "financialData": {
                    "datekey": ["2026-03-31", "2025-12-31", "2025-09-30"],
                    "assetturnover": [0.82, 0.81],
                },
                "map": [
                    {"id": "assetturnover", "title": "Asset Turnover", "format": "ratio"},
                ],
            },
        )

        self.assertEqual(normalized["rows"][0]["values"], [0.82, 0.81, None])

    def test_financial_statement_floor_blocks_empty_payloads(self) -> None:
        with self.assertRaises(ValueError):
            self.fetcher.validate_financial_statement(
                {
                    "ticker": "EMPTY",
                    "statement": "income",
                    "period": "annual",
                    "periods": ["2025-12-31"],
                    "rows": [],
                    "field_count": 0,
                }
            )

    def test_stock_payload_links_financials_summary_when_supplied(self) -> None:
        financials = {
            "fetched_at": "2026-06-18T00:00:00Z",
            "role": "financial statement cross-check candidate; not valuation SSOT",
            "summary": {"annual": {"income": {"field_count": 30, "period_count": 5}}},
        }
        original_fetch_json = self.fetcher.fetch_json
        self.fetcher.fetch_json = lambda _path, _timeout: {"status": 200, "data": {}}
        try:
            stock_payload = self.fetcher.fetch_stock("AAPL", timeout=1, financials=financials)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        self.assertEqual(stock_payload["financials_path"], "financials/AAPL.json")
        self.assertEqual(stock_payload["normalized"]["financials"]["path"], "financials/AAPL.json")
        self.assertEqual(stock_payload["normalized"]["financials"]["summary"], financials["summary"])

    def test_etf_payload_includes_classification_candidate(self) -> None:
        def fake_fetch_svelte_detail(
            _ticker: str,
            surface: str,
            _timeout: int,
            *,
            allow_unavailable: bool = False,
        ) -> tuple[str, dict]:
            self.assertFalse(allow_unavailable)
            if surface == "overview":
                return "/etf/nvdl/__data.json", {
                    "description": (
                        "The fund provides 2x leveraged exposure, less fees and expenses, "
                        "to the daily price movement for shares of NVIDIA Corporation stock."
                    ),
                    "aum": "$1.0B",
                    "holdings": 0,
                    "holdingsTable": {"count": 0, "holdings": []},
                    "inception": "Jan 1, 2023",
                    "performance": {"tr1m": 12.3, "trYTD": 45.6},
                }
            return "/etf/nvdl/holdings/__data.json", {
                "holdings": [],
                "count": 0,
                "date": "Jun 30, 2026",
                "sectors": [],
                "countries": [],
            }

        def fake_fetch_json(path: str, _timeout: int) -> dict:
            if "history?range=1Y&period=Daily" in path:
                return {"status": 200, "data": [{"t": "2026-06-18", "c": 101.0}]}
            if "history?range=1Y&period=Weekly" in path:
                return {"status": 200, "data": [{"t": "2026-06-15", "c": 100.0}]}
            if "history?range=1Y&period=Monthly" in path:
                return {"status": 200, "data": [{"t": "2026-06-01", "c": 99.0}]}
            if "history?range=3Y&period=Weekly" in path:
                return {"status": 200, "data": [{"t": "2026-06-08", "c": 98.0}]}
            if "history?range=3Y&period=Monthly" in path:
                return {"status": 200, "data": [{"t": "2026-06-01", "c": 97.0}]}
            if "history?range=5Y&period=Monthly" in path:
                return {"status": 200, "data": [{"t": "2026-06-01", "c": 96.0}]}
            return {"status": 200, "data": {}}

        original_fetch_json = self.fetcher.fetch_json
        original_fetch_svelte_detail = self.fetcher.fetch_svelte_detail
        self.fetcher.fetch_json = fake_fetch_json
        self.fetcher.fetch_svelte_detail = fake_fetch_svelte_detail
        try:
            payload = self.fetcher.fetch_etf("NVDL", timeout=1)
        finally:
            self.fetcher.fetch_json = original_fetch_json
            self.fetcher.fetch_svelte_detail = original_fetch_svelte_detail

        classification = payload["normalized"]["classification"]
        self.assertTrue(classification["is_leveraged"])
        self.assertEqual(classification["leverage_factor"], 2.0)
        self.assertTrue(classification["is_single_stock"])
        self.assertEqual(classification["underlying"], "NVIDIA Corporation")
        self.assertEqual(payload["normalized"]["performance"]["trYTD"], 45.6)
        self.assertEqual(payload["normalized"]["history"][0]["c"], 99.0)
        self.assertEqual(payload["normalized"]["history_periods"]["daily_1y"][0]["c"], 101.0)
        self.assertEqual(payload["normalized"]["history_periods"]["weekly_1y"][0]["c"], 100.0)
        self.assertEqual(payload["normalized"]["history_periods"]["monthly_1y"][0]["c"], 99.0)
        self.assertEqual(payload["normalized"]["history_periods"]["weekly_3y"][0]["c"], 98.0)
        self.assertEqual(payload["normalized"]["history_periods"]["monthly_3y"][0]["c"], 97.0)
        self.assertEqual(payload["normalized"]["history_periods"]["monthly_5y"][0]["c"], 96.0)
        self.assertIn("monthly_3y", payload["endpoints"]["history_periods"])
        self.assertIn("monthly_5y", payload["endpoints"]["history_periods"])
        self.assertEqual(payload["endpoints"]["overview"], "/etf/nvdl/__data.json")
        self.assertEqual(payload["endpoint_contracts"]["overview"]["decoder"], "svelte_devalue_node/v1")

    def test_etf_catalog_enrichment_promotes_detail_metrics(self) -> None:
        detail_index = {
            "VOO": {
                "source": "stockanalysis",
                "ticker": "VOO",
                "normalized": {
                    "overview": {
                        "expenseRatio": "0.03%",
                        "dividendYield": "1.04%",
                        "sharesOut": "2.36B",
                        "inception": "Sep 7, 2010",
                        "provider_page": "vanguard",
                        "etf_website": "https://investor.vanguard.com/investment-products/etfs/profile/voo",
                    },
                    "holdings": [],
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.overview.description",
                        "confidence": "high",
                    },
                },
                "raw": {
                    "overview": {
                        "performance": {
                            "tr1m": 1.069,
                            "trYTD": 9.851,
                            "tr1y": 26.503,
                        }
                    }
                },
            }
        }

        enriched = self.fetcher.enrich_etf_records(
            [{"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "category": "Equity"}],
            detail_index,
        )[0]

        self.assertEqual(enriched["expenseRatio"], "0.03%")
        self.assertEqual(enriched["expense_ratio"], 0.03)
        self.assertEqual(enriched["dividend_yield"], 1.04)
        self.assertEqual(enriched["inceptionDate"], "Sep 7, 2010")
        self.assertEqual(enriched["performance"]["tr1y"], 26.503)
        self.assertFalse(enriched["classification"]["is_leveraged"])
        self.assertEqual(enriched["classification"]["confidence"], "high")
        counts = self.fetcher.etf_detail_enrichment_counts([enriched])
        self.assertEqual(counts["expense_ratio"], 1)
        self.assertEqual(counts["performance"], 1)

    def test_etf_catalog_classification_keeps_detail_primary_and_row_fallback(self) -> None:
        detail_index = {
            "PLAIN": {
                "normalized": {
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.overview.description",
                        "confidence": "high",
                    }
                }
            },
            "ADIU": {
                "normalized": {
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.overview.description",
                        "confidence": "high",
                    }
                }
            },
            "LOWFALSE": {
                "normalized": {
                    "classification": {
                        "is_leveraged": False,
                        "leverage_factor": None,
                        "is_inverse": False,
                        "is_single_stock": False,
                        "underlying": None,
                        "source": "stockanalysis.etf_list.name",
                        "confidence": "low",
                    }
                }
            },
        }

        enriched = self.fetcher.enrich_etf_records(
            [
                {"ticker": "PLAIN", "name": "Plain Vanilla ETF", "category": "Equity"},
                {"ticker": "ADIU", "name": "Leverage Shares 2X Long ADI Daily ETF", "category": "Equity"},
                {"ticker": "ROWONLY", "name": "Leverage Shares 2X Long ADI Daily ETF", "category": "Equity"},
                {"ticker": "LOWFALSE", "name": "Leverage Shares 2X Long ADI Daily ETF", "category": "Equity"},
            ],
            detail_index,
        )

        self.assertIn("classification", enriched[0])
        self.assertFalse(enriched[0]["classification"]["is_leveraged"])
        self.assertEqual(enriched[0]["classification"]["confidence"], "high")
        self.assertFalse(enriched[1]["classification"]["is_leveraged"])
        self.assertEqual(enriched[1]["classification"]["confidence"], "high")
        self.assertTrue(enriched[2]["classification"]["is_leveraged"])
        self.assertEqual(enriched[2]["classification"]["leverage_factor"], 2.0)
        self.assertTrue(enriched[2]["classification"]["is_single_stock"])
        self.assertTrue(enriched[3]["classification"]["is_leveraged"])
        self.assertEqual(enriched[3]["classification"]["leverage_factor"], 2.0)
        self.assertTrue(enriched[3]["classification"]["is_single_stock"])

        counts = self.fetcher.etf_classification_counts(enriched)
        self.assertEqual(counts["classified"], 4)
        self.assertEqual(counts["coverage_pct"], 100.0)
        self.assertEqual(counts["leveraged"], 2)

    def test_incremental_etf_backfill_selects_missing_fallback_and_stale(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "stockanalysis"
            self.fetcher.OUT_DIR = out_dir
            (out_dir / "surfaces").mkdir(parents=True)
            (out_dir / "etfs").mkdir(parents=True)
            (out_dir / "surfaces" / "new_etfs.json").write_text(
                json.dumps(
                    {
                        "records": [
                            {"s": "ADIU", "n": "Leverage Shares 2X Long ADI Daily ETF"},
                            {"s": "FNG", "n": "FNG ETF"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (out_dir / "etfs" / "FNG.json").write_text(
                json.dumps(
                    {
                        "source": "yahoo_finance",
                        "source_provider": "yahoo_finance",
                        "detail_status": "yf_fallback",
                        "fetched_at": "2026-06-18T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            (out_dir / "etfs" / "OLD.json").write_text(
                json.dumps(
                    {
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2020-01-01T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )

            summary = self.fetcher.incremental_etf_backfill_candidates(
                universe_payload={"records": [{"ticker": "OLD"}]},
                limit=10,
                max_age_hours=1,
                exclude=set(),
            )
        self.fetcher.OUT_DIR = original_out_dir

        selected = {row["ticker"]: row["reason"] for row in summary["selected"]}
        self.assertEqual(selected["ADIU"], "missing")
        self.assertEqual(selected["FNG"], "fallback_retry")
        self.assertEqual(selected["OLD"], "stale")
        self.assertEqual(summary["counts"]["selected"], 3)

    def test_incremental_etf_backfill_prioritizes_missing_universe_before_fallback_retry(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp) / "stockanalysis"
            self.fetcher.OUT_DIR = out_dir
            (out_dir / "surfaces").mkdir(parents=True)
            (out_dir / "etfs").mkdir(parents=True)
            (out_dir / "surfaces" / "new_etfs.json").write_text(
                json.dumps(
                    {
                        "records": [
                            {"s": "ADIU", "n": "Leverage Shares 2X Long ADI Daily ETF"},
                            {"s": "FNG", "n": "FNG ETF"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (out_dir / "etfs" / "FNG.json").write_text(
                json.dumps(
                    {
                        "source": "yahoo_finance",
                        "source_provider": "yahoo_finance",
                        "detail_status": "yf_fallback",
                        "fetched_at": "2026-06-18T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )

            summary = self.fetcher.incremental_etf_backfill_candidates(
                universe_payload={"records": [{"ticker": "BETA"}]},
                limit=2,
                max_age_hours=720,
                exclude=set(),
            )
        self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["ADIU", "BETA"])
        self.assertEqual([row["reason"] for row in summary["selected"]], ["missing", "missing"])

    def test_incremental_etf_backfill_includes_screener_only_missing(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "surfaces" / "etf_screener.json").write_text(
                    json.dumps({"records": [{"s": "AMJB", "n": "ALERIAN MLP INDEX ETNS"}]}),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": []},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["AMJB"])
        self.assertEqual(summary["selected"][0]["source"], "etf_screener")
        self.assertEqual(summary["selected"][0]["reason"], "missing")
        self.assertEqual(summary["counts"]["missing"], 1)

    def test_incremental_etf_backfill_history_gaps_only_selects_existing_primary_gaps(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "etfs" / "AAA.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "overview": {
                                    "inception": "Jan 1, 2020",
                                },
                                "history_periods": {
                                    "monthly_1y": [{"t": "2026-06-01", "c": 100}],
                                    "monthly_3y": [],
                                }
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "BBB.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "history_periods": {
                                    "monthly_3y": [{"t": "2026-06-01", "c": 100}],
                                    "monthly_5y": [{"t": "2026-06-01", "c": 90}],
                                }
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "RECENT.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "overview": {
                                    "inception": "Jun 12, 2026",
                                },
                                "history_periods": {},
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "YF.json").write_text(
                    json.dumps(
                        {
                            "source": "yahoo_finance",
                            "source_provider": "yahoo_finance",
                            "detail_status": "yf_fallback",
                            "fetched_at": "2026-06-18T00:00:00Z",
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "AAA"}, {"ticker": "BBB"}, {"ticker": "CCC"}, {"ticker": "RECENT"}, {"ticker": "YF"}]},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=datetime(2026, 6, 18, tzinfo=timezone.utc),
                    required_history_periods=("monthly_3y", "monthly_5y"),
                    history_gaps_only=True,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["AAA"])
        self.assertEqual(summary["selected"][0]["reason"], "history_gap")
        self.assertEqual(summary["selected"][0]["missing_history_periods"], ["monthly_3y", "monthly_5y"])
        self.assertEqual(summary["counts"]["history_gap"], 1)
        self.assertEqual(summary["counts"]["inception_limited_history_gap"], 1)
        self.assertEqual(summary["counts"]["total_history_gap"], 2)
        self.assertEqual([row["ticker"] for row in summary["inception_limited"]], ["RECENT"])
        self.assertEqual(summary["inception_limited"][0]["inception_date"], "2026-06-12")
        self.assertEqual(summary["inception_limited"][0]["inception_limited_history_periods"], ["monthly_3y", "monthly_5y"])
        self.assertEqual(summary["counts"]["missing"], 0)
        self.assertEqual(summary["counts"]["fallback_retry"], 0)

    def test_daily_1y_series_evidence_boundaries(self) -> None:
        rows_20 = weekday_rows("2026-06-22", 20)
        at_age_10 = datetime(2026, 7, 31, tzinfo=timezone.utc)
        at_age_11 = datetime(2026, 8, 3, tzinfo=timezone.utc)
        evidence = self.fetcher.daily_1y_series_evidence(rows_20, at_age_10)
        self.assertEqual(evidence["valid_unique_date_count"], 20)
        self.assertEqual(evidence["density"], 1.0)
        self.assertEqual(evidence["latest_business_day_age"], 10)
        self.assertTrue(evidence["eligible"])
        self.assertFalse(self.fetcher.daily_1y_series_evidence(rows_20, at_age_11)["gates"]["latest_business_day_age"])
        self.assertFalse(
            self.fetcher.daily_1y_series_evidence(rows_20[:19], at_age_10)["gates"]["min_rows"]
        )

        weekdays_25 = weekday_rows("2026-06-01", 25)
        exact_density = weekdays_25[:10] + weekdays_25[15:]
        below_density = exact_density[:-1]
        exact = self.fetcher.daily_1y_series_evidence(exact_density, datetime(2026, 7, 6, tzinfo=timezone.utc))
        below = self.fetcher.daily_1y_series_evidence(below_density, datetime(2026, 7, 6, tzinfo=timezone.utc))
        self.assertEqual(exact["density"], 0.8)
        self.assertTrue(exact["gates"]["density"])
        self.assertFalse(below["gates"]["density"])

        gap_15 = [{"t": "2026-06-01"}, {"t": "2026-06-16"}]
        gap_16 = [{"t": "2026-06-01"}, {"t": "2026-06-17"}]
        self.assertTrue(
            self.fetcher.daily_1y_series_evidence(gap_15, datetime(2026, 6, 17, tzinfo=timezone.utc))["gates"]["max_internal_gap"]
        )
        self.assertFalse(
            self.fetcher.daily_1y_series_evidence(gap_16, datetime(2026, 6, 17, tzinfo=timezone.utc))["gates"]["max_internal_gap"]
        )

    def test_daily_1y_history_classification_is_fail_closed_and_provenanced(self) -> None:
        now_dt = datetime(2026, 7, 12, tzinfo=timezone.utc)
        recent_rows = weekday_rows("2026-05-04", 45)

        def payload(rows: list[dict], inception: str | None = None) -> dict:
            overview = {"inception": inception} if inception else {}
            return {
                "source": "stockanalysis",
                "asset_type": "etf",
                "normalized": {
                    "overview": overview,
                    "history_periods": {"daily_1y": rows},
                },
            }

        unconfirmed = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
        )
        self.assertEqual(unconfirmed["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(unconfirmed["daily_1y_classification_reason"], "unconfirmed_short_history")
        self.assertIsNone(unconfirmed["effective_history_start_date"])
        pending_once = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 1,
                "short_history_evidence": {"earliest_date": "2026-05-04"},
            },
        )
        self.assertEqual(pending_once["fetchable_missing_history_periods"], ["daily_1y"])

        stable = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "short_history_evidence": {"earliest_date": "2026-05-04"},
            },
        )
        self.assertEqual(stable["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(stable["daily_1y_classification_reason"], "inception_limited_observation_derived")
        self.assertEqual(stable["effective_history_start_date"], "2026-05-04")
        self.assertEqual(stable["effective_history_start_source"], "daily_1y_stable_observation_start")
        self.assertIsNone(stable["declared_inception_date"])

        yf_confirmed = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            yf_rows=weekday_rows("2026-05-01", 41),
        )
        self.assertEqual(yf_confirmed["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(yf_confirmed["effective_history_start_source"], "daily_1y_cross_provider_start")

        declared = self.fetcher.history_gap_classification(
            payload(recent_rows, "May 1, 2026"),
            ("daily_1y",),
            now_dt,
        )
        self.assertEqual(declared["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(declared["daily_1y_classification_reason"], "inception_limited_declared")
        self.assertEqual(declared["declared_inception_date"], "2026-05-01")

        provider_limited = self.fetcher.history_gap_classification(
            payload(recent_rows, "Jan 1, 2020"),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "short_history_evidence": {"earliest_date": "2026-05-04"},
            },
        )
        self.assertEqual(provider_limited["terminal_limited_history_periods"], ["daily_1y"])
        self.assertEqual(provider_limited["daily_1y_classification_reason"], "provider_history_start_limited")
        self.assertEqual(provider_limited["declared_inception_date"], "2020-01-01")
        self.assertEqual(provider_limited["effective_history_start_date"], "2026-05-04")

        yf_full = weekday_rows("2025-08-01", 200)
        truncated = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            yf_rows=yf_full,
            pending_entry={"stable_observation_count": 3},
        )
        self.assertTrue(truncated["provider_truncated_suspected"])
        self.assertEqual(truncated["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(truncated["daily_1y_classification_reason"], "provider_truncated_suspected")

        sparse_rows = sampled_weekday_rows("2025-07-08", "2026-07-08", 190)
        sparse = self.fetcher.history_gap_classification(
            payload(sparse_rows, "May 19, 2023"),
            ("daily_1y",),
            now_dt,
            pending_entry={"stable_observation_count": 3},
        )
        self.assertEqual(sparse["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(sparse["daily_1y_classification_reason"], "full_span_sparse_history")

        duplicate_200 = self.fetcher.history_gap_classification(
            payload([{"t": "2026-06-01"}] * 200),
            ("daily_1y",),
            now_dt,
        )
        self.assertEqual(duplicate_200["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertEqual(duplicate_200["history_period_row_counts"]["daily_1y"], 1)

        mismatched_pending = self.fetcher.history_gap_classification(
            payload(recent_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "short_history_evidence": {"earliest_date": "2026-06-01"},
            },
        )
        self.assertEqual(mismatched_pending["fetchable_missing_history_periods"], ["daily_1y"])
        self.assertFalse(mismatched_pending["stable_observation_confirmed"])

        future_declared = self.fetcher.history_gap_classification(
            payload(recent_rows, "Aug 1, 2026"),
            ("daily_1y",),
            now_dt,
            yf_rows=weekday_rows("2026-05-01", 41),
        )
        self.assertEqual(future_declared["inception_limited_history_periods"], ["daily_1y"])
        self.assertTrue(future_declared["declared_inception_invalid_future"])
        self.assertFalse(future_declared["declared_inception_valid"])

        rolling_rows = weekday_rows("2026-06-03", 25)
        rolling = self.fetcher.history_gap_classification(
            payload(rolling_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "confirmed_history_start_date": "2026-05-04",
                "short_history_evidence": {"earliest_date": "2026-06-03"},
            },
        )
        self.assertEqual(rolling["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(rolling["effective_history_start_date"], "2026-05-04")

        boundary_rows = weekday_rows("2026-06-01", 25)
        boundary_364 = self.fetcher.history_gap_classification(
            payload(boundary_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "confirmed_history_start_date": "2025-07-13",
            },
        )
        boundary_365 = self.fetcher.history_gap_classification(
            payload(boundary_rows),
            ("daily_1y",),
            now_dt,
            pending_entry={
                "stable_observation_count": 2,
                "confirmed_history_start_date": "2025-07-12",
            },
        )
        self.assertEqual(boundary_364["inception_limited_history_periods"], ["daily_1y"])
        self.assertEqual(boundary_365["fetchable_missing_history_periods"], ["daily_1y"])

    def test_incremental_etf_backfill_daily1y_uses_exact_fetchable_plan(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir.parent / "admin").mkdir(parents=True)
                (out_dir / "etfs" / "PLANSHORT.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {
                                "history_periods": {
                                    "daily_1y": [{"t": "2026-06-01", "c": 100}],
                                },
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "OFFPLAN.json").write_text(
                    json.dumps(
                        {
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-06-18T00:00:00Z",
                            "normalized": {"history_periods": {"daily_1y": []}},
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "YF.json").write_text(
                    json.dumps(
                        {
                            "source": "yahoo_finance",
                            "source_provider": "yahoo_finance",
                            "detail_status": "yf_fallback",
                            "fetched_at": "2026-06-18T00:00:00Z",
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir.parent / "admin" / "fenok-edge-etf-daily1y-fetchable-plan.json").write_text(
                    json.dumps(
                        {
                            "schema_version": "fenok-edge-etf-daily1y-fetchable-plan/v0.1",
                            "tickers": ["PLANMISS", "PLANSHORT"],
                            "rows": [
                                {"ticker": "PLANMISS", "actual_rows": 0, "missing_file": True},
                                {
                                    "ticker": "PLANSHORT",
                                    "actual_rows": 1,
                                    "fetchable_missing": ["daily_1y"],
                                    "inception_limited_missing": [],
                                },
                            ],
                        }
                    ),
                    encoding="utf-8",
                )
                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={
                        "records": [
                            {"ticker": "PLANMISS"},
                            {"ticker": "PLANSHORT"},
                            {"ticker": "OFFPLAN"},
                            {"ticker": "YF"},
                        ]
                    },
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    required_history_periods=("daily_1y",),
                    history_gaps_only=True,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["PLANMISS", "PLANSHORT"])
        self.assertTrue(summary["selected"][0]["missing_file"])
        self.assertEqual(summary["selected"][1]["daily_1y_actual_rows"], 1)
        self.assertEqual(summary["selected"][1]["daily_1y_min_rows"], 200)
        self.assertEqual(summary["counts"]["selected"], 2)
        self.assertEqual(summary["counts"]["history_gap"], 2)
        self.assertEqual(summary["counts"]["daily_1y_missing_file"], 1)
        self.assertEqual(summary["counts"]["daily_1y_short_rows"], 1)
        self.assertEqual(summary["counts"]["missing"], 0)
        self.assertEqual(summary["counts"]["fallback_retry"], 0)

    def test_incremental_etf_backfill_daily1y_applies_offset_before_cooldown(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir.parent / "admin").mkdir(parents=True)
                plan_rows = [
                    {"ticker": "PLAN001", "actual_rows": 1, "fetchable_missing": ["daily_1y"]},
                    {"ticker": "PLAN002", "actual_rows": 2, "fetchable_missing": ["daily_1y"]},
                    {"ticker": "PLAN003", "actual_rows": 3, "fetchable_missing": ["daily_1y"]},
                    {"ticker": "PLAN004", "actual_rows": 4, "fetchable_missing": ["daily_1y"]},
                ]
                (out_dir.parent / "admin" / "fenok-edge-etf-daily1y-fetchable-plan.json").write_text(
                    json.dumps(
                        {
                            "schema_version": "fenok-edge-etf-daily1y-fetchable-plan/v0.1",
                            "tickers": [row["ticker"] for row in plan_rows],
                            "rows": plan_rows,
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "PLAN001": {
                                    "ticker": "PLAN001",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2026-07-20T00:00:00Z",
                                    "failure_reason": "HTTP Error 404: Not Found",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": []},
                    limit=2,
                    max_age_hours=720,
                    offset=2,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-07-12T00:00:00Z"),
                    required_history_periods=("daily_1y",),
                    history_gaps_only=True,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["PLAN003", "PLAN004"])
        self.assertEqual(summary["policy"]["offset"], 2)
        self.assertEqual(summary["counts"]["offset_skipped"], 2)
        self.assertEqual(summary["counts"]["scheduled_plan_rows"], 2)
        self.assertEqual(summary["counts"]["cooldown_skipped"], 0)
        self.assertEqual(summary["counts"]["selected"], 2)

    def test_incremental_etf_backfill_plan_payload_is_separate_from_run_proof(self) -> None:
        summary = {
            "counts": {
                "selected": 2,
                "candidates": 9,
                "history_gap": 9,
                "inception_limited_history_gap": 3,
                "total_history_gap": 12,
                "cooldown_skipped": 1,
            },
            "selected": [
                {"ticker": "AAA", "reason": "history_gap"},
                {"ticker": "BBB", "reason": "history_gap"},
            ],
        }

        payload = self.fetcher.build_incremental_etf_backfill_plan(
            ["AAA", "BBB"],
            summary,
            ("monthly_3y", "monthly_5y"),
            history_gaps_only=True,
        )

        self.assertEqual(payload["operation"], "incremental_etf_backfill_plan")
        self.assertEqual(payload["mode"], "history_gaps_only")
        self.assertEqual(payload["required_history_periods"], ["monthly_3y", "monthly_5y"])
        self.assertEqual(payload["counts"]["etfs_planned"], 2)
        self.assertEqual(payload["counts"]["incremental_selected"], 2)
        self.assertEqual(payload["counts"]["incremental_candidates"], 9)
        self.assertEqual(payload["counts"]["history_gap"], 9)
        self.assertEqual(payload["counts"]["inception_limited_history_gap"], 3)
        self.assertEqual(payload["counts"]["total_history_gap"], 12)
        self.assertEqual(payload["policy"]["network"], "none")
        self.assertIn("incremental_latest.json", payload["policy"]["execution_proof"])

    def test_write_incremental_plan_mirrors_without_latest_run_artifact(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                self.fetcher.OUT_DIR = tmp_path / "stockanalysis"
                self.fetcher.PUBLIC_DIR = tmp_path / "public" / "stockanalysis"
                payload = self.fetcher.build_incremental_etf_backfill_plan(
                    ["AAA"],
                    {"counts": {"selected": 1, "candidates": 1, "history_gap": 1, "cooldown_skipped": 0}, "selected": []},
                    ("monthly_3y", "monthly_5y"),
                    history_gaps_only=True,
                )

                self.fetcher.write_payload(self.fetcher.INCREMENTAL_PLAN_REL_PATH, payload, mirror_public=True)

                source_path = self.fetcher.OUT_DIR / "backfill" / "incremental_plan_latest.json"
                public_path = self.fetcher.PUBLIC_DIR / "backfill" / "incremental_plan_latest.json"
                self.assertTrue(source_path.exists())
                self.assertTrue(public_path.exists())
                self.assertFalse((self.fetcher.OUT_DIR / "backfill" / "incremental_latest.json").exists())
                self.assertEqual(json.loads(source_path.read_text(encoding="utf-8")), json.loads(public_path.read_text(encoding="utf-8")))
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

    def test_incremental_etf_backfill_skips_pending_ledger_cooldown(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "BETA": {
                                    "ticker": "BETA",
                                    "last_attempt_utc": "2026-06-18T00:00:00Z",
                                    "failure_reason": "HTTPError: HTTP Error 404: Not Found",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2026-06-25T00:00:00Z",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "BETA"}, {"ticker": "GAMMA"}]},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-06-18T12:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["GAMMA"])
        self.assertEqual(summary["counts"]["cooldown_skipped"], 1)
        self.assertEqual(summary["cooldown"][0]["ticker"], "BETA")

    def test_incremental_etf_backfill_allows_expired_pending_ledger(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "BETA": {
                                    "ticker": "BETA",
                                    "last_attempt_utc": "2026-06-01T00:00:00Z",
                                    "failure_reason": "HTTPError: HTTP Error 404: Not Found",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2026-06-08T00:00:00Z",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "BETA"}]},
                    limit=10,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-06-18T12:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["BETA"])
        self.assertEqual(summary["counts"]["cooldown_skipped"], 0)

    def test_etf_detail_coverage_uses_union_candidate_universe(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({"records": [{"ticker": "AAA"}, {"ticker": "BBB"}]}),
                    encoding="utf-8",
                )
                (out_dir / "surfaces" / "etf_screener.json").write_text(
                    json.dumps({"records": [{"s": "BBB"}, {"s": "CCC"}]}),
                    encoding="utf-8",
                )
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": "DDD"}]}),
                    encoding="utf-8",
                )
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "DDD": {
                                    "ticker": "DDD",
                                    "consecutive_failures": 3,
                                    "next_attempt_after_utc": "2099-01-01T00:00:00Z",
                                    "failure_reason": "ValueError: Yahoo fallback quoteType is not ETF/MUTUALFUND: EQUITY",
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "AAA.json").write_text(
                    json.dumps({"source": "stockanalysis", "asset_type": "etf"}),
                    encoding="utf-8",
                )
                (out_dir / "etfs" / "CCC.json").write_text(
                    json.dumps({"source": "yahoo_finance", "detail_status": "yf_fallback"}),
                    encoding="utf-8",
                )

                coverage = self.fetcher.build_etf_detail_coverage()
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual(coverage["counts"]["candidate_total"], 4)
        self.assertEqual(coverage["counts"]["covered_detail_files"], 2)
        self.assertEqual(coverage["counts"]["missing_detail_files"], 2)
        self.assertEqual(coverage["counts"]["source_breakdown"]["etf_universe"], 2)
        self.assertEqual(coverage["counts"]["source_breakdown"]["etf_screener"], 2)
        self.assertEqual(coverage["counts"]["source_breakdown"]["new_etfs"], 1)
        self.assertEqual(coverage["counts"]["yahoo_fallback_files"], 1)
        self.assertEqual(coverage["counts"]["pending_tracked_missing"], 1)
        self.assertEqual(coverage["missing_reason_summary"], {"external_quote_type_mismatch": 1, "untracked": 1})
        self.assertEqual(coverage["missing_status_summary"], {"retry_cooldown": 1, "untracked": 1})
        self.assertEqual(coverage["missing_reason_samples"]["external_quote_type_mismatch"], ["DDD"])
        self.assertEqual(coverage["missing_reason_samples"]["untracked"], ["BBB"])
        self.assertEqual(coverage["missing_tickers"], ["BBB", "DDD"])

    def test_incremental_etf_backfill_prioritizes_unattempted_missing_before_prior_failures(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "backfill" / "pending_ledger.json").write_text(
                    json.dumps(
                        {
                            "entries": {
                                "ADIU": {
                                    "ticker": "ADIU",
                                    "last_attempt_utc": "2026-06-18T00:00:00Z",
                                    "failure_reason": "HTTPError: HTTP Error 404: Not Found",
                                    "consecutive_failures": 1,
                                }
                            }
                        }
                    ),
                    encoding="utf-8",
                )
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": "ADIU"}, {"s": "BETA"}]}),
                    encoding="utf-8",
                )

                summary = self.fetcher.incremental_etf_backfill_candidates(
                    universe_payload={"records": [{"ticker": "GAMMA"}]},
                    limit=3,
                    max_age_hours=720,
                    exclude=set(),
                    now_dt=self.fetcher.parse_iso_timestamp("2026-06-18T12:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir

        self.assertEqual([row["ticker"] for row in summary["selected"]], ["BETA", "GAMMA", "ADIU"])
        self.assertEqual([row["prior_failures"] for row in summary["selected"]], [0, 0, 1])
        self.assertEqual(summary["counts"]["prior_failed_candidates"], 1)

    def test_pending_ledger_updates_expected_missing_and_clears_on_success(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                public_dir = Path(tmp) / "public" / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = public_dir
                selected = [{"ticker": "BETA"}]
                first = self.fetcher.update_pending_ledger(
                    results=[
                        {
                            "ticker": "BETA",
                            "asset_type": "etf",
                            "status": "error",
                            "provider": "yahoo_finance",
                            "error": "HTTPError: HTTP Error 404: Not Found",
                            "fallback_error": "RuntimeError: Yahoo fallback returned no data",
                        }
                    ],
                    selected_rows=selected,
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                )
                self.assertEqual(first["counts"]["tracked"], 1)
                self.assertEqual(first["counts"]["cooldown"], 1)
                self.assertEqual(first["entries"]["BETA"]["consecutive_failures"], 1)

                second = self.fetcher.update_pending_ledger(
                    results=[
                        {
                            "ticker": "BETA",
                            "asset_type": "etf",
                            "status": "ok",
                            "provider": "stockanalysis",
                            "error": None,
                        }
                    ],
                    selected_rows=selected,
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(second["counts"]["tracked"], 0)
        self.assertEqual(second["cleared"], ["BETA"])

    def test_provider_absence_is_degraded_coverage_state_not_fetch_failure(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({"records": [{"ticker": "ABSENT"}]}),
                    encoding="utf-8",
                )
                ledger = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "ABSENT",
                        "asset_type": "etf",
                        "status": "provider_coverage_gap",
                        "provider": "stockanalysis",
                        "provider_availability_status": "absent",
                        "provider_availability_reason": "provider_coverage_gap",
                        "provider_response": "HTTP 404",
                        "stockanalysis_error": "HTTPError: HTTP Error 404: Not Found",
                        "error": None,
                    }],
                    selected_rows=[{"ticker": "ABSENT"}],
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                    now_dt=self.fetcher.parse_iso_timestamp("2026-07-14T00:00:00Z"),
                )
                coverage = self.fetcher.build_etf_detail_coverage()
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        entry = ledger["entries"]["ABSENT"]
        self.assertEqual(entry["availability_status"], "provider_absent")
        self.assertEqual(entry["availability_reason"], "provider_coverage_gap")
        self.assertEqual(entry["provider_response"], "HTTP 404")
        self.assertEqual(entry["consecutive_failures"], 0)
        self.assertEqual(ledger["counts"]["provider_coverage_gaps"], 1)
        self.assertEqual(coverage["missing_reason_summary"], {"provider_coverage_gap": 1})
        self.assertEqual(coverage["missing_availability_summary"], {"provider_absent": 1})
        self.assertEqual(coverage["provider_absent_tickers"], ["ABSENT"])

    def test_missing_detail_reconcile_summary_counts_every_selected_response(self) -> None:
        summary = self.fetcher.build_missing_detail_reconcile_summary(
            initial_missing=["FETCH", "ABSENT", "BROKEN"],
            selected=["FETCH", "ABSENT", "BROKEN"],
            results=[
                {
                    "ticker": "FETCH",
                    "asset_type": "etf",
                    "status": "ok",
                    "provider": "stockanalysis",
                    "path": "etfs/FETCH.json",
                    "provider_availability_status": "available",
                    "provider_availability_reason": "provider_detail_contract_valid",
                    "provider_response": "HTTP 200 contract valid",
                    "error": None,
                },
                {
                    "ticker": "ABSENT",
                    "asset_type": "etf",
                    "status": "provider_coverage_gap",
                    "provider": "stockanalysis",
                    "path": None,
                    "provider_availability_status": "absent",
                    "provider_availability_reason": "provider_coverage_gap",
                    "provider_response": "HTTP 404",
                    "error": None,
                },
                {
                    "ticker": "BROKEN",
                    "asset_type": "etf",
                    "status": "error",
                    "provider": None,
                    "path": None,
                    "provider_availability_status": None,
                    "error": "HTTP Error 500",
                },
            ],
            coverage={"counts": {"missing_detail_files": 2}},
        )

        self.assertEqual(summary["counts"]["initial_missing"], 3)
        self.assertEqual(summary["counts"]["selected"], 3)
        self.assertEqual(summary["counts"]["fetchable_fetched"], 1)
        self.assertEqual(summary["counts"]["provider_absent"], 1)
        self.assertEqual(summary["counts"]["unresolved"], 1)
        self.assertEqual(summary["counts"]["remaining_missing"], 2)
        self.assertEqual(summary["provider_absent_tickers"], ["ABSENT"])
        self.assertEqual(summary["unresolved_tickers"], ["BROKEN"])
        self.assertEqual(summary["exit_assessment"]["status"], "degraded")
        self.assertNotIn("fail the run", summary["method"])

    def test_reconcile_mode_commits_partial_success_and_names_unresolved(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        original_run_one = self.fetcher.run_one
        original_argv = sys.argv
        original_stdout = sys.stdout
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                out_dir = temp_root / "data" / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = temp_root / "public" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                (out_dir / "etf_universe.json").parent.mkdir(parents=True)
                (out_dir / "etf_universe.json").write_text(
                    json.dumps({
                        "records": [
                            {"ticker": "FETCH"},
                            {"ticker": "ABSENT"},
                            {"ticker": "BROKEN"},
                        ]
                    }),
                    encoding="utf-8",
                )

                def fake_run_one(kind: str, ticker: str, *_args, **kwargs) -> dict:
                    self.assertEqual(kind, "etf")
                    self.assertFalse(kwargs["include_etf_history"])
                    self.assertFalse(kwargs["yf_fallback"])
                    if ticker == "FETCH":
                        detail_path = out_dir / "etfs" / "FETCH.json"
                        detail_path.parent.mkdir(parents=True, exist_ok=True)
                        detail_path.write_text(
                            json.dumps({"source": "stockanalysis", "asset_type": "etf", "ticker": ticker}),
                            encoding="utf-8",
                        )
                        return {
                            "ticker": ticker,
                            "asset_type": "etf",
                            "status": "ok",
                            "provider": "stockanalysis",
                            "path": "etfs/FETCH.json",
                            "provider_availability_status": "available",
                            "provider_availability_reason": "provider_detail_contract_valid",
                            "provider_response": "HTTP 200 contract valid",
                            "latency_ms": 1,
                            "error": None,
                        }
                    if ticker == "ABSENT":
                        return {
                            "ticker": ticker,
                            "asset_type": "etf",
                            "status": "provider_coverage_gap",
                            "provider": "stockanalysis",
                            "path": None,
                            "stockanalysis_error": "HTTPError: HTTP Error 404: Not Found",
                            "provider_availability_status": "absent",
                            "provider_availability_reason": "provider_coverage_gap",
                            "provider_response": "HTTP 404",
                            "latency_ms": 1,
                            "error": None,
                        }
                    return {
                        "ticker": ticker,
                        "asset_type": "etf",
                        "status": "error",
                        "provider": None,
                        "path": None,
                        "latency_ms": 1,
                        "error": "TimeoutError: transient timeout",
                    }

                self.fetcher.run_one = fake_run_one
                sys.argv = [
                    "fetch-stockanalysis.py",
                    "--reconcile-missing-etf-details",
                    "--etfs",
                    "FETCH,ABSENT,BROKEN",
                    "--incremental-etf-limit",
                    "0",
                    "--sleep",
                    "0",
                    "--no-public-mirror",
                ]
                sys.stdout = io.StringIO()
                self.fetcher.main()
                output = sys.stdout.getvalue()
                reconcile = json.loads(
                    (out_dir / self.fetcher.MISSING_DETAIL_RECONCILE_REL_PATH).read_text()
                )
                coverage = json.loads((out_dir / "coverage" / "etf_detail.json").read_text())
                index = json.loads((out_dir / "index.json").read_text())
                fetched_detail = json.loads((out_dir / "etfs" / "FETCH.json").read_text())
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root
            self.fetcher.run_one = original_run_one
            sys.argv = original_argv
            sys.stdout = original_stdout

        self.assertEqual(reconcile["counts"]["initial_missing"], 3)
        self.assertEqual(reconcile["counts"]["fetchable_fetched"], 1)
        self.assertEqual(reconcile["counts"]["provider_absent"], 1)
        self.assertEqual(reconcile["counts"]["unresolved"], 1)
        self.assertEqual(reconcile["counts"]["remaining_missing"], 2)
        self.assertEqual(reconcile["selected_tickers"], ["FETCH", "ABSENT", "BROKEN"])
        self.assertEqual(reconcile["unresolved_tickers"], ["BROKEN"])
        self.assertEqual(reconcile["exit_assessment"]["status"], "degraded")
        self.assertEqual(reconcile["exit_assessment"]["exit_code"], 0)
        self.assertIn("[degraded] StockAnalysis ETF detail reconcile deferred: BROKEN", output)
        self.assertEqual(fetched_detail["ticker"], "FETCH")
        self.assertEqual(coverage["provider_absent_tickers"], ["ABSENT"])
        self.assertEqual(index["counts"]["etfs_requested"], 3)
        self.assertEqual(index["counts"]["ok"], 2)
        self.assertEqual(index["counts"]["failed"], 1)
        self.assertEqual(index["counts"]["hard_failed"], 1)

    def test_reconcile_workflow_forwards_explicit_etf_targets(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml").read_text(
            encoding="utf-8"
        )
        reconcile_start = workflow.index(
            'if [ "${INPUT_RECONCILE_MISSING_ETF_DETAILS:-false}" = "true" ]; then'
        )
        history_plan_start = workflow.index(
            'elif [ "${INPUT_HISTORY_GAP_PLAN:-false}" = "true" ]; then',
            reconcile_start,
        )
        reconcile_block = workflow[reconcile_start:history_plan_start]
        self.assertIn(
            'if [ -n "$INPUT_ETFS" ]; then ARGS="$ARGS --etfs $INPUT_ETFS"; fi',
            reconcile_block,
        )

    def test_reconcile_exit_assessment_rejects_true_corruption(self) -> None:
        summary = self.fetcher.build_missing_detail_reconcile_summary(
            initial_missing=["AUTH1", "AUTH2"],
            selected=["AUTH1", "AUTH2"],
            results=[
                {
                    "ticker": ticker,
                    "asset_type": "etf",
                    "status": "error",
                    "provider": None,
                    "path": None,
                    "provider_availability_status": None,
                    "error": "HTTP Error 401: Unauthorized",
                }
                for ticker in ("AUTH1", "AUTH2")
            ],
            coverage={"counts": {"missing_detail_files": 2}},
        )

        self.assertEqual(summary["exit_assessment"]["status"], "corrupt")
        self.assertEqual(summary["exit_assessment"]["exit_code"], 2)
        self.assertIn("no selected ticker resolved", summary["exit_assessment"]["reasons"])
        self.assertTrue(
            any("authentication" in reason for reason in summary["exit_assessment"]["reasons"])
        )

    def test_reconcile_exit_assessment_rejects_systemic_and_regressive_batches(self) -> None:
        cases = (
            ("rate_limit", "HTTP Error 429: Too Many Requests", "429 storm"),
            ("decode", "JSONDecodeError: invalid JSON", "decode collapse"),
        )
        for label, error, expected_reason in cases:
            with self.subTest(label=label):
                summary = self.fetcher.build_missing_detail_reconcile_summary(
                    initial_missing=["FETCH", "FAIL1", "FAIL2"],
                    selected=["FETCH", "FAIL1", "FAIL2"],
                    results=[
                        {
                            "ticker": "FETCH",
                            "asset_type": "etf",
                            "status": "ok",
                            "provider": "stockanalysis",
                            "path": "etfs/FETCH.json",
                            "provider_availability_status": "available",
                            "error": None,
                        },
                        *(
                            {
                                "ticker": ticker,
                                "asset_type": "etf",
                                "status": "error",
                                "provider": None,
                                "path": None,
                                "provider_availability_status": None,
                                "error": error,
                            }
                            for ticker in ("FAIL1", "FAIL2")
                        ),
                    ],
                    coverage={"counts": {"missing_detail_files": 2}},
                )
                self.assertEqual(summary["exit_assessment"]["status"], "corrupt")
                self.assertEqual(summary["exit_assessment"]["exit_code"], 2)
                self.assertTrue(
                    any(
                        expected_reason in reason
                        for reason in summary["exit_assessment"]["reasons"]
                    )
                )

        regressed = self.fetcher.build_missing_detail_reconcile_summary(
            initial_missing=["FETCH", "BROKEN"],
            selected=["FETCH", "BROKEN"],
            results=[
                {
                    "ticker": "FETCH",
                    "asset_type": "etf",
                    "status": "ok",
                    "provider": "stockanalysis",
                    "path": "etfs/FETCH.json",
                    "provider_availability_status": "available",
                    "error": None,
                },
                {
                    "ticker": "BROKEN",
                    "asset_type": "etf",
                    "status": "error",
                    "provider": None,
                    "path": None,
                    "provider_availability_status": None,
                    "error": "TimeoutError: transient timeout",
                },
            ],
            coverage={"counts": {"missing_detail_files": 3}},
        )
        self.assertEqual(regressed["exit_assessment"]["status"], "corrupt")
        self.assertIn(
            "canonical detail coverage regressed during reconcile",
            regressed["exit_assessment"]["reasons"],
        )

    def test_successful_short_primary_cools_stably_then_complete_success_clears(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "etfs").mkdir(parents=True)
                pre_rows = weekday_rows("2026-05-29", 30)
                post_rows = weekday_rows("2026-05-29", 31)
                first_now = self.fetcher.parse_iso_timestamp("2026-07-11T02:00:00Z")
                selected = [{
                    "ticker": "SHORT",
                    "missing_history_periods": ["daily_1y"],
                    "fetchable_missing_history_periods": ["daily_1y"],
                    "daily_1y_min_rows": 200,
                    "pre_fetch_daily_1y_evidence": self.fetcher.daily_1y_series_evidence(pre_rows, first_now),
                    "pre_fetch_payload_fetched_at": "2026-07-10T00:00:00Z",
                }]
                (out_dir / "etfs" / "SHORT.json").write_text(
                    json.dumps({
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2026-07-11T01:00:00Z",
                        "normalized": {"history_periods": {"daily_1y": post_rows}},
                    }),
                    encoding="utf-8",
                )
                first = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "SHORT",
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    }],
                    selected_rows=selected,
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=first_now,
                )
                first_entry = first["entries"]["SHORT"]
                self.assertEqual(first_entry["failure_class"], "successful_short_history")
                self.assertEqual(first_entry["consecutive_failures"], 0)
                self.assertEqual(first_entry["stable_observation_count"], 2)
                self.assertTrue(
                    self.fetcher.pending_entry_in_cooldown(
                        first_entry,
                        first_now + timedelta(days=1),
                        cooldown_days=7,
                        failure_threshold=0,
                    )
                )

                within_24h_rows = post_rows
                within_24h_now = self.fetcher.parse_iso_timestamp("2026-07-11T13:00:00Z")
                (out_dir / "etfs" / "SHORT.json").write_text(
                    json.dumps({
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2026-07-11T12:00:00Z",
                        "normalized": {"history_periods": {"daily_1y": within_24h_rows}},
                    }),
                    encoding="utf-8",
                )
                second = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "SHORT",
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    }],
                    selected_rows=[{
                        "ticker": "SHORT",
                        "missing_history_periods": ["daily_1y"],
                        "pre_fetch_daily_1y_evidence": first_entry["short_history_evidence"],
                        "pre_fetch_payload_fetched_at": "2026-07-11T01:00:00Z",
                    }],
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=within_24h_now,
                )
                self.assertEqual(second["entries"]["SHORT"]["stable_observation_count"], 2)

                complete_rows = weekday_rows("2025-09-01", 200)
                (out_dir / "etfs" / "SHORT.json").write_text(
                    json.dumps({
                        "source": "stockanalysis",
                        "asset_type": "etf",
                        "fetched_at": "2026-07-12T14:00:00Z",
                        "normalized": {"history_periods": {"daily_1y": complete_rows}},
                    }),
                    encoding="utf-8",
                )
                third = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": "SHORT",
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    }],
                    selected_rows=[{
                        "ticker": "SHORT",
                        "missing_history_periods": ["daily_1y"],
                    }],
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=self.fetcher.parse_iso_timestamp("2026-07-12T15:00:00Z"),
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(third["counts"]["tracked"], 0)
        self.assertEqual(third["cleared"], ["SHORT"])

    def test_ineligible_successful_short_series_keep_48h_retry_path(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        now_dt = self.fetcher.parse_iso_timestamp("2026-07-12T00:00:00Z")
        cases = {
            "TINY": weekday_rows("2026-06-29", 10),
            "STALE": weekday_rows("2026-04-01", 25),
            "SPARSE": sampled_weekday_rows("2025-07-08", "2026-07-08", 190),
        }
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "etfs").mkdir(parents=True)
                for ticker, rows in cases.items():
                    evidence = self.fetcher.daily_1y_series_evidence(rows, now_dt)
                    self.assertFalse(evidence["eligible"])
                    (out_dir / "etfs" / f"{ticker}.json").write_text(
                        json.dumps({
                            "source": "stockanalysis",
                            "asset_type": "etf",
                            "fetched_at": "2026-07-11T23:00:00Z",
                            "normalized": {"history_periods": {"daily_1y": rows}},
                        }),
                        encoding="utf-8",
                    )
                ledger = self.fetcher.update_pending_ledger(
                    results=[{
                        "ticker": ticker,
                        "asset_type": "etf",
                        "status": "ok",
                        "provider": "stockanalysis",
                        "error": None,
                    } for ticker in cases],
                    selected_rows=[{
                        "ticker": ticker,
                        "missing_history_periods": ["daily_1y"],
                        "daily_1y_min_rows": 200,
                    } for ticker in cases],
                    cooldown_days=7,
                    failure_threshold=99,
                    mirror_public=False,
                    now_dt=now_dt,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(ledger["entries"], {})
        self.assertEqual(ledger["counts"]["cooldown"], 0)

    def test_hard_failures_rotate_all_missing_candidates_without_starvation(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        now_dt = self.fetcher.parse_iso_timestamp("2026-07-12T00:00:00Z")
        tickers = [f"ETF{index:02d}" for index in range(31)]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp) / "stockanalysis"
                self.fetcher.OUT_DIR = out_dir
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                (out_dir / "surfaces").mkdir(parents=True)
                (out_dir / "etfs").mkdir(parents=True)
                (out_dir / "backfill").mkdir(parents=True)
                (out_dir / "surfaces" / "new_etfs.json").write_text(
                    json.dumps({"records": [{"s": ticker} for ticker in tickers]}),
                    encoding="utf-8",
                )

                attempted = []
                for _ in range(4):
                    summary = self.fetcher.incremental_etf_backfill_candidates(
                        universe_payload={"records": []},
                        limit=8,
                        max_age_hours=720,
                        exclude=set(),
                        cooldown_days=7,
                        cooldown_failure_threshold=99,
                        now_dt=now_dt,
                    )
                    selected = summary["selected"]
                    attempted.extend(row["ticker"] for row in selected)
                    ledger = self.fetcher.update_pending_ledger(
                        results=[
                            {
                                "ticker": row["ticker"],
                                "asset_type": "etf",
                                "status": "error",
                                "provider": "stockanalysis",
                                "error": "HTTP Error 500: transient upstream failure",
                            }
                            for row in selected
                        ],
                        selected_rows=selected,
                        cooldown_days=7,
                        failure_threshold=99,
                        mirror_public=False,
                        now_dt=now_dt,
                    )
                    for row in selected:
                        self.assertEqual(ledger["entries"][row["ticker"]]["failure_class"], "hard_error")
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(len(attempted), 32)
        self.assertEqual(len(set(attempted)), 31)
        self.assertEqual(sorted(set(attempted)), tickers)

    def test_yahoo_candidate_success_keeps_missing_primary_in_retry_ledger(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.fetcher.OUT_DIR = Path(tmp) / "stockanalysis"
                self.fetcher.PUBLIC_DIR = Path(tmp) / "public" / "stockanalysis"
                summary = self.fetcher.update_pending_ledger(
                    results=[
                        {
                            "ticker": "ADIU",
                            "asset_type": "etf",
                            "status": "fallback_candidate_ok",
                            "provider": "yahoo_finance",
                            "stockanalysis_error": "URLError: HTTP Error 404: Not Found",
                            "error": None,
                        }
                    ],
                    selected_rows=[{"ticker": "ADIU"}],
                    cooldown_days=7,
                    failure_threshold=1,
                    mirror_public=False,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir

        self.assertEqual(summary["counts"]["tracked"], 1)
        self.assertEqual(summary["entries"]["ADIU"]["last_provider"], "yahoo_finance")

    def test_etf_404_uses_yahoo_fallback_when_enabled(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_fallback = self.fetcher.fetch_yahoo_etf_fallback
        original_write_payload = self.fetcher.write_payload
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        writes = []

        def fake_fetch_etf(_ticker: str, _timeout: int) -> dict:
            raise urllib.error.URLError("HTTP Error 404: Not Found")

        def fake_fallback(ticker: str, _mirror_public: bool) -> dict:
            return {
                "schema_version": self.fetcher.SCHEMA_VERSION,
                "source": "yahoo_finance",
                "source_provider": "yahoo_finance",
                "detail_status": "yf_fallback",
                "asset_type": "etf",
                "ticker": ticker,
                "fetched_at": "2026-06-18T00:00:00Z",
                "normalized": {"quote": {"p": 14.5, "ex": "yahoo_finance"}},
            }

        def fake_write_payload(rel_path: str, payload: dict, _mirror_public: bool) -> None:
            writes.append((rel_path, payload))

        self.fetcher.fetch_etf = fake_fetch_etf
        self.fetcher.fetch_yahoo_etf_fallback = fake_fallback
        self.fetcher.write_payload = fake_write_payload
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data-supply-state" / "v1"
                result = self.fetcher.run_one("etf", "ADIU", timeout=1, mirror_public=False, yf_fallback=True)
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.fetch_yahoo_etf_fallback = original_fallback
            self.fetcher.write_payload = original_write_payload
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "fallback_candidate_ok")
        self.assertEqual(result["provider"], "yahoo_finance")
        self.assertIn("HTTP Error 404", result["stockanalysis_error"])
        self.assertEqual(result["candidate_path"], "data/yf/etf-details/ADIU.json")
        self.assertIsNone(result["selected_provider"])
        self.assertFalse(result["canonical_write"])
        self.assertEqual(writes, [])
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["provider"], "stockanalysis")
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertEqual(observations[0]["reason_code"], "provider_coverage_gap")
        self.assertEqual(observations[0]["availability_status"], "provider_absent")
        self.assertEqual(observations[0]["provider_response"], "HTTP 404")

    def test_etf_404_without_fallback_is_degraded_provider_gap(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        def fake_fetch_etf(_ticker: str, _timeout: int, **_kwargs) -> dict:
            raise urllib.error.URLError("HTTP Error 404: Not Found")

        self.fetcher.fetch_etf = fake_fetch_etf
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data-supply-state" / "v1"
                result = self.fetcher.run_one(
                    "etf",
                    "ABSENT",
                    timeout=1,
                    mirror_public=False,
                    yf_fallback=False,
                    include_etf_history=False,
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "provider_coverage_gap")
        self.assertEqual(result["provider"], "stockanalysis")
        self.assertIsNone(result["error"])
        self.assertEqual(result["provider_availability_status"], "absent")
        self.assertEqual(result["provider_availability_reason"], "provider_coverage_gap")
        self.assertEqual(result["provider_response"], "HTTP 404")

    def test_schema_and_network_primary_failures_still_materialize_yahoo_candidate(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {
                        "symbol": "VYMI",
                        "quoteType": "ETF",
                        "currentPrice": 70.0,
                        "previousClose": 69.5,
                        "regularMarketTime": 1783641600,
                    },
                    "funds_data": {"top_holdings": []},
                    "history_1y": [],
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            for label, failure in (
                ("schema", ValueError("schema drift")),
                ("network", urllib.error.URLError("timed out")),
            ):
                with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                    temp_root = Path(tmp)
                    self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                    self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                    self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                    self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                    self.fetcher.fetch_etf = lambda _ticker, _timeout, exc=failure: (_ for _ in ()).throw(exc)
                    self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
                    result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=True)
                    candidate_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "VYMI.json").exists()
                    history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                    observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                    self.assertEqual(result["status"], "fallback_candidate_ok")
                    self.assertTrue(candidate_exists)
                    self.assertEqual(
                        [(row["provider"], row["validation_status"]) for row in observations],
                        [("stockanalysis", "invalid"), ("yahoo_finance", "valid")],
                    )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

    def test_stockanalysis_success_writes_only_primary_truth_and_observation(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        original_fetch_etf = self.fetcher.fetch_etf
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.PUBLIC_DIR = temp_root / "public" / "data" / "stockanalysis"
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                self.fetcher.fetch_etf = lambda ticker, _timeout: {
                    "schema_version": self.fetcher.SCHEMA_VERSION,
                    "source": "stockanalysis",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "source_as_of": "2026-07-10T00:00:00Z",
                    "fetched_at": "2026-07-10T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                    "raw": {"quote": {"td": "2026-07-10", "ts": 1783641600}},
                }
                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=True)
                primary_exists = (self.fetcher.OUT_DIR / "etfs" / "VYMI.json").exists()
                raw_yf_exists = (self.fetcher.YF_OUT_DIR / "VYMI.json").exists()
                normalized_yf_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "VYMI.json").exists()
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                pending = json.loads(
                    (
                        self.fetcher.DATA_SUPPLY_STATE_ROOT
                        / "providers/stockanalysis/etf_detail/pending/VYMI.json"
                    ).read_text(encoding="utf-8")
                )
                provider_object_bytes = (self.fetcher.DATA_SUPPLY_STATE_ROOT / pending["path"]).read_bytes()
                primary_bytes = (self.fetcher.OUT_DIR / "etfs" / "VYMI.json").read_bytes()
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root
            self.fetcher.fetch_etf = original_fetch_etf

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["canonical_write"])
        self.assertTrue(primary_exists)
        self.assertFalse(raw_yf_exists)
        self.assertFalse(normalized_yf_exists)
        self.assertEqual(observations[0]["provider"], "stockanalysis")
        self.assertEqual(observations[0]["validation_status"], "valid")
        self.assertEqual(observations[0]["observation_origin"], "natural")
        self.assertEqual(provider_object_bytes, primary_bytes)
        self.assertEqual(pending["observation_event_id"], observations[0]["event_id"])

    def test_undated_stockanalysis_partial_is_written_as_degraded_not_valid_state(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_public_dir = self.fetcher.PUBLIC_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        original_fetch_etf = self.fetcher.fetch_etf
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.PUBLIC_DIR = temp_root / "public" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = (
                    temp_root / "data" / "admin" / "data-supply-state" / "v1"
                )
                self.fetcher.fetch_etf = lambda ticker, _timeout, **_kwargs: {
                    "schema_version": self.fetcher.SCHEMA_VERSION,
                    "source": "stockanalysis",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "detail_status": "stockanalysis_partial",
                    "partial_reason_codes": ["holdings_surface_omits_holdings"],
                    "source_as_of": None,
                    "source_as_of_reason": (
                        "provider detail response carries no market or holdings observation date"
                    ),
                    "fetched_at": "2026-07-14T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                }
                result = self.fetcher.run_one(
                    "etf",
                    "AAOX",
                    1,
                    False,
                    include_etf_history=False,
                )
                observations_path = next(
                    (
                        self.fetcher.DATA_SUPPLY_STATE_ROOT
                        / "history"
                        / "observations"
                    ).glob("*.jsonl")
                )
                observations = [
                    json.loads(line)
                    for line in observations_path.read_text(encoding="utf-8").splitlines()
                ]
                payload = json.loads(
                    (self.fetcher.OUT_DIR / "etfs" / "AAOX.json").read_text(
                        encoding="utf-8"
                    )
                )
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.PUBLIC_DIR = original_public_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root
            self.fetcher.fetch_etf = original_fetch_etf

        self.assertEqual(result["status"], "ok")
        self.assertEqual(
            result["provider_availability_reason"],
            "provider_partial_detail_contract_valid",
        )
        self.assertIsNone(payload["source_as_of"])
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertEqual(
            observations[0]["reason_code"],
            "partial_source_date_unavailable",
        )
        self.assertIsNone(observations[0]["source_as_of"])

    def test_stockanalysis_self_asserted_source_date_without_provider_evidence_is_invalid(self) -> None:
        payload = {
            "schema_version": self.fetcher.SCHEMA_VERSION,
            "source": "stockanalysis",
            "asset_type": "etf",
            "ticker": "VYMI",
            "source_as_of": "2026-07-10T00:00:00Z",
            "fetched_at": "2026-07-10T00:00:00Z",
            "normalized": {"overview": {"aum": 1}},
        }
        with self.assertRaisesRegex(ValueError, "provider source date is unavailable"):
            self.fetcher.validate_stockanalysis_etf_payload("VYMI", payload)

        payload["raw"] = {"quote": {"td": "2026-07-09", "ts": 1783555200}}
        with self.assertRaisesRegex(ValueError, "disagrees with provider evidence"):
            self.fetcher.validate_stockanalysis_etf_payload("VYMI", payload)

    def test_stockanalysis_partial_accepts_null_with_reason_but_rejects_fabricated_date(self) -> None:
        payload = {
            "schema_version": self.fetcher.SCHEMA_VERSION,
            "source": "stockanalysis",
            "asset_type": "etf",
            "ticker": "AAOX",
            "detail_status": "stockanalysis_partial",
            "partial_reason_codes": ["holdings_surface_omits_holdings"],
            "source_as_of": None,
            "source_as_of_reason": (
                "provider detail response carries no market or holdings observation date"
            ),
            "fetched_at": "2026-07-14T00:00:00Z",
            "normalized": {"overview": {"aum": 1}},
        }

        self.fetcher.validate_stockanalysis_etf_payload("AAOX", payload)

        payload["source_as_of"] = "2026-07-14T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "provider source date is unavailable"):
            self.fetcher.validate_stockanalysis_etf_payload("AAOX", payload)

    def test_stockanalysis_path_rejects_cross_provider_payload(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.fetcher.OUT_DIR = Path(tmp) / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = Path(tmp) / "data" / "admin" / "data-supply-state" / "v1"
                self.fetcher.fetch_etf = lambda ticker, _timeout: {
                    "schema_version": "yf-etf-detail/v1",
                    "source": "yahoo_finance",
                    "source_provider": "yahoo_finance",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "fetched_at": "2026-07-10T00:00:00Z",
                }
                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=False)
                primary_exists = (self.fetcher.OUT_DIR / "etfs" / "VYMI.json").exists()
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "error")
        self.assertIn("schema mismatch", result["error"])
        self.assertFalse(primary_exists)
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertEqual(observations[0]["reason_code"], "schema_invalid")

    def test_malformed_primary_stamp_preserves_existing_primary_bytes(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                detail_path = self.fetcher.OUT_DIR / "etfs" / "VYMI.json"
                detail_path.parent.mkdir(parents=True)
                original_bytes = b'{"source":"stockanalysis","ticker":"VYMI","fetched_at":"2026-07-09T00:00:00Z"}\n'
                detail_path.write_bytes(original_bytes)
                self.fetcher.fetch_etf = lambda ticker, _timeout: {
                    "schema_version": self.fetcher.SCHEMA_VERSION,
                    "source": "stockanalysis",
                    "asset_type": "etf",
                    "ticker": ticker,
                    "source_as_of": "not-a-timeZ",
                    "fetched_at": "2026-07-10T00:00:00Z",
                    "normalized": {"overview": {"aum": 1}},
                    "raw": {"quote": {"td": "2026-07-10", "ts": 1783641600}},
                }
                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=False)
                after_bytes = detail_path.read_bytes()
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "error")
        self.assertIn("malformed", result["error"])
        self.assertEqual(after_bytes, original_bytes)
        self.assertEqual(observations[0]["reason_code"], "schema_invalid")

    def test_yahoo_fallback_never_overwrites_existing_stockanalysis_detail(self) -> None:
        original_out_dir = self.fetcher.OUT_DIR
        original_fetch_etf = self.fetcher.fetch_etf
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {
                        "symbol": "VYMI",
                        "quoteType": "ETF",
                        "currentPrice": 70.0,
                        "previousClose": 69.5,
                        "regularMarketTime": 1783641600,
                    },
                    "funds_data": {"top_holdings": []},
                    "history_1y": [],
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.OUT_DIR = temp_root / "data" / "stockanalysis"
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                detail_dir = self.fetcher.OUT_DIR / "etfs"
                detail_dir.mkdir(parents=True)
                canonical_bytes = b'{\n  "source": "stockanalysis",\n  "ticker": "VYMI",\n  "fetched_at": "2026-07-09T00:00:00Z"\n}\n'
                detail_path = detail_dir / "VYMI.json"
                detail_path.write_bytes(canonical_bytes)

                self.fetcher.fetch_etf = lambda _ticker, _timeout: (_ for _ in ()).throw(
                    urllib.error.URLError("HTTP Error 404: Not Found")
                )
                self.fetcher.load_yf_finance_module = lambda: FakeYahooModule

                result = self.fetcher.run_one("etf", "VYMI", 1, False, yf_fallback=True)
                after_bytes = detail_path.read_bytes()
                raw_path = self.fetcher.YF_OUT_DIR / "VYMI.json"
                candidate_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "VYMI.json"
                history_path = (
                    self.fetcher.DATA_SUPPLY_STATE_ROOT
                    / "history"
                    / "observations"
                    / f"{datetime.now(timezone.utc).date().isoformat()}.jsonl"
                )
                observations = [json.loads(line) for line in history_path.read_text(encoding="utf-8").splitlines()]
                yahoo_pending = json.loads(
                    (
                        self.fetcher.DATA_SUPPLY_STATE_ROOT
                        / "providers/yahoo_finance/etf_detail/pending/VYMI.json"
                    ).read_text(encoding="utf-8")
                )
                yahoo_object_bytes = (self.fetcher.DATA_SUPPLY_STATE_ROOT / yahoo_pending["path"]).read_bytes()
                candidate_bytes = candidate_path.read_bytes()
                raw_exists = raw_path.exists()
                candidate_exists = candidate_path.exists()
        finally:
            self.fetcher.OUT_DIR = original_out_dir
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertEqual(result["status"], "fallback_observed_primary_preserved")
        self.assertEqual(result["selected_provider"], "stockanalysis")
        self.assertFalse(result["canonical_write"])
        self.assertEqual(after_bytes, canonical_bytes)
        self.assertTrue(raw_exists)
        self.assertTrue(candidate_exists)
        self.assertEqual(
            [(row["provider"], row["validation_status"]) for row in observations],
            [("stockanalysis", "invalid"), ("yahoo_finance", "valid")],
        )
        self.assertEqual(observations[1]["provider_path"], "data/yf/etf-details/VYMI.json")
        self.assertEqual(observations[1]["observation_origin"], "natural")
        self.assertEqual(yahoo_object_bytes, candidate_bytes)
        self.assertEqual(yahoo_pending["observation_event_id"], observations[1]["event_id"])

    def test_yahoo_etf_payload_normalizes_source_tags_quote_and_fund_profile(self) -> None:
        payload = self.fetcher.yahoo_etf_payload(
            "BSJY",
            {
                "ticker": "BSJY",
                "fetched_at": "2026-06-19T07:30:51Z",
                "data": {
                    "info": {
                        "symbol": "BSJY",
                        "quoteType": "ETF",
                        "longName": "Invesco BulletShares 2034 High Yield Corporate Bond ETF",
                        "currentPrice": 25.07,
                        "previousClose": 25.205,
                        "regularMarketTime": 1781767851,
                        "navPrice": 20.21,
                        "netExpenseRatio": 0.42,
                        "fundFamily": "Invesco",
                        "category": "High Yield Bond",
                        "legalType": "Exchange Traded Fund",
                    },
                    "funds_data": {
                        "quote_type": "ETF",
                        "description": "The fund tracks a high-yield corporate bond index.",
                        "fund_overview": {
                            "family": "Invesco",
                            "categoryName": "High Yield Bond",
                            "legalType": "Exchange Traded Fund",
                        },
                        "top_holdings": [
                            {"_index": "CASH", "Name": "Cash", "Holding Percent": 0.125},
                        ],
                        "asset_classes": {"bondPosition": 0.875, "cashPosition": 0.125},
                        "sector_weightings": {"financial_services": 0.25},
                    },
                    "history_1y": [{"date": "2026-06-18", "close": 25.07}],
                },
            },
        )

        self.assertEqual(payload["source"], "yahoo_finance")
        self.assertEqual(payload["schema_version"], "yf-etf-detail/v1")
        self.assertEqual(payload["source_as_of"], "2026-06-18T07:30:51Z")
        self.assertNotEqual(payload["source_as_of"], payload["fetched_at"])
        self.assertEqual(payload["source_provider"], "yahoo_finance")
        self.assertEqual(payload["detail_status"], "yf_fallback")
        self.assertEqual(payload["normalized"]["quote"]["ex"], "yahoo_finance")
        self.assertAlmostEqual(payload["normalized"]["quote"]["c"], -0.135)
        self.assertEqual(payload["normalized"]["overview"]["provider_page"], "Invesco")
        self.assertEqual(payload["normalized"]["holdings"][0]["weight_pct"], 12.5)
        self.assertEqual(payload["normalized"]["asset_allocation"]["bondPosition"], 0.875)
        self.assertEqual(payload["normalized"]["history"][0]["close"], 25.07)
        self.assertEqual(payload["normalized"]["history_periods"]["daily_1y"][0]["close"], 25.07)

    def test_yahoo_etf_payload_rejects_non_fund_quote_type(self) -> None:
        with self.assertRaises(ValueError):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T07:30:51Z",
                    "data": {
                        "info": {"symbol": "ADIU", "quoteType": "EQUITY", "currentPrice": 14.5},
                    },
                },
            )

    def test_yahoo_etf_payload_rejects_missing_type_and_symbol_mismatch(self) -> None:
        with self.assertRaisesRegex(ValueError, "quoteType"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {"ticker": "ADIU", "fetched_at": "2026-06-18T00:00:00Z", "data": {"info": {"symbol": "ADIU"}}},
            )
        with self.assertRaisesRegex(ValueError, "symbol mismatch"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {"info": {"symbol": "WRONG", "quoteType": "ETF"}},
                },
            )
        with self.assertRaisesRegex(ValueError, "minimum ETF detail"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {"info": {"symbol": "ADIU", "quoteType": "ETF"}},
                },
            )
        with self.assertRaisesRegex(ValueError, "asset_classes"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {
                        "info": {"symbol": "ADIU", "quoteType": "ETF", "currentPrice": 10},
                        "funds_data": {"asset_classes": ["malformed"]},
                    },
                },
            )
        with self.assertRaisesRegex(ValueError, "history rows"):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T00:00:00Z",
                    "data": {
                        "info": {"symbol": "ADIU", "quoteType": "ETF", "currentPrice": 10},
                        "history_1y": ["malformed"],
                    },
                },
            )

    def test_invalid_yahoo_fallback_writes_raw_evidence_and_invalid_observation_only(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({"info": {"symbol": "ADIU", "quoteType": "EQUITY", "currentPrice": 14.5}}, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                with self.assertRaises(ValueError):
                    self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=False)
                raw_path = self.fetcher.YF_OUT_DIR / "ADIU.json"
                candidate_path = self.fetcher.YF_ETF_DETAIL_OUT_DIR / "ADIU.json"
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                raw_exists = raw_path.exists()
                candidate_exists = candidate_path.exists()
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertTrue(raw_exists)
        self.assertFalse(candidate_exists)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertIsNone(observations[0]["source_as_of"])
        self.assertEqual(observations[0]["provider_path"], "data/yf/finance/ADIU.json")

    def test_malformed_yahoo_container_still_records_invalid_observation(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {"symbol": "ADIU", "quoteType": "ETF", "currentPrice": 10},
                    "funds_data": {"asset_classes": ["malformed"]},
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                with self.assertRaisesRegex(ValueError, "asset_classes"):
                    self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=False)
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                raw_exists = (self.fetcher.YF_OUT_DIR / "ADIU.json").exists()
                candidate_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "ADIU.json").exists()
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertTrue(raw_exists)
        self.assertFalse(candidate_exists)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["validation_status"], "invalid")
        self.assertIsNone(observations[0]["source_as_of"])

    def test_undated_yahoo_candidate_records_source_unavailable_observation(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_yf_out_dir = self.fetcher.YF_OUT_DIR
        original_yf_detail_out_dir = self.fetcher.YF_ETF_DETAIL_OUT_DIR
        original_state_root = self.fetcher.DATA_SUPPLY_STATE_ROOT

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,), include_evidence: bool = False):
                result = ({
                    "info": {
                        "symbol": "ADIU",
                        "quoteType": "ETF",
                        "currentPrice": 10,
                        "previousClose": 9.5,
                    },
                    "funds_data": {"top_holdings": []},
                    "history_1y": [],
                }, 10, None)
                return (*result, {"attempts_used": 1, "latency_ms": 10, "failures": []}) if include_evidence else result

        try:
            with tempfile.TemporaryDirectory() as tmp:
                temp_root = Path(tmp)
                self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
                self.fetcher.YF_OUT_DIR = temp_root / "data" / "yf" / "finance"
                self.fetcher.YF_ETF_DETAIL_OUT_DIR = temp_root / "data" / "yf" / "etf-details"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = temp_root / "data" / "admin" / "data-supply-state" / "v1"
                with self.assertRaisesRegex(ValueError, "provider source date is unavailable"):
                    self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=False)
                history_files = list((self.fetcher.DATA_SUPPLY_STATE_ROOT / "history" / "observations").glob("*.jsonl"))
                observations = [json.loads(line) for line in history_files[0].read_text(encoding="utf-8").splitlines()]
                raw_payload = json.loads((self.fetcher.YF_OUT_DIR / "ADIU.json").read_text(encoding="utf-8"))
                candidate_exists = (self.fetcher.YF_ETF_DETAIL_OUT_DIR / "ADIU.json").exists()
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.YF_OUT_DIR = original_yf_out_dir
            self.fetcher.YF_ETF_DETAIL_OUT_DIR = original_yf_detail_out_dir
            self.fetcher.DATA_SUPPLY_STATE_ROOT = original_state_root

        self.assertIsNone(raw_payload["source_as_of"])
        self.assertEqual(raw_payload["source_as_of_reason"], "provider payload carries no market observation date")
        self.assertFalse(candidate_exists)
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["reason_code"], "source_date_unavailable")
        self.assertIsNone(observations[0]["source_as_of"])

    def test_etf_classification_separates_index_and_single_stock_leverage(self) -> None:
        index_etf = self.fetcher.classify_etf(
            {"ticker": "TQQQ", "name": "ProShares UltraPro QQQ"},
            overview={
                "description": (
                    "The fund provides 3x leveraged exposure to a modified "
                    "market-cap-weighted index tracking 100 of the largest firms."
                )
            },
            holdings=[],
        )
        single_stock = self.fetcher.classify_etf(
            {"ticker": "NVDL", "name": "GraniteShares 2x Long NVDA Daily ETF"},
            overview={
                "description": (
                    "The fund provides 2x leveraged exposure, less fees and expenses, "
                    "to the daily price movement for shares of NVIDIA Corporation stock."
                )
            },
            holdings=[],
        )
        inverse_1x = self.fetcher.classify_etf(
            {"ticker": "AAPD", "name": "Direxion Daily AAPL Bear 1X ETF"},
            overview={
                "description": (
                    "The fund provides inverse exposure to the daily price movement "
                    "for shares of Apple stock."
                )
            },
            holdings=[],
        )

        self.assertTrue(index_etf["is_leveraged"])
        self.assertEqual(index_etf["leverage_factor"], 3.0)
        self.assertFalse(index_etf["is_single_stock"])
        self.assertTrue(single_stock["is_leveraged"])
        self.assertEqual(single_stock["leverage_factor"], 2.0)
        self.assertTrue(single_stock["is_single_stock"])
        self.assertEqual(single_stock["underlying"], "NVIDIA Corporation")
        self.assertFalse(inverse_1x["is_leveraged"])
        self.assertTrue(inverse_1x["is_inverse"])
        self.assertFalse(inverse_1x["is_single_stock"])

    def test_etf_classification_ignores_short_maturity_terms(self) -> None:
        short_term_bond = self.fetcher.classify_etf(
            {"ticker": "BSV", "name": "Vanguard Short-Term Bond ETF"},
            overview={"description": "The fund invests in short-term investment-grade bonds."},
            holdings=[],
        )
        ultra_short_income = self.fetcher.classify_etf(
            {"ticker": "JPST", "name": "JPMorgan Ultra-Short Income ETF"},
            overview={"description": "The fund is an ultra short duration income ETF."},
            holdings=[],
        )
        vix_futures = self.fetcher.classify_etf(
            {"ticker": "VIXY", "name": "ProShares VIX Short-Term Futures ETF"},
            overview={"description": "The fund tracks VIX short-term futures contracts."},
            holdings=[],
        )
        ultra_short_treasury = self.fetcher.classify_etf(
            {"ticker": "VGUS", "name": "Vanguard Ultra-Short Treasury ETF"},
            overview={
                "description": (
                    "The fund is based on the Bloomberg Short Treasury index, "
                    "tracking US Treasurys with maturities of one to three months."
                )
            },
            holdings=[],
        )
        short_muni = self.fetcher.classify_etf(
            {"ticker": "SMB", "name": "VanEck Short Muni ETF"},
            overview={"description": "The fund tracks municipal bonds with nominal maturities of 1-6 years."},
            holdings=[],
        )
        short_high_yield_muni = self.fetcher.classify_etf(
            {"ticker": "SHYD", "name": "VanEck Short High Yield Muni ETF"},
            overview={"description": "The fund tracks high-yield municipal bonds with 1-12 years remaining in maturity."},
            holdings=[],
        )
        short_to_intermediate = self.fetcher.classify_etf(
            {"ticker": "TMNS", "name": "T. Rowe Price Short Municipal Income ETF"},
            overview={"description": "The fund invests in short- to intermediate-term investment grade municipal bonds."},
            holdings=[],
        )

        for classification in (
            short_term_bond,
            ultra_short_income,
            vix_futures,
            ultra_short_treasury,
            short_muni,
            short_high_yield_muni,
            short_to_intermediate,
        ):
            self.assertFalse(classification["is_leveraged"])
            self.assertIsNone(classification["leverage_factor"])
            self.assertFalse(classification["is_inverse"])

    def test_etf_classification_preserves_directional_short_products(self) -> None:
        short_sp500 = self.fetcher.classify_etf(
            {"ticker": "SH", "name": "ProShares Short S&P500"},
            overview={"description": "The fund seeks inverse exposure to the S&P 500."},
            holdings=[],
        )
        ultrapro_short = self.fetcher.classify_etf(
            {"ticker": "SQQQ", "name": "ProShares UltraPro Short QQQ"},
            overview={"description": "The fund provides 3x inverse daily exposure to the Nasdaq-100 Index."},
            holdings=[],
        )
        short_vix = self.fetcher.classify_etf(
            {"ticker": "SVXY", "name": "ProShares Short VIX Short-Term Futures ETF"},
            overview={"description": "The fund provides short exposure to VIX short-term futures."},
            holdings=[],
        )

        self.assertFalse(short_sp500["is_leveraged"])
        self.assertTrue(short_sp500["is_inverse"])
        self.assertTrue(ultrapro_short["is_leveraged"])
        self.assertEqual(ultrapro_short["leverage_factor"], 3.0)
        self.assertTrue(ultrapro_short["is_inverse"])
        self.assertFalse(short_vix["is_leveraged"])
        self.assertTrue(short_vix["is_inverse"])

    def test_enrolled_stock_success_records_exact_manual_object(self) -> None:
        original = (
            self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR,
            self.fetcher.DATA_SUPPLY_STATE_ROOT, self.fetcher.fetch_stock,
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
            self.fetcher.fetch_stock = lambda ticker, _timeout, _financials: {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": ticker, "fetched_at": "2026-07-10T10:00:00Z",
                "normalized": {
                    "overview": {"marketCap": "1T"},
                    "quote": {"p": 500.0, "cl": 495.0, "symbol": ticker, "uid": ticker},
                    "history": [{"t": "2026-07-10", "c": 500.0}],
                },
            }
            try:
                result = self.fetcher.run_one("stock", "AAPL", 1, False)
            finally:
                (
                    self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR,
                    self.fetcher.DATA_SUPPLY_STATE_ROOT, self.fetcher.fetch_stock,
                ) = original
            truth = root / "data" / "stockanalysis" / "stocks" / "AAPL.json"
            pending = root / "state" / "providers" / "stockanalysis" / "stock_detail" / "pending" / "AAPL.json"
            pointer = json.loads(pending.read_text())
            object_path = root / "state" / pointer["path"]
            observation = json.loads(next((root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
            self.assertIsNone(result["error"])
            self.assertEqual(object_path.read_bytes(), truth.read_bytes())
            self.assertEqual(observation["observation_origin"], "rebuild")
            self.assertEqual(observation["collection_origin"], "manual")

    def test_unenrolled_stock_success_writes_truth_without_state(self) -> None:
        original = self.fetcher.fetch_stock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
            self.fetcher.fetch_stock = lambda ticker, _timeout, _financials: {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": ticker, "fetched_at": "2026-07-10T10:00:00Z",
                "normalized": {"overview": {}, "quote": {}, "history": []},
            }
            try:
                result = self.fetcher.run_one("stock", "SPY", 1, False)
            finally:
                self.fetcher.fetch_stock = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs
            self.assertIsNone(result["error"])
            self.assertTrue((root / "data" / "stockanalysis" / "stocks" / "SPY.json").exists())
            self.assertFalse((root / "state").exists())

    def test_enrolled_stock_schema_failure_preserves_truth_and_records_invalid(self) -> None:
        original = self.fetcher.fetch_stock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
            truth = self.fetcher.OUT_DIR / "stocks" / "AAPL.json"
            truth.parent.mkdir(parents=True)
            sentinel = b'{"sentinel":true}\n'
            truth.write_bytes(sentinel)
            self.fetcher.fetch_stock = lambda ticker, _timeout, _financials: {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": ticker, "fetched_at": "2026-07-10T10:00:00Z",
                "normalized": {"overview": {"ok": True}, "quote": {"p": 1, "symbol": ticker, "uid": ticker}, "history": [{}]},
            }
            try:
                result = self.fetcher.run_one("stock", "AAPL", 1, False)
            finally:
                self.fetcher.fetch_stock = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs
            observation = json.loads(next((root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
            self.assertIsNotNone(result["error"])
            self.assertEqual(truth.read_bytes(), sentinel)
            self.assertEqual(observation["validation_status"], "invalid")
            self.assertFalse((root / "state" / "providers").exists())

    def test_enrolled_stock_network_failure_records_invalid_without_truth_write(self) -> None:
        original = self.fetcher.fetch_stock
        for failure, expected_reason in (
            (urllib.error.URLError("offline"), "fetch_failed"),
            (RuntimeError("adapter failed"), "fetch_failed"),
            (ValueError("decoded schema drift"), "schema_invalid"),
        ):
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
                self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
                self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
                self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "state"
                self.fetcher.fetch_stock = lambda *_args, _failure=failure, **_kwargs: (_ for _ in ()).throw(_failure)
                try:
                    result = self.fetcher.run_one("stock", "AAPL", 1, False)
                finally:
                    self.fetcher.fetch_stock = original
                    self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs
                observation = json.loads(next((root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
                self.assertIsNotNone(result["error"])
                self.assertEqual(observation["reason_code"], expected_reason)
                self.assertFalse((root / "data" / "stockanalysis" / "stocks" / "AAPL.json").exists())

    def test_stock_controlled_failure_retains_lkg_then_real_fetch_recovers(self) -> None:
        original = self.fetcher.fetch_stock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data-supply-state"
            truth = self.fetcher.OUT_DIR / "stocks" / "AAPL.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": "AAPL",
                "source_as_of": "2026-07-14T20:00:00Z", "fetched_at": "2026-07-14T21:00:00Z",
                "normalized": {"overview": {"marketCap": 1}, "quote": {"p": 10, "cl": 9, "symbol": "AAPL", "uid": "AAPL"}, "history": [{"t": "2026-07-14", "c": 10}]},
            }
            self.fetcher.write_json(truth, lkg_payload)
            expected_lkg = truth.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            bootstrap = {"run_id": "bootstrap", "run_attempt": 1, "event_name": "local", "observed_at": "2026-07-15T07:00:00Z"}
            chaos = {"run_id": "chaos-1", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:00:00Z"}
            recovery = {"run_id": "real-1", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:05:00Z"}
            store.bootstrap_existing(bootstrap)
            try:
                failed = self.fetcher.run_one(
                    "stock", "AAPL", 1, False,
                    recovery_store=store, recovery_run=chaos, controlled_failure=True,
                )
                self.assertIsNotNone(failed["error"])
                self.assertEqual(truth.read_bytes(), expected_lkg)
                self.assertEqual(
                    (store.root / "lkg" / "stock" / "AAPL.json").read_bytes(), expected_lkg
                )

                advanced = json.loads(json.dumps(lkg_payload))
                advanced["source_as_of"] = "2026-07-15T20:00:00Z"
                advanced["fetched_at"] = "2026-07-15T21:00:00Z"
                advanced["normalized"]["history"] = [{"t": "2026-07-15", "c": 11}]
                self.fetcher.fetch_stock = lambda *_args, **_kwargs: advanced
                succeeded = self.fetcher.run_one(
                    "stock", "AAPL", 1, False,
                    recovery_store=store, recovery_run=recovery,
                )
            finally:
                self.fetcher.fetch_stock = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs

            state = json.loads((store.root / "states" / "stock" / "AAPL.json").read_text())
            self.assertIsNone(succeeded["error"])
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])
            self.assertEqual(state["recovered_from_run_id"], "chaos-1")

    def test_stock_controlled_failure_also_retains_financial_lkg_and_retry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            self.fetcher.DATA_SUPPLY_STATE_ROOT = root / "data-supply-state"
            stock_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": "AAPL",
                "source_as_of": "2026-07-14T20:00:00Z", "fetched_at": "2026-07-14T21:00:00Z",
                "normalized": {
                    "overview": {},
                    "quote": {"symbol": "AAPL", "uid": "AAPL"},
                    "history": [{"t": "2026-07-14", "c": 10}],
                },
            }
            financial_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "asset_type": "stock", "ticker": "AAPL",
                "fetched_at": "2026-07-14T21:00:00Z",
                "statements": {"annual": {"income": {"periods": ["2026-06-30"]}}},
            }
            stock_path = self.fetcher.OUT_DIR / "stocks" / "AAPL.json"
            financial_path = self.fetcher.OUT_DIR / "financials" / "AAPL.json"
            self.fetcher.write_json(stock_path, stock_payload)
            self.fetcher.write_json(financial_path, financial_payload)
            expected_financial_lkg = financial_path.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            bootstrap = {"run_id": "bootstrap", "run_attempt": 1, "event_name": "local", "observed_at": "2026-07-15T07:00:00Z"}
            chaos = {"run_id": "chaos-financial", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:00:00Z"}
            store.bootstrap_existing(bootstrap)
            try:
                failed = self.fetcher.run_one(
                    "stock", "AAPL", 1, False,
                    include_financials=True,
                    recovery_store=store,
                    recovery_run=chaos,
                    controlled_failure=True,
                )
                index = store.rebuild_index(chaos)
            finally:
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR, self.fetcher.DATA_SUPPLY_STATE_ROOT = original_dirs

            financial_state = json.loads(
                (store.root / "states" / "financial" / "AAPL.json").read_text()
            )
            self.assertIsNotNone(failed["error"])
            self.assertEqual(financial_state["resolution_state"], "lkg_primary")
            self.assertTrue(financial_state["retry"])
            self.assertTrue(financial_state["latest_failure"]["controlled"])
            self.assertEqual(
                (store.root / "lkg" / "financial" / "AAPL.json").read_bytes(),
                expected_financial_lkg,
            )
            self.assertIn(
                {"artifact_kind": "financial", "entity": "AAPL"},
                index["retry_artifacts"],
            )

    def test_surface_controlled_failure_retains_lkg_then_real_fetch_recovers(self) -> None:
        original = self.fetcher.fetch_svelte_surface
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original_dirs = self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR
            self.fetcher.OUT_DIR = root / "data" / "stockanalysis"
            self.fetcher.PUBLIC_DIR = root / "public" / "stockanalysis"
            name = "actions_recent"
            truth = self.fetcher.OUT_DIR / "surfaces" / f"{name}.json"
            lkg_payload = {
                "schema_version": "stockanalysis/v1", "source": "stockanalysis",
                "surface": name, "group": "events", "priority": "high", "role": "fixture",
                "source_as_of": None, "source_as_of_reason": "provider publishes no aggregate source date",
                "fetched_at": "2026-07-15T07:00:00Z", "endpoint": "/actions/", "url": "https://stockanalysis.com/actions/",
                "format": "html_table", "counts": {"tables": 1, "rows": 1}, "tables": [{"records": [{"symbol": "AAPL", "date": "Jul 14, 2026"}]}],
            }
            self.fetcher.write_json(truth, lkg_payload)
            expected_lkg = truth.read_bytes()
            store = self.fetcher.StockAnalysisRecoveryStateStore(
                root / "data" / "admin" / "stockanalysis-recovery", root
            )
            bootstrap = {"run_id": "bootstrap", "run_attempt": 1, "event_name": "local", "observed_at": "2026-07-15T07:00:00Z"}
            chaos = {"run_id": "chaos-2", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:00:00Z"}
            recovery = {"run_id": "real-2", "run_attempt": 1, "event_name": "workflow_dispatch", "observed_at": "2026-07-15T08:05:00Z"}
            store.bootstrap_existing(bootstrap)
            try:
                failed = self.fetcher.fetch_surfaces(
                    [name], 1, 0, False,
                    recovery_store=store, recovery_run=chaos,
                    controlled_failure_surfaces={name},
                )
                self.assertEqual(failed["counts"]["failed"], 1)
                self.assertEqual(truth.read_bytes(), expected_lkg)
                canonical_after_failure = json.loads(
                    (self.fetcher.OUT_DIR / "surfaces" / "index.json").read_text()
                )
                actions_row = next(
                    row for row in canonical_after_failure["results"]
                    if row["surface"] == name
                )
                self.assertEqual(actions_row["status"], "ok")
                self.assertEqual(actions_row["path"], f"surfaces/{name}.json")
                self.assertIsNone(actions_row["error"])
                self.assertEqual(
                    canonical_after_failure["latest_attempt"]["counts"]["failed"], 1
                )
                self.fetcher.fetch_svelte_surface = lambda *_args, **_kwargs: {
                    **lkg_payload,
                    "fetched_at": "2026-07-15T08:05:00Z",
                    "tables": [{"records": [{"symbol": "MSFT", "date": "Jul 15, 2026"}]}],
                }
                succeeded = self.fetcher.fetch_surfaces(
                    [name], 1, 0, False,
                    recovery_store=store, recovery_run=recovery,
                )
            finally:
                self.fetcher.fetch_svelte_surface = original
                self.fetcher.OUT_DIR, self.fetcher.PUBLIC_DIR = original_dirs

            state = json.loads((store.root / "states" / "surface" / f"{name}.json").read_text())
            self.assertEqual(succeeded["counts"]["ok"], 1)
            self.assertEqual(state["resolution_state"], "fresh_primary")
            self.assertFalse(state["retry"])
            self.assertEqual(state["recovered_from_run_id"], "chaos-2")


if __name__ == "__main__":
    unittest.main()
