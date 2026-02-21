#!/usr/bin/env python3
"""
SlickCharts Magnificent 7 stocks scraper.

Usage:
    python scripts/scrapers/magnificent7-scraper.py --output data/magnificent7.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from bs4 import BeautifulSoup

# Add parent directory to path for scraper_utils imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper_utils import fetch_html_playwright, clean_number, to_float

SOURCE_URL = "https://www.slickcharts.com/magnificent7"
DEFAULT_OUTPUT = Path(__file__).with_name("magnificent7.json")


def _clean_number_mag7(value: str) -> str:
    """Custom clean_number for Magnificent 7 that handles parentheses as negative."""
    result = (
        value.replace(",", "")
        .replace("%", "")
        .replace("$", "")
        .replace("(", "-")
        .replace(")", "")
        .replace("+", "")
        .strip()
    )
    # Handle double dash (e.g., "--0.82" -> "-0.82")
    while "--" in result:
        result = result.replace("--", "-")
    return result


def _to_float_mag7(value: str) -> float:
    """Custom to_float for Magnificent 7 using custom clean_number."""
    stripped = _clean_number_mag7(value)
    return float(stripped) if stripped else 0.0


def parse_magnificent7(html: str) -> List[Dict[str, float | int | str]]:
    """Parse Magnificent 7 table from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.table.table-hover")
    if table is None:
        raise ValueError("Unable to locate Magnificent 7 table")

    results: List[Dict[str, float | int | str]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 7:
            continue
        try:
            rank = int(clean_number(cells[0].get_text(strip=True)))
            company = cells[1].get_text(" ", strip=True)
            symbol = cells[2].get_text(strip=True)
            weight = _to_float_mag7(cells[3].get_text(strip=True))
            price = _to_float_mag7(cells[4].get_text(strip=True))
            change = _to_float_mag7(cells[5].get_text(strip=True))
            change_percent = _to_float_mag7(cells[6].get_text(strip=True))
        except ValueError:
            continue
        results.append({
            "rank": rank,
            "company": company,
            "symbol": symbol,
            "weight": weight,
            "price": price,
            "change": change,
            "changePercent": change_percent,
        })
    return results


def build_payload(data: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    total_market_cap = 21.58e12  # $21.58 trillion (from page description)
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "totalMarketCap": total_market_cap,
        "count": len(data),
        "holdings": data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Magnificent 7 stocks from SlickCharts.")
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

    html = fetch_html_playwright(SOURCE_URL, wait_for_selector="table.table.table-hover")
    data = parse_magnificent7(html)
    if not data:
        raise RuntimeError("No Magnificent 7 data parsed from SlickCharts response")
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} stocks to {args.output}")
    print("Stocks:", ", ".join(item["symbol"] for item in data))


if __name__ == "__main__":
    main()
