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
import html
import io
import json
import math
import re
import sys
import threading
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
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
    "AJAN", "AJUL", "BMAR", "IBUF", "IDEC", "IFEB", "IJAN", "IJUL",
    "IJUN", "IMAR", "IMAY", "INOV", "JAJL", "JULH", "JULJ", "KAUG",
    "KDEC", "KJAN", "KJUN", "KMAR", "KMAY", "KOCT", "KSEP", "LJUL",
    "NAUG", "NDEC", "NFEB", "NJAN", "NJUL", "UFEB", "UJAN", "USEP",
    "XDQQ", "XTJA", "XTJL", "XTOC", "ZAUG", "ZDEK", "ZFEB", "ZJAN",
    "ZJUL", "ZNOV", "ZOCT", "ZSEP",
    "TBIL",
    "DWUS",
    "HYTR",
    "BIL",
    "BILS",
    "IWMW",
    "SPBC",
    "MWHS",
    "THYP",
    "LQDW",
    "IBGM",
    "XLBI",
    "XLCI",
    "XLFI",
    "BRZX",
    # AllianzIM buffer funds and ProShares funds with confirmed official routes.
    "JANT", "JANU", "JANW", "JNEU", "JULT", "JULU", "JULW", "MARU", "MAYU",
    "BITI", "EETH", "EUO", "SETH", "SVXY",
    "HXF",
)

CORGI_TICKERS = ("ACHX", "ARMA", "AVGC", "IOSX", "KEYX", "LRNX", "ONDC",
                 "CIFC", "EO", "GMEC", "IONC", "MIC", "ORAC", "XQTM",
                 "BRZX")

INNOVATOR_TICKERS = (
    "ACII", "BDEC", "BJUL", "BJUN", "BNOV", "BSTP", "EBUF", "EJAN",
    "EJUL", "IAPR", "PMAR", "PMAY", "PSTP", "QBUF", "RBUF", "TBJL",
    "AJAN", "AJUL", "BMAR", "IBUF", "IDEC", "IFEB", "IJAN", "IJUL",
    "IJUN", "IMAR", "IMAY", "INOV", "JAJL", "JULH", "JULJ", "KAUG",
    "KDEC", "KJAN", "KJUN", "KMAR", "KMAY", "KOCT", "KSEP", "LJUL",
    "NAUG", "NDEC", "NFEB", "NJAN", "NJUL", "UFEB", "UJAN", "USEP",
    "XDQQ", "XTJA", "XTJL", "XTOC", "ZAUG", "ZDEK", "ZFEB", "ZJAN",
    "ZJUL", "ZNOV", "ZOCT", "ZSEP",
)

_INNOVATOR_HOLDINGS_URL = "https://www.innovatoretfs.com/etf/xt_holdings.csv"
# The all-funds CSV carries every Innovator fund, so one cached body serves all
# enrolled members inside a single collector process.
_INNOVATOR_CSV_CACHE: dict = {}
_INNOVATOR_CSV_LOCK = threading.Lock()
_PLAIN_TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,6}$")

_FM_PAGE_URLS = {
    "TBIL": "https://www.fminvest.com/etfs/tbil-fm-us-treasury-3-month-bill-etf",
}
_FM_HOLDINGS_API = "https://www.fminvest.com/api/v1/etfs/{node_id}/holdings"

_ADVISORSHARES_HOLDINGS_URLS = {
    "DWUS": "https://advisorshares.com/wp-content/uploads/csv/holdings/AdvisorShares_DWUS_Holdings_File.csv",
}

_COUNTERPOINT_HOLDINGS_URL = "https://counterpointfunds.com/etfdata/holdings.csv"
_COUNTERPOINT_FUNDS = {
    "HYTR": {
        "portfolio_number": "1242",
        "portfolio_name": "Counterpoint High Yield Trend ETF",
    },
}

_SSGA_HOLDINGS_URLS = {
    "BIL": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bil.xlsx",
    "BILS": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-bils.xlsx",
    "XLBI": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlbi.xlsx",
    "XLCI": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlci.xlsx",
    "XLFI": "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-xlfi.xlsx",
}
# Expanded xlsx content is bounded before any worksheet is parsed.
_XLSX_EXPANDED_LIMIT = 20_000_000
_XLSX_MEMBER_LIMIT = 8_000_000

_SIMPLIFY_PAGE_URLS = {
    "SPBC": "https://www.simplify.us/etfs/spbc-simplify-us-equity-plus-bitcoin-strategy-etf",
}
_SIMPLIFY_TRACKER_SHEET = "simplify portfolio tracker"
# The provider's own Security Master Asset Group decides the quantity unit.
_SIMPLIFY_QUANTITY_UNITS = {"fund": "shares", "future": "contracts", "cash": "currency"}

_ISHARES_HOLDINGS_URLS = {
    "IWMW": ("https://www.ishares.com/us/products/336263/ishares-russell-2000-buywrite-etf/latest-holdings.csv",
             "iShares Russell 2000 BuyWrite ETF"),
    "LQDW": ("https://www.ishares.com/us/products/329120/ishares-investment-grade-corporate-bond-buywrite-strategy-etf/latest-holdings.csv",
             "iShares Investment Grade Corporate Bond BuyWrite Strategy ETF"),
    "IBGM": ("https://www.ishares.com/us/products/350032/ishares-ibonds-dec-2056-term-treasury-etf/latest-holdings.csv",
             "iShares\u00ae iBonds\u00ae Dec 2056 Term Treasury ETF"),
}
# These two publish a Name-headed first section and no provider ticker column. The first
# section is the fund's own portfolio; the later table in the same file is index lookthrough
# and is never read. Their quantity column is Par Value, not Quantity.
_ISHARES_NAME_HEADER_TICKERS = {"LQDW", "IBGM"}
# Identifier preference for a file that publishes no provider ticker.
_ISHARES_IDENTIFIER_COLUMNS = (("CUSIP", "cusip"), ("ISIN", "isin"), ("SEDOL", "sedol"))

# AllianzIM publishes the same dated portfolio columns the Innovator all-funds
# CSV carries, embedded as JSON state in each fund page. One page per fund; the
# row contract is the Innovator row contract.
_ALLIANZIM_PAGE_URLS = {
    "JANT": "https://www.allianzim.com/etfs/jant/",
    "JANU": "https://www.allianzim.com/etfs/janu/",
    "JANW": "https://www.allianzim.com/etfs/janw/",
    "JNEU": "https://www.allianzim.com/etfs/jneu/",
    "JULT": "https://www.allianzim.com/etfs/jult/",
    "JULU": "https://www.allianzim.com/etfs/julu/",
    "JULW": "https://www.allianzim.com/etfs/julw/",
    "MARU": "https://www.allianzim.com/etfs/maru/",
    "MAYU": "https://www.allianzim.com/etfs/mayu/",
}
# ProShares publishes a dated holdings table in each fund page. Exposure Weight
# is derivative/financing exposure, not a portfolio market-value weight, so the
# row keeps an explicit exposure basis and the notional stays separate.
# The issuer's not-published marker, shared by the cell reader and the parser.
_NOT_PUBLISHED = frozenset({"", "--", "-", "\u2014", "n/a", "none", "null"})

# The issuer publishes one header layout per fund family, with only the first
# label differing between the observed bodies. Any other sequence is refused.
_PROSHARES_HEADERS = (
    ("exposure weight", "ticker", "description", "exposure value (notional + gl)",
     "market value", "shares/contracts", "sedol number"),
    ("weight", "ticker", "description", "exposure value (notional + gl)",
     "market value", "shares/contracts", "sedol number"),
)
# MAST (mast-funds.com) publishes a dated holdings CSV per fund through the
# issuer's own download action; quantities are a mixed shares/contracts column.
_MASTFUNDS_CSV_URLS = {
    "HXF": "https://mast-funds.com/wp-admin/admin-post.php?action=download_holdings_csv&ticker=HXF",
}
_PROSHARES_PAGE_URLS = {
    "BITI": "https://www.proshares.com/our-etfs/leveraged-and-inverse/biti",
    "EETH": "https://www.proshares.com/our-etfs/strategic/eeth",
    "EUO": "https://www.proshares.com/our-etfs/leveraged-and-inverse/euo",
    "SETH": "https://www.proshares.com/our-etfs/leveraged-and-Inverse/seth",
    "SVXY": "https://www.proshares.com/our-etfs/strategic/svxy/",
}

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
        "the published row list is the snapshot scope; the page's summary "
        "holdingsCount is not used to infer unpublished rows",
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
# F/m (TBIL), AdvisorShares (DWUS), Counterpoint (HYTR)
# --------------------------------------------------------------------------


