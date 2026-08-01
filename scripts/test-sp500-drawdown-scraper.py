#!/usr/bin/env python3

"""Regression coverage for the drawdown scraper's fetch-to-parser boundary."""

import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scrapers.scraper_utils import ProviderThrottledError, is_cloudflare_challenge


SCRIPT_PATH = Path(__file__).resolve().parent / "scrapers" / "sp500-drawdown-scraper.py"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "slickcharts"
sys.path.insert(0, str(SCRIPT_PATH.parent))
SPEC = importlib.util.spec_from_file_location("sp500_drawdown_scraper", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
DRAW_DOWN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRAW_DOWN)


class DrawdownScraperChallengeBoundaryTest(unittest.TestCase):
    def _fixture(self, name: str) -> str:
        return (FIXTURES_DIR / name).read_text(encoding="utf-8")

    def test_legacy_state_fixture_parses_drawdown_payload(self):
        state = DRAW_DOWN.extract_drawdown_state(
            self._fixture("drawdown-legacy-state.html")
        )

        parsed = DRAW_DOWN.parse_drawdown_data(state)

        self.assertEqual(parsed["current"]["drawdown"], "-7.5%")
        self.assertEqual(parsed["current"]["price"], "5300")
        self.assertEqual(parsed["historical"], [{"year": 2025, "lowReturn": "-10%"}])

    def test_inline_sveltekit_state_fixture_parses_drawdown_payload(self):
        state = DRAW_DOWN.extract_drawdown_state(
            self._fixture("drawdown-inline-sveltekit-state.html")
        )

        parsed = DRAW_DOWN.parse_drawdown_data(state)

        self.assertEqual(parsed["current"]["drawdown"], "-4.25%")
        self.assertEqual(parsed["current"]["allTimeHigh"], "6100")
        self.assertEqual(
            parsed["historical"],
            [{"year": 2026, "lowReturn": "-3.5%", "priorYearClose": "5900"}],
        )

    def test_cloudflare_challenge_fixture_is_classified_before_parsing(self):
        challenge_html = self._fixture("drawdown-cloudflare-challenge.html")

        self.assertTrue(is_cloudflare_challenge(200, {}, challenge_html))

    def test_non_challenge_missing_state_fixture_has_explicit_failure(self):
        missing_html = self._fixture("drawdown-missing-state.html")

        self.assertFalse(is_cloudflare_challenge(200, {}, missing_html))
        with self.assertRaisesRegex(
            ValueError,
            r"No SlickCharts drawdown state found; tried __sc_init_state__, "
            r"inline SvelteKit page data",
        ):
            DRAW_DOWN.extract_drawdown_state(missing_html)

    def test_provider_challenge_stops_before_js_state_parser(self):
        args = SimpleNamespace(output=None, pretty=False)
        challenge = ProviderThrottledError(DRAW_DOWN.SOURCE_URL, 403, 3)
        stderr = io.StringIO()
        with patch.object(DRAW_DOWN, "parse_args", return_value=args), \
             patch.object(DRAW_DOWN.requests, "Session", return_value=object()), \
             patch.object(DRAW_DOWN, "fetch_html", side_effect=challenge), \
             patch.object(DRAW_DOWN, "extract_drawdown_state") as parser:
            with redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
                DRAW_DOWN.main()

        self.assertEqual(raised.exception.code, 1)
        parser.assert_not_called()
        self.assertIn("provider_throttled", stderr.getvalue())
        self.assertNotIn("Just a moment", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
