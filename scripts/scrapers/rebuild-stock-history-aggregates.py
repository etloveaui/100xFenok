#!/usr/bin/env python3
"""
Rebuild SlickCharts stock history aggregate files from individual stock JSON.

This is a local recovery/maintenance tool. It does not scrape the network.
It reads data/slickcharts/stocks/{SYMBOL}.json and writes:
  - data/slickcharts/stocks-returns.json
  - data/slickcharts/stocks-dividends.json
  - data/slickcharts/stocks-dividends-recent.json
  - data/slickcharts/stocks-dividends-historical.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data" / "slickcharts"
STOCKS_DIR = DATA_DIR / "stocks"
UNIVERSE_FILE = DATA_DIR / "universe.json"
DEFAULT_SPLIT_YEARS = 5


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise FileNotFoundError(f"Required file not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON at {path}: {exc}") from exc


def load_universe_symbols(path: Path) -> list[str]:
    payload = load_json(path)
    stocks = payload.get("stocks")
    if not isinstance(stocks, list) or not stocks:
        raise RuntimeError(f"Universe has no stocks: {path}")
    symbols = sorted({str(stock.get("symbol", "")).strip().upper() for stock in stocks if stock.get("symbol")})
    if not symbols:
        raise RuntimeError(f"Universe has no usable symbols: {path}")
    return symbols


def all_stock_symbols(stocks_dir: Path) -> list[str]:
    return sorted(path.stem.upper() for path in stocks_dir.glob("*.json"))


def dividend_split(dividends: list[dict[str, Any]], split_years: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cutoff_year = datetime.now(timezone.utc).year - split_years
    cutoff = f"{cutoff_year}-01-01"
    recent = []
    historical = []
    for dividend in dividends:
        ex_date = str(dividend.get("exDate", ""))
        if ex_date >= cutoff:
            recent.append(dividend)
        else:
            historical.append(dividend)
    return recent, historical


def write_payload(path: Path, payload: dict[str, Any], pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2 if pretty else None, ensure_ascii=False),
        encoding="utf-8",
    )
    if pretty:
        path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")


def build_records(
    symbols: list[str],
    stocks_dir: Path,
    *,
    allow_missing: bool,
    split_years: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    returns_records: list[dict[str, Any]] = []
    dividend_records: list[dict[str, Any]] = []
    recent_records: list[dict[str, Any]] = []
    historical_records: list[dict[str, Any]] = []
    missing: list[str] = []

    for symbol in symbols:
        stock_file = stocks_dir / f"{symbol}.json"
        if not stock_file.exists():
            missing.append(symbol)
            continue

        stock = load_json(stock_file)
        returns = stock.get("returns", [])
        dividends = stock.get("dividends", [])
        if not isinstance(returns, list):
            raise RuntimeError(f"{stock_file} returns is not an array")
        if not isinstance(dividends, list):
            raise RuntimeError(f"{stock_file} dividends is not an array")

        returns_records.append({"symbol": symbol, "returns": returns})
        dividend_records.append({"symbol": symbol, "dividends": dividends})

        recent, historical = dividend_split(dividends, split_years)
        if recent:
            recent_records.append({"symbol": symbol, "dividends": recent})
        if historical:
            historical_records.append({"symbol": symbol, "dividends": historical})

    if missing and not allow_missing:
        raise RuntimeError("Missing stock detail files: " + ", ".join(missing))

    return returns_records, dividend_records, recent_records, historical_records, missing


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild SlickCharts aggregate stock history files.")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--stocks-dir", type=Path)
    parser.add_argument("--universe", type=Path)
    parser.add_argument("--all-stock-files", action="store_true", help="Use every stocks/*.json file instead of universe symbols.")
    parser.add_argument("--allow-missing", action="store_true", help="Write aggregates even when universe stock files are missing.")
    parser.add_argument("--split-years", type=int, default=DEFAULT_SPLIT_YEARS)
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data_dir = args.data_dir
    stocks_dir = args.stocks_dir or data_dir / "stocks"
    universe_file = args.universe or data_dir / "universe.json"

    if args.all_stock_files:
        symbols = all_stock_symbols(stocks_dir)
    else:
        symbols = load_universe_symbols(universe_file)
    if not symbols:
        raise RuntimeError("No stock symbols selected")

    returns, dividends, recent, historical, missing = build_records(
        symbols,
        stocks_dir,
        allow_missing=args.allow_missing,
        split_years=args.split_years,
    )

    timestamp = utc_timestamp()
    outputs = {
        "stocks-returns.json": {
            "updated": timestamp,
            "source": "slickcharts",
            "count": len(returns),
            "stocks": returns,
        },
        "stocks-dividends.json": {
            "updated": timestamp,
            "source": "slickcharts",
            "count": len(dividends),
            "stocks": dividends,
        },
        "stocks-dividends-recent.json": {
            "updated": timestamp,
            "source": "slickcharts",
            "split_type": "recent",
            "years_included": f"last {args.split_years} years",
            "count": len(recent),
            "stocks": recent,
        },
        "stocks-dividends-historical.json": {
            "updated": timestamp,
            "source": "slickcharts",
            "split_type": "historical",
            "years_included": f"older than {args.split_years} years",
            "count": len(historical),
            "stocks": historical,
        },
    }

    for filename, payload in outputs.items():
        write_payload(data_dir / filename, payload, pretty=args.pretty)

    print(
        "Rebuilt SlickCharts aggregates: "
        f"returns={len(returns)}, dividends={len(dividends)}, "
        f"recent={len(recent)}, historical={len(historical)}, missing={len(missing)}"
    )
    if missing:
        print("Missing stock detail files: " + ", ".join(missing), file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