def _money(value):
    """Return a float from an issuer money string such as "$7,541.67M"."""
    text = _text(value)
    if text is None:
        return None
    multiplier = 1.0
    suffix = text[-1:].upper()
    if suffix in {"K", "M", "B", "T"}:
        multiplier = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[suffix]
        text = text[:-1]
    text = text.replace("$", "").replace(",", "").replace("%", "").strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    result = number * multiplier
    return result if math.isfinite(result) else None


def _html_text(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


def _fm_row_date(value) -> str | None:
    text = str(value or "")
    match = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', text)
    if match:
        return match.group(1)
    return _normalise_date(re.sub(r"<[^>]+>", " ", text))


def _fetch_fm(ticker: str, timeout: int) -> dict:
    """F/m: the issuer page binds the ticker and the holdings node id."""
    page_url = _FM_PAGE_URLS[ticker]
    html = _http_get(page_url, timeout, accept="text/html").decode("utf-8", errors="replace")
    text = _html_text(html)

    overview_start = text.find("Fund Overview")
    if overview_start < 0:
        raise OfficialEtfSourceError(f"Fund Overview block not found for {ticker}")
    overview = text[overview_start:overview_start + 1200]

    page_ticker = _text((re.search(r"Ticker\s+([A-Z][A-Z0-9.\-]{0,9})\b", overview) or [None, None])[1])
    if page_ticker is None or page_ticker.upper() != ticker.upper():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, page reports {page_ticker!r}"
        )

    as_of = _normalise_date((re.search(r"As of\s+(\d{2}/\d{2}/\d{4})", overview) or [None, None])[1])
    shares_out = _number((re.search(r"Shares Outstanding\s+([\d,]+(?:\.\d+)?)", overview) or [None, None])[1])
    net_assets = _money((re.search(r"Net Assets\s+(\$[\d,.]+\s*[KMBT]?)", overview) or [None, None])[1])
    nav = _money((re.search(r"\bNAV\s+(\$[\d,.]+)", overview) or [None, None])[1])
    closing = _money((re.search(r"Closing Price\s+(\$[\d,.]+)", overview) or [None, None])[1])

    settings = re.search(
        r'<script type="application/json" data-drupal-selector="drupal-settings-json">(.*?)</script>',
        html, re.S)
    node_id = None
    if settings:
        try:
            node_id = str((json.loads(settings.group(1)).get("etf") or {}).get("node_id") or "").strip()
        except json.JSONDecodeError:
            node_id = None
    if not node_id or not node_id.isdigit():
        raise OfficialEtfSourceError(f"issuer holdings node id not found for {ticker}")

    holdings_url = _FM_HOLDINGS_API.format(node_id=node_id)
    body = _http_get(holdings_url, timeout, accept="application/json")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OfficialEtfSourceError(f"unparseable issuer holdings JSON from {holdings_url}") from exc
    if not isinstance(payload, list) or not payload:
        raise OfficialEtfSourceError(f"no issuer holdings rows for {ticker}")

    holdings = []
    dates = set()
    for raw in payload:
        if not isinstance(raw, dict):
            raise OfficialEtfSourceError(f"malformed issuer holdings row for {ticker}")
        name = _text(re.sub(r"&amp;", "&", str(raw.get("field_name") or "")))
        identifier = _text(re.sub(r"&amp;", "&", str(raw.get("field_symbol") or "")))
        market_value = _money(raw.get("field_market_value"))
        par_value = _number(raw.get("field_par_value"))
        weight = _number(raw.get("field_weightings"))
        row_date = _fm_row_date(raw.get("field_as_of_date"))
        if name is None or market_value is None or weight is None or row_date is None:
            raise OfficialEtfSourceError(f"malformed issuer holdings row for {ticker}: {name!r}")
        dates.add(row_date)
        holdings.append({
            "name": name,
            "symbol": identifier if identifier and _PLAIN_TICKER.fullmatch(identifier) else None,
            "identifier": identifier,
            "identifier_type": "cusip" if identifier and re.fullmatch(r"[0-9A-Z]{9}", identifier) else "issuer_identifier",
            "weight_pct": weight,
            "weight_basis": "provider_weightings",
            "market_value": market_value,
            "par_value": par_value,
            "shares": None,
            "quantity": None,
            "as_of_date": row_date,
            "position_date": None,
            "raw": raw,
        })
    if len(dates) != 1:
        raise OfficialEtfSourceError(f"issuer holdings rows for {ticker} carry conflicting dates: {sorted(dates)}")
    holdings_date = dates.pop()

    quote = {}
    if shares_out is not None and as_of is not None:
        quote["shares_outstanding"] = shares_out
        quote["shares_outstanding_as_of"] = as_of
    if net_assets is not None and as_of is not None:
        quote["aum"] = net_assets
        quote["aum_as_of"] = as_of
    if nav is not None and as_of is not None:
        quote["nav"] = nav
        quote["nav_as_of"] = as_of
    if closing is not None and as_of is not None:
        quote["closing_price"] = closing
        quote["closing_price_as_of"] = as_of

    field_dates = {
        "holdings": holdings_date,
        "overview": as_of,
        "shares_outstanding": quote.get("shares_outstanding_as_of"),
        "aum": quote.get("aum_as_of"),
    }

    completeness = [
        "holdings are the issuer API's complete published set for this fund, dated "
        f"{holdings_date}",
        "the Fund Overview block is dated separately and supplies shares outstanding, "
        "net assets and NAV with that block's own date",
        "the holdings API publishes par value, not a share count, so shares stays null",
        "the holdings node id is bound to the ticker through the Fund Overview block "
        "on the issuer page",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": holdings_date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate",
        "scope_note": "issuer API publishes every holdings row for this fund under its node id",
    }

    return {
        "ticker": ticker.upper(),
        "provider": "fm",
        "source_url": holdings_url,
        "fetched_at": _now_utc(),
        "source_as_of": _max_date(field_dates.values()),
        "holdings": holdings,
        "quote": quote,
        "history": [],
        "classification": {"page_url": page_url},
        "field_dates": field_dates,
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"page_url": page_url, "node_id": node_id, "holdings_rows": payload},
    }


