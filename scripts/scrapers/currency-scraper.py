#!/usr/bin/env python3
"""
SlickCharts Cryptocurrency Market Data scraper.

Usage:
    python scripts/scrapers/currency-scraper.py --output data/currency.json --pretty
    python scripts/scrapers/currency-scraper.py --cumulative --output data/currency.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import requests
from bs4 import BeautifulSoup

# Add parent directory for scraper_utils import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import (
    fetch_html, to_float, clean_number, create_session,
    load_existing_history, build_cumulative_payload, write_cumulative_output,
    DEFAULT_RETENTION_DAYS
)

SOURCE_URL = "https://www.slickcharts.com/currency"
DEFAULT_OUTPUT = Path("source/100xFenok/data/slickcharts/currency.json")


def parse_currency(html: str) -> Dict[str, object]:
    """Parse currency table and total market cap from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    
    # 1. Extract Total Market Cap
    # <h5 class="text-center">Total Cryptocurrency Market Cap: $3,117,864,890,546</h5>
    total_market_cap = 0.0
    h5_tags = soup.find_all("h5", class_="text-center")
    for h5 in h5_tags:
        text = h5.get_text(strip=True)
        if "Total Cryptocurrency Market Cap" in text:
            # Extract number after $
            match = re.search(r'\$([\d,]+)', text)
            if match:
                total_market_cap = float(match.group(1).replace(",", ""))
            break

    # 2. Locate the table
    table = soup.find("table", class_="table table-hover")
    if table is None:
        raise ValueError("Unable to locate currency table on the page")

    currencies: List[Dict[str, float | int | str]] = []
    
    # Skip thead, process tbody tr
    tbody = table.find("tbody")
    rows = tbody.find_all("tr") if tbody else table.find_all("tr")
    
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 6:
            continue
        try:
            # Column 0: Rank
            rank = int(clean_number(cells[0].get_text(strip=True)))
            
            # Column 1: Name (Symbol) -> "Bitcoin (BTC)"
            name_cell_text = cells[1].get_text(strip=True)
            # Regex to separate Name and (Symbol)
            # Example: "Bitcoin (BTC)" -> Name: Bitcoin, Symbol: BTC
            # Some might not have parens? Assuming format is Name (Symbol)
            match = re.match(r'^(.*?)\s*\((.*?)\)$', name_cell_text)
            if match:
                name = match.group(1).strip()
                symbol = match.group(2).strip()
            else:
                # Fallback if parsing fails
                name = name_cell_text
                symbol = ""
            
            # Column 2: Market Cap
            market_cap = to_float(cells[2].get_text(strip=True))

            # Column 3: Market Share
            market_share = to_float(cells[3].get_text(strip=True))

            # Column 4: Price
            price = to_float(cells[4].get_text(strip=True))

            # Column 5: 24 Hr % Change
            change_24h = to_float(cells[5].get_text(strip=True))
            
        except ValueError:
            continue

        currencies.append(
            {
                "rank": rank,
                "name": name,
                "symbol": symbol,
                "marketCap": market_cap,
                "marketShare": market_share,
                "price": price,
                "change24h": change_24h,
            }
        )
    
    return {
        "totalMarketCap": total_market_cap,
        "currencies": currencies
    }


def build_payload(data: Dict[str, object]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "totalMarketCap": data["totalMarketCap"],
        "count": len(data["currencies"]),
        "currencies": data["currencies"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Cryptocurrency Market Data from SlickCharts.")
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--pretty", "-p",
        action="store_true",
        help="Pretty-print JSON with indentation.",
    )
    parser.add_argument(
        "--cumulative", "-c",
        action="store_true",
        help="Enable cumulative mode (append to history).",
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"Days to retain in history (default: {DEFAULT_RETENTION_DAYS}).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    session = create_session()
    html = fetch_html(session, SOURCE_URL)
    session.close()

    parsed_data = parse_currency(html)
    if not parsed_data["currencies"]:
        raise RuntimeError("No currency data parsed from SlickCharts response")

    currencies = parsed_data["currencies"]

    if args.cumulative:
        existing_history = load_existing_history(args.output)
        payload = build_cumulative_payload(
            currencies,
            existing_history,
            data_key="currencies",
            retention_days=args.retention_days,
        )
        # Add totalMarketCap to latest entry
        if payload["history"]:
            payload["history"][0]["totalMarketCap"] = parsed_data["totalMarketCap"]
        write_cumulative_output(payload, args.output, pretty=args.pretty)
        print(f"Wrote {len(currencies)} currencies (history: {len(payload['history'])} days) to {args.output}")
    else:
        payload = build_payload(parsed_data)
        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} currencies to {args.output}")

    print("First 3:", ", ".join(item["symbol"] for item in currencies[:3]))

if __name__ == "__main__":
    main()
