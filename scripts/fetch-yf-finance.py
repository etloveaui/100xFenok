#!/usr/bin/env python3
"""
yf Finance Engine v2 — field-selected batch fetch for the global-scouter universe.

Capacity strategy: keep the existing compact statement core, then add bounded
Yahoo-only depth in `--profile full` so Stock Lens can expose everything useful
without making a weekly 1,100-ticker batch unbounded. Options chains stay behind
an explicit flag because they are expiry-heavy and rate-limit sensitive.

Usage:
  python3 scripts/fetch-yf-finance.py                  # full universe, full profile
  python3 scripts/fetch-yf-finance.py --profile core   # legacy compact profile
  python3 scripts/fetch-yf-finance.py --limit 30       # first 30
  python3 scripts/fetch-yf-finance.py --shard 0/4      # shard i of n
  python3 scripts/fetch-yf-finance.py --tickers AAPL,005930.KS
  python3 scripts/fetch-yf-finance.py --include-options --tickers AAPL

Output: data/yf/finance/{TICKER}.json + data/yf/finance/_summary.json
"""

import argparse
from datetime import datetime, timezone
import json
from numbers import Number
import re
import sys
import time
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
STOCK_UNIVERSE_DIR = ROOT / "data" / "global-scouter" / "stocks" / "detail"
ETF_INDEX = ROOT / "data" / "global-scouter" / "etfs" / "index.json"
DASHBOARD_CONSTANTS = ROOT / "100xfenok-next" / "src" / "lib" / "dashboard" / "constants.ts"
PORTFOLIO_TS = ROOT / "100xfenok-next" / "src" / "lib" / "portfolio.ts"
OUT_DIR = ROOT / "data" / "yf" / "finance"

SCHEMA_VERSION = "yf-finance/v2"
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
MAJOR_ETFS = {
    "SPY", "QQQ", "DIA", "IWM", "VOO", "VTI",
    "TLT", "IEF", "SHY", "GLD", "SLV", "VNQ",
    "SMH", "SOXX",
}
LEVERAGED_AND_FOCUS_ETFS = {
    "379800.KS", "379810.KS",
    "APPX", "AVGG", "AVGX", "BEG", "BIL", "BILS", "BITU",
    "CRWL", "CWVX", "DFEN", "ELIL", "ETHT", "FNGU", "KORU",
    "MSTU", "MUU", "NVDG", "NVDL", "OKLL", "ORCX", "PLTG",
    "PTIR", "SGOV", "SOXL", "STRC", "TMF", "TQQQ", "TSLL",
    "TSMG", "UTSL",
    "DDM", "QLD", "ROM", "SSO", "TNA", "UPRO", "USD", "UWM",
}
NON_YAHOO_ETF_LABELS = {"HSCEI", "KOSPI", "NASDAQ", "SHANGHAI", "TOPIX"}

ANNUAL_PERIODS = 4
QUARTERLY_PERIODS = 5
DIVIDEND_ENTRIES = 40  # ~10y of quarterly payments
INSTITUTIONAL_TOP = 10
MUTUALFUND_TOP = 10
INSIDER_TOP = 30
RECOMMENDATION_ENTRIES = 24
UPGRADES_ENTRIES = 30
EARNINGS_DATES_ENTRIES = 12
SEC_FILINGS_ENTRIES = 20
NEWS_ENTRIES = 12
HISTORY_ENTRIES = 260  # ~1y daily bars
OPTION_EXPIRIES = 2
OPTION_ROWS = 40
SHARES_FULL_ENTRIES = 48

