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


if __name__ == "__main__":
    unittest.main()
