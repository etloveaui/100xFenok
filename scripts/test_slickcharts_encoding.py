#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import requests


SCRIPTS_DIR = Path(__file__).resolve().parent
SCRAPERS_DIR = SCRIPTS_DIR / "scrapers"
FIXTURE = SCRIPTS_DIR / "fixtures" / "slickcharts" / "currency-nonascii.html"
sys.path.insert(0, str(SCRAPERS_DIR))

import scraper_utils  # noqa: E402


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


currency_scraper = load_module("currency_scraper", SCRAPERS_DIR / "currency-scraper.py")
integrity = load_module("slickcharts_integrity", SCRIPTS_DIR / "validate-slickcharts-integrity.py")


class StaticSession:
    def __init__(self, response: requests.Response):
        self.response = response

    def get(self, *_args, **_kwargs) -> requests.Response:
        return self.response


def misdeclared_fixture_response() -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response.url = "https://www.slickcharts.com/currency"
    response.headers["Content-Type"] = "text/html"
    response.encoding = "ISO-8859-1"
    response._content = FIXTURE.read_bytes()
    return response


class SlickchartsEncodingTest(unittest.TestCase):
    def fetch_fixture(self) -> str:
        return scraper_utils.fetch_html(
            StaticSession(misdeclared_fixture_response()),
            "https://www.slickcharts.com/currency",
            max_retries=1,
            rate_limit=0,
        )

    def test_fetch_decodes_utf8_bytes_before_requests_latin1_default(self) -> None:
        response = misdeclared_fixture_response()
        self.assertIn("å¸", response.text, "fixture must reproduce Requests latin-1 mojibake")
        html = self.fetch_fixture()
        self.assertEqual(html, FIXTURE.read_text(encoding="utf-8"))
        self.assertIn("币安人生", html)
        self.assertNotIn("å¸", html)

    def test_fetch_keeps_genuine_non_utf8_fallback(self) -> None:
        response = requests.Response()
        response.status_code = 200
        response.encoding = "ISO-8859-1"
        response._content = "<table><tr><td>café</td></tr></table>".encode("latin-1")
        html = scraper_utils.fetch_html(
            StaticSession(response),
            "https://www.slickcharts.com/fallback",
            max_retries=1,
            rate_limit=0,
        )
        self.assertIn("café", html)

    def test_non_ascii_name_survives_intermediate_write_and_merge_read(self) -> None:
        parsed = currency_scraper.parse_currency(self.fetch_fixture())
        self.assertEqual(parsed["currencies"][0]["name"], "币安人生")

        with tempfile.TemporaryDirectory(prefix="slickcharts-encoding-") as raw_root:
            root = Path(raw_root)
            intermediate = root / "currency-intermediate.json"
            scraper_utils.write_output(
                {"source": "slickcharts", "currencies": parsed["currencies"]},
                intermediate,
                pretty=True,
            )
            intermediate_payload = json.loads(intermediate.read_text(encoding="utf-8"))
            retained = [{
                "date": "2026-07-21",
                "currencies": intermediate_payload["currencies"],
                "totalMarketCap": parsed["totalMarketCap"],
            }]
            merged = scraper_utils.build_cumulative_payload(
                parsed["currencies"],
                retained,
                data_key="currencies",
                retention_days=365,
            )
            merged["history"][0]["totalMarketCap"] = parsed["totalMarketCap"]
            output = root / "currency.json"
            scraper_utils.write_cumulative_output(merged, output, pretty=True)

            reloaded = json.loads(output.read_text(encoding="utf-8"))
            self.assertTrue(all(
                row["currencies"][0]["name"] == "币安人生"
                for row in reloaded["history"]
            ))
            self.assertIn("币安人生".encode("utf-8"), output.read_bytes())
            integrity.assert_currency(root, [])

    def test_integrity_guard_rejects_genuine_utf8_as_latin1_mutation(self) -> None:
        genuine_mojibake = "€ Coin".encode("utf-8").decode("latin-1")
        self.assertEqual(genuine_mojibake, "â\x82¬ Coin")
        with tempfile.TemporaryDirectory(prefix="slickcharts-mojibake-") as raw_root:
            root = Path(raw_root)
            payload = {
                "source": "slickcharts",
                "history": [
                    {
                        "date": "2026-07-22",
                        "totalMarketCap": 2,
                        "currencies": [{"name": "币安人生", "symbol": "LIFE"}],
                    },
                    {
                        "date": "2026-07-21",
                        "totalMarketCap": 1,
                        "currencies": [{"name": genuine_mojibake, "symbol": "EUR"}],
                    },
                ],
            }
            (root / "currency.json").write_text(
                json.dumps(payload, ensure_ascii=False),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "mojibake names"):
                integrity.assert_currency(root, [])


if __name__ == "__main__":
    unittest.main()
