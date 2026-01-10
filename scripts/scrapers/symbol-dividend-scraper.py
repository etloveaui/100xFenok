#!/usr/bin/env python3
"""
Individual Stock Dividend History Scraper for SlickCharts

Scrapes historical quarterly dividend payments for stocks.
Supports single-symbol mode and batch mode for matrix builds.

Usage:
    python symbol-dividend-scraper.py --symbol AAPL --pretty
    python symbol-dividend-scraper.py --batch A-D --output data/dividends-batch1.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from scraper_utils import (
    create_session,
    fetch_html,
    to_float,
    clean_number,
    find_table,
    extract_table_rows,
    build_standard_payload,
    write_output,
    get_utc_timestamp,
    RATE_LIMIT_SECONDS,
)

from bs4 import BeautifulSoup

# Constants
BASE_URL = "https://www.slickcharts.com/symbol"
DATA_DIR = Path(__file__).parent.parent.parent / "source/100xFenok/data/slickcharts"

# Batch definitions
BATCHES = {
    "A-D": lambda s: s[0].upper() <= 'D',
    "E-L": lambda s: 'E' <= s[0].upper() <= 'L',
    "M-R": lambda s: 'M' <= s[0].upper() <= 'R',
    "S-Z": lambda s: s[0].upper() >= 'S',
    "ALL": lambda s: True,
}


def load_universe_tickers() -> List[str]:
    """Load deduplicated tickers from S&P 500, Nasdaq 100, and Dow Jones."""
    tickers = set()
    files = ["sp500.json", "nasdaq100.json", "dowjones.json"]
    
    for filename in files:
        path = DATA_DIR / filename
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                holdings = data.get("holdings", [])
                for h in holdings:
                    if "symbol" in h:
                        tickers.add(h["symbol"])
            except Exception as e:
                print(f"Warning: Failed to load {filename}: {e}", file=sys.stderr)
                
    return sorted(list(tickers))


def parse_dividend_page(html: str, symbol: str) -> Dict[str, Any]:
    """Parse dividend history table."""
    soup = BeautifulSoup(html, "html.parser")
    result = {
        "symbol": symbol,
        "updated": get_utc_timestamp(),
        "source": "slickcharts",
        "count": 0,
        "dividends": []
    }

    try:
        # Strategy: find table with "Dividend" header
        # Based on analysis: <table class="table table-striped table-hover table-borderless table-sm">
        table = find_table(soup, header_text="Dividend Payments", fallback_selector="table.table-striped")
        raw_rows = extract_table_rows(table, min_columns=3)
        
        dividends = []
        for row in raw_rows:
            # Skip header row if extract_table_rows didn't
            if "Dividend" in row[0]:
                continue
                
            amount = to_float(row[0])
            ex_date = row[1]
            pay_date = row[2]
            
            # Simple date validation (YYYY-MM-DD)
            if not re.match(r'\d{4}-\d{2}-\d{2}', ex_date):
                continue

            dividends.append({
                "amount": amount,
                "exDate": ex_date,
                "payDate": pay_date
            })
            
        result["dividends"] = dividends
        result["count"] = len(dividends)
        
    except ValueError:
        # Table not found = likely no dividends
        result["note"] = "No dividend history available"
        
    return result


def scrape_symbol(session, symbol: str) -> Tuple[Dict[str, Any], bool]:
    url = f"{BASE_URL}/{symbol}/dividend"
    try:
        html = fetch_html(session, url)
        data = parse_dividend_page(html, symbol)
        return data, True
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}, False


def main():
    parser = argparse.ArgumentParser(description="Scrape individual stock dividend history")
    parser.add_argument("--symbol", help="Scrape single symbol")
    parser.add_argument("--batch", choices=list(BATCHES.keys()), help="Scrape batch")
    parser.add_argument("--output", type=Path, help="Output file")
    parser.add_argument("--pretty", action="store_true", help="Pretty print")
    parser.add_argument("--merge", nargs="+", type=Path, help="Merge files")
    
    args = parser.parse_args()
    
    if args.merge:
        # Simple merge logic for batch results
        all_stocks = []
        for f in args.merge:
            if f.exists():
                data = json.loads(f.read_text(encoding="utf-8"))
                all_stocks.extend(data.get("stocks", []))
        
        payload = build_standard_payload(all_stocks, data_key="stocks")
        write_output(payload, args.output, pretty=args.pretty)
        return

    session = create_session()
    
    if args.symbol:
        data, success = scrape_symbol(session, args.symbol.upper())
        if success:
            write_output(data, args.output, pretty=args.pretty)
        else:
            print(f"Error: {data.get('error')}", file=sys.stderr)
            sys.exit(1)
    elif args.batch:
        tickers = load_universe_tickers()
        filter_func = BATCHES[args.batch]
        filtered = [t for t in tickers if filter_func(t)]
        
        print(f"Scraping {len(filtered)} stocks for batch {args.batch}")
        results = []
        for i, ticker in enumerate(filtered):
            if (i+1) % 5 == 0:
                print(f"  Progress: {i+1}/{len(filtered)} ({ticker})")
            data, _ = scrape_symbol(session, ticker)
            results.append(data)
            
        payload = build_standard_payload(results, data_key="stocks", extra_fields={"batch": args.batch})
        write_output(payload, args.output, pretty=args.pretty)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
