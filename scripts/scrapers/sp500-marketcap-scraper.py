#!/usr/bin/env python3
"""
SlickCharts S&P 500 market cap scraper.

Usage:
    python scripts/scrapers/sp500-marketcap-scraper.py --output data/sp500_marketcap.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

import requests
from bs4 import BeautifulSoup

# Import shared utilities
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html

SOURCE_URL = "https://www.slickcharts.com/sp500/marketcap"
DEFAULT_OUTPUT = Path(__file__).with_name("sp500_marketcap.json")


def parse_marketcap(html: str) -> Dict[str, float]:
    """Parse total market cap value from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")

    # Look for total market cap text
    for elem in soup.find_all(["h1", "h2", "h3", "p", "div", "span"]):
        text = elem.get_text(" ", strip=True)
        if "trillion" in text.lower():
            # Pattern: $XX.XXX trillion
            match = re.search(r'\$?([\d.]+)\s*trillion', text, re.IGNORECASE)
            if match:
                value = float(match.group(1)) * 1_000_000_000_000
                return {"totalMarketCap": value}

    # Fallback: Look for any large number with T suffix
    for elem in soup.find_all(["h1", "h2", "h3", "p", "div", "span"]):
        text = elem.get_text(strip=True)
        match = re.search(r'\$?([\d.]+)T', text)
        if match:
            value = float(match.group(1)) * 1_000_000_000_000
            return {"totalMarketCap": value}

    raise ValueError("Unable to locate total market cap on the page")


def build_payload(data: Dict[str, float]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "index": "sp500",
        **data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape S&P 500 market cap data from SlickCharts.")
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
    data = parse_marketcap(html)
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote market cap data to {args.output}")
    print(f"Total S&P 500 Market Cap: ${payload['totalMarketCap']/1e12:.2f}T")


if __name__ == "__main__":
    main()
