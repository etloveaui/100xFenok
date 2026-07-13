#!/usr/bin/env python3
"""
yf Finance Engine v2 — field-selected batch fetch for the Fenok stock/ETF universe.

Capacity strategy: keep the existing compact statement core, then add bounded
Yahoo-only depth in `--profile full` so Stock Lens can expose everything useful
without making a weekly 1,100-ticker batch unbounded. Options chains stay behind
an explicit flag because they are expiry-heavy and rate-limit sensitive.

Usage:
  python3 scripts/fetch-yf-finance.py                  # default stock/ETF universe, full profile
  python3 scripts/fetch-yf-finance.py --profile daily  # daily price/history merge profile
  python3 scripts/fetch-yf-finance.py --profile core   # legacy compact profile
  python3 scripts/fetch-yf-finance.py --limit 30       # first 30
  python3 scripts/fetch-yf-finance.py --shard 0/4      # shard i of n
  python3 scripts/fetch-yf-finance.py --tickers AAPL,005930.KS
  python3 scripts/fetch-yf-finance.py --include-options --tickers AAPL
  python3 scripts/fetch-yf-finance.py --stockanalysis-etfs --history-gaps-only --plan-only

Output: data/yf/finance/{TICKER}.json + data/yf/finance/_summary.json
"""

import argparse
import atexit
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import math
from numbers import Number
import os
import re
import signal
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import DataSupplyStateStore
from data_supply_stock_detail import (
    StockDetailValidationError,
    is_enrolled_stock_detail,
    record_stock_detail_failure,
    record_stock_detail_success,
    validate_stock_detail_candidate,
)
from yahoo_batch_state import YahooBatchStateStore

STOCK_UNIVERSE_DIR = ROOT / "data" / "global-scouter" / "stocks" / "detail"
ETF_INDEX = ROOT / "data" / "global-scouter" / "etfs" / "index.json"
STOCKANALYSIS_ETF_UNIVERSE = ROOT / "data" / "stockanalysis" / "etf_universe.json"
STOCKANALYSIS_ETF_SCREENER = ROOT / "data" / "stockanalysis" / "surfaces" / "etf_screener.json"
MARKET_FACTS_INDEX = ROOT / "data" / "computed" / "market_facts" / "index.json"
SOX_GIW_CONSTITUENTS = ROOT / "data" / "indices" / "nasdaq-giw-sox-constituents.json"
DASHBOARD_CONSTANTS = ROOT / "100xfenok-next" / "src" / "lib" / "dashboard" / "constants.ts"
PORTFOLIO_TS = ROOT / "100xfenok-next" / "src" / "lib" / "portfolio.ts"
OUT_DIR = ROOT / "data" / "yf" / "finance"
YAHOO_BATCH_STATE_ROOT = ROOT / "data" / "admin" / "yahoo-batch-quote-history"
DATA_SUPPLY_STATE_ROOT = ROOT / "data" / "admin" / "data-supply-state" / "v1"
DATA_SUPPLY_PROVIDER_TRUTH_ROOT = ROOT

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


class FetchTimeout(Exception):
    pass


@contextmanager
def ticker_timeout(seconds, ticker):
    if (
        not seconds
        or seconds <= 0
        or not hasattr(signal, "SIGALRM")
        or not hasattr(signal, "ITIMER_REAL")
        or not hasattr(signal, "setitimer")
    ):
        yield
        return

    previous_handler = signal.getsignal(signal.SIGALRM)

    def _raise_timeout(_signum, _frame):
        raise FetchTimeout(f"{ticker} exceeded ticker timeout ({seconds:g}s)")

    signal.signal(signal.SIGALRM, _raise_timeout)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)

