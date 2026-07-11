#!/usr/bin/env python3
"""Contract checks for yf Finance staged ETF backfill selection."""

from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
FETCH_PATH = ROOT / "scripts" / "fetch-yf-finance.py"


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
                    "info": {"symbol": ticker, "quoteType": "ETF", "currentPrice": 10, "previousClose": 9},
                    "history_1y": [{"date": "2026-07-10", "Close": 10}],
                }, 1, None
            return {
                "info": {"symbol": ticker, "quoteType": "EQUITY", "currentPrice": 20, "previousClose": 19},
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


if __name__ == "__main__":
    unittest.main()
