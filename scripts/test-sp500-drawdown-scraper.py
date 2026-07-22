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

from scrapers.scraper_utils import ProviderThrottledError


SCRIPT_PATH = Path(__file__).resolve().parent / "scrapers" / "sp500-drawdown-scraper.py"
sys.path.insert(0, str(SCRIPT_PATH.parent))
SPEC = importlib.util.spec_from_file_location("sp500_drawdown_scraper", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
DRAW_DOWN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRAW_DOWN)


class DrawdownScraperChallengeBoundaryTest(unittest.TestCase):
    def test_provider_challenge_stops_before_js_state_parser(self):
        args = SimpleNamespace(output=None, pretty=False)
        challenge = ProviderThrottledError(DRAW_DOWN.SOURCE_URL, 403, 3)
        stderr = io.StringIO()
        with patch.object(DRAW_DOWN, "parse_args", return_value=args), \
             patch.object(DRAW_DOWN.requests, "Session", return_value=object()), \
             patch.object(DRAW_DOWN, "fetch_html", side_effect=challenge), \
             patch.object(DRAW_DOWN, "extract_js_state") as parser:
            with redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
                DRAW_DOWN.main()

        self.assertEqual(raised.exception.code, 1)
        parser.assert_not_called()
        self.assertIn("provider_throttled", stderr.getvalue())
        self.assertNotIn("Just a moment", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
