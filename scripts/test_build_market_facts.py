#!/usr/bin/env python3
"""Contract checks for computed market facts."""

from __future__ import annotations

from datetime import date, timedelta
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
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


def monthly_stockanalysis_rows():
    return [
        {"t": "2023-06-01", "a": 100.0, "c": 101.0},
        {"t": "2023-12-01", "a": 108.0, "c": 109.0},
        {"t": "2024-06-01", "a": 115.0, "c": 116.0},
        {"t": "2024-12-01", "a": 121.0, "c": 122.0},
        {"t": "2025-06-01", "a": 126.0, "c": 127.0},
        {"t": "2025-12-01", "a": 130.0, "c": 131.0},
        {"t": "2026-06-01", "a": 133.1, "c": 134.0},
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

    def test_stockanalysis_multi_year_history_fills_three_year_average_return_gap(self) -> None:
        sa_payload = {
            "asset_type": "etf",
            "fetched_at": "2026-06-19T00:00:00Z",
            "normalized": {
                "quote": {},
                "overview": {},
                "holdings": [],
                "history_periods": {
                    "monthly_3y": monthly_stockanalysis_rows(),
                },
            },
        }

        result = self.mod.build_one("SA3Y", None, sa_payload, None)
        fact = result["facts"]["return_3y_avg"]

        years = (date(2026, 6, 1) - date(2023, 6, 1)).days / 365.2425
        expected = (((133.1 / 100.0) ** (1 / years)) - 1) * 100
        self.assertEqual(fact["source"], "stockanalysis.detail.history")
        self.assertEqual(fact["unit"], "percent_points")
        self.assertEqual(fact["as_of"], "2026-06-01")
        self.assertAlmostEqual(fact["value"], expected)

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

    def test_carry_forward_stable_payload_when_payload_is_unchanged(self) -> None:
        existing = {
            "ticker": "SAME",
            "generated_at": "2026-06-18T00:00:00Z",
            "facts": {"price": {"value": 100.0, "source": "yf"}},
        }
        payload = {
            "ticker": "SAME",
            "generated_at": "2026-06-19T00:00:00Z",
            "facts": {"price": {"value": 100.0, "source": "yf"}},
        }

        result = self.mod.carry_forward_stable_payload(existing, payload)

        self.assertEqual(result["generated_at"], "2026-06-18T00:00:00Z")
        self.assertEqual(result["facts"]["price"]["value"], 100.0)

    def test_carry_forward_stable_payload_ignores_float_epsilon_churn(self) -> None:
        existing = {
            "ticker": "BABX",
            "generated_at": "2026-06-18T00:00:00Z",
            "facts": {"return_3y_avg": {"value": -18.49677368804874, "source": "stockanalysis.detail.history"}},
        }
        payload = {
            "ticker": "BABX",
            "generated_at": "2026-06-19T00:00:00Z",
            "facts": {"return_3y_avg": {"value": -18.49677368804875, "source": "stockanalysis.detail.history"}},
        }

        result = self.mod.carry_forward_stable_payload(existing, payload)

        self.assertEqual(result["generated_at"], "2026-06-18T00:00:00Z")
        self.assertEqual(result["facts"]["return_3y_avg"]["value"], -18.49677368804874)

    def test_slickcharts_empty_current_uses_latest_metrics_history(self) -> None:
        slick_payload = {
            "company": "Hologic, Inc.",
            "updated": "2026-06-18T00:00:00Z",
            "current": {},
            "metrics_history": [
                {"date": "2026-03-01", "price": 70.0, "market_cap_billions": 15.5},
                {"date": "2026-04-01", "price": 75.67, "market_cap_billions": 16.89},
            ],
        }

        result = self.mod.build_one("HOLX", None, None, slick_payload)
        facts = result["facts"]

        self.assertEqual(facts["price"]["source"], "slickcharts")
        self.assertEqual(facts["price"]["as_of"], "2026-04-01")
        self.assertEqual(facts["price"]["value"], 75.67)
        self.assertEqual(facts["market_cap"]["source"], "slickcharts")
        self.assertEqual(facts["market_cap"]["as_of"], "2026-04-01")
        self.assertEqual(facts["market_cap"]["value"], 16_890_000_000.0)

    def test_generated_at_advances_when_payload_content_changes(self) -> None:
        existing = {
            "ticker": "DIFF",
            "generated_at": "2026-06-18T00:00:00Z",
            "facts": {"price": {"value": 100.0, "source": "yf"}},
        }
        payload = {
            "ticker": "DIFF",
            "generated_at": "2026-06-19T00:00:00Z",
            "facts": {"price": {"value": 101.0, "source": "yf"}},
        }

        result = self.mod.carry_forward_stable_payload(existing, payload)

        self.assertEqual(result["generated_at"], "2026-06-19T00:00:00Z")

    def test_main_preserves_ticker_generated_at_across_noop_rebuilds(self) -> None:
        original_data = self.mod.DATA
        original_out = self.mod.OUT
        original_public_out = self.mod.PUBLIC_OUT
        original_now_iso = self.mod.now_iso

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_root = root / "data"
            yf_dir = data_root / "yf" / "finance"
            yf_dir.mkdir(parents=True)
            self.mod.DATA = data_root
            self.mod.OUT = data_root / "computed" / "market_facts"
            self.mod.PUBLIC_OUT = root / "public" / "data" / "computed" / "market_facts"

            source_payload = {
                "fetched_at": "2026-06-19T00:00:00Z",
                "data": {
                    "info": {
                        "quoteType": "EQUITY",
                        "shortName": "Same Inc.",
                        "currency": "USD",
                        "currentPrice": 100.0,
                    }
                },
            }
            source_path = yf_dir / "SAME.json"
            source_path.write_text(json.dumps(source_payload), encoding="utf-8")

            try:
                self.mod.now_iso = lambda: "2026-06-19T01:00:00Z"
                self.mod.main()
                first = self.mod.load_json(self.mod.OUT / "tickers" / "SAME.json")

                self.mod.now_iso = lambda: "2026-06-19T02:00:00Z"
                self.mod.main()
                second = self.mod.load_json(self.mod.OUT / "tickers" / "SAME.json")

                source_payload["data"]["info"]["currentPrice"] = 101.0
                source_path.write_text(json.dumps(source_payload), encoding="utf-8")
                self.mod.now_iso = lambda: "2026-06-19T03:00:00Z"
                self.mod.main()
                third = self.mod.load_json(self.mod.OUT / "tickers" / "SAME.json")
            finally:
                self.mod.DATA = original_data
                self.mod.OUT = original_out
                self.mod.PUBLIC_OUT = original_public_out
                self.mod.now_iso = original_now_iso

        self.assertEqual(first["generated_at"], "2026-06-19T01:00:00Z")
        self.assertEqual(second["generated_at"], "2026-06-19T01:00:00Z")
        self.assertEqual(third["generated_at"], "2026-06-19T03:00:00Z")

    def test_main_no_public_mirror_skips_public_output(self) -> None:
        original_data = self.mod.DATA
        original_out = self.mod.OUT
        original_public_out = self.mod.PUBLIC_OUT
        original_now_iso = self.mod.now_iso

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_root = root / "data"
            yf_dir = data_root / "yf" / "finance"
            yf_dir.mkdir(parents=True)
            self.mod.DATA = data_root
            self.mod.OUT = data_root / "computed" / "market_facts"
            self.mod.PUBLIC_OUT = root / "public" / "data" / "computed" / "market_facts"

            source_payload = {
                "fetched_at": "2026-06-19T00:00:00Z",
                "data": {
                    "info": {
                        "quoteType": "EQUITY",
                        "shortName": "Private Inc.",
                        "currency": "USD",
                        "currentPrice": 25.0,
                    }
                },
            }
            (yf_dir / "PRIV.json").write_text(json.dumps(source_payload), encoding="utf-8")

            try:
                self.mod.now_iso = lambda: "2026-06-19T01:00:00Z"
                self.mod.main(["--no-public-mirror"])
            finally:
                self.mod.DATA = original_data
                self.mod.OUT = original_out
                self.mod.PUBLIC_OUT = original_public_out
                self.mod.now_iso = original_now_iso

            self.assertTrue((data_root / "computed" / "market_facts" / "index.json").exists())
            self.assertTrue((data_root / "computed" / "market_facts" / "tickers" / "PRIV.json").exists())
            self.assertFalse((root / "public").exists())

    def test_main_targeted_tickers_preserve_full_index_and_skip_public_output(self) -> None:
        original_data = self.mod.DATA
        original_out = self.mod.OUT
        original_public_out = self.mod.PUBLIC_OUT
        original_now_iso = self.mod.now_iso

        def yf_payload(ticker, price):
            return {
                "fetched_at": "2026-06-19T00:00:00Z",
                "data": {
                    "info": {
                        "quoteType": "EQUITY",
                        "shortName": f"{ticker} Inc.",
                        "currency": "USD",
                        "currentPrice": price,
                    }
                },
            }

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_root = root / "data"
            yf_dir = data_root / "yf" / "finance"
            yf_dir.mkdir(parents=True)
            self.mod.DATA = data_root
            self.mod.OUT = data_root / "computed" / "market_facts"
            self.mod.PUBLIC_OUT = root / "public" / "data" / "computed" / "market_facts"

            aaa_path = yf_dir / "AAA.json"
            aaa_path.write_text(json.dumps(yf_payload("AAA", 10.0)), encoding="utf-8")
            (yf_dir / "BBB.json").write_text(json.dumps(yf_payload("BBB", 20.0)), encoding="utf-8")

            try:
                self.mod.now_iso = lambda: "2026-06-19T01:00:00Z"
                self.mod.main([])
                public_aaa_before = self.mod.load_json(self.mod.PUBLIC_OUT / "tickers" / "AAA.json")

                aaa_path.write_text(json.dumps(yf_payload("AAA", 11.0)), encoding="utf-8")
                self.mod.now_iso = lambda: "2026-06-19T02:00:00Z"
                self.mod.main(["--tickers", "AAA", "--no-public-mirror"])

                index = self.mod.load_json(self.mod.OUT / "index.json")
                canonical_aaa = self.mod.load_json(self.mod.OUT / "tickers" / "AAA.json")
                canonical_bbb = self.mod.load_json(self.mod.OUT / "tickers" / "BBB.json")
                public_aaa_after = self.mod.load_json(self.mod.PUBLIC_OUT / "tickers" / "AAA.json")
            finally:
                self.mod.DATA = original_data
                self.mod.OUT = original_out
                self.mod.PUBLIC_OUT = original_public_out
                self.mod.now_iso = original_now_iso

        self.assertEqual(index["count"], 2)
        self.assertEqual([row["ticker"] for row in index["rows"]], ["AAA", "BBB"])
        self.assertEqual(canonical_aaa["facts"]["price"]["value"], 11.0)
        self.assertEqual(canonical_bbb["facts"]["price"]["value"], 20.0)
        self.assertEqual(public_aaa_before, public_aaa_after)

    def test_market_facts_contract_accepts_valid_generated_payload(self) -> None:
        payload = self.mod.build_one(
            "VALID",
            {
                "fetched_at": "2026-06-19T00:00:00Z",
                "data": {
                    "info": {
                        "quoteType": "EQUITY",
                        "shortName": "Valid Inc.",
                        "currentPrice": 100.0,
                    }
                },
            },
            None,
            None,
        )

        self.mod.assert_market_facts_payload(payload, ticker="VALID")

    def test_enrolled_etf_uses_committed_projection_without_mutable_bypass(self) -> None:
        original_data = self.mod.DATA
        original_out = self.mod.OUT
        original_public_out = self.mod.PUBLIC_OUT
        original_now_iso = self.mod.now_iso
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_root = root / "data"
            canonical = data_root / "computed" / "data-supply" / "etf-detail"
            (canonical / "payloads").mkdir(parents=True)
            (data_root / "yf" / "finance").mkdir(parents=True)
            (data_root / "stockanalysis" / "etfs").mkdir(parents=True)

            selected = {
                "schema_version": "yf-etf-detail/v1",
                "ticker": "R2X",
                "asset_type": "etf",
                "source": "yahoo_finance",
                "detail_status": "yf_fallback",
                "normalized": {"quote": {"p": 123.0}, "overview": {}, "holdings": []},
            }
            selected_bytes = json.dumps(selected, separators=(",", ":")).encode()
            (canonical / "payloads" / "R2X.json").write_bytes(selected_bytes)
            digest = hashlib.sha256(selected_bytes).hexdigest()
            (canonical / "enrollment.json").write_text(json.dumps({
                "schema_version": "data-supply-etf-detail-enrollment/v1",
                "tickers": ["R2X"],
            }), encoding="utf-8")
            (canonical / "index.json").write_text(json.dumps({
                "schema_version": "data-supply-etf-detail-public-index/v1",
                "entries": {
                    "R2X": {
                        "ticker": "R2X",
                        "enrollment_state": "enrolled",
                        "resolution_state": "fresh_fallback",
                        "payload_path": "payloads/R2X.json",
                        "payload_sha256": digest,
                    }
                },
            }), encoding="utf-8")
            (data_root / "yf" / "finance" / "R2X.json").write_text(json.dumps({
                "data": {"info": {"quoteType": "ETF", "currentPrice": 999.0}},
            }), encoding="utf-8")
            (data_root / "stockanalysis" / "etfs" / "R2X.json").write_text(json.dumps({
                "schema_version": "stockanalysis/v1",
                "ticker": "R2X",
                "asset_type": "etf",
                "source": "stockanalysis",
                "normalized": {"quote": {"p": 777.0}},
            }), encoding="utf-8")

            self.mod.DATA = data_root
            self.mod.OUT = data_root / "computed" / "market_facts"
            self.mod.PUBLIC_OUT = root / "public" / "data" / "computed" / "market_facts"
            self.mod.now_iso = lambda: "2026-07-11T00:00:00Z"
            try:
                self.mod.main(["--no-public-mirror"])
                result = self.mod.load_json(self.mod.OUT / "tickers" / "R2X.json")
            finally:
                self.mod.DATA = original_data
                self.mod.OUT = original_out
                self.mod.PUBLIC_OUT = original_public_out
                self.mod.now_iso = original_now_iso

        self.assertEqual(result["facts"]["price"]["value"], 123.0)
        self.assertEqual(result["resolver"]["detail_authority"], "data_supply:fresh_fallback")
        self.assertEqual(
            result["source_files"]["stockanalysis_yf_fallback"],
            "computed/data-supply/etf-detail/payloads/R2X.json",
        )
        self.assertFalse(result["sources"]["yf"])

    def test_market_facts_contract_rejects_malformed_fact(self) -> None:
        payload = self.mod.build_one(
            "BROKEN",
            {
                "fetched_at": "2026-06-19T00:00:00Z",
                "data": {
                    "info": {
                        "quoteType": "EQUITY",
                        "shortName": "Broken Inc.",
                        "currentPrice": 100.0,
                    }
                },
            },
            None,
            None,
        )
        del payload["facts"]["price"]["source"]

        with self.assertRaises(self.mod.MarketFactsContractError):
            self.mod.assert_market_facts_payload(payload, ticker="BROKEN")


if __name__ == "__main__":
    unittest.main()
