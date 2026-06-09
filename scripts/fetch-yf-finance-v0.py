#!/usr/bin/env python3
"""
yf Finance Engine v0 PoC — fetch 10 tickers via yfinance.
Output: data/yf/finance/{TICKER}.json
Measure: per-ticker latency, blocks, retry behavior.
"""

import json
import os
import sys
import time
from pathlib import Path

import yfinance as yf

TICKERS = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "JPM", "LLY"]
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "yf" / "finance"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def df_to_records(df):
    """Convert pandas DataFrame to JSON-serializable dict."""
    if df is None or df.empty:
        return None
    # Use string keys for dates
    return json.loads(df.astype(object).where(df.notna(), None).to_json(date_format="iso"))


def series_to_records(s):
    """Convert pandas Series to JSON-serializable dict."""
    if s is None or s.empty:
        return None
    return json.loads(s.astype(object).where(s.notna(), None).to_json(date_format="iso"))


def fetch_ticker(ticker):
    """Fetch all yfinance data for a single ticker. Returns (data_dict, latency_ms, error)."""
    start = time.perf_counter()
    error = None
    data = {}

    try:
        t = yf.Ticker(ticker)

        # Financial statements
        data["income_statement"] = df_to_records(t.income_stmt)
        data["quarterly_income_statement"] = df_to_records(t.quarterly_income_stmt)
        data["balance_sheet"] = df_to_records(t.balance_sheet)
        data["quarterly_balance_sheet"] = df_to_records(t.quarterly_balance_sheet)
        data["cash_flow"] = df_to_records(t.cashflow)
        data["quarterly_cash_flow"] = df_to_records(t.quarterly_cashflow)

        # Earnings
        data["earnings"] = df_to_records(t.earnings)

        # Analyst estimates / recommendations
        try:
            data["recommendations"] = df_to_records(t.recommendations)
        except Exception as e:
            data["recommendations"] = None
            data["_recommendations_error"] = str(e)

        try:
            data["analyst_price_targets"] = t.analyst_price_target
        except Exception as e:
            data["analyst_price_targets"] = None

        # Major holders
        try:
            data["major_holders"] = df_to_records(t.major_holders)
        except Exception as e:
            data["major_holders"] = None

        try:
            data["institutional_holders"] = df_to_records(t.institutional_holders)
        except Exception as e:
            data["institutional_holders"] = None

        # Dividends
        data["dividends"] = series_to_records(t.dividends)

        # Info (lightweight metadata)
        try:
            info = t.info
            # Filter to financial-relevant keys only to keep size reasonable
            financial_keys = [
                "sector", "industry", "marketCap", "trailingPE", "forwardPE",
                "trailingEps", "forwardEps", "dividendRate", "dividendYield",
                "bookValue", "priceToBook", "returnOnEquity", "returnOnAssets",
                "currentRatio", "quickRatio", "debtToEquity", "revenueGrowth",
                "earningsGrowth", "profitMargins", "grossMargins", "ebitdaMargins",
                "operatingMargins", "totalDebt", "totalRevenue", "revenuePerShare",
                "totalCash", "totalCashPerShare", "ebitda", "freeCashflow",
            ]
            data["info"] = {k: info.get(k) for k in financial_keys if k in info}
        except Exception as e:
            data["info"] = None

    except Exception as e:
        error = str(e)

    latency_ms = round((time.perf_counter() - start) * 1000)
    return data, latency_ms, error


def main():
    results = []
    total_start = time.perf_counter()

    for ticker in TICKERS:
        print(f"[fetch] {ticker} ...", end=" ", flush=True)
        data, latency_ms, error = fetch_ticker(ticker)

        out_path = OUT_DIR / f"{ticker}.json"
        payload = {
            "ticker": ticker,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "latency_ms": latency_ms,
            "error": error,
            "data": data,
        }
        out_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

        status = "OK" if not error else f"ERR: {error[:60]}"
        print(f"{status} ({latency_ms}ms) -> {out_path}")
        results.append({"ticker": ticker, "latency_ms": latency_ms, "error": error, "path": str(out_path)})

        # Rate-limit safety: small sleep between tickers
        time.sleep(0.8)

    total_ms = round((time.perf_counter() - total_start) * 1000)

    # Summary
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tickers": TICKERS,
        "total_latency_ms": total_ms,
        "results": results,
        "avg_latency_ms": round(sum(r["latency_ms"] for r in results) / len(results)),
        "errors": [r for r in results if r["error"]],
        "free_tier_estimate_1066_minutes": round((total_ms / 1000 / 60) * (1066 / len(TICKERS)), 2),
    }
    summary_path = OUT_DIR / "_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    print(f"\n[summary] total={total_ms}ms avg={summary['avg_latency_ms']}ms errors={len(summary['errors'])}")
    print(f"[summary] 1066 extrapolation: ~{summary['free_tier_estimate_1066_minutes']} minutes")
    print(f"[summary] saved to {summary_path}")


if __name__ == "__main__":
    main()
