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

SIGNED_HTML = (
    "<html><body>"
    '<h1 class="text-center">S&amp;P 500 Dividend Yield</h1> '
    '<h2 class="text-center" style="color: red;">-1%</h2> '
    "</body></html>"
)

ABSURD_HTML = (
    "<html><body>"
    '<h1 class="text-center">S&amp;P 500 Dividend Yield</h1> '
    '<h2 class="text-center">9999%</h2> '
    "</body></html>"
)

MISMATCHED_HTML = (
    "<html><body>"
    '<h1 class="text-center">S&amp;P 500 Dividend Yield</h1> '
    '<h2 class="text-center">As of September 2026</h2> '
    "</body></html>"
)

OLD_TABLE_HTML = "<html><body><table><tr><td>1.03%</td></tr></table></body></html>"


def main() -> None:
    assertions = (
        sp500_yield_scraper.CONTENT_ASSERTION,
        nasdaq100_yield_scraper.CONTENT_ASSERTION,
        dowjones_yield_scraper.CONTENT_ASSERTION,
    )
    # The validator is a per-module function object, so compare the stable
    # (id, selector) pair plus rule agreement on probe inputs instead of
    # object identity.
    assert {a[:2] for a in assertions} == {("yield_value", "h1 + h2")}, assertions
    assert all(callable(a[2]) for a in assertions), assertions
    for probe, expected in (("1.03%", True), ("-1%", False), ("9999%", False)):
        assert {bool(a[2](probe)) for a in assertions} == {expected}, (probe, assertions)
    assertion = assertions[0]
    assert assertion[0] == "yield_value"

    row = _html_attempt_tuple(200, NEW_SHAPE_HTML, content_assertion=assertion)
    assert row["assertions"] == [{"id": "yield_value", "passed": True}], row["assertions"]

    default_row = _html_attempt_tuple(200, NEW_SHAPE_HTML)
    assert default_row["assertions"] == [{"id": "table_rows", "passed": False}]

    table_row = _html_attempt_tuple(200, OLD_TABLE_HTML)
    assert table_row["assertions"] == [{"id": "table_rows", "passed": True}]

    for bad_html in (
        SIGNED_HTML,
        ABSURD_HTML,
        MISMATCHED_HTML,
        "<html><body><h1>No data here</h1></body></html>",
    ):
        missing = _html_attempt_tuple(200, bad_html, content_assertion=assertion)
        assert missing["assertions"] == [{"id": "yield_value", "passed": False}], bad_html

    empty = _html_attempt_tuple(200, "   ", content_assertion=assertion)
    assert empty["payload"] == "empty"

    for scraper in (
        sp500_yield_scraper,
        nasdaq100_yield_scraper,
        dowjones_yield_scraper,
    ):
        parsed = scraper.parse_yield(NEW_SHAPE_HTML)
        assert parsed == {"yield": 1.03}, parsed
        for bad_html in (SIGNED_HTML, ABSURD_HTML, MISMATCHED_HTML):
            try:
                scraper.parse_yield(bad_html)
            except ValueError:
                pass
            else:
                raise AssertionError(f"{scraper.__name__} accepted {bad_html[:60]}")

    print("test_slickcharts_yield_content_assertion: ok")


if __name__ == "__main__":
    main()
