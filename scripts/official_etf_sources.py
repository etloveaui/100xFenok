#!/usr/bin/env python3
"""Official issuer ETF source adapter — read-only, Python stdlib only.

Routes were observed on 2026-10-13 during the fh-672 provider feasibility pass.
Public access does not imply a service or license entitlement; the caller owns
that decision. This module performs live public GETs only; it never writes to
the shared checkout and never weakens an existing consumer gate.

Supported issuers and routes
- Corgi (ACHX, ARMA, AVGC, IOSX, KEYX, LRNX, ONDC): https://corgiinvest.com/<slug>
  Current-state JSON embedded in the page (React Query dehydrated state).
- Skylar (MWHS): https://www.skylaretfs.com/mwhs
  Nuxt ``__NUXT_DATA__`` payload: fund details, 27 holdings rows, 73 dated
  premium/discount points.
- 21Shares (THYP): https://api.primary.21shares.com/api/...
  product_details, product_valuation_history, staking_distribution JSON.

Contract
- ``fetch_official_etf(ticker, timeout=30) -> dict``
- Unknown ticker raises ValueError.
- Wrong fund identity, malformed or empty data raise OfficialEtfSourceError.
- ``source_as_of`` comes from the issuer content, never from the HTTP Date
  header. ``fetched_at`` is the local UTC fetch time.
- Missing values stay None or are omitted; nothing is zero-filled, no OHLC is
  fabricated, no universal weight sum is applied and no exchange ticker is
  required. Weights carry an explicit ``weight_basis``.

CLI: python3 official_etf_sources.py [TICKER ...]
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import math
import re
import sys
import threading
import urllib.error
import urllib.request
from urllib.parse import urlparse
from datetime import datetime, timezone

SUPPORTED_TICKERS = (
    "ACHX",
    "ARMA",
    "AVGC",
    "IOSX",
    "KEYX",
    "LRNX",
    "ONDC",
    "CIFC",
    "EO",
    "GMEC",
    "IONC",
    "MIC",
    "ORAC",
    "XQTM",
    "ACII",
    "BDEC",
    "BJUL",
    "BJUN",
    "BNOV",
    "BSTP",
    "EBUF",
    "EJAN",
    "EJUL",
    "IAPR",
    "PMAR",
    "PMAY",
    "PSTP",
    "QBUF",
    "RBUF",
    "TBJL",
    "MWHS",
    "THYP",
)

CORGI_TICKERS = ("ACHX", "ARMA", "AVGC", "IOSX", "KEYX", "LRNX", "ONDC",
                 "CIFC", "EO", "GMEC", "IONC", "MIC", "ORAC", "XQTM")

INNOVATOR_TICKERS = (
    "ACII", "BDEC", "BJUL", "BJUN", "BNOV", "BSTP", "EBUF", "EJAN",
    "EJUL", "IAPR", "PMAR", "PMAY", "PSTP", "QBUF", "RBUF", "TBJL",
)

_INNOVATOR_HOLDINGS_URL = "https://www.innovatoretfs.com/etf/xt_holdings.csv"
# The all-funds CSV carries every Innovator fund, so one cached body serves all
# sixteen members inside a single collector process.
_INNOVATOR_CSV_CACHE: dict = {}
_INNOVATOR_CSV_LOCK = threading.Lock()
_PLAIN_TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,6}$")

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 100xFenok-research/1.0"
)

_TWENTY_ONE_SHARES_API = "https://api.primary.21shares.com/api"


class OfficialEtfSourceError(ValueError):
    """The route answered but the fund identity or payload was unusable."""


# --------------------------------------------------------------------------
# small utilities
# --------------------------------------------------------------------------


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _http_get(url: str, timeout: int, accept: str = "*/*") -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": _USER_AGENT, "Accept": accept},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            final = urlparse(response.geturl())
            if final.scheme != "https" or final.hostname != urlparse(url).hostname:
                raise OfficialEtfSourceError("issuer response redirected outside its origin")
            body = response.read(2_000_001)
            encoding = (response.headers.get("Content-Encoding") or "").lower()
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path
        raise OfficialEtfSourceError(f"HTTP {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:  # pragma: no cover - network path
        raise OfficialEtfSourceError(f"transport failure for {url}: {exc.reason}") from exc
    if body[:2] == b"\x1f\x8b" or "gzip" in encoding:
        try:
            body = gzip.decompress(body)
        except OSError as exc:
            raise OfficialEtfSourceError(f"undecodable gzip body from {url}") from exc
    if not body or len(body) > 2_000_000:
        raise OfficialEtfSourceError(f"empty or oversized body from {url}")
    return body


def _http_get_json(url: str, timeout: int) -> dict:
    body = _http_get(url, timeout, accept="application/json")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OfficialEtfSourceError(f"unparseable JSON from {url}") from exc
    if not isinstance(payload, dict):
        raise OfficialEtfSourceError(f"unexpected JSON shape from {url}")
    return payload


def _number(value):
    """Return a float for numeric-looking issuer strings, else None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    text = str(value).strip().replace(",", "").replace("%", "")
    if not text or text in {"-", "N/A", "TBD"}:
        return None
    try:
        value = float(text)
        return value if math.isfinite(value) else None
    except ValueError:
        return None


