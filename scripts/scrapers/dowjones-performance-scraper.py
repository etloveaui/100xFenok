#!/usr/bin/env python3
"""
SlickCharts Dow Jones YTD performance scraper.

Usage:
    python scripts/scrapers/dowjones-performance-scraper.py --output data/dowjones_performance.json
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

# Add parent directory to path for scraper_utils import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html, clean_number, to_float

SOURCE_URL = "https://www.slickcharts.com/dowjones/performance"
DEFAULT_OUTPUT = Path(__file__).with_name("dowjones_performance.json")


def parse_performance(html: str) -> List[Dict[str, float | int | str]]:
    """Parse YTD performance table from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.table.table-hover")
    if table is None:
        raise ValueError("Unable to locate performance table")

    results: List[Dict[str, float | int | str]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 4:
            continue
        try:
            rank = int(clean_number(cells[0].get_text(strip=True)))
            company = cells[1].get_text(" ", strip=True)
            symbol = cells[2].get_text(strip=True)
            ytd_return = to_float(cells[3].get_text(strip=True))
        except ValueError:
            continue
        results.append({
            "rank": rank,
            "company": company,
            "symbol": symbol,
            "ytdReturn": ytd_return,
        })
    return results


def build_payload(data: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "index": "dowjones",
        "count": len(data),
        "performance": data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Dow Jones YTD performance from SlickCharts.")
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
    data = parse_performance(html)
    if not data:
        raise RuntimeError("No performance data parsed from SlickCharts response")
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} rows to {args.output}")
    print("Top 5:", ", ".join(f"{item['symbol']}({item['ytdReturn']}%)" for item in data[:5]))


if __name__ == "__main__":
    main()
