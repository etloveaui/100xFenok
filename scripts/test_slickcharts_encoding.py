#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

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
aggregator = load_module("stock_aggregator", SCRAPERS_DIR / "stock-aggregator.py")
returns_scraper = load_module("symbol_returns_scraper", SCRAPERS_DIR / "symbol-returns-scraper.py")
dividend_scraper = load_module("symbol_dividend_scraper", SCRAPERS_DIR / "symbol-dividend-scraper.py")
rebuild = load_module("rebuild_stock_history", SCRAPERS_DIR / "rebuild-stock-history-aggregates.py")


class _FrozenUtc(datetime):
    """datetime subclass frozen for deterministic history merging and stamps."""

    _NOW = datetime(2026, 1, 10, 8, 0, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        value = cls._NOW
        return value if tz is None else value.astimezone(tz)


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


class SlickchartsHistoryTimestampTest(unittest.TestCase):
    OLD = datetime(2026, 1, 10, 8, tzinfo=timezone.utc)
    NEW = datetime(2026, 1, 10, 9, tzinfo=timezone.utc)
    AGGREGATES = ("stocks-returns.json", "stocks-dividends.json",
                  "stocks-dividends-recent.json", "stocks-dividends-historical.json")

    def write_json(self, path: Path, payload) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def run_main(self, module, argv, now) -> None:
        with mock.patch.object(_FrozenUtc, "_NOW", now), mock.patch.object(
            scraper_utils, "datetime", _FrozenUtc
        ), mock.patch.object(sys, "argv", argv):
            module.main()

    def test_semantic_equality_matrix(self) -> None:
        fresh = {"updated": self.NEW.isoformat(), "source": "slickcharts", "stocks": [1, 2]}
        cases = [
            ({"updated": self.OLD.isoformat(), "source": "slickcharts", "stocks": [1, 2]}, self.OLD.isoformat()),
            ({"updated": self.OLD.isoformat(), "source": "other", "stocks": [1, 2]}, self.NEW.isoformat()),
            ({"updated": self.OLD.isoformat(), "source": "slickcharts", "stocks": [2, 1]}, self.NEW.isoformat()),
        ]
        for existing, expected in cases:
            with self.subTest(existing=existing):
                payload = dict(fresh)
                scraper_utils.preserve_updated(payload, existing)
                self.assertEqual(payload["updated"], expected)

    def test_missing_corrupt_or_invalid_existing_matrix(self) -> None:
        with tempfile.TemporaryDirectory(prefix="slickcharts-timestamp-") as tmp:
            root = Path(tmp)
            batch = root / "batch.json"
            output = root / "stocks-returns.json"
            stocks = [{"symbol": "AAPL", "returns": [{"year": 2025, "return": 30.8}]}]
            self.write_json(batch, {"stocks": stocks})
            states = [None, "{bad json", "[]",
                      json.dumps({"updated": "garbage", "source": "slickcharts", "stocks": stocks})]
            for state in states:
                with self.subTest(state=state):
                    if state is None:
                        output.unlink(missing_ok=True)
                    else:
                        output.write_text(state, encoding="utf-8")
                    self.run_main(returns_scraper, ["returns", "--merge", str(batch), "--output", str(output)], self.NEW)
                    self.assertEqual(json.loads(output.read_text())["updated"], self.NEW.isoformat())

    def test_history_call_sites_are_byte_stable_and_source_as_of_valid(self) -> None:
        with tempfile.TemporaryDirectory(prefix="slickcharts-timestamp-") as tmp:
            root = Path(tmp)
            returns_batch, dividends_batch = root / "returns-batch.json", root / "dividends-batch.json"
            returns_out, dividends_out = root / "stocks-returns.json", root / "stocks-dividends.json"
            returns = [{"symbol": "AAPL", "returns": [{"year": 2025, "return": 30.8}]}]
            dividends = [{"symbol": "AAPL", "dividends": [{"exDate": "2026-01-05", "amount": 0.25}]}]
            self.write_json(returns_batch, {"stocks": returns})
            self.write_json(dividends_batch, {"stocks": dividends})
            merge_args = [
                (returns_scraper, returns_batch, returns_out),
                (dividend_scraper, dividends_batch, dividends_out),
            ]
            metrics = root / "symbols.json"
            stocks_dir = root / "stocks"
            self.write_json(metrics, {"symbol": "AAPL", "company": "Apple", "price": 258.63})

            def generate(now):
                for module, batch, output in merge_args:
                    self.run_main(module, ["merge", "--merge", str(batch), "--output", str(output)], now)
                with mock.patch.object(_FrozenUtc, "_NOW", now), mock.patch.object(
                    aggregator, "datetime", _FrozenUtc
                ), mock.patch.object(aggregator, "get_utc_timestamp", return_value=now.isoformat()), mock.patch.object(
                    sys, "argv", ["aggregate", "--metrics", str(metrics), "--returns", str(returns_out),
                                  "--dividends", str(dividends_out), "--output-dir", str(stocks_dir),
                                  "--split-dividends", str(root), "--quiet"]
                ):
                    aggregator.main()

            generate(self.OLD)
            files = [returns_out, dividends_out, root / "stocks-dividends-recent.json",
                     root / "stocks-dividends-historical.json", stocks_dir / "AAPL.json"]
            before = {path: path.read_bytes() for path in files}
            generate(self.NEW)
            self.assertEqual({path: path.read_bytes() for path in files}, before)

            rebuild_root = root / "rebuild"
            self.write_json(rebuild_root / "universe.json", {"stocks": [{"symbol": "AAPL"}]})
            (rebuild_root / "stocks").mkdir(parents=True)
            (rebuild_root / "stocks" / "AAPL.json").write_bytes(before[stocks_dir / "AAPL.json"])
            args = ["rebuild", "--data-dir", str(rebuild_root)]
            for now in (self.OLD, self.NEW):
                with mock.patch.object(_FrozenUtc, "_NOW", now), mock.patch.object(
                    rebuild, "datetime", _FrozenUtc
                ), mock.patch.object(rebuild, "utc_timestamp", return_value=now.isoformat()), mock.patch.object(sys, "argv", args):
                    rebuild.main()
                if now == self.OLD:
                    rebuilt = {path: (rebuild_root / path).read_bytes() for path in self.AGGREGATES}
            self.assertEqual({path: (rebuild_root / path).read_bytes() for path in self.AGGREGATES}, rebuilt)

            updated = json.loads(returns_out.read_text())["updated"]
            check = f'import {{toIsoDay}} from "./scripts/publish-cloud-data-generation.mjs"; if (!toIsoDay({json.dumps(updated)})) process.exit(1);'
            subprocess.run(["node", "--input-type=module", "-e", check], cwd=SCRIPTS_DIR.parent, check=True)


if __name__ == "__main__":
    unittest.main()
