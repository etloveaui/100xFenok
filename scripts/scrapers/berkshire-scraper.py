#!/usr/bin/env python3
"""
SlickCharts Berkshire Hathaway Unified Scraper

Scrapes both holdings (13F) and historical annual returns.

Usage:
    python scripts/scrapers/berkshire-scraper.py --holdings
    python scripts/scrapers/berkshire-scraper.py --returns
    python scripts/scrapers/berkshire-scraper.py --all
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import requests
from bs4 import BeautifulSoup

# Add parent directory to sys.path to import scraper_utils
sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper_utils import (
    build_standard_payload,
    create_scraper_parser,
    create_session,
    extract_table_rows,
    fetch_html,
    find_table,
    get_utc_timestamp,
    to_float,
    to_int,
    write_output,
)

# ==============================================================================
# Constants
# ==============================================================================

HOLDINGS_URL = "https://www.slickcharts.com/berkshire-hathaway"
RETURNS_URL = "https://www.slickcharts.com/berkshire-hathaway/returns"


# ==============================================================================
# Scraper Logic
# ==============================================================================

def scrape_holdings(session: requests.Session) -> Dict[str, Any]:
    """Scrape Berkshire Hathaway portfolio holdings."""
    html = fetch_html(session, HOLDINGS_URL)
    soup = BeautifulSoup(html, "html.parser")
    
    try:
        table = find_table(soup, header_text="Berkshire Hathaway Holdings")
        raw_rows = extract_table_rows(table, min_columns=4)
    except ValueError as e:
        return {"error": str(e)}

    holdings = []
    for row in raw_rows:
        if len(row) < 4:
            continue
            
        # Analysis: [Rank, Company, Symbol, Portfolio%, Price, Chg, % Chg]
        rank = to_int(row[0])
        company = row[1]
        symbol = row[2]
        portfolio_pct = to_float(row[3])
        
        # Extra fields from HTML structure
        price = to_float(row[4]) if len(row) > 4 else 0.0
        change = to_float(row[5]) if len(row) > 5 else 0.0
        change_percent = to_float(row[6]) if len(row) > 6 else 0.0

        holdings.append({
            "rank": rank,
            "company": company,
            "symbol": symbol,
            "portfolio_pct": portfolio_pct,
            "price": price,
            "change": change,
            "changePercent": change_percent  # Schema unified (was: change_pct)
        })

    return {
        "updated": get_utc_timestamp(),
        "source": "slickcharts",
        "mode": "holdings",
        "count": len(holdings),
        "holdings": holdings
    }


def scrape_returns(session: requests.Session) -> Dict[str, Any]:
    """Scrape Berkshire Hathaway historical annual returns."""
    html = fetch_html(session, RETURNS_URL)
    soup = BeautifulSoup(html, "html.parser")
    
    try:
        # Header is "Berkshire Hathaway Returns by Year" in h1
        table = find_table(soup, header_text="Berkshire Hathaway Returns by Year")
        raw_rows = extract_table_rows(table, min_columns=2)
    except ValueError as e:
        return {"error": str(e)}

    returns = []
    years = []
    
    for row in raw_rows:
        if len(row) < 2:
            continue
            
        # Analysis: [Year, Berkshire Return, (maybe) SP500, (maybe) Diff]
        year = to_int(row[0])
        berkshire = to_float(row[1])
        sp500 = to_float(row[2]) if len(row) > 2 else 0.0
        difference = to_float(row[3]) if len(row) > 3 else 0.0

        returns.append({
            "year": year,
            "berkshire": berkshire,
            "sp500": sp500,
            "difference": difference
        })
        years.append(year)

    years_covered = f"{min(years)}-{max(years)}" if years else ""

    return {
        "updated": get_utc_timestamp(),
        "source": "slickcharts",
        "mode": "returns",
        "count": len(returns),
        "years_covered": years_covered,
        "returns": returns
    }


# ==============================================================================
# Main Execution
# ==============================================================================

def main():
    parser = create_scraper_parser("Berkshire Hathaway unified scraper")
    parser.add_argument("--holdings", action="store_true", help="Scrape holdings only")
    parser.add_argument("--returns", action="store_true", help="Scrape returns only")
    parser.add_argument("--all", action="store_true", help="Scrape both (default)")
    
    args = parser.parse_args()
    
    # Default behavior: if no flags provided, default to --all
    if not (args.holdings or args.returns or args.all):
        args.all = True
        
    session = create_session()
    payload = {}

    if args.all:
        holdings_result = scrape_holdings(session)
        returns_result = scrape_returns(session)
        
        payload = {
            "updated": get_utc_timestamp(),
            "source": "slickcharts",
            "mode": "all",
            "holdings": {
                "count": holdings_result.get("count", 0),
                "data": holdings_result.get("holdings", [])
            },
            "returns": {
                "count": returns_result.get("count", 0),
                "years_covered": returns_result.get("years_covered", ""),
                "data": returns_result.get("returns", [])
            }
        }
    elif args.holdings:
        payload = scrape_holdings(session)
    elif args.returns:
        payload = scrape_returns(session)

    write_output(payload, args.output, pretty=args.pretty)


if __name__ == "__main__":
    main()
