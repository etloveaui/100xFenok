#!/usr/bin/env python3
"""Contract checks for computed market facts."""

from __future__ import annotations

from datetime import date, timedelta
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "scripts" / "build-market-facts.py"


def load_build_module():
    spec = importlib.util.spec_from_file_location("build_market_facts", BUILD_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load build module from {BUILD_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def history_rows(count=80, start_close=100.0):
    start = date(2026, 1, 2)
    return [
        {
            "date": (start + timedelta(days=index)).isoformat(),
            "Close": start_close + index,
            "Volume": 1000 + index,
        }
        for index in range(count)
    ]


class BuildMarketFactsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = load_build_module()

    def test_history_return_uses_trading_day_offset(self) -> None:
        payload = {
            "fetched_at": "2026-06-19T00:00:00Z",
            "data": {"history_1y": history_rows()},
        }

        result = self.mod.yf_history_return_fact(payload, 21)

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "yf.history_1y")
        self.assertEqual(result["unit"], "percent_points")
        self.assertAlmostEqual(result["value"], ((179.0 - 158.0) / 158.0) * 100)

    def test_build_one_derives_history_returns_and_normalizes_average_returns(self) -> None:
        yf_payload = {
            "fetched_at": "2026-06-19T00:00:00Z",
            "data": {
                "info": {
                    "quoteType": "ETF",
                    "ytdReturn": 4.5,
                    "threeYearAverageReturn": 0.1234,
                    "fiveYearAverageReturn": 0.2345,
                    "fiftyTwoWeekChangePercent": 42.0,
                },
                "history_1y": history_rows(),
            },
        }

        result = self.mod.build_one(
            "TEST",
            yf_payload,
            {"asset_type": "etf", "normalized": {"quote": {}, "overview": {}, "holdings": []}},
            None,
        )
        facts = result["facts"]

        self.assertEqual(result["asset_type"], "etf")
        self.assertEqual(facts["return_1m"]["source"], "yf.history_1y")
        self.assertEqual(facts["return_3m"]["source"], "yf.history_1y")
        self.assertEqual(facts["return_ytd"]["source"], "yf.history_1y")
        self.assertEqual(facts["return_ytd"]["candidate_count"], 2)
        self.assertAlmostEqual(facts["return_3y_avg"]["value"], 12.34)
        self.assertAlmostEqual(facts["return_5y_avg"]["value"], 23.45)

    def test_ytd_uses_yahoo_info_when_history_is_missing(self) -> None:
        yf_payload = {
            "fetched_at": "2026-06-19T00:00:00Z",
            "data": {
                "info": {
                    "quoteType": "ETF",
                    "ytdReturn": 7.25,
                },
                "history_1y": [],
            },
        }

        result = self.mod.build_one("NOHIST", yf_payload, {"asset_type": "etf", "normalized": {}}, None)
        facts = result["facts"]

        self.assertNotIn("return_1m", facts)
        self.assertEqual(facts["return_ytd"]["source"], "yf")
        self.assertEqual(facts["return_ytd"]["value"], 7.25)

    def test_stockanalysis_monthly_history_fills_three_month_return_gap(self) -> None:
        sa_payload = {
            "asset_type": "etf",
            "fetched_at": "2026-06-19T00:00:00Z",
            "normalized": {
                "quote": {},
                "overview": {},
                "holdings": [],
                "history": [
                    {"t": "2026-06-01", "c": 120, "a": 118},
                    {"t": "2026-05-01", "c": 112, "a": 110},
                    {"t": "2026-04-01", "c": 108, "a": 105},
                    {"t": "2026-03-01", "c": 100, "a": 98},
                ],
            },
        }

        result = self.mod.build_one("SA3M", None, sa_payload, None)
        fact = result["facts"]["return_3m"]

        self.assertEqual(fact["source"], "stockanalysis.detail.history")
        self.assertEqual(fact["unit"], "percent_points")
        self.assertEqual(fact["as_of"], "2026-06-01")
        self.assertAlmostEqual(fact["value"], ((118.0 - 98.0) / 98.0) * 100)

    def test_etf_catalog_performance_fills_return_gaps(self) -> None:
        catalog_payload = {
            "ticker": "CAT",
            "fetched_at": "2026-06-19T00:00:00Z",
            "market_facts_source": "stockanalysis.etf_screener.performance",
            "performance": {
                "tr1m": 1.2,
                "trYTD": 9.8,
                "tr1y": 26.5,
                "cagr5y": 13.7,
                "cagr10y": 15.9,
                "cagrMAX": 14.8,
            },
        }

        result = self.mod.build_one("CAT", None, None, None, catalog_payload)
        facts = result["facts"]

        self.assertEqual(result["asset_type"], "etf")
        self.assertTrue(result["sources"]["stockanalysis_etf_catalog"])
        self.assertEqual(facts["return_1m"]["source"], "stockanalysis.etf_screener.performance")
        self.assertEqual(facts["return_ytd"]["source"], "stockanalysis.etf_screener.performance")
        self.assertEqual(facts["return_1y"]["source"], "stockanalysis.etf_screener.performance")
        self.assertEqual(facts["return_5y_avg"]["source"], "stockanalysis.etf_screener.performance")
        self.assertEqual(facts["return_10y_avg"]["source"], "stockanalysis.etf_screener.performance")
        self.assertEqual(facts["return_max_avg"]["source"], "stockanalysis.etf_screener.performance")
        self.assertEqual(facts["return_1m"]["unit"], "percent_points")
        self.assertEqual(facts["return_10y_avg"]["unit"], "percent_points")
        self.assertAlmostEqual(facts["return_max_avg"]["value"], 14.8)

    def test_history_return_stays_primary_when_catalog_performance_exists(self) -> None:
        yf_payload = {
            "fetched_at": "2026-06-19T00:00:00Z",
            "data": {
                "info": {"quoteType": "ETF"},
                "history_1y": history_rows(),
            },
        }
        catalog_payload = {
            "ticker": "BOTH",
            "fetched_at": "2026-06-19T00:00:00Z",
            "market_facts_source": "stockanalysis.etf_screener.performance",
            "performance": {"tr1m": 1.2},
        }

        result = self.mod.build_one("BOTH", yf_payload, None, None, catalog_payload)
        fact = result["facts"]["return_1m"]

        self.assertEqual(fact["source"], "yf.history_1y")
        self.assertEqual(fact["candidate_count"], 2)
        self.assertEqual(fact["candidates"][1]["source"], "stockanalysis.etf_screener.performance")


if __name__ == "__main__":
    unittest.main()