INFO_KEYS = [
    # identity
    "symbol", "quoteType", "shortName", "longName", "currency", "exchange", "country",
    "sector", "industry", "fullTimeEmployees", "firstTradeDateEpochUtc", "firstTradeDate",
    # fund / ETF
    "fundFamily", "category", "legalType", "totalAssets", "netAssets",
    "navPrice", "yield", "ytdReturn", "beta3Year", "netExpenseRatio",
    "annualReportExpenseRatio", "threeYearAverageReturn",
    "fiveYearAverageReturn",
    # price / range
    "currentPrice", "previousClose", "regularMarketPrice",
    "regularMarketChange", "regularMarketChangePercent", "regularMarketTime",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow",
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
    if isinstance(value, int):
        return value
    if isinstance(value, Number):
        number = float(value)
        return number if math.isfinite(number) else None
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


def stable_json(payload, **kwargs):
    kwargs.setdefault("ensure_ascii", False)
    kwargs.setdefault("allow_nan", False)
    kwargs.setdefault("default", str)
    return json.dumps(clean_value(payload), **kwargs)


def _atomic_write_bytes(path, payload_bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_bytes(payload_bytes)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _observed_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _parse_utc(value):
    if not value:
        return None
    if isinstance(value, Number):
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso_utc(value):
    parsed = _parse_utc(value)
    return parsed.strftime("%Y-%m-%dT%H:%M:%SZ") if parsed else None


def _provider_source_fields(data):
    data = data if isinstance(data, dict) else {}
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    quote_as_of = _iso_utc(info.get("regularMarketTime"))
    history = data.get("history_1y") if isinstance(data.get("history_1y"), list) else []
    history_dates = sorted({
        str(row.get("date"))[:10]
        for row in history
        if isinstance(row, dict) and _parse_utc(str(row.get("date") or "")[:10])
    })
    history_as_of = history_dates[-1] if history_dates else None
    if history_as_of and (not quote_as_of or history_as_of <= quote_as_of[:10]):
        source_as_of = history_as_of
    else:
        source_as_of = quote_as_of
    first_trade = info.get("firstTradeDateEpochUtc") or info.get("firstTradeDate")
    parsed_first_trade = _parse_utc(first_trade)
    return {
        "quote_as_of": quote_as_of,
        "history_as_of": history_as_of,
        "source_as_of": source_as_of,
        "first_trade_date": parsed_first_trade.strftime("%Y-%m-%d") if parsed_first_trade else None,
    }


def decorate_finance_payload(ticker, profile, fetched_at, data):
    source = _provider_source_fields(data)
    history_rows = data.get("history_1y") if isinstance(data, dict) else None
    if isinstance(history_rows, list) and history_rows and not source["history_as_of"]:
        raise ValueError(f"history_as_of is unavailable for {ticker} despite non-empty history")
    if source["history_as_of"] and not source["quote_as_of"]:
        raise ValueError(f"quote_as_of is unavailable for {ticker} despite available history")
    if not source["quote_as_of"] and not source["history_as_of"]:
        raise ValueError(f"provider source timestamp is unavailable for {ticker}")
    fetched = _parse_utc(fetched_at)
    if not fetched:
        raise ValueError(f"invalid fetched_at for {ticker}: {fetched_at}")
    quote = _parse_utc(source["quote_as_of"])
    if quote and quote > fetched:
        raise ValueError(f"quote_as_of follows fetched_at for {ticker}: {source['quote_as_of']} > {fetched_at}")
    history = _parse_utc(source["history_as_of"])
    latest_possible_market_date = (fetched + timedelta(hours=14)).date()
    if history and history.date() > latest_possible_market_date:
        raise ValueError(f"history_as_of follows fetched_at for {ticker}: {source['history_as_of']} > {fetched_at}")
    return {
        "schema_version": SCHEMA_VERSION,
        "ticker": ticker,
        "fetched_at": fetched_at,
        "profile": profile,
        **source,
        "data": data,
    }


def _payload_source_fields(payload):
    payload = payload if isinstance(payload, dict) else {}
    derived = _provider_source_fields(payload.get("data"))
    return {
        key: payload.get(key) or derived.get(key)
        for key in ("quote_as_of", "history_as_of", "source_as_of")
    }


def validate_source_progression(existing_payload, candidate_payload):
    existing = _payload_source_fields(existing_payload)
    candidate = _payload_source_fields(candidate_payload)
    existing_history = history_row_count(existing_payload)
    candidate_history = history_row_count(candidate_payload)
    if existing_history > 0 and candidate_history == 0:
        raise ValueError(
            f"source history disappeared for {candidate_payload.get('ticker')}: "
            f"{existing_history} rows would be replaced by zero"
        )
    if existing_history > 0 and candidate_history > 0:
        if candidate_history < min(existing_history, HISTORY_ENTRIES):
            raise ValueError(
                f"history coverage collapsed for {candidate_payload.get('ticker')}: "
                f"{existing_history} rows would be replaced by {candidate_history}"
            )
        existing_dates = {
            str(row.get("date"))[:10]
            for row in (existing_payload.get("data") or {}).get("history_1y") or []
            if isinstance(row, dict) and _parse_utc(str(row.get("date") or "")[:10])
        }
        candidate_dates = {
            str(row.get("date"))[:10]
            for row in (candidate_payload.get("data") or {}).get("history_1y") or []
            if isinstance(row, dict) and _parse_utc(str(row.get("date") or "")[:10])
        }
        candidate_latest = max(candidate_dates) if candidate_dates else None
        if candidate_latest:
            window_floor = (datetime.fromisoformat(candidate_latest) - timedelta(days=366)).date().isoformat()
            missing_overlap = sorted(
                value for value in existing_dates
                if window_floor <= value <= candidate_latest and value not in candidate_dates
            )
            if missing_overlap:
                raise ValueError(
                    f"history coverage collapsed for {candidate_payload.get('ticker')}: "
                    f"{len(missing_overlap)} previously observed in-window date(s) disappeared"
                )
    for key in ("quote_as_of", "history_as_of"):
        before = _parse_utc(existing.get(key))
        after = _parse_utc(candidate.get(key))
        if before and after and after < before:
            raise ValueError(
                f"source timestamp regression for {candidate_payload.get('ticker')}: "
                f"{key} {candidate.get(key)} < {existing.get(key)}"
            )
    return candidate_payload


def write_finance_payload(ticker, payload):
    """Write Yahoo canonical truth; publish state only for the frozen stock cohort."""
    out_path = OUT_DIR / f"{ticker}.json"
    payload_bytes = stable_json(payload, separators=(",", ":")).encode("utf-8")
    if not is_enrolled_stock_detail(ticker):
        _atomic_write_bytes(out_path, payload_bytes)
        return None
    observed_at = _observed_now()
    truth_root = DATA_SUPPLY_PROVIDER_TRUTH_ROOT
    store = DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=truth_root)
    try:
        candidate = validate_stock_detail_candidate(
            provider="yahoo_finance",
            entity=ticker,
            provider_path=f"data/yf/finance/{ticker}.json",
            payload_bytes=payload_bytes,
            observed_at=observed_at,
            provider_truth_root=truth_root,
        )
    except StockDetailValidationError as exc:
        record_stock_detail_failure(
            store=store,
            provider="yahoo_finance",
            entity=ticker,
            provider_path=f"data/yf/finance/{ticker}.json",
            observed_at=observed_at,
            reason_code=exc.reason_code,
            failure_detail=exc.detail,
            origin="manual",
        )
        raise
    _atomic_write_bytes(out_path, payload_bytes)
    verified = validate_stock_detail_candidate(
        provider="yahoo_finance",
        entity=ticker,
        provider_path=f"data/yf/finance/{ticker}.json",
        payload_bytes=out_path.read_bytes(),
        observed_at=observed_at,
        expected_sha256=candidate.payload_sha256,
        provider_truth_root=truth_root,
    )
    return record_stock_detail_success(
        store=store,
        candidate=verified,
        observed_at=observed_at,
        origin="manual",
    )


def record_finance_failure(ticker, error):
    if not is_enrolled_stock_detail(ticker):
        return None
    observed_at = _observed_now()
    return record_stock_detail_failure(
        store=DataSupplyStateStore(
            DATA_SUPPLY_STATE_ROOT,
            provider_truth_root=DATA_SUPPLY_PROVIDER_TRUTH_ROOT,
        ),
        provider="yahoo_finance",
        entity=ticker,
        provider_path=f"data/yf/finance/{ticker}.json",
        observed_at=observed_at,
        reason_code="fetch_failed",
        failure_detail=error,
        origin="manual",
    )


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
    except FetchTimeout:
        raise
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
    # Keep local-only universe/summary consumers importable without the network
    # client. Collection workflows install yfinance before invoking this path.
    import yfinance as yf

    start = time.perf_counter()
    t = yf.Ticker(yahoo_symbol(ticker))
    data = {}

    info = safe(lambda: t.info, {}) or {}
    fund_like = is_fund_like(info)
    data["info"] = {k: info.get(k) for k in INFO_KEYS if info.get(k) is not None} or None

    if profile == "daily":
        data["fast_info"] = safe(lambda: clean_dict(dict(t.fast_info)))
        data["history_1y"] = safe(lambda: compact_history(t.history(period="1y", interval="1d", auto_adjust=True)))
        return data, round((time.perf_counter() - start) * 1000)

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


def fetch_with_retry(
    ticker,
    profile="full",
    include_options=False,
    include_shares_full=False,
    retries=2,
    backoffs=(5, 20),
    timeout_seconds=90,
    include_evidence=False,
):
    last_err = None
    failures = []
    for attempt in range(retries + 1):
        try:
            with ticker_timeout(timeout_seconds, ticker):
                data, latency_ms = fetch_ticker(
                    ticker,
                    profile=profile,
                    include_options=include_options,
                    include_shares_full=include_shares_full,
                )
            # treat fully-empty payload as failure (likely rate-limited)
            if any(v is not None for v in data.values()):
                result = (data, latency_ms, None)
                if include_evidence:
                    return (*result, {
                        "attempts_used": attempt + 1,
                        "failures": failures,
                        "latency_ms": latency_ms,
                    })
                return result
            last_err = "empty payload"
        except FetchTimeout as e:
            last_err = str(e)
        except Exception as e:
            last_err = str(e)
        failures.append({"attempt": attempt + 1, "error": last_err})
        if attempt < retries:
            time.sleep(backoffs[min(attempt, len(backoffs) - 1)])
    result = (None, 0, last_err)
    if include_evidence:
        return (*result, {
            "attempts_used": retries + 1,
            "failures": failures,
            "latency_ms": 0,
        })
    return result


def merge_existing_payload_data(existing_payload, fetched_data):
    existing_data = (existing_payload or {}).get("data")
    if not isinstance(existing_data, dict):
        return fetched_data
    merged = dict(existing_data)
    for key, value in (fetched_data or {}).items():
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            nested = dict(merged[key])
            nested.update(value)
            merged[key] = nested
        else:
            merged[key] = value
    return merged


def preserve_history_coverage(existing_payload, fetched_data):
    data = dict(fetched_data or {})
    existing_data = existing_payload.get("data") if isinstance(existing_payload, dict) else None
    existing_history = existing_data.get("history_1y") if isinstance(existing_data, dict) else None
    candidate_history = data.get("history_1y")
    if not isinstance(existing_history, list) or not isinstance(candidate_history, list):
        return data
    by_date = {}
    undated = []
    for row in [*existing_history, *candidate_history]:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date") or "")[:10]
        if _parse_utc(date):
            by_date[date] = row
        else:
            undated.append(row)
    merged = [by_date[key] for key in sorted(by_date)]
    data["history_1y"] = [*undated, *merged][-HISTORY_ENTRIES:] or None
    return data


def bind_enrolled_quote_group_to_fresh_fetch(merged_data, fetched_data):
    """Keep heavy merged fields while preventing cross-observation quote filling."""
    merged = dict(merged_data or {})
    merged_info = dict(merged.get("info") or {})
    fetched_info = dict((fetched_data or {}).get("info") or {})
    quote_keys = {
        "symbol",
        "quoteType",
        "currentPrice",
        "previousClose",
        "regularMarketPrice",
        "regularMarketPreviousClose",
        "regularMarketChange",
        "regularMarketChangePercent",
        "regularMarketTime",
    }
    for key in quote_keys:
        merged_info.pop(key, None)
        if fetched_info.get(key) is not None:
            merged_info[key] = fetched_info[key]
    merged["info"] = merged_info
    return merged


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


def surface_rows(payload):
    if not isinstance(payload, dict):
        return []
    records = payload.get("records") if isinstance(payload.get("records"), list) else []
    table_records = []
    for table in payload.get("tables") or []:
        if isinstance(table, dict) and isinstance(table.get("records"), list):
            table_records.extend(table["records"])
    return [row for row in [*records, *table_records] if isinstance(row, dict)]


def stockanalysis_symbol(value):
    clean = str(value or "").replace("$", "").strip().upper()
    if clean not in NON_YAHOO_ETF_LABELS and SYMBOL_RE.match(clean):
        return clean
    return None


def parse_suffix_number(value):
    if value is None:
        return None
    if isinstance(value, Number):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "")
    if not text or text in {"-", "N/A"}:
        return None
    multiplier = 1
    suffix = text[-1:].upper()
    if suffix in {"K", "M", "B", "T"}:
        multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000, "T": 1_000_000_000_000}[suffix]
        text = text[:-1]
    try:
        return float(text) * multiplier
    except ValueError:
        return None


