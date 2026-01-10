#!/usr/bin/env python3
"""
Stock Data Aggregator for SlickCharts

Combines data from multiple scrapers into individual stock JSON files.
Preserves history: 52-week metrics history + permanent returns/dividends.

Usage:
    # Aggregate all data into individual stock files
    python stock-aggregator.py \
        --metrics data/symbols.json \
        --returns data/returns.json \
        --dividends data/dividends.json \
        --output-dir data/slickcharts/stocks/

    # Single stock aggregation for testing
    python stock-aggregator.py \
        --symbol AAPL \
        --metrics data/symbols.json \
        --returns data/returns.json \
        --dividends data/dividends.json \
        --output-dir data/slickcharts/stocks/

Output Structure (per stock):
    stocks/AAPL.json:
    {
        "symbol": "AAPL",
        "company": "Apple Inc.",
        "updated": "2026-01-10T08:00:00+00:00",
        "current": {
            "price": 258.63,
            "pe_trailing": 34.73,
            "pe_forward": 28.35,
            "eps_trailing": 7.45,
            "eps_forward": 9.12,
            "dividend_yield": 0.45,
            "dividend_ttm": 1.16,
            "market_cap_billions": 3890.5
        },
        "metrics_history": [
            {"date": "2026-01-10", "pe_trailing": 34.73, ...},
            {"date": "2026-01-03", "pe_trailing": 33.50, ...}
        ],
        "returns": [
            {"year": 2026, "return": 12.5},
            {"year": 2025, "return": 30.8}
        ],
        "dividends": [
            {"exDate": "2026-01-05", "payDate": "2026-01-15", "amount": 0.25}
        ]
    }

Created: 2026-01-10
Reference: docs/planning/slickcharts-data-pipeline.md
"""

import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Constants
DEFAULT_RETENTION_DAYS = 365  # 52 weeks
DIVIDEND_SPLIT_YEARS = 5  # Split threshold for dividend files
METRICS_FIELDS = [
    "price", "pe_trailing", "pe_forward",
    "eps_trailing", "eps_forward",
    "dividend_yield", "dividend_ttm",
    "market_cap_billions"
]


def get_utc_timestamp() -> str:
    """Get current UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json_file(path: Path) -> Dict[str, Any]:
    """Load JSON file safely."""
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Warning: Failed to load {path}: {e}", file=sys.stderr)
        return {}


def load_metrics_by_symbol(metrics_file: Path) -> Dict[str, Dict]:
    """Load metrics data indexed by symbol."""
    data = load_json_file(metrics_file)
    result = {}

    # Handle single-symbol format (direct object with "symbol" key)
    if "symbol" in data and "stocks" not in data:
        symbol = data.get("symbol")
        if symbol:
            result[symbol] = data
        return result

    # Handle both cumulative and non-cumulative batch formats
    stocks = []
    if "stocks" in data:
        stocks = data["stocks"]
    elif "history" in data and data["history"]:
        # Cumulative format: get latest entry
        stocks = data["history"][0].get("stocks", [])

    for stock in stocks:
        symbol = stock.get("symbol")
        if symbol:
            result[symbol] = stock

    return result


def load_returns_by_symbol(returns_file: Path) -> Dict[str, List]:
    """Load returns data indexed by symbol."""
    data = load_json_file(returns_file)
    result = {}

    # Handle single-symbol format
    if "symbol" in data and "returns" in data and "stocks" not in data:
        symbol = data.get("symbol")
        if symbol:
            result[symbol] = data.get("returns", [])
        return result

    # Handle batch format
    stocks = data.get("stocks", [])
    for stock in stocks:
        symbol = stock.get("symbol")
        if symbol:
            result[symbol] = stock.get("returns", [])

    return result


def load_dividends_by_symbol(dividends_file: Path) -> Dict[str, List]:
    """Load dividends data indexed by symbol."""
    data = load_json_file(dividends_file)
    result = {}

    # Handle single-symbol format
    if "symbol" in data and "dividends" in data and "stocks" not in data:
        symbol = data.get("symbol")
        if symbol:
            result[symbol] = data.get("dividends", [])
        return result

    # Handle batch format
    stocks = data.get("stocks", [])
    for stock in stocks:
        symbol = stock.get("symbol")
        if symbol:
            result[symbol] = stock.get("dividends", [])

    return result


def load_existing_stock(stock_file: Path) -> Dict[str, Any]:
    """Load existing individual stock file."""
    return load_json_file(stock_file)


def prune_metrics_history(
    history: List[Dict],
    retention_days: int
) -> List[Dict]:
    """Remove metrics entries older than retention period."""
    if not history:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cutoff_str = cutoff.strftime("%Y-%m-%d")

    return [
        entry for entry in history
        if entry.get("date", "") >= cutoff_str
    ]


def merge_metrics_history(
    existing_history: List[Dict],
    new_metrics: Dict,
    retention_days: int
) -> List[Dict]:
    """Merge new metrics into history, avoiding duplicates."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Create new entry from current metrics
    new_entry = {"date": today}
    for field in METRICS_FIELDS:
        if field in new_metrics:
            new_entry[field] = new_metrics[field]

    # Check if today's entry already exists
    existing_dates = {e.get("date") for e in existing_history}

    if today in existing_dates:
        # Update existing entry for today
        history = [
            new_entry if e.get("date") == today else e
            for e in existing_history
        ]
    else:
        # Add new entry at the beginning
        history = [new_entry] + existing_history

    # Sort by date descending and prune old entries
    history.sort(key=lambda x: x.get("date", ""), reverse=True)
    return prune_metrics_history(history, retention_days)


