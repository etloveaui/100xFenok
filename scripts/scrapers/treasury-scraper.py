#!/usr/bin/env python3
"""
SlickCharts Treasury Rates scraper.

Usage:
    python scripts/scrapers/treasury-scraper.py --output data/treasury.json --pretty
    python scripts/scrapers/treasury-scraper.py --cumulative --output data/treasury.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from bs4 import BeautifulSoup

# Add parent directory for scraper_utils import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import (
    fetch_html_playwright, to_float,
    load_existing_history, build_cumulative_payload, write_cumulative_output,
    DEFAULT_RETENTION_DAYS
)

SOURCE_URL = "https://www.slickcharts.com/treasury"
DEFAULT_OUTPUT = Path("source/100xFenok/data/slickcharts/treasury.json")


def clean_maturity(text: str) -> str:
    """Clean maturity text: '1 Month Treasury' -> '1 Mo'."""
    text = text.replace("Treasury", "").strip()
    if "Month" in text:
        text = text.replace("Monthnth", "Mo").replace("Month", "Mo")
    elif "Year" in text:
        text = text.replace("Year", "Yr")
    return text.strip()


def parse_treasury(html: str) -> List[Dict[str, float | str]]:
    """Parse treasury rates table from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="table")

    if table is None:
        raise ValueError("Unable to locate treasury table on the page")

    rates: List[Dict[str, float | str]] = []

    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        maturity_raw = cells[0].get_text(strip=True)
        yield_raw = cells[1].get_text(strip=True)
        change_raw = cells[2].get_text(strip=True)

        maturity = clean_maturity(maturity_raw)
        rate = to_float(yield_raw)
        change = to_float(change_raw)

        if rate == 0.0:
            continue

        rates.append({
            "maturity": maturity,
            "rate": rate,
            "change": change,
        })

    return rates


def build_payload(rates: List[Dict[str, float | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(rates),
        "rates": rates,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Treasury Rates from SlickCharts.")
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

    html = fetch_html_playwright(SOURCE_URL)
    rates = parse_treasury(html)
    if not rates:
        raise RuntimeError("No treasury rates parsed from SlickCharts response")

    if args.cumulative:
        existing_history = load_existing_history(args.output)
        payload = build_cumulative_payload(
            rates,
            existing_history,
            data_key="rates",
            retention_days=args.retention_days,
        )
        write_cumulative_output(payload, args.output, pretty=args.pretty)
        print(f"Wrote {len(rates)} rates (history: {len(payload['history'])} days) to {args.output}")
    else:
        payload = build_payload(rates)
        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} rates to {args.output}")

    print("Maturities:", ", ".join(r["maturity"] for r in rates[:5]))


if __name__ == "__main__":
    main()
