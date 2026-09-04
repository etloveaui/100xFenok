#!/usr/bin/env python3
"""Focused regression test for the SlickCharts yield-page content assertion.

The three yield pages moved to a SvelteKit-hydrated layout with no static
<table> (fh-397). The yield scrapers parse the value heading, so their
attempt event asserts on that heading instead of table rows.
"""

import sys
from pathlib import Path

SCRAPER_DIR = Path(__file__).resolve().parent / "scrapers"
sys.path.insert(0, str(SCRAPER_DIR))

from scraper_utils import _html_attempt_tuple  # noqa: E402


def load_scraper(name: str):
    import importlib.util

    path = SCRAPER_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


sp500_yield_scraper = load_scraper("sp500-yield-scraper")
nasdaq100_yield_scraper = load_scraper("nasdaq100-yield-scraper")
dowjones_yield_scraper = load_scraper("dowjones-yield-scraper")

NEW_SHAPE_HTML = (
    "<html><body>"
    '<h1 class="text-center">S&amp;P 500 Dividend Yield</h1> '
    '<h2 class="text-center" style="color: green;">1.03%</h2> '
    "<p>As of 2026-09-03</p>"
    "</body></html>"
)

OLD_TABLE_HTML = "<html><body><table><tr><td>1.03%</td></tr></table></body></html>"


def main() -> None:
    assertions = (
        sp500_yield_scraper.CONTENT_ASSERTION,
        nasdaq100_yield_scraper.CONTENT_ASSERTION,
        dowjones_yield_scraper.CONTENT_ASSERTION,
    )
    assert len(set(assertions)) == 1, f"yield scrapers diverged: {assertions}"
    assertion = assertions[0]
    assert assertion[0] == "yield_value"

    row = _html_attempt_tuple(200, NEW_SHAPE_HTML, content_assertion=assertion)
    assert row["assertions"] == [{"id": "yield_value", "passed": True}], row["assertions"]

    default_row = _html_attempt_tuple(200, NEW_SHAPE_HTML)
    assert default_row["assertions"] == [{"id": "table_rows", "passed": False}]

    table_row = _html_attempt_tuple(200, OLD_TABLE_HTML)
    assert table_row["assertions"] == [{"id": "table_rows", "passed": True}]

    missing = _html_attempt_tuple(
        200, "<html><body><h1>No data here</h1></body></html>", content_assertion=assertion
    )
    assert missing["assertions"] == [{"id": "yield_value", "passed": False}]

    empty = _html_attempt_tuple(200, "   ", content_assertion=assertion)
    assert empty["payload"] == "empty"

    parsed = sp500_yield_scraper.parse_yield(NEW_SHAPE_HTML)
    assert parsed == {"yield": 1.03}, parsed

    print("test_slickcharts_yield_content_assertion: ok")


if __name__ == "__main__":
    main()