def merge_returns(existing: List[Dict], new: List[Dict]) -> List[Dict]:
    """Merge returns data, keeping all unique years."""
    if not new:
        return existing
    if not existing:
        return new

    # Index by year
    by_year = {r.get("year"): r for r in existing}
    for r in new:
        year = r.get("year")
        if year:
            by_year[year] = r  # Update with new data

    # Sort by year descending
    result = list(by_year.values())
    result.sort(key=lambda x: x.get("year", 0), reverse=True)
    return result


def merge_dividends(existing: List[Dict], new: List[Dict]) -> List[Dict]:
    """Merge dividends data, keeping all unique ex-dates."""
    if not new:
        return existing
    if not existing:
        return new

    # Index by exDate
    by_date = {d.get("exDate"): d for d in existing}
    for d in new:
        ex_date = d.get("exDate")
        if ex_date:
            by_date[ex_date] = d  # Update with new data

    # Sort by exDate descending
    result = list(by_date.values())
    result.sort(key=lambda x: x.get("exDate", ""), reverse=True)
    return result


def aggregate_stock(
    symbol: str,
    metrics: Dict,
    returns: List,
    dividends: List,
    existing: Dict,
    retention_days: int
) -> Dict[str, Any]:
    """
    Aggregate all data for a single stock.

    Args:
        symbol: Stock ticker symbol
        metrics: Current metrics from symbol-scraper.py
        returns: Returns history from symbol-returns-scraper.py
        dividends: Dividends history from symbol-dividend-scraper.py
        existing: Existing stock data (for history preservation)
        retention_days: Days to retain in metrics_history

    Returns:
        Aggregated stock data dictionary
    """
    # Build current metrics
    current = {}
    for field in METRICS_FIELDS:
        if field in metrics:
            current[field] = metrics[field]

    # Merge metrics history
    existing_history = existing.get("metrics_history", [])
    metrics_history = merge_metrics_history(
        existing_history, metrics, retention_days
    )

    # Merge returns (permanent)
    existing_returns = existing.get("returns", [])
    merged_returns = merge_returns(existing_returns, returns)

    # Merge dividends (permanent)
    existing_dividends = existing.get("dividends", [])
    merged_dividends = merge_dividends(existing_dividends, dividends)

    return {
        "symbol": symbol,
        "company": metrics.get("company"),
        "updated": get_utc_timestamp(),
        "current": current,
        "metrics_history": metrics_history,
        "returns": merged_returns,
        "dividends": merged_dividends,
    }


