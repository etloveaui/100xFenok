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


if __name__ == "__main__":
    unittest.main()
