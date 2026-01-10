#!/usr/bin/env python3
"""
SlickCharts Nasdaq 100 cumulative weight analysis scraper.

Usage:
    python scripts/scrapers/nasdaq100-analysis-scraper.py --output data/nasdaq100_analysis.json
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

SOURCE_URL = "https://www.slickcharts.com/nasdaq100/analysis"
DEFAULT_OUTPUT = Path(__file__).with_name("nasdaq100_analysis.json")


def _parse_market_cap(value: str) -> float:
    """Parse market cap with T/B/M suffix."""
    value = value.replace(",", "").replace("$", "").strip()
    multiplier = 1.0
    if value.endswith("T"):
        multiplier = 1_000_000_000_000
        value = value[:-1]
    elif value.endswith("B"):
        multiplier = 1_000_000_000
        value = value[:-1]
    elif value.endswith("M"):
        multiplier = 1_000_000
        value = value[:-1]
    try:
        return float(value) * multiplier
    except ValueError:
        return 0.0


def parse_analysis(html: str) -> List[Dict[str, float | int | str]]:
    """Parse cumulative weight analysis table from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.table.table-hover")
    if table is None:
        raise ValueError("Unable to locate analysis table")

    results: List[Dict[str, float | int | str]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if len(cells) < 6:
            continue
        try:
            rank = int(clean_number(cells[0].get_text(strip=True)))
            symbol = cells[1].get_text(strip=True)
            company = cells[2].get_text(" ", strip=True)
            market_cap = _parse_market_cap(cells[3].get_text(strip=True))
            weight = to_float(cells[4].get_text(strip=True))
            cumulative = to_float(cells[5].get_text(strip=True))
        except ValueError:
            continue
        results.append({
            "rank": rank,
            "symbol": symbol,
            "company": company,
            "marketCap": market_cap,
            "weight": weight,
            "cumulativeWeight": cumulative,
        })
    return results


def build_payload(data: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "index": "nasdaq100",
        "count": len(data),
        "analysis": data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Nasdaq 100 cumulative weight analysis from SlickCharts.")
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
    data = parse_analysis(html)
    if not data:
        raise RuntimeError("No analysis data parsed from SlickCharts response")
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} rows to {args.output}")
    print("Top 5:", ", ".join(f"{item['symbol']}({item['cumulativeWeight']}%)" for item in data[:5]))


if __name__ == "__main__":
    main()
