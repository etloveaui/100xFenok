#!/usr/bin/env python3
"""
Fetch targeted option-chain snapshots into the private/admin Fenok flow cache.

This intentionally does not write data/yf/finance or any public mirror.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time

import yfinance as yf


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "_private" / "admin" / "fenok-flow" / "yf_options"
DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"]
OPTION_EXPIRIES = 2
OPTION_ROWS = 40


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def df_records(df, limit: int = OPTION_ROWS):
    if df is None or getattr(df, "empty", True):
        return []
    rows = []
    for record in df.head(limit).reset_index(drop=True).to_dict(orient="records"):
        cleaned = {}
        for key, value in record.items():
            if hasattr(value, "isoformat"):
                cleaned[key] = value.isoformat()
            elif value != value:
                cleaned[key] = None
            else:
                cleaned[key] = value
        rows.append(cleaned)
    return rows


def option_chain_records(ticker: str):
    ticker_obj = yf.Ticker(ticker)
    expiries = list(getattr(ticker_obj, "options", []) or [])[:OPTION_EXPIRIES]
    out = []
    for expiry in expiries:
        chain = ticker_obj.option_chain(expiry)
        out.append(
            {
                "expiry": expiry,
                "calls": df_records(chain.calls),
                "puts": df_records(chain.puts),
            }
        )
    return out


def parse_tickers(args) -> list[str]:
    if args.tickers:
        tickers = [part.strip().upper() for part in args.tickers.split(",") if part.strip()]
    elif args.reference_only:
        tickers = DEFAULT_REFERENCE_TICKERS[:]
    else:
        raise SystemExit("--tickers or --reference-only is required")
    if args.limit:
        tickers = tickers[: args.limit]
    return list(dict.fromkeys(tickers))


def fresh_enough(path: Path, max_age_hours: float) -> bool:
    if max_age_hours <= 0 or not path.exists():
        return False
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    fetched_at = payload.get("fetched_at")
    if not fetched_at:
        return False
    try:
        then = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    age_hours = (datetime.now(timezone.utc) - then).total_seconds() / 3600
    return age_hours <= max_age_hours


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", default="", help="comma-separated tickers")
    parser.add_argument("--reference-only", action="store_true", help="use the 8 screenshot reference tickers")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--max-age-hours", type=float, default=0)
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()

    tickers = parse_tickers(args)
    if args.plan_only:
        print(
            json.dumps(
                {
                    "schema_version": "fenok-private-options/v0.1",
                    "mode": "plan_only",
                    "count": len(tickers),
                    "tickers": tickers,
                    "output_dir": str(OUT_DIR.relative_to(ROOT)),
                    "public_mirror": False,
                },
                indent=2,
            )
        )
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for idx, ticker in enumerate(tickers, 1):
        out_path = OUT_DIR / f"{ticker}.json"
        if fresh_enough(out_path, args.max_age_hours):
            print(f"[{idx}/{len(tickers)}] {ticker} SKIP fresh private cache", flush=True)
            results.append({"ticker": ticker, "status": "skipped", "expiries": None})
            continue
        try:
            options = option_chain_records(ticker)
            payload = {
                "schema_version": "fenok-private-options/v0.1",
                "ticker": ticker,
                "fetched_at": now_iso(),
                "source_family": "targeted_yfinance_option_chain_snapshot",
                "raw_public": False,
                "public_mirror": False,
                "options": options,
            }
            out_path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
            print(f"[{idx}/{len(tickers)}] {ticker} OK expiries={len(options)}", flush=True)
            results.append({"ticker": ticker, "status": "ok", "expiries": len(options)})
        except Exception as exc:  # noqa: BLE001 - command-line collector should continue.
            print(f"[{idx}/{len(tickers)}] {ticker} FAIL {exc}", flush=True)
            results.append({"ticker": ticker, "status": "failed", "error": str(exc)})
        if args.sleep > 0:
            time.sleep(args.sleep)

    print(json.dumps({"count": len(tickers), "results": results}, indent=2))


if __name__ == "__main__":
    main()