def _fetch_advisorshares(ticker: str, timeout: int) -> dict:
    """AdvisorShares: one per-fund CSV whose first row carries date and account."""
    url = _ADVISORSHARES_HOLDINGS_URLS[ticker]
    body = _http_get(url, timeout).decode("utf-8")
    reader = csv.DictReader(io.StringIO(body))
    required = {"Date", "Account Symbol", "Stock Ticker", "Security Number",
                "Security Description", "Shares/Par (Full)", "Price (Base)",
                "Traded Market Value (Base)", "Portfolio Weight %"}
    if not required <= set(reader.fieldnames or []):
        raise OfficialEtfSourceError("AdvisorShares holdings CSV header is incomplete")

    current_account = None
    current_date = None
    holdings = []
    dates = set()
    for raw in reader:
        account = _text(raw.get("Account Symbol"))
        if account:
            if account.upper() != ticker.upper():
                raise OfficialEtfSourceError(
                    f"issuer holdings file mixes funds: {account!r} appears in the {ticker} file"
                )
            current_account = account
        raw_date = _text(raw.get("Date"))
        if raw_date is None:
            # Only a blank cell inherits the file's first-row date.
            row_date = current_date
        else:
            row_date = _normalise_date(raw_date)
            if row_date is None:
                raise OfficialEtfSourceError(
                    f"unreadable holdings date for {ticker}: {raw_date!r}")
            current_date = row_date
        if current_account is None or current_date is None:
            raise OfficialEtfSourceError(f"holdings row before any account or date for {ticker}")
        name = _text(raw.get("Security Description"))
        shares = _number(raw.get("Shares/Par (Full)"))
        market_value = _number(raw.get("Traded Market Value (Base)"))
        weight = _number(raw.get("Portfolio Weight %"))
        if name is None or shares is None or market_value is None or weight is None:
            raise OfficialEtfSourceError(f"malformed holdings row for {ticker}: {name!r}")
        provider_ticker = _text(raw.get("Stock Ticker"))
        identifier = _text(raw.get("Security Number"))
        asset_group = _text(raw.get("Asset Group"))
        # Shares/Par holds currency for cash and money-market/par instruments;
        # that value stays available as provider_quantity but is never shares.
        par_instrument = asset_group in {"CA", "MM"} or provider_ticker is None
        dates.add(current_date)
        holdings.append({
            "name": name,
            "symbol": provider_ticker if provider_ticker and _PLAIN_TICKER.fullmatch(provider_ticker) else None,
            "identifier": identifier,
            "identifier_type": "cusip" if identifier and re.fullmatch(r"[0-9A-Z]{9}", identifier) else "issuer_identifier",
            "weight_pct": weight,
            "weight_basis": "provider_portfolio_weight_signed",
            "market_value": market_value,
            "shares": None if par_instrument else shares,
            "provider_quantity": shares,
            "quantity": None,
            "price": _number(raw.get("Price (Base)")),
            "asset_group": asset_group,
            "as_of_date": current_date,
            "position_date": None,
            "provider_ticker": provider_ticker,
            "raw": raw,
        })
    if not holdings:
        raise OfficialEtfSourceError(f"no holdings rows for {ticker}")
    if len(dates) != 1:
        raise OfficialEtfSourceError(f"holdings rows for {ticker} carry conflicting dates: {sorted(dates)}")
    date = dates.pop()

    completeness = [
        "holdings are every row of the issuer's per-fund holdings file, all carrying "
        f"the file's single date {date}",
        "the file publishes a signed portfolio weight and a cash row, so weights are "
        "kept signed with no sum-to-100 check",
        "the file publishes no shares outstanding or AUM, so quote stays empty",
        "only the first row carries the account symbol and date; later rows inherit both, "
        "and a nonblank unreadable date is refused instead of inherited",
        "Shares/Par holds currency on cash and money-market rows, so those rows keep the "
        "value in provider_quantity and leave shares null",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate",
        "scope_note": "issuer publishes one dated holdings file for this fund",
    }

    return {
        "ticker": ticker.upper(),
        "provider": "advisorshares",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": date,
        "holdings": holdings,
        "quote": {},
        "history": [],
        "classification": {"provider_account": ticker.upper()},
        "field_dates": {"holdings": date},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "holdings_rows": [row["raw"] for row in holdings]},
    }


def _fetch_counterpoint(ticker: str, timeout: int) -> dict:
    """Counterpoint: an all-funds CSV filtered by exact portfolio identity."""
    url = _COUNTERPOINT_HOLDINGS_URL
    identity = _COUNTERPOINT_FUNDS[ticker]
    body = _http_get(url, timeout).decode("utf-8")
    reader = csv.DictReader(io.StringIO(body))
    fields = set(reader.fieldnames or [])
    if not {"asOfDate", "portfolioNumber", "securityIdentifier", "shares",
            "marketValueBase", "marketValuePercent"} <= fields:
        raise OfficialEtfSourceError("Counterpoint holdings CSV header is incomplete")

    selected = []
    for raw in reader:
        number = _text(raw.get("portfolioNumber"))
        name = _text(raw.get("portfolioName")) or _text(raw.get("portoflioName"))
        if number != identity["portfolio_number"] or name != identity["portfolio_name"]:
            continue
        selected.append(raw)
    if not selected:
        raise OfficialEtfSourceError(
            f"no rows for {ticker} in the Counterpoint all-funds holdings file")
    # The provider's marketValuePercent column is a fraction of market value even
    # though its name says percent: for this portfolio the selected values sum to
    # 1.0 (0.005791436429 + 0.994391479537 - 0.000182915966 = 0.9999999999). The
    # contract is fixed to that evidence, never switched with the weights.

    holdings = []
    dates = set()
    for raw in selected:
        row_date = _normalise_date(str(raw.get("asOfDate") or "")[:10])
        description = _text(raw.get("securityDescriptionShort")) or _text(raw.get("securityDescriptionLong"))
        shares = _number(raw.get("shares"))
        market_value = _number(raw.get("marketValueBase"))
        weight = _number(raw.get("marketValuePercent"))
        if row_date is None or description is None or shares is None or market_value is None or weight is None:
            raise OfficialEtfSourceError(
                f"malformed Counterpoint holdings row for {ticker}: {description!r}")
        weight_pct = weight * 100.0
        weight_basis = "market_value_percent_fraction_converted"
        identifier = _text(raw.get("securityIdentifier"))
        provider_ticker = _text(raw.get("securityTicker"))
        dates.add(row_date)
        holdings.append({
            "name": description,
            "symbol": provider_ticker if provider_ticker and _PLAIN_TICKER.fullmatch(provider_ticker) else None,
            "identifier": identifier,
            "identifier_type": "cusip" if identifier and re.fullmatch(r"[0-9A-Z]{9}", identifier) else "issuer_identifier",
            "weight_pct": weight_pct,
            "weight_raw": weight,
            "weight_basis": weight_basis,
            "net_assets_percent": _number(raw.get("netAssetsPercent")),
            "market_value": market_value,
            "shares": shares,
            "quantity": None,
            "price": _number(raw.get("priceLocal")),
            "direction": _text(raw.get("longShortIndicator")),
            "country": _text(raw.get("country")),
            "as_of_date": row_date,
            "position_date": None,
            "provider_ticker": provider_ticker,
            "raw": raw,
        })
    if not holdings:
        raise OfficialEtfSourceError(
            f"no rows for {ticker} in the Counterpoint all-funds holdings file")
    if len(dates) != 1:
        raise OfficialEtfSourceError(f"holdings rows for {ticker} carry conflicting dates: {sorted(dates)}")
    date = dates.pop()

    completeness = [
        "the file is an all-funds file; only rows matching the exact portfolio number "
        f"and portfolio name for {ticker} are selected, so funds are never mixed",
        f"all selected rows carry the single date {date}",
        "the provider column named marketValuePercent is a fraction of market value: "
        "the selected values sum to 1.0, so the fixed conversion is *100 and weight_raw "
        "keeps the provider value",
        "signed rows (Receivables/Payables) and the long/short indicator are preserved",
        "the file publishes no shares outstanding or AUM, so quote stays empty",
    ]

    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate",
        "scope_note": "issuer publishes every row for this portfolio in one dated all-funds CSV",
    }

    return {
        "ticker": ticker.upper(),
        "provider": "counterpoint",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": date,
        "holdings": holdings,
        "quote": {},
        "history": [],
        "classification": {
            "portfolio_number": identity["portfolio_number"],
            "portfolio_name": identity["portfolio_name"],
        },
        "field_dates": {"holdings": date},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "holdings_rows": [row["raw"] for row in holdings]},
    }


# --------------------------------------------------------------------------
# State Street xlsx (BIL, BILS) and iShares csv (IWMW)
# --------------------------------------------------------------------------


_MONTHS = {"jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
           "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"}


def _day_month_year_date(value) -> str | None:
    """Parse an issuer date such as 09-Oct-2026."""
    text = _text(value)
    if text is None:
        return None
    match = re.search(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", text)
    if not match:
        match = re.search(r"([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})", text)
        if match:
            month, day, year = match.groups()
            month_number = _MONTHS.get(month.lower())
            return _normalise_date(f"{year}-{month_number}-{int(day):02d}") if month_number else None
        return _normalise_date(text)
    day, month, year = match.groups()
    month_number = _MONTHS.get(month.lower())
    if month_number is None:
        return None
    return _normalise_date(f"{year}-{month_number}-{int(day):02d}")


def _xlsx_column_index(reference) -> int:
    match = re.match(r"([A-Z]+)", str(reference or ""))
    if not match:
        return -1
    index = 0
    for char in match.group(1):
        index = index * 26 + (ord(char) - 64)
    if index > 16384:
        raise OfficialEtfSourceError("xlsx column exceeds worksheet bounds")
    return index - 1


def _xml_local(tag) -> str:
    """Local XML name, so namespace-less and namespaced xlsx parts both parse."""
    return str(tag).rsplit("}", 1)[-1]


def _xlsx_shared_strings(archive) -> list:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter() if _xml_local(node.tag) == "t")
            for item in root]


