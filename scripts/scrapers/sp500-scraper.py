#!/usr/bin/env python3
"""
SlickCharts S&P 500 holdings scraper.

Usage:
    python scripts/scrapers/sp500-scraper.py --output data/sp500_holdings.json
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

# Import shared utilities
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html, clean_number, to_float

SOURCE_URL = "https://www.slickcharts.com/sp500"
DEFAULT_OUTPUT = Path(__file__).with_name("sp500_holdings.json")


def parse_holdings(html: str) -> List[Dict[str, float | int | str]]:
    """Parse holdings table rows from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    header = soup.find("h1", string=lambda t: t and "S&P 500 Index Components" in t)
    table = None
    if header:
        container = header.find_next("div", class_="table-responsive")
        table = container.find("table") if container else None
    if table is None:
        table = soup.select_one("div.table-responsive table.table")
    if table is None:
        raise ValueError("Unable to locate holdings table on the page")

    holdings: List[Dict[str, float | int | str]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 7:
            continue
        try:
            rank = int(clean_number(cells[0].get_text(strip=True)))
            company = cells[1].get_text(" ", strip=True)
            symbol = cells[2].get_text(strip=True)
            weight = to_float(cells[3].get_text(strip=True))
            price = to_float(cells[4].get_text(" ", strip=True))
            change = to_float(cells[5].get_text(strip=True))
            change_percent = to_float(cells[6].get_text(strip=True))
        except ValueError:
            continue

        # SlickCharts expresses weight as percents, so keep float with 2 decimals.
        holdings.append(
            {
                "rank": rank,
                "company": company,
                "symbol": symbol,
                "weight": weight,
                "price": price,
                "change": change,
                "changePercent": change_percent,
            }
        )
    return holdings


def build_payload(holdings: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(holdings),
        "holdings": holdings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape S&P 500 holdings from SlickCharts.")
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
    holdings = parse_holdings(html)
    if not holdings:
        raise RuntimeError("No holdings parsed from SlickCharts response")
    payload = build_payload(holdings)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} holdings to {args.output}")
    print("First 5 symbols:", ", ".join(item["symbol"] for item in holdings[:5]))


if __name__ == "__main__":
    main()