INFO_KEYS = [
    # identity
    "quoteType", "shortName", "longName", "currency", "exchange", "country",
    "sector", "industry", "fullTimeEmployees",
    # fund / ETF
    "fundFamily", "category", "legalType", "totalAssets", "netAssets",
    "navPrice", "yield", "ytdReturn", "beta3Year", "netExpenseRatio",
    "annualReportExpenseRatio", "threeYearAverageReturn",
    "fiveYearAverageReturn",
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


def clean_value(value):
    """Convert pandas/numpy scalars into JSON-stable primitives."""
    if value is None:
        return None
    try:
        if value != value:  # NaN guard
            return None
    except Exception:
        pass
    if hasattr(value, "strftime"):
        return _iso(value)
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, bool):
        return value
    if isinstance(value, Number):
        return float(value)
    if isinstance(value, (str, int)):
        return value
    if isinstance(value, dict):
        return clean_dict(value)
    if isinstance(value, (list, tuple)):
        out = [clean_value(v) for v in value]
        return [v for v in out if v is not None]
    return str(value)


def clean_dict(values):
    out = {}
    for key, value in dict(values).items():
        clean = clean_value(value)
        if clean is not None:
            out[str(key)] = clean
    return out or None


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


def df_records(df, max_rows=None, recent=False):
    """DataFrame -> list of JSON-stable row dicts with `_index`."""
    if df is None or getattr(df, "empty", True):
        return None
    records = []
    if max_rows and recent:
        rows = df.tail(max_rows)
    elif max_rows:
        rows = df.head(max_rows)
    else:
        rows = df
    for idx, row in rows.iterrows():
        rec = {"_index": _iso(idx) if hasattr(idx, "strftime") else str(idx)}
        for key, val in row.items():
            clean = clean_value(val)
            if clean is not None:
                rec[str(key)] = clean
        records.append(rec)
    return records or None


def holders_records(df, top):
    """institutional_holders DataFrame -> list of plain row dicts."""
    return df_records(df, top)


def small_df(df, max_rows=None):
    """Small DataFrame (recommendations / estimates) -> records, stringified."""
    return df_records(df, max_rows)


def small_series(series, max_items=None):
    if series is None or getattr(series, "empty", True):
        return None
    values = series.tail(max_items) if max_items else series
    out = {}
    for key, value in values.items():
        clean = clean_value(value)
        if clean is not None:
            out[_iso(key) if hasattr(key, "strftime") else str(key)] = clean
    return out or None


def compact_history(df, max_rows=HISTORY_ENTRIES):
    if df is None or getattr(df, "empty", True):
        return None
    rows = df.tail(max_rows)
    out = []
    for idx, row in rows.iterrows():
        rec = {"date": _iso(idx)}
        for key in ("Open", "High", "Low", "Close", "Volume", "Dividends", "Stock Splits"):
            if key in row:
                clean = clean_value(row[key])
                if clean is not None:
                    rec[key] = clean
        if len(rec) > 1:
            out.append(rec)
    return out or None


def news_records(items, max_items=NEWS_ENTRIES):
    if not isinstance(items, list):
        return None
    out = []
    for item in items[:max_items]:
        if not isinstance(item, dict):
            continue
        rec = {}
        for key in ("title", "publisher", "providerPublishTime", "link", "type", "relatedTickers"):
            if key in item:
                clean = clean_value(item[key])
                if clean is not None:
                    rec[key] = clean
        if rec:
            out.append(rec)
    return out or None


def sec_filings_records(items, max_items=SEC_FILINGS_ENTRIES):
    if isinstance(items, dict):
        for key in ("filings", "data", "items"):
            nested = items.get(key)
            if isinstance(nested, list):
                items = nested
                break
        else:
            items = list(items.values())
    if not isinstance(items, list):
        return None
    out = []
    for item in items[:max_items]:
        if isinstance(item, dict):
            clean = clean_dict(item)
            if clean:
                out.append(clean)
    return out or None


def option_chain_records(ticker_obj):
    expiries = list(getattr(ticker_obj, "options", []) or [])[:OPTION_EXPIRIES]
    if not expiries:
        return None
    out = []
    for expiry in expiries:
        chain = ticker_obj.option_chain(expiry)
        out.append({
            "expiry": expiry,
            "calls": df_records(chain.calls, OPTION_ROWS),
            "puts": df_records(chain.puts, OPTION_ROWS),
        })
    return out or None


def shares_full_records(ticker_obj):
    series = ticker_obj.get_shares_full()
    return small_series(series, SHARES_FULL_ENTRIES)