def _xlsx_sheet_rows(archive, target: str) -> list:
    root = ET.fromstring(archive.read(target))
    shared = _xlsx_shared_strings(archive)
    rows = []
    for row in root.iter():
        if _xml_local(row.tag) != "row":
            continue
        cells = {}
        for cell in row:
            if _xml_local(cell.tag) != "c":
                continue
            column = _xlsx_column_index(cell.get("r"))
            if column < 0:
                continue
            kind = cell.get("t")
            if kind == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter() if _xml_local(node.tag) == "t")
            else:
                raw = None
                for node in cell:
                    if _xml_local(node.tag) == "v":
                        raw = node.text
                        break
                if raw is None:
                    value = ""
                elif kind == "s":
                    try:
                        shared_index = int(raw)
                        if shared_index < 0:
                            raise IndexError("negative shared string index")
                        value = shared[shared_index]
                    except (ValueError, IndexError):
                        raise OfficialEtfSourceError("xlsx shared string index is invalid")
                else:
                    value = raw
            cells[column] = str(value).strip()
        width = (max(cells) + 1) if cells else 0
        rows.append([cells.get(position, "") for position in range(width)])
    return rows


def _xlsx_holdings_target(archive) -> str | None:
    if "xl/workbook.xml" not in archive.namelist():
        return None
    workbook = archive.read("xl/workbook.xml").decode("utf-8", errors="replace")
    relationships = {}
    if "xl/_rels/workbook.xml.rels" in archive.namelist():
        relationships = dict(re.findall(
            r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"',
            archive.read("xl/_rels/workbook.xml.rels").decode("utf-8", errors="replace")))
    for name, relationship_id in re.findall(r'<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', workbook):
        if name.strip().lower() != "holdings":
            continue
        target = relationships.get(relationship_id)
        if not target:
            continue
        target = target.lstrip("/")
        return target if target.startswith("xl/") else "xl/" + target
    return None


def _fetch_ssga(ticker: str, timeout: int) -> dict:
    """State Street daily holdings xlsx: explicit holdings sheet, bounded size."""
    url = _SSGA_HOLDINGS_URLS[ticker]
    body = _http_get(url, timeout)
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile as exc:
        raise OfficialEtfSourceError(f"unreadable xlsx from {url}") from exc
    members = archive.infolist()
    expanded = sum(item.file_size for item in members)
    if expanded > _XLSX_EXPANDED_LIMIT or any(item.file_size > _XLSX_MEMBER_LIMIT for item in members):
        raise OfficialEtfSourceError(f"xlsx expanded size exceeds the bound for {ticker}")

    target = _xlsx_holdings_target(archive)
    if target is None or target not in archive.namelist():
        raise OfficialEtfSourceError(f"holdings worksheet not found for {ticker}")
    rows = _xlsx_sheet_rows(archive, target)

    def label_value(label: str):
        for row in rows[:8]:
            for index, cell in enumerate(row):
                if cell.lower().startswith(label.lower()):
                    for value in row[index + 1:]:
                        if value:
                            return value
        return None

    sheet_ticker = label_value("Ticker Symbol")
    if sheet_ticker is None or sheet_ticker.upper() != ticker.upper():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, sheet reports {sheet_ticker!r}")
    as_of = _day_month_year_date(label_value("Holdings"))
    if as_of is None:
        raise OfficialEtfSourceError(f"holdings date is missing or invalid for {ticker}")

    header_index = None
    for index, row in enumerate(rows[:12]):
        lowered = [cell.lower() for cell in row]
        if "name" in lowered and "weight" in lowered:
            header_index = index
            break
    if header_index is None:
        raise OfficialEtfSourceError(f"holdings header not found for {ticker}")
    columns = {cell.lower(): position for position, cell in enumerate(rows[header_index]) if cell}
    if "market value" not in columns:
        raise OfficialEtfSourceError(f"holdings header lacks Market Value for {ticker}")

    holdings = []
    footer = None
    for row_index, row in enumerate(rows[header_index + 1:], start=header_index + 1):
        if not any(cell for cell in row):
            continue

        def value(label: str) -> str:
            position = columns.get(label)
            return row[position] if position is not None and position < len(row) else ""

        name = _text(value("name"))
        weight = _number(value("weight"))
        market_value = _number(value("market value"))
        if name == ("State Street Global Advisors (SSGA) is now State Street Investment Management. "
                    "Please click\u00a0here for more information.") and not value("weight") and not value("market value"):
            # Only the observed issuer note ends the portfolio. A malformed
            # holding must never masquerade as a footer and truncate the fund.
            for remaining in rows[row_index + 1:]:
                if any(position < len(remaining) and remaining[position].strip()
                       for key in ("weight", "market value", "identifier", "par value", "shares held")
                       if (position := columns.get(key)) is not None):
                    raise OfficialEtfSourceError(f"position values after the holdings footer for {ticker}")
            footer = name
            break
        if name is None or weight is None or market_value is None:
            raise OfficialEtfSourceError(f"malformed holdings row for {ticker}: {name!r}")
        identifier = _text(value("identifier"))
        shares_held = _number(value("shares held"))
        par_value = _number(value("par value"))
        if par_value is not None:
            provider_quantity, quantity_unit = par_value, "par_value"
        elif shares_held is not None:
            provider_quantity, quantity_unit = shares_held, "shares"
        else:
            provider_quantity, quantity_unit = None, None
        holdings.append({
            "name": name,
            "symbol": None,
            "identifier": identifier,
            "identifier_type": "cusip" if identifier and re.fullmatch(r"[0-9A-Z]{9}", identifier) else "issuer_identifier",
            "weight_pct": weight,
            "weight_basis": "provider_weight",
            "market_value": market_value,
            "notional_value": _number(value("notional value")),
            "par_value": par_value,
            "shares": shares_held if shares_held is not None else None,
            "provider_quantity": provider_quantity,
            "quantity_unit": quantity_unit,
            "coupon": _number(value("coupon")),
            "maturity": _text(value("maturity")),
            "sedol": _text(value("sedol")),
            "currency": _text(value("local currency")),
            "as_of_date": as_of,
            "position_date": None,
            "raw": {"row": row, "columns": columns},
        })
    if not holdings:
        raise OfficialEtfSourceError(f"no holdings rows for {ticker}")

    # A currency position such as "US DOLLAR" (999USDZ92) is a cash row even
    # when the worksheet never uses the word cash.
    has_cash_row = any("cash" in (row["name"] or "").lower()
                       or bool(re.fullmatch(r"999[A-Z]{3}Z\d{2}", row.get("identifier") or ""))
                       for row in holdings)
    completeness = [
        "holdings are every data row of the issuer's explicit holdings worksheet, "
        f"dated {as_of}",
        "par value is preserved as provider_quantity with unit par_value; it is not a "
        "share count, so shares stays null unless the file publishes Shares Held",
        "weights are the provider's own weights with no sum-to-100 check",
        "notional is kept separate from market value and is null when the file omits it",
        "the file publishes no dated history and no shares outstanding",
    ]
    if footer:
        completeness.append(f"the worksheet ends with a note row that is not a position: {footer[:120]}")
    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": as_of,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate" if has_cash_row else "not_published",
        "scope_note": "issuer publishes the complete holdings worksheet for this fund",
    }

    return {
        "ticker": ticker.upper(),
        "provider": "ssga",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": as_of,
        "holdings": holdings,
        "quote": {},
        "history": [],
        "classification": {"worksheet": target},
        "field_dates": {"holdings": as_of},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "expanded_bytes": expanded, "footer_note": footer},
    }


_ISHARES_QUANTITY_UNITS = {
    "EQUITY": "shares",
    "FUND": "fund_units",
    "CASH": "currency",
    "OPTION": "contracts",
}


def _ishares_named_holding(raw: dict, ticker: str, as_of: str) -> dict:
    """Row from an iShares first section that publishes no provider ticker column."""
    name = _text(raw.get("Name"))
    market_value = _number(raw.get("Market Value"))
    weight = _number(raw.get("Weight (%)"))
    if name is None or market_value is None or weight is None:
        raise OfficialEtfSourceError(f"malformed holdings row for {ticker}: {name!r}")
    kind = (_text(raw.get("Type")) or "").upper()
    asset_class = _text(raw.get("Asset Class"))
    identifier = None
    identifier_type = None
    for column, label in _ISHARES_IDENTIFIER_COLUMNS:
        value = _text(raw.get(column))
        if value:
            identifier, identifier_type = value, label
            break
    fixed_income = (asset_class or "").lower() == "fixed income"
    return {
        "name": name,
        "symbol": None,
        "identifier": identifier,
        "identifier_type": identifier_type,
        "weight_pct": weight,
        "weight_basis": "provider_weight_signed",
        "market_value": market_value,
        "notional_value": _number(raw.get("Notional Value")),
        "shares": None,
        "provider_quantity": _number(raw.get("Par Value")),
        "provider_quantity_field": "Par Value",
        "quantity_unit": (
            "par_value" if fixed_income
            else _ISHARES_QUANTITY_UNITS.get(kind, kind.lower() or None)
        ),
        "price": _number(raw.get("Price")),
        "strike_price": _number(raw.get("Strike price")),
        "location": _text(raw.get("Location")),
        "exchange": _text(raw.get("Exchange")),
        "currency": _text(raw.get("Currency")),
        "maturity": _text(raw.get("Maturity")),
        "sector": _text(raw.get("Sector")),
        "asset_class": asset_class,
        "as_of_date": as_of,
        "position_date": None,
        "instrument_type": kind or None,
        "raw": raw,
    }


