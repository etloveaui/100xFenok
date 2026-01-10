#!/usr/bin/env python3
"""
SlickCharts mortgage rates scraper.

Usage:
    python scripts/scrapers/mortgage-scraper.py --output data/mortgage_rates.json
    python scripts/scrapers/mortgage-scraper.py --output data/mortgage.json --cumulative
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

from scraper_utils import (
    fetch_html,
    load_existing_history,
    prune_old_entries,
    build_cumulative_payload,
    write_cumulative_output,
    add_cumulative_args,
)

SOURCE_URL = "https://www.slickcharts.com/mortgage"
DEFAULT_OUTPUT = Path(__file__).with_name("mortgage_rates.json")


def _clean_number(value: str) -> str:
    return (
        value.replace("%", "")
        .replace("+", "")
        .replace(",", "")
        .strip()
    )


def _to_float(value: str) -> float:
    cleaned = _clean_number(value)
    return float(cleaned) if cleaned else 0.0


def parse_rates(html: str) -> List[Dict[str, float | str]]:
    """Extract mortgage rates from SlickCharts table."""
    soup = BeautifulSoup(html, "html.parser")
    header = soup.find("h5", string=lambda t: t and "Mortgage Rates" in t)
    table = header.find_next("table") if header else None
    if table is None:
        table = soup.select_one("table.table.table-hover")
    if table is None:
        raise ValueError("Unable to locate mortgage rates table")

    rows = []
    for row in table.select("tbody tr"):
        cells = row.find_all(["td", "th"])
        if not cells or cells[0].name == "th":
            continue
        if len(cells) < 3:
            continue
        mortgage_type = cells[0].get_text(strip=True)
        rate = _to_float(cells[1].get_text(strip=True))
        change = _to_float(cells[2].get_text(strip=True))
        if cells[2].get_text(strip=True).startswith("-"):
            change = -abs(change)
        rows.append(
            {
                "type": mortgage_type,
                "rate": rate,
                "change": change,
            }
        )
    return rows


def build_payload(rates: List[Dict[str, float | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(rates),
        "rates": rates,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape mortgage rates from SlickCharts.")
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
    # Add cumulative mode arguments
    add_cumulative_args(parser)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with requests.Session() as session:
        html = fetch_html(session, SOURCE_URL)
    rates = parse_rates(html)
    if len(rates) != 6:
        raise RuntimeError(f"Unexpected mortgage rate count: {len(rates)}")

    # Cumulative mode support
    if args.cumulative:
        existing_history = load_existing_history(args.output)
        pruned_history = prune_old_entries(existing_history, args.retention_days)
        payload = build_cumulative_payload(
            data=rates,
            data_key="rates",
            existing_history=pruned_history,
            source="slickcharts"
        )
        write_cumulative_output(payload, args.output, pretty=args.pretty)
        print(f"Wrote cumulative mortgage rates to {args.output} ({len(payload['history'])} entries)")
    else:
        # Snapshot mode (original behavior)
        payload = build_payload(rates)
        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} mortgage rates to {args.output}")
        print("Products:", ", ".join(item["type"] for item in rates))


if __name__ == "__main__":
    main()
