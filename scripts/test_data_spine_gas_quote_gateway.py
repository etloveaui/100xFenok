#!/usr/bin/env python3
"""Guard the GAS quote helpers against drifting away from quote.v1."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


MARKET_DATA = ROOT / "admin/market-data/yahoo-quotes.gs"
MARKET_RADAR = ROOT / "admin/market-radar/scripts/yahoo-quotes.gs"
IB_HELPER = ROOT / "ib/ib-helper/apps-script/yahoo-quotes.gs"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def function_slice(text: str, start: str, end: str) -> str:
    start_idx = text.index(start)
    end_idx = text.index(end, start_idx)
    return text[start_idx:end_idx]


class GasQuoteGatewayTest(unittest.TestCase):
    def test_all_helpers_validate_quote_v1_contract(self) -> None:
        for path in (MARKET_DATA, MARKET_RADAR, IB_HELPER):
            with self.subTest(path=path.relative_to(ROOT)):
                text = read(path)
                self.assertIn("QUOTE_GATEWAY_URL", text)
                self.assertIn("https://100xfenok.etloveaui.workers.dev/api/ticker/", text)
                self.assertIn("function fetchFrom100xQuote(symbol)", text)
                self.assertIn("schemaVersion !== 'quote.v1'", text)
                self.assertIn("json.postMarket", text)
                self.assertIn("json.fetchedAt", text)

    def test_market_data_uses_gateway_before_direct_yahoo_and_keeps_ohlc(self) -> None:
        text = read(MARKET_DATA)
        body = function_slice(text, "function yahooGetQuote(symbol)", "function fetchFrom100xQuote(symbol)")
        self.assertLess(body.index("fetchFrom100xQuote(symbol)"), body.index("fetchFromYahooQuote(symbol)"))
        self.assertIn("function fetchFromYahooQuote(symbol)", text)
        self.assertIn("100X_QUOTE+YAHOO_OHLC", text)
        self.assertIn("obj.high = yahooOhlc.high", text)
        self.assertIn("obj.low = yahooOhlc.low", text)
        self.assertIn("obj.volume = yahooOhlc.volume", text)

    def test_market_radar_uses_gateway_before_direct_yahoo_and_keeps_ohlc(self) -> None:
        text = read(MARKET_RADAR)
        body = function_slice(text, "function getQuote(symbol)", "function getQuotes(symbols)")
        self.assertLess(body.index("fetchFrom100xQuote(symbol)"), body.index("fetchFromYahoo(symbol)"))
        self.assertIn("100X_QUOTE+YAHOO_OHLC", text)
        self.assertIn("quote.high = yahooOhlc.high", text)
        self.assertIn("quote.low = yahooOhlc.low", text)
        self.assertIn("quote.volume = yahooOhlc.volume", text)

    def test_ib_helper_keeps_cnbc_primary_then_uses_gateway_before_yahoo(self) -> None:
        text = read(IB_HELPER)
        body = function_slice(text, "function getQuote(symbol)", "function getQuotes(symbols)")
        self.assertLess(body.index("fetchFromCNBC(symbol)"), body.index("fetchFrom100xQuote(symbol)"))
        self.assertLess(body.index("fetchFrom100xQuote(symbol)"), body.index("fetchFromYahoo(symbol)"))
        self.assertIn("CNBC stays primary for IB Helper", text)
        self.assertIn("100X_QUOTE+YAHOO_OHLC", text)


if __name__ == "__main__":
    unittest.main()