def _fetch_ishares(ticker: str, timeout: int) -> dict:
    """iShares latest-holdings csv: first section only, Type-aware quantities."""
    url, expected_name = _ISHARES_HOLDINGS_URLS[ticker]
    body = _http_get(url, timeout).decode("utf-8", errors="replace")
    lines = [line.rstrip("\r") for line in body.split("\n")]
    if not lines:
        raise OfficialEtfSourceError(f"empty holdings file for {ticker}")
    fund_name = lines[0].strip()
    if fund_name.lower() != expected_name.lower():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, file reports {fund_name!r}")

    as_of = None
    shares_outstanding = None
    for line in lines[:10]:
        lowered = line.lower()
        if lowered.startswith("fund holdings as of"):
            as_of = _day_month_year_date(line.split(",", 1)[1].strip().strip('"'))
        elif lowered.startswith("shares outstanding"):
            shares_outstanding = _number(line.split(",", 1)[1].strip().strip('"'))

    if as_of is None:
        raise OfficialEtfSourceError(f"holdings date is missing or invalid for {ticker}")
    # The two name-headed files carry no provider ticker column; their first section is the
    # fund's own portfolio and the later lookthrough table is never read.
    name_header = ticker in _ISHARES_NAME_HEADER_TICKERS
    header_prefix = "Name," if name_header else "Ticker,"
    header_index = next(
        (index for index, line in enumerate(lines) if line.startswith(header_prefix)), None
    )
    if header_index is None:
        raise OfficialEtfSourceError(f"holdings table not found for {ticker}")
    section = []
    for line in lines[header_index + 1:]:
        if not line.strip():
            break
        section.append(line)
    if not section:
        raise OfficialEtfSourceError(f"no holdings rows for {ticker}")

    reader = csv.DictReader(io.StringIO("\n".join([lines[header_index]] + section)))
    holdings = []
    for raw in reader:
        if name_header:
            holdings.append(_ishares_named_holding(raw, ticker, as_of))
            continue
        name = _text(raw.get("Name"))
        provider_ticker = _text(raw.get("Ticker"))
        market_value = _number(raw.get("Market Value"))
        weight = _number(raw.get("Weight (%)"))
        if name is None or market_value is None or weight is None:
            raise OfficialEtfSourceError(f"malformed holdings row for {ticker}: {name!r}")
        kind = (_text(raw.get("Type")) or "").upper()
        quantity = _number(raw.get("Quantity"))
        shares = quantity if kind == "EQUITY" else None
        # A currency code or an option's underlying code is not an equity symbol.
        symbol = provider_ticker if (kind in {"EQUITY", "FUND"} and provider_ticker
                                     and _PLAIN_TICKER.fullmatch(provider_ticker)) else None
        holdings.append({
            "name": name,
            "symbol": symbol,
            "identifier": provider_ticker,
            "identifier_type": "provider_ticker",
            "weight_pct": weight,
            "weight_basis": "provider_weight_signed",
            "market_value": market_value,
            "notional_value": _number(raw.get("Notional Value")),
            "shares": shares,
            "provider_quantity": quantity,
            "quantity_unit": _ISHARES_QUANTITY_UNITS.get(kind, kind.lower() or None),
            "price": _number(raw.get("Price")),
            "strike_price": _number(raw.get("Strike price")),
            "location": _text(raw.get("Location")),
            "exchange": _text(raw.get("Exchange")),
            "currency": _text(raw.get("Currency")),
            "maturity": _text(raw.get("Maturity")),
            "as_of_date": as_of,
            "position_date": None,
            "instrument_type": kind or None,
            "raw": raw,
        })

    quote = {}
    if shares_outstanding is not None and as_of is not None:
        quote["shares_outstanding"] = shares_outstanding
        quote["shares_outstanding_as_of"] = as_of

    has_cash_row = any(
        (row["instrument_type"] or "") == "CASH"
        or (row.get("asset_class") or "").lower() == "cash"
        for row in holdings
    )
    shared_completeness = [
        "holdings are the fund's own published portfolio section, dated "
        f"{as_of}; the later index-constituent section of the same file is deliberately "
        "not used",
        "notional value is kept separate from market value",
        "weights are the provider's signed weights, so derivative rows may be negative "
        "with no sum-to-100 check",
        "shares outstanding carries the file's own explicit as-of date and no scaling "
        "guess is applied",
    ]
    if name_header:
        completeness = [
            shared_completeness[0],
            "this file publishes no provider ticker column, so symbol stays null and the "
            "row identifier is the provider CUSIP, ISIN or SEDOL when present",
            "the provider quantity is the file's Par Value column, named literally as its "
            "source field; fixed-income rows carry unit par_value and no par value is "
            "relabelled as shares",
            shared_completeness[1],
            shared_completeness[2],
            shared_completeness[3],
        ]
    else:
        completeness = [
            shared_completeness[0],
            "quantities keep the provider value with a Type-based unit: EQUITY shares, FUND "
            "fund_units, CASH currency, OPTION contracts; normalized shares is set only for "
            "EQUITY rows",
            shared_completeness[1],
            shared_completeness[2],
            shared_completeness[3],
        ]
    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": as_of,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate" if has_cash_row else "not_published",
        "scope_note": "issuer publishes the fund's own holdings section with cash and derivatives",
    }

    return {
        "ticker": ticker.upper(),
        "provider": "ishares",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": as_of,
        "holdings": holdings,
        "quote": quote,
        "history": [],
        "classification": {"fund_name": fund_name},
        "field_dates": {"holdings": as_of, "shares_outstanding": as_of},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "fund_name": fund_name},
    }


# --------------------------------------------------------------------------
# Simplify (SPBC) dated EOD tracker xlsx
# --------------------------------------------------------------------------


def _xlsx_named_sheet_target(archive, wanted: str):
    """Resolve a named worksheet through the workbook relationships.

    Relationship and sheet attributes are read one by one because their order
    differs between issuers (Simplify writes Target before Id).
    """
    if "xl/workbook.xml" not in archive.namelist():
        return None
    workbook = archive.read("xl/workbook.xml").decode("utf-8", errors="replace")
    relationships = {}
    if "xl/_rels/workbook.xml.rels" in archive.namelist():
        rels = archive.read("xl/_rels/workbook.xml.rels").decode("utf-8", errors="replace")
        for element in re.findall(r"<Relationship[^>]*/>", rels):
            id_match = re.search(r'Id="([^"]+)"', element)
            target_match = re.search(r'Target="([^"]+)"', element)
            if id_match and target_match:
                relationships[id_match.group(1)] = target_match.group(1)
    for element in re.findall(r"<sheet[^>]*/>", workbook):
        name_match = re.search(r'name="([^"]+)"', element)
        id_match = re.search(r'r:id="([^"]+)"', element)
        if not name_match or not id_match:
            continue
        if name_match.group(1).strip().lower() != wanted:
            continue
        target = relationships.get(id_match.group(1))
        if not target:
            continue
        target = target.lstrip("/")
        return target if target.startswith("xl/") else "xl/" + target
    return None


def _simplify_identifier_type(identifier):
    if identifier and re.fullmatch(r"[0-9A-Z]{9}", identifier):
        return "cusip"
    if identifier and re.fullmatch(r"[A-Z]{2}[0-9A-Z]{9}[0-9]", identifier):
        return "isin"
    return "issuer_identifier" if identifier else None


