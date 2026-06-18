#!/usr/bin/env python3
"""Fixture smoke checks for StockAnalysis fetcher parser contracts."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FETCHER_PATH = ROOT / "scripts" / "fetch-stockanalysis.py"
FIXTURE_DIR = ROOT / "scripts" / "fixtures" / "stockanalysis"


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

    def test_svelte_devalue_surface_fixture(self) -> None:
        payload = json.loads((FIXTURE_DIR / "new_etfs__data.fixture.json").read_text(encoding="utf-8"))
        decoded = self.fetcher.extract_svelte_node(payload, ("data",))

        self.assertEqual(decoded["data"][0]["s"], "AAA")
        self.assertEqual(decoded["data"][1]["n"], "Beta Balance ETF")
        self.assertEqual(decoded["dataPoints"], ["s", "n", "as"])

    def test_etf_universe_html_fixture(self) -> None:
        html = (FIXTURE_DIR / "etf_universe.fixture.html").read_text(encoding="utf-8")
        rows = self.fetcher.parse_etf_universe_page(html, page=3)

        self.assertEqual([row["ticker"] for row in rows], ["SPY", "TQQQ"])
        self.assertEqual(rows[0]["name"], "SPDR S&P 500 ETF Trust")
        self.assertEqual(rows[0]["aum"], 601_200_000_000.0)
        self.assertEqual(rows[1]["source_page"], 3)

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
        def fake_fetch_json(path: str, _timeout: int) -> dict:
            if path.endswith("/overview"):
                return {
                    "status": 200,
                    "data": {
                        "description": (
                            "The fund provides 2x leveraged exposure, less fees and expenses, "
                            "to the daily price movement for shares of NVIDIA Corporation stock."
                        ),
                        "aum": "$1.0B",
                    },
                }
            if path.endswith("/holdings"):
                return {"status": 200, "data": {"holdings": [], "count": 0}}
            return {"status": 200, "data": {}}

        original_fetch_json = self.fetcher.fetch_json
        self.fetcher.fetch_json = fake_fetch_json
        try:
            payload = self.fetcher.fetch_etf("NVDL", timeout=1)
        finally:
            self.fetcher.fetch_json = original_fetch_json

        classification = payload["normalized"]["classification"]
        self.assertTrue(classification["is_leveraged"])
        self.assertEqual(classification["leverage_factor"], 2.0)
        self.assertTrue(classification["is_single_stock"])
        self.assertEqual(classification["underlying"], "NVIDIA Corporation")

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

        for classification in (short_term_bond, ultra_short_income, vix_futures, ultra_short_treasury):
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


if __name__ == "__main__":
    unittest.main()
