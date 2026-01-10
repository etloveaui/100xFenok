#!/usr/bin/env python3
"""
SlickCharts Dow Jones Cumulative Weight Analysis Scraper

The Dow Jones Industrial Average is a price-weighted index.
This scraper extracts the weights and cumulative weights of the 30 components.

Usage:
    python scripts/scrapers/dowjones-analysis-scraper.py --output data/dowjones_analysis.json --pretty
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

SOURCE_URL = "https://www.slickcharts.com/dowjones/analysis"
DEFAULT_OUTPUT = Path("data/dowjones_analysis.json")


def scrape_dowjones_analysis(session):
    html = fetch_html(session, SOURCE_URL)
    
    # Header text might vary, use specific text from analysis
    # Analysis: "Cumulative Dow Jones Weight List"
    # Or rely on fallback or specific selector if provided
    # Let's try finding the table directly.
    # The dump showed <h1 class="text-center" ...>Cumulative Dow Jones Weight List</h1>
    
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    
    try:
        table = find_table(soup, header_text="Cumulative Dow Jones Weight List")
    except ValueError:
        # Fallback to direct selector if header text match fails
        table = find_table(soup, selector="table.table.table-hover.table-borderless.table-sm")

    rows = extract_table_rows(table, min_columns=6)
    
    analysis_data = []
    
    for row in rows:
        if len(row) < 6:
            continue
            
        # Columns: #, Symbol, Company, Price, Weight, Cumulative Weight
        rank = to_int(row[0])
        symbol = row[1]
        company = row[2]
        price = to_float(row[3]) # Price column instead of Market Cap
        weight = to_float(row[4])
        cumulative_weight = to_float(row[5])
        
        analysis_data.append({
            "rank": rank,
            "symbol": symbol,
            "company": company,
            "price": price,
            "weight": weight,
            "cumulativeWeight": cumulative_weight
        })

    return analysis_data


def main():
    parser = create_scraper_parser("Dow Jones Analysis Scraper", default_output=DEFAULT_OUTPUT)
    args = parser.parse_args()
    
    session = create_session()
    
    try:
        data = scrape_dowjones_analysis(session)
        
        payload = build_standard_payload(
            data,
            source="slickcharts",
            count_key="count",
            data_key="analysis",
            extra_fields={"index": "dowjones"}
        )
        
        write_output(payload, args.output, pretty=args.pretty)
        
        if data:
            print(f"Scraped {len(data)} rows.")
            print(f"Top entry: {data[0]['symbol']} ({data[0]['weight']}%)")
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
