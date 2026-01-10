#!/usr/bin/env python3
"""
SlickCharts ETF data scraper (ARK Invest + Index ETFs).

Usage:
    python scripts/scrapers/etf-scraper.py --output data/etf.json
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

# Add parent directory to path for scraper_utils import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html

SOURCE_URL = "https://www.slickcharts.com/etf"
DEFAULT_OUTPUT = Path(__file__).with_name("etf.json")


def parse_etfs(html: str) -> Dict[str, List[Dict[str, float | str]]]:
    """Parse ETF data from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")

    ark_symbols = ["ARKK", "ARKQ", "ARKW", "ARKG", "ARKF", "ARKX", "PRNT", "IZRL"]
    index_symbols = ["SPY", "QQQ", "DIA"]

    ark_etfs: List[Dict[str, float | str]] = []
    index_etfs: List[Dict[str, float | str]] = []
    seen: set = set()

    # Find all links with /symbol/ pattern
    for link in soup.find_all("a"):
        href = link.get("href", "")
        if "/symbol/" not in href:
            continue

        symbol = link.get_text(strip=True).upper()
        if symbol in seen:
            continue

        # Check if it's ARK or Index ETF
        if symbol not in ark_symbols and symbol not in index_symbols:
            continue

        # Get parent element with price data
        parent = link.find_parent(["div", "tr", "li"])
        if not parent:
            continue

        parent_text = parent.get_text(" ", strip=True)

        # Extract price (first number after symbol)
        # Format: "ARKK Innovation ETF Holdings 80.69 0.14 (0.18%)"
        price_match = re.search(rf'{symbol}[^0-9]*(\d+\.?\d*)', parent_text)
        change_match = re.search(r'\(([+-]?\d+\.?\d*)%\)', parent_text)

        if not price_match:
            continue

        etf_data = {
            "symbol": symbol,
            "price": float(price_match.group(1)),
            "changePercent": float(change_match.group(1)) if change_match else 0.0,
        }

        seen.add(symbol)

        if symbol in ark_symbols:
            ark_etfs.append(etf_data)
        else:
            index_etfs.append(etf_data)

    return {
        "ark": ark_etfs,
        "index": index_etfs,
    }


def build_payload(data: Dict[str, List]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "arkCount": len(data.get("ark", [])),
        "indexCount": len(data.get("index", [])),
        "ark": data.get("ark", []),
        "index": data.get("index", []),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape ETF data from SlickCharts.")
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
    data = parse_etfs(html)
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote ETF data to {args.output}")
    print(f"ARK ETFs: {payload['arkCount']}, Index ETFs: {payload['indexCount']}")
    if data.get("ark"):
        print("ARK:", ", ".join(etf["symbol"] for etf in data["ark"]))
    if data.get("index"):
        print("Index:", ", ".join(etf["symbol"] for etf in data["index"]))


if __name__ == "__main__":
    main()