def _text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalise_date(value):
    """Accept YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY or MM-DD-YYYY; return YYYY-MM-DD."""
    text = _text(value)
    if text is None:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _max_date(dates):
    parsed = [d for d in (_normalise_date(x) for x in dates) if d]
    return max(parsed) if parsed else None


def _iter_object_candidates(text: str):
    """Yield every parsed object that starts at a real object boundary.

    The embedded state contains nested arrays of objects, so the nearest "{"
    before a key does not identify the object that owns it. Scanning actual
    object starts is both correct and cheap (dozens of candidates per page).
    """
    position = 0
    while True:
        position = text.find('{"', position)
        if position < 0:
            return
        candidate = _balanced_object(text, position)
        position += 1
        if candidate is None:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            yield parsed


def _find_object(text: str, required_keys):
    """Return the first parsed object that carries every required key."""
    for candidate in _iter_object_candidates(text):
        if all(key in candidate for key in required_keys):
            return candidate
    return None


def _balanced_object(text: str, opening: int):
    depth = 0
    in_string = False
    escaped = False
    for position in range(opening, len(text)):
        char = text[position]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[opening : position + 1]
    return None


def _resolve_nuxt(payload, value, _depth: int = 0):
    """Resolve a Nuxt payload index reference (follows chains, cycle-safe)."""
    seen = set()
    while (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value < len(payload)
        and value not in seen
        and _depth < 12
    ):
        seen.add(value)
        value = payload[value]
        _depth += 1
    return value


def _resolve_nuxt_row(payload, row: dict) -> dict:
    return {key: _resolve_nuxt(payload, value) for key, value in row.items()}


# --------------------------------------------------------------------------
# Corgi
# --------------------------------------------------------------------------


def _corgi_holdings_row(raw: dict) -> dict:
    identifier = _text(raw.get("security_cusip")) or _text(raw.get("security_ticker"))
    identifier_type = None
    if identifier:
        identifier_type = "cusip_trs" if "-TRS-" in identifier else "issuer_identifier"
    return {
        "name": _text(raw.get("security_name")),
        "symbol": None,  # Corgi rows carry a CUSIP-TRS composite, not a ticker
        "identifier": identifier,
        "identifier_type": identifier_type,
        "weight_pct": _number(raw.get("weight_pct")),
        "weight_basis": "market_value",
        "market_value": _number(raw.get("market_value")),
        "shares": _number(raw.get("shares")),
        "quantity": None,
        "as_of_date": _normalise_date(raw.get("as_of_date")),
        "position_date": _normalise_date(raw.get("position_date")),
        "raw": raw,
    }


