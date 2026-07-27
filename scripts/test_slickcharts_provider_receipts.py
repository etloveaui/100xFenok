#!/usr/bin/env python3

import hashlib
import sys
from pathlib import Path

SCRAPER_DIR = Path(__file__).resolve().parent / "scrapers"
sys.path.insert(0, str(SCRAPER_DIR))

from scraper_utils import _html_attempt_tuple  # noqa: E402


def main() -> None:
    html = "<table><tr><td>ok</td></tr></table>"
    row = _html_attempt_tuple(
        200,
        html,
        provider_date="Sat, 01 Aug 2026 08:00:00 GMT",
    )
    assert row["provider_date"] == "Sat, 01 Aug 2026 08:00:00 GMT"
    assert row["response_sha256"] == hashlib.sha256(html.encode("utf-8")).hexdigest()
    assert row["assertions"] == [{"id": "table_rows", "passed": True}]

    empty = _html_attempt_tuple(200, "", provider_date=None)
    assert empty["payload"] == "empty"
    assert empty["provider_date"] is None
    assert len(empty["response_sha256"]) == 64
    print("test_slickcharts_provider_receipts: ok")


if __name__ == "__main__":
    main()
