#!/usr/bin/env python3
"""
yf Finance Engine v1 — field-selected batch fetch for the global-scouter universe.

Capacity strategy (gate-approved): do NOT duplicate full statements (scouter
detail already carries annual financials + estimates). Keep only yf-unique
value: holders, 52wk/info stats, analyst targets, dividends history, and a
curated set of statement line items (annual 4y + quarterly 5q), compact JSON.
Target: ~15-20KB/ticker, ~20MB total for 1066.

Usage:
  python3 scripts/fetch-yf-finance.py                  # full universe
  python3 scripts/fetch-yf-finance.py --limit 30       # first 30
  python3 scripts/fetch-yf-finance.py --shard 0/4      # shard i of n
  python3 scripts/fetch-yf-finance.py --tickers AAPL,005930.KS

Output: data/yf/finance/{TICKER}.json + data/yf/finance/_summary.json
"""

import argparse
import json
import sys
import time
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_DIR = ROOT / "data" / "global-scouter" / "stocks" / "detail"
OUT_DIR = ROOT / "data" / "yf" / "finance"

SCHEMA_VERSION = "yf-finance/v1"

ANNUAL_PERIODS = 4
QUARTERLY_PERIODS = 5
DIVIDEND_ENTRIES = 40  # ~10y of quarterly payments
INSTITUTIONAL_TOP = 10

INFO_KEYS = [
    # identity
    "shortName", "longName", "currency", "exchange", "country",
    "sector", "industry", "fullTimeEmployees",
    # price / range
    "currentPrice", "previousClose", "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
    "fiftyTwoWeekChangePercent", "averageVolume", "averageVolume10days",
    # size / shares
    "marketCap", "enterpriseValue", "sharesOutstanding", "floatShares",
    "heldPercentInsiders", "heldPercentInstitutions",
    # valuation
    "trailingPE", "forwardPE", "trailingEps", "forwardEps", "priceToBook",
    "bookValue", "pegRatio", "enterpriseToRevenue", "enterpriseToEbitda",
    # profitability / health
    "returnOnEquity", "returnOnAssets", "profitMargins", "grossMargins",
    "operatingMargins", "ebitdaMargins", "currentRatio", "quickRatio",
    "debtToEquity", "totalDebt", "totalCash", "totalCashPerShare",
    "totalRevenue", "revenuePerShare", "ebitda", "freeCashflow",
    "revenueGrowth", "earningsGrowth", "beta",
    # dividend
    "dividendRate", "dividendYield", "payoutRatio",
    "fiveYearAvgDividendYield", "exDividendDate",
    # analyst
    "targetHighPrice", "targetLowPrice", "targetMeanPrice",
    "targetMedianPrice", "numberOfAnalystOpinions",
    "recommendationKey", "recommendationMean",
]

INCOME_ITEMS = [
    "Total Revenue", "Cost Of Revenue", "Gross Profit", "Operating Income",
    "Operating Expense", "Net Income", "Basic EPS", "Diluted EPS",
    "EBITDA", "EBIT", "Interest Expense", "Tax Provision",
    "Research And Development",
]
BALANCE_ITEMS = [
    "Total Assets", "Total Liabilities Net Minority Interest",
    "Stockholders Equity", "Cash And Cash Equivalents",
    "Cash Cash Equivalents And Short Term Investments", "Total Debt",
    "Net Debt", "Current Assets", "Current Liabilities", "Working Capital",
    "Invested Capital", "Ordinary Shares Number",
]
CASHFLOW_ITEMS = [
    "Operating Cash Flow", "Investing Cash Flow", "Financing Cash Flow",
    "Free Cash Flow", "Capital Expenditure", "Repurchase Of Capital Stock",
    "Cash Dividends Paid", "Issuance Of Debt", "Repayment Of Debt",
]


def _iso(value):
    """Stringify pandas Timestamp / date-like to ISO date."""
    try:
        return value.strftime("%Y-%m-%d")
    except AttributeError:
        return str(value)


def curated_statement(df, items, periods):
    """Last N period columns x curated row items -> {date: {item: value}}."""
    if df is None or getattr(df, "empty", True):
        return None
    cols = sorted(df.columns, reverse=True)[:periods]
    out = {}
    for col in cols:
        period = {}
        for item in items:
            if item in df.index:
                val = df.at[item, col]
                if val is not None and val == val:  # NaN guard
                    period[item] = float(val)
        if period:
            out[_iso(col)] = period
    return out or None


def holders_records(df, top):
    """institutional_holders DataFrame -> list of plain row dicts."""
    if df is None or getattr(df, "empty", True):
        return None
    records = []
    for _, row in df.head(top).iterrows():
        rec = {}
        for key, val in row.items():
            if val is None or val != val:
                continue
            rec[str(key)] = _iso(val) if hasattr(val, "strftime") else (
                float(val) if isinstance(val, (int, float)) and not isinstance(val, bool) else str(val)
            )
        records.append(rec)
    return records or None


def small_df(df):
    """Small DataFrame (recommendations / estimates) -> records, stringified."""
    if df is None or getattr(df, "empty", True):
        return None
    out = []
    for idx, row in df.iterrows():
        rec = {"_index": _iso(idx) if hasattr(idx, "strftime") else str(idx)}
        for key, val in row.items():
            if val is None or val != val:
                continue
            rec[str(key)] = float(val) if isinstance(val, (int, float)) and not isinstance(val, bool) else str(val)
        out.append(rec)
    return out or None


def safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def yahoo_symbol(ticker):
    """Class-share dot notation (BRK.B) -> Yahoo dash notation (BRK-B).
    Exchange suffixes keep their dot: numeric heads (005930.KS, 7203.T)
    and 2+ letter suffixes (BMW.DE, MC.PA) — verified working as-is in
    the 2026-06-11 full batch; only single-letter class shares failed."""
    head, _, tail = ticker.rpartition(".")
    if head and tail.isalpha() and len(tail) == 1 and not head[-1].isdigit():
        return f"{head}-{tail}"
    return ticker


def fetch_ticker(ticker):
    start = time.perf_counter()
    t = yf.Ticker(yahoo_symbol(ticker))
    data = {}

    info = safe(lambda: t.info, {}) or {}
    data["info"] = {k: info.get(k) for k in INFO_KEYS if info.get(k) is not None} or None

    data["major_holders"] = safe(
        lambda: {str(k): float(v) for k, v in t.major_holders["Value"].items()} if t.major_holders is not None and not t.major_holders.empty else None
    )
    data["institutional_holders"] = safe(lambda: holders_records(t.institutional_holders, INSTITUTIONAL_TOP))

    data["analyst_price_targets"] = safe(lambda: dict(t.analyst_price_targets) or None)
    data["recommendations"] = safe(lambda: small_df(t.recommendations))
    data["earnings_estimate"] = safe(lambda: small_df(t.earnings_estimate))
    data["revenue_estimate"] = safe(lambda: small_df(t.revenue_estimate))

    data["dividends"] = safe(
        lambda: {_iso(k): float(v) for k, v in t.dividends.tail(DIVIDEND_ENTRIES).items()} or None
    )

    data["income_statement"] = safe(lambda: curated_statement(t.income_stmt, INCOME_ITEMS, ANNUAL_PERIODS))
    data["quarterly_income_statement"] = safe(lambda: curated_statement(t.quarterly_income_stmt, INCOME_ITEMS, QUARTERLY_PERIODS))
    data["balance_sheet"] = safe(lambda: curated_statement(t.balance_sheet, BALANCE_ITEMS, ANNUAL_PERIODS))
    data["quarterly_balance_sheet"] = safe(lambda: curated_statement(t.quarterly_balance_sheet, BALANCE_ITEMS, QUARTERLY_PERIODS))
    data["cash_flow"] = safe(lambda: curated_statement(t.cashflow, CASHFLOW_ITEMS, ANNUAL_PERIODS))
    data["quarterly_cash_flow"] = safe(lambda: curated_statement(t.quarterly_cashflow, CASHFLOW_ITEMS, QUARTERLY_PERIODS))

    latency_ms = round((time.perf_counter() - start) * 1000)
    return data, latency_ms


def fetch_with_retry(ticker, retries=2, backoffs=(5, 20)):
    last_err = None
    for attempt in range(retries + 1):
        try:
            data, latency_ms = fetch_ticker(ticker)
            # treat fully-empty payload as failure (likely rate-limited)
            if any(v is not None for v in data.values()):
                return data, latency_ms, None
            last_err = "empty payload"
        except Exception as e:
            last_err = str(e)
        if attempt < retries:
            time.sleep(backoffs[min(attempt, len(backoffs) - 1)])
    return None, 0, last_err


def load_universe():
    return sorted(p.stem for p in UNIVERSE_DIR.glob("*.json"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--shard", type=str, default="", help="i/n e.g. 0/4")
    parser.add_argument("--tickers", type=str, default="", help="comma-separated override")
    parser.add_argument("--sleep", type=float, default=0.8)
    args = parser.parse_args()

    if args.tickers:
        tickers = [s.strip() for s in args.tickers.split(",") if s.strip()]
    else:
        tickers = load_universe()
        if args.shard:
            i, n = (int(x) for x in args.shard.split("/"))
            tickers = tickers[i::n]
        if args.limit:
            tickers = tickers[: args.limit]

    if not tickers:
        print("[error] empty universe", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    total_start = time.perf_counter()

    for idx, ticker in enumerate(tickers, 1):
        data, latency_ms, error = fetch_with_retry(ticker)
        if error is None:
            payload = {
                "schema_version": SCHEMA_VERSION,
                "ticker": ticker,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "data": data,
            }
            out_path = OUT_DIR / f"{ticker}.json"
            out_path.write_text(
                json.dumps(payload, separators=(",", ":"), default=str),
                encoding="utf-8",
            )
            size_kb = round(out_path.stat().st_size / 1024, 1)
            print(f"[{idx}/{len(tickers)}] {ticker} OK {latency_ms}ms {size_kb}KB", flush=True)
        else:
            print(f"[{idx}/{len(tickers)}] {ticker} FAIL: {error[:80]}", flush=True)
        results.append({"ticker": ticker, "latency_ms": latency_ms, "error": error})
        time.sleep(args.sleep)

    total_s = round(time.perf_counter() - total_start, 1)
    ok = [r for r in results if not r["error"]]
    errors = [r for r in results if r["error"]]
    summary = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(tickers),
        "ok": len(ok),
        "failed": len(errors),
        "total_seconds": total_s,
        "avg_latency_ms": round(sum(r["latency_ms"] for r in ok) / len(ok)) if ok else 0,
        "errors": errors,
    }
    (OUT_DIR / "_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[summary] ok={len(ok)} failed={len(errors)} total={total_s}s")
    if errors:
        sys.exit(2 if len(errors) > len(tickers) * 0.1 else 0)


if __name__ == "__main__":
    main()