FUND_DATA_ATTRS = (
    "description",
    "fund_overview",
    "fund_operations",
    "asset_classes",
    "top_holdings",
    "equity_holdings",
    "bond_holdings",
    "bond_ratings",
    "sector_weightings",
)


STOCK_ONLY_KEYS = (
    "major_holders",
    "institutional_holders",
    "analyst_price_targets",
    "recommendations",
    "earnings_estimate",
    "revenue_estimate",
    "income_statement",
    "quarterly_income_statement",
    "balance_sheet",
    "quarterly_balance_sheet",
    "cash_flow",
    "quarterly_cash_flow",
    "recommendations_summary",
    "upgrades_downgrades",
    "earnings_dates",
    "earnings_history",
    "eps_trend",
    "eps_revisions",
    "growth_estimates",
    "sustainability",
    "mutualfund_holders",
    "insider_transactions",
    "insider_purchases",
    "insider_roster_holders",
    "sec_filings",
    "news",
)


def is_fund_like(info):
    quote_type = str(info.get("quoteType") or "").upper()
    return quote_type in {"ETF", "MUTUALFUND"} or any(
        info.get(key) is not None
        for key in ("fundFamily", "category", "netExpenseRatio", "totalAssets")
    )


def fund_data_records(ticker_obj):
    funds_data = getattr(ticker_obj, "funds_data", None)
    if funds_data is None:
        return None
    out = {}
    quote_type = safe(lambda: funds_data.quote_type())
    if quote_type:
        out["quote_type"] = quote_type
    for attr in FUND_DATA_ATTRS:
        value = safe(lambda attr=attr: getattr(funds_data, attr))
        if value is None:
            continue
        if hasattr(value, "iterrows"):
            clean = df_records(value)
        elif isinstance(value, dict):
            clean = clean_dict(value)
        else:
            clean = clean_value(value)
        if clean is not None:
            out[attr] = clean
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


