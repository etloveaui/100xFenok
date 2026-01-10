#!/usr/bin/env python3
"""
SlickCharts S&P 500 gainers scraper.

Usage:
    python scripts/scrapers/gainers-scraper.py --output data/gainers.json
    python scripts/scrapers/gainers-scraper.py --cumulative --output data/gainers.json
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

SOURCE_URL = "https://www.slickcharts.com/sp500/gainers"
DEFAULT_OUTPUT = Path("source/100xFenok/data/slickcharts/gainers.json")


def parse_gainers(html: str) -> List[Dict[str, float | int | str]]:
    soup = BeautifulSoup(html, "html.parser")
    header = soup.find("h1", string=lambda t: t and "gainers" in t.lower())
    table = header.find_next("table") if header else None
    if table is None:
        table = soup.select_one("table.table.table-hover")
    if table is None:
        raise ValueError("Unable to locate gainers table")

    rows: List[Dict[str, float | int | str]] = []
    for idx, row in enumerate(table.select("tbody tr"), start=1):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue
        company = cells[0].get_text(" ", strip=True)
        symbol = cells[1].get_text(strip=True)
        price = to_float(cells[2].get_text(" ", strip=True))
        change = to_float(cells[3].get_text(strip=True))
        change_percent = to_float(cells[4].get_text(strip=True))
        rows.append(
            {
                "rank": idx,
                "company": company,
                "symbol": symbol,
                "price": price,
                "change": change,
                "changePercent": change_percent,
            }
        )
    return rows


def build_payload(gainers: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(gainers),
        "gainers": gainers,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape market gainers from SlickCharts.")
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

    gainers = parse_gainers(html)
    if not gainers:
        raise RuntimeError("No gainers parsed from SlickCharts response")

    if args.cumulative:
        # Cumulative mode: append to history
        existing_history = load_existing_history(args.output)
        payload = build_cumulative_payload(
            gainers,
            existing_history,
            data_key="gainers",
            retention_days=args.retention_days,
        )
        write_cumulative_output(payload, args.output, pretty=args.pretty)
        print(f"Wrote {len(gainers)} gainers (history: {len(payload['history'])} days) to {args.output}")
    else:
        # Snapshot mode: overwrite
        payload = build_payload(gainers)
        args.output.write_text(
            json.dumps(payload, indent=2 if args.pretty else None),
            encoding="utf-8",
        )
        print(f"Wrote {payload['count']} gainers to {args.output}")

    print("Top symbols:", ", ".join(item["symbol"] for item in gainers[:5]))


if __name__ == "__main__":
    main()