def stockanalysis_aum(row):
    for key in ("aum", "aum_raw", "totalAssets", "total_assets", "netAssets", "net_assets"):
        parsed = parse_suffix_number(row.get(key))
        if parsed is not None:
            return parsed
    return 0.0


def load_stockanalysis_etfs():
    symbols = set()
    for path in (STOCKANALYSIS_ETF_UNIVERSE, STOCKANALYSIS_ETF_SCREENER):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        for row in surface_rows(payload):
            symbol = stockanalysis_symbol(row.get("ticker") or row.get("s") or row.get("symbol"))
            if symbol:
                symbols.add(symbol)
    return symbols


def load_stockanalysis_etf_priority():
    priority = {}
    for path in (STOCKANALYSIS_ETF_UNIVERSE, STOCKANALYSIS_ETF_SCREENER):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        for row in surface_rows(payload):
            symbol = stockanalysis_symbol(row.get("ticker") or row.get("s") or row.get("symbol"))
            if symbol:
                priority[symbol] = max(priority.get(symbol, 0.0), stockanalysis_aum(row))
    return priority


def sort_universe(tickers, stockanalysis_etfs=False):
    clean = [ticker for ticker in tickers if SYMBOL_RE.match(ticker)]
    if not stockanalysis_etfs:
        return sorted(clean)
    priority = load_stockanalysis_etf_priority()
    return sorted(
        clean,
        key=lambda ticker: (
            0 if ticker in priority else 1,
            -priority.get(ticker, 0.0),
            ticker,
        ),
    )


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


