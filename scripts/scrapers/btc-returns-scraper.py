#!/usr/bin/env python3
"""
SlickCharts Bitcoin Historical Returns scraper.

Usage:
    python scripts/scrapers/btc-returns-scraper.py --output source/100xFenok/data/slickcharts/btc-returns.json --pretty
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

# Add parent directory to path for scraper_utils imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper_utils import fetch_html, clean_number, to_float

SOURCE_URL = "https://www.slickcharts.com/currency/BTC/returns"
DEFAULT_OUTPUT = Path("source/100xFenok/data/slickcharts/btc-returns.json")


def parse_returns(html: str) -> List[Dict[str, float | int]]:
    """Parse returns table rows from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    
    # Locate the table.
    # Structure: <table class="table table-hover table-borderless table-sm">
    table = soup.find("table", class_="table table-hover table-borderless table-sm")
    
    if table is None:
        raise ValueError("Unable to locate returns table on the page")

    returns: List[Dict[str, float | int]] = []
    
    # Skip thead, process tbody tr
    tbody = table.find("tbody")
    rows = tbody.find_all("tr") if tbody else table.find_all("tr")
    
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        try:
            # Column 0: Year
            year = int(clean_number(cells[0].get_text(strip=True)))

            # Column 1: Return
            # Note: Negative values might be styled red but text should contain minus sign usually.
            # Just parsing the text should be sufficient if "-" is present.
            return_val = to_float(cells[1].get_text(strip=True))
            
        except ValueError:
            continue

        returns.append(
            {
                "year": year,
                "return": return_val
            }
        )
    return returns


def build_payload(returns: List[Dict[str, float | int]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "symbol": "BTC",
        "count": len(returns),
        "returns": returns,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Bitcoin Historical Returns from SlickCharts.")
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
    
    try:
        returns = parse_returns(html)
        if not returns:
            raise RuntimeError("No returns parsed from SlickCharts response")
            
        payload = build_payload(returns)

        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} return records to {args.output}")
        if returns:
            print("First 3 records:", returns[:3])
            
    except Exception as e:
        print(f"Error parsing returns data: {e}")
        raise

if __name__ == "__main__":
    main()
