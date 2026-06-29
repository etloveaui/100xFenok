#!/usr/bin/env python3
"""
Build normalized market facts from source-layer JSON.

Inputs:
  data/yf/finance/{TICKER}.json
  data/stockanalysis/etfs/{TICKER}.json
  data/stockanalysis/stocks/{TICKER}.json
  data/slickcharts/stocks/{TICKER}.json

Output:
  data/computed/market_facts/index.json
  data/computed/market_facts/tickers/{TICKER}.json
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "computed" / "market_facts"
PUBLIC_OUT = ROOT / "100xfenok-next" / "public" / "data" / "computed" / "market_facts"
SCHEMA_VERSION = "market-facts/v1"
MARKET_FACT_FIELDS = {
    "price",
    "previous_close",
    "change",
    "change_pct",
    "market_cap",
    "total_assets",
    "trailing_pe",
    "forward_pe",
    "dividend_yield",
    "beta",
    "expense_ratio",
    "return_1m",
    "return_3m",
    "return_ytd",
    "return_1y",
    "return_3y_avg",
    "return_5y_avg",
    "return_10y_avg",
    "return_max_avg",
}
FIELD_SOURCE_POLICY = {
    "price": ["yf", "yf.fast_info", "stockanalysis.quote", "yf.stockanalysis_fallback.quote", "slickcharts"],
    "previous_close": ["yf", "stockanalysis.quote", "yf.stockanalysis_fallback.quote"],
    "change": ["stockanalysis.quote", "yf", "yf.derived", "yf.stockanalysis_fallback.quote"],
    "change_pct": ["stockanalysis.quote", "yf", "yf.derived", "yf.stockanalysis_fallback.quote"],
    "market_cap": ["yf", "stockanalysis.overview", "slickcharts"],
    "total_assets": ["yf", "stockanalysis.overview", "yf.stockanalysis_fallback.overview"],
    "trailing_pe": ["yf", "slickcharts"],
    "forward_pe": ["yf", "stockanalysis.overview", "yf.stockanalysis_fallback.overview", "slickcharts"],
    "dividend_yield": ["yf", "stockanalysis.overview", "yf.stockanalysis_fallback.overview", "slickcharts"],
    "beta": ["yf", "stockanalysis.overview", "yf.stockanalysis_fallback.overview"],
    "expense_ratio": ["yf", "stockanalysis.overview", "yf.stockanalysis_fallback.overview"],
    "return_1m": [
        "yf.history_1y",
        "stockanalysis.detail.performance",
        "stockanalysis.etf_screener.performance",
        "stockanalysis.etf_universe.performance",
    ],
    "return_3m": ["yf.history_1y", "stockanalysis.detail.history"],
    "return_ytd": [
        "yf.history_1y",
        "stockanalysis.detail.performance",
        "stockanalysis.etf_screener.performance",
        "stockanalysis.etf_universe.performance",
        "yf",
    ],
    "return_1y": [
        "yf.history_1y",
        "stockanalysis.detail.performance",
        "stockanalysis.etf_screener.performance",
        "stockanalysis.etf_universe.performance",
        "yf",
    ],
    "return_3y_avg": ["yf", "stockanalysis.detail.history"],
    "return_5y_avg": [
        "yf",
        "stockanalysis.detail.performance",
        "stockanalysis.etf_screener.performance",
        "stockanalysis.etf_universe.performance",
    ],
    "return_10y_avg": [
        "stockanalysis.detail.performance",
        "stockanalysis.etf_screener.performance",
        "stockanalysis.etf_universe.performance",
    ],
    "return_max_avg": [
        "stockanalysis.detail.performance",
        "stockanalysis.etf_screener.performance",
        "stockanalysis.etf_universe.performance",
    ],
}
STOCKANALYSIS_PERFORMANCE_FIELD_MAP = {
    "return_1m": "tr1m",
    "return_ytd": "trYTD",
    "return_1y": "tr1y",
    "return_5y_avg": "cagr5y",
    "return_10y_avg": "cagr10y",
    "return_max_avg": "cagrMAX",
}
INDEX_SOURCE_FILES = [
    "yf/finance/*.json",
    "stockanalysis/etfs/*.json",
    "stockanalysis/stocks/*.json",
    "stockanalysis/financials/*.json",
    "stockanalysis/etf_universe.json",
    "stockanalysis/surfaces/etf_screener.json",
    "slickcharts/stocks/*.json",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class MarketFactsContractError(ValueError):
    """Raised before generated market_facts files are written."""


def validate_market_facts_payload(payload: dict | None, *, ticker: str | None = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["payload must be a dict"]
    if payload.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION!r}")
    payload_ticker = payload.get("ticker")
    if ticker is not None and payload_ticker != ticker.upper():
        errors.append(f"ticker must be {ticker.upper()!r}, got {payload_ticker!r}")
    elif not isinstance(payload_ticker, str) or not payload_ticker:
        errors.append("ticker must be a non-empty string")
    if payload.get("asset_type") not in {"stock", "etf"}:
        errors.append("asset_type must be 'stock' or 'etf'")
    if not payload.get("generated_at"):
        errors.append("generated_at is required")
    facts = payload.get("facts")
    if not isinstance(facts, dict):
        errors.append("facts must be a dict")
        return errors
    for field, fact_payload in facts.items():
        if field not in MARKET_FACT_FIELDS:
            continue
        if not isinstance(fact_payload, dict):
            errors.append(f"facts.{field} must be an object")
            continue
        if "value" not in fact_payload:
            errors.append(f"facts.{field}.value key is required")
        if "source" not in fact_payload:
            errors.append(f"facts.{field}.source key is required")
        candidates = fact_payload.get("candidates")
        if candidates is not None and not isinstance(candidates, list):
            errors.append(f"facts.{field}.candidates must be a list when present")
    if not isinstance(payload.get("source_files"), dict):
        errors.append("source_files must be a dict")
    return errors


def assert_market_facts_payload(payload: dict | None, *, ticker: str | None = None) -> None:
    errors = validate_market_facts_payload(payload, ticker=ticker)
    if errors:
        label = ticker or (payload or {}).get("ticker") or "<unknown>"
        raise MarketFactsContractError(f"{label}: {'; '.join(errors)}")


def stable_payload_for_compare(payload: dict) -> str:
    def normalize(value, *, root=False):
        if isinstance(value, dict):
            return {
                key: (None if root and key == "generated_at" else normalize(item))
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, float):
            return round(value, 12)
        return value

    return json.dumps(normalize(payload, root=True), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def carry_forward_stable_payload(existing_payload, payload: dict) -> dict:
    if isinstance(existing_payload, dict) and stable_payload_for_compare(existing_payload) == stable_payload_for_compare(payload):
        return existing_payload
    return payload


def number(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "")
    mult = 1
    if text.endswith("T"):
        mult = 1_000_000_000_000
        text = text[:-1]
    elif text.endswith("B"):
        mult = 1_000_000_000
        text = text[:-1]
    elif text.endswith("M"):
        mult = 1_000_000
        text = text[:-1]
    if text.endswith("%"):
        text = text[:-1]
    try:
        return float(text) * mult
    except ValueError:
        return None


def percent(value):
    parsed = number(value)
    return parsed


def annual_return_percent(value):
    parsed = number(value)
    if parsed is None:
        return None
    # yfinance average-return fields are ratios (0.12 = 12%), while
    # ytdReturn and fiftyTwoWeekChangePercent arrive as percent points.
    return parsed * 100 if abs(parsed) <= 5 else parsed


def fact(value, source, as_of=None, fetched_at=None, confidence="observed", unit=None):
    if value is None:
        return None
    payload = {
        "value": value,
        "source": source,
        "as_of": as_of,
        "fetched_at": fetched_at,
        "confidence": confidence,
    }
    if unit:
        payload["unit"] = unit
    return payload


def first_fact(*items):
    for item in items:
        if item is not None and item.get("value") is not None:
            return item
    return None


def resolve_fact(field, *items):
    candidates = [item for item in items if item is not None and item.get("value") is not None]
    selected = first_fact(*candidates)
    if selected is None:
        return None
    resolved = dict(selected)
    resolved["policy"] = FIELD_SOURCE_POLICY.get(field, [])
    resolved["candidates"] = candidates
    resolved["candidate_count"] = len(candidates)
    return resolved


def yf_fact(yf_payload, key):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    value = info.get(key)
    return fact(value, "yf", fetched_at=(yf_payload or {}).get("fetched_at"))


def yf_percent_fact(yf_payload, key):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    value = number(info.get(key))
    return fact(value, "yf", fetched_at=(yf_payload or {}).get("fetched_at"), unit="percent_points")


def yf_annual_return_fact(yf_payload, key):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    value = annual_return_percent(info.get(key))
    return fact(value, "yf", fetched_at=(yf_payload or {}).get("fetched_at"), unit="percent_points")


def yf_fast_fact(yf_payload, key):
    data = (yf_payload or {}).get("data") or {}
    fast_info = data.get("fast_info") or {}
    value = fast_info.get(key)
    return fact(value, "yf.fast_info", fetched_at=(yf_payload or {}).get("fetched_at"))


def yf_derived_change_fact(yf_payload):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    current = number(info.get("currentPrice"))
    previous = number(info.get("previousClose"))
    if current is None or previous is None:
        return None
    return fact(current - previous, "yf.derived", fetched_at=(yf_payload or {}).get("fetched_at"), confidence="derived")


def yf_derived_change_pct_fact(yf_payload):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    current = number(info.get("currentPrice"))
    previous = number(info.get("previousClose"))
    if current is None or previous in (None, 0):
        return None
    return fact(((current - previous) / previous) * 100, "yf.derived", fetched_at=(yf_payload or {}).get("fetched_at"), confidence="derived")


def parse_history_date(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def history_close(point):
    if not isinstance(point, dict):
        return None
    return number(point.get("Close", point.get("close", point.get("c"))))


def yf_history_points(yf_payload):
    data = (yf_payload or {}).get("data") or {}
    rows = []
    for point in data.get("history_1y") or []:
        date = parse_history_date((point or {}).get("date"))
        close = history_close(point)
        if date is None or close is None or close <= 0:
            continue
        rows.append({"date": date, "close": close})
    return sorted(rows, key=lambda item: item["date"])


def return_from_closes(start_close, end_close):
    if start_close in (None, 0) or end_close is None:
        return None
    return ((end_close - start_close) / start_close) * 100


def annualized_return_from_closes(start_close, end_close, years):
    if start_close in (None, 0) or end_close in (None, 0) or years in (None, 0):
        return None
    if start_close <= 0 or end_close <= 0 or years <= 0:
        return None
    return (((end_close / start_close) ** (1 / years)) - 1) * 100


def yf_history_return_fact(yf_payload, trading_days):
    rows = yf_history_points(yf_payload)
    if len(rows) <= trading_days:
        return None
    latest = rows[-1]
    start = rows[-1 - trading_days]
    value = return_from_closes(start["close"], latest["close"])
    return fact(
        value,
        "yf.history_1y",
        as_of=latest["date"].isoformat(),
        fetched_at=(yf_payload or {}).get("fetched_at"),
        confidence="derived",
        unit="percent_points",
    )


def yf_history_ytd_fact(yf_payload):
    rows = yf_history_points(yf_payload)
    if len(rows) < 2:
        return None
    latest = rows[-1]
    start = next((row for row in rows if row["date"].year == latest["date"].year), None)
    if start is None or start["date"] == latest["date"]:
        return None
    value = return_from_closes(start["close"], latest["close"])
    return fact(
        value,
        "yf.history_1y",
        as_of=latest["date"].isoformat(),
        fetched_at=(yf_payload or {}).get("fetched_at"),
        confidence="derived",
        unit="percent_points",
    )


def yf_history_one_year_fact(yf_payload):
    rows = yf_history_points(yf_payload)
    if len(rows) < 2:
        return None
    latest = rows[-1]
    start = rows[0]
    value = return_from_closes(start["close"], latest["close"])
    return fact(
        value,
        "yf.history_1y",
        as_of=latest["date"].isoformat(),
        fetched_at=(yf_payload or {}).get("fetched_at"),
        confidence="derived",
        unit="percent_points",
    )


def stockanalysis_history_close(point):
    if not isinstance(point, dict):
        return None
    # StockAnalysis history rows expose adjusted close as `a`; prefer it for
    # return math to match the adjusted Yahoo history contract.
    return number(point.get("a", point.get("Close", point.get("close", point.get("c")))))


def stockanalysis_history_points(sa_payload, period_key=None):
    normalized = (sa_payload or {}).get("normalized") if isinstance(sa_payload, dict) else None
    raw = (sa_payload or {}).get("raw") if isinstance(sa_payload, dict) else None
    rows_source = None
    if isinstance(period_key, str):
        history_periods = normalized.get("history_periods") if isinstance(normalized, dict) else None
        if isinstance(history_periods, dict) and isinstance(history_periods.get(period_key), list):
            rows_source = history_periods.get(period_key)
        if rows_source is None:
            raw_periods = raw.get("history_periods") if isinstance(raw, dict) else None
            if isinstance(raw_periods, dict) and isinstance(raw_periods.get(period_key), list):
                rows_source = raw_periods.get(period_key)
    elif isinstance(normalized, dict) and isinstance(normalized.get("history"), list):
        rows_source = normalized.get("history")

    rows = []
    for point in rows_source or []:
        date = parse_history_date((point or {}).get("t") or (point or {}).get("date"))
        close = stockanalysis_history_close(point)
        if date is None or close is None or close <= 0:
            continue
        rows.append({"date": date, "close": close})
    return sorted(rows, key=lambda item: item["date"])


def stockanalysis_history_return_fact(sa_payload, *, daily_trading_days=None, monthly_periods=None):
    rows = []
    offset = None
    if isinstance(daily_trading_days, int):
        rows = stockanalysis_history_points(sa_payload, "daily_1y")
        offset = daily_trading_days
    if (not rows or len(rows) <= (offset or 0)) and isinstance(monthly_periods, int):
        rows = stockanalysis_history_points(sa_payload)
        offset = monthly_periods
    if not rows or offset is None or len(rows) <= offset:
        return None
    latest = rows[-1]
    start = rows[-1 - offset]
    value = return_from_closes(start["close"], latest["close"])
    return fact(
        value,
        "stockanalysis.detail.history",
        as_of=latest["date"].isoformat(),
        fetched_at=(sa_payload or {}).get("fetched_at"),
        confidence="derived",
        unit="percent_points",
    )


def stockanalysis_history_cagr_fact(
    sa_payload,
    *,
    period_keys,
    target_years,
    min_year_fraction=0.85,
):
    if not isinstance(period_keys, (list, tuple)) or not isinstance(target_years, (int, float)):
        return None
    min_years = target_years * min_year_fraction
    for period_key in period_keys:
        rows = stockanalysis_history_points(sa_payload, period_key)
        if len(rows) < 2:
            continue
        latest = rows[-1]
        start = rows[0]
        years = (latest["date"] - start["date"]).days / 365.2425
        if years < min_years:
            continue
        value = annualized_return_from_closes(start["close"], latest["close"], years)
        return fact(
            value,
            "stockanalysis.detail.history",
            as_of=latest["date"].isoformat(),
            fetched_at=(sa_payload or {}).get("fetched_at"),
            confidence="derived",
            unit="percent_points",
        )
    return None


def stockanalysis_quote_fact(sa_payload, key):
    quote = ((sa_payload or {}).get("normalized") or {}).get("quote") or {}
    source = "stockanalysis.quote"
    if (sa_payload or {}).get("source_provider") == "yahoo_finance" or (sa_payload or {}).get("source") == "yahoo_finance":
        source = "yf.stockanalysis_fallback.quote"
    return fact(quote.get(key), source, fetched_at=(sa_payload or {}).get("fetched_at"))


def stockanalysis_overview_fact(sa_payload, key, unit=None):
    overview = ((sa_payload or {}).get("normalized") or {}).get("overview") or {}
    value = overview.get(key)
    parsed = number(value)
    source = "stockanalysis.overview"
    if (sa_payload or {}).get("source_provider") == "yahoo_finance" or (sa_payload or {}).get("source") == "yahoo_finance":
        source = "yf.stockanalysis_fallback.overview"
    return fact(parsed if parsed is not None else value, source, fetched_at=(sa_payload or {}).get("fetched_at"), unit=unit)


def stockanalysis_performance_fact(payload, field, source):
    key = STOCKANALYSIS_PERFORMANCE_FIELD_MAP.get(field)
    if not key:
        return None
    normalized = (payload or {}).get("normalized") if isinstance(payload, dict) else None
    performance = (
        normalized.get("performance")
        if isinstance(normalized, dict) and isinstance(normalized.get("performance"), dict)
        else (payload or {}).get("performance")
    )
    if not isinstance(performance, dict):
        return None
    value = number(performance.get(key))
    return fact(
        value,
        source,
        fetched_at=(payload or {}).get("fetched_at") or (payload or {}).get("generated_at"),
        confidence="observed",
        unit="percent_points",
    )


def slick_current_or_latest_metrics(slick_payload):
    current = (slick_payload or {}).get("current")
    if isinstance(current, dict) and current:
        return current, (slick_payload or {}).get("updated")

    metrics_history = (slick_payload or {}).get("metrics_history") or []
    rows = [row for row in metrics_history if isinstance(row, dict)]
    if not rows:
        return {}, (slick_payload or {}).get("updated")

    latest = sorted(rows, key=lambda row: str(row.get("date") or ""), reverse=True)[0]
    return latest, latest.get("date") or (slick_payload or {}).get("updated")


def slick_fact(slick_payload, key, unit=None):
    current, as_of = slick_current_or_latest_metrics(slick_payload)
    return fact(current.get(key), "slickcharts", as_of=as_of, unit=unit)


def slick_market_cap_fact(slick_payload):
    current, as_of = slick_current_or_latest_metrics(slick_payload)
    parsed = number(current.get("market_cap_billions"))
    value = parsed * 1_000_000_000 if parsed is not None else None
    return fact(value, "slickcharts", as_of=as_of)


def build_one(ticker, yf_payload, sa_payload, slick_payload, sa_catalog_payload=None):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    sa_norm = (sa_payload or {}).get("normalized") or {}
    sa_provider = (sa_payload or {}).get("source_provider") or (sa_payload or {}).get("source")
    sa_is_yahoo_fallback = sa_provider == "yahoo_finance"

    asset_type = "stock"
    if (
        (sa_payload or {}).get("asset_type") == "etf"
        or str(info.get("quoteType") or "").upper() == "ETF"
        or sa_catalog_payload is not None
    ):
        asset_type = "etf"

    price = resolve_fact(
        "price",
        yf_fact(yf_payload, "currentPrice"),
        yf_fast_fact(yf_payload, "last_price"),
        stockanalysis_quote_fact(sa_payload, "p"),
        slick_fact(slick_payload, "price"),
    )
    market_cap = resolve_fact(
        "market_cap",
        yf_fact(yf_payload, "marketCap"),
        stockanalysis_overview_fact(sa_payload, "marketCap"),
        slick_market_cap_fact(slick_payload),
    )
    total_assets = resolve_fact(
        "total_assets",
        yf_fact(yf_payload, "totalAssets"),
        stockanalysis_overview_fact(sa_payload, "aum"),
    )

    facts = {
        "price": price,
        "previous_close": resolve_fact("previous_close", yf_fact(yf_payload, "previousClose"), stockanalysis_quote_fact(sa_payload, "pd")),
        "change": resolve_fact("change", stockanalysis_quote_fact(sa_payload, "c"), yf_fact(yf_payload, "regularMarketChange"), yf_derived_change_fact(yf_payload)),
        "change_pct": resolve_fact("change_pct", stockanalysis_quote_fact(sa_payload, "cp"), yf_fact(yf_payload, "regularMarketChangePercent"), yf_derived_change_pct_fact(yf_payload)),
        "market_cap": market_cap,
        "total_assets": total_assets,
        "trailing_pe": resolve_fact("trailing_pe", yf_fact(yf_payload, "trailingPE"), slick_fact(slick_payload, "pe_trailing")),
        "forward_pe": resolve_fact("forward_pe", yf_fact(yf_payload, "forwardPE"), stockanalysis_overview_fact(sa_payload, "forwardPE"), slick_fact(slick_payload, "pe_forward")),
        "dividend_yield": resolve_fact("dividend_yield", yf_percent_fact(yf_payload, "dividendYield"), stockanalysis_overview_fact(sa_payload, "dividendYield", unit="percent_points"), slick_fact(slick_payload, "dividend_yield", unit="percent_points")),
        "beta": resolve_fact("beta", yf_fact(yf_payload, "beta"), stockanalysis_overview_fact(sa_payload, "beta")),
        "expense_ratio": resolve_fact("expense_ratio", yf_percent_fact(yf_payload, "netExpenseRatio"), stockanalysis_overview_fact(sa_payload, "expenseRatio", unit="percent_points")),
        "return_1m": resolve_fact(
            "return_1m",
            yf_history_return_fact(yf_payload, 21),
            stockanalysis_performance_fact(sa_payload, "return_1m", "stockanalysis.detail.performance"),
            stockanalysis_performance_fact(sa_catalog_payload, "return_1m", (sa_catalog_payload or {}).get("market_facts_source")),
        ),
        "return_3m": resolve_fact(
            "return_3m",
            yf_history_return_fact(yf_payload, 63),
            stockanalysis_history_return_fact(sa_payload, daily_trading_days=63, monthly_periods=3),
        ),
        "return_ytd": resolve_fact(
            "return_ytd",
            yf_history_ytd_fact(yf_payload),
            stockanalysis_performance_fact(sa_payload, "return_ytd", "stockanalysis.detail.performance"),
            stockanalysis_performance_fact(sa_catalog_payload, "return_ytd", (sa_catalog_payload or {}).get("market_facts_source")),
            yf_percent_fact(yf_payload, "ytdReturn"),
        ),
        "return_1y": resolve_fact(
            "return_1y",
            yf_history_one_year_fact(yf_payload),
            stockanalysis_performance_fact(sa_payload, "return_1y", "stockanalysis.detail.performance"),
            stockanalysis_performance_fact(sa_catalog_payload, "return_1y", (sa_catalog_payload or {}).get("market_facts_source")),
            yf_percent_fact(yf_payload, "fiftyTwoWeekChangePercent"),
        ),
        "return_3y_avg": resolve_fact(
            "return_3y_avg",
            yf_annual_return_fact(yf_payload, "threeYearAverageReturn"),
            stockanalysis_history_cagr_fact(
                sa_payload,
                period_keys=("monthly_3y", "monthly_5y"),
                target_years=3,
            ),
        ),
        "return_5y_avg": resolve_fact(
            "return_5y_avg",
            yf_annual_return_fact(yf_payload, "fiveYearAverageReturn"),
            stockanalysis_performance_fact(sa_payload, "return_5y_avg", "stockanalysis.detail.performance"),
            stockanalysis_performance_fact(sa_catalog_payload, "return_5y_avg", (sa_catalog_payload or {}).get("market_facts_source")),
        ),
        "return_10y_avg": resolve_fact(
            "return_10y_avg",
            stockanalysis_performance_fact(sa_payload, "return_10y_avg", "stockanalysis.detail.performance"),
            stockanalysis_performance_fact(sa_catalog_payload, "return_10y_avg", (sa_catalog_payload or {}).get("market_facts_source")),
        ),
        "return_max_avg": resolve_fact(
            "return_max_avg",
            stockanalysis_performance_fact(sa_payload, "return_max_avg", "stockanalysis.detail.performance"),
            stockanalysis_performance_fact(sa_catalog_payload, "return_max_avg", (sa_catalog_payload or {}).get("market_facts_source")),
        ),
    }
    facts = {key: value for key, value in facts.items() if value is not None}

    return {
        "schema_version": SCHEMA_VERSION,
        "ticker": ticker,
        "asset_type": asset_type,
        "generated_at": now_iso(),
        "identity": {
            "name": info.get("longName") or info.get("shortName") or (slick_payload or {}).get("company") or ticker,
            "exchange": info.get("exchange"),
            "currency": info.get("currency"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "fund_family": info.get("fundFamily"),
            "category": info.get("category"),
        },
        "facts": facts,
        "etf": {
            "holdings_count": sa_norm.get("holding_count"),
            "holdings_updated": sa_norm.get("holdings_updated"),
            "top_holdings": (sa_norm.get("holdings") or [])[:25],
            "asset_allocation": sa_norm.get("asset_allocation"),
            "sectors": sa_norm.get("sectors"),
            "countries": sa_norm.get("countries"),
            "classification": sa_norm.get("classification"),
            "yahoo_funds_data_available": bool(data.get("funds_data")),
        } if asset_type == "etf" else None,
        "financials": None,
        "sources": {
            "yf": bool(yf_payload),
            "stockanalysis": bool(sa_payload and not sa_is_yahoo_fallback),
            "stockanalysis_yf_fallback": bool(sa_payload and sa_is_yahoo_fallback),
            "stockanalysis_etf_catalog": bool(sa_catalog_payload),
            "slickcharts": bool(slick_payload),
        },
        "source_files": {
            "yf": f"yf/finance/{ticker}.json" if yf_payload else None,
            "stockanalysis": (
                f"stockanalysis/{'etfs' if asset_type == 'etf' else 'stocks'}/{ticker}.json"
                if sa_payload and not sa_is_yahoo_fallback else None
            ),
            "stockanalysis_yf_fallback": (
                f"stockanalysis/{'etfs' if asset_type == 'etf' else 'stocks'}/{ticker}.json"
                if sa_payload and sa_is_yahoo_fallback else None
            ),
            "stockanalysis_etf_catalog": (
                "stockanalysis/surfaces/etf_screener.json"
                if (sa_catalog_payload or {}).get("market_facts_source") == "stockanalysis.etf_screener.performance"
                else ("stockanalysis/etf_universe.json" if sa_catalog_payload else None)
            ),
            "slickcharts": f"slickcharts/stocks/{ticker}.json" if slick_payload else None,
        },
        "resolver": {
            "version": "market-facts-resolver/v1",
            "field_source_policy": FIELD_SOURCE_POLICY,
            "principle": "Preserve all non-null overlapping source candidates while exposing the selected value at facts.{field}.value.",
        },
    }


def clean_ticker(value):
    return str(value or "").replace("$", "").strip().upper()


def parse_ticker_list(value):
    if value is None:
        return None
    tickers = {clean_ticker(item) for item in str(value).split(",")}
    return {ticker for ticker in tickers if ticker}


def etf_catalog_rows(payload):
    rows = []
    if isinstance((payload or {}).get("records"), list):
        rows.extend(payload["records"])
    for table in (payload or {}).get("tables") or []:
        if isinstance(table, dict) and isinstance(table.get("records"), list):
            rows.extend(table["records"])
    return [row for row in rows if isinstance(row, dict)]


def build_etf_catalog_map() -> dict[str, dict]:
    sources = [
        (DATA / "stockanalysis" / "etf_universe.json", "stockanalysis.etf_universe.performance"),
        (DATA / "stockanalysis" / "surfaces" / "etf_screener.json", "stockanalysis.etf_screener.performance"),
    ]
    rows = {}
    for path, source in sources:
        payload = load_json(path) or {}
        fetched_at = payload.get("fetched_at") or payload.get("generated_at")
        for row in etf_catalog_rows(payload):
            ticker = clean_ticker(row.get("ticker") or row.get("s") or row.get("symbol"))
            if not ticker or not isinstance(row.get("performance"), dict):
                continue
            rows[ticker] = {
                "ticker": ticker,
                "performance": row.get("performance"),
                "fetched_at": fetched_at,
                "market_facts_source": source,
            }
    return rows


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tickers",
        help="Comma-separated ticker allowlist. Updates those ticker files and merges them into the existing full index.",
    )
    parser.add_argument(
        "--no-public-mirror",
        action="store_true",
        help="Write only data/computed/market_facts; skip the Next public mirror.",
    )
    return parser.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args([] if argv is None else argv)
    mirror_public = not args.no_public_mirror
    target_tickers = parse_ticker_list(args.tickers)
    if args.tickers is not None and not target_tickers:
        raise SystemExit("--tickers requires at least one ticker")

    yf_files = {p.stem: p for p in (DATA / "yf" / "finance").glob("*.json") if p.name != "_summary.json"}
    sa_etf_files = {p.stem: p for p in (DATA / "stockanalysis" / "etfs").glob("*.json")}
    sa_stock_files = {p.stem: p for p in (DATA / "stockanalysis" / "stocks").glob("*.json")}
    sa_financial_files = {p.stem: p for p in (DATA / "stockanalysis" / "financials").glob("*.json")}
    slick_files = {p.stem: p for p in (DATA / "slickcharts" / "stocks").glob("*.json")}
    sa_catalog_rows = build_etf_catalog_map()
    all_tickers = sorted(set(yf_files) | set(sa_etf_files) | set(sa_stock_files) | set(sa_financial_files) | set(slick_files) | set(sa_catalog_rows))
    available_tickers = set(all_tickers)
    if target_tickers:
        missing = sorted(target_tickers - available_tickers)
        if missing:
            raise SystemExit(f"--tickers includes tickers without source payloads: {', '.join(missing)}")
        existing_index = load_json(OUT / "index.json")
        if not isinstance(existing_index, dict) or not isinstance(existing_index.get("rows"), list):
            raise SystemExit("--tickers requires an existing data/computed/market_facts/index.json to preserve full coverage")
        tickers = sorted(target_tickers)
        rows_by_ticker = {
            clean_ticker(row.get("ticker")): row
            for row in existing_index.get("rows") or []
            if isinstance(row, dict) and clean_ticker(row.get("ticker"))
        }
    else:
        existing_index = None
        tickers = all_tickers
        rows_by_ticker = {}

    updated_rows = []
    generated_at = now_iso()
    for ticker in tickers:
        yf_payload = load_json(yf_files[ticker]) if ticker in yf_files else None
        sa_path = sa_etf_files.get(ticker) or sa_stock_files.get(ticker)
        sa_payload = load_json(sa_path) if sa_path else None
        sa_financials = load_json(sa_financial_files[ticker]) if ticker in sa_financial_files else None
        slick_payload = load_json(slick_files[ticker]) if ticker in slick_files else None
        payload = build_one(ticker, yf_payload, sa_payload, slick_payload, sa_catalog_rows.get(ticker))
        payload["generated_at"] = generated_at
        if sa_financials and payload["asset_type"] != "etf":
            payload["financials"] = {
                "stockanalysis": {
                    "available": True,
                    "role": "cross-check candidate; not valuation SSOT",
                    "fetched_at": sa_financials.get("fetched_at"),
                    "summary": sa_financials.get("summary"),
                    "source_file": f"stockanalysis/financials/{ticker}.json",
                }
            }
            payload["sources"]["stockanalysis_financials"] = True
            payload["source_files"]["stockanalysis_financials"] = f"stockanalysis/financials/{ticker}.json"
        rel = Path("tickers") / f"{ticker}.json"
        payload = carry_forward_stable_payload(load_json(OUT / rel), payload)
        assert_market_facts_payload(payload, ticker=ticker)
        write_json(OUT / rel, payload)
        if mirror_public:
            write_json(PUBLIC_OUT / rel, payload)
        row = {
            "ticker": ticker,
            "asset_type": payload["asset_type"],
            "sources": payload["sources"],
            "fact_count": len(payload["facts"]),
        }
        updated_rows.append(row)
        if target_tickers:
            rows_by_ticker[ticker] = row

    rows = [rows_by_ticker[ticker] for ticker in sorted(rows_by_ticker)] if target_tickers else updated_rows

    index = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "count": len(rows),
        "source_files": INDEX_SOURCE_FILES,
        "resolver": {
            "version": "market-facts-resolver/v1",
            "field_source_policy": FIELD_SOURCE_POLICY,
        },
        "coverage": {
            "yf": sum(1 for row in rows if row["sources"].get("yf")),
            "stockanalysis": sum(1 for row in rows if row["sources"].get("stockanalysis")),
            "stockanalysis_yf_fallback": sum(1 for row in rows if row["sources"].get("stockanalysis_yf_fallback")),
            "stockanalysis_financials": sum(1 for row in rows if row["sources"].get("stockanalysis_financials")),
            "stockanalysis_etf_catalog": len(sa_catalog_rows),
            "slickcharts": sum(1 for row in rows if row["sources"].get("slickcharts")),
            "etf": sum(1 for row in rows if row["asset_type"] == "etf"),
            "stock": sum(1 for row in rows if row["asset_type"] == "stock"),
        },
        "rows": rows,
    }
    write_json(OUT / "index.json", index)
    if mirror_public:
        write_json(PUBLIC_OUT / "index.json", index)
    mirror_status = "public_mirror=on" if mirror_public else "public_mirror=off"
    print(f"[build-market-facts] count={len(rows)} etf={index['coverage']['etf']} stock={index['coverage']['stock']} {mirror_status}")


if __name__ == "__main__":
    main(sys.argv[1:])
