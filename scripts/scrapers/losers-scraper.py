#!/usr/bin/env python3
"""
SlickCharts Market Losers scraper (S&P 500 Losers).

Usage:
    python scripts/scrapers/losers-scraper.py --output data/losers.json --pretty
    python scripts/scrapers/losers-scraper.py --cumulative --output data/losers.json
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
from requests import Session

# Add parent directory for scraper_utils import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scraper_utils import (
    fetch_html, to_float, create_session,
    load_existing_history, build_cumulative_payload, write_cumulative_output,
    DEFAULT_RETENTION_DAYS
)

SOURCE_URL = "https://www.slickcharts.com/sp500/losers"
DEFAULT_OUTPUT = Path("source/100xFenok/data/slickcharts/losers.json")


def parse_losers(html: str) -> List[Dict[str, float | int | str]]:
    """Parse losers table rows from the SlickCharts HTML."""
    soup = BeautifulSoup(html, "html.parser")

    table = None
    tables = soup.find_all("table", class_="table")

    for t in tables:
        headers = [th.get_text(strip=True) for th in t.find_all("th")]
        if "Company" in headers and "Chg" in headers:
            table = t
            break

    if table is None:
        raise ValueError("Unable to locate losers table on the page")

    losers: List[Dict[str, float | int | str]] = []

    tbody = table.find("tbody")
    rows = tbody.find_all("tr") if tbody else table.find_all("tr")

    for idx, row in enumerate(rows, 1):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue
        try:
            company = cells[0].get_text(" ", strip=True)
            symbol = cells[1].get_text(strip=True)
            price = to_float(cells[2].get_text(" ", strip=True))
            change = to_float(cells[3].get_text(strip=True))
            change_percent = to_float(cells[4].get_text(strip=True))
        except ValueError:
            continue

        losers.append({
            "rank": idx,
            "company": company,
            "symbol": symbol,
            "price": price,
            "change": change,
            "changePercent": change_percent,
        })
    return losers


def build_payload(losers: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(losers),
        "losers": losers,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Market Losers from SlickCharts.")
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

    losers = parse_losers(html)
    if not losers:
        raise RuntimeError("No losers parsed from SlickCharts response")

    if args.cumulative:
        existing_history = load_existing_history(args.output)
        payload = build_cumulative_payload(
            losers,
            existing_history,
            data_key="losers",
            retention_days=args.retention_days,
        )
        write_cumulative_output(payload, args.output, pretty=args.pretty)
        print(f"Wrote {len(losers)} losers (history: {len(payload['history'])} days) to {args.output}")
    else:
        payload = build_payload(losers)
        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} losers to {args.output}")

    print("Top losers:", ", ".join(f"{item['symbol']} ({item['changePercent']}%)" for item in losers[:3]))


if __name__ == "__main__":
    main()
