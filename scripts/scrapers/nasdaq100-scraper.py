#!/usr/bin/env python3
"""
SlickCharts Nasdaq 100 holdings scraper.

Usage:
    python scripts/scrapers/nasdaq100-scraper.py --output data/nasdaq100_holdings.json
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

SOURCE_URL = "https://www.slickcharts.com/nasdaq100"
DEFAULT_OUTPUT = Path(__file__).with_name("nasdaq100_holdings.json")


def _is_hidden_row(cells: List) -> bool:
    if not cells:
        return True
    if len(cells) < 7:
        return True
    for cell in cells:
        attrs = {k.lower(): v for k, v in cell.attrs.items()}
        if "colspan" in attrs:
            return True
    return False


def parse_holdings(html: str) -> List[Dict[str, float | int | str]]:
    """Extract Nasdaq 100 holdings from the SlickCharts table."""
    soup = BeautifulSoup(html, "html.parser")
    header = soup.find("h5", string=lambda t: t and "Nasdaq 100 Components" in t)
    table = None
    if header:
        container = header.find_next("div", class_="table-responsive")
        table = container.find("table") if container else None
    if table is None:
        table = soup.select_one("div.table-responsive table.table")
    if table is None:
        raise ValueError("Unable to locate Nasdaq 100 table")

    holdings: List[Dict[str, float | int | str]] = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td")
        if _is_hidden_row(cells):
            continue
        data_cells = cells[:7]
        try:
            rank = int(clean_number(data_cells[0].get_text(strip=True)))
            company = data_cells[1].get_text(" ", strip=True)
            symbol = data_cells[2].get_text(strip=True)
            weight = to_float(data_cells[3].get_text(strip=True))
            price = to_float(data_cells[4].get_text(" ", strip=True))
            change = to_float(data_cells[5].get_text(strip=True))
            change_percent = to_float(data_cells[6].get_text(strip=True))
        except ValueError:
            continue

        holdings.append(
            {
                "rank": rank,
                "company": company,
                "symbol": symbol,
                "weight": weight,
                "price": price,
                "change": change,
                "changePercent": change_percent,
            }
        )
    return holdings


def build_payload(holdings: List[Dict[str, float | int | str]]) -> Dict[str, object]:
    return {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "slickcharts",
        "count": len(holdings),
        "holdings": holdings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Nasdaq 100 holdings from SlickCharts.")
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
    holdings = parse_holdings(html)
    if not holdings:
        raise RuntimeError("No holdings parsed from SlickCharts response")
    payload = build_payload(holdings)

    args.output.write_text(
        json.dumps(payload, indent=2 if args.pretty else None),
        encoding="utf-8",
    )
    print(f"Wrote {payload['count']} holdings to {args.output}")
    print("First 5 symbols:", ", ".join(item["symbol"] for item in holdings[:5]))


if __name__ == "__main__":
    main()
