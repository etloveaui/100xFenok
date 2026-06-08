#!/usr/bin/env python3
"""
Validate critical SlickCharts data integrity.

Checks the failure mode that previously hid stale/empty outputs:
  - index holdings are non-empty
  - universe.json matches current index holdings
  - membership-changes.json stores the current index state
  - aggregate stock history files are non-empty and count-consistent
  - critical files match the Next.js public mirror
  - obsolete source/100xFenok scraper paths are gone
"""
from __future__ import annotations

import argparse
import filecmp
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data" / "slickcharts"
PUBLIC_DATA_DIR = REPO_ROOT / "100xfenok-next" / "public" / "data" / "slickcharts"
INDEX_FILES = {
    "sp500": "sp500.json",
    "nasdaq100": "nasdaq100.json",
    "dowjones": "dowjones.json",
}
CRITICAL_MIRROR_FILES = (
    "membership-changes.json",
    "universe.json",
    "stocks-returns.json",
    "stocks-dividends.json",
    "stocks-dividends-recent.json",
    "stocks-dividends-historical.json",
)


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RuntimeError(f"Missing file: {path}") from None
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON at {path}: {exc}") from exc


def index_membership(data_dir: Path) -> dict[str, list[str]]:
    membership: dict[str, list[str]] = {}
    for index_name, filename in INDEX_FILES.items():
        path = data_dir / filename
        payload = load_json(path)
        holdings = payload.get("holdings")
        if not isinstance(holdings, list) or not holdings:
            raise RuntimeError(f"{filename} has empty holdings")
        for holding in holdings:
            symbol = str(holding.get("symbol", "")).strip().upper()
            if symbol:
                membership.setdefault(symbol, []).append(index_name)
    return {symbol: sorted(indices) for symbol, indices in sorted(membership.items())}


def assert_universe(data_dir: Path, current: dict[str, list[str]]) -> list[str]:
    payload = load_json(data_dir / "universe.json")
    stocks = payload.get("stocks")
    if not isinstance(stocks, list) or not stocks:
        raise RuntimeError("universe.json stocks is empty")

    actual = {
        str(stock.get("symbol", "")).strip().upper(): sorted(stock.get("indices", []))
        for stock in stocks
        if stock.get("symbol")
    }
    if actual != current:
        added = sorted(set(current) - set(actual))
        removed = sorted(set(actual) - set(current))
        changed = sorted(symbol for symbol in set(current) & set(actual) if current[symbol] != actual[symbol])
        raise RuntimeError(
            "universe.json does not match current index holdings "
            f"(missing={added[:10]}, stale={removed[:10]}, changed={changed[:10]})"
        )
    if payload.get("uniqueCount") != len(current):
        raise RuntimeError(f"universe uniqueCount mismatch: {payload.get('uniqueCount')} vs {len(current)}")
    return sorted(actual)


def assert_membership_history(data_dir: Path, current: dict[str, list[str]]) -> None:
    payload = load_json(data_dir / "membership-changes.json")
    indices = payload.get("indices")
    if not isinstance(indices, dict) or not indices:
        raise RuntimeError("membership-changes.json indices is empty")

    expected_by_index: dict[str, list[str]] = {name: [] for name in INDEX_FILES}
    for symbol, memberships in current.items():
        for index_name in memberships:
            expected_by_index[index_name].append(symbol)

    for index_name, expected in expected_by_index.items():
        saved = indices.get(index_name, {})
        tickers = sorted(saved.get("tickers", []))
        expected = sorted(expected)
        if tickers != expected:
            raise RuntimeError(f"membership state mismatch for {index_name}")
        if saved.get("count") != len(expected):
            raise RuntimeError(f"membership count mismatch for {index_name}: {saved.get('count')} vs {len(expected)}")


def assert_stock_files(data_dir: Path, symbols: list[str]) -> list[str]:
    stocks_dir = data_dir / "stocks"
    missing = [symbol for symbol in symbols if not (stocks_dir / f"{symbol}.json").exists()]
    if missing:
        raise RuntimeError("Missing stock detail files: " + ", ".join(missing))
    all_files = sorted(path.stem.upper() for path in stocks_dir.glob("*.json"))
    return sorted(set(all_files) - set(symbols))


def assert_aggregate(data_dir: Path, filename: str, symbols: list[str], *, exact_symbols: bool = True) -> None:
    payload = load_json(data_dir / filename)
    stocks = payload.get("stocks")
    if not isinstance(stocks, list) or not stocks:
        raise RuntimeError(f"{filename} stocks is empty")
    if payload.get("count") is not None and payload.get("count") != len(stocks):
        raise RuntimeError(f"{filename} count mismatch: {payload.get('count')} vs {len(stocks)}")
    if exact_symbols:
        actual = sorted(str(stock.get("symbol", "")).strip().upper() for stock in stocks if stock.get("symbol"))
        if actual != symbols:
            missing = sorted(set(symbols) - set(actual))
            extra = sorted(set(actual) - set(symbols))
            raise RuntimeError(f"{filename} symbols mismatch: missing={missing[:10]}, extra={extra[:10]}")


def assert_public_mirror(data_dir: Path, public_dir: Path, symbols: list[str]) -> None:
    for filename in CRITICAL_MIRROR_FILES:
        source = data_dir / filename
        public = public_dir / filename
        if not public.exists():
            raise RuntimeError(f"Public mirror missing {filename}")
        if not filecmp.cmp(source, public, shallow=False):
            raise RuntimeError(f"Public mirror drift: {filename}")

    for symbol in symbols:
        source = data_dir / "stocks" / f"{symbol}.json"
        public = public_dir / "stocks" / f"{symbol}.json"
        if not public.exists():
            raise RuntimeError(f"Public stock mirror missing {symbol}.json")
        if not filecmp.cmp(source, public, shallow=False):
            raise RuntimeError(f"Public stock mirror drift: {symbol}.json")


def assert_no_obsolete_paths() -> None:
    result = subprocess.run(
        [
            "rg",
            "-n",
            "source/100xFenok/data/slickcharts",
            "scripts/scrapers",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        raise RuntimeError("Obsolete scraper paths remain:\n" + result.stdout)
    if result.returncode not in (0, 1):
        raise RuntimeError("Failed to scan scraper paths: " + result.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate SlickCharts data integrity.")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DATA_DIR)
    parser.add_argument("--skip-public", action="store_true")
    parser.add_argument("--warn-extra-stock-files", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    current = index_membership(args.data_dir)
    symbols = assert_universe(args.data_dir, current)
    assert_membership_history(args.data_dir, current)
    extras = assert_stock_files(args.data_dir, symbols)
    assert_aggregate(args.data_dir, "stocks-returns.json", symbols)
    assert_aggregate(args.data_dir, "stocks-dividends.json", symbols)
    assert_aggregate(args.data_dir, "stocks-dividends-recent.json", symbols, exact_symbols=False)
    assert_aggregate(args.data_dir, "stocks-dividends-historical.json", symbols, exact_symbols=False)
    assert_no_obsolete_paths()
    if not args.skip_public:
        assert_public_mirror(args.data_dir, args.public_dir, symbols)

    print(
        "SlickCharts integrity OK: "
        f"universe={len(symbols)}, extra_stock_files={len(extras)}"
    )
    if extras and args.warn_extra_stock_files:
        print("Extra stock files not referenced by current universe: " + ", ".join(extras))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