def _fetch_simplify(ticker: str, timeout: int) -> dict:
    """Simplify EOD tracker xlsx, discovered from the fund page on each call."""
    page_url = _SIMPLIFY_PAGE_URLS[ticker]
    page = _http_get(page_url, timeout, accept="text/html").decode("utf-8", errors="replace")
    if ticker.upper() not in page.upper():
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: {page_url} does not mention {ticker}")

    trackers = {}
    for year, month, day in re.findall(
            r"https://www\.simplify\.us/sites/default/files/excel_holdings/"
            r"(\d{4})_(\d{2})_(\d{2})_Simplify_Portfolio_EOD_Tracker\.xlsx", page):
        key = f"{year}-{month}-{day}"
        trackers[key] = ("https://www.simplify.us/sites/default/files/excel_holdings/"
                         f"{year}_{month}_{day}_Simplify_Portfolio_EOD_Tracker.xlsx")
    if not trackers:
        raise OfficialEtfSourceError(
            f"no dated Simplify EOD tracker link on {page_url}; the route requires a published "
            f"{ticker} tracker URL")
    url = trackers[max(trackers)]

    body = _http_get(url, timeout)
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile as exc:
        raise OfficialEtfSourceError(f"unreadable xlsx from {url}") from exc
    members = archive.infolist()
    expanded = sum(item.file_size for item in members)
    if expanded > _XLSX_EXPANDED_LIMIT or any(item.file_size > _XLSX_MEMBER_LIMIT for item in members):
        raise OfficialEtfSourceError(f"xlsx expanded size exceeds the bound for {ticker}")

    target = _xlsx_named_sheet_target(archive, _SIMPLIFY_TRACKER_SHEET)
    if target is None or target not in archive.namelist():
        raise OfficialEtfSourceError(f"tracker worksheet not found for {ticker}")
    rows = _xlsx_sheet_rows(archive, target)

    header_index = None
    for index, row in enumerate(rows[:6]):
        lowered = [cell.lower() for cell in row]
        if "fund name" in lowered and "security description" in lowered:
            header_index = index
            break
    if header_index is None:
        raise OfficialEtfSourceError(f"tracker header not found for {ticker}")
    columns = {cell.lower(): position for position, cell in enumerate(rows[header_index]) if cell}
    for required in ("fund name", "security description", "quantity",
                     "market value/exposure", "weight"):
        if required not in columns:
            raise OfficialEtfSourceError(f"tracker header lacks {required} for {ticker}")

    tracker_date = None
    for row in rows[:header_index]:
        for cell in row:
            day = _normalise_date(cell)
            if day:
                tracker_date = day
                break
        if tracker_date:
            break
    if tracker_date is None:
        raise OfficialEtfSourceError(f"tracker date not found for {ticker}")
    if tracker_date != max(trackers):
        raise OfficialEtfSourceError(f"tracker date contradicts its published URL for {ticker}")

    def value(row, label):
        position = columns.get(label)
        return row[position] if position is not None and position < len(row) else ""

    holdings = []
    shares_values = set()
    aum_values = set()
    nav_values = set()
    for row in rows[header_index + 1:]:
        if not any(cell for cell in row):
            continue
        fund = _text(value(row, "fund name"))
        if fund is None or fund.upper() != ticker.upper():
            continue
        name = _text(value(row, "security description"))
        quantity = _number(value(row, "quantity"))
        market_value = _number(value(row, "market value/exposure"))
        weight = _number(value(row, "weight"))
        if name is None or quantity is None or market_value is None or weight is None:
            raise OfficialEtfSourceError(f"malformed tracker row for {ticker}: {name!r}")
        group = (_text(value(row, "security master asset group")) or "").lower()
        provider_ticker = _text(value(row, "ticker"))
        cusip = _text(value(row, "cusip"))
        isin = _text(value(row, "isin"))
        sedol = _text(value(row, "sedol"))
        identifier = cusip if cusip and re.fullmatch(r"[0-9A-Z]{9}", cusip) else (isin or sedol)
        holdings.append({
            "name": name,
            "symbol": provider_ticker if provider_ticker and _PLAIN_TICKER.fullmatch(provider_ticker) else None,
            "identifier": identifier,
            "identifier_type": _simplify_identifier_type(identifier),
            "weight_pct": weight * 100.0,
            "weight_raw": weight,
            "weight_basis": "provider_weight_fraction_converted",
            "market_value": market_value if group in {"fund", "cash"} else None,
            "provider_market_value_or_exposure": market_value,
            "notional_value": None,
            "shares": quantity if group == "fund" else None,
            "provider_quantity": quantity,
            "quantity_unit": _SIMPLIFY_QUANTITY_UNITS.get(group, group or None),
            "price": _number(value(row, "bny prices")),
            "sedol": sedol,
            "isin": isin,
            "cusip": cusip,
            "asset_group": group or None,
            "as_of_date": tracker_date,
            "position_date": None,
            "provider_ticker": provider_ticker,
            "raw": row,
        })
        shares_values.add(_number(value(row, "shares out")))
        aum_values.add(_number(value(row, "total mv")))
        nav_values.add(_number(value(row, "official nav")))
    if not holdings:
        raise OfficialEtfSourceError(f"no tracker rows for {ticker}")

    quote = {}
    if len(shares_values) == 1 and None not in shares_values:
        quote["shares_outstanding"] = shares_values.pop()
        quote["shares_outstanding_as_of"] = tracker_date
    if len(aum_values) == 1 and None not in aum_values:
        quote["aum"] = aum_values.pop()
        quote["aum_as_of"] = tracker_date
    if len(nav_values) == 1 and None not in nav_values:
        quote["nav"] = nav_values.pop()
        quote["nav_as_of"] = tracker_date

    has_cash_row = any(row["asset_group"] == "cash" for row in holdings)
    completeness = [
        "holdings are every tracker row whose FUND NAME matches this fund, all dated "
        f"{tracker_date}",
        "the tracker URL is date-stamped and is rediscovered from the fund page on each "
        "call; the newest published tracker date is used",
        "the provider states weights as fractions of market value; the fixed conversion is "
        "*100 and weight_raw keeps the provider value, with no sum gate because futures "
        "exposure can push the total above 1",
        "quantity units come from the provider's Security Master Asset Group: Fund shares, "
        "Future contracts, Cash currency",
        "the Notional Coverage column holds an uncalculated spreadsheet formula, so notional "
        "stays null rather than being invented",
        "no OHLC history is published on this route",
    ]
    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": tracker_date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate" if has_cash_row else "not_published",
        "scope_note": "issuer publishes every tracker row for this fund in one dated EOD workbook",
    }

    return {
        "ticker": ticker.upper(),
        "provider": "simplify",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": tracker_date,
        "holdings": holdings,
        "quote": quote,
        "history": [],
        "classification": {"page_url": page_url, "worksheet": target},
        "field_dates": {"holdings": tracker_date,
                        **{key: tracker_date for key in ("shares_outstanding", "aum", "nav") if key in quote}},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"page_url": page_url, "tracker_url": url, "expanded_bytes": expanded},
    }


# --------------------------------------------------------------------------
# public entry point
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# AllianzIM (nine buffer funds) and ProShares (five funds)
# --------------------------------------------------------------------------


def _balanced_json_slice(text: str, start: int, opener: str, closer: str) -> str | None:
    """Slice one balanced JSON literal. Page script is never executed."""
    if start < 0 or start >= len(text) or text[start] != opener:
        return None
    depth = 0
    quote = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return None


def _html_cell(fragment: str) -> str | None:
    """One table cell as text, or None for the issuer's not-published marker."""
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()
    return None if text.lower() in _NOT_PUBLISHED else text