def load_market_facts_stocks():
    try:
        payload = json.loads(MARKET_FACTS_INDEX.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    symbols = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("asset_type") != "stock":
            continue
        symbol = str(row.get("ticker") or "").strip().upper()
        if SYMBOL_RE.match(symbol):
            symbols.add(symbol)
    return symbols


def load_sox_giw_symbols():
    try:
        payload = json.loads(SOX_GIW_CONSTITUENTS.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    symbols = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").strip().upper()
        if SYMBOL_RE.match(symbol):
            symbols.add(symbol)
    return symbols


def load_universe_sources(stocks_only=False, stockanalysis_etfs=False):
    sources = {}

    def add(symbols, source):
        for symbol in symbols:
            if SYMBOL_RE.match(symbol):
                sources.setdefault(symbol, set()).add(source)

    add({p.stem for p in STOCK_UNIVERSE_DIR.glob("*.json")}, "global_scouter_stock")
    add(load_market_facts_stocks(), "market_facts")
    add(load_sox_giw_symbols(), "nasdaq_giw_sox")
    if not stocks_only:
        add(load_scouter_etfs(), "global_scouter_etf")
        add(load_dashboard_etfs(), "dashboard_configuration")
        add(load_portfolio_symbols(), "portfolio_configuration")
        add(MAJOR_ETFS, "major_etf_configuration")
        add(LEVERAGED_AND_FOCUS_ETFS, "focus_etf_configuration")
        if stockanalysis_etfs:
            add(load_stockanalysis_etfs(), "stockanalysis_etf")
    return {ticker: sorted(values) for ticker, values in sources.items()}


def load_universe(stocks_only=False, stockanalysis_etfs=False):
    sources = load_universe_sources(
        stocks_only=stocks_only,
        stockanalysis_etfs=stockanalysis_etfs,
    )
    return sort_universe(sources, stockanalysis_etfs=stockanalysis_etfs)


def select_ticker_plan(tickers, retry_tickers, *, shard="", natural=False, all_shards=False):
    retry = sorted(set(tickers) & set(retry_tickers)) if natural else []
    regular = [ticker for ticker in tickers if ticker not in retry]
    shard_index = None
    if shard:
        shard_index, shard_count = (int(value) for value in shard.split("/"))
        regular = regular[shard_index::shard_count]
    claim_retry = natural and (not all_shards or shard_index in {None, 0})
    return [*(retry if claim_retry else []), *regular]


def validate_explicit_tickers(values):
    tickers = [str(value).strip().upper() for value in values if str(value).strip()]
    invalid = [ticker for ticker in tickers if not SYMBOL_RE.fullmatch(ticker)]
    if invalid:
        raise ValueError(f"invalid explicit ticker(s): {', '.join(invalid)}")
    return tickers


def validate_retry_count(value):
    retries = int(value)
    if retries < 0 or retries > 5:
        raise ValueError("retries must be between 0 and 5")
    return retries


def should_skip_cached_payload(ticker, payload, max_age_hours, retry_tickers, controlled_failures):
    return (
        ticker not in set(retry_tickers)
        and ticker not in set(controlled_failures)
        and is_fresh_payload(payload, max_age_hours)
    )


def validate_controlled_failure_scope(injected, selected, *, event_name, record_batch_state):
    injected = set(injected)
    if not injected:
        return
    if event_name != "workflow_dispatch":
        raise ValueError("controlled failures require workflow_dispatch")
    if not record_batch_state:
        raise ValueError("controlled failures require Yahoo batch state recording")
    if not injected.issubset(set(selected)):
        raise ValueError("controlled failures must be a subset of explicit --tickers")


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


def history_row_count(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    history = data.get("history_1y") if isinstance(data, dict) else None
    return len(history) if isinstance(history, list) else 0


def has_return_history_payload(payload, min_rows):
    return history_row_count(payload) >= min_rows


def filter_history_gaps(tickers, min_rows):
    selected = []
    for ticker in tickers:
        existing = usable_existing_payload(OUT_DIR / f"{ticker}.json")
        if not existing or not has_return_history_payload(existing, min_rows):
            selected.append(ticker)
    return selected


def write_empty_summary(profile, args, candidate_count, reason):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": 0,
        "candidate_count_before_filters": candidate_count,
        "ok": 0,
        "failed": 0,
        "skipped": 0,
        "total_seconds": 0,
        "avg_latency_ms": 0,
        "profile": profile,
        "include_options": args.include_options,
        "include_shares_full": args.include_shares_full,
        "stockanalysis_etfs": args.stockanalysis_etfs,
        "priority": "stockanalysis_etf_aum" if args.stockanalysis_etfs else "ticker",
        "history_gaps_only": args.history_gaps_only,
        "history_min_rows": args.history_min_rows,
        "merge_existing": args.merge_existing,
        "empty_reason": reason,
        "errors": [],
    }
    (OUT_DIR / "_summary.json").write_text(stable_json(summary, indent=2), encoding="utf-8")


def plan_summary(args, tickers, candidate_count):
    return {
        "schema_version": SCHEMA_VERSION,
        "mode": "plan_only",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(tickers),
        "candidate_count_before_filters": candidate_count,
        "profile": args.profile,
        "stockanalysis_etfs": args.stockanalysis_etfs,
        "priority": "stockanalysis_etf_aum" if args.stockanalysis_etfs else "ticker",
        "history_gaps_only": args.history_gaps_only,
        "history_min_rows": args.history_min_rows,
        "merge_existing": args.merge_existing,
        "limit": args.limit,
        "shard": args.shard,
        "tickers_override": bool(args.tickers),
        "sample_size": args.plan_sample_size,
        "sample": tickers[: args.plan_sample_size],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--shard", type=str, default="", help="i/n e.g. 0/4")
    parser.add_argument("--tickers", type=str, default="", help="comma-separated override")
    parser.add_argument("--stocks-only", action="store_true", help="stock universe only: global-scouter stock detail plus market_facts stock candidates")
    parser.add_argument("--stockanalysis-etfs", action="store_true", help="include the full StockAnalysis ETF universe/screener in the Yahoo candidate set")
    parser.add_argument("--history-gaps-only", action="store_true", help="fetch only tickers whose local payload lacks enough 1Y daily history for return facts")
    parser.add_argument("--history-min-rows", type=int, default=200, help="minimum history_1y rows needed to skip a ticker under --history-gaps-only")
    parser.add_argument("--profile", choices=("daily", "core", "full", "etf"), default="full", help="daily=price/history only, core=legacy compact fields, full=bounded extra Yahoo-only depth, etf=fund-focused depth")
    parser.add_argument("--include-options", action="store_true", help="fetch first option expiries; use targeted tickers only")
    parser.add_argument("--include-shares-full", action="store_true", help="fetch full share-count history sample; useful for buyback/dilution backfills")
    parser.add_argument("--max-age-hours", type=float, default=0, help="skip usable local payloads fetched within N hours")
    parser.add_argument("--sleep", type=float, default=0.8)
    parser.add_argument("--ticker-timeout", type=float, default=90, help="max seconds per ticker attempt before retrying/skipping; 0 disables")
    parser.add_argument("--retries", type=int, default=2, help="retry attempts per ticker after the first attempt")
    parser.add_argument("--merge-existing", action="store_true", help="merge fetched non-null fields into existing payload data instead of replacing heavy fields")
    parser.add_argument("--plan-only", action="store_true", help="print the resolved ticker plan and exit before any Yahoo calls or file writes")
    parser.add_argument("--plan-sample-size", type=int, default=25, help="number of resolved tickers to include in --plan-only output")
    parser.add_argument("--record-batch-state", action="store_true", help="persist bounded Yahoo lane attempt/LKG state")
    parser.add_argument("--natural-run", action="store_true", help="mark a scheduled acquisition eligible for deterministic retry priority")
    parser.add_argument("--all-shards-run", action="store_true", help="claim retries only in shard zero of a sequential all-shard run")
    parser.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID", "local"))
    parser.add_argument("--run-attempt", type=int, default=int(os.environ.get("GITHUB_RUN_ATTEMPT", "1")))
    parser.add_argument("--event-name", default=os.environ.get("GITHUB_EVENT_NAME", "local"))
    parser.add_argument("--event-schedule", default=os.environ.get("EVENT_SCHEDULE", ""))
    parser.add_argument("--controlled-failure-tickers", default="", help="manual targeted failure proof; forbidden on schedules")
    args = parser.parse_args()

    try:
        retries = validate_retry_count(args.retries)
        explicit_tickers = validate_explicit_tickers(args.tickers.split(","))
    except ValueError as exc:
        parser.error(str(exc))
    controlled_failures = {
        value.strip().upper()
        for value in args.controlled_failure_tickers.split(",")
        if value.strip()
    }
    validate_controlled_failure_scope(
        controlled_failures,
        explicit_tickers,
        event_name=args.event_name,
        record_batch_state=args.record_batch_state,
    )

    selection_sources = load_universe_sources(
        stocks_only=args.stocks_only,
        stockanalysis_etfs=args.stockanalysis_etfs,
    )
    universe_sources = (
        load_universe_sources(stocks_only=False, stockanalysis_etfs=True)
        if args.record_batch_state
        else selection_sources
    )
    active_universe = set(universe_sources)
    if args.tickers:
        tickers = explicit_tickers
        for ticker in tickers:
            active_universe.add(ticker)
            universe_sources.setdefault(ticker, ["workflow_dispatch"])
    else:
        tickers = sort_universe(selection_sources, stockanalysis_etfs=args.stockanalysis_etfs)

    candidate_count = len(tickers)
    state_store = YahooBatchStateStore(YAHOO_BATCH_STATE_ROOT, OUT_DIR) if args.record_batch_state else None
    retry_tickers = state_store.retry_tickers(active_universe) if state_store and args.natural_run else set()
    regular_tickers = [ticker for ticker in tickers if ticker not in retry_tickers]
    if args.history_gaps_only:
        regular_tickers = filter_history_gaps(regular_tickers, args.history_min_rows)
    planned_tickers = [*sorted(set(tickers) & retry_tickers), *regular_tickers]
    tickers = select_ticker_plan(
        planned_tickers,
        retry_tickers,
        shard=args.shard,
        natural=args.natural_run,
        all_shards=args.all_shards_run,
    )
    if args.limit:
        tickers = tickers[: args.limit]

    run_context = {
        "run_id": str(args.run_id),
        "run_attempt": args.run_attempt,
        "event_name": args.event_name,
        "schedule": args.event_schedule,
        "natural": args.natural_run,
        "shard": args.shard,
        "observed_at": _observed_now(),
    }

    if args.plan_only:
        print(stable_json(plan_summary(args, tickers, candidate_count), indent=2))
        return

    finalize_state = None
    if state_store:
        finalized = {"done": False}
        inflight = {"ticker": None}

        def finalize_state(abnormal=True):
            if finalized["done"]:
                return
            batch_failure = None
            if abnormal:
                ticker = inflight["ticker"]
                if ticker:
                    try:
                        state_store.record_failure(
                            ticker,
                            "batch terminated before the in-flight ticker completed",
                            run_context,
                            universe_sources.get(ticker, []),
                            {"attempts_used": 1, "failures": [{"attempt": 1, "error": "process termination"}]},
                        )
                    except Exception as exc:
                        batch_failure = f"batch terminated and in-flight failure evidence could not be written: {exc}"
                else:
                    batch_failure = "batch terminated before normal completion"
            state_store.rebuild_index(active_universe, run_context, batch_failure=batch_failure)
            finalized["done"] = True

        atexit.register(finalize_state)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, lambda _signum, _frame: (finalize_state(True), sys.exit(143)))

    if state_store:
        state_store.bootstrap_existing(
            active_universe,
            universe_sources,
            run_context,
            exclude_tickers=set(tickers),
        )

    if not tickers:
        if args.history_gaps_only:
            write_empty_summary(args.profile, args, candidate_count, "no_history_gaps")
            if finalize_state:
                finalize_state(False)
            print(f"[summary] no history gaps; candidates={candidate_count}")
            return
        print("[error] empty universe", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    total_start = time.perf_counter()

    for idx, ticker in enumerate(tickers, 1):
        if state_store:
            inflight["ticker"] = ticker
        out_path = OUT_DIR / f"{ticker}.json"
        existing = usable_existing_payload(out_path)
        if existing and should_skip_cached_payload(
            ticker,
            existing,
            args.max_age_hours,
            retry_tickers,
            controlled_failures,
        ):
            print(f"[{idx}/{len(tickers)}] {ticker} SKIP fresh local payload", flush=True)
            results.append({"ticker": ticker, "latency_ms": 0, "error": None, "skipped": True})
            if state_store:
                state_payload = {**existing, **_provider_source_fields(existing.get("data"))}
                state_store.record_skip(ticker, state_payload, run_context, universe_sources.get(ticker, []))
                inflight["ticker"] = None
            continue

        if ticker in controlled_failures:
            fetch_result = (
                None,
                0,
                f"controlled failure injection for {ticker}",
                {
                    "attempts_used": 1,
                    "failures": [{"attempt": 1, "error": "owner-approved controlled failure injection"}],
                    "latency_ms": 0,
                },
            )
        else:
            fetch_result = fetch_with_retry(
                ticker,
                profile=args.profile,
                include_options=args.include_options,
                include_shares_full=args.include_shares_full,
                retries=retries,
                timeout_seconds=args.ticker_timeout,
                include_evidence=True,
            )
        if len(fetch_result) == 4:
            data, latency_ms, error, evidence = fetch_result
        else:
            data, latency_ms, error = fetch_result
            evidence = {
                "attempts_used": 1,
                "failures": [] if error is None else [{"attempt": 1, "error": error}],
                "latency_ms": latency_ms,
            }
        if error is None:
            fresh_data = data
            if args.merge_existing and existing:
                data = merge_existing_payload_data(existing, fresh_data)
                if is_enrolled_stock_detail(ticker):
                    data = bind_enrolled_quote_group_to_fresh_fetch(data, fresh_data)
            if existing:
                data = preserve_history_coverage(existing, data)
            try:
                payload = decorate_finance_payload(
                    ticker=ticker,
                    profile=args.profile,
                    fetched_at=_observed_now(),
                    data=data,
                )
                if existing:
                    validate_source_progression(existing, payload)
                if state_store and not state_store.recovery_candidate_advances(ticker, payload):
                    raise ValueError(f"source did not advance beyond the retained LKG for {ticker}")
            except ValueError as exc:
                error = f"{type(exc).__name__}: {exc}"
            try:
                if error is None:
                    write_finance_payload(ticker, payload)
            except StockDetailValidationError as exc:
                error = f"{type(exc).__name__}: {exc}"
            if error is None:
                if state_store:
                    state_store.record_success(
                        ticker,
                        payload,
                        run_context,
                        universe_sources.get(ticker, []),
                        evidence,
                    )
                size_kb = round(out_path.stat().st_size / 1024, 1)
                print(f"[{idx}/{len(tickers)}] {ticker} OK {latency_ms}ms {size_kb}KB", flush=True)
            else:
                if state_store:
                    state_store.record_failure(
                        ticker,
                        error,
                        run_context,
                        universe_sources.get(ticker, []),
                        evidence,
                    )
                print(f"[{idx}/{len(tickers)}] {ticker} FAIL: {error[:80]}", flush=True)
        else:
            record_finance_failure(ticker, error)
            if state_store:
                state_store.record_failure(
                    ticker,
                    error,
                    run_context,
                    universe_sources.get(ticker, []),
                    evidence,
                )
            print(f"[{idx}/{len(tickers)}] {ticker} FAIL: {error[:80]}", flush=True)
        results.append({"ticker": ticker, "latency_ms": latency_ms, "error": error, "skipped": False})
        if state_store:
            inflight["ticker"] = None
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
        "stockanalysis_etfs": args.stockanalysis_etfs,
        "priority": "stockanalysis_etf_aum" if args.stockanalysis_etfs else "ticker",
        "history_gaps_only": args.history_gaps_only,
        "history_min_rows": args.history_min_rows,
        "merge_existing": args.merge_existing,
        "candidate_count_before_filters": candidate_count,
        "errors": errors,
    }
    (OUT_DIR / "_summary.json").write_text(stable_json(summary, indent=2), encoding="utf-8")
    if finalize_state:
        finalize_state(False)
    print(f"\n[summary] ok={len(ok)} failed={len(errors)} total={total_s}s")
    if errors:
        sys.exit(2 if len(errors) > len(tickers) * 0.1 else 0)


if __name__ == "__main__":
    main()