def _fetch_corgi(ticker: str, timeout: int) -> dict:
    url = f"https://corgiinvest.com/{ticker.lower()}"
    html = _http_get(url, timeout, accept="text/html").decode("utf-8", errors="replace")

    fund = _find_object(html, ("latestNav", "ticker", "adviser", "category"))
    if fund is None:
        fund = _find_object(html, ("latestNav", "ticker"))
    if fund is None:
        raise OfficialEtfSourceError(f"corgi fund object not found for {ticker}")
    if str(fund.get("ticker", "")).upper() != ticker.upper():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, page reports {fund.get('ticker')!r}"
        )

    raw_rows = [
        candidate
        for candidate in _iter_object_candidates(html)
        if "security_name" in candidate and "weight_pct" in candidate
    ]
    if not raw_rows:
        raise OfficialEtfSourceError(f"no holdings rows for {ticker}")

    holdings = [_corgi_holdings_row(row) for row in raw_rows]
    for row in holdings:
        if (row.get("name") or "").lower() == "cash & other":
            row["shares"] = None
    if not any(row["as_of_date"] for row in holdings):
        raise OfficialEtfSourceError(f"holdings rows carry no as-of date for {ticker}")

    quote = {}
    if _number(fund.get("latestNav")) is not None:
        quote["nav"] = _number(fund.get("latestNav"))
        quote["nav_as_of"] = _normalise_date(fund.get("latestNavAsOfDate"))
    if _number(fund.get("latestMarketPrice")) is not None:
        quote["market_price"] = _number(fund.get("latestMarketPrice"))
        quote["market_price_as_of"] = _normalise_date(fund.get("latestAsOfDate"))
    if _number(fund.get("latestMarketPriceChangePct")) is not None:
        quote["market_price_change_pct"] = _number(fund.get("latestMarketPriceChangePct"))
    if _number(fund.get("latestPremiumDiscount")) is not None:
        quote["premium_discount_pct"] = _number(fund.get("latestPremiumDiscount"))
    if _number(fund.get("latestNetAssets")) is not None:
        quote["net_assets"] = _number(fund.get("latestNetAssets"))
        quote["net_assets_as_of"] = _normalise_date(fund.get("latestAsOfDate"))
    if _number(fund.get("aum")) is not None:
        quote["aum"] = _number(fund.get("aum"))
        quote["aum_as_of"] = _normalise_date(fund.get("aumAsOf"))
    if _number(fund.get("sec30DayYield")) is not None:
        quote["sec_30day_yield"] = _number(fund.get("sec30DayYield"))

    classification = {}
    for source_key, target_key in (
        ("category", "category"),
        ("fundType", "fund_type"),
        ("leverageFactor", "leverage_factor"),
        ("managementStyle", "management_style"),
        ("rebalanceFrequency", "rebalance_frequency"),
        ("isActiveManagement", "is_active_management"),
        ("underlyingTicker", "underlying_ticker"),
        ("underlyingIssuer", "underlying_issuer"),
        ("underlyingListing", "underlying_listing"),
        ("underlyingIndustry", "underlying_industry"),
        ("indexName", "index_name"),
        ("indexProvider", "index_provider"),
        ("exchange", "exchange"),
        ("inceptionDate", "inception_date"),
        ("cusip", "cusip"),
        ("isin", "isin"),
        ("expenseRatio", "expense_ratio"),
        ("distributionFrequency", "distribution_frequency"),
        ("trust", "trust"),
    ):
        value = fund.get(source_key)
        if value is None:
            continue
        classification[target_key] = value

    field_dates = {
        "holdings": _max_date(row["as_of_date"] for row in holdings),
        "holdings_as_of": _max_date(row["as_of_date"] for row in holdings),
        "holdings_position_date": _max_date(row["position_date"] for row in holdings),
        "nav": quote.get("nav_as_of"),
        "market_price": quote.get("market_price_as_of"),
        "net_assets": quote.get("net_assets_as_of"),
    }

    completeness = [
        "holdings are the issuer's current position rows (swap leg plus Cash & Other); "
        "this route publishes no dated holdings history",
        "navSparkline is undated and is intentionally not returned as history",
        "weights are market-value weights; notional exposure is not published here",
        "rows carry a CUSIP-TRS composite identifier, so symbol stays null",
        "holdingsCount on the page counts the swap leg only and is not a holdings total",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": field_dates["holdings_as_of"],
        "position_date": field_dates["holdings_position_date"],
        "row_count": len(holdings),
        "cash_treatment": "aggregated",
        "scope_note": (
            "issuer publishes the complete current position set for this fund: the "
            "swap leg plus one aggregated Cash & Other row"
        ),
    }

    return {
        "ticker": ticker.upper(),
        "provider": "corgi",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": _max_date(field_dates.values()),
        "holdings": holdings,
        "quote": quote,
        "history": [],
        "classification": classification,
        "field_dates": field_dates,
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {
            "fund": fund,
            "holdings_rows": raw_rows,
        },
    }