def _fetch_allianzim(ticker: str, timeout: int) -> dict:
    """AllianzIM fund page: the dated portfolio is inline JSON state.

    The page script is never executed. The state literal is sliced by bracket
    balance and parsed as JSON, then rows use the Innovator contract because the
    issuer publishes the same columns. NetAssets is total fund net assets,
    SharesOutstanding is the fund's share count, and Price is the instrument's
    own price, never the ETF price or a per-share NAV.
    """
    url = _ALLIANZIM_PAGE_URLS[ticker]
    page = _http_get(url, timeout, accept="text/html").decode("utf-8", errors="replace")
    marker = page.find("curPageState")
    if marker < 0:
        raise OfficialEtfSourceError(f"AllianzIM page state not found for {ticker}")
    state = _balanced_json_slice(page, page.find("{", marker), "{", "}")
    if state is None:
        raise OfficialEtfSourceError(f"AllianzIM page state is unreadable for {ticker}")
    fund_name = re.search(r'fundName:\s*"([^"]{1,140})"', state)
    if fund_name is None:
        raise OfficialEtfSourceError(f"AllianzIM fund name is missing for {ticker}")
    table = re.search(r"holdings:\s*\{\s*data:\s*\[", state)
    if table is None:
        raise OfficialEtfSourceError(f"AllianzIM holdings table not found for {ticker}")
    rows_json = _balanced_json_slice(state, table.end() - 1, "[", "]")
    if rows_json is None:
        raise OfficialEtfSourceError(f"AllianzIM holdings rows are unreadable for {ticker}")
    try:
        rows = json.loads(rows_json.replace("\\/", "/"))
    except json.JSONDecodeError as exc:
        raise OfficialEtfSourceError(f"AllianzIM holdings JSON is malformed for {ticker}") from exc
    if not isinstance(rows, list) or not rows:
        raise OfficialEtfSourceError(f"no AllianzIM holdings rows for {ticker}")
    if not all(isinstance(row, dict) for row in rows):
        raise OfficialEtfSourceError(f"AllianzIM holdings row is not an object for {ticker}")
    accounts = {_text(row.get("Account")) for row in rows}
    if accounts != {ticker}:
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, page reports {sorted(a for a in accounts if a)}")
    dates = {_normalise_date(row.get("Date")) for row in rows}
    if None in dates or len(dates) != 1:
        raise OfficialEtfSourceError(
            f"AllianzIM rows for {ticker} carry conflicting or unreadable dates: {sorted(str(d) for d in dates)}")
    date = dates.pop()
    holdings = [_innovator_holding(row, ticker, date) for row in rows]
    shares_values = {_number(row.get("SharesOutstanding")) for row in rows}
    aum_values = {_number(row.get("NetAssets")) for row in rows}
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
    has_cash = any((row.get("identifier") or "").lower() == "cash&other" for row in holdings)
    completeness = [
        "holdings are every published row for this fund in the issuer's own dated "
        "portfolio table, and all of them share one Date",
        "rows are normalized with the Innovator row contract because the issuer "
        "publishes the same columns: signed Weightings, CUSIP identity, option legs "
        "kept with a composite provider ticker so symbol stays null",
        "NetAssets is the fund's total net assets (AUM) and SharesOutstanding is the "
        "fund's share count; the row Price is the instrument's own price and is never "
        "used as the ETF price or a per-share NAV",
        "weights stay exactly as published and signed, with no sum-to-100 check",
        "the page carries no dated history and no fund classification",
    ]
    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate" if has_cash else "not_published",
        "scope_note": (
            "issuer publishes the fund's own dated portfolio rows in the fund page state"
        ),
    }
    return {
        "ticker": ticker.upper(),
        "provider": "allianzim",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": date,
        "holdings": holdings,
        "quote": quote,
        "history": [],
        "classification": {"provider_account": ticker.upper(), "fund_name": fund_name.group(1)},
        "field_dates": field_dates,
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "holdings_rows": rows},
    }


def _proshares_header(cells: list) -> tuple:
    """Presentation-normalized header labels; only whitespace is collapsed."""
    return tuple(" ".join((cell or "").split()).lower() for cell in cells)


def _proshares_number(value, ticker: str, label: str):
    """Strict provider-local numeric cell.

    Recognized not-published markers stay None. Any other non-empty cell must
    parse to a finite number, otherwise the row is refused: a malformed
    published value must never become a missing value. Only the formatting the
    saved bodies actually show is accepted (currency symbol, thousands
    separators, percent suffix).
    """
    if value is None:
        return None
    text = " ".join(str(value).split())
    if text.lower() in _NOT_PUBLISHED:
        return None
    cleaned = text.replace("$", "").replace(",", "").replace("%", "").strip()
    if not cleaned or cleaned.lower() in _NOT_PUBLISHED:
        return None
    try:
        number = float(cleaned)
    except ValueError as exc:
        raise OfficialEtfSourceError(
            f"malformed ProShares {label} cell for {ticker}: {value!r}") from exc
    if not math.isfinite(number):
        raise OfficialEtfSourceError(
            f"non-finite ProShares {label} cell for {ticker}: {value!r}")
    return number


def _fetch_proshares(ticker: str, timeout: int) -> dict:
    """ProShares fund page: a dated holdings table driven by derivative exposure.

    Exposure Weight is the issuer's exposure measure (notional plus gain/loss),
    not a market-value portfolio weight, so it keeps the explicit
    ``provider_exposure_signed`` basis while the exposure value is stored as
    notional_value. Market value, the provider quantity and the SEDOL identifier
    stay separate, and a not-published cell stays null rather than zero.
    """
    url = _PROSHARES_PAGE_URLS[ticker]
    page = _http_get(url, timeout, accept="text/html").decode("utf-8", errors="replace")
    title = re.search(r"<title>(.*?)</title>", page, re.S | re.I)
    reported = title.group(1).split("|")[0].strip().upper() if title else None
    canonical = re.search(r'rel="canonical"[^>]*href="([^"]+)"', page, re.I)
    canonical_path = canonical.group(1).rstrip("/").lower() if canonical else None
    if reported != ticker or (canonical_path is not None
                              and not canonical_path.endswith(f"/{ticker.lower()}")):
        raise OfficialEtfSourceError(
            f"issuer identity mismatch: asked {ticker}, page reports {reported!r}")
    table = re.search(r'id="holdings"(.*?)</table>', page, re.S | re.I)
    if table is None:
        raise OfficialEtfSourceError(f"ProShares holdings table not found for {ticker}")
    section = table.group(1)
    heading = re.search(r"as of\s+(\d{1,2}/\d{1,2}/\d{4})", _html_text(section), re.I)
    date = _normalise_date(heading.group(1)) if heading else None
    if date is None:
        raise OfficialEtfSourceError(f"ProShares holdings date is missing for {ticker}")
    table_rows = re.findall(r"<tr[^>]*>(.*?)</tr>", section, re.S | re.I)
    if not table_rows:
        raise OfficialEtfSourceError(f"ProShares holdings table is empty for {ticker}")

    def cells_of(row_html: str) -> list:
        return [_html_cell(cell)
                for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.S | re.I)]

    header = cells_of(table_rows[0])
    if len(header) != 7 or _proshares_header(header) not in _PROSHARES_HEADERS:
        raise OfficialEtfSourceError(
            f"ProShares holdings header is unknown for {ticker}: {header!r}")
    holdings = []
    for row_html in table_rows[1:]:
        cells = cells_of(row_html)
        if not cells:
            continue
        if len(cells) != 7:
            raise OfficialEtfSourceError(
                f"ProShares holdings row arity {len(cells)} for {ticker}: {cells!r}")
        weight_cell, ticker_cell, description, exposure_cell, market_cell, quantity_cell, sedol_cell = cells
        name = description
        if name is None:
            raise OfficialEtfSourceError(f"malformed ProShares holdings row for {ticker}: {cells!r}")
        symbol = ticker_cell if ticker_cell and _PLAIN_TICKER.fullmatch(ticker_cell) else None
        weight = _proshares_number(weight_cell, ticker, "exposure weight")
        notional = _proshares_number(exposure_cell, ticker, "exposure value")
        market_value = _proshares_number(market_cell, ticker, "market value")
        quantity = _proshares_number(quantity_cell, ticker, "shares/contracts")
        holdings.append({
            "name": name,
            "symbol": symbol,
            "identifier": sedol_cell,
            "identifier_type": "sedol" if sedol_cell else None,
            "weight_pct": weight,
            "weight_basis": "provider_exposure_signed",
            "market_value": market_value,
            "notional_value": notional,
            "shares": None,
            "provider_quantity": quantity,
            "provider_quantity_field": "Shares/Contracts",
            "quantity_unit": None,
            "price": None,
            "as_of_date": date,
            "position_date": None,
            "provider_ticker": ticker_cell,
            "raw": {
                "exposure_weight": weight_cell, "ticker": ticker_cell, "description": description,
                "exposure_value": exposure_cell, "market_value": market_cell,
                "shares_contracts": quantity_cell, "sedol": sedol_cell,
            },
        })
    if not holdings:
        raise OfficialEtfSourceError(f"no ProShares holdings rows for {ticker}")
    if all(row["weight_pct"] is None and row["notional_value"] is None for row in holdings):
        raise OfficialEtfSourceError(f"ProShares rows for {ticker} publish neither exposure nor notional")
    has_cash = any("NET OTHER ASSETS" in row["name"].upper() for row in holdings)
    completeness = [
        "holdings are every published row in the issuer's dated holdings table, "
        "which shares one as-of date",
        "Exposure Weight is the issuer's derivative/financing exposure (notional plus "
        "gain/loss), recorded with the explicit provider_exposure_signed basis; it is "
        "not a portfolio market-value weight and is never normalized or summed to 100",
        "the exposure value is stored as notional_value and stays separate from market "
        "value; a not-published cell (shown as --) stays null rather than zero",
        "the Shares/Contracts column is preserved as provider_quantity with its literal "
        "source label and no unit assertion, and normalized shares stays null",
        "SEDOL is carried as the row identifier and never as a symbol; the instrument "
        "ticker is a symbol only when it is a plain ticker",
        "cash and residual rows keep a null weight when the issuer does not publish one",
    ]
    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "aggregated" if has_cash else "not_published",
        "scope_note": (
            "issuer publishes the fund's own dated holdings table including derivative "
            "exposure, market value and residual rows"
        ),
    }
    return {
        "ticker": ticker.upper(),
        "provider": "proshares",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": date,
        "holdings": holdings,
        "quote": {},
        "history": [],
        "classification": {"provider_account": ticker.upper()},
        "field_dates": {"holdings": date, "shares_outstanding": None, "aum": None},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "holdings_table_columns": [
            "Exposure Weight", "Ticker", "Description", "Exposure Value (Notional + GL)",
            "Market Value", "Shares/Contracts", "SEDOL Number"]},
    }