def get_all_symbols(
    metrics: Dict[str, Dict],
    returns: Dict[str, List],
    dividends: Dict[str, List]
) -> List[str]:
    """Get union of all symbols from all data sources."""
    symbols = set()
    symbols.update(metrics.keys())
    symbols.update(returns.keys())
    symbols.update(dividends.keys())
    return sorted(symbols)


def split_dividends_by_age(
    dividends_data: Dict[str, List],
    split_years: int = DIVIDEND_SPLIT_YEARS
) -> tuple:
    """
    Split dividends data into recent and historical.

    Args:
        dividends_data: Dict mapping symbol to list of dividends
        split_years: Number of years to consider as "recent"

    Returns:
        Tuple of (recent_data, historical_data)
    """
    cutoff_year = datetime.now().year - split_years
    cutoff_date = f"{cutoff_year}-01-01"

    recent = {}
    historical = {}

    for symbol, divs in dividends_data.items():
        recent_divs = []
        historical_divs = []

        for div in divs:
            ex_date = div.get("exDate", "")
            if ex_date >= cutoff_date:
                recent_divs.append(div)
            else:
                historical_divs.append(div)

        if recent_divs:
            recent[symbol] = recent_divs
        if historical_divs:
            historical[symbol] = historical_divs

    return recent, historical