# --------------------------------------------------------------------------
# Skylar (MWHS)
# --------------------------------------------------------------------------


def _nuxt_payload(html: str):
    match = re.search(
        r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S
    )
    if not match:
        raise OfficialEtfSourceError("Nuxt payload script not found")
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise OfficialEtfSourceError("unparseable Nuxt payload") from exc
    if not isinstance(payload, list) or not payload:
        raise OfficialEtfSourceError("unexpected Nuxt payload shape")
    return payload


def _find_component(payload, component_type: str):
    for index, entry in enumerate(payload):
        if not isinstance(entry, dict):
            continue
        resolved = _resolve_nuxt(payload, entry.get("componentType"))
        if resolved == component_type:
            return _resolve_nuxt_row(payload, entry)
    return None


def _fetch_skylar(ticker: str, timeout: int) -> dict:
    url = "https://www.skylaretfs.com/mwhs"
    html = _http_get(url, timeout, accept="text/html").decode("utf-8", errors="replace")
    payload = _nuxt_payload(html)

    navs = _find_component(payload, "NavsComponent")
    holdings_component = _find_component(payload, "HoldingsComponent")
    graph_component = _find_component(payload, "PremdisgraphComponent")
    table_component = _find_component(payload, "PremdistableComponent")
    if navs is None or holdings_component is None:
        raise OfficialEtfSourceError("Skylar components missing")

    nav_fund = _resolve_nuxt(payload, navs.get("finData"))
    if not isinstance(nav_fund, dict):
        raise OfficialEtfSourceError("Skylar fund detail block missing")
    fund_ticker = _text(_resolve_nuxt(payload, nav_fund.get("fund_ticker")))
    if (fund_ticker or "").upper() != ticker.upper():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, page reports {fund_ticker!r}"
        )

    raw_rows = []
    for reference in _resolve_nuxt(payload, holdings_component.get("finData")) or []:
        row = _resolve_nuxt(payload, reference)
        if isinstance(row, dict) and "description" in row:
            raw_rows.append(_resolve_nuxt_row(payload, row))
    if not raw_rows:
        raise OfficialEtfSourceError(f"no holdings rows for {ticker}")

    holdings = []
    for row in raw_rows:
        identifier = _text(_resolve_nuxt(payload, row.get("ticker")))
        holdings.append(
            {
                "name": _text(_resolve_nuxt(payload, row.get("description"))),
                "symbol": None,  # contract/fund codes are not exchange tickers
                "identifier": identifier,
                "identifier_type": "provider_ticker",
                "weight_pct": _number(_resolve_nuxt(payload, row.get("percent_of_nav"))),
                "weight_basis": "market_value_percent_of_nav",
                "market_value": _number(_resolve_nuxt(payload, row.get("market_value"))),
                "shares": None,
                "quantity": _number(_resolve_nuxt(payload, row.get("quantity"))),
                "as_of_date": _normalise_date(holdings_component.get("date")),
                "position_date": None,
                "raw": {key: _resolve_nuxt(payload, value) for key, value in row.items()},
            }
        )

    quote = {}
    for source_key, target_key in (
        ("nav", "nav"),
        ("nav_price", "nav_price"),
        ("nav_change", "nav_change"),
        ("nav_percent", "nav_change_pct"),
        ("market_px", "market_price"),
        ("midpoint", "midpoint"),
        ("prem_dis", "premium_discount_pct"),
        ("premium_percent", "premium_discount_pct_alternate"),
        ("net_assets", "net_assets"),
        ("shares_outstanding", "shares_outstanding"),
        ("median_30_day", "median_30_day_spread"),
        ("volume", "volume"),
    ):
        value = _number(_resolve_nuxt(payload, nav_fund.get(source_key)))
        if value is not None:
            quote[target_key] = value
    data_date = _normalise_date(_resolve_nuxt(payload, nav_fund.get("data_date")))
    if data_date:
        quote["as_of"] = data_date

    history = []
    if graph_component is not None:
        for reference in _resolve_nuxt(payload, graph_component.get("finData")) or []:
            point = _resolve_nuxt(payload, reference)
            if not isinstance(point, dict):
                continue
            point = _resolve_nuxt_row(payload, point)
            date = _normalise_date(point.get("label"))
            value = _number(point.get("value"))
            if date and value is not None:
                history.append({"date": date, "premium_discount_pct": value})
    history.sort(key=lambda row: row["date"])

    distributions = []
    if table_component is not None:
        for reference in _resolve_nuxt(payload, table_component.get("finData")) or []:
            row = _resolve_nuxt(payload, reference)
            if isinstance(row, dict):
                distributions.append(_resolve_nuxt_row(payload, row))

    classification = {}
    for source_key, target_key in (
        ("cusip", "cusip"),
        ("primary_exchange", "exchange"),
        ("fund_inception_date", "inception_date"),
        ("expense_ratio", "expense_ratio"),
        ("fund_name", "fund_name"),
        ("fund_ticker", "fund_ticker"),
    ):
        value = navs.get(source_key) if source_key != "fund_name" and source_key != "fund_ticker" else _resolve_nuxt(payload, nav_fund.get(source_key))
        value = _text(_resolve_nuxt(payload, value)) if value is not None else None
        if value is not None:
            classification[target_key] = value

    field_dates = {
        "holdings": _normalise_date(holdings_component.get("date")),
        "fund_details": _normalise_date(navs.get("date")),
        "quote": data_date,
        "premium_discount_history": history[-1]["date"] if history else None,
    }

    completeness = [
        "holdings list is complete as published: futures positions plus the money-market "
        "collateral, receivables and the US dollar future row",
        "futures rows carry a contract code, not an exchange ticker, so symbol stays null",
        "weights are percent of net asset value from market value, not notional exposure; "
        "contract notional is not published on this route",
        "quantity is published for some rows only; missing values stay null",
        "history here is the dated premium/discount series, not OHLC price history",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": _normalise_date(holdings_component.get("date")),
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate",
        "scope_note": (
            "collateral and receivables are published as their own rows, so cash is "
            "separate rather than aggregated"
        ),
    }

    return {
        "ticker": ticker.upper(),
        "provider": "skylar",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": _max_date(field_dates.values()),
        "holdings": holdings,
        "quote": quote,
        "history": history,
        "classification": classification,
        "field_dates": field_dates,
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "distributions": distributions,
        "raw": {
            "fund_details": nav_fund,
            "holdings_component_date": holdings_component.get("date"),
        },
    }


