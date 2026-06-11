#!/usr/bin/env python3
"""
Quarter-end close snapshot for the 13F holdings universe + SPY benchmark.

Feeds: treemap return-since-quarter-end (replacing momentum proxy) and the
guru-portfolio performance chart vs SPY (buy-at-quarter-end assumption).

Universe: union of holdings tickers across investors' last N quarters of
filings (data/sec-13f/investors/*.json) + SPY.
Source: yfinance monthly bars (auto-adjusted close). A bar labeled
YYYY-MM-01 carries that month's closing value, so quarter-end close =
the bar of Mar/Jun/Sep/Dec. The current (partial) month bar is exported
as "latest" {date, close} for fallback display.

Output: data/yf/quarter_closes.json (compact)
  { "quarters": ["2023-03-31", ...],
    "tickers": { "AAPL": { "2023-03-31": 123.4, ..., "latest": {...} } } }

Usage:
  python3 scripts/build-quarter-closes.py [--quarters 13] [--chunk 100]
"""

import argparse
import json
import time
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
INVESTORS_DIR = ROOT / "data" / "sec-13f" / "investors"
OUT_PATH = ROOT / "data" / "yf" / "quarter_closes.json"

BENCHMARK = "SPY"
QUARTER_MONTHS = {3, 6, 9, 12}


def load_universe(quarters):
    tickers = set()
    report_dates = set()
    for path in sorted(INVESTORS_DIR.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        filings = (doc.get("investor") or {}).get("filings") or []
        for filing in filings[-quarters:]:
            if filing.get("report_date"):
                report_dates.add(filing["report_date"])
            for holding in filing.get("holdings") or []:
                ticker = holding.get("ticker")
                if ticker and ticker.upper() not in {"N/A", "NONE", "-"}:
                    tickers.add(ticker.upper())
    return sorted(tickers), sorted(report_dates)


def month_end_date(ts):
    """Monthly bar label (month start) -> that quarter-end ISO date."""
    import calendar
    last_day = calendar.monthrange(ts.year, ts.month)[1]
    return f"{ts.year:04d}-{ts.month:02d}-{last_day:02d}"


def yahoo_symbol(ticker):
    """13F class-share notation (BRK.B) -> Yahoo notation (BRK-B)."""
    return ticker.replace(".", "-")


def fetch_chunk(tickers, start):
    df = yf.download(
        tickers=" ".join(yahoo_symbol(t) for t in tickers),
        start=start,
        interval="1mo",
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )
    out = {}
    if df is None or df.empty:
        return out
    multi = hasattr(df.columns, "levels")
    for ticker in tickers:
        try:
            closes = df[yahoo_symbol(ticker)]["Close"] if multi else df["Close"]
        except KeyError:
            continue
        closes = closes.dropna()
        if closes.empty:
            continue
        series = {}
        latest = None
        for ts, val in closes.items():
            iso = month_end_date(ts)
            latest = {"date": iso, "close": round(float(val), 4)}
            if ts.month in QUARTER_MONTHS:
                series[iso] = round(float(val), 4)
        if series or latest:
            entry = dict(series)
            if latest:
                entry["latest"] = latest
            out[ticker] = entry
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quarters", type=int, default=13)
    parser.add_argument("--chunk", type=int, default=100)
    args = parser.parse_args()

    tickers, report_dates = load_universe(args.quarters)
    tickers = sorted(set(tickers) | {BENCHMARK})
    start = f"{report_dates[0][:7]}-01" if report_dates else "2023-03-01"
    print(f"[universe] {len(tickers)} tickers, quarters {report_dates[0]}..{report_dates[-1]}, start={start}")

    all_closes = {}
    failed = []
    for i in range(0, len(tickers), args.chunk):
        chunk = tickers[i : i + args.chunk]
        got = fetch_chunk(chunk, start)
        all_closes.update(got)
        missing = [t for t in chunk if t not in got]
        failed.extend(missing)
        print(f"[chunk {i // args.chunk + 1}] ok={len(got)} missing={len(missing)}", flush=True)
        time.sleep(1.5)

    # current partial-month bar is labeled with a future month-end; cap at today
    today = time.strftime("%Y-%m-%d", time.gmtime())
    for entry in all_closes.values():
        latest = entry.get("latest")
        if latest and latest["date"] > today:
            latest["date"] = today

    payload = {
        "schema_version": "yf-quarter-closes/v1",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "benchmark": BENCHMARK,
        "quarters": report_dates,
        "note": "auto-adjusted monthly close at quarter end; 'latest' = current month bar (weekly refresh, may lag a few days)",
        "missing": sorted(failed),
        "tickers": all_closes,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    size_kb = round(OUT_PATH.stat().st_size / 1024)
    print(f"[done] ok={len(all_closes)} missing={len(failed)} -> {OUT_PATH} ({size_kb}KB)")


if __name__ == "__main__":
    main()
