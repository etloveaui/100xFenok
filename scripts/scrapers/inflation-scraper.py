#!/usr/bin/env python3
"""
SlickCharts US Inflation Rate scraper.

Usage:
    python scripts/scrapers/inflation-scraper.py --output data/inflation_rates.json --pretty
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

SOURCE_URL = "https://www.slickcharts.com/inflation"
DEFAULT_OUTPUT = Path("data/inflation_rates.json")


def parse_inflation(html: str) -> List[Dict[str, float | int]]:
    """Parse inflation table rows from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    
    # Locate the table.
    # Structure: <table class="table table-hover"> with headers Year, Inflation
    table = soup.find("table", class_="table table-hover")
    
    if table is None:
        raise ValueError("Unable to locate inflation table on the page")

    data: List[Dict[str, float | int]] = []
    
    # Skip thead, process tbody tr
    tbody = table.find("tbody")
    rows = tbody.find_all("tr") if tbody else table.find_all("tr")
    
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        try:
            # Column 0: Year (e.g., 2025<sup>*</sup>)
            # Remove sup tag content if it's just an asterisk, or just get text and clean
            # If 2025<sup>*</sup> -> get_text gives "2025*" -> clean "*"
            year_text = cells[0].get_text(strip=True).replace("*", "")
            year = int(clean_number(year_text))

            # Column 1: Inflation Rate (e.g., 2.74)
            rate = to_float(cells[1].get_text(strip=True))
            
        except ValueError:
            continue

        data.append(
            {
                "year": year,
                "rate": rate
            }
        )
    return data


def build_payload(inflation_data: List[Dict[str, float | int]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(inflation_data),
        "inflation": inflation_data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape US Inflation Rates from SlickCharts.")
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
        inflation_data = parse_inflation(html)
        if not inflation_data:
            raise RuntimeError("No inflation data parsed from SlickCharts response")
            
        payload = build_payload(inflation_data)

        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} records to {args.output}")
        if inflation_data:
            print("First 3 records:", inflation_data[:3])
            
    except Exception as e:
        print(f"Error parsing inflation data: {e}")
        raise

if __name__ == "__main__":
    main()