# --------------------------------------------------------------------------
# 21Shares (THYP)
# --------------------------------------------------------------------------


def _fetch_twenty_one_shares(ticker: str, timeout: int) -> dict:
    details_url = f"{_TWENTY_ONE_SHARES_API}/product_details/{ticker}"
    details = _http_get_json(details_url, timeout)
    data = details.get("data")
    if not isinstance(data, dict):
        raise OfficialEtfSourceError("21Shares product_details data missing")
    if str(data.get("ticker", "")).upper() != ticker.upper():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, API reports {data.get('ticker')!r}"
        )

    constituents = data.get("constituents") or []
    if not constituents:
        raise OfficialEtfSourceError(f"no constituents for {ticker}")

    holdings = []
    for row in constituents:
        weight = _number(row.get("weight"))
        if weight is None:
            weight_pct = None
            weight_basis = None
        elif 0.0 <= weight <= 1.0:
            weight_pct = weight * 100.0
            weight_basis = "fraction_converted_to_percent"
        else:
            weight_pct = weight
            weight_basis = "provider_weight"
        holdings.append(
            {
                "name": _text(row.get("name")),
                "symbol": _text(row.get("ticker")),
                "identifier": _text(row.get("cusip")),
                "identifier_type": "cusip" if row.get("cusip") else None,
                "weight_pct": weight_pct,
                "weight_raw": weight,
                "weight_basis": weight_basis,
                "market_value": _number(row.get("market_value")),
                "shares": _number(row.get("quantity")),
                "quantity": _number(row.get("quantity")),
                "price": _number(row.get("price")),
                "as_of_date": _normalise_date(data.get("valuation_date")),
                "position_date": None,
                "raw": row,
            }
        )

    history_url = f"{_TWENTY_ONE_SHARES_API}/product_valuation_history/{ticker}"
    history_payload = _http_get_json(history_url, timeout)
    history_rows = history_payload.get("data") or []
    if not isinstance(history_rows, list):
        raise OfficialEtfSourceError("21Shares valuation history shape unexpected")
    history = []
    for row in history_rows:
        if not isinstance(row, dict):
            continue
        date = _normalise_date(row.get("valuation_date"))
        if not date:
            continue
        entry = dict(row)
        entry["valuation_date"] = date
        history.append(entry)
    history.sort(key=lambda row: row["valuation_date"])
    if not history:
        raise OfficialEtfSourceError(f"no dated valuation rows for {ticker}")

    distribution_url = f"{_TWENTY_ONE_SHARES_API}/staking_distribution/{ticker}"
    try:
        distribution_payload = _http_get_json(distribution_url, timeout)
        distributions = distribution_payload.get("data") or []
    except OfficialEtfSourceError:
        distributions = []

    latest = history[-1]
    quote = {}
    if _number(data.get("nav_per_unit")) is not None:
        quote["nav_per_unit"] = _number(data.get("nav_per_unit"))
        quote["nav_as_of"] = _normalise_date(data.get("valuation_date"))
    if _number(data.get("total_nav")) is not None:
        quote["aum"] = _number(data.get("total_nav"))
        quote["aum_as_of"] = _normalise_date(data.get("valuation_date"))
    if _number(data.get("total_units_outstanding")) is not None:
        quote["units_outstanding"] = _number(data.get("total_units_outstanding"))
    for source_key, target_key in (
        ("nav_per_share", "nav_per_share"),
        ("market_price", "market_price"),
        ("premium_discount", "premium_discount_pct"),
        ("index", "index"),
        ("daily_trading_volume", "volume"),
    ):
        value = _number(latest.get(source_key))
        if value is not None:
            quote[target_key] = value
    quote["market_price_as_of"] = latest.get("valuation_date")
    quote["history_last_updated"] = history_payload.get("lastUpdated")

    classification = {}
    for source_key, target_key in (
        ("product_name", "product_name"),
        ("jurisdiction", "jurisdiction"),
        ("product_category", "product_category"),
        ("inception_date", "inception_date"),
        ("unit_size", "unit_size"),
        ("currency", "currency"),
    ):
        value = data.get(source_key)
        if value is None:
            continue
        if source_key == "currency" and isinstance(value, dict):
            value = value.get("short_name")
        classification[target_key] = value

    field_dates = {
        "holdings": _normalise_date(data.get("valuation_date")),
        "quote": latest.get("valuation_date"),
        "history_start": history[0]["valuation_date"],
        "history_end": history[-1]["valuation_date"],
    }

    completeness = [
        "constituents come from the product_details API; valuation history is dated "
        "NAV and market-price rows, not OHLC",
        "constituent weight is published as a fraction and is converted to percent; "
        "weight_raw keeps the provider value",
        "notional exposure is not published on this route",
        "this trust files 10-Q/8-K style documents rather than NPORT-P, so no SEC "
        "holdings route was observed for it",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": field_dates["holdings"],
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "not_published",
        "scope_note": (
            "issuer constituent list is returned in full; cash is not part of it"
        ),
    }

    return {
        "ticker": ticker.upper(),
        "provider": "21shares",
        "source_url": details_url,
        "fetched_at": _now_utc(),
        "source_as_of": _max_date(field_dates.values()),
        "holdings": holdings,
        "quote": quote,
        "history": history,
        "classification": classification,
        "field_dates": field_dates,
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "distributions": distributions,
        "raw": {
            "product_details": data,
            "valuation_history_last_updated": history_payload.get("lastUpdated"),
        },
    }