def fetch_ticker(ticker, profile="full", include_options=False, include_shares_full=False):
    start = time.perf_counter()
    t = yf.Ticker(yahoo_symbol(ticker))
    data = {}

    info = safe(lambda: t.info, {}) or {}
    fund_like = is_fund_like(info)
    data["info"] = {k: info.get(k) for k in INFO_KEYS if info.get(k) is not None} or None

    if fund_like or profile == "etf":
        for key in STOCK_ONLY_KEYS:
            data[key] = None
    else:
        data["major_holders"] = safe(
            lambda: {str(k): float(v) for k, v in t.major_holders["Value"].items()} if t.major_holders is not None and not t.major_holders.empty else None
        )
        data["institutional_holders"] = safe(lambda: holders_records(t.institutional_holders, INSTITUTIONAL_TOP))

        data["analyst_price_targets"] = safe(lambda: dict(t.analyst_price_targets) or None)
        data["recommendations"] = safe(lambda: small_df(t.recommendations, RECOMMENDATION_ENTRIES))
        data["earnings_estimate"] = safe(lambda: small_df(t.earnings_estimate))
        data["revenue_estimate"] = safe(lambda: small_df(t.revenue_estimate))

    data["dividends"] = safe(
        lambda: {_iso(k): float(v) for k, v in t.dividends.tail(DIVIDEND_ENTRIES).items()} or None
    )

    if not fund_like and profile != "etf":
        data["income_statement"] = safe(lambda: curated_statement(t.income_stmt, INCOME_ITEMS, ANNUAL_PERIODS))
        data["quarterly_income_statement"] = safe(lambda: curated_statement(t.quarterly_income_stmt, INCOME_ITEMS, QUARTERLY_PERIODS))
        data["balance_sheet"] = safe(lambda: curated_statement(t.balance_sheet, BALANCE_ITEMS, ANNUAL_PERIODS))
        data["quarterly_balance_sheet"] = safe(lambda: curated_statement(t.quarterly_balance_sheet, BALANCE_ITEMS, QUARTERLY_PERIODS))
        data["cash_flow"] = safe(lambda: curated_statement(t.cashflow, CASHFLOW_ITEMS, ANNUAL_PERIODS))
        data["quarterly_cash_flow"] = safe(lambda: curated_statement(t.quarterly_cashflow, CASHFLOW_ITEMS, QUARTERLY_PERIODS))

    if profile in {"full", "etf"}:
        data["fast_info"] = safe(lambda: clean_dict(dict(t.fast_info)))
        data["actions"] = safe(lambda: df_records(t.actions, DIVIDEND_ENTRIES, recent=True))
        data["splits"] = safe(lambda: small_series(t.splits, DIVIDEND_ENTRIES))
        data["capital_gains"] = safe(lambda: small_series(t.capital_gains, DIVIDEND_ENTRIES))
        if fund_like:
            data["funds_data"] = safe(lambda: fund_data_records(t))
        elif profile != "etf":
            data["recommendations_summary"] = safe(lambda: small_df(t.recommendations_summary))
            data["upgrades_downgrades"] = safe(lambda: small_df(t.upgrades_downgrades, UPGRADES_ENTRIES))
            data["earnings_dates"] = safe(lambda: small_df(t.earnings_dates, EARNINGS_DATES_ENTRIES))
            data["earnings_history"] = safe(lambda: small_df(t.earnings_history))
            data["eps_trend"] = safe(lambda: small_df(t.eps_trend))
            data["eps_revisions"] = safe(lambda: small_df(t.eps_revisions))
            data["growth_estimates"] = safe(lambda: small_df(t.growth_estimates))
            data["sustainability"] = safe(lambda: small_df(t.sustainability))
            data["mutualfund_holders"] = safe(lambda: df_records(t.mutualfund_holders, MUTUALFUND_TOP))
            data["insider_transactions"] = safe(lambda: df_records(t.insider_transactions, INSIDER_TOP))
            data["insider_purchases"] = safe(lambda: df_records(t.insider_purchases, INSIDER_TOP))
            data["insider_roster_holders"] = safe(lambda: df_records(t.insider_roster_holders, INSIDER_TOP))
            data["sec_filings"] = safe(lambda: sec_filings_records(t.sec_filings))
            data["news"] = safe(lambda: news_records(t.news))
        data["history_1y"] = safe(lambda: compact_history(t.history(period="1y", interval="1d", auto_adjust=True)))

    if include_options:
        data["options"] = safe(lambda: option_chain_records(t))
    if include_shares_full:
        data["shares_full"] = None if fund_like else safe(lambda: shares_full_records(t))

    latency_ms = round((time.perf_counter() - start) * 1000)
    return data, latency_ms


def fetch_with_retry(ticker, profile="full", include_options=False, include_shares_full=False, retries=2, backoffs=(5, 20)):
    last_err = None
    for attempt in range(retries + 1):
        try:
            data, latency_ms = fetch_ticker(
                ticker,
                profile=profile,
                include_options=include_options,
                include_shares_full=include_shares_full,
            )
            # treat fully-empty payload as failure (likely rate-limited)
            if any(v is not None for v in data.values()):
                return data, latency_ms, None
            last_err = "empty payload"
        except Exception as e:
            last_err = str(e)
        if attempt < retries:
            time.sleep(backoffs[min(attempt, len(backoffs) - 1)])
    return None, 0, last_err


