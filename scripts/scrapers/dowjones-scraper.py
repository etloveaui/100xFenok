#!/usr/bin/env python3
"""
SlickCharts Dow Jones holdings scraper.

Usage:
    python scripts/scrapers/dowjones-scraper.py --output data/dowjones_holdings.json --pretty
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

SOURCE_URL = "https://www.slickcharts.com/dowjones"
DEFAULT_OUTPUT = Path("data/dowjones_holdings.json")


def parse_holdings(html: str) -> List[Dict[str, float | int | str]]:
    """Parse holdings table rows from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    
    # Try to find table by structure within the "Components of the Dow Jones" section if possible,
    # or fallback to generic table selector which worked for SP500.
    # The dump shows <h5 class="text-center">Components of the Dow Jones</h5>
    
    table = None
    header = soup.find("h5", string=lambda t: t and "Components of the Dow Jones" in t)
    
    if header:
        container = header.find_next("div", class_="table-responsive")
        table = container.find("table") if container else None
        
    if table is None:
        # Fallback 1: Look for table with specific headers
        tables = soup.find_all("table", class_="table")
        for t in tables:
            headers = [th.get_text(strip=True) for th in t.find_all("th")]
            if "Symbol" in headers and "Weight" in headers:
                table = t
                break
    
    if table is None:
        raise ValueError("Unable to locate holdings table on the page")

    holdings: List[Dict[str, float | int | str]] = []
    # Skip thead, process tbody tr
    tbody = table.find("tbody")
    rows = tbody.find_all("tr") if tbody else table.find_all("tr")
    
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 7:
            continue
        try:
            # Column 0: Rank (#)
            rank = int(clean_number(cells[0].get_text(strip=True)))
            
            # Column 1: Company (Link text)
            company = cells[1].get_text(" ", strip=True)
            
            # Column 2: Symbol (Link text)
            symbol = cells[2].get_text(strip=True)
            
            # Column 3: Weight (%)
            weight = to_float(cells[3].get_text(strip=True))

            # Column 4: Price
            price = to_float(cells[4].get_text(" ", strip=True))

            # Column 5: Change
            change = to_float(cells[5].get_text(strip=True))

            # Column 6: % Change
            change_percent = to_float(cells[6].get_text(strip=True))
            
        except ValueError:
            continue

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
        # Using timezone-aware UTC datetime to avoid deprecation warning
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(holdings),
        "holdings": holdings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Dow Jones holdings from SlickCharts.")
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
        holdings = parse_holdings(html)
        if not holdings:
            raise RuntimeError("No holdings parsed from SlickCharts response")
            
        payload = build_payload(holdings)

        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} holdings to {args.output}")
        if holdings:
            print("First 5 symbols:", ", ".join(item["symbol"] for item in holdings[:5]))
            
    except Exception as e:
        print(f"Error parsing holdings: {e}")
        # Debug: dump HTML if parsing fails
        # with open("debug_dow_fail.html", "w") as f:
        #     f.write(html)
        raise

if __name__ == "__main__":
    main()