# --------------------------------------------------------------------------
# Innovator (one all-funds holdings CSV)
# --------------------------------------------------------------------------


def _innovator_csv(timeout: int) -> str:
    """Return the all-funds holdings CSV, cached once per collector process."""
    with _INNOVATOR_CSV_LOCK:
        return _load_innovator_csv(timeout)


def _load_innovator_csv(timeout: int) -> str:
    cached = _INNOVATOR_CSV_CACHE.get(_INNOVATOR_HOLDINGS_URL)
    if cached is None:
        # The issuer answers 406 to an explicit text/csv Accept header, so the
        # default wildcard Accept is required for this route.
        body = _http_get(_INNOVATOR_HOLDINGS_URL, timeout)
        try:
            cached = body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise OfficialEtfSourceError("Innovator holdings CSV is not UTF-8") from exc
        _INNOVATOR_CSV_CACHE[_INNOVATOR_HOLDINGS_URL] = cached
    return cached


def _innovator_holding(raw: dict, ticker: str, date: str) -> dict:
    provider_ticker = _text(raw.get("StockTicker"))
    identifier = _text(raw.get("CUSIP"))
    shares = _number(raw.get("Shares"))
    market_value = _number(raw.get("MarketValue"))
    weight = _number(raw.get("Weightings"))
    name = _text(raw.get("SecurityName"))
    if name is None or shares is None or market_value is None or weight is None:
        raise OfficialEtfSourceError(
            f"malformed Innovator holdings row for {ticker}: {raw.get('SecurityName')!r}"
        )
    symbol = provider_ticker if provider_ticker and _PLAIN_TICKER.fullmatch(provider_ticker) else None
    return {
        "name": name,
        "symbol": symbol,
        "identifier": identifier,
        "identifier_type": "cusip" if identifier else None,
        "weight_pct": weight,
        "weight_basis": "provider_weightings_signed",
        "market_value": market_value,
        "shares": shares,
        "quantity": None,
        "as_of_date": date,
        "position_date": None,
        "provider_ticker": provider_ticker,
        "raw": raw,
    }


