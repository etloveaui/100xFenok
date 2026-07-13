#!/usr/bin/env python3
"""Contract checks for yf Finance staged ETF backfill selection."""

from __future__ import annotations

import importlib.util
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
FETCH_PATH = ROOT / "scripts" / "fetch-yf-finance.py"
YF_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "fetch-yf-finance.yml"
MANIFEST_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "update-manifest.yml"


def load_fetch_module():
    sys.modules.setdefault("yfinance", types.SimpleNamespace(Ticker=lambda *_args, **_kwargs: None))
    spec = importlib.util.spec_from_file_location("fetch_yf_finance", FETCH_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load fetch module from {FETCH_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class FetchYfFinanceSelectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fetcher = load_fetch_module()
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.fetcher.STOCKANALYSIS_ETF_UNIVERSE = self.root / "stockanalysis" / "etf_universe.json"
        self.fetcher.STOCKANALYSIS_ETF_SCREENER = self.root / "stockanalysis" / "surfaces" / "etf_screener.json"
        self.fetcher.STOCK_UNIVERSE_DIR = self.root / "global-scouter" / "stocks" / "detail"
        self.fetcher.ETF_INDEX = self.root / "global-scouter" / "etfs" / "index.json"
        self.fetcher.MARKET_FACTS_INDEX = self.root / "computed" / "market_facts" / "index.json"
        self.fetcher.DASHBOARD_CONSTANTS = self.root / "dashboard" / "constants.ts"
        self.fetcher.PORTFOLIO_TS = self.root / "portfolio.ts"
        self.fetcher.OUT_DIR = self.root / "data" / "yf" / "finance"
        self.fetcher.YAHOO_BATCH_STATE_ROOT = self.root / "data" / "admin" / "yahoo-batch-quote-history"
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "data" / "admin" / "data-supply-state" / "v1"
        self.fetcher.DATA_SUPPLY_PROVIDER_TRUTH_ROOT = self.root
        self.fetcher.STOCK_UNIVERSE_DIR.mkdir(parents=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_stockanalysis_etfs_parse_records_tables_and_aum_priority(self) -> None:
        write_json(
            self.fetcher.STOCKANALYSIS_ETF_UNIVERSE,
            {
                "records": [
                    {"ticker": "AAA", "aum_raw": "1M"},
                    {"ticker": "$VOO", "aum": 1_000_000_000},
                    {"ticker": "NASDAQ", "aum": 999_000_000_000},
                    {"ticker": "bad symbol", "aum": 1},
                ]
            },
        )
        write_json(
            self.fetcher.STOCKANALYSIS_ETF_SCREENER,
            {
                "tables": [
                    {
                        "records": [
                            {"s": "BND", "aum": "5B"},
                            {"symbol": "VOO", "aum": "2B"},
                        ]
                    }
                ]
            },
        )

        self.assertEqual(self.fetcher.load_stockanalysis_etfs(), {"AAA", "BND", "VOO"})
        self.assertEqual(
            self.fetcher.sort_universe({"AAA", "BND", "VOO", "ZZZ"}, stockanalysis_etfs=True),
            ["BND", "VOO", "AAA", "ZZZ"],
        )

    def test_load_universe_keeps_stockanalysis_etfs_aum_first_for_limited_backfills(self) -> None:
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": [{"ticker": "SMALL", "aum": "1M"}]})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": [{"s": "BIG", "aum": "10B"}]})
        write_json(self.fetcher.ETF_INDEX, {"etfs": {}})
        self.fetcher.DASHBOARD_CONSTANTS.parent.mkdir(parents=True)
        self.fetcher.DASHBOARD_CONSTANTS.write_text("", encoding="utf-8")
        self.fetcher.PORTFOLIO_TS.write_text("", encoding="utf-8")
        for ticker in ("ZZZ", "AAA"):
            write_json(self.fetcher.STOCK_UNIVERSE_DIR / f"{ticker}.json", {})

        tickers = self.fetcher.load_universe(stockanalysis_etfs=True)

        self.assertEqual(tickers[:2], ["BIG", "SMALL"])
        self.assertIn("AAA", tickers)
        self.assertIn("ZZZ", tickers)

    def test_stocks_only_universe_includes_market_facts_class_and_asia_rows(self) -> None:
        write_json(
            self.fetcher.MARKET_FACTS_INDEX,
            {
                "rows": [
                    {"ticker": "USCLASS-A", "asset_type": "stock", "market": "US_CLASS"},
                    {"ticker": "0700.HK", "asset_type": "stock", "market": "HKEX"},
                    {"ticker": "600519.SS", "asset_type": "stock", "market": "SSE"},
                    {"ticker": "000001.SZ", "asset_type": "stock", "market": "SZSE"},
                    {"ticker": "ETFROW", "asset_type": "etf", "market": "US"},
                    {"ticker": "bad symbol", "asset_type": "stock", "market": "US"},
                ],
            },
        )
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": []})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": []})

        tickers = self.fetcher.load_universe(stocks_only=True)

        self.assertIn("USCLASS-A", tickers)
        self.assertIn("0700.HK", tickers)
        self.assertIn("600519.SS", tickers)
        self.assertIn("000001.SZ", tickers)
        self.assertNotIn("ETFROW", tickers)
        self.assertNotIn("bad symbol", tickers)

    def test_unlimited_daily_shard_union_covers_future_stock_universe(self) -> None:
        symbols = [f"STK{i:04d}" for i in range(1405)]
        write_json(
            self.fetcher.MARKET_FACTS_INDEX,
            {"rows": [{"ticker": ticker, "asset_type": "stock"} for ticker in symbols]},
        )

        tickers = self.fetcher.load_universe(stocks_only=True)
        shard_union = {
            ticker
            for shard_index in range(5)
            for ticker in tickers[shard_index::5]
        }
        capped_shard_union = {
            ticker
            for shard_index in range(5)
            for ticker in tickers[shard_index::5][:260]
        }

        self.assertEqual(set(tickers), shard_union)
        self.assertLess(len(capped_shard_union), len(tickers))

    def test_filter_history_gaps_skips_only_payloads_with_enough_history_rows(self) -> None:
        write_json(
            self.fetcher.OUT_DIR / "READY.json",
            {"data": {"info": {"quoteType": "ETF"}, "history_1y": [{"date": f"2026-01-{(idx % 28) + 1:02d}"} for idx in range(200)]}},
        )
        write_json(
            self.fetcher.OUT_DIR / "SHORT.json",
            {"data": {"info": {"quoteType": "ETF"}, "history_1y": [{"date": "2026-01-01"} for _ in range(50)]}},
        )
        write_json(self.fetcher.OUT_DIR / "EMPTY.json", {"data": {}})

        selected = self.fetcher.filter_history_gaps(["READY", "SHORT", "MISSING", "EMPTY"], min_rows=200)

        self.assertEqual(selected, ["SHORT", "MISSING", "EMPTY"])

    def test_stable_json_removes_non_finite_numbers(self) -> None:
        text = self.fetcher.stable_json(
            {
                "valid": 1,
                "drop_inf": float("inf"),
                "nested": {
                    "drop_negative_inf": -float("inf"),
                    "keep": 2,
                },
                "rows": [
                    {"drop_nan": float("nan"), "keep": 3},
                ],
            }
        )

        self.assertNotIn("Infinity", text)
        self.assertNotIn("NaN", text)
        payload = json.loads(text)
        self.assertEqual(payload["valid"], 1.0)
        self.assertNotIn("drop_inf", payload)
        self.assertEqual(payload["nested"], {"keep": 2.0})
        self.assertEqual(payload["rows"], [{"keep": 3.0}])

    def test_fetch_with_retry_records_ticker_timeout(self) -> None:
        def timeout_fetch(*_args, **_kwargs):
            raise self.fetcher.FetchTimeout("SLOW exceeded ticker timeout (1s)")

        self.fetcher.fetch_ticker = timeout_fetch

        data, latency_ms, error = self.fetcher.fetch_with_retry(
            "SLOW",
            retries=0,
            timeout_seconds=1,
        )

        self.assertIsNone(data)
        self.assertEqual(latency_ms, 0)
        self.assertEqual(error, "SLOW exceeded ticker timeout (1s)")

    def test_source_timestamps_are_provider_derived_and_distinct_from_fetch_time(self) -> None:
        payload = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {
                    "symbol": "AAPL",
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783540800,
                    "firstTradeDateEpochUtc": 345459600,
                },
                "history_1y": [
                    {"date": "2026-07-07", "Close": 310},
                    {"date": "2026-07-08", "Close": 313},
                ],
            },
        )

        self.assertEqual(payload["quote_as_of"], "2026-07-08T20:00:00Z")
        self.assertEqual(payload["history_as_of"], "2026-07-08")
        self.assertEqual(payload["source_as_of"], "2026-07-08")
        self.assertEqual(payload["first_trade_date"], "1980-12-12")
        self.assertNotEqual(payload["source_as_of"], payload["fetched_at"])

    def test_source_timestamp_future_or_regression_rejects_candidate_before_overwrite(self) -> None:
        existing = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        regressed = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783540800},
                "history_1y": [{"date": "2026-07-08", "Close": 313}],
            },
        )

        with self.assertRaisesRegex(ValueError, "source timestamp regression"):
            self.fetcher.validate_source_progression(existing, regressed)

        with self.assertRaisesRegex(ValueError, "quote_as_of follows fetched_at"):
            self.fetcher.decorate_finance_payload(
                ticker="FUTR",
                profile="daily",
                fetched_at="2026-07-10T21:15:00Z",
                data={
                    "info": {"symbol": "FUTR", "quoteType": "EQUITY", "regularMarketTime": 1783972800},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            )

    def test_missing_quote_stamp_or_disappearing_history_rejects_candidate(self) -> None:
        with self.assertRaisesRegex(ValueError, "quote_as_of is unavailable"):
            self.fetcher.decorate_finance_payload(
                ticker="NOSTAMP",
                profile="daily",
                fetched_at="2026-07-10T21:15:00Z",
                data={
                    "info": {"symbol": "NOSTAMP", "quoteType": "EQUITY"},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            )

        existing = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        no_history = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000},
                "history_1y": None,
            },
        )
        with self.assertRaisesRegex(ValueError, "source history disappeared"):
            self.fetcher.validate_source_progression(existing, no_history)

        collapsed = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000},
                "history_1y": [{"date": "2026-07-11", "Close": 315}],
            },
        )
        with self.assertRaisesRegex(ValueError, "history coverage collapsed"):
            self.fetcher.validate_source_progression(existing, collapsed)

    def test_failed_ticker_preserves_exact_lkg_and_last_fourteen_attempts(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        payload = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        write_json(truth, payload)
        expected_bytes = truth.read_bytes()
        expected_hash = hashlib.sha256(expected_bytes).hexdigest()
        store.record_success(
            "AAPL", payload, self._run("seed"), ["global_scouter"],
            {"attempts_used": 1, "failures": [], "latency_ms": 1},
        )

        for index in range(16):
            store.record_failure(
                "AAPL",
                f"controlled failure {index}",
                self._run(f"run-{index}"),
                ["global_scouter"],
                {"attempts_used": 2, "failures": [{"attempt": 1, "error": "timeout"}]},
            )

        state = json.loads((state_root / "tickers" / "AAPL.json").read_text())
        lkg = state_root / "lkg" / "AAPL.json"
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertTrue(state["retry"])
        self.assertEqual(state["lkg"]["payload_sha256"], expected_hash)
        self.assertEqual(lkg.read_bytes(), expected_bytes)
        self.assertEqual(len(state["attempts"]), 14)
        self.assertEqual(state["attempts"][0]["run_id"], "run-2")
        self.assertEqual(state["attempts"][-1]["run_id"], "run-15")
        self.assertEqual(len(list((state_root / "lkg").glob("AAPL*.json"))), 1)

        index = store.rebuild_index({"AAPL"}, self._run("run-15"))
        self.assertEqual(index["counts"]["lkg"], 1)
        self.assertEqual(index["counts"]["retry"], 1)
        self.assertEqual(index["current_attempt"]["failed"], 1)
        self.assertEqual(index["latest_failure"]["run_id"], "run-15")

        same_source = dict(payload)
        self.assertFalse(store.recovery_candidate_advances("AAPL", same_source))
        advanced = self.fetcher.decorate_finance_payload(
            ticker="AAPL",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783800000},
                "history_1y": [{"date": "2026-07-11", "Close": 315}],
            },
        )
        self.assertTrue(store.recovery_candidate_advances("AAPL", advanced))
        truth.write_bytes(b"{")
        store.record_failure(
            "AAPL", "canonical corruption probe", self._run("run-corrupt"), ["global_scouter"],
            {"attempts_used": 1, "failures": []},
        )
        self.assertEqual(lkg.read_bytes(), expected_bytes, "invalid canonical bytes must never replace the valid LKG")
        truth.write_text("{}\n", encoding="utf-8")
        store.record_failure(
            "AAPL", "shape corruption probe", self._run("run-shape-corrupt"), ["global_scouter"],
            {"attempts_used": 1, "failures": []},
        )
        self.assertEqual(lkg.read_bytes(), expected_bytes, "shape-invalid canonical JSON must never replace the valid LKG")
        write_json(lkg, {**payload, "ticker": "MSFT"})
        invalid_lkg_state = store.record_failure(
            "AAPL", "LKG tamper probe", self._run("run-lkg-tamper"), ["global_scouter"],
            {"attempts_used": 1, "failures": []},
        )
        self.assertEqual(invalid_lkg_state["resolution_state"], "unavailable")
        self.assertFalse(lkg.exists(), "identity/hash-invalid LKG must not remain advertised")
        self.assertEqual(list(state_root.rglob(".*.tmp")), [])

    def test_new_listing_without_history_is_pending_then_self_promotes(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        pending = self.fetcher.decorate_finance_payload(
            ticker="NEW",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {
                    "symbol": "NEW",
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783713600,
                    "firstTradeDateEpochUtc": 1783540800,
                },
                "history_1y": None,
            },
        )
        write_json(self.fetcher.OUT_DIR / "NEW.json", pending)
        store.record_success(
            "NEW", pending, self._run("natural-1"), ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
        )
        first = json.loads((state_root / "tickers" / "NEW.json").read_text())
        self.assertEqual(first["resolution_state"], "pending_history")
        self.assertTrue(first["retry"])
        self.assertEqual(first["pending"]["missing"], ["history"])
        self.assertEqual(first["pending"]["discovered_from"], ["market_facts"])
        self.assertEqual(first["pending"]["expected_resolution"], "next_natural_yahoo_run")
        self.assertEqual(first["pending"]["reason"], "recent_listing")

        recovered = self.fetcher.decorate_finance_payload(
            ticker="NEW",
            profile="daily",
            fetched_at="2026-07-11T21:15:00Z",
            data={
                "info": {
                    "symbol": "NEW",
                    "quoteType": "EQUITY",
                    "regularMarketTime": 1783800000,
                    "firstTradeDateEpochUtc": 1783540800,
                },
                "history_1y": [{"date": "2026-07-11", "Close": 10}],
            },
        )
        write_json(self.fetcher.OUT_DIR / "NEW.json", recovered)
        store.record_success(
            "NEW", recovered, self._run("natural-2"), ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
        )
        second = json.loads((state_root / "tickers" / "NEW.json").read_text())
        self.assertEqual(second["resolution_state"], "fresh_primary")
        self.assertFalse(second["retry"])
        self.assertEqual(second["recovered_from_run_id"], "natural-1")

        old = self.fetcher.decorate_finance_payload(
            ticker="OLD",
            profile="daily",
            fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {
                    "symbol": "OLD", "quoteType": "EQUITY", "regularMarketTime": 1783713600,
                    "firstTradeDateEpochUtc": 946684800,
                },
                "history_1y": None,
            },
        )
        write_json(self.fetcher.OUT_DIR / "OLD.json", old)
        first_old_state = store.record_success(
            "OLD", old, self._run("natural-old"), ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
        )
        self.assertEqual(first_old_state["resolution_state"], "pending_history")
        self.assertEqual(first_old_state["pending"]["reason"], "newly_discovered_no_history")
        late_run = self._run("natural-old-late")
        late_run["observed_at"] = "2026-08-20T22:00:00Z"
        old_state = store.record_success(
            "OLD", old, late_run, ["market_facts"],
            {"attempts_used": 1, "failures": [], "latency_ms": 2},
        )
        self.assertEqual(old_state["resolution_state"], "unavailable")
        self.assertNotIn("pending", old_state)

    def test_natural_retry_candidates_are_claimed_once_before_regular_shards(self) -> None:
        tickers = ["AAA", "AAPL", "BBB", "CCC", "DDD", "EEE"]
        retry = {"AAPL"}

        shard_zero = self.fetcher.select_ticker_plan(
            tickers, retry, shard="0/5", natural=True, all_shards=True,
        )
        shard_one = self.fetcher.select_ticker_plan(
            tickers, retry, shard="1/5", natural=True, all_shards=True,
        )
        weekly = self.fetcher.select_ticker_plan(
            tickers, retry, shard="3/6", natural=True, all_shards=False,
        )

        self.assertEqual(shard_zero[0], "AAPL")
        self.assertNotIn("AAPL", shard_one)
        self.assertEqual(weekly[0], "AAPL")

    def test_controlled_failure_scope_is_manual_targeted_and_stateful_only(self) -> None:
        self.fetcher.validate_controlled_failure_scope(
            {"AAPL"}, ["AAPL"], event_name="workflow_dispatch", record_batch_state=True,
        )
        for injected, selected, event_name, stateful, message in [
            ({"AAPL"}, ["AAPL"], "schedule", True, "workflow_dispatch"),
            ({"AAPL"}, ["MSFT"], "workflow_dispatch", True, "explicit --tickers"),
            ({"AAPL"}, ["AAPL"], "workflow_dispatch", False, "batch state"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.fetcher.validate_controlled_failure_scope(
                    injected, selected, event_name=event_name, record_batch_state=stateful,
                )

    def test_ticker_retry_and_cache_guards_are_bounded(self) -> None:
        self.assertEqual(self.fetcher.validate_explicit_tickers(["aapl", "005930.ks"]), ["AAPL", "005930.KS"])
        for ticker in ("../AAPL", "AAPL/../../x", "bad symbol"):
            with self.subTest(ticker=ticker), self.assertRaisesRegex(ValueError, "invalid explicit ticker"):
                self.fetcher.validate_explicit_tickers([ticker])
        self.assertEqual(self.fetcher.validate_retry_count(5), 5)
        with self.assertRaisesRegex(ValueError, "between 0 and 5"):
            self.fetcher.validate_retry_count(100)
        payload = {"fetched_at": self.fetcher._observed_now(), "data": {"history_1y": [{"date": "2026-07-10"}]}}
        self.assertTrue(self.fetcher.should_skip_cached_payload("AAPL", payload, 24, set(), set()))
        self.assertFalse(self.fetcher.should_skip_cached_payload("AAPL", payload, 24, {"AAPL"}, set()))
        self.assertFalse(self.fetcher.should_skip_cached_payload("AAPL", payload, 24, set(), {"AAPL"}))

    def test_current_attempt_isolated_by_run_attempt_and_skip_costs_zero_fetches(self) -> None:
        state_root = self.root / "admin" / "yahoo-batch-quote-history"
        store = self.fetcher.YahooBatchStateStore(state_root, self.fetcher.OUT_DIR)
        payload = self.fetcher.decorate_finance_payload(
            ticker="AAPL", profile="daily", fetched_at="2026-07-10T21:15:00Z",
            data={
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 314}],
            },
        )
        write_json(self.fetcher.OUT_DIR / "AAPL.json", payload)
        run_one = self._run("same-run", attempt=1)
        run_two = self._run("same-run", attempt=2)
        store.record_success("AAPL", payload, run_one, ["global_scouter"], {"attempts_used": 1, "failures": [], "latency_ms": 1})
        store.record_skip("AAPL", payload, run_two, ["global_scouter"])
        index = store.rebuild_index({"AAPL"}, run_two)
        self.assertEqual(index["current_attempt"]["attempted"], 1)
        self.assertEqual(index["current_attempt"]["skipped"], 1)
        self.assertEqual(index["current_attempt"]["fetch_attempts"], 0)

        legacy = {
            "schema_version": "yf-finance/v2", "ticker": "MSFT",
            "fetched_at": "2026-07-10T21:15:00Z", "profile": "daily",
            "data": {
                "info": {"symbol": "MSFT", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 500}],
            },
        }
        write_json(self.fetcher.OUT_DIR / "MSFT.json", legacy)
        self.assertEqual(store.bootstrap_existing({"AAPL", "MSFT"}, {"MSFT": ["market_facts"]}, run_two, {"AAPL"}), 1)
        msft = json.loads((state_root / "tickers" / "MSFT.json").read_text())
        self.assertEqual(msft["current"]["quote_as_of"], "2026-07-10T20:00:00Z")
        self.assertEqual(msft["current"]["source_as_of"], "2026-07-10")
        run_three = self._run("terminated-run", attempt=1)
        terminated = store.rebuild_index({"AAPL", "MSFT"}, run_three, batch_failure="batch terminated")
        self.assertEqual(terminated["current_attempt"]["attempted"], 1)
        self.assertEqual(terminated["current_attempt"]["failed"], 1)
        self.assertEqual(terminated["latest_failure"]["scope"], "batch")

    def _run(self, run_id: str, attempt: int = 1) -> dict:
        return {
            "run_id": run_id,
            "run_attempt": attempt,
            "event_name": "schedule",
            "schedule": "20 23 * * 1-5",
            "natural": True,
            "shard": "0/5",
            "observed_at": "2026-07-11T22:00:00Z",
        }

    def test_merge_existing_payload_data_preserves_heavy_fields(self) -> None:
        existing = {
            "data": {
                "info": {"currentPrice": 10, "trailingPE": 20, "sector": "Technology"},
                "income_statement": {"2025-12-31": {"Total Revenue": 100}},
                "history_1y": [{"date": "2026-01-01", "Close": 10}],
            }
        }
        fetched = {
            "info": {"currentPrice": 11, "previousClose": 10.5},
            "fast_info": {"last_price": 11},
            "income_statement": None,
            "history_1y": [{"date": "2026-01-02", "Close": 11}],
        }

        merged = self.fetcher.merge_existing_payload_data(existing, fetched)

        self.assertEqual(merged["info"]["currentPrice"], 11)
        self.assertEqual(merged["info"]["trailingPE"], 20)
        self.assertEqual(merged["info"]["previousClose"], 10.5)
        self.assertEqual(merged["income_statement"], {"2025-12-31": {"Total Revenue": 100}})
        self.assertEqual(merged["fast_info"], {"last_price": 11})
        self.assertEqual(merged["history_1y"], [{"date": "2026-01-02", "Close": 11}])
        preserved = self.fetcher.preserve_history_coverage(existing, fetched)
        self.assertEqual(
            [row["date"] for row in preserved["history_1y"]],
            ["2026-01-01", "2026-01-02"],
        )

    def test_plan_only_prints_resolved_plan_without_fetching_or_writing_summary(self) -> None:
        write_json(self.fetcher.STOCKANALYSIS_ETF_UNIVERSE, {"records": [{"ticker": "SMALL", "aum": "1M"}]})
        write_json(self.fetcher.STOCKANALYSIS_ETF_SCREENER, {"records": [{"s": "BIG", "aum": "10B"}]})
        write_json(self.fetcher.ETF_INDEX, {"etfs": {}})
        self.fetcher.DASHBOARD_CONSTANTS.parent.mkdir(parents=True)
        self.fetcher.DASHBOARD_CONSTANTS.write_text("", encoding="utf-8")
        self.fetcher.PORTFOLIO_TS.write_text("", encoding="utf-8")

        calls = []
        self.fetcher.fetch_with_retry = lambda *args, **kwargs: calls.append((args, kwargs))
        original_argv = sys.argv
        original_stdout = sys.stdout
        buffer = io.StringIO()
        try:
            sys.argv = [
                "fetch-yf-finance.py",
                "--stockanalysis-etfs",
                "--history-gaps-only",
                "--limit",
                "1",
                "--plan-only",
                "--plan-sample-size",
                "1",
            ]
            sys.stdout = buffer
            self.fetcher.main()
        finally:
            sys.argv = original_argv
            sys.stdout = original_stdout

        payload = json.loads(buffer.getvalue())
        self.assertEqual(calls, [])
        self.assertFalse((self.fetcher.OUT_DIR / "_summary.json").exists())
        self.assertEqual(payload["mode"], "plan_only")
        self.assertEqual(payload["sample"], ["BIG"])
        self.assertEqual(payload["count"], 1)
        self.assertTrue(payload["history_gaps_only"])
        self.assertEqual(payload["priority"], "stockanalysis_etf_aum")

    def test_enrolled_yahoo_write_records_exact_manual_object(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        payload = {
            "schema_version": "yf-finance/v2", "ticker": "AAPL",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {"info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 10, "previousClose": 9}, "history_1y": [{"date": "2026-07-10", "Close": 10}]},
        }
        row = self.fetcher.write_finance_payload("AAPL", payload)
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        pending = self.root / "state" / "providers" / "yahoo_finance" / "stock_detail" / "pending" / "AAPL.json"
        pointer = json.loads(pending.read_text())
        self.assertEqual((self.root / "state" / pointer["path"]).read_bytes(), truth.read_bytes())
        self.assertEqual(row["observation_origin"], "rebuild")
        self.assertEqual(row["collection_origin"], "manual")

    def test_yahoo_only_write_keeps_canonical_ownership_without_enrollment(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        payload = {
            "schema_version": "yf-finance/v2", "ticker": "ZZZZ",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {"info": {"symbol": "ZZZZ", "quoteType": "EQUITY", "currentPrice": 5, "previousClose": 4}, "history_1y": [{"date": "2026-07-10", "Close": 5}]},
        }
        row = self.fetcher.write_finance_payload("ZZZZ", payload)
        self.assertIsNone(row)
        self.assertTrue((self.fetcher.OUT_DIR / "ZZZZ.json").exists())
        self.assertFalse((self.root / "state").exists())

    def test_enrolled_yahoo_invalid_preserves_truth_and_records_evidence_only(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        truth.parent.mkdir(parents=True)
        sentinel = b'{"sentinel":true}'
        truth.write_bytes(sentinel)
        payload = {
            "schema_version": "yf-finance/v2", "ticker": "AAPL",
            "fetched_at": "2026-07-10T10:00:00Z", "profile": "full",
            "data": {"info": {"symbol": "AAPL", "quoteType": "ETF", "currentPrice": 10, "previousClose": 9}, "history_1y": [{"date": "2026-07-10", "Close": 10}]},
        }
        with self.assertRaises(ValueError):
            self.fetcher.write_finance_payload("AAPL", payload)
        observation = json.loads(next((self.root / "state" / "history" / "observations").glob("*.jsonl")).read_text())
        self.assertEqual(truth.read_bytes(), sentinel)
        self.assertEqual(observation["validation_status"], "invalid")
        self.assertFalse((self.root / "state" / "providers").exists())

    def test_enrolled_merge_preserves_heavy_fields_but_never_fills_quote_from_old_payload(self) -> None:
        existing = {
            "data": {
                "info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 10, "previousClose": 9, "marketCap": 100},
                "income_statement": {"2025": {"Revenue": 50}},
            }
        }
        fresh = {"info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 11}}
        merged = self.fetcher.merge_existing_payload_data(existing, fresh)
        bound = self.fetcher.bind_enrolled_quote_group_to_fresh_fetch(merged, fresh)
        self.assertEqual(bound["info"]["marketCap"], 100)
        self.assertEqual(bound["income_statement"], {"2025": {"Revenue": 50}})
        self.assertEqual(bound["info"]["currentPrice"], 11)
        self.assertNotIn("previousClose", bound["info"])

    def test_validation_failure_isolated_to_ticker_and_batch_summary_continues(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        truth.parent.mkdir(parents=True)
        sentinel = b'{"sentinel":true}'
        truth.write_bytes(sentinel)

        def fake_fetch(ticker, **_kwargs):
            if ticker == "AAPL":
                return {
                    "info": {"symbol": ticker, "quoteType": "ETF", "currentPrice": 10, "previousClose": 9, "regularMarketTime": 1783713600},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                }, 1, None
            return {
                "info": {"symbol": ticker, "quoteType": "EQUITY", "currentPrice": 20, "previousClose": 19, "regularMarketTime": 1783713600},
                "history_1y": [{"date": "2026-07-10", "Close": 20}],
            }, 1, None

        self.fetcher.fetch_with_retry = fake_fetch
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = ["fetch-yf-finance.py", "--tickers", "AAPL,MSFT", "--sleep", "0", "--retries", "0"]
            sys.stdout = io.StringIO()
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(truth.read_bytes(), sentinel)
        self.assertTrue((self.fetcher.OUT_DIR / "MSFT.json").exists())
        self.assertTrue((self.fetcher.OUT_DIR / "_summary.json").exists())

    def test_failed_batch_attempt_persists_run_evidence_and_holds_canonical_hash(self) -> None:
        truth = self.fetcher.OUT_DIR / "AAPL.json"
        write_json(
            truth,
            {
                "schema_version": "yf-finance/v2",
                "ticker": "AAPL",
                "fetched_at": "2026-07-10T21:15:00Z",
                "profile": "daily",
                "data": {
                    "info": {"symbol": "AAPL", "quoteType": "EQUITY", "regularMarketTime": 1783713600},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            },
        )
        before = hashlib.sha256(truth.read_bytes()).hexdigest()
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: (
            None,
            0,
            "controlled AAPL failure",
            {"attempts_used": 2, "failures": [{"attempt": 1, "error": "injected"}], "latency_ms": 0},
        )

        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = [
                "fetch-yf-finance.py", "--tickers", "AAPL", "--record-batch-state",
                "--run-id", "12345", "--run-attempt", "2", "--event-name", "workflow_dispatch",
                "--sleep", "0", "--retries", "1",
            ]
            sys.stdout = io.StringIO()
            with self.assertRaises(SystemExit) as raised:
                self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout

        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(hashlib.sha256(truth.read_bytes()).hexdigest(), before)
        state = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "tickers" / "AAPL.json").read_text())
        index = json.loads((self.fetcher.YAHOO_BATCH_STATE_ROOT / "index.json").read_text())
        self.assertEqual(state["resolution_state"], "lkg_primary")
        self.assertEqual(state["latest_failure"]["run_id"], "12345")
        self.assertEqual(state["latest_failure"]["run_attempt"], 2)
        self.assertEqual(index["current_attempt"]["attempted"], 1)
        self.assertEqual(index["current_attempt"]["failed"], 1)
        self.assertEqual(index["current_attempt"]["fetch_attempts"], 2)

    def test_fresh_enrolled_cache_skip_emits_no_observation(self) -> None:
        self.fetcher.DATA_SUPPLY_STATE_ROOT = self.root / "state"
        write_json(
            self.fetcher.OUT_DIR / "AAPL.json",
            {
                "schema_version": "yf-finance/v2",
                "ticker": "AAPL",
                "fetched_at": self.fetcher._observed_now(),
                "profile": "full",
                "data": {
                    "info": {"symbol": "AAPL", "quoteType": "EQUITY", "currentPrice": 10, "previousClose": 9},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                },
            },
        )
        self.fetcher.fetch_with_retry = lambda *_args, **_kwargs: self.fail("fresh cache should skip fetch")
        original_argv, original_stdout = sys.argv, sys.stdout
        try:
            sys.argv = ["fetch-yf-finance.py", "--tickers", "AAPL", "--max-age-hours", "24", "--sleep", "0"]
            sys.stdout = io.StringIO()
            self.fetcher.main()
        finally:
            sys.argv, sys.stdout = original_argv, original_stdout
        self.assertFalse((self.root / "state").exists())

    def test_local_universe_loader_import_does_not_require_yfinance(self) -> None:
        code = """
import builtins
import runpy
import sys

real_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name == "yfinance":
        raise ImportError("yfinance must stay collection-only")
    return real_import(name, *args, **kwargs)

builtins.__import__ = guarded_import
namespace = runpy.run_path(sys.argv[1])
assert callable(namespace["load_universe"])
"""
        subprocess.run([sys.executable, "-c", code, str(FETCH_PATH)], check=True)

    def test_workflow_persists_candidates_before_public_promotion(self) -> None:
        workflow = YF_WORKFLOW_PATH.read_text(encoding="utf-8")
        quarter_start = workflow.index("      - name: Refresh owned Yahoo quarter-close source")
        candidate_start = workflow.index("      - name: Persist fetched Yahoo source data")
        failure_dispatch_start = workflow.index("      - name: Publish failed Yahoo attempt evidence")
        shared_dispatch_start = workflow.index("      - name: Dispatch shared projection rebuild")
        candidate_step = workflow[candidate_start:failure_dispatch_start]
        failure_dispatch = workflow[failure_dispatch_start:shared_dispatch_start]
        shared_dispatch = workflow[shared_dispatch_start:]

        self.assertLess(quarter_start, candidate_start)
        self.assertLess(candidate_start, failure_dispatch_start)
        self.assertLess(failure_dispatch_start, shared_dispatch_start)
        self.assertIn("git add -- \\", candidate_step)
        self.assertIn("data/yf/finance", candidate_step)
        self.assertIn("data/admin/yahoo-batch-quote-history", candidate_step)
        self.assertIn("data/yf/quarter_closes.json", candidate_step)
        self.assertIn("100xfenok-next/public/data/yf/quarter_closes.json", candidate_step)
        self.assertIn("git restore --staged --worktree -- data/yf/finance/_summary.json", candidate_step)
        self.assertIn("always()", candidate_step)
        self.assertNotIn("100xfenok-next/public/data/yf/finance", candidate_step)

        run_step = workflow[workflow.index("      - name: Run batch fetch"):quarter_start]
        self.assertIn("id: fetch_batch", run_step)
        self.assertIn("--record-batch-state", run_step)
        self.assertIn("--run-id", run_step)
        self.assertIn("--natural-run", run_step)
        self.assertIn("--all-shards-run", run_step)
        self.assertIn("controlled_failure_tickers", workflow)
        self.assertIn("--controlled-failure-tickers", run_step)
        self.assertIn("steps.fetch_batch.outcome == 'failure'", failure_dispatch)
        self.assertIn("steps.quarter_closes.outcome == 'failure'", failure_dispatch)
        self.assertIn("steps.persist_yahoo_state.outcome == 'success'", failure_dispatch)
        self.assertIn("steps.persist_yahoo_state.outputs.persisted == 'true'", failure_dispatch)
        self.assertIn('persisted=true', candidate_step)
        self.assertIn("gh workflow run update-manifest.yml --ref main", failure_dispatch)
        self.assertIn("gh workflow run update-manifest.yml --ref main", shared_dispatch)
        self.assertNotIn("build-market-facts.py", workflow)
        self.assertNotIn("build-rim-index.mjs", workflow)
        self.assertNotIn("data/manifest.json", workflow)
        self.assertNotIn("100xfenok-next/public", run_step)
        self.assertIn("python3 scripts/build-quarter-closes.py", workflow[quarter_start:candidate_start])

        manifest_workflow = MANIFEST_WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertIn("      - '!data/yf/**'", manifest_workflow)
        self.assertIn("      - '!data/admin/yahoo-batch-quote-history/**'", manifest_workflow)
        self.assertIn("python3 scripts/rebuild-yf-finance-summary.py", manifest_workflow)
        self.assertIn("python3 scripts/build-market-facts.py --no-public-mirror", manifest_workflow)
        self.assertIn("node scripts/build-rim-index.mjs", manifest_workflow)
        self.assertNotIn("python3 scripts/build-quarter-closes.py", manifest_workflow)


if __name__ == "__main__":
    unittest.main()