def _published_cell_number(value, ticker: str, label: str):
    """Strict provider-local numeric cell: markers stay null, malformed refuses."""
    if value is None:
        return None
    text = " ".join(str(value).split())
    if text.lower() in _NOT_PUBLISHED:
        return None
    cleaned = text.replace("$", "").replace(",", "").replace("%", "").strip()
    if not cleaned or cleaned.lower() in _NOT_PUBLISHED:
        return None
    try:
        number = float(cleaned)
    except ValueError as exc:
        raise OfficialEtfSourceError(
            f"malformed MAST {label} cell for {ticker}: {value!r}") from exc
    if not math.isfinite(number):
        raise OfficialEtfSourceError(f"non-finite MAST {label} cell for {ticker}: {value!r}")
    return number


def _fetch_mastfunds(ticker: str, timeout: int) -> dict:
    """MAST fund holdings CSV: dated futures and cash rows exactly as published.

    The CSV columns are Date,Ticker,Security Type,CUSIP,Sedol,Description,
    Quantity,Portfolio Weight. Its Ticker cell names the holding (futures legs
    carry composite codes, cash is blank), never the fund, so identity comes
    from the issuer URL bound to the ticker plus the single dated snapshot.
    Quantity is a mixed shares/contracts figure: it stays provider_quantity with
    its literal source label and no unit assertion. Signed and oversized
    published weights (including a cash line above 100%) are preserved as is.
    """
    url = _MASTFUNDS_CSV_URLS[ticker]
    body = _http_get(url, timeout, accept="text/csv").decode("utf-8-sig", errors="replace")
    raw = csv.reader(io.StringIO(body))
    fields = [str(field).strip() for field in next(raw, [])]
    expected = ["Date", "Ticker", "Security Type", "CUSIP", "Sedol", "Description",
                "Quantity", "Portfolio Weight"]
    if fields != expected:
        raise OfficialEtfSourceError(
            f"MAST holdings CSV header is not the expected layout for {ticker}: {fields!r}")
    rows = []
    for index, values in enumerate(raw, start=2):
        if not any(" ".join(str(value).split()) for value in values):
            continue  # only a genuinely blank record is skipped
        if len(values) != len(expected):
            raise OfficialEtfSourceError(
                f"MAST holdings row {index} for {ticker} does not match the published "
                f"{len(expected)}-column layout: {values!r}")
        row = dict(zip(fields, values))
        if _text(row.get("Date")) is None or _text(row.get("Description")) is None:
            raise OfficialEtfSourceError(
                f"MAST holdings row {index} for {ticker} is missing its Date or Description")
        rows.append(row)
    if not rows:
        raise OfficialEtfSourceError(f"no MAST holdings rows for {ticker}")
    dates = {_normalise_date(row.get("Date")) for row in rows}
    if None in dates or len(dates) != 1:
        raise OfficialEtfSourceError(
            f"MAST rows for {ticker} carry conflicting or unreadable dates: {sorted(str(d) for d in dates)}")
    date = dates.pop()
    holdings = []
    for row in rows:
        name = _text(row.get("Description"))
        quantity = _published_cell_number(row.get("Quantity"), ticker, "quantity")
        weight = _published_cell_number(row.get("Portfolio Weight"), ticker, "portfolio weight")
        provider_ticker = _text(row.get("Ticker"))
        sedol = _text(row.get("Sedol"))
        cusip = _text(row.get("CUSIP"))
        identifier = cusip or sedol
        holdings.append({
            "name": name,
            "symbol": provider_ticker if provider_ticker and _PLAIN_TICKER.fullmatch(provider_ticker) else None,
            "identifier": identifier,
            "identifier_type": "cusip" if (identifier and identifier == cusip) else ("sedol" if identifier else None),
            "weight_pct": weight,
            "weight_basis": "provider_portfolio_weight_signed",
            "market_value": None,
            "notional_value": None,
            "shares": None,
            "provider_quantity": quantity,
            "provider_quantity_field": "Quantity",
            "quantity_unit": None,
            "price": None,
            "as_of_date": date,
            "position_date": None,
            "provider_ticker": provider_ticker,
            "instrument_type": _text(row.get("Security Type")),
            "raw": row,
        })
    has_cash = any((row["instrument_type"] or "").upper() == "CASH" for row in holdings)
    completeness = [
        "holdings are every published row in the issuer's dated holdings CSV, which "
        "shares one Date",
        "weights are the provider's signed Portfolio Weight values, kept exactly as "
        "published with no sum-to-100 check and no normalization of the cash line",
        "Quantity is a mixed shares/contracts column, preserved as provider_quantity "
        "with its literal source label and no unit assertion",
        "CUSIP or SEDOL is the row identifier and the issuer Ticker is a symbol only "
        "when it is a plain ticker; composite futures codes stay provider_ticker",
        "market value, price, notional, NAV and history are not published in this "
        "file and stay null rather than being derived",
    ]
    holdings_snapshot = {
        "full_published_snapshot": True,
        "identity": ticker.upper(),
        "snapshot_date": date,
        "position_date": None,
        "row_count": len(holdings),
        "cash_treatment": "separate" if has_cash else "not_published",
        "scope_note": "issuer publishes the fund's own dated holdings CSV rows",
    }
    return {
        "ticker": ticker.upper(),
        "provider": "mastfunds",
        "source_url": url,
        "fetched_at": _now_utc(),
        "source_as_of": date,
        "holdings": holdings,
        "quote": {},
        "history": [],
        "classification": {"provider_account": ticker.upper()},
        "field_dates": {"holdings": date, "shares_outstanding": None, "aum": None},
        "completeness": completeness,
        "holdings_snapshot": holdings_snapshot,
        "raw": {"holdings_url": url, "csv_header": fields, "holdings_rows": rows},
    }


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
    if symbol in _FM_PAGE_URLS:
        return _fetch_fm(symbol, timeout)
    if symbol in _ADVISORSHARES_HOLDINGS_URLS:
        return _fetch_advisorshares(symbol, timeout)
    if symbol in _COUNTERPOINT_FUNDS:
        return _fetch_counterpoint(symbol, timeout)
    if symbol in _SSGA_HOLDINGS_URLS:
        return _fetch_ssga(symbol, timeout)
    if symbol in _ISHARES_HOLDINGS_URLS:
        return _fetch_ishares(symbol, timeout)
    if symbol in _ALLIANZIM_PAGE_URLS:
        return _fetch_allianzim(symbol, timeout)
    if symbol in _PROSHARES_PAGE_URLS:
        return _fetch_proshares(symbol, timeout)
    if symbol in _MASTFUNDS_CSV_URLS:
        return _fetch_mastfunds(symbol, timeout)
    if symbol in _SIMPLIFY_PAGE_URLS:
        return _fetch_simplify(symbol, timeout)
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
