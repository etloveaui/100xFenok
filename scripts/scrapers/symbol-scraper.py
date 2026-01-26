#!/usr/bin/env python3
"""
Individual Stock Symbol Scraper for SlickCharts

Scrapes P/E ratio, EPS, dividend yield, and market cap for S&P 500 stocks.
Designed for batch processing with GitHub Actions Matrix builds.

Usage:
    # Scrape all 500 stocks (single run, ~12 minutes)
    python symbol-scraper.py --output data/symbols.json --pretty

    # Scrape specific batch for matrix builds
    python symbol-scraper.py --batch A-D --output data/symbols-batch1.json
    python symbol-scraper.py --batch E-L --output data/symbols-batch2.json
    python symbol-scraper.py --batch M-R --output data/symbols-batch3.json
    python symbol-scraper.py --batch S-Z --output data/symbols-batch4.json

    # Scrape single stock for testing
    python symbol-scraper.py --symbol AAPL --pretty

URL Pattern: https://www.slickcharts.com/symbol/{TICKER}

Created: 2026-01-10
Reference: docs/planning/slickcharts-data-pipeline.md
"""

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
    load_existing_history,
    prune_old_entries,
    build_cumulative_payload,
    write_cumulative_output,
    USER_AGENT,
    MAX_RETRIES,
    RATE_LIMIT_SECONDS,
)

# Cumulative mode: 52 weeks (1 year) history retention
DEFAULT_RETENTION_DAYS = 365

from bs4 import BeautifulSoup

# Constants
BASE_URL = "https://www.slickcharts.com/symbol"
SP500_JSON_PATH = Path(__file__).parent.parent.parent / "data/slickcharts/sp500.json"

# Batch definitions for matrix builds
BATCHES = {
    "A-D": lambda s: s[0].upper() <= 'D',
    "E-L": lambda s: 'E' <= s[0].upper() <= 'L',
    "M-R": lambda s: 'M' <= s[0].upper() <= 'R',
    "S-Z": lambda s: s[0].upper() >= 'S',
    "ALL": lambda s: True,
}


def load_sp500_tickers() -> List[str]:
    """
    Load S&P 500 ticker symbols from existing sp500.json.

    Returns:
        Sorted list of ticker symbols
    """
    if not SP500_JSON_PATH.exists():
        raise FileNotFoundError(
            f"SP500 data not found at {SP500_JSON_PATH}. "
            "Run sp500-scraper.py first."
        )

    data = json.loads(SP500_JSON_PATH.read_text(encoding="utf-8"))
    holdings = data.get("holdings", [])

    tickers = [h["symbol"] for h in holdings if "symbol" in h]
    return sorted(tickers)


