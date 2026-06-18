#!/usr/bin/env python3
"""Fixture smoke checks for StockAnalysis fetcher parser contracts."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error


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

    def test_etf_404_uses_yahoo_fallback_when_enabled(self) -> None:
        original_fetch_etf = self.fetcher.fetch_etf
        original_fallback = self.fetcher.fetch_yahoo_etf_fallback
        original_write_payload = self.fetcher.write_payload
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
            result = self.fetcher.run_one("etf", "ADIU", timeout=1, mirror_public=False, yf_fallback=True)
        finally:
            self.fetcher.fetch_etf = original_fetch_etf
            self.fetcher.fetch_yahoo_etf_fallback = original_fallback
            self.fetcher.write_payload = original_write_payload

        self.assertEqual(result["status"], "fallback_ok")
        self.assertEqual(result["provider"], "yahoo_finance")
        self.assertIn("HTTP Error 404", result["stockanalysis_error"])
        self.assertEqual(writes[0][0], "etfs/ADIU.json")
        self.assertEqual(writes[0][1]["source_provider"], "yahoo_finance")

    def test_yahoo_etf_payload_normalizes_source_tags_quote_and_fund_profile(self) -> None:
        payload = self.fetcher.yahoo_etf_payload(
            "BSJY",
            {
                "ticker": "BSJY",
                "fetched_at": "2026-06-18T07:30:51Z",
                "data": {
                    "info": {
                        "quoteType": "ETF",
                        "longName": "Invesco BulletShares 2034 High Yield Corporate Bond ETF",
                        "currentPrice": 25.07,
                        "previousClose": 25.205,
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
        self.assertEqual(payload["source_provider"], "yahoo_finance")
        self.assertEqual(payload["detail_status"], "yf_fallback")
        self.assertEqual(payload["normalized"]["quote"]["ex"], "yahoo_finance")
        self.assertAlmostEqual(payload["normalized"]["quote"]["c"], -0.135)
        self.assertEqual(payload["normalized"]["overview"]["provider_page"], "Invesco")
        self.assertEqual(payload["normalized"]["holdings"][0]["weight_pct"], 12.5)
        self.assertEqual(payload["normalized"]["asset_allocation"]["bondPosition"], 0.875)
        self.assertEqual(payload["normalized"]["history"][0]["close"], 25.07)

    def test_yahoo_etf_payload_rejects_non_fund_quote_type(self) -> None:
        with self.assertRaises(ValueError):
            self.fetcher.yahoo_etf_payload(
                "ADIU",
                {
                    "ticker": "ADIU",
                    "fetched_at": "2026-06-18T07:30:51Z",
                    "data": {
                        "info": {"quoteType": "EQUITY", "currentPrice": 14.5},
                    },
                },
            )

    def test_invalid_yahoo_fallback_does_not_write_raw_yf_payload(self) -> None:
        original_loader = self.fetcher.load_yf_finance_module
        original_write_json = self.fetcher.write_json
        writes = []

        class FakeYahooModule:
            @staticmethod
            def fetch_with_retry(_ticker: str, profile: str = "etf", retries: int = 1, backoffs: tuple = (3,)):
                return {"info": {"quoteType": "EQUITY", "currentPrice": 14.5}}, 10, None

        def fake_write_json(path: Path, payload: dict) -> None:
            writes.append((path, payload))

        self.fetcher.load_yf_finance_module = lambda: FakeYahooModule
        self.fetcher.write_json = fake_write_json
        try:
            with self.assertRaises(ValueError):
                self.fetcher.fetch_yahoo_etf_fallback("ADIU", mirror_public=True)
        finally:
            self.fetcher.load_yf_finance_module = original_loader
            self.fetcher.write_json = original_write_json

        self.assertEqual(writes, [])

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


if __name__ == "__main__":
    unittest.main()
