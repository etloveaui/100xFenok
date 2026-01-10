#!/usr/bin/env python3
"""
SlickCharts Dow Jones dividend yield scraper.

Usage:
    python scripts/scrapers/dowjones-yield-scraper.py --output data/dowjones_yield.json
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

# Add parent directory to path for scraper_utils import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import fetch_html

SOURCE_URL = "https://www.slickcharts.com/dowjones/yield"
DEFAULT_OUTPUT = Path(__file__).with_name("dowjones_yield.json")


def parse_yield(html: str) -> Dict[str, float | str]:
    """Extract dividend yield value from SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")

    # Look for the yield percentage in common patterns
    for elem in soup.find_all(["h1", "h2", "h3", "div", "span"]):
        text = elem.get_text(strip=True)
        match = re.search(r'(\d+\.?\d*)\s*%', text)
        if match and len(text) < 20:
            yield_value = float(match.group(1))
            return {"yield": yield_value}

    # Pattern 2: Look in meta or structured data
    for meta in soup.find_all("meta"):
        content = meta.get("content", "")
        if "yield" in content.lower():
            match = re.search(r'(\d+\.?\d*)\s*%', content)
            if match:
                return {"yield": float(match.group(1))}

    raise ValueError("Unable to locate dividend yield on the page")


def build_payload(data: Dict[str, float | str]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "index": "dowjones",
        **data,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Dow Jones dividend yield from SlickCharts.")
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
    data = parse_yield(html)
    payload = build_payload(data)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote yield data to {args.output}")
    print(f"Dow Jones Dividend Yield: {data['yield']}%")


if __name__ == "__main__":
    main()