def parse_symbol_page(html: str, symbol: str) -> Dict[str, Any]:
    """
    Parse individual stock page for valuation metrics.

    Extracts:
    - price, change, changePercent
    - pe_trailing, pe_forward
    - eps_trailing, eps_forward
    - dividend_yield, dividend_ttm
    - market_cap_billions

    Args:
        html: Raw HTML content
        symbol: Stock ticker symbol

    Returns:
        Dictionary with stock metrics
    """
    soup = BeautifulSoup(html, "html.parser")

    result: Dict[str, Any] = {
        "symbol": symbol,
        "company": None,
        "price": None,
        "change": None,
        "changePercent": None,
        "pe_trailing": None,
        "pe_forward": None,
        "eps_trailing": None,
        "eps_forward": None,
        "dividend_yield": None,
        "dividend_ttm": None,
        "market_cap_billions": None,
    }

    # Find company name from title or h1
    title = soup.find("title")
    if title:
        title_text = title.get_text(strip=True)
        # Pattern: "Company Name (TICKER) Stock"
        match = re.match(r"(.+?)\s*\(", title_text)
        if match:
            result["company"] = match.group(1).strip()

    # Primary method: Parse all table rows directly
    # SlickCharts uses a table with multiple td pairs per row:
    # Row: [Label1, Value1, Label2, Value2] (4 cells per row)
    def process_label_value(label: str, value: str) -> None:
        """Process a single label-value pair."""
        if not value or value == "-":
            return

        label_lower = label.lower()

        # P/E ratios
        if "p/e (trailing)" in label_lower or "trailing p/e" in label_lower:
            result["pe_trailing"] = to_float(value)
        elif "p/e (forward)" in label_lower or "forward p/e" in label_lower:
            result["pe_forward"] = to_float(value)
        # EPS
        elif "eps (trailing)" in label_lower or "trailing eps" in label_lower:
            result["eps_trailing"] = to_float(value)
        elif "eps (forward)" in label_lower or "forward eps" in label_lower:
            result["eps_forward"] = to_float(value)
        # Dividend
        elif "dividend yield" in label_lower:
            result["dividend_yield"] = to_float(value.replace('%', ''))
        elif "dividend (ttm)" in label_lower or "dividend ttm" in label_lower:
            result["dividend_ttm"] = to_float(value)
        # Market Cap
        elif "market cap" in label_lower:
            value_upper = value.upper()
            if 'T' in value_upper:
                result["market_cap_billions"] = to_float(value_upper.replace('T', '')) * 1000
            elif 'B' in value_upper:
                result["market_cap_billions"] = to_float(value_upper.replace('B', ''))
            else:
                result["market_cap_billions"] = to_float(value)
        # Price
        elif "price" in label_lower and result["price"] is None:
            result["price"] = to_float(value)

    for row in soup.find_all("tr"):
        cells = row.find_all("td")

        # Process pairs: (0,1), (2,3), (4,5), etc.
        for i in range(0, len(cells) - 1, 2):
            label = cells[i].get_text(strip=True)
            value = cells[i + 1].get_text(strip=True)
            process_label_value(label, value)

    # Fallback: Try to find price from prominent display
    if result["price"] is None:
        price_elem = soup.select_one(".quote-price, .current-price, [class*='price']")
        if price_elem:
            result["price"] = to_float(price_elem.get_text(strip=True))

    return result


def scrape_symbol(session, symbol: str) -> Tuple[Dict[str, Any], bool]:
    """
    Scrape a single stock symbol page.

    Args:
        session: requests.Session instance
        symbol: Stock ticker symbol

    Returns:
        Tuple of (stock_data, success_flag)
    """
    url = f"{BASE_URL}/{symbol}"

    try:
        html = fetch_html(session, url)
        data = parse_symbol_page(html, symbol)
        return data, True
    except Exception as e:
        return {
            "symbol": symbol,
            "error": str(e),
        }, False


def scrape_batch(
    tickers: List[str],
    batch_filter: str = "ALL",
    *,
    progress: bool = True,
) -> Tuple[List[Dict[str, Any]], int, int]:
    """
    Scrape a batch of tickers.

    Args:
        tickers: Full list of ticker symbols
        batch_filter: Batch key (A-D, E-L, M-R, S-Z, ALL)
        progress: Show progress output

    Returns:
        Tuple of (results, success_count, error_count)
    """
    filter_func = BATCHES.get(batch_filter.upper(), BATCHES["ALL"])
    filtered_tickers = [t for t in tickers if filter_func(t)]

    if progress:
        print(f"Scraping {len(filtered_tickers)} stocks (batch: {batch_filter})")

    session = create_session()
    results: List[Dict[str, Any]] = []
    success_count = 0
    error_count = 0

    for i, ticker in enumerate(filtered_tickers):
        if progress and (i + 1) % 10 == 0:
            print(f"  Progress: {i + 1}/{len(filtered_tickers)} ({ticker})")

        data, success = scrape_symbol(session, ticker)
        results.append(data)

        if success:
            success_count += 1
        else:
            error_count += 1

    return results, success_count, error_count


