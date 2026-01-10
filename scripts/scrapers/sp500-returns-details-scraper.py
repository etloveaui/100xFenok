#!/usr/bin/env python3
"""
SlickCharts S&P 500 Returns Details Scraper

Extracts detailed annual return breakdown: Price Return, Dividend Return, and Total Return.

Usage:
    python scripts/scrapers/sp500-returns-details-scraper.py --output data/sp500_returns_details.json --pretty
"""
from __future__ import annotations

import sys
from pathlib import Path

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

SOURCE_URL = "https://www.slickcharts.com/sp500/returns/details"
DEFAULT_OUTPUT = Path("data/sp500_returns_details.json")


def scrape_returns_details(session):
    html = fetch_html(session, SOURCE_URL)
    
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    
    # Table has header: Return Year, Price Return, Dividend Return, Total Return
    # It is usually under "Price Return + Dividend Return = Total Return" text or similar structure.
    # We can try finding by table class directly as it is standard.
    
    try:
        table = find_table(soup, selector="table.table.table-hover")
    except ValueError:
        return []

    rows = extract_table_rows(table, min_columns=4)
    
    returns_data = []
    
    for row in rows:
        if len(row) < 4:
            continue
            
        # Columns: Return Year, Price Return, Dividend Return, Total Return
        year = to_int(row[0])
        price_return = to_float(row[1])
        dividend_return = to_float(row[2])
        total_return = to_float(row[3])
        
        returns_data.append({
            "year": year,
            "priceReturn": price_return,
            "dividendReturn": dividend_return,
            "totalReturn": total_return
        })

    return returns_data


def main():
    parser = create_scraper_parser("S&P 500 Returns Details Scraper", default_output=DEFAULT_OUTPUT)
    args = parser.parse_args()
    
    session = create_session()
    
    try:
        data = scrape_returns_details(session)
        
        if not data:
            raise ValueError("No data extracted")
            
        payload = build_standard_payload(
            data,
            source="slickcharts",
            count_key="count",
            data_key="returns",
            extra_fields={"index": "sp500"}
        )
        
        write_output(payload, args.output, pretty=args.pretty)
        
        if data:
            print(f"Scraped {len(data)} years of returns.")
            print(f"Latest: {data[0]['year']} (Total: {data[0]['totalReturn']}%)")
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