def _fetch_innovator(ticker: str, timeout: int) -> dict:
    csv_text = _innovator_csv(timeout)
    reader = csv.DictReader(io.StringIO(csv_text))
    fieldnames = list(reader.fieldnames or [])
    if "Account" not in fieldnames or "Date" not in fieldnames:
        raise OfficialEtfSourceError("Innovator holdings CSV header is missing Account or Date")

    selected = [
        row for row in reader
        if _text(row.get("Account")) and str(row["Account"]).strip().upper() == ticker.upper()
    ]
    if not selected:
        raise OfficialEtfSourceError(f"no Innovator holdings rows for {ticker}")

    dates = {_normalise_date(row.get("Date")) for row in selected}
    if None in dates:
        raise OfficialEtfSourceError(f"Innovator rows for {ticker} carry an unreadable Date")
    if len(dates) != 1:
        raise OfficialEtfSourceError(
            f"Innovator rows for {ticker} carry conflicting dates: {sorted(dates)}"
        )
    date = dates.pop()

    holdings = [_innovator_holding(row, ticker, date) for row in selected]

    shares_values = {_number(row.get("SharesOutstanding")) for row in selected}
    aum_values = {_number(row.get("NetAssets")) for row in selected}
    quote = {}
    if len(shares_values) == 1 and None not in shares_values:
        quote["shares_outstanding"] = shares_values.pop()
        quote["shares_outstanding_as_of"] = date
    if len(aum_values) == 1 and None not in aum_values:
        quote["aum"] = aum_values.pop()
        quote["aum_as_of"] = date

    field_dates = {
        "holdings": date,
        "shares_outstanding": quote.get("shares_outstanding_as_of"),
        "aum": quote.get("aum_as_of"),
    }

    completeness = [
        "holdings are every published row for this account in the issuer's all-funds "
        "holdings CSV, and all of them share one Date",
        "weights are the provider's signed Weightings values; long and short option legs, "
        "money market and Cash & Other stay exactly as published with no sum-to-100 check",
        "shares outstanding and AUM are published only when every selected row agrees on a "
        "finite value; otherwise they are omitted rather than guessed",
        "option legs carry a composite provider ticker, so symbol is set only for plain tickers",
        "the CSV carries no dated history, no fund classification and no notional exposure",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate",
        "scope_note": (
            "issuer publishes every holdings row for this account in one dated all-funds CSV"
        ),
    }

    return {
        "ticker": ticker.upper(),
        "provider": "innovator",
        "source_url": _INNOVATOR_HOLDINGS_URL,
        "fetched_at": _now_utc(),
        "source_as_of": date,
        "holdings": holdings,
        "quote": quote,
        "history": [],
        "classification": {"provider_account": ticker.upper()},
        "field_dates": field_dates,
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {
            "holdings_url": _INNOVATOR_HOLDINGS_URL,
            "csv_header": fieldnames,
            "holdings_rows": selected,
        },
    }


