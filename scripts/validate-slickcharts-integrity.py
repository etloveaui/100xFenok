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
    "currency.json",
    "membership-changes.json",
    "universe.json",
    "stocks-returns.json",
    "stocks-dividends.json",
    "stocks-dividends-recent.json",
    "stocks-dividends-historical.json",
)
MOJIBAKE_MARKERS = ("Â", "Ã", "â", "å", "ä", "ç", "�")


def has_mojibake(value: object) -> bool:
    text = str(value)
    return any(marker in text for marker in MOJIBAKE_MARKERS) or any(
        "\u0080" <= char <= "\u009f" for char in text
    )


def reject_non_finite_number(token: str) -> None:
    raise ValueError(f"non-finite numeric constant {token}")


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=reject_non_finite_number,
        )
    except FileNotFoundError:
        raise RuntimeError(f"Missing file: {path}") from None
    except (json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(f"Invalid JSON at {path}: {exc}") from exc


def optional_json(path: Path, warnings: list[str], label: str) -> dict[str, Any] | None:
    if not path.exists():
        warnings.append(f"{label} is unavailable")
        return None
    return load_json(path)


def index_membership(data_dir: Path, warnings: list[str]) -> tuple[dict[str, list[str]], set[str]]:
    membership: dict[str, list[str]] = {}
    available_indices: set[str] = set()
    for index_name, filename in INDEX_FILES.items():
        path = data_dir / filename
        payload = optional_json(path, warnings, filename)
        if payload is None:
            continue
        holdings = payload.get("holdings")
        if not isinstance(holdings, list):
            raise RuntimeError(f"{filename} holdings must be an array")
        if payload.get("count") != len(holdings):
            raise RuntimeError(f"{filename} count mismatch: {payload.get('count')} vs {len(holdings)}")
        if not holdings:
            warnings.append(f"{filename} has no holdings")
            continue
        symbols = [str(holding.get("symbol", "")).strip().upper() for holding in holdings if isinstance(holding, dict)]
        if len(symbols) != len(holdings) or any(not symbol for symbol in symbols):
            raise RuntimeError(f"{filename} contains a malformed holding or missing ticker identity")
        if len(set(symbols)) != len(symbols):
            raise RuntimeError(f"{filename} contains duplicate ticker identities")
        available_indices.add(index_name)
        for symbol in symbols:
            membership.setdefault(symbol, []).append(index_name)
    return (
        {symbol: sorted(indices) for symbol, indices in sorted(membership.items())},
        available_indices,
    )


def assert_universe(
    data_dir: Path,
    current: dict[str, list[str]],
    membership_complete: bool,
    warnings: list[str],
) -> list[str]:
    payload = optional_json(data_dir / "universe.json", warnings, "universe.json")
    if payload is None:
        return []
    stocks = payload.get("stocks")
    if not isinstance(stocks, list):
        raise RuntimeError("universe.json stocks must be an array")
    if not stocks:
        if payload.get("uniqueCount") != 0:
            raise RuntimeError(f"universe uniqueCount mismatch: {payload.get('uniqueCount')} vs 0")
        warnings.append("universe.json stocks is empty")
        return []

    actual = {
        str(stock.get("symbol", "")).strip().upper(): sorted(stock.get("indices", []))
        for stock in stocks
        if stock.get("symbol")
    }
    if len(actual) != len(stocks):
        raise RuntimeError(f"universe identity/count mismatch: rows={len(stocks)} unique_symbols={len(actual)}")
    if membership_complete and actual != current:
        added = sorted(set(current) - set(actual))
        removed = sorted(set(actual) - set(current))
        changed = sorted(symbol for symbol in set(current) & set(actual) if current[symbol] != actual[symbol])
        raise RuntimeError(
            "universe.json does not match current index holdings "
            f"(missing={added[:10]}, stale={removed[:10]}, changed={changed[:10]})"
        )
    if not membership_complete:
        warnings.append("universe cross-index reconciliation skipped because one or more index lanes are unavailable")
    if payload.get("uniqueCount") != len(actual):
        raise RuntimeError(f"universe uniqueCount mismatch: {payload.get('uniqueCount')} vs {len(actual)}")
    return sorted(actual)


def assert_membership_history(
    data_dir: Path,
    current: dict[str, list[str]],
    available_indices: set[str],
    warnings: list[str],
) -> None:
    payload = optional_json(data_dir / "membership-changes.json", warnings, "membership-changes.json")
    if payload is None:
        return
    indices = payload.get("indices")
    if not isinstance(indices, dict):
        raise RuntimeError("membership-changes.json indices must be an object")
    if not indices:
        warnings.append("membership-changes.json indices is empty")
        return

    expected_by_index: dict[str, list[str]] = {name: [] for name in INDEX_FILES}
    for symbol, memberships in current.items():
        for index_name in memberships:
            expected_by_index[index_name].append(symbol)

    for index_name, saved in indices.items():
        tickers = sorted(saved.get("tickers", [])) if isinstance(saved, dict) else []
        if not isinstance(saved, dict) or saved.get("count") != len(tickers):
            raise RuntimeError(f"membership count mismatch for {index_name}: {saved.get('count') if isinstance(saved, dict) else None} vs {len(tickers)}")
        if any(not isinstance(ticker, str) or not ticker.strip() for ticker in tickers):
            raise RuntimeError(f"membership state contains a missing ticker identity for {index_name}")
        if len(set(tickers)) != len(tickers):
            raise RuntimeError(f"membership state contains duplicate ticker identities for {index_name}")

    for index_name in available_indices:
        expected = expected_by_index[index_name]
        saved = indices.get(index_name, {})
        tickers = sorted(saved.get("tickers", []))
        expected = sorted(expected)
        if tickers != expected:
            raise RuntimeError(f"membership state mismatch for {index_name}")
    if len(available_indices) != len(INDEX_FILES):
        warnings.append("membership reconciliation is partial because one or more index lanes are unavailable")


def assert_stock_files(data_dir: Path, symbols: list[str], warnings: list[str]) -> list[str]:
    stocks_dir = data_dir / "stocks"
    missing = [symbol for symbol in symbols if not (stocks_dir / f"{symbol}.json").exists()]
    if missing:
        warnings.append(f"Missing stock detail files ({len(missing)}): " + ", ".join(missing[:20]))
    empty_metric_rows: list[str] = []
    for symbol in (symbol for symbol in symbols if symbol not in set(missing)):
        payload = load_json(stocks_dir / f"{symbol}.json")
        if str(payload.get("symbol", "")).strip().upper() != symbol:
            raise RuntimeError(f"stock detail identity mismatch: {symbol}.json declares {payload.get('symbol')}")
        for row in payload.get("metrics_history", []) or []:
            if isinstance(row, dict) and row.get("date") and len(row.keys()) == 1:
                empty_metric_rows.append(f"{symbol}:{row.get('date')}")
                break
    if empty_metric_rows:
        warnings.append(f"Date-only metrics_history rows ({len(empty_metric_rows)}): " + ", ".join(empty_metric_rows[:20]))
    all_files = sorted(path.stem.upper() for path in stocks_dir.glob("*.json"))
    return sorted(set(all_files) - set(symbols))


def assert_currency(data_dir: Path, warnings: list[str]) -> None:
    payload = optional_json(data_dir / "currency.json", warnings, "currency.json")
    if payload is None:
        return
    history = payload.get("history")
    if not isinstance(history, list):
        raise RuntimeError("currency.json history must be an array")
    if not history:
        warnings.append("currency.json history is empty")
        return
    latest = history[0]
    if not isinstance(latest, dict):
        raise RuntimeError("currency.json latest history row must be an object")
    if (latest.get("totalMarketCap") or 0) <= 0:
        warnings.append("currency.json latest totalMarketCap is unavailable")
    bad_names = [
        currency.get("name", "")
        for entry in history
        if isinstance(entry, dict)
        for currency in entry.get("currencies", []) or []
        if isinstance(currency, dict)
        if has_mojibake(currency.get("name", ""))
    ]
    if bad_names:
        raise RuntimeError("currency.json mojibake names: " + ", ".join(map(str, bad_names[:10])))


def assert_aggregate(
    data_dir: Path,
    filename: str,
    symbols: list[str],
    warnings: list[str],
    *,
    exact_symbols: bool = True,
    membership_complete: bool = True,
) -> None:
    payload = optional_json(data_dir / filename, warnings, filename)
    if payload is None:
        return
    stocks = payload.get("stocks")
    if not isinstance(stocks, list):
        raise RuntimeError(f"{filename} stocks must be an array")
    if payload.get("count") is not None and payload.get("count") != len(stocks):
        raise RuntimeError(f"{filename} count mismatch: {payload.get('count')} vs {len(stocks)}")
    if not stocks:
        warnings.append(f"{filename} stocks is empty")
        return
    actual = [str(stock.get("symbol", "")).strip().upper() for stock in stocks if isinstance(stock, dict)]
    if len(actual) != len(stocks) or any(not symbol for symbol in actual):
        raise RuntimeError(f"{filename} contains a malformed row or missing ticker identity")
    if len(set(actual)) != len(actual):
        raise RuntimeError(f"{filename} contains duplicate ticker identities")
    if exact_symbols and membership_complete:
        sorted_actual = sorted(actual)
        if sorted_actual != symbols:
            missing = sorted(set(symbols) - set(sorted_actual))
            extra = sorted(set(sorted_actual) - set(symbols))
            raise RuntimeError(f"{filename} symbols mismatch: missing={missing[:10]}, extra={extra[:10]}")
    elif exact_symbols:
        warnings.append(f"{filename} universe reconciliation skipped because index membership is partial")


def assert_public_mirror(data_dir: Path, public_dir: Path, symbols: list[str], warnings: list[str]) -> None:
    for filename in CRITICAL_MIRROR_FILES:
        source = data_dir / filename
        public = public_dir / filename
        if not source.exists() and not public.exists():
            warnings.append(f"Source and public mirror are both unavailable: {filename}")
            continue
        if source.exists() != public.exists():
            raise RuntimeError(f"Root/public mirror divergence: {filename}")
        if not filecmp.cmp(source, public, shallow=False):
            raise RuntimeError(f"Public mirror drift: {filename}")

    for symbol in symbols:
        source = data_dir / "stocks" / f"{symbol}.json"
        public = public_dir / "stocks" / f"{symbol}.json"
        if not source.exists() and not public.exists():
            warnings.append(f"Source and public stock detail are both unavailable: {symbol}.json")
            continue
        if source.exists() != public.exists():
            raise RuntimeError(f"Root/public stock mirror divergence: {symbol}.json")
        if not filecmp.cmp(source, public, shallow=False):
            raise RuntimeError(f"Public stock mirror drift: {symbol}.json")


def assert_no_obsolete_paths() -> None:
    needle = "source/100xFenok/data/slickcharts"
    matches: list[str] = []
    for path in sorted((REPO_ROOT / "scripts" / "scrapers").rglob("*.py")):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for line_number, line in enumerate(lines, start=1):
            if needle in line:
                relative = path.relative_to(REPO_ROOT)
                matches.append(f"{relative}:{line_number}:{line}")
    if matches:
        raise RuntimeError("Obsolete scraper paths remain:\n" + "\n".join(matches))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate SlickCharts data integrity.")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DATA_DIR)
    parser.add_argument("--skip-public", action="store_true")
    parser.add_argument("--warn-extra-stock-files", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    warnings: list[str] = []
    current, available_indices = index_membership(args.data_dir, warnings)
    membership_complete = len(available_indices) == len(INDEX_FILES)
    assert_currency(args.data_dir, warnings)
    symbols = assert_universe(args.data_dir, current, membership_complete, warnings)
    assert_membership_history(args.data_dir, current, available_indices, warnings)
    extras = assert_stock_files(args.data_dir, symbols, warnings)
    assert_aggregate(args.data_dir, "stocks-returns.json", symbols, warnings, membership_complete=membership_complete)
    assert_aggregate(args.data_dir, "stocks-dividends.json", symbols, warnings, membership_complete=membership_complete)
    assert_aggregate(args.data_dir, "stocks-dividends-recent.json", symbols, warnings, exact_symbols=False)
    assert_aggregate(args.data_dir, "stocks-dividends-historical.json", symbols, warnings, exact_symbols=False)
    assert_no_obsolete_paths()
    if not args.skip_public:
        assert_public_mirror(args.data_dir, args.public_dir, symbols, warnings)

    for warning in warnings:
        print(f"::warning:: SlickCharts lane degraded: {warning}", file=sys.stderr)
    print(json.dumps({
        "ok": True,
        "status": "degraded" if warnings else "ready",
        "universe": len(symbols),
        "extra_stock_files": len(extras),
        "warnings": warnings,
    }, ensure_ascii=False))
    if extras and args.warn_extra_stock_files:
        print("Extra stock files not referenced by current universe: " + ", ".join(extras))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
