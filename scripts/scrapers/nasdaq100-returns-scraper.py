#!/usr/bin/env python3
"""
SlickCharts Nasdaq 100 historical returns scraper.

Usage:
    python scripts/scrapers/nasdaq100-returns-scraper.py --output data/nasdaq100_returns.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html, clean_number, to_float

SOURCE_URL = "https://www.slickcharts.com/nasdaq100/returns"
DEFAULT_OUTPUT = Path(__file__).with_name("nasdaq100_returns.json")


def parse_returns(html: str) -> List[Dict[str, float | int]]:
    """Extract yearly total returns from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    header = soup.find("h1", string=lambda t: t and "Total Returns by Year" in t)
    table = header.find_next("table") if header else None
    if table is None:
        table = soup.select_one("table.table.table-hover")
    if table is None:
        raise ValueError("Unable to locate returns table")

    results: List[Dict[str, float | int]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        year_text = cells[0].get_text(strip=True)
        return_text = cells[1].get_text(strip=True)
        try:
            year = int(year_text)
            total_return = to_float(return_text)
        except ValueError:
            continue
        results.append({"year": year, "return": total_return})
    return results


def build_payload(returns: List[Dict[str, float | int]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(returns),
        "returns": returns,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Nasdaq 100 historical returns from SlickCharts.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON with indentation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with requests.Session() as session:
        html = fetch_html(session, SOURCE_URL)
    returns = parse_returns(html)
    if not returns:
        raise RuntimeError("No returns parsed from SlickCharts response")
    payload = build_payload(returns)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} rows to {args.output}")
    print("Latest entries:", ", ".join(f"{item['year']}" for item in returns[:5]))


if __name__ == "__main__":
    main()