# --------------------------------------------------------------------------
# public entry point
# --------------------------------------------------------------------------


def fetch_official_etf(ticker: str, timeout: int = 30) -> dict:
    """Fetch the official issuer record for one supported ETF ticker."""
    if not isinstance(ticker, str):
        raise ValueError("ticker must be a string")
    symbol = ticker.strip().upper()
    if symbol not in SUPPORTED_TICKERS:
        raise ValueError(
            f"unsupported ticker {ticker!r}; supported: {', '.join(SUPPORTED_TICKERS)}"
        )
    if symbol in CORGI_TICKERS:
        return _fetch_corgi(symbol, timeout)
    if symbol in INNOVATOR_TICKERS:
        return _fetch_innovator(symbol, timeout)
    if symbol == "MWHS":
        return _fetch_skylar(symbol, timeout)
    return _fetch_twenty_one_shares(symbol, timeout)


def _main(argv) -> int:
    tickers = [item.upper() for item in argv] or list(SUPPORTED_TICKERS)
    failures = 0
    for ticker in tickers:
        try:
            record = fetch_official_etf(ticker)
        except (ValueError, OfficialEtfSourceError) as exc:
            failures += 1
            print(json.dumps({"ticker": ticker, "error": str(exc)}, ensure_ascii=False))
            continue
        summary = {
            "ticker": record["ticker"],
            "provider": record["provider"],
            "source_as_of": record["source_as_of"],
            "fetched_at": record["fetched_at"],
            "holdings": len(record["holdings"]),
            "history": len(record["history"]),
            "quote_keys": sorted(record["quote"].keys()),
            "field_dates": record["field_dates"],
        }
        print(json.dumps(summary, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