def export_split_dividends(
    dividends_data: Dict[str, List],
    output_dir: Path,
    split_years: int = DIVIDEND_SPLIT_YEARS,
    pretty: bool = False
) -> tuple:
    """
    Export dividends as split files (recent + historical).

    Args:
        dividends_data: Dict mapping symbol to list of dividends
        output_dir: Directory to write split files
        split_years: Number of years to consider as "recent"
        pretty: Pretty-print JSON output

    Returns:
        Tuple of (recent_file_path, historical_file_path, stats)
    """
    recent, historical = split_dividends_by_age(dividends_data, split_years)

    indent = 2 if pretty else None
    timestamp = get_utc_timestamp()

    # Count total dividends
    recent_count = sum(len(divs) for divs in recent.values())
    historical_count = sum(len(divs) for divs in historical.values())

    # Build output structures
    recent_output = {
        "updated": timestamp,
        "split_type": "recent",
        "years_included": f"last {split_years} years",
        "stocks": [
            {"symbol": sym, "dividends": divs}
            for sym, divs in sorted(recent.items())
        ]
    }

    historical_output = {
        "updated": timestamp,
        "split_type": "historical",
        "years_included": f"older than {split_years} years",
        "stocks": [
            {"symbol": sym, "dividends": divs}
            for sym, divs in sorted(historical.items())
        ]
    }

    # Write files
    recent_file = output_dir / "stocks-dividends-recent.json"
    historical_file = output_dir / "stocks-dividends-historical.json"

    recent_file.write_text(
        json.dumps(recent_output, indent=indent, ensure_ascii=False),
        encoding="utf-8"
    )
    historical_file.write_text(
        json.dumps(historical_output, indent=indent, ensure_ascii=False),
        encoding="utf-8"
    )

    stats = {
        "recent_stocks": len(recent),
        "recent_dividends": recent_count,
        "historical_stocks": len(historical),
        "historical_dividends": historical_count,
    }

    return recent_file, historical_file, stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aggregate stock data into individual JSON files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python stock-aggregator.py --metrics symbols.json --returns returns.json \\
        --dividends dividends.json --output-dir stocks/

    python stock-aggregator.py --symbol AAPL --metrics symbols.json \\
        --output-dir stocks/ --pretty
        """
    )

    parser.add_argument(
        "--metrics", "-m",
        type=Path,
        help="Metrics JSON file from symbol-scraper.py"
    )
    parser.add_argument(
        "--returns", "-r",
        type=Path,
        help="Returns JSON file from symbol-returns-scraper.py"
    )
    parser.add_argument(
        "--dividends", "-d",
        type=Path,
        help="Dividends JSON file from symbol-dividend-scraper.py"
    )
    parser.add_argument(
        "--output-dir", "-o",
        type=Path,
        required=True,
        help="Output directory for individual stock files"
    )
    parser.add_argument(
        "--symbol", "-s",
        help="Process single symbol only (for testing)"
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"Days to retain in metrics_history (default: {DEFAULT_RETENTION_DAYS})"
    )
    parser.add_argument(
        "--pretty", "-p",
        action="store_true",
        help="Pretty-print JSON output"
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress progress output"
    )
    parser.add_argument(
        "--split-dividends",
        type=Path,
        help="Export split dividend files (recent/historical) to this directory"
    )
    parser.add_argument(
        "--split-years",
        type=int,
        default=DIVIDEND_SPLIT_YEARS,
        help=f"Years threshold for recent/historical split (default: {DIVIDEND_SPLIT_YEARS})"
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Load all data sources
    metrics_data = {}
    returns_data = {}
    dividends_data = {}

    if args.metrics:
        metrics_data = load_metrics_by_symbol(args.metrics)
        if not args.quiet:
            print(f"Loaded {len(metrics_data)} stocks from metrics")

    if args.returns:
        returns_data = load_returns_by_symbol(args.returns)
        if not args.quiet:
            print(f"Loaded {len(returns_data)} stocks from returns")

    if args.dividends:
        dividends_data = load_dividends_by_symbol(args.dividends)
        if not args.quiet:
            print(f"Loaded {len(dividends_data)} stocks from dividends")

    # Determine symbols to process
    if args.symbol:
        symbols = [args.symbol.upper()]
    else:
        symbols = get_all_symbols(metrics_data, returns_data, dividends_data)

    if not args.quiet:
        print(f"Processing {len(symbols)} stocks...")

    # Process each symbol
    success_count = 0
    error_count = 0

    for i, symbol in enumerate(symbols):
        if not args.quiet and (i + 1) % 50 == 0:
            print(f"  Progress: {i + 1}/{len(symbols)}")

        try:
            stock_file = args.output_dir / f"{symbol}.json"
            existing = load_existing_stock(stock_file)

            aggregated = aggregate_stock(
                symbol=symbol,
                metrics=metrics_data.get(symbol, {}),
                returns=returns_data.get(symbol, []),
                dividends=dividends_data.get(symbol, []),
                existing=existing,
                retention_days=args.retention_days,
            )

            # Write individual stock file
            indent = 2 if args.pretty else None
            stock_file.write_text(
                json.dumps(aggregated, indent=indent, ensure_ascii=False),
                encoding="utf-8"
            )
            success_count += 1

        except Exception as e:
            print(f"Error processing {symbol}: {e}", file=sys.stderr)
            error_count += 1

    if not args.quiet:
        print(f"\nComplete: {success_count} stocks saved to {args.output_dir}")
        if error_count:
            print(f"Errors: {error_count}")

    # Export split dividend files if requested
    if args.split_dividends and dividends_data:
        args.split_dividends.mkdir(parents=True, exist_ok=True)
        recent_file, historical_file, stats = export_split_dividends(
            dividends_data=dividends_data,
            output_dir=args.split_dividends,
            split_years=args.split_years,
            pretty=args.pretty
        )
        if not args.quiet:
            print(f"\nDividend split complete:")
            print(f"  Recent ({args.split_years}yr): {stats['recent_stocks']} stocks, "
                  f"{stats['recent_dividends']} dividends -> {recent_file}")
            print(f"  Historical: {stats['historical_stocks']} stocks, "
                  f"{stats['historical_dividends']} dividends -> {historical_file}")


if __name__ == "__main__":
    main()