def merge_batch_files(
    batch_files: List[Path],
    output: Path,
    cumulative: bool = False,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> None:
    """
    Merge multiple batch JSON files into one.

    Args:
        batch_files: List of batch file paths
        output: Output file path for merged result
        cumulative: If True, append to existing history
        retention_days: Days to retain in history (only if cumulative)
    """
    all_stocks: List[Dict[str, Any]] = []

    for batch_file in batch_files:
        if not batch_file.exists():
            print(f"Warning: {batch_file} not found, skipping")
            continue

        data = json.loads(batch_file.read_text(encoding="utf-8"))
        stocks = data.get("stocks", [])
        all_stocks.extend(stocks)

    # Sort by symbol
    all_stocks.sort(key=lambda x: x.get("symbol", ""))

    if cumulative:
        # Cumulative mode: append to existing history
        existing_history = load_existing_history(output)
        payload = build_cumulative_payload(
            all_stocks,
            existing_history,
            source="slickcharts",
            data_key="stocks",
            retention_days=retention_days,
        )
        write_cumulative_output(payload, output, pretty=True)
        history_count = len(payload.get("history", []))
        print(f"Cumulative merge: {len(all_stocks)} stocks to {output} (history: {history_count} entries, retention: {retention_days} days)")
    else:
        # Standard merge (snapshot)
        payload = {
            "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "source": "slickcharts",
            "count": len(all_stocks),
            "stocks": all_stocks,
        }

        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        print(f"Merged {len(all_stocks)} stocks to {output}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape individual stock metrics from SlickCharts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Batch options for GitHub Actions Matrix:
  A-D    Stocks starting with A, B, C, D
  E-L    Stocks starting with E through L
  M-R    Stocks starting with M through R
  S-Z    Stocks starting with S through Z
  ALL    All stocks (default)

Examples:
  python symbol-scraper.py --batch A-D --output batch1.json
  python symbol-scraper.py --symbol AAPL --pretty
  python symbol-scraper.py --merge batch1.json batch2.json --output merged.json
        """
    )

    parser.add_argument(
        "--output", "-o",
        type=Path,
        help="Output JSON file path"
    )
    parser.add_argument(
        "--pretty", "-p",
        action="store_true",
        help="Pretty-print JSON output"
    )
    parser.add_argument(
        "--batch", "-b",
        choices=["A-D", "E-L", "M-R", "S-Z", "ALL"],
        default="ALL",
        help="Batch to scrape (default: ALL)"
    )
    parser.add_argument(
        "--symbol", "-s",
        help="Scrape single symbol (for testing)"
    )
    parser.add_argument(
        "--merge", "-m",
        nargs="+",
        type=Path,
        metavar="FILE",
        help="Merge multiple batch files into one"
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress progress output"
    )
    parser.add_argument(
        "--cumulative", "-c",
        action="store_true",
        help="Enable cumulative mode (append to 52-week history)"
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"Days to retain in history (default: {DEFAULT_RETENTION_DAYS})"
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    try:
        # Merge mode
        if args.merge:
            if not args.output:
                print("Error: --output required with --merge", file=sys.stderr)
                sys.exit(1)
            merge_batch_files(
                args.merge,
                args.output,
                cumulative=args.cumulative,
                retention_days=args.retention_days,
            )
            return

        # Single symbol mode
        if args.symbol:
            session = create_session()
            data, success = scrape_symbol(session, args.symbol.upper())

            if success:
                indent = 2 if args.pretty else None
                output = json.dumps(data, indent=indent, ensure_ascii=False)
                if args.output:
                    args.output.write_text(output, encoding="utf-8")
                    print(f"Saved {args.symbol} to {args.output}")
                else:
                    print(output)
            else:
                print(f"Error scraping {args.symbol}: {data.get('error')}", file=sys.stderr)
                sys.exit(1)
            return

        # Batch mode
        tickers = load_sp500_tickers()
        results, success, errors = scrape_batch(
            tickers,
            args.batch,
            progress=not args.quiet
        )

        # Cumulative mode: append to history
        if args.cumulative and args.output:
            existing_history = load_existing_history(args.output)
            payload = build_cumulative_payload(
                results,
                existing_history,
                source="slickcharts",
                data_key="stocks",
                retention_days=args.retention_days,
            )
            # Add batch info to latest entry
            if payload.get("history"):
                payload["history"][0]["batch"] = args.batch
                payload["history"][0]["success"] = success
                payload["history"][0]["errors"] = errors

            write_cumulative_output(payload, args.output, pretty=args.pretty)
            history_count = len(payload.get("history", []))
            print(f"Cumulative: {len(results)} stocks saved to {args.output} (history: {history_count} entries, retention: {args.retention_days} days)")
        else:
            # Build standard payload (non-cumulative)
            payload = {
                "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "source": "slickcharts",
                "batch": args.batch,
                "count": len(results),
                "success": success,
                "errors": errors,
                "stocks": results,
            }

            indent = 2 if args.pretty else None
            json_output = json.dumps(payload, indent=indent, ensure_ascii=False)

            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json_output, encoding="utf-8")
                print(f"Saved {len(results)} stocks to {args.output} (success: {success}, errors: {errors})")
            else:
                print(json_output)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
