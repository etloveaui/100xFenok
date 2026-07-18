#!/usr/bin/env python3
"""Fetch bounded Yahoo option-chain snapshots into a private transient cache."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from typing import Callable


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "_private" / "admin" / "fenok-flow" / "yf_options"
DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"]
SCHEDULED_TICKERS = DEFAULT_REFERENCE_TICKERS
OPTION_EXPIRIES = 2
OPTION_ROWS = 40
SUMMARY_SCHEMA = "fenok-private-options-collection-summary/v1"


class EmptyExpiriesError(ValueError):
    pass


class EmptyChainError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_observed_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("--observed-at must be RFC3339 UTC") from exc
    if not value.endswith("Z") or parsed.tzinfo is None:
        raise ValueError("--observed-at must be RFC3339 UTC")
    return value


def default_ticker_factory(ticker: str):
    import yfinance as yf  # Imported only for real acquisition, never fixture tests.

    return yf.Ticker(ticker)


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


def option_chain_records(ticker: str, ticker_factory: Callable[[str], object] = default_ticker_factory):
    ticker_obj = ticker_factory(ticker)
    expiries = list(getattr(ticker_obj, "options", []) or [])[:OPTION_EXPIRIES]
    if not expiries:
        raise EmptyExpiriesError("provider returned no expiries")
    output = []
    for expiry in expiries:
        chain = ticker_obj.option_chain(expiry)
        calls = df_records(getattr(chain, "calls", None))
        puts = df_records(getattr(chain, "puts", None))
        if not calls or not puts:
            raise EmptyChainError("provider returned an empty call/put side")
        output.append({"expiry": expiry, "calls": calls, "puts": puts})
    return output


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


def validate_scheduled_tickers(tickers: list[str]) -> None:
    if tickers != SCHEDULED_TICKERS:
        raise ValueError(f"scheduled collection requires exact scheduled allowlist: {','.join(SCHEDULED_TICKERS)}")


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


def build_plan(tickers: list[str], output_dir: Path, *, scheduled: bool) -> dict:
    if scheduled:
        validate_scheduled_tickers(tickers)
    return {
        "schema_version": SUMMARY_SCHEMA,
        "mode": "plan_only",
        "scheduled": scheduled,
        "count": len(tickers),
        "tickers": list(tickers),
        "output_dir": str(output_dir),
        "public_mirror": False,
    }


def _safe_reason(exc: Exception) -> str:
    if isinstance(exc, EmptyExpiriesError):
        return "empty_expiries"
    if isinstance(exc, EmptyChainError):
        return "empty_chain"
    return "provider_error"


def collect_options(
    tickers: list[str],
    *,
    output_dir: Path,
    summary_path: Path,
    ticker_factory: Callable[[str], object] = default_ticker_factory,
    observed_at: str | None = None,
    sleep_seconds: float = 0.5,
    max_age_hours: float = 0,
    scheduled: bool = False,
) -> dict:
    if scheduled:
        validate_scheduled_tickers(tickers)
    generated_at = validate_observed_at(observed_at) if observed_at else now_iso()
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for index, ticker in enumerate(tickers, 1):
        out_path = output_dir / f"{ticker}.json"
        if fresh_enough(out_path, max_age_hours):
            prior = json.loads(out_path.read_text(encoding="utf-8"))
            options = prior.get("options") if isinstance(prior.get("options"), list) else []
            results.append({
                "ticker": ticker,
                "status": "ready",
                "fetched_at": prior.get("fetched_at"),
                "expiry_count": len(options),
                "call_rows": sum(len(row.get("calls") or []) for row in options),
                "put_rows": sum(len(row.get("puts") or []) for row in options),
            })
            print(f"[{index}/{len(tickers)}] {ticker} SKIP fresh private cache", flush=True)
            continue
        try:
            options = option_chain_records(ticker, ticker_factory)
            fetched_at = generated_at
            payload = {
                "schema_version": "fenok-private-options/v0.1",
                "ticker": ticker,
                "fetched_at": fetched_at,
                "source_family": "targeted_yfinance_option_chain_snapshot",
                "raw_public": False,
                "public_mirror": False,
                "options": options,
            }
            out_path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
            results.append({
                "ticker": ticker,
                "status": "ready",
                "fetched_at": fetched_at,
                "expiry_count": len(options),
                "call_rows": sum(len(row["calls"]) for row in options),
                "put_rows": sum(len(row["puts"]) for row in options),
            })
            print(f"[{index}/{len(tickers)}] {ticker} OK expiries={len(options)}", flush=True)
        except Exception as exc:  # noqa: BLE001 - bounded collector reports all members.
            reason = _safe_reason(exc)
            results.append({"ticker": ticker, "status": "failed", "reason": reason})
            print(f"[{index}/{len(tickers)}] {ticker} FAIL {reason}", flush=True)
        if sleep_seconds > 0 and index < len(tickers):
            time.sleep(sleep_seconds)

    ready_count = sum(row["status"] == "ready" for row in results)
    summary = {
        "schema_version": SUMMARY_SCHEMA,
        "generated_at": generated_at,
        "scheduled": scheduled,
        "tickers": list(tickers),
        "requested_count": len(tickers),
        "ready_count": ready_count,
        "failed_count": len(tickers) - ready_count,
        "results": results,
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", default="", help="comma-separated tickers")
    parser.add_argument("--reference-only", action="store_true", help="use the exact 8-ticker reference allowlist")
    parser.add_argument("--scheduled", action="store_true", help="require the exact scheduled allowlist")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--max-age-hours", type=float, default=0)
    parser.add_argument("--output-dir", default=str(OUT_DIR))
    parser.add_argument("--summary-path", default="")
    parser.add_argument("--observed-at", default="")
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()

    tickers = parse_tickers(args)
    if args.scheduled:
        try:
            validate_scheduled_tickers(tickers)
        except ValueError as exc:
            parser.error(str(exc))
    output_dir = Path(args.output_dir).expanduser().resolve()
    if args.plan_only:
        print(json.dumps(build_plan(tickers, output_dir, scheduled=args.scheduled), indent=2))
        return 0
    if not args.summary_path:
        parser.error("--summary-path is required outside --plan-only")
    summary = collect_options(
        tickers,
        output_dir=output_dir,
        summary_path=Path(args.summary_path).expanduser().resolve(),
        observed_at=args.observed_at or None,
        sleep_seconds=args.sleep,
        max_age_hours=args.max_age_hours,
        scheduled=args.scheduled,
    )
    print(json.dumps(summary, indent=2))
    return 0 if summary["failed_count"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