def load_scouter_etfs():
    try:
        payload = json.loads(ETF_INDEX.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()
    symbols = set()
    for symbol in (payload.get("etfs") or {}).keys():
        clean = str(symbol).strip().upper()
        if clean not in NON_YAHOO_ETF_LABELS and SYMBOL_RE.match(clean):
            symbols.add(clean)
    return symbols


def load_dashboard_etfs():
    try:
        text = DASHBOARD_CONSTANTS.read_text(encoding="utf-8")
    except FileNotFoundError:
        return set()
    return {m.group(1).upper() for m in re.finditer(r"etf:\s*'([^']+)'", text)}


def load_portfolio_symbols():
    try:
        text = PORTFOLIO_TS.read_text(encoding="utf-8")
    except FileNotFoundError:
        return set()
    return {m.group(1).upper() for m in re.finditer(r"ticker:\s*\"([^\"]+)\"", text)}


def load_universe(stocks_only=False):
    tickers = {p.stem for p in STOCK_UNIVERSE_DIR.glob("*.json")}
    if not stocks_only:
        tickers |= load_scouter_etfs()
        tickers |= load_dashboard_etfs()
        tickers |= load_portfolio_symbols()
        tickers |= MAJOR_ETFS
        tickers |= LEVERAGED_AND_FOCUS_ETFS
    return sorted(t for t in tickers if SYMBOL_RE.match(t))


def usable_existing_payload(path):
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    data = payload.get("data")
    if not isinstance(data, dict) or not any(value is not None for value in data.values()):
        return None
    return payload


def is_fresh_payload(payload, max_age_hours):
    if max_age_hours <= 0:
        return False
    fetched_at = payload.get("fetched_at")
    if not isinstance(fetched_at, str):
        return False
    try:
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    age_hours = (datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)).total_seconds() / 3600
    return age_hours < max_age_hours


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--shard", type=str, default="", help="i/n e.g. 0/4")
    parser.add_argument("--tickers", type=str, default="", help="comma-separated override")
    parser.add_argument("--stocks-only", action="store_true", help="legacy mode: global-scouter stock detail only")
    parser.add_argument("--profile", choices=("core", "full", "etf"), default="full", help="core=legacy compact fields, full=bounded extra Yahoo-only depth, etf=fund-focused depth")
    parser.add_argument("--include-options", action="store_true", help="fetch first option expiries; use targeted tickers only")
    parser.add_argument("--include-shares-full", action="store_true", help="fetch full share-count history sample; useful for buyback/dilution backfills")
    parser.add_argument("--max-age-hours", type=float, default=0, help="skip usable local payloads fetched within N hours")
    parser.add_argument("--sleep", type=float, default=0.8)
    args = parser.parse_args()

    if args.tickers:
        tickers = [s.strip() for s in args.tickers.split(",") if s.strip()]
    else:
        tickers = load_universe(stocks_only=args.stocks_only)
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
        out_path = OUT_DIR / f"{ticker}.json"
        existing = usable_existing_payload(out_path)
        if existing and is_fresh_payload(existing, args.max_age_hours):
            print(f"[{idx}/{len(tickers)}] {ticker} SKIP fresh local payload", flush=True)
            results.append({"ticker": ticker, "latency_ms": 0, "error": None, "skipped": True})
            continue

        data, latency_ms, error = fetch_with_retry(
            ticker,
            profile=args.profile,
            include_options=args.include_options,
            include_shares_full=args.include_shares_full,
        )
        if error is None:
            payload = {
                "schema_version": SCHEMA_VERSION,
                "ticker": ticker,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "profile": args.profile,
                "data": data,
            }
            out_path.write_text(
                json.dumps(payload, separators=(",", ":"), default=str),
                encoding="utf-8",
            )
            size_kb = round(out_path.stat().st_size / 1024, 1)
            print(f"[{idx}/{len(tickers)}] {ticker} OK {latency_ms}ms {size_kb}KB", flush=True)
        else:
            print(f"[{idx}/{len(tickers)}] {ticker} FAIL: {error[:80]}", flush=True)
        results.append({"ticker": ticker, "latency_ms": latency_ms, "error": error, "skipped": False})
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
        "skipped": len([r for r in results if r.get("skipped")]),
        "total_seconds": total_s,
        "avg_latency_ms": round(sum(r["latency_ms"] for r in ok) / len(ok)) if ok else 0,
        "profile": args.profile,
        "include_options": args.include_options,
        "include_shares_full": args.include_shares_full,
        "errors": errors,
    }
    (OUT_DIR / "_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[summary] ok={len(ok)} failed={len(errors)} total={total_s}s")
    if errors:
        sys.exit(2 if len(errors) > len(tickers) * 0.1 else 0)


if __name__ == "__main__":
    main()
