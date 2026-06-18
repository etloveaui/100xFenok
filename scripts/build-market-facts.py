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

from datetime import datetime, timezone
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "computed" / "market_facts"
PUBLIC_OUT = ROOT / "100xfenok-next" / "public" / "data" / "computed" / "market_facts"
SCHEMA_VERSION = "market-facts/v1"
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
}


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


def slick_fact(slick_payload, key, unit=None):
    current = (slick_payload or {}).get("current") or {}
    return fact(current.get(key), "slickcharts", as_of=(slick_payload or {}).get("updated"), unit=unit)


def slick_market_cap_fact(slick_payload):
    current = (slick_payload or {}).get("current") or {}
    parsed = number(current.get("market_cap_billions"))
    value = parsed * 1_000_000_000 if parsed is not None else None
    return fact(value, "slickcharts", as_of=(slick_payload or {}).get("updated"))


def build_one(ticker, yf_payload, sa_payload, slick_payload):
    data = (yf_payload or {}).get("data") or {}
    info = data.get("info") or {}
    sa_norm = (sa_payload or {}).get("normalized") or {}
    sa_provider = (sa_payload or {}).get("source_provider") or (sa_payload or {}).get("source")
    sa_is_yahoo_fallback = sa_provider == "yahoo_finance"

    asset_type = "stock"
    if (sa_payload or {}).get("asset_type") == "etf" or str(info.get("quoteType") or "").upper() == "ETF":
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
            "slickcharts": f"slickcharts/stocks/{ticker}.json" if slick_payload else None,
        },
        "resolver": {
            "version": "market-facts-resolver/v1",
            "field_source_policy": FIELD_SOURCE_POLICY,
            "principle": "Preserve all non-null overlapping source candidates while exposing the selected value at facts.{field}.value.",
        },
    }


def main() -> None:
    yf_files = {p.stem: p for p in (DATA / "yf" / "finance").glob("*.json") if p.name != "_summary.json"}
    sa_etf_files = {p.stem: p for p in (DATA / "stockanalysis" / "etfs").glob("*.json")}
    sa_stock_files = {p.stem: p for p in (DATA / "stockanalysis" / "stocks").glob("*.json")}
    sa_financial_files = {p.stem: p for p in (DATA / "stockanalysis" / "financials").glob("*.json")}
    slick_files = {p.stem: p for p in (DATA / "slickcharts" / "stocks").glob("*.json")}
    tickers = sorted(set(yf_files) | set(sa_etf_files) | set(sa_stock_files) | set(sa_financial_files) | set(slick_files))

    rows = []
    generated_at = now_iso()
    for ticker in tickers:
        yf_payload = load_json(yf_files[ticker]) if ticker in yf_files else None
        sa_path = sa_etf_files.get(ticker) or sa_stock_files.get(ticker)
        sa_payload = load_json(sa_path) if sa_path else None
        sa_financials = load_json(sa_financial_files[ticker]) if ticker in sa_financial_files else None
        slick_payload = load_json(slick_files[ticker]) if ticker in slick_files else None
        payload = build_one(ticker, yf_payload, sa_payload, slick_payload)
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
        write_json(OUT / rel, payload)
        write_json(PUBLIC_OUT / rel, payload)
        rows.append({
            "ticker": ticker,
            "asset_type": payload["asset_type"],
            "sources": payload["sources"],
            "fact_count": len(payload["facts"]),
        })

    index = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "count": len(rows),
        "source_files": [
            "yf/finance/*.json",
            "stockanalysis/etfs/*.json",
            "stockanalysis/stocks/*.json",
            "stockanalysis/financials/*.json",
            "slickcharts/stocks/*.json",
        ],
        "resolver": {
            "version": "market-facts-resolver/v1",
            "field_source_policy": FIELD_SOURCE_POLICY,
        },
        "coverage": {
            "yf": sum(1 for row in rows if row["sources"]["yf"]),
            "stockanalysis": sum(1 for row in rows if row["sources"]["stockanalysis"]),
            "stockanalysis_yf_fallback": sum(1 for row in rows if row["sources"].get("stockanalysis_yf_fallback")),
            "stockanalysis_financials": sum(1 for row in rows if row["sources"].get("stockanalysis_financials")),
            "slickcharts": sum(1 for row in rows if row["sources"]["slickcharts"]),
            "etf": sum(1 for row in rows if row["asset_type"] == "etf"),
            "stock": sum(1 for row in rows if row["asset_type"] == "stock"),
        },
        "rows": rows,
    }
    write_json(OUT / "index.json", index)
    write_json(PUBLIC_OUT / "index.json", index)
    print(f"[build-market-facts] count={len(rows)} etf={index['coverage']['etf']} stock={index['coverage']['stock']}")


if __name__ == "__main__":
    main()
