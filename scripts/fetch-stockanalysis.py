#!/usr/bin/env python3
"""
StockAnalysis source fetcher — REST JSON layer and public table surfaces.

The stock financial-statement pages use SvelteKit/devalue payloads; this fetcher
normalizes those pages as cross-check candidates while keeping StockAnalysis as
candidate data, not valuation SSOT. It also captures stable REST-shaped endpoints
for ETF holdings/overview/history/quote and stock overview/history/quote, plus
high-value public table surfaces such as new ETFs, IPOs, corporate actions,
market movers, industry maps, and ETF provider pages.

Output:
  data/stockanalysis/etfs/{TICKER}.json
  data/stockanalysis/stocks/{TICKER}.json
  data/stockanalysis/surfaces/{NAME}.json
  data/stockanalysis/index.json
  data/yf/finance/{TICKER}.json
  data/yf/etf-details/{TICKER}.json
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
SCRIPT_DIR = ROOT / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_supply_state import DataSupplyStateStore, canonical_sha256, deterministic_event_id


OUT_DIR = ROOT / "data" / "stockanalysis"
PUBLIC_DIR = ROOT / "100xfenok-next" / "public" / "data" / "stockanalysis"
YF_OUT_DIR = ROOT / "data" / "yf" / "finance"
YF_PUBLIC_DIR = ROOT / "100xfenok-next" / "public" / "data" / "yf" / "finance"
YF_ETF_DETAIL_OUT_DIR = ROOT / "data" / "yf" / "etf-details"
DATA_SUPPLY_STATE_ROOT = ROOT / "data" / "admin" / "data-supply-state" / "v1"
SCHEMA_VERSION = "stockanalysis/v1"
BASE_URL = "https://stockanalysis.com"
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
USER_AGENT = "Mozilla/5.0 feno-stockanalysis-fetcher/1.0"
DEFAULT_INCREMENTAL_ETF_LIMIT = 120
DEFAULT_INCREMENTAL_ETF_MAX_AGE_HOURS = 720
DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS = 7
DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES = 3
PENDING_LEDGER_REL_PATH = "backfill/pending_ledger.json"
INCREMENTAL_PLAN_REL_PATH = "backfill/incremental_plan_latest.json"
MISSING_DETAIL_RECONCILE_REL_PATH = "backfill/missing_detail_reconcile_latest.json"
ENDPOINT_CANARY_REL_PATH = "canary/endpoint_latest.json"
ENDPOINT_CANARY_TICKERS = ("VYMI", "SPY", "GOLI")
FENOK_EDGE_ETF_DAILY1Y_FETCHABLE_PLAN_REL_PATH = "admin/fenok-edge-etf-daily1y-fetchable-plan.json"
FENOK_ETF_CORE_DAILY_BASKET_REL_PATH = "admin/fenok-etf-core-daily-basket.json"
DAILY_1Y_MIN_ROWS = 200
DAILY_1Y_HISTORY_EVIDENCE_POLICY = {
    "min_rows": 20,
    "min_density": 0.80,
    "max_internal_gap_days": 15,
    "max_latest_age_business_days": 10,
    "cross_provider_start_tolerance_days": 7,
    "declared_start_tolerance_days": 30,
    "provider_truncation_days": 30,
    "required_age_days": 365,
}
NON_DIRECTIONAL_SHORT_RE = re.compile(
    r"\b(?:"
    r"short[-\s]?(?:term|duration|maturity|intermediate)"
    r"|short[-\s]+to[-\s]+intermediate[-\s]+term"
    r"|short[-\s]+(?:high[-\s]+yield[-\s]+)?(?:muni|municipal)"
    r"|short[-\s]+treasury[-\s]+index"
    r"|ultra[-\s]?short(?:[-\s]+(?:bond|duration|income|maturity|term|treasury|credit|municipal|muni|corporate|cash|government))?"
    r")\b",
    flags=re.IGNORECASE,
)
SINGLE_STOCK_UNDERLYING_TICKERS = {
    "AA", "AAL", "AAPL", "ABNB", "ADBE", "AMD", "AMZN", "APP", "ARM", "AVGO",
    "BABA", "COIN", "CRWD", "EL", "F", "GOOG", "GOOGL", "HOOD", "INTC", "LLY",
    "META", "MSTR", "MSFT", "MU", "NFLX", "NKE", "NVDA", "ORCL", "PLTR", "SMCI",
    "TSLA", "TSM", "UNH", "WMT",
}
NON_SINGLE_STOCK_UNDERLYING_TOKENS = {
    "BTC", "ETH", "SOL", "XRP", "VIX",
}
NON_SINGLE_STOCK_CONTEXT_RE = re.compile(
    r"\b(?:"
    r"bitcoin|ethereum|ether|xrp|solana|crypto|futures?|volatility|vix"
    r"|index|innovation\s+100|nasdaq|s&p|russell|dow|treasury|bond|gold|silver|oil|gas"
    r")\b",
    flags=re.IGNORECASE,
)
ETF_CLASSIFICATION_ROW_KEYS = {
    "classification",
    "is_leveraged",
    "leverage_factor",
    "is_inverse",
    "is_single_stock",
    "underlying",
}
ETF_DETAIL_ENRICHMENT_ROW_KEYS = ETF_CLASSIFICATION_ROW_KEYS | {
    "expenseRatio",
    "expense_ratio",
    "dividendYield",
    "dividend_yield",
    "sharesOut",
    "beta",
    "inceptionDate",
    "provider_page",
    "etf_website",
    "performance",
}

DEFAULT_ETFS = [
    "SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "SMH", "SOXX",
    "SSO", "QLD", "DDM", "ROM", "UPRO", "TQQQ", "SOXL", "TNA",
    "USD", "UWM", "FNGU", "KORU", "UTSL", "DFEN", "FAS", "TMF",
    "NVDL", "NVDG", "PTIR", "PLTG", "AVGX", "AVGG", "TSLL",
    "ELIL", "CRWL", "ORCX", "MUU", "TSMG", "APPX", "MSTU",
    "OKLL", "CWVX", "BITU", "ETHT", "STRC", "SGOV", "BIL", "BILS",
]
DEFAULT_STOCKS = [
    "AAPL", "NVDA", "PLTR", "MSFT", "AMZN", "GOOGL", "META", "TSLA",
    "AVGO", "AMD", "JPM", "UNH", "XOM", "COST", "KO", "PG",
    "GOOG", "TSM", "MU", "BRK.B", "LLY", "BRK.A", "WMT", "ASML",
    "INTC", "V", "JNJ", "ORCL", "CSCO", "LRCX", "AMAT", "MA",
    "CAT", "ARM", "ABBV", "BAC", "CVX", "GE", "NFLX", "MS",
]
HISTORY_PERIOD_ENDPOINTS = {
    "daily_1y": {"range": "1Y", "period": "Daily"},
    "weekly_1y": {"range": "1Y", "period": "Weekly"},
    "monthly_1y": {"range": "1Y", "period": "Monthly"},
    "weekly_3y": {"range": "3Y", "period": "Weekly"},
    "monthly_3y": {"range": "3Y", "period": "Monthly"},
    "monthly_5y": {"range": "5Y", "period": "Monthly"},
}
DEFAULT_HISTORY_GAP_PERIODS = ("monthly_3y", "monthly_5y")
MONTH_NAME_TO_NUMBER = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}
FINANCIAL_STATEMENT_PATHS = {
    "income": "financials",
    "balance_sheet": "financials/balance-sheet",
    "cash_flow": "financials/cash-flow-statement",
    "ratios": "financials/ratios",
}
FINANCIAL_PERIODS = ("annual", "quarterly")
MIN_FINANCIAL_FIELD_COUNT = 20
MIN_FINANCIAL_PERIOD_COUNT = {
    "annual": 3,
    "quarterly": 4,
}

SURFACE_DEFINITIONS = {
    "new_etfs": {
        "path": "/etf/list/new/__data.json?x-sveltekit-invalidated=01",
        "page_path": "/etf/list/new/",
        "format": "svelte_devalue",
        "group": "etf",
        "priority": "p0",
        "role": "new ETF launch radar",
    },
    "etf_screener": {
        "path": "/etf/screener/__data.json?x-sveltekit-invalidated=01",
        "page_path": "/etf/screener/",
        "format": "svelte_devalue",
        "group": "etf",
        "priority": "p0",
        "role": "ETF universe enrichment and ranking cross-check",
    },
    "etf_provider_blackrock": {
        "path": "/etf/provider/blackrock/",
        "group": "etf_provider",
        "priority": "p0",
        "role": "large passive manager ETF catalog",
    },
    "etf_provider_proshares": {
        "path": "/etf/provider/proshares/",
        "group": "etf_provider",
        "priority": "p0",
        "role": "leveraged ETF provider catalog",
    },
    "list_bitcoin_etfs": {
        "path": "/list/bitcoin-etfs/",
        "group": "theme_list",
        "priority": "p0",
        "role": "thematic ETF list seed",
    },
    "ipos_recent": {
        "path": "/ipos/",
        "group": "ipo",
        "priority": "p0",
        "role": "recent IPO performance and upcoming IPO sidebar",
    },
    "ipos_statistics": {
        "path": "/ipos/statistics/",
        "group": "ipo",
        "priority": "p0",
        "role": "IPO activity statistics and market cycle context",
    },
    "ipos_calendar": {
        "path": "/ipos/calendar/",
        "group": "ipo",
        "priority": "p0",
        "role": "upcoming IPO calendar",
    },
    "ipos_filings": {
        "path": "/ipos/filings/",
        "group": "ipo",
        "priority": "p0",
        "role": "new IPO filing radar",
    },
    "ipos_withdrawn": {
        "path": "/ipos/withdrawn/",
        "group": "ipo",
        "priority": "p0",
        "role": "withdrawn IPO risk/off-cycle signal",
    },
    "actions_recent": {
        "path": "/actions/__data.json?x-sveltekit-invalidated=01",
        "page_path": "/actions/",
        "format": "svelte_devalue",
        "group": "corporate_actions",
        "priority": "p0",
        "role": "corporate action event tape",
    },
    "actions_splits": {
        "path": "/actions/splits/",
        "group": "corporate_actions",
        "priority": "p0",
        "role": "split and reverse-split tape",
    },
    "market_gainers": {
        "path": "/markets/gainers/",
        "group": "market_movers",
        "priority": "p0",
        "role": "daily top gainers",
    },
    "market_losers": {
        "path": "/markets/losers/",
        "group": "market_movers",
        "priority": "p0",
        "role": "daily top losers",
    },
    "market_active": {
        "path": "/markets/active/",
        "group": "market_movers",
        "priority": "p0",
        "role": "most active stocks",
    },
    "market_premarket": {
        "path": "/markets/premarket/",
        "group": "market_movers",
        "priority": "p0",
        "role": "premarket gainers/losers",
    },
    "market_afterhours": {
        "path": "/markets/afterhours/",
        "group": "market_movers",
        "priority": "p0",
        "role": "after-hours gainers/losers",
    },
    "market_gainers_week": {
        "path": "/markets/gainers/week/",
        "group": "market_movers",
        "priority": "p0",
        "role": "one-week momentum leaders",
    },
    "market_gainers_month": {
        "path": "/markets/gainers/month/",
        "group": "market_movers",
        "priority": "p0",
        "role": "one-month momentum leaders",
    },
    "market_losers_ytd": {
        "path": "/markets/losers/ytd/",
        "group": "market_movers",
        "priority": "p0",
        "role": "YTD downside leaders",
    },
    "earnings_calendar": {
        "path": "/stocks/earnings-calendar/__data.json?x-sveltekit-invalidated=01",
        "page_path": "/stocks/earnings-calendar/",
        "format": "svelte_devalue",
        "group": "earnings",
        "priority": "p0",
        "role": "earnings calendar with EPS/revenue estimates and timing",
    },
    "industries": {
        "path": "/stocks/industry/",
        "group": "industry",
        "priority": "p0",
        "role": "sector grouped industry map",
    },
    "industries_all": {
        "path": "/stocks/industry/all/",
        "group": "industry",
        "priority": "p0",
        "role": "flat industry map",
    },
    "sector_technology": {
        "path": "/stocks/sector/technology/",
        "group": "industry",
        "priority": "p0",
        "role": "sector constituent sample",
    },
    "industry_semiconductors": {
        "path": "/stocks/industry/semiconductors/",
        "group": "industry",
        "priority": "p0",
        "role": "industry constituent sample",
    },
}

SURFACE_SETS = {
    "core": tuple(SURFACE_DEFINITIONS.keys()),
    "events": (
        "new_etfs", "ipos_recent", "ipos_statistics", "ipos_calendar",
        "ipos_filings", "ipos_withdrawn", "actions_recent", "actions_splits",
        "earnings_calendar",
    ),
    "movers": (
        "market_gainers", "market_losers", "market_active", "market_premarket",
        "market_afterhours", "market_gainers_week", "market_gainers_month",
        "market_losers_ytd",
    ),
    "industry": ("industries", "industries_all", "sector_technology", "industry_semiconductors"),
    "etf": ("new_etfs", "etf_screener", "etf_provider_blackrock", "etf_provider_proshares", "list_bitcoin_etfs"),
}

SURFACE_STAMP_ROUTES = {
    "market_events": "/market/events",
    "sectors": "/sectors",
    "etf_center": "/etfs",
}


class ETFUniverseParser(HTMLParser):
    """Extract ETF list table rows from StockAnalysis HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict] = []
        self._in_tr = False
        self._in_td = False
        self._cells: list[str] = []
        self._cell_text: list[str] = []
        self._symbol: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_tr = True
            self._cells = []
            self._symbol = None
        elif self._in_tr and tag == "td":
            self._in_td = True
            self._cell_text = []
        elif self._in_td and tag == "a":
            href = dict(attrs).get("href") or ""
            match = re.fullmatch(r"/etf/([a-z0-9.\-]+)/", href)
            if match:
                self._symbol = clean_symbol(match.group(1))

    def handle_data(self, data: str) -> None:
        if self._in_td:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._in_td:
            text = normalize_space("".join(self._cell_text))
            self._cells.append(text)
            self._cell_text = []
            self._in_td = False
        elif tag == "tr" and self._in_tr:
            if self._symbol and len(self._cells) >= 2:
                aum_raw = self._cells[3] if len(self._cells) > 3 else None
                row = {
                    "ticker": self._symbol,
                    "name": self._cells[1],
                    "category": self._cells[2] if len(self._cells) > 2 else None,
                    "aum_raw": aum_raw,
                    "aum": parse_suffix_number(aum_raw),
                }
                self.rows.append({key: value for key, value in row.items() if value is not None})
            self._in_tr = False
            self._in_td = False
            self._cells = []
            self._cell_text = []
            self._symbol = None


class HTMLTableParser(HTMLParser):
    """Extract generic HTML table headers, rows, and first-link metadata."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[dict] = []
        self._table_depth = 0
        self._current_table: dict | None = None
        self._in_tr = False
        self._in_cell = False
        self._cell_tag = ""
        self._cell_text: list[str] = []
        self._cell_links: list[str] = []
        self._row: list[dict] = []
        self._row_has_header = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "table":
            if self._table_depth == 0:
                self._current_table = {"headers": [], "rows": []}
            self._table_depth += 1
        elif self._table_depth and tag == "tr":
            self._in_tr = True
            self._row = []
            self._row_has_header = False
        elif self._in_tr and tag in {"th", "td"}:
            self._in_cell = True
            self._cell_tag = tag
            self._cell_text = []
            self._cell_links = []
            if tag == "th":
                self._row_has_header = True
        elif self._in_cell and tag == "a":
            href = attrs_dict.get("href")
            if href:
                self._cell_links.append(href)

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"th", "td"} and self._in_cell:
            text = normalize_space("".join(self._cell_text))
            self._row.append(
                {
                    "text": text,
                    "links": self._cell_links[:],
                    "tag": self._cell_tag,
                }
            )
            self._in_cell = False
            self._cell_tag = ""
            self._cell_text = []
            self._cell_links = []
        elif tag == "tr" and self._in_tr:
            self._flush_row()
        elif tag == "table" and self._table_depth:
            self._table_depth -= 1
            if self._table_depth == 0 and self._current_table is not None:
                if self._current_table["headers"] or self._current_table["rows"]:
                    self.tables.append(self._current_table)
                self._current_table = None

    def _flush_row(self) -> None:
        if not self._row or self._current_table is None:
            self._in_tr = False
            return

        texts = [cell["text"] for cell in self._row]
        if self._row_has_header and not self._current_table["headers"]:
            self._current_table["headers"] = texts
        else:
            headers = self._current_table["headers"] or [f"Column {idx + 1}" for idx in range(len(self._row))]
            row = {}
            for idx, cell in enumerate(self._row):
                header = headers[idx] if idx < len(headers) else f"Column {idx + 1}"
                key = slug_key(header)
                row[key] = cell["text"]
                if cell["links"]:
                    row[f"{key}_href"] = normalize_href(cell["links"][0])
            if any(value for key, value in row.items() if not key.endswith("_href")):
                self._current_table["rows"].append(row)

        self._row = []
        self._row_has_header = False
        self._in_tr = False


def utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_iso() -> str:
    return utc_iso(datetime.now(timezone.utc))


def load_stock_detail_supply():
    import data_supply_stock_detail

    return data_supply_stock_detail


def collection_date(value: str | None) -> str | None:
    """Normalize a collection timestamp/date to an exact real-calendar UTC date."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    day = parsed.astimezone(timezone.utc).date()
    return day.isoformat() if day <= datetime.now(timezone.utc).date() else None


def epoch_source_timestamp(value) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    seconds = float(value) / 1000 if abs(float(value)) >= 100_000_000_000 else float(value)
    try:
        parsed = datetime.fromtimestamp(seconds, timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    if parsed > datetime.now(timezone.utc) + timedelta(days=1):
        return None
    return utc_iso(parsed)


def date_source_timestamp(value) -> str | None:
    day = collection_date(value)
    return f"{day}T00:00:00Z" if day else None


def quote_source_timestamp(quote: dict | None) -> str | None:
    if not isinstance(quote, dict):
        return None
    timestamp = epoch_source_timestamp(quote.get("ts"))
    source_day = collection_date(quote.get("td"))
    if timestamp and (not source_day or timestamp[:10] == source_day):
        return timestamp
    return date_source_timestamp(source_day)


def latest_history_source_timestamp(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    history_periods = normalized.get("history_periods") if isinstance(normalized.get("history_periods"), dict) else {}
    candidates = [
        normalized.get("history"),
        history_periods.get("daily_1y"),
        data.get("history_1y"),
    ]
    days = []
    for rows in candidates:
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            day = collection_date(row.get("date") or row.get("t") or row.get("time"))
            if day:
                days.append(day)
    return date_source_timestamp(max(days)) if days else None


def stockanalysis_detail_source_timestamp(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    return (
        quote_source_timestamp(raw.get("quote"))
        or quote_source_timestamp(normalized.get("quote"))
        or latest_history_source_timestamp(payload)
    )


def yahoo_detail_source_timestamp(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    if not data and isinstance(raw.get("yf"), dict):
        data = raw["yf"]
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    return epoch_source_timestamp(info.get("regularMarketTime")) or latest_history_source_timestamp(payload)


def normalize_space(value: str | None) -> str:
    return " ".join(str(value or "").split())


def slug_key(header: str) -> str:
    text = normalize_space(header).lower()
    text = text.replace("%", " pct ").replace("#", " rank ")
    text = text.replace("&", " and ").replace(".", "")
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text or "field"


def normalize_href(href: str) -> str:
    if href.startswith("https://") or href.startswith("http://"):
        return href
    if href.startswith("/"):
        return f"{BASE_URL}{href}"
    return href


def extract_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    return normalize_space(re.sub(r"<[^>]+>", " ", match.group(1)))


def decode_svelte_data(data: list) -> object:
    seen = {}

    def dec_ref(index: int):
        if index == -1:
            return None
        if index < -1:
            return None
        if not isinstance(index, int) or index < 0 or index >= len(data):
            raise ValueError(f"devalue reference out of range: {index!r}")
        if index in seen:
            return seen[index]
        raw = data[index]
        if isinstance(raw, dict):
            out = {}
            seen[index] = out
            for key, value in raw.items():
                out[key] = dec(value)
            return out
        if isinstance(raw, list):
            out = []
            seen[index] = out
            out.extend(dec(value) for value in raw)
            return out
        return raw

    def dec(value):
        if isinstance(value, int):
            return dec_ref(value)
        if isinstance(value, dict):
            return {key: dec(child) for key, child in value.items()}
        if isinstance(value, list):
            return [dec(child) for child in value]
        return value

    return dec_ref(0)


def extract_svelte_node(payload: dict, required_keys: tuple[str, ...] = ()) -> dict:
    fallback = None
    for node in reversed(payload.get("nodes") or []):
        data = node.get("data") if isinstance(node, dict) else None
        if not isinstance(data, list) or not data:
            continue
        decoded = decode_svelte_data(data)
        if not isinstance(decoded, dict):
            continue
        if required_keys and any(key in decoded for key in required_keys):
            return decoded
        fallback = decoded if fallback is None else fallback
    if isinstance(fallback, dict):
        return fallback
    raise ValueError("Svelte data node not found")


def extract_financial_node(payload: dict) -> dict:
    candidates = []
    nodes = payload.get("nodes") or []
    for node in nodes:
        data = node.get("data") if isinstance(node, dict) else None
        if not isinstance(data, list) or not data:
            continue
        decoded = decode_svelte_data(data)
        if isinstance(decoded, dict) and "financialData" in decoded:
            candidates.append(decoded)
    if not candidates:
        raise ValueError(f"financialData node not found in {len(nodes)} nodes")
    return candidates[-1]


def normalize_financial_statement(ticker: str, statement: str, decoded: dict) -> dict:
    financial_data = decoded.get("financialData") or {}
    row_map = decoded.get("map") or []
    periods = financial_data.get("datekey") if isinstance(financial_data, dict) else []
    rows = []
    if isinstance(row_map, list):
        for meta in row_map:
            if not isinstance(meta, dict):
                continue
            field = meta.get("id")
            values = financial_data.get(field) if isinstance(financial_data, dict) else None
            if not field or not isinstance(values, list):
                continue
            if isinstance(periods, list) and periods:
                # Periods are newest-first; short source rows omit trailing older history.
                if len(values) < len(periods):
                    values = values + [None] * (len(periods) - len(values))
                elif len(values) > len(periods):
                    values = values[: len(periods)]
            rows.append(
                {
                    "field": field,
                    "title": meta.get("title") or field,
                    "format": meta.get("format"),
                    "values": values,
                }
            )

    return {
        "ticker": ticker.upper(),
        "statement": decoded.get("statement") or statement,
        "period": decoded.get("period"),
        "head": decoded.get("head"),
        "details": decoded.get("details"),
        "periods": periods if isinstance(periods, list) else [],
        "fiscal_years": financial_data.get("fiscalYear") if isinstance(financial_data, dict) else None,
        "rows": rows,
        "field_count": len(rows),
    }


def validate_financial_statement(statement: dict) -> None:
    period = statement.get("period")
    rows = statement.get("rows") or []
    periods = statement.get("periods") or []
    min_periods = MIN_FINANCIAL_PERIOD_COUNT.get(str(period), 1)
    if len(rows) < MIN_FINANCIAL_FIELD_COUNT:
        raise ValueError(f"financial statement below field floor: {statement.get('statement')} {period} rows={len(rows)}")
    if len(periods) < min_periods:
        raise ValueError(f"financial statement below period floor: {statement.get('statement')} {period} periods={len(periods)}")
    for row in rows:
        values = row.get("values")
        if not isinstance(values, list) or len(values) != len(periods):
            raise ValueError(f"financial row value/period mismatch: {statement.get('statement')} {period} {row.get('field')}")


def fetch_financial_statement(ticker: str, statement: str, period: str, timeout: int) -> dict:
    path = FINANCIAL_STATEMENT_PATHS[statement]
    suffix = "?p=quarterly" if period == "quarterly" else ""
    endpoint = f"/stocks/{ticker.lower()}/{path}/__data.json{suffix}"
    payload = fetch_json(endpoint, timeout)
    decoded = extract_financial_node(payload)
    normalized = normalize_financial_statement(ticker, statement, decoded)
    normalized["endpoint"] = endpoint
    validate_financial_statement(normalized)
    return normalized


def fetch_financials(ticker: str, timeout: int) -> dict:
    statements = {}
    for period in FINANCIAL_PERIODS:
        period_statements = {}
        for statement in FINANCIAL_STATEMENT_PATHS:
            period_statements[statement] = fetch_financial_statement(ticker, statement, period, timeout)
        statements[period] = period_statements
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker.upper(),
        "fetched_at": now_iso(),
        "role": "financial statement cross-check candidate; not valuation SSOT",
        "statements": statements,
        "summary": {
            period: {
                statement: {
                    "field_count": payload.get("field_count"),
                    "period_count": len(payload.get("periods") or []),
                    "period": payload.get("period"),
                }
                for statement, payload in period_statements.items()
            }
            for period, period_statements in statements.items()
        },
    }


def flatten_earnings_calendar(decoded: dict) -> list[dict]:
    records = []
    for week in decoded.get("earnings") or []:
        if not isinstance(week, dict):
            continue
        week_of = week.get("weekOf")
        for day in week.get("days") or []:
            if not isinstance(day, dict):
                continue
            base = {
                "week_of": week_of,
                "date": day.get("date"),
                "day": day.get("day"),
            }
            for symbol in day.get("symbols") or []:
                if not isinstance(symbol, dict):
                    continue
                records.append(
                    {
                        **base,
                        "symbol": symbol.get("s"),
                        "name": symbol.get("n"),
                        "timing": symbol.get("t"),
                        "eps_estimate": symbol.get("e"),
                        "eps_growth_pct": symbol.get("eg"),
                        "revenue_estimate": symbol.get("r"),
                        "revenue_growth_pct": symbol.get("rg"),
                        "market_cap": symbol.get("m"),
                    }
                )
    return records


def clean_symbol(value: str) -> str | None:
    symbol = value.strip().upper()
    if SYMBOL_RE.match(symbol):
        return symbol
    return None


def parse_symbols(value: str) -> list[str]:
    if not value:
        return []
    out = []
    seen = set()
    for raw in value.split(","):
        symbol = clean_symbol(raw)
        if symbol and symbol not in seen:
            out.append(symbol)
            seen.add(symbol)
    return out


def parse_history_periods(value: str) -> tuple[str, ...]:
    if not value:
        return ()
    out = []
    seen = set()
    for raw in value.split(","):
        key = raw.strip()
        if not key:
            continue
        if key not in HISTORY_PERIOD_ENDPOINTS:
            known = ", ".join(sorted(HISTORY_PERIOD_ENDPOINTS))
            raise SystemExit(f"Unknown history period(s): {key}. Known: {known}")
        if key not in seen:
            out.append(key)
            seen.add(key)
    return tuple(out)


def load_core_daily_basket_symbols() -> list[str]:
    path = OUT_DIR.parent / FENOK_ETF_CORE_DAILY_BASKET_REL_PATH
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    tickers = payload.get("daily_refresh_universe", {}).get("tickers")
    if not isinstance(tickers, list):
        tickers = [row.get("ticker") for row in payload.get("rows") or [] if isinstance(row, dict)]
    return unique_symbols([str(ticker or "") for ticker in tickers])


def select_base_etfs(
    explicit_etfs: list[str],
    *,
    stocks_only: bool,
    universe_backfill: bool,
    incremental_etf_backfill: bool,
    incremental_etf_only: bool,
    universe_payload: dict | None = None,
) -> list[str]:
    if stocks_only:
        return []
    if universe_backfill:
        etfs = explicit_etfs or load_etf_universe_symbols()
        if not etfs and universe_payload:
            etfs = [row["ticker"] for row in universe_payload.get("records") or []]
        if not etfs:
            raise SystemExit("ETF universe is empty. Run --discover-etf-universe first.")
        return etfs
    if incremental_etf_backfill and incremental_etf_only:
        return explicit_etfs[:]
    if explicit_etfs:
        return explicit_etfs
    return unique_symbols(load_core_daily_basket_symbols() + DEFAULT_ETFS)


def fetch_json(rel_path: str, timeout: int) -> dict:
    url = f"{BASE_URL}{rel_path}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def history_endpoint(asset_prefix: str, ticker: str, config: dict) -> str:
    return (
        f"/api/symbol/{asset_prefix}/{ticker}/history"
        f"?range={config['range']}&period={config['period']}"
    )


def fetch_history_periods(asset_prefix: str, ticker: str, timeout: int) -> tuple[dict, dict]:
    paths = {
        key: history_endpoint(asset_prefix, ticker, config)
        for key, config in HISTORY_PERIOD_ENDPOINTS.items()
    }
    return paths, {key: pick_data(fetch_json(path, timeout)) for key, path in paths.items()}


def fetch_text(rel_path: str, timeout: int) -> str:
    url = f"{BASE_URL}{rel_path}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def pick_data(payload: dict) -> dict | list | None:
    if isinstance(payload, dict) and payload.get("status") == 200:
        return payload.get("data")
    return payload.get("data") if isinstance(payload, dict) else None

ETF_DETAIL_SURFACE_CONTRACTS = {
    "overview": {
        "path": "/etf/{ticker}/__data.json",
        "required_types": {
            "holdings": (int, type(None)),
            "holdingsTable": (dict, type(None)),
            "inception": (str, type(None)),
        },
    },
    "holdings": {
        "path": "/etf/{ticker}/holdings/__data.json",
        "required_types": {
            "holdings": list,
        },
        "optional_types": {
            "count": (int, type(None)),
            "date": (str, type(None)),
            "sectors": (list, type(None)),
            "countries": (list, type(None)),
        },
    },
}
ETF_DETAIL_DECODER = "svelte_devalue_node/v1"


def validate_svelte_detail_contract(payload: dict, surface: str) -> dict:
    """Decode one ETF detail node and fail closed on endpoint schema drift."""
    contract = ETF_DETAIL_SURFACE_CONTRACTS.get(surface)
    if contract is None:
        raise ValueError(f"svelte_contract_unknown_surface: {surface}")
    if not isinstance(payload, dict) or not isinstance(payload.get("nodes"), list):
        raise ValueError(f"svelte_contract_drift:{surface}:missing_nodes")

    required_types = contract["required_types"]
    optional_types = contract.get("optional_types") or {}
    decoded_candidates = []
    for node in reversed(payload.get("nodes") or []):
        data = node.get("data") if isinstance(node, dict) else None
        if not isinstance(data, list) or not data:
            continue
        try:
            decoded = decode_svelte_data(data)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"svelte_contract_drift:{surface}:decode_error:{exc}") from exc
        if isinstance(decoded, dict):
            decoded_candidates.append(decoded)
            if all(key in decoded for key in required_types):
                for key, expected_type in required_types.items():
                    value = decoded[key]
                    expected_types = expected_type if isinstance(expected_type, tuple) else (expected_type,)
                    if not isinstance(value, expected_type) or (
                        int in expected_types and isinstance(value, bool)
                    ):
                        expected_label = "_or_".join(item.__name__ for item in expected_types)
                        raise ValueError(
                            f"svelte_contract_drift:{surface}:invalid_type:{key}:"
                            f"expected_{expected_label}"
                        )
                for key, expected_type in optional_types.items():
                    if key not in decoded:
                        continue
                    value = decoded[key]
                    expected_types = expected_type if isinstance(expected_type, tuple) else (expected_type,)
                    if not isinstance(value, expected_types) or (
                        int in expected_types and isinstance(value, bool)
                    ):
                        expected_label = "_or_".join(item.__name__ for item in expected_types)
                        raise ValueError(
                            f"svelte_contract_drift:{surface}:invalid_type:{key}:"
                            f"expected_{expected_label}"
                        )
                return decoded

    present = sorted({key for decoded in decoded_candidates for key in decoded})
    missing = sorted(set(required_types) - set(present))
    raise ValueError(
        f"svelte_contract_drift:{surface}:missing_required:{','.join(missing)}"
    )


def fetch_svelte_detail(
    ticker: str,
    surface: str,
    timeout: int,
    *,
    allow_unavailable: bool = False,
) -> tuple[str, dict]:
    contract = ETF_DETAIL_SURFACE_CONTRACTS.get(surface)
    if contract is None:
        raise ValueError(f"svelte_contract_unknown_surface: {surface}")
    path = contract["path"].format(ticker=ticker.lower())
    payload = fetch_json(path, timeout)
    if allow_unavailable and surface == "holdings":
        identity_confirmed = False
        for node in reversed(payload.get("nodes") or []):
            data = node.get("data") if isinstance(node, dict) else None
            if isinstance(data, list) and data:
                decoded = decode_svelte_data(data)
                if decoded == {}:
                    return path, {}
                info = decoded.get("info") if isinstance(decoded, dict) else None
                if (
                    isinstance(info, dict)
                    and str(info.get("type") or "").lower() == "etf"
                    and clean_symbol(str(info.get("ticker") or "")) == clean_symbol(ticker)
                ):
                    identity_confirmed = True
        if identity_confirmed:
            return path, {}
    return path, validate_svelte_detail_contract(payload, surface)


def overview_declares_holdings_unavailable(overview: dict) -> bool:
    if overview.get("holdings") is not None:
        return False
    table = overview.get("holdingsTable")
    return table is None or (
        isinstance(table, dict)
        and table.get("count") is None
        and table.get("holdings") is None
    )


def fetch_etf_history_periods(ticker: str, timeout: int) -> tuple[dict, dict, dict]:
    paths = {
        key: history_endpoint("e", ticker, config)
        for key, config in HISTORY_PERIOD_ENDPOINTS.items()
    }
    periods = {}
    errors = {}
    for key, path in paths.items():
        try:
            data = pick_data(fetch_json(path, timeout))
            if not isinstance(data, list):
                raise ValueError(f"rest_contract_drift:history:{key}:expected_list")
            periods[key] = data
        except urllib.error.HTTPError as exc:
            code = exc.code
            exc.close()
            if code not in (400, 404):
                raise
            periods[key] = []
            errors[key] = {
                "status": "unavailable",
                "reason_code": f"http_{code}",
                "path": path,
            }
    return paths, periods, errors


def endpoint_canary_reason(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        exc.close()
        return f"http_{exc.code}"
    if isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, urllib.error.URLError):
        return "transport_error"
    if isinstance(exc, json.JSONDecodeError):
        return "decode_error"
    if isinstance(exc, ValueError) and "contract_drift" in str(exc):
        return "schema_drift"
    return "unexpected_error"


def validate_rest_endpoint_contract(surface: str, payload: dict) -> dict | list:
    data = pick_data(payload)
    expected_type = dict if surface == "quote" else list
    if not isinstance(data, expected_type) or (surface == "history_daily_1y" and not data):
        raise ValueError(
            f"rest_contract_drift:{surface}:expected_nonempty_{expected_type.__name__}"
        )
    return data


def run_endpoint_canary(
    timeout: int,
    tickers: tuple[str, ...] = ENDPOINT_CANARY_TICKERS,
) -> dict:
    """Probe current ETF endpoint contracts; this is a latest-state canary, not R2 history."""
    results = []
    for raw_ticker in tickers:
        ticker = clean_symbol(raw_ticker)
        probes = (
            ("overview", f"/etf/{ticker.lower()}/__data.json"),
            ("holdings", f"/etf/{ticker.lower()}/holdings/__data.json"),
            ("quote", f"/api/quotes/e/{ticker}"),
            ("history_daily_1y", history_endpoint("e", ticker, HISTORY_PERIOD_ENDPOINTS["daily_1y"])),
        )
        for surface, path in probes:
            started = time.perf_counter()
            row = {
                "ticker": ticker,
                "surface": surface,
                "path": path,
                "status": "ready",
                "reason_code": "ok",
            }
            try:
                if surface in ETF_DETAIL_SURFACE_CONTRACTS:
                    actual_path, _decoded = fetch_svelte_detail(ticker, surface, timeout)
                    if actual_path != path:
                        raise ValueError(f"svelte_contract_drift:{surface}:path_mismatch")
                    row["decoder"] = ETF_DETAIL_DECODER
                else:
                    validate_rest_endpoint_contract(surface, fetch_json(path, timeout))
                    row["decoder"] = "rest_json/v1"
            except Exception as exc:  # the canary must report every endpoint in one run
                row["status"] = "blocked"
                row["reason_code"] = endpoint_canary_reason(exc)
                row["error"] = str(exc)[:300]
            row["latency_ms"] = int((time.perf_counter() - started) * 1000)
            results.append(row)

    failed = sum(1 for row in results if row["status"] != "ready")
    return {
        "schema_version": "stockanalysis-endpoint-canary/v1",
        "source": "stockanalysis",
        "generated_at": now_iso(),
        "status": "ready" if failed == 0 else "blocked",
        "policy": {
            "scope": "latest endpoint/schema canary only; observation history begins in R2",
            "cadence": "existing StockAnalysis scheduled workflow lanes",
            "required_tickers": list(tickers),
        },
        "counts": {"probes": len(results), "ready": len(results) - failed, "blocked": failed},
        "results": results,
    }


def parse_percent(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if text.endswith("%"):
        text = text[:-1]
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value):
    if value is None:
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip().replace(",", "")
    try:
        return int(float(text))
    except ValueError:
        return None


def parse_suffix_number(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
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


def row_ticker(row: dict) -> str | None:
    for key in ("ticker", "s", "symbol"):
        value = row.get(key)
        if isinstance(value, str):
            return clean_symbol(value.lstrip("$"))
    return None


def classification_text(row: dict | None, overview: dict | None, _holdings: list | None) -> str:
    chunks = []
    if isinstance(row, dict):
        for key in ("ticker", "s", "symbol", "name", "n", "category", "assetClass"):
            value = row.get(key)
            if isinstance(value, str):
                chunks.append(value)
    if isinstance(overview, dict):
        for key in ("type", "description"):
            value = overview.get(key)
            if isinstance(value, str):
                chunks.append(value)
    return " ".join(chunks)


def directional_classification_text(text: str) -> str:
    return NON_DIRECTIONAL_SHORT_RE.sub(" ", text)


def extract_leverage_factor(text: str) -> float | None:
    matches = re.findall(r"(?<!\d)([1-9](?:\.\d+)?)\s*x\b", text, flags=re.IGNORECASE)
    if matches:
        try:
            return float(matches[0])
        except ValueError:
            pass
    lower = text.lower()
    if "ultrapro" in lower:
        return 3.0
    directional = directional_classification_text(text).lower()
    if re.search(r"\bultra(?:short)?\b", directional):
        return 2.0
    return None


def extract_single_stock_underlying(text: str) -> str | None:
    patterns = (
        r"daily price movement for shares of ([A-Za-z0-9 .,&'-]+?) stock",
        r"daily performance of ([A-Za-z0-9 .,&'-]+?) stock",
        r"daily investment results of ([A-Za-z0-9 .,&'-]+?) stock",
        r"shares of ([A-Za-z0-9 .,&'-]+?) stock",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return normalize_space(match.group(1)).rstrip(".,")

    ticker_patterns = (
        r"\b[1-9](?:\.\d+)?\s*x\s+(?:long|short)\s+([A-Z]{1,6})\s+daily\b",
        r"\bdaily\s+target\s+[1-9](?:\.\d+)?\s*x\s+(?:long|short)\s+([A-Z]{1,6})\b",
        r"\bdaily\s+([A-Z]{1,6})\s+(?:bull|bear)\s+[1-9](?:\.\d+)?\s*x\b",
    )
    if not NON_SINGLE_STOCK_CONTEXT_RE.search(text):
        for pattern in ticker_patterns:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                candidate = match.group(1).upper()
                if candidate not in NON_SINGLE_STOCK_UNDERLYING_TOKENS:
                    return candidate

    for ticker in sorted(SINGLE_STOCK_UNDERLYING_TICKERS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(ticker)}\b", text, flags=re.IGNORECASE):
            return ticker
    return None


def classify_etf(row: dict | None = None, overview: dict | None = None, holdings: list | None = None) -> dict:
    text = classification_text(row, overview, holdings)
    lower = text.lower()
    directional = directional_classification_text(text).lower()
    factor = extract_leverage_factor(text)
    daily_geared = bool(
        re.search(r"\bdaily\b.*\b(?:bull|bear|target|long|short)\b", directional)
        or re.search(r"\b(?:bull|bear|long|short)\b.*\bdaily\b", directional)
    )
    is_leveraged = bool(
        (factor is not None and factor > 1)
        or "leveraged" in lower
        or "ultrapro" in lower
        or (factor is None and daily_geared)
    )
    is_inverse = bool(re.search(r"\b(?:inverse|short|bear)\b", directional))
    underlying = extract_single_stock_underlying(text) if is_leveraged else None
    index_like = bool(
        re.search(r"\bbased on the\b.*\bindex\b", lower)
        or re.search(r"\bindex tracking\b", lower)
        or re.search(r"\bindex of\b", lower)
    )
    single_stock = bool(underlying and not index_like)
    source = "stockanalysis.overview.description" if isinstance(overview, dict) and overview.get("description") else "stockanalysis.etf_list.name"
    confidence = "high" if source == "stockanalysis.overview.description" else "medium" if is_leveraged else "low"
    return {
        "is_leveraged": is_leveraged,
        "leverage_factor": factor,
        "is_inverse": is_inverse,
        "is_single_stock": single_stock,
        "underlying": underlying if single_stock else None,
        "source": source,
        "confidence": confidence,
    }


def compact_etf_classification(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None
    return {
        "is_leveraged": bool(value.get("is_leveraged")),
        "leverage_factor": value.get("leverage_factor") if isinstance(value.get("leverage_factor"), (int, float)) else None,
        "is_inverse": bool(value.get("is_inverse")),
        "is_single_stock": bool(value.get("is_single_stock")),
        "underlying": value.get("underlying") if isinstance(value.get("underlying"), str) and value.get("underlying").strip() else None,
        "source": value.get("source") if isinstance(value.get("source"), str) and value.get("source").strip() else "stockanalysis.etf_list.name",
        "confidence": value.get("confidence") if isinstance(value.get("confidence"), str) and value.get("confidence").strip() else "low",
    }


def etf_classification_has_signal(value: dict | None) -> bool:
    if not isinstance(value, dict):
        return False
    return bool(
        value.get("is_leveraged")
        or value.get("is_inverse")
        or value.get("is_single_stock")
        or value.get("leverage_factor") is not None
        or value.get("underlying")
    )


def choose_etf_classification(detail_classification: dict | None, row_classification: dict) -> dict:
    detail = compact_etf_classification(detail_classification)
    row = compact_etf_classification(row_classification) or row_classification
    if detail is None:
        return row
    if etf_classification_has_signal(detail) or detail.get("confidence") == "high":
        return detail
    return row


def add_etf_classification(row: dict, detail_index: dict[str, dict] | None = None) -> dict:
    base_row = {key: value for key, value in row.items() if key not in ETF_DETAIL_ENRICHMENT_ROW_KEYS}
    ticker = row_ticker(base_row)
    payload = (detail_index or {}).get(ticker or "") or {}
    raw_overview = (payload.get("raw") or {}).get("overview") if isinstance(payload, dict) else {}
    overview = raw_overview if isinstance(raw_overview, dict) else {}
    normalized_overview = (payload.get("normalized") or {}).get("overview") if isinstance(payload, dict) else {}
    normalized_overview = normalized_overview if isinstance(normalized_overview, dict) else {}
    normalized_holdings = ((payload.get("normalized") or {}).get("holdings") or []) if isinstance(payload, dict) else []
    detail_classification = (payload.get("normalized") or {}).get("classification") if isinstance(payload, dict) else None
    row_classification = classify_etf(base_row, overview=overview, holdings=normalized_holdings)
    classification = choose_etf_classification(detail_classification, row_classification)

    source_provider = payload.get("source_provider") if isinstance(payload, dict) else None
    def percent_points(value):
        parsed = parse_percent(value)
        if parsed is None:
            return None
        if source_provider == "yahoo_finance" and isinstance(value, (int, float)) and 0 < parsed <= 1:
            return parsed * 100
        return parsed

    performance = overview.get("performance") if isinstance(overview.get("performance"), dict) else None
    detail_fields = {
        "expenseRatio": normalized_overview.get("expenseRatio"),
        "expense_ratio": percent_points(normalized_overview.get("expenseRatio")),
        "dividendYield": normalized_overview.get("dividendYield"),
        "dividend_yield": percent_points(normalized_overview.get("dividendYield")),
        "sharesOut": normalized_overview.get("sharesOut"),
        "beta": normalized_overview.get("beta"),
        "inceptionDate": normalized_overview.get("inception"),
        "provider_page": normalized_overview.get("provider_page"),
        "etf_website": normalized_overview.get("etf_website"),
        "performance": performance,
    }
    enriched = {
        **base_row,
        **{key: value for key, value in detail_fields.items() if value is not None},
    }

    enriched["classification"] = classification
    return enriched


def etf_classification_counts(records: list[dict]) -> dict:
    classified = sum(1 for row in records if isinstance(row.get("classification"), dict))
    def flag(row: dict, key: str) -> bool:
        classification = row.get("classification")
        if isinstance(classification, dict):
            return bool(classification.get(key))
        return bool(row.get(key))

    return {
        "classified": classified,
        "coverage_pct": round((classified / len(records)) * 100, 2) if records else 0,
        "leveraged": sum(1 for row in records if flag(row, "is_leveraged")),
        "inverse": sum(1 for row in records if flag(row, "is_inverse")),
        "single_stock": sum(1 for row in records if flag(row, "is_single_stock")),
    }


def etf_detail_enrichment_counts(records: list[dict]) -> dict:
    return {
        "expense_ratio": sum(1 for row in records if parse_percent(row.get("expense_ratio")) is not None or parse_percent(row.get("expenseRatio")) is not None),
        "performance": sum(1 for row in records if isinstance(row.get("performance"), dict) and len(row["performance"]) > 0),
        "inception": sum(1 for row in records if row.get("inceptionDate")),
        "provider_link": sum(1 for row in records if row.get("etf_website") or row.get("provider_page")),
    }


def load_etf_detail_index() -> dict[str, dict]:
    etf_dir = OUT_DIR / "etfs"
    if not etf_dir.exists():
        return {}
    details: dict[str, dict] = {}
    for path in etf_dir.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        ticker = clean_symbol(str(payload.get("ticker") or path.stem))
        if ticker:
            details[ticker] = payload
    return details


def enrich_etf_records(records: list[dict], detail_index: dict[str, dict] | None = None) -> list[dict]:
    details = detail_index if detail_index is not None else load_etf_detail_index()
    return [add_etf_classification(row, details) for row in records]


def normalize_holdings(rows):
    out = []
    for row in rows if isinstance(rows, list) else []:
        name = row.get("n") or row.get("name")
        symbol = str(row.get("s") or row.get("symbol") or "").strip().lstrip("$").upper() or None
        item = {
            "rank": parse_int(row.get("no") or row.get("rank")),
            "symbol": symbol,
            "name": name,
            "weight_pct": parse_percent(row.get("as") or row.get("weight")),
            "shares": parse_int(row.get("sh") or row.get("shares")),
            "raw": row,
        }
        out.append({key: value for key, value in item.items() if value is not None})
    return out


def parse_etf_universe_page(html: str, page: int) -> list[dict]:
    parser = ETFUniverseParser()
    parser.feed(html)
    rows = []
    for row in parser.rows:
        rows.append({**row, "source_page": page})
    return rows


def parse_html_tables(html: str) -> list[dict]:
    parser = HTMLTableParser()
    parser.feed(html)
    tables = []
    for idx, table in enumerate(parser.tables):
        records = table.get("rows") or []
        tables.append(
            {
                "index": idx,
                "headers": table.get("headers") or [],
                "row_count": len(records),
                "records": records,
            }
        )
    return tables


def fetch_table_surface(name: str, definition: dict, timeout: int) -> dict:
    path = definition["path"]
    html = fetch_text(path, timeout)
    tables = parse_html_tables(html)
    page_path = definition.get("page_path") or path
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "surface": name,
        "group": definition["group"],
        "priority": definition["priority"],
        "role": definition["role"],
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": now_iso(),
        "endpoint": path,
        "url": f"{BASE_URL}{page_path}",
        "format": "html_table",
        "title": extract_title(html),
        "counts": {
            "tables": len(tables),
            "rows": sum(table["row_count"] for table in tables),
        },
        "tables": tables,
    }


def fetch_svelte_surface(name: str, definition: dict, timeout: int) -> dict:
    path = definition["path"]
    page_path = definition.get("page_path") or path.replace("/__data.json?x-sveltekit-invalidated=01", "/")
    payload = fetch_json(path, timeout)

    if name == "earnings_calendar":
        decoded = extract_svelte_node(payload, ("earnings",))
        records = flatten_earnings_calendar(decoded)
        metadata = {
            "weeks": decoded.get("earnings"),
            "days": decoded.get("days"),
            "view": decoded.get("view"),
        }
    else:
        decoded = extract_svelte_node(payload, ("data",))
        records = decoded.get("data") if isinstance(decoded.get("data"), list) else []
        if name == "etf_screener":
            records = enrich_etf_records(records)
        metadata = {
            key: value
            for key, value in decoded.items()
            if key not in {"data", "earnings"}
        }

    data_points = metadata.get("dataPoints")
    field_count = len(data_points) if isinstance(data_points, (list, dict)) else None
    day_count = len(metadata.get("days") or []) if isinstance(metadata.get("days"), list) else None
    week_count = len(metadata.get("weeks") or []) if isinstance(metadata.get("weeks"), list) else None
    classification_counts = etf_classification_counts(records) if name == "etf_screener" else None
    counts = {
        "records": len(records),
        "fields": field_count,
        "days": day_count,
        "weeks": week_count,
    }
    if classification_counts is not None:
        counts["classification"] = classification_counts

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "surface": name,
        "group": definition["group"],
        "priority": definition["priority"],
        "role": definition["role"],
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": now_iso(),
        "endpoint": path,
        "url": f"{BASE_URL}{page_path}",
        "format": "svelte_devalue",
        "counts": counts,
        "records": records,
        "metadata": {key: value for key, value in metadata.items() if value is not None},
    }


def parse_surface_names(value: str, surface_set: str) -> list[str]:
    if value:
        names = [item.strip() for item in value.split(",") if item.strip()]
    else:
        names = list(SURFACE_SETS[surface_set])

    unknown = [name for name in names if name not in SURFACE_DEFINITIONS]
    if unknown:
        known = ", ".join(sorted(SURFACE_DEFINITIONS))
        raise SystemExit(f"Unknown surface name(s): {', '.join(unknown)}. Known: {known}")

    out = []
    seen = set()
    for name in names:
        if name not in seen:
            out.append(name)
            seen.add(name)
    return out


def surface_stamp_membership(consumers: dict | None) -> dict[str, set[str]] | None:
    """Derive stamp-domain membership from the surface-consumer ownership SSOT."""
    rows = consumers.get("surfaces") if isinstance(consumers, dict) else None
    if not isinstance(rows, list):
        return None
    routes_by_surface: dict[str, list[str]] = {}
    for row in rows:
        surface = str((row or {}).get("surface") or "").strip() if isinstance(row, dict) else ""
        if not surface or surface in routes_by_surface:
            return None
        consumer_rows = row.get("consumers")
        if not isinstance(consumer_rows, list) or not consumer_rows:
            return None
        routes = []
        for consumer in consumer_rows:
            route = str((consumer or {}).get("route") or "").strip() if isinstance(consumer, dict) else ""
            if not route:
                return None
            routes.append(route)
        routes_by_surface[surface] = routes
    membership: dict[str, set[str]] = {}
    for domain, route_prefix in SURFACE_STAMP_ROUTES.items():
        owned = {
            surface
            for surface, routes in routes_by_surface.items()
            if any(route == route_prefix or route.startswith(f"{route_prefix}/") for route in routes)
        }
        if not owned:
            return None
        membership[domain] = owned
    return membership


def build_surface_stamp_map(
    requested: list[str],
    results: list[dict],
    _previous_index: dict | None,
) -> dict[str, str | None]:
    membership = surface_stamp_membership(read_json(OUT_DIR / "surface_consumers.json"))
    if membership is None:
        return {domain: None for domain in SURFACE_STAMP_ROUTES}

    requested_set = set(requested)
    stamps: dict[str, str | None] = {}
    for domain, required in membership.items():
        attempted = bool(required & requested_set)
        full_attempt = required.issubset(requested_set)
        if not attempted or not full_attempt:
            # A legacy aggregate stamp has no provider evidence. Partial or
            # unattempted domains must stay unknown instead of inheriting it.
            stamps[domain] = None
            continue
        dates: list[str] = []
        complete = True
        for surface in sorted(required):
            matches = [
                row for row in results
                if isinstance(row, dict) and str(row.get("surface") or "") == surface
            ]
            result = matches[0] if len(matches) == 1 else None
            payload = read_json(OUT_DIR / "surfaces" / f"{surface}.json")
            source_as_of = collection_date((payload or {}).get("source_as_of")) if isinstance(payload, dict) else None
            if not result or result.get("error") is not None or not source_as_of:
                complete = False
                break
            dates.append(source_as_of)
        stamps[domain] = min(dates) if complete and dates else None
    return stamps


def fetch_surfaces(surface_names: list[str], timeout: int, sleep: float, mirror_public: bool) -> dict:
    results = []
    for idx, name in enumerate(surface_names, 1):
        definition = SURFACE_DEFINITIONS[name]
        start = time.perf_counter()
        try:
            if definition.get("format") == "svelte_devalue":
                payload = fetch_svelte_surface(name, definition, timeout)
            else:
                payload = fetch_table_surface(name, definition, timeout)
            rel_path = f"surfaces/{name}.json"
            write_payload(rel_path, payload, mirror_public)
            result = {
                "surface": name,
                "group": definition["group"],
                "format": payload.get("format"),
                "status": "ok",
                "path": rel_path,
                "endpoint": definition["path"],
                "tables": payload["counts"].get("tables", 0),
                "rows": payload["counts"].get("rows", payload["counts"].get("records", 0)),
                "latency_ms": round((time.perf_counter() - start) * 1000),
                "error": None,
            }
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            result = {
                "surface": name,
                "group": definition["group"],
                "format": definition.get("format", "html_table"),
                "status": "error",
                "path": None,
                "endpoint": definition["path"],
                "tables": 0,
                "rows": 0,
                "latency_ms": round((time.perf_counter() - start) * 1000),
                "error": f"{type(exc).__name__}: {exc}",
            }

        results.append(result)
        status = "OK" if result["error"] is None else f"FAIL {result['error'][:80]}"
        print(
            f"[surface {idx}/{len(surface_names)}] {name} {status} rows={result['rows']} {result['latency_ms']}ms",
            flush=True,
        )
        time.sleep(sleep)

    source_as_of = build_surface_stamp_map(surface_names, results, None)
    summary = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "surface_index",
        "generated_at": now_iso(),
        "source_as_of": source_as_of,
        "source_as_of_reason": {
            domain: None if stamp else "provider publishes no aggregate source date or this run did not fully refresh the domain"
            for domain, stamp in source_as_of.items()
        },
        "counts": {
            "surfaces_requested": len(surface_names),
            "ok": sum(1 for item in results if item["error"] is None),
            "failed": sum(1 for item in results if item["error"] is not None),
            "tables": sum(item["tables"] for item in results),
            "rows": sum(item["rows"] for item in results),
        },
        "results": results,
    }
    write_payload("surfaces/index.json", summary, mirror_public)
    return summary


def next_etf_page_path(html: str) -> str | None:
    match = re.search(r'<link rel="next" href="https://stockanalysis\.com(/etf/\?page=\d+)"', html)
    if match:
        return match.group(1).replace("&amp;", "&")
    return None


def fetch_etf_universe(max_pages: int, timeout: int, sleep: float) -> dict:
    if max_pages < 1:
        raise ValueError("max_pages must be at least 1")
    records = []
    seen = set()
    pages = []
    warnings = []
    path = "/etf/"
    next_path = None

    for page_idx in range(1, max_pages + 1):
        page = 1
        match = re.search(r"[?&]page=(\d+)", path)
        if match:
            page = int(match.group(1))

        start = time.perf_counter()
        html = fetch_text(path, timeout)
        rows = parse_etf_universe_page(html, page)
        next_path = next_etf_page_path(html)
        if not rows:
            raise RuntimeError(f"No ETF rows parsed from {path}")
        if next_path and len(rows) < 400:
            warnings.append(f"Page {page} has only {len(rows)} rows before a next page; parser drift possible.")
        for row in rows:
            ticker = row["ticker"]
            if ticker not in seen:
                records.append(row)
                seen.add(ticker)
        pages.append(
            {
                "page": page,
                "path": path,
                "record_count": len(rows),
                "latency_ms": round((time.perf_counter() - start) * 1000),
            }
        )

        if not next_path:
            break
        path = next_path
        time.sleep(sleep)

    if next_path:
        raise RuntimeError(
            f"ETF universe pagination exceeded max_pages={max_pages}; "
            "refusing to publish a truncated discovery"
        )

    records.sort(key=lambda row: row["ticker"])
    records = enrich_etf_records(records)
    classification_counts = etf_classification_counts(records)
    collected_at = now_iso()
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "etf",
        "generated_at": collected_at,
        "source_as_of": None,
        "source_as_of_reason": "provider publishes no aggregate source date",
        "fetched_at": collected_at,
        "endpoint": "/etf/",
        "counts": {
            "records": len(records),
            "pages": len(pages),
            "duplicate_rows_removed": sum(page["record_count"] for page in pages) - len(records),
            "classification": classification_counts,
            "detail_enrichment": etf_detail_enrichment_counts(records),
        },
        "warnings": warnings,
        "pages": pages,
        "records": records,
    }


def load_etf_universe_symbols() -> list[str]:
    payload_path = OUT_DIR / "etf_universe.json"
    if not payload_path.is_file():
        return []
    try:
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    symbols = []
    seen = set()
    for row in payload.get("records") or []:
        ticker = clean_symbol(str(row.get("ticker") or ""))
        if ticker and ticker not in seen:
            symbols.append(ticker)
            seen.add(ticker)
    return symbols


def fetch_etf(ticker: str, timeout: int, *, include_history: bool = True) -> dict:
    overview_path, overview_data = fetch_svelte_detail(ticker, "overview", timeout)
    holdings_unavailable = overview_declares_holdings_unavailable(overview_data)
    holdings_path, holdings_data = fetch_svelte_detail(
        ticker,
        "holdings",
        timeout,
        allow_unavailable=holdings_unavailable,
    )
    if include_history:
        history_paths, history_periods, history_errors = fetch_etf_history_periods(ticker, timeout)
    else:
        history_paths, history_periods, history_errors = {}, {}, {}
    paths = {
        "holdings": holdings_path,
        "overview": overview_path,
        "quote": f"/api/quotes/e/{ticker}",
        "history_periods": history_paths,
    }
    raw = {
        "overview": overview_data,
        "holdings": holdings_data,
        "quote": pick_data(fetch_json(paths["quote"], timeout)),
    }
    raw["history"] = history_periods.get("monthly_1y")
    raw["history_periods"] = history_periods
    if history_errors:
        raw["history_endpoint_errors"] = history_errors
    holdings = holdings_data.get("holdings") or (overview_data.get("holdingsTable") or {}).get("holdings")
    normalized_holdings = normalize_holdings(holdings)
    classification = classify_etf(
        {"ticker": ticker},
        overview=overview_data,
        holdings=normalized_holdings,
    )
    fetched_at = now_iso()
    payload = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "etf",
        "ticker": ticker,
        "source_as_of": quote_source_timestamp(raw.get("quote")) or latest_history_source_timestamp({"normalized": {"history_periods": history_periods}}),
        "fetched_at": fetched_at,
        "endpoints": paths,
        "endpoint_contracts": {
            "overview": {
                "format": "svelte_devalue",
                "decoder": ETF_DETAIL_DECODER,
                "contract": "etf_detail_overview/v1",
            },
            "holdings": {
                "format": "svelte_devalue",
                "decoder": ETF_DETAIL_DECODER,
                "contract": "etf_detail_holdings/v1",
            },
            "quote": {"format": "rest_json", "contract": "stockanalysis_quote/v1"},
            "history_periods": {"format": "rest_json", "contract": "stockanalysis_history/v1"},
        },
        "normalized": {
            "holdings": normalized_holdings,
            "asset_allocation": holdings_data.get("asset_allocation"),
            "sectors": holdings_data.get("sectors"),
            "countries": holdings_data.get("countries"),
            "holding_count": (
                holdings_data.get("count")
                if holdings_data.get("count") is not None
                else len(normalized_holdings)
                if normalized_holdings
                else overview_data.get("holdings")
            ),
            "holdings_updated": holdings_data.get("date") or (overview_data.get("holdingsTable") or {}).get("updated"),
            "classification": classification,
            "overview": {
                key: overview_data.get(key)
                for key in (
                    "aum", "nav", "expenseRatio", "peRatio", "sharesOut",
                    "dividendYield", "beta", "inception", "provider_page",
                    "etf_website",
                )
                if overview_data.get(key) is not None
            },
            "performance": overview_data.get("performance") if isinstance(overview_data.get("performance"), dict) else None,
            "quote": raw.get("quote"),
            "history": raw.get("history"),
            "history_periods": history_periods,
        },
        "raw": raw,
    }
    partial_reason_codes = [
        *(["holdings_unavailable"] if holdings_unavailable else []),
        *(
            f"holdings_{key}_unavailable"
            for key in ("count", "date", "countries")
            if holdings_data.get(key) is None
        ),
        *(["history_deferred_initial_reconcile"] if not include_history else []),
        *(f"history_{key}_{row['reason_code']}" for key, row in sorted(history_errors.items())),
    ]
    if partial_reason_codes:
        payload["detail_status"] = "stockanalysis_partial"
        payload["partial_reason_codes"] = partial_reason_codes
    return payload


def fetch_stock(ticker: str, timeout: int, financials: dict | None = None) -> dict:
    paths = {
        "overview": f"/api/symbol/s/{ticker}/overview",
        "history": f"/api/symbol/s/{ticker}/history?range=1Y&period=Monthly",
        "quote": f"/api/quotes/s/{ticker}",
    }
    raw = {name: pick_data(fetch_json(path, timeout)) for name, path in paths.items()}
    overview = raw["overview"] if isinstance(raw.get("overview"), dict) else {}
    normalized = {
        "overview": {
            key: overview.get(key)
            for key in (
                "marketCap", "revenue", "revenue_type", "netIncome",
                "sharesOut", "eps", "peRatio", "forwardPE", "dividend",
                "beta", "analysts", "target", "earningsDate",
            )
            if overview.get(key) is not None
        },
        "quote": raw.get("quote"),
        "history": raw.get("history"),
    }
    financials_path = None
    if financials is not None:
        financials_path = f"financials/{ticker}.json"
        normalized["financials"] = {
            "path": financials_path,
            "fetched_at": financials.get("fetched_at"),
            "role": financials.get("role"),
            "summary": financials.get("summary"),
        }

    fetched_at = now_iso()
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "source_as_of": quote_source_timestamp(raw.get("quote")) or latest_history_source_timestamp({"normalized": normalized}),
        "fetched_at": fetched_at,
        "endpoints": paths,
        "normalized": normalized,
        "financials_path": financials_path,
        "raw": raw,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_payload(rel_path: str, payload: dict, mirror_public: bool) -> None:
    write_json(OUT_DIR / rel_path, payload)
    if mirror_public:
        write_json(PUBLIC_DIR / rel_path, payload)


def validate_aware_timestamp(value, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} is missing")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{label} is malformed") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{label} is timezone-naive")
    return value


def validate_stockanalysis_etf_payload(ticker: str, payload: dict) -> None:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("StockAnalysis ETF detail schema mismatch")
    if (
        payload.get("source") != "stockanalysis"
        or payload.get("asset_type") != "etf"
        or payload.get("ticker") != ticker
    ):
        raise ValueError("StockAnalysis ETF detail identity mismatch")
    provider_source = stockanalysis_detail_source_timestamp(payload)
    if provider_source is None:
        raise ValueError("StockAnalysis ETF detail provider source date is unavailable")
    validate_aware_timestamp(provider_source, "StockAnalysis ETF detail provider source stamp")
    claimed = validate_aware_timestamp(
        payload.get("source_as_of"),
        "StockAnalysis ETF detail source stamp",
    )
    if parse_iso_timestamp(claimed) != parse_iso_timestamp(provider_source):
        raise ValueError("StockAnalysis ETF detail source stamp disagrees with provider evidence")


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None


def etf_universe_record_count(payload: dict | None = None) -> int:
    source = payload if isinstance(payload, dict) else read_json(OUT_DIR / "etf_universe.json")
    if not isinstance(source, dict):
        return 0
    counts = source.get("counts")
    if isinstance(counts, dict) and isinstance(counts.get("records"), int):
        return counts["records"]
    records = source.get("records")
    return len(records) if isinstance(records, list) else 0


def build_yf_payload(ticker: str, data: dict, fetched_at: str | None = None) -> dict:
    payload = {
        "schema_version": "yf-finance/v2",
        "ticker": ticker,
        "fetched_at": fetched_at or now_iso(),
        "profile": "etf",
        "data": data,
        "source": "yahoo_finance",
        "source_context": "stockanalysis_etf_fallback",
    }
    payload["source_as_of"] = yahoo_detail_source_timestamp(payload)
    payload["source_as_of_reason"] = (
        None
        if payload["source_as_of"]
        else "provider payload carries no market observation date"
    )
    return payload


def write_yf_payload(ticker: str, data: dict, mirror_public: bool, fetched_at: str | None = None) -> dict:
    payload = build_yf_payload(ticker, data, fetched_at)
    write_json(YF_OUT_DIR / f"{ticker}.json", payload)
    if mirror_public:
        write_json(YF_PUBLIC_DIR / f"{ticker}.json", payload)
    return payload


def write_yf_etf_detail_payload(ticker: str, payload: dict) -> Path:
    if payload.get("schema_version") != "yf-etf-detail/v1":
        raise ValueError("Yahoo ETF detail candidate schema mismatch")
    if payload.get("source_provider") != "yahoo_finance" or payload.get("ticker") != ticker:
        raise ValueError("Yahoo ETF detail candidate identity mismatch")
    provider_source = yahoo_detail_source_timestamp(payload)
    if provider_source is None:
        raise ValueError("Yahoo ETF detail provider source date is unavailable")
    validate_aware_timestamp(provider_source, "Yahoo ETF detail provider source stamp")
    claimed = validate_aware_timestamp(
        payload.get("source_as_of"),
        "Yahoo ETF detail candidate source stamp",
    )
    if parse_iso_timestamp(claimed) != parse_iso_timestamp(provider_source):
        raise ValueError("Yahoo ETF detail source stamp disagrees with provider evidence")
    path = YF_ETF_DETAIL_OUT_DIR / f"{ticker}.json"
    write_json(path, payload)
    return path


def record_etf_detail_observation(
    *,
    provider: str,
    endpoint_family: str,
    ticker: str,
    provider_path: str,
    payload_path: Path,
    provider_schema: str,
    source_as_of: str,
    observed_at: str,
    validation_status: str,
    reason_code: str,
) -> dict:
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": endpoint_family,
        "domain": "etf_detail",
        "entity": ticker,
        "provider_path": provider_path,
        "payload_sha256": hashlib.sha256(payload_path.read_bytes()).hexdigest(),
        "provider_schema": provider_schema,
        "source_as_of": source_as_of,
        "observed_at": observed_at,
        "validation_status": validation_status,
        "reason_code": reason_code,
        "observation_origin": "natural",
    }
    row["event_id"] = deterministic_event_id("observation", row)
    store = DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=ROOT)
    if validation_status == "valid":
        store.store_provider_object(observation=row, payload=payload_path.read_bytes())
    store.record_observation(row)
    return row


def record_etf_detail_failure_observation(
    *,
    provider: str,
    endpoint_family: str,
    ticker: str,
    provider_path: str,
    provider_schema: str,
    reason_code: str,
    failure_detail: str,
) -> dict:
    observed_at = now_iso()
    failure_descriptor = {
        "provider": provider,
        "endpoint_family": endpoint_family,
        "domain": "etf_detail",
        "entity": ticker,
        "observed_at": observed_at,
        "reason_code": reason_code,
        "failure_detail_sha256": hashlib.sha256(failure_detail.encode("utf-8")).hexdigest(),
    }
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": provider,
        "endpoint_family": endpoint_family,
        "domain": "etf_detail",
        "entity": ticker,
        "provider_path": provider_path,
        "payload_sha256": canonical_sha256(failure_descriptor),
        "provider_schema": provider_schema,
        "source_as_of": None,
        "observed_at": observed_at,
        "validation_status": "invalid",
        "reason_code": reason_code,
        "observation_origin": "natural",
        "payload_available": False,
        "failure_detail_sha256": failure_descriptor["failure_detail_sha256"],
    }
    row["event_id"] = deterministic_event_id("observation", row)
    DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=ROOT).record_observation(row)
    return row


def provider_response_from_error(error: str | None) -> str | None:
    text = str(error or "")
    for code in (400, 404):
        if f"HTTP Error {code}" in text:
            return f"HTTP {code}"
    return None


def record_etf_detail_unavailability_observation(
    *,
    ticker: str,
    provider_path: str,
    failure_detail: str,
) -> dict:
    """Record provider absence as named availability evidence, not a fetch failure."""
    observed_at = now_iso()
    provider_response = provider_response_from_error(failure_detail)
    descriptor = {
        "provider": "stockanalysis",
        "endpoint_family": "stockanalysis_etf_detail",
        "domain": "etf_detail",
        "entity": ticker,
        "observed_at": observed_at,
        "reason_code": "provider_coverage_gap",
        "failure_detail_sha256": hashlib.sha256(failure_detail.encode("utf-8")).hexdigest(),
    }
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": "stockanalysis",
        "endpoint_family": "stockanalysis_etf_detail",
        "domain": "etf_detail",
        "entity": ticker,
        "provider_path": provider_path,
        "payload_sha256": canonical_sha256(descriptor),
        "provider_schema": SCHEMA_VERSION,
        "source_as_of": None,
        "observed_at": observed_at,
        "validation_status": "invalid",
        "reason_code": "provider_coverage_gap",
        "observation_origin": "natural",
        "payload_available": False,
        "failure_detail_sha256": descriptor["failure_detail_sha256"],
        "availability_status": "provider_absent",
        "provider_response": provider_response,
    }
    row["event_id"] = deterministic_event_id("observation", row)
    DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=ROOT).record_observation(row)
    return row


def parse_iso_timestamp(value: str | None) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def payload_age_hours(payload: dict | None) -> float | None:
    fetched = parse_iso_timestamp((payload or {}).get("fetched_at"))
    if fetched is None:
        return None
    return (datetime.now(timezone.utc) - fetched).total_seconds() / 3600


def history_period_rows(payload: dict | None, period_key: str) -> list | None:
    if not isinstance(payload, dict):
        return None
    containers = []
    normalized = payload.get("normalized")
    raw = payload.get("raw")
    if isinstance(normalized, dict):
        containers.append(normalized.get("history_periods"))
    if isinstance(raw, dict):
        containers.append(raw.get("history_periods"))
    for container in containers:
        if isinstance(container, dict) and isinstance(container.get(period_key), list):
            return container.get(period_key)
    return None


def missing_history_periods(payload: dict | None, required_periods: tuple[str, ...]) -> list[str]:
    missing = []
    for period_key in required_periods:
        rows = history_period_rows(payload, period_key)
        min_rows = history_period_min_rows(period_key)
        row_count = (
            valid_unique_history_date_count(rows)
            if period_key == "daily_1y"
            else len(rows or [])
        )
        if not rows or (min_rows is not None and row_count < min_rows):
            missing.append(period_key)
    return missing


def history_period_min_rows(period_key: str) -> int | None:
    if period_key == "daily_1y":
        return DAILY_1Y_MIN_ROWS
    return None


def history_row_utc_date(row: object) -> datetime | None:
    if not isinstance(row, dict):
        return None
    for key in ("date", "t", "time"):
        value = row.get(key)
        if isinstance(value, str):
            parsed = parse_iso_timestamp(value)
            if parsed is not None:
                return parsed
        elif isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            seconds = value / 1000 if value > 10_000_000_000 else value
            try:
                return datetime.fromtimestamp(seconds, tz=timezone.utc)
            except (OSError, OverflowError, ValueError):
                continue
    return None


def valid_unique_history_date_count(rows: object) -> int:
    return len(
        {
            parsed.astimezone(timezone.utc).date()
            for row in (rows if isinstance(rows, list) else [])
            if (parsed := history_row_utc_date(row)) is not None
        }
    )


def utc_weekdays_inclusive(start_dt: datetime, end_dt: datetime) -> int:
    start_date = start_dt.astimezone(timezone.utc).date()
    end_date = end_dt.astimezone(timezone.utc).date()
    if end_date < start_date:
        return 0
    total = 0
    cursor = start_date
    while cursor <= end_date:
        if cursor.weekday() < 5:
            total += 1
        cursor += timedelta(days=1)
    return total


def business_day_age(latest_dt: datetime | None, now_dt: datetime) -> int | None:
    if latest_dt is None:
        return None
    latest_date = latest_dt.astimezone(timezone.utc).date()
    now_date = now_dt.astimezone(timezone.utc).date()
    if latest_date > now_date:
        return None
    if latest_date == now_date:
        return 0
    age = 0
    cursor = latest_date + timedelta(days=1)
    while cursor <= now_date:
        if cursor.weekday() < 5:
            age += 1
        cursor += timedelta(days=1)
    return age


def daily_1y_series_evidence(rows: object, now_dt: datetime) -> dict:
    raw_rows = rows if isinstance(rows, list) else []
    unique_dates = sorted(
        {
            parsed.astimezone(timezone.utc).date()
            for row in raw_rows
            if (parsed := history_row_utc_date(row)) is not None
        }
    )
    earliest = (
        datetime.combine(unique_dates[0], datetime.min.time(), tzinfo=timezone.utc)
        if unique_dates
        else None
    )
    latest = (
        datetime.combine(unique_dates[-1], datetime.min.time(), tzinfo=timezone.utc)
        if unique_dates
        else None
    )
    expected_weekdays = utc_weekdays_inclusive(earliest, latest) if earliest and latest else 0
    observed_weekdays = sum(1 for value in unique_dates if value.weekday() < 5)
    density = min(1.0, observed_weekdays / expected_weekdays) if expected_weekdays > 0 else 0.0
    max_internal_gap = max(
        ((right - left).days for left, right in zip(unique_dates, unique_dates[1:])),
        default=0,
    )
    latest_age = business_day_age(latest, now_dt)
    latest_age_days = (
        (now_dt.astimezone(timezone.utc).date() - latest.date()).days
        if latest is not None and latest.date() <= now_dt.astimezone(timezone.utc).date()
        else None
    )
    policy = DAILY_1Y_HISTORY_EVIDENCE_POLICY
    gates = {
        "min_rows": len(unique_dates) >= policy["min_rows"],
        "density": density >= policy["min_density"],
        "max_internal_gap": max_internal_gap <= policy["max_internal_gap_days"],
        "latest_business_day_age": (
            latest_age is not None
            and latest_age <= policy["max_latest_age_business_days"]
        ),
    }
    return {
        "row_count": len(raw_rows),
        "raw_row_count": len(raw_rows),
        "valid_unique_date_count": len(unique_dates),
        "invalid_or_duplicate_date_count": len(raw_rows) - len(unique_dates),
        "earliest_observation": earliest.date().isoformat() if earliest else None,
        "earliest_date": earliest.date().isoformat() if earliest else None,
        "latest_observation": latest.date().isoformat() if latest else None,
        "latest_date": latest.date().isoformat() if latest else None,
        "span_days": (latest.date() - earliest.date()).days if earliest and latest else None,
        "expected_trading_days": expected_weekdays,
        "expected_utc_weekdays_inclusive": expected_weekdays,
        "observed_trading_days": observed_weekdays,
        "density": round(density, 6),
        "max_internal_gap_days": max_internal_gap,
        "max_internal_calendar_gap_days": max_internal_gap,
        "latest_observation_age_days": latest_age_days,
        "latest_observation_age_business_days": latest_age,
        "latest_business_day_age": latest_age,
        "latest_not_future": latest_age_days is not None,
        "gates": gates,
        "evidence_pass": all(gates.values()),
        "eligible": all(gates.values()),
    }


def evidence_date(evidence: dict | None, key: str) -> datetime | None:
    if not isinstance(evidence, dict):
        return None
    return parse_iso_timestamp(evidence.get(key))


def load_yf_daily_1y_rows(ticker: str) -> list:
    payload = read_json(YF_OUT_DIR / f"{ticker}.json")
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
    rows = data.get("history_1y")
    return rows if isinstance(rows, list) else []


def pending_stable_observation(pending_entry: dict | None, current_start: datetime | None) -> dict:
    if not isinstance(pending_entry, dict) or current_start is None:
        return {"confirmed": False, "pinned_start": None}
    short_evidence = (
        pending_entry.get("short_history_evidence")
        if isinstance(pending_entry.get("short_history_evidence"), dict)
        else {}
    )
    stored_start = parse_iso_timestamp(
        pending_entry.get("confirmed_history_start_date")
        or short_evidence.get("earliest_date")
        or pending_entry.get("observed_history_start_date")
    )
    stable_count = parse_int(pending_entry.get("stable_observation_count")) or 0
    confirmed = bool(
        stable_count >= 2
        and stored_start is not None
        and current_start.date() >= stored_start.date()
    )
    return {
        "confirmed": confirmed,
        "pinned_start": stored_start if confirmed else None,
    }


def classify_daily_1y_history_gap(
    payload: dict | None,
    now_dt: datetime,
    yf_rows: list | None = None,
    pending_entry: dict | None = None,
) -> dict:
    rows = history_period_rows(payload, "daily_1y")
    series = daily_1y_series_evidence(rows, now_dt)
    yf_series = daily_1y_series_evidence(yf_rows, now_dt) if isinstance(yf_rows, list) else None
    declared, declared_source = etf_declared_inception(payload)
    series_start = evidence_date(series, "earliest_date")
    series_latest = evidence_date(series, "latest_date")
    yf_start = evidence_date(yf_series, "earliest_date")
    stable_count = parse_int((pending_entry or {}).get("stable_observation_count")) or 0
    start_delta_yf = (
        abs((series_start.date() - yf_start.date()).days)
        if series_start is not None and yf_start is not None
        else None
    )
    yf_confirms_start = bool(
        series.get("eligible")
        and isinstance(yf_series, dict)
        and yf_series.get("eligible")
        and start_delta_yf is not None
        and start_delta_yf <= DAILY_1Y_HISTORY_EVIDENCE_POLICY["cross_provider_start_tolerance_days"]
    )
    provider_truncated_suspected = bool(
        series_start is not None
        and yf_start is not None
        and isinstance(yf_series, dict)
        and (parse_int(yf_series.get("valid_unique_date_count")) or 0) >= DAILY_1Y_MIN_ROWS
        and (series_start.date() - yf_start.date()).days
        > DAILY_1Y_HISTORY_EVIDENCE_POLICY["provider_truncation_days"]
    )
    stable_observation = pending_stable_observation(pending_entry, series_start)
    stable_confirmed = bool(stable_observation["confirmed"])
    self_history_authoritative = bool(
        isinstance(payload, dict)
        and (
            payload.get("source_provider") == "yahoo_finance"
            or payload.get("source") == "yahoo_finance"
            or payload.get("detail_status") == "yf_fallback"
        )
    )
    confirmed = bool(
        self_history_authoritative
        or (series.get("eligible") and (yf_confirms_start or stable_confirmed))
    )
    confirmed_series_start = (
        stable_observation["pinned_start"]
        if stable_confirmed
        else series_start
    )
    declared_valid = bool(
        declared is not None
        and series_latest is not None
        and declared.date() <= series_latest.date()
    )
    declared_invalid_future = bool(
        declared is not None
        and series_latest is not None
        and declared.date() > series_latest.date()
    )
    declared_delta_days = (
        (series_start.date() - declared.date()).days
        if series_start is not None and declared_valid
        else None
    )
    declared_within_30 = bool(
        declared_delta_days is not None
        and abs(declared_delta_days)
        <= DAILY_1Y_HISTORY_EVIDENCE_POLICY["declared_start_tolerance_days"]
    )
    declared_older_than_start = bool(
        declared_delta_days is not None
        and declared_delta_days
        > DAILY_1Y_HISTORY_EVIDENCE_POLICY["declared_start_tolerance_days"]
    )
    effective_start = None
    if declared_valid and confirmed_series_start is not None:
        effective_start = max(declared, confirmed_series_start)
    elif declared_valid:
        effective_start = declared
    elif confirmed:
        effective_start = confirmed_series_start
    effective_age_days = (
        max(0, (now_dt.astimezone(timezone.utc).date() - effective_start.date()).days)
        if effective_start is not None
        else None
    )
    effective_young = bool(
        effective_age_days is not None
        and effective_age_days < DAILY_1Y_HISTORY_EVIDENCE_POLICY["required_age_days"]
    )

    disposition = "fetchable"
    reason = (
        "full_span_sparse_history"
        if isinstance(series.get("span_days"), int)
        and series["span_days"] >= DAILY_1Y_HISTORY_EVIDENCE_POLICY["required_age_days"]
        else "unconfirmed_short_history"
    )
    effective_source = None
    if provider_truncated_suspected:
        reason = "provider_truncated_suspected"
    elif declared_valid and declared_within_30 and effective_young:
        disposition = "inception_limited"
        reason = "inception_limited_declared"
        effective_source = declared_source or "declared_inception"
    elif confirmed and effective_young:
        effective_source = (
            "daily_1y_cross_provider_start"
            if yf_confirms_start
            else (
                "daily_1y_stable_observation_start"
                if stable_confirmed
                else "daily_1y_history_start"
            )
        )
        if declared_valid and declared_older_than_start:
            disposition = "terminal_limited"
            reason = "provider_history_start_limited"
        else:
            disposition = "inception_limited"
            reason = "inception_limited_observation_derived"

    return {
        "disposition": disposition,
        "reason": reason,
        "declared_inception_date": declared.date().isoformat() if declared else None,
        "declared_inception_source": declared_source,
        "declared_inception_source_field": declared_source,
        "declared_inception_valid": declared_valid,
        "declared_inception_invalid_future": declared_invalid_future,
        "effective_history_start_date": effective_start.date().isoformat() if effective_start else None,
        "effective_history_start_source": effective_source,
        "series_evidence": series,
        "yf_series_evidence": yf_series,
        "yf_start_delta_days": start_delta_yf,
        "stable_observation_count": stable_count,
        "stable_observation_confirmed": stable_confirmed,
        "stable_observation_pinned_start": (
            stable_observation["pinned_start"].date().isoformat()
            if stable_observation["pinned_start"] is not None
            else None
        ),
        "provider_truncated_suspected": provider_truncated_suspected,
        "classification_as_of": now_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "policy": DAILY_1Y_HISTORY_EVIDENCE_POLICY,
    }


def history_period_required_years(period_key: str) -> int | None:
    match = re.search(r"_(\d+)y$", period_key)
    return int(match.group(1)) if match else None


def parse_stockanalysis_date(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    parsed = parse_iso_timestamp(text)
    if parsed is not None:
        return parsed
    match = re.match(r"^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$", text)
    if not match:
        return None
    month = MONTH_NAME_TO_NUMBER.get(match.group(1).lower())
    if month is None:
        return None
    try:
        return datetime(int(match.group(3)), month, int(match.group(2)), tzinfo=timezone.utc)
    except ValueError:
        return None


def etf_declared_inception(payload: dict | None) -> tuple[datetime | None, str | None]:
    if not isinstance(payload, dict):
        return None, None
    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else {}
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    normalized_overview = normalized.get("overview") if isinstance(normalized.get("overview"), dict) else {}
    raw_overview = raw.get("overview") if isinstance(raw.get("overview"), dict) else {}
    candidates = (
        (normalized_overview.get("inception"), "normalized.overview.inception"),
        (raw_overview.get("inception"), "raw.overview.inception"),
        (normalized.get("inceptionDate"), "normalized.inceptionDate"),
        (raw.get("inceptionDate"), "raw.inceptionDate"),
        (payload.get("inceptionDate"), "inceptionDate"),
    )
    for candidate, source in candidates:
        parsed = parse_stockanalysis_date(candidate)
        if parsed is not None:
            return parsed, source
    return None, None


def etf_inception_date(payload: dict | None) -> datetime | None:
    declared, _source = etf_declared_inception(payload)
    return declared


def history_gap_classification(
    payload: dict | None,
    required_periods: tuple[str, ...],
    now_dt: datetime,
    yf_rows: list | None = None,
    pending_entry: dict | None = None,
) -> dict:
    missing = missing_history_periods(payload, required_periods)
    row_counts = {
        period_key: (
            valid_unique_history_date_count(history_period_rows(payload, period_key))
            if period_key == "daily_1y"
            else len(history_period_rows(payload, period_key) or [])
        )
        for period_key in required_periods
    }
    min_rows = {
        period_key: history_period_min_rows(period_key)
        for period_key in required_periods
        if history_period_min_rows(period_key) is not None
    }
    inception = etf_inception_date(payload)
    fetchable = []
    inception_limited = []
    terminal_limited = []
    daily_classification = None
    for period_key in missing:
        if period_key == "daily_1y":
            daily_classification = classify_daily_1y_history_gap(
                payload,
                now_dt,
                yf_rows=yf_rows,
                pending_entry=pending_entry,
            )
            if daily_classification["disposition"] == "inception_limited":
                inception_limited.append(period_key)
            elif daily_classification["disposition"] == "terminal_limited":
                terminal_limited.append(period_key)
            else:
                fetchable.append(period_key)
            continue
        if inception is None:
            fetchable.append(period_key)
            continue
        age_days = max(0, (now_dt - inception).days)
        required_years = history_period_required_years(period_key)
        if required_years is not None and age_days < required_years * 365:
            inception_limited.append(period_key)
        else:
            fetchable.append(period_key)
    result = {
        "missing_history_periods": missing,
        "fetchable_missing_history_periods": fetchable,
        "inception_limited_history_periods": inception_limited,
        "terminal_limited_history_periods": terminal_limited,
        "inception_date": inception.date().isoformat() if inception is not None else None,
        "history_period_row_counts": row_counts,
        "history_period_min_rows": min_rows,
    }
    if daily_classification is not None:
        if result["inception_date"] is None and daily_classification.get("effective_history_start_date"):
            result["inception_date"] = daily_classification["effective_history_start_date"]
        result.update(
            {
                "declared_inception_date": daily_classification.get("declared_inception_date"),
                "declared_inception_source_field": daily_classification.get("declared_inception_source_field"),
                "declared_inception_valid": daily_classification.get("declared_inception_valid"),
                "declared_inception_invalid_future": daily_classification.get("declared_inception_invalid_future"),
                "effective_history_start_date": daily_classification.get("effective_history_start_date"),
                "effective_history_start_source": daily_classification.get("effective_history_start_source"),
                "daily_1y_classification_reason": daily_classification.get("reason"),
                "daily_1y_series_evidence": daily_classification.get("series_evidence"),
                "yf_daily_1y_series_evidence": daily_classification.get("yf_series_evidence"),
                "provider_truncated_suspected": daily_classification.get("provider_truncated_suspected"),
                "stable_observation_count": daily_classification.get("stable_observation_count"),
                "stable_observation_confirmed": daily_classification.get("stable_observation_confirmed"),
                "stable_observation_pinned_start": daily_classification.get("stable_observation_pinned_start"),
                "classification_as_of": daily_classification.get("classification_as_of"),
            }
        )
    return result


def load_pending_ledger() -> dict:
    payload = read_json(OUT_DIR / PENDING_LEDGER_REL_PATH)
    if not isinstance(payload, dict):
        return {
            "schema_version": SCHEMA_VERSION,
            "source": "stockanalysis",
            "operation": "incremental_etf_pending_ledger",
            "entries": {},
        }
    entries = payload.get("entries") if isinstance(payload.get("entries"), dict) else {}
    normalized_entries = {}
    for raw_ticker, raw_entry in entries.items():
        ticker = clean_symbol(str(raw_ticker or ""))
        if not ticker or not isinstance(raw_entry, dict):
            continue
        normalized_entries[ticker] = {**raw_entry, "ticker": ticker}
    payload["entries"] = normalized_entries
    return payload


def pending_entry_in_cooldown(
    entry: dict | None,
    now_dt: datetime,
    cooldown_days: float,
    failure_threshold: int,
) -> bool:
    if isinstance(entry, dict) and entry.get("availability_status") == "provider_absent":
        if cooldown_days <= 0:
            return False
        next_probe = parse_iso_timestamp(
            entry.get("next_probe_after_utc") or entry.get("next_attempt_after_utc")
        )
        return next_probe is not None and now_dt < next_probe
    if not isinstance(entry, dict) or cooldown_days <= 0 or failure_threshold <= 0:
        if not isinstance(entry, dict) or cooldown_days <= 0:
            return False
        if entry.get("failure_class") != "successful_short_history":
            return False
    if entry.get("failure_class") == "successful_short_history":
        next_attempt = parse_iso_timestamp(entry.get("next_attempt_after_utc"))
        if next_attempt is not None:
            return now_dt < next_attempt
        last_attempt = parse_iso_timestamp(entry.get("last_attempt_utc"))
        return last_attempt is not None and now_dt - last_attempt < timedelta(days=cooldown_days)
    failures = parse_int(entry.get("consecutive_failures")) or 0
    if failures < failure_threshold:
        return False
    next_attempt = parse_iso_timestamp(entry.get("next_attempt_after_utc"))
    if next_attempt is not None:
        return now_dt < next_attempt
    last_attempt = parse_iso_timestamp(entry.get("last_attempt_utc"))
    if last_attempt is None:
        return False
    return now_dt - last_attempt < timedelta(days=cooldown_days)


def pending_ledger_counts(payload: dict, now_dt: datetime, cooldown_days: float, failure_threshold: int) -> dict:
    entries = payload.get("entries") if isinstance(payload.get("entries"), dict) else {}
    cooldown = sum(
        1
        for entry in entries.values()
        if pending_entry_in_cooldown(entry, now_dt, cooldown_days, failure_threshold)
    )
    return {
        "tracked": len(entries),
        "cooldown": cooldown,
        "provider_coverage_gaps": sum(
            1 for entry in entries.values()
            if isinstance(entry, dict) and entry.get("availability_status") == "provider_absent"
        ),
    }


def classify_missing_detail_failure(entry: dict | None) -> str:
    if not isinstance(entry, dict):
        return "untracked"
    if entry.get("availability_status") == "provider_absent":
        return "provider_coverage_gap"
    reason = str(entry.get("failure_reason") or "")
    if "quoteType is not ETF/MUTUALFUND" in reason:
        return "external_quote_type_mismatch"
    if "HTTP Error 404" in reason:
        return "source_unavailable"
    if reason:
        return "other_error"
    return "tracked_no_reason"


def classify_missing_detail_status(
    entry: dict | None,
    now_dt: datetime,
    cooldown_days: float,
    failure_threshold: int,
) -> str:
    if not isinstance(entry, dict):
        return "untracked"
    if entry.get("availability_status") == "provider_absent":
        return (
            "provider_gap_cooldown"
            if pending_entry_in_cooldown(entry, now_dt, cooldown_days, failure_threshold)
            else "provider_gap_reprobe_due"
        )
    if pending_entry_in_cooldown(entry, now_dt, cooldown_days, failure_threshold):
        return "retry_cooldown"
    return "retry_pending"


def classify_missing_detail_availability(entry: dict | None) -> str:
    if not isinstance(entry, dict):
        return "unprobed"
    if entry.get("availability_status") == "provider_absent":
        return "provider_absent"
    if entry.get("availability_status") == "provider_available":
        return "provider_available"
    return "unresolved"


def increment_count(payload: dict, key: str) -> None:
    payload[key] = (payload.get(key) or 0) + 1


def update_pending_ledger(
    results: list[dict],
    selected_rows: list[dict],
    cooldown_days: float,
    failure_threshold: int,
    mirror_public: bool,
    now_dt: datetime | None = None,
) -> dict:
    now_dt = now_dt or datetime.now(timezone.utc)
    selected_by_ticker = {}
    for row in selected_rows:
        if not isinstance(row, dict):
            continue
        ticker = clean_symbol(str(row.get("ticker") or ""))
        if ticker:
            selected_by_ticker.setdefault(ticker, row)
    selected = set(selected_by_ticker)
    ledger = load_pending_ledger()
    entries = ledger.get("entries") if isinstance(ledger.get("entries"), dict) else {}
    updated = []
    cleared = []

    for result in results:
        if result.get("asset_type") != "etf":
            continue
        ticker = clean_symbol(str(result.get("ticker") or ""))
        if not ticker or ticker not in selected:
            continue
        error = result.get("error")
        primary_error = result.get("stockanalysis_error")
        if result.get("provider_availability_status") == "absent":
            next_probe = (
                utc_iso(now_dt + timedelta(days=cooldown_days))
                if cooldown_days > 0
                else None
            )
            entries[ticker] = {
                "ticker": ticker,
                "last_attempt_utc": utc_iso(now_dt),
                "availability_status": "provider_absent",
                "availability_reason": (
                    result.get("provider_availability_reason") or "provider_coverage_gap"
                ),
                "provider_response": result.get("provider_response"),
                "failure_reason": None,
                "failure_class": "provider_coverage_gap",
                "consecutive_failures": 0,
                "next_probe_after_utc": next_probe,
                "next_attempt_after_utc": next_probe,
                "last_status": result.get("status"),
                "last_provider": "stockanalysis",
                "fallback_provider": (
                    result.get("provider")
                    if result.get("provider") not in (None, "stockanalysis")
                    else None
                ),
            }
            updated.append(ticker)
            continue
        if error is None and primary_error is None:
            selected_row = selected_by_ticker.get(ticker) or {}
            daily_1y_required = any(
                "daily_1y" in values
                for values in (
                    selected_row.get("missing_history_periods"),
                    selected_row.get("fetchable_missing_history_periods"),
                    selected_row.get("required_history_periods"),
                )
                if isinstance(values, (list, tuple, set))
            ) or selected_row.get("daily_1y_min_rows") == DAILY_1Y_MIN_ROWS
            if result.get("provider") == "stockanalysis" and daily_1y_required:
                post_payload = read_json(OUT_DIR / "etfs" / f"{ticker}.json")
                post_evidence = daily_1y_series_evidence(
                    history_period_rows(post_payload, "daily_1y"),
                    now_dt,
                )
                if (
                    post_evidence["valid_unique_date_count"] < DAILY_1Y_MIN_ROWS
                    and post_evidence["eligible"] is True
                ):
                    existing = entries.get(ticker) if isinstance(entries.get(ticker), dict) else {}
                    pre_evidence = selected_row.get("pre_fetch_daily_1y_evidence")
                    if not isinstance(pre_evidence, dict):
                        pre_evidence = selected_row.get("daily_1y_series_evidence")
                    pre_fetched_at = parse_iso_timestamp(selected_row.get("pre_fetch_payload_fetched_at"))
                    post_fetched_at_text = post_payload.get("fetched_at") if isinstance(post_payload, dict) else None
                    post_fetched_at = parse_iso_timestamp(post_fetched_at_text)
                    separated = bool(
                        pre_fetched_at is not None
                        and post_fetched_at is not None
                        and post_fetched_at - pre_fetched_at >= timedelta(hours=24)
                    )
                    stable_pair = bool(
                        isinstance(pre_evidence, dict)
                        and pre_evidence.get("eligible") is True
                        and post_evidence.get("eligible") is True
                        and pre_evidence.get("earliest_date")
                        and pre_evidence.get("earliest_date") == post_evidence.get("earliest_date")
                        and (pre_evidence.get("latest_date") or "") <= (post_evidence.get("latest_date") or "")
                        and (parse_int(pre_evidence.get("valid_unique_date_count")) or 0)
                        <= post_evidence["valid_unique_date_count"]
                    )
                    existing_count = (
                        parse_int(existing.get("stable_observation_count")) or 0
                        if existing.get("failure_class") == "successful_short_history"
                        else 0
                    )
                    existing_evidence = existing.get("short_history_evidence")
                    same_chain = bool(
                        isinstance(existing_evidence, dict)
                        and existing_evidence.get("earliest_date") == post_evidence.get("earliest_date")
                    )
                    confirmed_start = (
                        existing.get("confirmed_history_start_date")
                        or (
                            existing_evidence.get("earliest_date")
                            if existing_count >= 2 and isinstance(existing_evidence, dict)
                            else None
                        )
                    )
                    rolling_continuation = bool(
                        existing_count >= 2
                        and confirmed_start
                        and post_evidence.get("earliest_date")
                        and post_evidence["earliest_date"] >= confirmed_start
                        and isinstance(existing_evidence, dict)
                        and (existing_evidence.get("latest_date") or "") <= (post_evidence.get("latest_date") or "")
                    )
                    if stable_pair and separated:
                        stable_count = max(2, (existing_count if same_chain else 0) + 1)
                        confirmed_start = confirmed_start or post_evidence.get("earliest_date")
                    elif rolling_continuation:
                        stable_count = existing_count
                    elif same_chain:
                        stable_count = max(1, existing_count)
                    else:
                        stable_count = 1
                        confirmed_start = None
                    next_attempt = (
                        utc_iso(now_dt + timedelta(days=cooldown_days))
                        if cooldown_days > 0
                        else None
                    )
                    entries[ticker] = {
                        "ticker": ticker,
                        "last_attempt_utc": utc_iso(now_dt),
                        "failure_reason": (
                            "successful StockAnalysis primary fetch still has "
                            f"{post_evidence['valid_unique_date_count']} unique daily_1y dates "
                            f"(< {DAILY_1Y_MIN_ROWS})"
                        ),
                        "failure_class": "successful_short_history",
                        "consecutive_failures": 0,
                        "stable_observation_count": stable_count,
                        "observed_history_start_date": post_evidence.get("earliest_date"),
                        "confirmed_history_start_date": confirmed_start,
                        "short_history_evidence": post_evidence,
                        "payload_fetched_at": post_fetched_at_text,
                        "next_attempt_after_utc": next_attempt,
                        "last_status": result.get("status"),
                        "last_provider": result.get("provider"),
                    }
                    updated.append(ticker)
                    continue
            if ticker in entries:
                entries.pop(ticker, None)
                cleared.append(ticker)
            continue
        if error is None:
            error = primary_error

        existing = entries.get(ticker) if isinstance(entries.get(ticker), dict) else {}
        failures = (parse_int(existing.get("consecutive_failures")) or 0) + 1
        next_attempt = None
        if failures >= failure_threshold and cooldown_days > 0:
            next_attempt = utc_iso(now_dt + timedelta(days=cooldown_days))
        entries[ticker] = {
            "ticker": ticker,
            "last_attempt_utc": utc_iso(now_dt),
            "failure_reason": result.get("fallback_error") or error,
            "failure_class": "expected_missing" if is_expected_missing_error(error) else "hard_error",
            "consecutive_failures": failures,
            "next_attempt_after_utc": next_attempt,
            "last_status": result.get("status"),
            "last_provider": result.get("provider"),
        }
        updated.append(ticker)

    ledger = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "operation": "incremental_etf_pending_ledger",
        "generated_at": utc_iso(now_dt),
        "policy": {
            "cooldown_days": cooldown_days,
            "failure_threshold": failure_threshold,
            "rule": "record provider coverage gaps separately from fetch failures; provider-absent ETFs are degraded and re-probed after cooldown, while failed primary attempts and evidence-eligible successful-but-short daily_1y observations retain fair retry rotation",
        },
        "counts": {
            **pending_ledger_counts({"entries": entries}, now_dt, cooldown_days, failure_threshold),
            "updated": len(updated),
            "cleared": len(cleared),
        },
        "updated": sorted(updated),
        "cleared": sorted(cleared),
        "entries": dict(sorted(entries.items())),
    }
    write_payload(PENDING_LEDGER_REL_PATH, ledger, mirror_public)
    return ledger


def etf_detail_backfill_reason(
    ticker: str,
    max_age_hours: float,
    required_history_periods: tuple[str, ...] = (),
) -> tuple[str | None, float | None]:
    payload = read_json(OUT_DIR / "etfs" / f"{ticker}.json")
    if payload is None:
        return "missing", None
    source = payload.get("source")
    detail_status = payload.get("detail_status")
    source_provider = payload.get("source_provider")
    age_hours = payload_age_hours(payload)
    if source != "stockanalysis" or source_provider == "yahoo_finance" or detail_status == "yf_fallback":
        return "fallback_retry", age_hours
    if required_history_periods and missing_history_periods(payload, required_history_periods):
        return "history_gap", age_hours
    if max_age_hours > 0 and (age_hours is None or age_hours >= max_age_hours):
        return "stale", age_hours
    return None, age_hours


def is_daily_1y_history_gap_mode(required_history_periods: tuple[str, ...], history_gaps_only: bool) -> bool:
    return history_gaps_only and required_history_periods == ("daily_1y",)


def load_daily_1y_fetchable_plan_rows() -> list[dict] | None:
    payload = read_json(OUT_DIR.parent / FENOK_EDGE_ETF_DAILY1Y_FETCHABLE_PLAN_REL_PATH)
    if not isinstance(payload, dict):
        return None
    rows = payload.get("rows")
    tickers = payload.get("tickers")
    if not isinstance(rows, list) or not isinstance(tickers, list):
        return None
    normalized_rows = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = clean_symbol(str(row.get("ticker") or ""))
        if not ticker or ticker in seen:
            continue
        normalized_rows.append({**row, "ticker": ticker})
        seen.add(ticker)
    normalized_tickers = [ticker for ticker in (clean_symbol(str(item or "")) for item in tickers) if ticker]
    if normalized_tickers != [row["ticker"] for row in normalized_rows]:
        return None
    return normalized_rows


def daily_1y_plan_candidate_summary(
    plan_rows: list[dict],
    limit: int,
    offset: int,
    exclude: set[str],
    pending_entries: dict,
    cooldown_days: float,
    cooldown_failure_threshold: int,
    now_dt: datetime,
) -> dict:
    safe_offset = max(0, offset)
    scheduled_rows = plan_rows[safe_offset : safe_offset + limit] if limit > 0 else plan_rows[safe_offset:]
    candidates = []
    cooldown_rows = []
    for order, plan_row in enumerate(scheduled_rows, start=safe_offset):
        ticker = plan_row["ticker"]
        if ticker in exclude:
            continue
        pending_entry = pending_entries.get(ticker) if isinstance(pending_entries, dict) else None
        current_payload = read_json(OUT_DIR / "etfs" / f"{ticker}.json")
        pre_fetch_evidence = daily_1y_series_evidence(
            history_period_rows(current_payload, "daily_1y"),
            now_dt,
        )
        pre_fetch_payload_fetched_at = (
            current_payload.get("fetched_at") if isinstance(current_payload, dict) else None
        )
        prior_failures = parse_int((pending_entry or {}).get("consecutive_failures")) or 0
        fetchable_missing = plan_row.get("fetchable_missing")
        missing_periods = fetchable_missing if isinstance(fetchable_missing, list) and fetchable_missing else ["daily_1y"]
        if pending_entry_in_cooldown(pending_entry, now_dt, cooldown_days, cooldown_failure_threshold):
            cooldown_rows.append(
                {
                    "ticker": ticker,
                    "source": "fenok_edge_etf_daily1y_fetchable_plan",
                    "consecutive_failures": (pending_entry or {}).get("consecutive_failures"),
                    "next_attempt_after_utc": (pending_entry or {}).get("next_attempt_after_utc"),
                    "failure_reason": (pending_entry or {}).get("failure_reason"),
                    "plan_order": order,
                    "missing_history_periods": missing_periods,
                    "fetchable_missing_history_periods": missing_periods,
                    "inception_date": plan_row.get("inception_date"),
                }
            )
            continue
        candidates.append(
            {
                "ticker": ticker,
                "source": "fenok_edge_etf_daily1y_fetchable_plan",
                "reason": "history_gap",
                "age_hours": None,
                "prior_failures": prior_failures,
                "priority": 0,
                "reason_priority": 2,
                "plan_order": order,
                "missing_history_periods": missing_periods,
                "fetchable_missing_history_periods": missing_periods,
                "inception_limited_history_periods": [],
                "inception_date": plan_row.get("inception_date"),
                "daily_1y_actual_rows": parse_int(plan_row.get("actual_rows")) or 0,
                "daily_1y_min_rows": DAILY_1Y_MIN_ROWS,
                "missing_file": bool(plan_row.get("missing_file")),
                "pending_consecutive_failures": prior_failures,
                "pending_next_attempt_after_utc": (pending_entry or {}).get("next_attempt_after_utc"),
                "pre_fetch_daily_1y_evidence": pre_fetch_evidence,
                "pre_fetch_payload_fetched_at": pre_fetch_payload_fetched_at,
            }
        )

    selected = candidates
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "operation": "incremental_etf_backfill_select",
        "generated_at": now_iso(),
        "policy": {
            "limit": limit,
            "offset": safe_offset,
            "max_age_hours": None,
            "cooldown_days": cooldown_days,
            "cooldown_failure_threshold": cooldown_failure_threshold,
            "required_history_periods": ["daily_1y"],
            "history_gaps_only": True,
            "selection": "exact Fenok Edge scored-ETF daily_1y fetchable plan; includes missing detail files and daily_1y row-count gaps below min rows",
            "plan_path": f"data/{FENOK_EDGE_ETF_DAILY1Y_FETCHABLE_PLAN_REL_PATH}",
            "min_daily_1y_rows": DAILY_1Y_MIN_ROWS,
        },
        "counts": {
            "candidates": len(candidates),
            "selected": len(selected),
            "missing": 0,
            "fallback_retry": 0,
            "history_gap": len(candidates),
            "inception_limited_history_gap": 0,
            "total_history_gap": len(candidates),
            "stale": 0,
            "cooldown_skipped": len(cooldown_rows),
            "prior_failed_candidates": sum(1 for row in candidates if row.get("prior_failures", 0) > 0),
            "daily_1y_missing_file": sum(1 for row in candidates if row.get("missing_file")),
            "daily_1y_short_rows": sum(1 for row in candidates if not row.get("missing_file")),
            "offset_skipped": min(safe_offset, len(plan_rows)),
            "scheduled_plan_rows": len(scheduled_rows),
        },
        "selected": selected,
        "cooldown": cooldown_rows,
        "inception_limited": [],
    }


def unique_symbols(items: list[str]) -> list[str]:
    out = []
    seen = set()
    for item in items:
        symbol = clean_symbol(str(item or ""))
        if symbol and symbol not in seen:
            out.append(symbol)
            seen.add(symbol)
    return out


def load_surface_symbols(name: str) -> list[str]:
    payload = read_json(OUT_DIR / "surfaces" / f"{name}.json") or {}
    symbols = []
    for row in payload.get("records") or []:
        if isinstance(row, dict):
            symbol = row_ticker(row)
            if symbol:
                symbols.append(symbol)
    return unique_symbols(symbols)


def surface_rows(name: str) -> list[dict]:
    payload = read_json(OUT_DIR / "surfaces" / f"{name}.json") or {}
    rows = []
    for row in payload.get("records") or []:
        if isinstance(row, dict):
            rows.append(row)
    for table in payload.get("tables") or []:
        if not isinstance(table, dict):
            continue
        for row in table.get("records") or []:
            if isinstance(row, dict):
                rows.append(row)
    return rows


def etf_candidate_symbol_sources() -> dict[str, set[str]]:
    sources: dict[str, set[str]] = {}

    def add_symbol(symbol: str | None, source: str) -> None:
        if not symbol:
            return
        sources.setdefault(symbol, set()).add(source)

    universe_payload = read_json(OUT_DIR / "etf_universe.json") or {}
    for row in universe_payload.get("records") or []:
        if isinstance(row, dict):
            add_symbol(row_ticker(row), "etf_universe")

    for surface_name in ("etf_screener", "new_etfs"):
        for row in surface_rows(surface_name):
            add_symbol(row_ticker(row), surface_name)

    return sources


def etf_detail_file_summary() -> dict:
    detail_dir = OUT_DIR / "etfs"
    symbols = []
    stockanalysis_symbols = []
    yahoo_fallback_symbols = []
    invalid_symbols = []

    if not detail_dir.exists():
        return {
            "symbols": symbols,
            "stockanalysis_symbols": stockanalysis_symbols,
            "yahoo_fallback_symbols": yahoo_fallback_symbols,
            "invalid_symbols": invalid_symbols,
        }

    for path in sorted(detail_dir.glob("*.json")):
        ticker = clean_symbol(path.stem)
        if not ticker:
            continue
        payload = read_json(path)
        symbols.append(ticker)
        if not isinstance(payload, dict):
            invalid_symbols.append(ticker)
            continue
        if (
            payload.get("source") == "yahoo_finance"
            or payload.get("source_provider") == "yahoo_finance"
            or payload.get("detail_status") == "yf_fallback"
        ):
            yahoo_fallback_symbols.append(ticker)
        elif payload.get("source") == "stockanalysis":
            stockanalysis_symbols.append(ticker)
        else:
            invalid_symbols.append(ticker)

    return {
        "symbols": symbols,
        "stockanalysis_symbols": stockanalysis_symbols,
        "yahoo_fallback_symbols": yahoo_fallback_symbols,
        "invalid_symbols": invalid_symbols,
    }


def build_etf_detail_coverage() -> dict:
    symbol_sources = etf_candidate_symbol_sources()
    detail_summary = etf_detail_file_summary()
    candidate_symbols = sorted(symbol_sources)
    detail_symbols = sorted(set(detail_summary["symbols"]))
    detail_set = set(detail_symbols)
    candidate_set = set(candidate_symbols)
    covered = sorted(candidate_set & detail_set)
    missing = sorted(candidate_set - detail_set)
    extra = sorted(detail_set - candidate_set)
    yahoo_fallback = sorted(set(detail_summary["yahoo_fallback_symbols"]))
    stockanalysis_detail = sorted(set(detail_summary["stockanalysis_symbols"]))
    invalid_detail = sorted(set(detail_summary["invalid_symbols"]))
    pending_ledger = load_pending_ledger()
    now_dt = datetime.now(timezone.utc)
    pending_counts = pending_ledger_counts(
        pending_ledger,
        now_dt,
        DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS,
        DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES,
    )
    pending_entries = pending_ledger.get("entries") if isinstance(pending_ledger.get("entries"), dict) else {}

    source_breakdown = {
        source: sum(1 for sources in symbol_sources.values() if source in sources)
        for source in ("etf_universe", "etf_screener", "new_etfs")
    }
    missing_by_source = {
        source: sum(1 for ticker in missing if source in symbol_sources.get(ticker, set()))
        for source in ("etf_universe", "etf_screener", "new_etfs")
    }
    missing_status_breakdown = {}
    missing_failure_breakdown = {}
    missing_availability_breakdown = {}
    missing_samples_by_status: dict[str, list[str]] = {}
    missing_samples_by_failure: dict[str, list[str]] = {}
    missing_samples_by_availability: dict[str, list[str]] = {}
    for ticker in missing:
        pending_entry = pending_entries.get(ticker)
        status_key = classify_missing_detail_status(
            pending_entry,
            now_dt,
            DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS,
            DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES,
        )
        failure_key = classify_missing_detail_failure(pending_entry)
        availability_key = classify_missing_detail_availability(pending_entry)
        increment_count(missing_status_breakdown, status_key)
        increment_count(missing_failure_breakdown, failure_key)
        increment_count(missing_availability_breakdown, availability_key)
        missing_samples_by_status.setdefault(status_key, [])
        missing_samples_by_failure.setdefault(failure_key, [])
        missing_samples_by_availability.setdefault(availability_key, [])
        if len(missing_samples_by_status[status_key]) < 12:
            missing_samples_by_status[status_key].append(ticker)
        if len(missing_samples_by_failure[failure_key]) < 12:
            missing_samples_by_failure[failure_key].append(ticker)
        if len(missing_samples_by_availability[availability_key]) < 12:
            missing_samples_by_availability[availability_key].append(ticker)
    coverage_pct = round((len(covered) / len(candidate_symbols)) * 100, 2) if candidate_symbols else 0.0
    primary_pct = round((len(set(stockanalysis_detail) & candidate_set) / len(candidate_symbols)) * 100, 2) if candidate_symbols else 0.0

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "etf_detail_coverage",
        "generated_at": now_iso(),
        "status": "pass" if not missing and not invalid_detail else "warn",
        "policy": {
            "candidate_universe": "union(etf_universe, etf_screener, new_etfs)",
            "detail_file": "data/stockanalysis/etfs/{TICKER}.json",
            "note": "Yahoo fallback files count as covered detail files but remain retry candidates for primary StockAnalysis detail.",
        },
        "paths": {
            "coverage": "coverage/etf_detail.json",
            "etf_universe": "etf_universe.json",
            "etf_screener": "surfaces/etf_screener.json",
            "new_etfs": "surfaces/new_etfs.json",
            "pending_ledger": PENDING_LEDGER_REL_PATH,
        },
        "counts": {
            "candidate_total": len(candidate_symbols),
            "source_breakdown": source_breakdown,
            "detail_files": len(detail_symbols),
            "covered_detail_files": len(covered),
            "missing_detail_files": len(missing),
            "extra_detail_files": len(extra),
            "stockanalysis_detail_files": len(stockanalysis_detail),
            "yahoo_fallback_files": len(yahoo_fallback),
            "invalid_detail_files": len(invalid_detail),
            "coverage_pct": coverage_pct,
            "primary_stockanalysis_pct": primary_pct,
            "missing_by_source": missing_by_source,
            "missing_status_breakdown": dict(sorted(missing_status_breakdown.items())),
            "missing_failure_breakdown": dict(sorted(missing_failure_breakdown.items())),
            "missing_availability_breakdown": dict(sorted(missing_availability_breakdown.items())),
            "pending_tracked": pending_counts.get("tracked", 0),
            "pending_cooldown": pending_counts.get("cooldown", 0),
            "pending_tracked_missing": sum(1 for ticker in missing if ticker in pending_entries),
            "provider_coverage_gaps": pending_counts.get("provider_coverage_gaps", 0),
        },
        "missing_reason_summary": dict(sorted(missing_failure_breakdown.items())),
        "missing_status_summary": dict(sorted(missing_status_breakdown.items())),
        "missing_availability_summary": dict(sorted(missing_availability_breakdown.items())),
        "missing_reason_samples": {
            key: value
            for key, value in sorted(missing_samples_by_failure.items())
        },
        "missing_status_samples": {
            key: value
            for key, value in sorted(missing_samples_by_status.items())
        },
        "missing_availability_samples": {
            key: value
            for key, value in sorted(missing_samples_by_availability.items())
        },
        "missing_tickers": missing,
        "provider_absent_tickers": [
            ticker
            for ticker in missing
            if classify_missing_detail_availability(pending_entries.get(ticker)) == "provider_absent"
        ],
        "yahoo_fallback_tickers": yahoo_fallback,
        "invalid_detail_tickers": invalid_detail,
        "extra_detail_tickers": extra,
        "samples": {
            "missing": missing[:50],
            **{
                f"missing_{key}": value
                for key, value in sorted(missing_samples_by_status.items())
            },
            **{
                f"missing_{key}": value
                for key, value in sorted(missing_samples_by_failure.items())
            },
            "yahoo_fallback": yahoo_fallback[:50],
            "extra": extra[:50],
        },
    }


def write_etf_detail_coverage(mirror_public: bool) -> dict:
    coverage = build_etf_detail_coverage()
    write_payload("coverage/etf_detail.json", coverage, mirror_public)
    return coverage


def attach_etf_detail_coverage_to_index(coverage: dict, mirror_public: bool) -> None:
    index = read_json(OUT_DIR / "index.json")
    if not isinstance(index, dict):
        return
    counts = coverage.get("counts") if isinstance(coverage.get("counts"), dict) else {}
    index_counts = index.get("counts") if isinstance(index.get("counts"), dict) else {}
    index["generated_at"] = now_iso()
    index["counts"] = {
        **index_counts,
        "etf_universe": etf_universe_record_count(),
        "etf_candidate_total": counts.get("candidate_total", 0),
        "etf_detail_files": counts.get("detail_files", 0),
        "etf_detail_covered": counts.get("covered_detail_files", 0),
        "etf_detail_missing": counts.get("missing_detail_files", 0),
        "etf_detail_coverage_pct": counts.get("coverage_pct", 0),
        "etf_detail_primary_pct": counts.get("primary_stockanalysis_pct", 0),
    }
    index["etf_detail_coverage"] = {
        "path": "coverage/etf_detail.json",
        "generated_at": coverage.get("generated_at"),
        "status": coverage.get("status"),
        "counts": counts,
    }
    write_payload("index.json", index, mirror_public)


def incremental_etf_backfill_candidates(
    universe_payload: dict | None,
    limit: int,
    max_age_hours: float,
    offset: int = 0,
    exclude: set[str] | None = None,
    pending_ledger: dict | None = None,
    cooldown_days: float = DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS,
    cooldown_failure_threshold: int = DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES,
    now_dt: datetime | None = None,
    required_history_periods: tuple[str, ...] = (),
    history_gaps_only: bool = False,
) -> dict:
    exclude = exclude or set()
    now_dt = now_dt or datetime.now(timezone.utc)
    pending_ledger = pending_ledger if isinstance(pending_ledger, dict) else load_pending_ledger()
    pending_entries = pending_ledger.get("entries") if isinstance(pending_ledger.get("entries"), dict) else {}
    if is_daily_1y_history_gap_mode(required_history_periods, history_gaps_only):
        daily_1y_plan_rows = load_daily_1y_fetchable_plan_rows()
        if daily_1y_plan_rows is not None:
            return daily_1y_plan_candidate_summary(
                daily_1y_plan_rows,
                limit,
                offset,
                exclude,
                pending_entries,
                cooldown_days,
                cooldown_failure_threshold,
                now_dt,
            )

    sources = [
        ("new_etfs", load_surface_symbols("new_etfs")),
        ("etf_universe", [row.get("ticker") for row in (universe_payload or {}).get("records") or []] or load_etf_universe_symbols()),
        ("etf_screener", load_surface_symbols("etf_screener")),
    ]
    candidates = []
    cooldown_rows = []
    inception_limited_rows = []
    terminal_limited_rows = []
    seen = set()
    source_priority = {"new_etfs": 0, "etf_universe": 1, "etf_screener": 2}
    reason_priority = {"missing": 0, "invalid": 0, "fallback_retry": 1, "history_gap": 2, "stale": 3}

    for source_name, symbols in sources:
        for ticker in unique_symbols(symbols):
            if ticker in seen or ticker in exclude:
                continue
            pending_entry = pending_entries.get(ticker)
            reason, age_hours = etf_detail_backfill_reason(ticker, max_age_hours, required_history_periods)
            if reason is None or (history_gaps_only and reason != "history_gap"):
                continue
            if pending_entry_in_cooldown(pending_entry, now_dt, cooldown_days, cooldown_failure_threshold):
                seen.add(ticker)
                cooldown_rows.append(
                    {
                        "ticker": ticker,
                        "source": source_name,
                        "consecutive_failures": pending_entry.get("consecutive_failures"),
                        "next_attempt_after_utc": pending_entry.get("next_attempt_after_utc"),
                        "failure_reason": pending_entry.get("failure_reason"),
                    }
                )
                continue
            prior_failures = parse_int((pending_entry or {}).get("consecutive_failures")) or 0
            seen.add(ticker)
            row = {
                "ticker": ticker,
                "source": source_name,
                "reason": reason,
                "age_hours": round(age_hours, 2) if age_hours is not None else None,
                "prior_failures": prior_failures,
                "priority": source_priority.get(source_name, 99),
                "reason_priority": reason_priority.get(reason, 99),
            }
            if reason == "history_gap":
                payload = read_json(OUT_DIR / "etfs" / f"{ticker}.json")
                gap = history_gap_classification(
                    payload,
                    required_history_periods,
                    now_dt,
                    yf_rows=load_yf_daily_1y_rows(ticker) if "daily_1y" in required_history_periods else None,
                    pending_entry=pending_entry,
                )
                row.update(gap)
                if gap["missing_history_periods"] and not gap["fetchable_missing_history_periods"]:
                    if gap.get("terminal_limited_history_periods"):
                        row["status"] = "terminal_limited"
                        terminal_limited_rows.append(row)
                    else:
                        row["status"] = "inception_limited"
                        inception_limited_rows.append(row)
                    continue
                if "daily_1y" in required_history_periods:
                    row["pre_fetch_daily_1y_evidence"] = gap.get("daily_1y_series_evidence")
                    row["pre_fetch_payload_fetched_at"] = payload.get("fetched_at") if isinstance(payload, dict) else None
            candidates.append(row)

    candidates.sort(
        key=lambda row: (
            row["reason_priority"],
            row["prior_failures"],
            row["priority"],
            -(row["age_hours"] or 0),
            row["ticker"],
        )
    )
    selected = candidates[:limit] if limit > 0 else candidates
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "operation": "incremental_etf_backfill_select",
        "generated_at": now_iso(),
        "policy": {
            "limit": limit,
            "max_age_hours": max_age_hours,
            "cooldown_days": cooldown_days,
            "cooldown_failure_threshold": cooldown_failure_threshold,
            "required_history_periods": list(required_history_periods),
            "history_gaps_only": history_gaps_only,
            "selection": (
                "primary StockAnalysis ETF detail files missing required history_periods only"
                if history_gaps_only
                else "never-fetched missing ETF details first, lower prior failures before retries, then Yahoo fallback retries, then multi-year history gaps, then stale records; new_etfs are prioritized within each reason/failure bucket, then etf_universe, then etf_screener-only rows"
            ),
        },
        "counts": {
            "candidates": len(candidates),
            "selected": len(selected),
            "missing": sum(1 for row in candidates if row["reason"] == "missing"),
            "fallback_retry": sum(1 for row in candidates if row["reason"] == "fallback_retry"),
            "history_gap": sum(1 for row in candidates if row["reason"] == "history_gap"),
            "inception_limited_history_gap": len(inception_limited_rows),
            "terminal_limited_history_gap": len(terminal_limited_rows),
            "total_history_gap": (
                sum(1 for row in candidates if row["reason"] == "history_gap")
                + len(inception_limited_rows)
                + len(terminal_limited_rows)
            ),
            "stale": sum(1 for row in candidates if row["reason"] == "stale"),
            "cooldown_skipped": len(cooldown_rows),
            "prior_failed_candidates": sum(1 for row in candidates if row.get("prior_failures", 0) > 0),
        },
        "selected": selected,
        "cooldown": cooldown_rows,
        "inception_limited": inception_limited_rows,
        "terminal_limited": terminal_limited_rows,
    }


def build_incremental_etf_backfill_plan(
    planned_etfs: list[str],
    incremental_summary: dict,
    required_history_periods: tuple[str, ...],
    history_gaps_only: bool,
) -> dict:
    counts = incremental_summary.get("counts") if isinstance(incremental_summary.get("counts"), dict) else {}
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "operation": "incremental_etf_backfill_plan",
        "generated_at": now_iso(),
        "mode": "history_gaps_only" if history_gaps_only else "incremental",
        "required_history_periods": list(required_history_periods),
        "policy": {
            "network": "none",
            "writes": "plan artifact only when --write-plan is used",
            "execution_proof": "backfill/incremental_latest.json remains reserved for completed fetch runs",
        },
        "counts": {
            "etfs_planned": len(planned_etfs),
            "incremental_selected": counts.get("selected", 0),
            "incremental_candidates": counts.get("candidates", 0),
            "history_gap": counts.get("history_gap", 0),
            "inception_limited_history_gap": counts.get("inception_limited_history_gap", 0),
            "terminal_limited_history_gap": counts.get("terminal_limited_history_gap", 0),
            "total_history_gap": counts.get("total_history_gap", counts.get("history_gap", 0)),
            "cooldown_skipped": counts.get("cooldown_skipped", 0),
        },
        "etfs": planned_etfs,
        "incremental_etf_backfill": incremental_summary,
    }


def build_missing_detail_reconcile_summary(
    initial_missing: list[str],
    selected: list[str],
    results: list[dict],
    coverage: dict,
) -> dict:
    rows = [
        {
            key: result.get(key)
            for key in (
                "ticker",
                "status",
                "provider",
                "path",
                "provider_availability_status",
                "provider_availability_reason",
                "provider_response",
                "stockanalysis_error",
                "error",
            )
        }
        for result in results
        if result.get("asset_type") == "etf"
    ]
    fetchable_fetched = sum(
        1
        for row in rows
        if row.get("provider") == "stockanalysis"
        and row.get("provider_availability_status") == "available"
        and row.get("error") is None
        and row.get("path")
    )
    provider_absent = sum(
        1 for row in rows if row.get("provider_availability_status") == "absent"
    )
    unresolved = sum(
        1
        for row in rows
        if row.get("error") is not None
        or row.get("provider_availability_status") not in {"available", "absent"}
    )
    coverage_counts = coverage.get("counts") if isinstance(coverage.get("counts"), dict) else {}
    return {
        "schema_version": "stockanalysis-etf-detail-reconcile/v1",
        "source": "stockanalysis",
        "generated_at": now_iso(),
        "operation": "reconcile_missing_etf_details",
        "method": (
            "probe every selected missing ticker against StockAnalysis overview, holdings, and quote; "
            "write an honest stockanalysis_partial detail when provider data is available; classify only "
            "HTTP 400/404 as provider_absent; keep all other responses unresolved and fail the run"
        ),
        "counts": {
            "initial_missing": len(initial_missing),
            "selected": len(selected),
            "fetchable_fetched": fetchable_fetched,
            "provider_absent": provider_absent,
            "unresolved": unresolved,
            "remaining_missing": coverage_counts.get("missing_detail_files", 0),
        },
        "selected_tickers": selected,
        "provider_absent_tickers": sorted(
            row["ticker"]
            for row in rows
            if row.get("ticker") and row.get("provider_availability_status") == "absent"
        ),
        "unresolved_tickers": sorted(
            row["ticker"]
            for row in rows
            if row.get("ticker")
            and (
                row.get("error") is not None
                or row.get("provider_availability_status") not in {"available", "absent"}
            )
        ),
        "results": rows,
    }


def load_yf_finance_module():
    path = ROOT / "scripts" / "fetch-yf-finance.py"
    spec = importlib.util.spec_from_file_location("yf_finance_fetcher", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Yahoo fallback fetcher from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def first_number(*values):
    for value in values:
        parsed = parse_suffix_number(value)
        if parsed is not None:
            return parsed
    return None


def normalize_yahoo_date(value):
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(value, timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def first_present(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None


def ratio_to_percent(value):
    parsed = parse_suffix_number(value)
    if parsed is None:
        return None
    return parsed * 100 if abs(parsed) <= 1.5 else parsed


def normalize_yahoo_holdings(rows) -> list[dict]:
    holdings = []
    for idx, row in enumerate(rows if isinstance(rows, list) else [], 1):
        if not isinstance(row, dict):
            continue
        symbol = clean_symbol(str(row.get("_index") or row.get("symbol") or ""))
        item = {
            "rank": idx,
            "symbol": symbol,
            "name": row.get("Name") or row.get("name"),
            "weight_pct": ratio_to_percent(row.get("Holding Percent") or row.get("weight")),
            "raw": row,
        }
        holdings.append({key: value for key, value in item.items() if value is not None})
    return holdings


def yahoo_etf_payload(ticker: str, yf_payload: dict) -> dict:
    data = yf_payload.get("data") or {}
    if not isinstance(data, dict):
        raise ValueError("Yahoo fallback data container must be an object")
    info = data.get("info") or {}
    fast_info = data.get("fast_info") or {}
    funds_data = data.get("funds_data") or {}
    if not isinstance(info, dict) or not isinstance(fast_info, dict) or not isinstance(funds_data, dict):
        raise ValueError("Yahoo fallback detail containers must be objects")
    history_1y = data.get("history_1y")
    if history_1y is not None and not isinstance(history_1y, list):
        raise ValueError("Yahoo fallback history_1y must be a list")
    normalized_history = []
    for row in history_1y or []:
        if not isinstance(row, dict) or not isinstance(row.get("date"), str) or not row["date"].strip():
            raise ValueError("Yahoo fallback history rows must be dated objects")
        close = row.get("close", row.get("Close"))
        if close is None:
            continue
        if not isinstance(close, (int, float)) or isinstance(close, bool) or not math.isfinite(close):
            raise ValueError("Yahoo fallback history close must be finite numeric")
        normalized_history.append(row)
    fund_overview = funds_data.get("fund_overview") or {}
    if not isinstance(fund_overview, dict):
        raise ValueError("Yahoo fallback fund_overview must be an object")
    description = funds_data.get("description")
    if description is not None and not isinstance(description, str):
        raise ValueError("Yahoo fallback description must be a string")
    top_holdings = funds_data.get("top_holdings")
    asset_classes = funds_data.get("asset_classes")
    sector_weightings = funds_data.get("sector_weightings")
    if top_holdings is not None and not isinstance(top_holdings, list):
        raise ValueError("Yahoo fallback top_holdings must be a list")
    if asset_classes is not None and not isinstance(asset_classes, dict):
        raise ValueError("Yahoo fallback asset_classes must be an object")
    if sector_weightings is not None and not isinstance(sector_weightings, dict):
        raise ValueError("Yahoo fallback sector_weightings must be an object")
    if any(not isinstance(row, dict) for row in top_holdings or []):
        raise ValueError("Yahoo fallback holding rows must be objects")
    for field, values in (("asset_classes", asset_classes), ("sector_weightings", sector_weightings)):
        for key, value in (values or {}).items():
            if (
                not isinstance(key, str)
                or not key
                or not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
            ):
                raise ValueError(f"Yahoo fallback {field} entries must be finite numeric mappings")
    quote_type = str(info.get("quoteType") or funds_data.get("quote_type") or "").upper()
    if quote_type not in {"ETF", "MUTUALFUND"}:
        raise ValueError(f"Yahoo fallback quoteType is not ETF/MUTUALFUND: {quote_type}")
    response_symbol = clean_symbol(str(info.get("symbol") or funds_data.get("symbol") or ""))
    if response_symbol != ticker:
        raise ValueError(f"Yahoo fallback symbol mismatch: requested={ticker} response={response_symbol}")

    price = first_number(info.get("currentPrice"), fast_info.get("last_price"), fast_info.get("lastPrice"))
    previous_close = first_number(info.get("previousClose"), fast_info.get("previous_close"), fast_info.get("previousClose"))
    change = None if price is None or previous_close is None else price - previous_close
    change_pct = None if change is None or previous_close in (None, 0) else (change / previous_close) * 100
    holdings = normalize_yahoo_holdings(top_holdings)
    inception = first_present(
        normalize_yahoo_date(info.get("fundInceptionDate")),
        normalize_yahoo_date(info.get("inceptionDate")),
        normalize_yahoo_date((fund_overview or {}).get("inceptionDate")),
        normalize_yahoo_date((fund_overview or {}).get("inception")),
    )
    overview = {
        "aum": first_number(info.get("totalAssets"), info.get("netAssets")),
        "nav": first_number(info.get("navPrice")),
        "expenseRatio": first_number(info.get("netExpenseRatio"), info.get("annualReportExpenseRatio")),
        "dividendYield": first_number(info.get("dividendYield"), info.get("yield")),
        "beta": first_number(info.get("beta3Year"), info.get("beta")),
        "provider_page": info.get("fundFamily") or (fund_overview or {}).get("family"),
        "category": info.get("category") or (fund_overview or {}).get("categoryName"),
        "legalType": info.get("legalType") or (fund_overview or {}).get("legalType"),
        "inception": inception,
        "description": description,
    }
    overview = {key: value for key, value in overview.items() if value is not None}
    classification = classify_etf(
        {
            "ticker": ticker,
            "name": info.get("longName") or info.get("shortName"),
            "category": overview.get("category"),
        },
        overview={"description": description} if description else overview,
        holdings=holdings,
    )
    has_minimum_detail = any(
        (
            price is not None,
            bool(holdings),
            bool(overview),
            bool(normalized_history),
            bool(asset_classes),
            bool(sector_weightings),
        )
    )
    if not has_minimum_detail:
        raise ValueError("Yahoo fallback does not satisfy the minimum ETF detail contract")

    return {
        "schema_version": "yf-etf-detail/v1",
        "source": "yahoo_finance",
        "source_provider": "yahoo_finance",
        "detail_status": "yf_fallback",
        "asset_type": "etf",
        "ticker": ticker,
        "source_as_of": yahoo_detail_source_timestamp(yf_payload),
        "source_as_of_reason": (
            None
            if yahoo_detail_source_timestamp(yf_payload)
            else "provider payload carries no market observation date"
        ),
        "inceptionDate": inception,
        "fetched_at": yf_payload.get("fetched_at") or now_iso(),
        "role": "ETF detail fallback while StockAnalysis ETF REST endpoints are not indexed yet",
        "normalized": {
            "holdings": holdings,
            "asset_allocation": asset_classes,
            "sectors": sector_weightings,
            "countries": None,
            "holding_count": len(holdings) if holdings else None,
            "holdings_updated": yahoo_detail_source_timestamp(yf_payload),
            "classification": classification,
            "overview": overview,
            "quote": {
                key: value
                for key, value in {
                    "p": price,
                    "pd": previous_close,
                    "c": change,
                    "cp": change_pct,
                    "u": yahoo_detail_source_timestamp(yf_payload),
                    "ex": "yahoo_finance",
                }.items()
                if value is not None
            },
            "history": normalized_history,
            "history_periods": {
                "daily_1y": normalized_history,
            },
        },
        "raw": {
            "yf": data,
        },
    }


def fetch_yahoo_etf_fallback(ticker: str, mirror_public: bool) -> dict:
    module = load_yf_finance_module()
    data, _latency_ms, error = module.fetch_with_retry(ticker, profile="etf", retries=0, backoffs=())
    if error is not None or data is None:
        raise RuntimeError(error or "Yahoo fallback returned no data")
    fetched_at = now_iso()
    yf_payload = build_yf_payload(ticker, data, fetched_at)
    raw_payload = write_yf_payload(ticker, data, mirror_public, fetched_at)
    try:
        etf_payload = yahoo_etf_payload(ticker, yf_payload)
        candidate_path = write_yf_etf_detail_payload(ticker, etf_payload)
    except ValueError as exc:
        record_etf_detail_failure_observation(
            provider="yahoo_finance",
            endpoint_family="yahoo_etf_detail",
            ticker=ticker,
            provider_path=f"data/yf/finance/{ticker}.json",
            provider_schema=raw_payload["schema_version"],
            reason_code=(
                "source_date_unavailable"
                if "source date is unavailable" in str(exc)
                else "source_date_mismatch"
                if "disagrees with provider evidence" in str(exc)
                else "normalization_invalid"
            ),
            failure_detail=f"{type(exc).__name__}: {exc}",
        )
        raise
    record_etf_detail_observation(
        provider="yahoo_finance",
        endpoint_family="yahoo_etf_detail",
        ticker=ticker,
        provider_path=f"data/yf/etf-details/{ticker}.json",
        payload_path=candidate_path,
        provider_schema=etf_payload["schema_version"],
        source_as_of=etf_payload["source_as_of"],
        observed_at=fetched_at,
        validation_status="valid",
        reason_code="contract_valid",
    )
    return etf_payload


def classify_existing_etf_catalog(rel_path: str, mirror_public: bool) -> dict | None:
    path = OUT_DIR / rel_path
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload.get("records")
    if not isinstance(records, list):
        return None
    enriched = enrich_etf_records(records)
    payload["records"] = enriched
    counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
    counts["classification"] = etf_classification_counts(enriched)
    counts["detail_enrichment"] = etf_detail_enrichment_counts(enriched)
    payload["counts"] = counts
    payload["classification_refreshed_at"] = now_iso()
    write_payload(rel_path, payload, mirror_public)
    return {
        "path": rel_path,
        "records": len(enriched),
        "classification": counts["classification"],
    }


def classify_existing_etf_catalogs(mirror_public: bool) -> dict:
    results = []
    for rel_path in ("etf_universe.json", "surfaces/etf_screener.json"):
        result = classify_existing_etf_catalog(rel_path, mirror_public)
        if result is not None:
            results.append(result)
    summary = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "generated_at": now_iso(),
        "operation": "classify_existing_etf_catalogs",
        "results": results,
    }
    write_payload("classification/latest.json", summary, mirror_public)
    return summary


def has_existing_stockanalysis_etf_detail(ticker: str) -> bool:
    payload = read_json(OUT_DIR / "etfs" / f"{ticker}.json")
    return isinstance(payload, dict) and payload.get("source") == "stockanalysis"


def run_one(
    kind: str,
    ticker: str,
    timeout: int,
    mirror_public: bool,
    include_financials: bool = False,
    yf_fallback: bool = False,
    include_etf_history: bool = True,
) -> dict:
    start = time.perf_counter()
    preserved_primary = False
    provider_availability_status = None
    provider_availability_reason = None
    provider_response = None
    try:
        if kind == "etf":
            try:
                payload = (
                    fetch_etf(ticker, timeout)
                    if include_etf_history
                    else fetch_etf(ticker, timeout, include_history=False)
                )
                provider = "stockanalysis"
                stockanalysis_error = None
                provider_availability_status = "available"
                provider_availability_reason = "provider_detail_contract_valid"
                provider_response = "HTTP 200 contract valid"
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as exc:
                stockanalysis_error = f"{type(exc).__name__}: {exc}"
                provider_gap = is_expected_missing_error(stockanalysis_error)
                failure_reason = (
                    "endpoint_missing"
                    if provider_gap
                    else "schema_invalid"
                    if isinstance(exc, (json.JSONDecodeError, ValueError))
                    else "fetch_failed"
                )
                if provider_gap:
                    provider_availability_status = "absent"
                    provider_availability_reason = "provider_coverage_gap"
                    provider_response = provider_response_from_error(stockanalysis_error)
                    record_etf_detail_unavailability_observation(
                        ticker=ticker,
                        provider_path=f"data/stockanalysis/etfs/{ticker}.json",
                        failure_detail=stockanalysis_error,
                    )
                else:
                    record_etf_detail_failure_observation(
                        provider="stockanalysis",
                        endpoint_family="stockanalysis_etf_detail",
                        ticker=ticker,
                        provider_path=f"data/stockanalysis/etfs/{ticker}.json",
                        provider_schema=SCHEMA_VERSION,
                        reason_code=failure_reason,
                        failure_detail=stockanalysis_error,
                    )
                if not yf_fallback:
                    if provider_gap:
                        return {
                            "ticker": ticker,
                            "asset_type": kind,
                            "status": "provider_coverage_gap",
                            "provider": "stockanalysis",
                            "path": None,
                            "latency_ms": round((time.perf_counter() - start) * 1000),
                            "stockanalysis_error": stockanalysis_error,
                            "provider_availability_status": provider_availability_status,
                            "provider_availability_reason": provider_availability_reason,
                            "provider_response": provider_response,
                            "error": None,
                        }
                    raise
                try:
                    payload = fetch_yahoo_etf_fallback(ticker, mirror_public)
                except Exception as fallback_exc:
                    if provider_gap:
                        return {
                            "ticker": ticker,
                            "asset_type": kind,
                            "status": "provider_coverage_gap",
                            "provider": "stockanalysis",
                            "path": None,
                            "latency_ms": round((time.perf_counter() - start) * 1000),
                            "stockanalysis_error": stockanalysis_error,
                            "fallback_error": f"{type(fallback_exc).__name__}: {fallback_exc}",
                            "provider_availability_status": provider_availability_status,
                            "provider_availability_reason": provider_availability_reason,
                            "provider_response": provider_response,
                            "error": None,
                        }
                    return {
                        "ticker": ticker,
                        "asset_type": kind,
                        "status": "error",
                        "provider": "yahoo_finance",
                        "path": None,
                        "latency_ms": round((time.perf_counter() - start) * 1000),
                        "stockanalysis_error": stockanalysis_error,
                        "fallback_error": f"{type(fallback_exc).__name__}: {fallback_exc}",
                        "error": stockanalysis_error,
                    }
                payload["stockanalysis_error"] = stockanalysis_error
                provider = "yahoo_finance"
            rel_path = f"etfs/{ticker}.json"
            preserved_primary = provider == "yahoo_finance" and has_existing_stockanalysis_etf_detail(ticker)
            financials = None
            financials_rel_path = None
        else:
            stock_supply = load_stock_detail_supply()
            financials = fetch_financials(ticker, timeout) if include_financials else None
            financials_rel_path = f"financials/{ticker}.json" if financials is not None else None
            try:
                payload = fetch_stock(ticker, timeout, financials)
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError, RuntimeError) as exc:
                if stock_supply.is_enrolled_stock_detail(ticker):
                    observed_at = now_iso()
                    stock_supply.record_stock_detail_failure(
                        store=DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=OUT_DIR.parent.parent),
                        provider="stockanalysis",
                        entity=ticker,
                        provider_path=f"data/stockanalysis/stocks/{ticker}.json",
                        observed_at=observed_at,
                        reason_code=(
                            "endpoint_missing"
                            if is_expected_missing_error(str(exc))
                            else "schema_invalid"
                            if isinstance(exc, (json.JSONDecodeError, ValueError))
                            else "fetch_failed"
                        ),
                        failure_detail=f"{type(exc).__name__}: {exc}",
                        origin="manual",
                    )
                raise
            rel_path = f"stocks/{ticker}.json"
            provider = "stockanalysis"
            stockanalysis_error = None
        if provider == "stockanalysis":
            if kind == "etf":
                try:
                    validate_stockanalysis_etf_payload(ticker, payload)
                except ValueError as exc:
                    record_etf_detail_failure_observation(
                        provider="stockanalysis",
                        endpoint_family="stockanalysis_etf_detail",
                        ticker=ticker,
                        provider_path=f"data/stockanalysis/etfs/{ticker}.json",
                        provider_schema=SCHEMA_VERSION,
                        reason_code=(
                            "source_date_unavailable"
                            if "source date is unavailable" in str(exc)
                            else "source_date_mismatch"
                            if "disagrees with provider evidence" in str(exc)
                            else "schema_invalid"
                        ),
                        failure_detail=f"{type(exc).__name__}: {exc}",
                    )
                    raise
            stock_candidate = None
            stock_observed_at = None
            if kind == "stock" and stock_supply.is_enrolled_stock_detail(ticker):
                candidate_bytes = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                stock_observed_at = now_iso()
                try:
                    stock_candidate = stock_supply.validate_stock_detail_candidate(
                        provider="stockanalysis",
                        entity=ticker,
                        provider_path=f"data/stockanalysis/{rel_path}",
                        payload_bytes=candidate_bytes,
                        observed_at=stock_observed_at,
                        provider_truth_root=OUT_DIR.parent.parent,
                    )
                except stock_supply.StockDetailValidationError as exc:
                    stock_supply.record_stock_detail_failure(
                        store=DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=OUT_DIR.parent.parent),
                        provider="stockanalysis",
                        entity=ticker,
                        provider_path=f"data/stockanalysis/{rel_path}",
                        observed_at=stock_observed_at,
                        reason_code=exc.reason_code,
                        failure_detail=exc.detail,
                        origin="manual",
                    )
                    raise
            write_payload(rel_path, payload, mirror_public)
            if kind == "etf":
                provider_path = OUT_DIR / rel_path
                source_as_of = payload.get("source_as_of")
                observed_at = payload.get("fetched_at") or now_iso()
                validate_aware_timestamp(source_as_of, "StockAnalysis ETF detail source stamp")
                record_etf_detail_observation(
                    provider="stockanalysis",
                    endpoint_family="stockanalysis_etf_detail",
                    ticker=ticker,
                    provider_path=f"data/stockanalysis/{rel_path}",
                    payload_path=provider_path,
                    provider_schema=payload.get("schema_version") or SCHEMA_VERSION,
                    source_as_of=source_as_of,
                    observed_at=observed_at,
                    validation_status="valid",
                    reason_code="contract_valid",
                )
            elif stock_candidate is not None:
                provider_path = OUT_DIR / rel_path
                verified = stock_supply.validate_stock_detail_candidate(
                    provider="stockanalysis",
                    entity=ticker,
                    provider_path=f"data/stockanalysis/{rel_path}",
                    payload_bytes=provider_path.read_bytes(),
                    observed_at=stock_observed_at,
                    expected_sha256=stock_candidate.payload_sha256,
                    provider_truth_root=OUT_DIR.parent.parent,
                )
                stock_supply.record_stock_detail_success(
                    store=DataSupplyStateStore(DATA_SUPPLY_STATE_ROOT, provider_truth_root=OUT_DIR.parent.parent),
                    candidate=verified,
                    observed_at=stock_observed_at,
                    origin="manual",
                )
        if financials is not None and financials_rel_path is not None:
            write_payload(financials_rel_path, financials, mirror_public)
        return {
            "ticker": ticker,
            "asset_type": kind,
            "status": (
                "ok"
                if provider == "stockanalysis"
                else "fallback_observed_primary_preserved"
                if preserved_primary
                else "fallback_candidate_ok"
            ),
            "provider": provider,
            "selected_provider": "stockanalysis" if preserved_primary else provider if provider == "stockanalysis" else None,
            "canonical_write": provider == "stockanalysis",
            "path": rel_path if provider == "stockanalysis" or preserved_primary else None,
            "candidate_path": f"data/yf/etf-details/{ticker}.json" if provider == "yahoo_finance" else None,
            "financials_path": financials_rel_path,
            "latency_ms": round((time.perf_counter() - start) * 1000),
            "stockanalysis_error": stockanalysis_error,
            "provider_availability_status": provider_availability_status,
            "provider_availability_reason": provider_availability_reason,
            "provider_response": provider_response,
            "error": None,
        }
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as exc:
        return {
            "ticker": ticker,
            "asset_type": kind,
            "status": "error",
            "provider": None,
            "path": None,
            "latency_ms": round((time.perf_counter() - start) * 1000),
            "error": f"{type(exc).__name__}: {exc}",
        }
    except RuntimeError as exc:
        return {
            "ticker": ticker,
            "asset_type": kind,
            "status": "error",
            "provider": None,
            "path": None,
            "latency_ms": round((time.perf_counter() - start) * 1000),
            "error": f"{type(exc).__name__}: {exc}",
        }


def is_expected_missing_error(error: str | None) -> bool:
    """StockAnalysis has universe rows whose holdings endpoint returns a stable 404
    or 400 (delisted/invalid symbols, e.g. LSTB/MSIX). Treat both as expected-missing
    so dead tickers do not hard-fail the unattended fetch + market-audit gate."""
    return bool(error and ("HTTP Error 404" in error or "HTTP Error 400" in error))


def is_hard_error(error: str | None) -> bool:
    """Hard errors should stop unattended backfill loops."""
    return bool(error and not is_expected_missing_error(error))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--etfs", default="", help="comma-separated ETF override; default focus ETF list")
    parser.add_argument("--stocks", default="", help="comma-separated stock symbols")
    parser.add_argument("--stocks-only", action="store_true", help="skip ETF payload refresh and fetch only stock payloads")
    parser.add_argument("--fetch-financials", action="store_true", help="also fetch stock financial statements for the stock focus set")
    parser.add_argument("--discover-etf-universe", action="store_true", help="scrape /etf/ list pages into etf_universe.json")
    parser.add_argument("--classify-etf-catalogs", action="store_true", help="classify existing ETF universe/screener catalogs from local ETF detail payloads")
    parser.add_argument("--universe-only", action="store_true", help="only refresh etf_universe.json; do not deep-fetch ETF payloads")
    parser.add_argument("--universe-backfill", action="store_true", help="deep-fetch ETFs from etf_universe.json instead of the focus ETF list")
    parser.add_argument("--incremental-etf-backfill", action="store_true", help="auto deep-fetch new/missing/stale ETF details without a full universe run")
    parser.add_argument("--reconcile-missing-etf-details", action="store_true", help="classify and close every selected missing ETF detail using provider responses; HTTP 400/404 become named provider gaps")
    parser.add_argument("--incremental-etf-only", action="store_true", help="with --incremental-etf-backfill, skip the default focus ETF refresh and fetch only explicit --etfs plus selected incremental candidates")
    parser.add_argument("--history-gaps-only", action="store_true", help="with --incremental-etf-backfill, select only primary StockAnalysis ETF details missing required history_periods")
    parser.add_argument("--required-history-periods", default="", help="comma-separated history_periods required for --history-gaps-only; default monthly_3y,monthly_5y")
    parser.add_argument("--plan-only", action="store_true", help="print the selected incremental ETF plan without network fetches or data writes")
    parser.add_argument("--write-plan", action="store_true", help="with --plan-only, also write backfill/incremental_plan_latest.json without network fetches")
    parser.add_argument("--coverage-only", action="store_true", help="rebuild local ETF detail coverage proof without network fetches")
    parser.add_argument("--incremental-etf-limit", type=int, default=DEFAULT_INCREMENTAL_ETF_LIMIT, help="maximum incremental ETF detail retries per run")
    parser.add_argument("--incremental-etf-max-age-hours", type=float, default=DEFAULT_INCREMENTAL_ETF_MAX_AGE_HOURS, help="existing StockAnalysis ETF detail age before it becomes stale")
    parser.add_argument("--incremental-etf-cooldown-days", type=float, default=DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS, help="days to skip ETFs after repeated expected-missing failures")
    parser.add_argument("--incremental-etf-cooldown-failures", type=int, default=DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES, help="consecutive expected-missing failures before ETF cooldown")
    parser.add_argument("--yf-etf-fallback", action="store_true", help="fallback to Yahoo ETF/fund data when StockAnalysis ETF detail endpoints return 404")
    parser.add_argument("--fetch-surfaces", action="store_true", help="refresh high-value public table surfaces into surfaces/*.json")
    parser.add_argument("--surface-set", choices=sorted(SURFACE_SETS), default="core", help="named surface bundle to fetch")
    parser.add_argument("--surfaces", default="", help="comma-separated surface override; default = --surface-set")
    parser.add_argument("--surfaces-only", action="store_true", help="only refresh surfaces; do not deep-fetch ETF/stock payloads")
    parser.add_argument("--offset", type=int, default=0, help="ETF offset for universe backfill chunking")
    parser.add_argument("--limit-etfs", type=int, default=0)
    parser.add_argument("--max-universe-pages", type=int, default=100)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--endpoint-canary", action="store_true", help="probe current ETF detail/quote/history contracts before collection")
    parser.add_argument("--no-public-mirror", action="store_true")
    parser.add_argument("--fail-on-error", action="store_true", help="exit non-zero when any ticker fails")
    parser.add_argument("--stop-on-hard-error", action="store_true", help="stop chunk on non-404 fetch errors")
    args = parser.parse_args()

    if args.incremental_etf_only and not args.incremental_etf_backfill:
        raise SystemExit("--incremental-etf-only requires --incremental-etf-backfill")
    if args.history_gaps_only and not args.incremental_etf_backfill:
        raise SystemExit("--history-gaps-only requires --incremental-etf-backfill")
    if args.required_history_periods and not args.incremental_etf_backfill:
        raise SystemExit("--required-history-periods requires --incremental-etf-backfill")
    if args.plan_only and not args.incremental_etf_backfill:
        raise SystemExit("--plan-only currently supports --incremental-etf-backfill")
    if args.write_plan and not args.plan_only:
        raise SystemExit("--write-plan requires --plan-only")
    if args.plan_only and any((args.discover_etf_universe, args.fetch_surfaces, args.coverage_only, args.classify_etf_catalogs)):
        raise SystemExit("--plan-only uses existing local files; do not combine it with fetch/write modes")
    if args.reconcile_missing_etf_details and any(
        (
            args.discover_etf_universe,
            args.fetch_surfaces,
            args.universe_backfill,
            args.incremental_etf_backfill,
            args.coverage_only,
            args.classify_etf_catalogs,
            args.stocks_only,
            args.etfs,
            args.stocks,
            args.fetch_financials,
        )
    ):
        raise SystemExit("--reconcile-missing-etf-details is an isolated producer mode")

    mirror_public = not args.no_public_mirror
    if args.endpoint_canary:
        canary = run_endpoint_canary(args.timeout)
        write_payload(ENDPOINT_CANARY_REL_PATH, canary, mirror_public)
        print(
            "[endpoint-canary] "
            f"ready={canary['counts']['ready']}/{canary['counts']['probes']} "
            f"blocked={canary['counts']['blocked']} status={canary['status']}",
            flush=True,
        )
        if canary["status"] != "ready":
            raise SystemExit(3)
    required_history_periods = (
        parse_history_periods(args.required_history_periods)
        if args.required_history_periods
        else DEFAULT_HISTORY_GAP_PERIODS
        if args.history_gaps_only
        else ()
    )
    classify_catalogs_requested = args.classify_etf_catalogs
    no_other_work = not any(
        (
            args.discover_etf_universe,
            args.fetch_surfaces,
            args.universe_backfill,
            args.incremental_etf_backfill,
            args.reconcile_missing_etf_details,
            args.coverage_only,
            args.stocks_only,
            args.etfs,
            args.stocks,
            args.fetch_financials,
        )
    )
    if classify_catalogs_requested and no_other_work:
        classification_summary = classify_existing_etf_catalogs(mirror_public)
        print(f"[classify-etf-catalogs] catalogs={len(classification_summary['results'])}", flush=True)
        return

    if args.coverage_only:
        coverage = write_etf_detail_coverage(mirror_public)
        attach_etf_detail_coverage_to_index(coverage, mirror_public)
        counts = coverage["counts"]
        print(
            "[etf-detail-coverage] "
            f"covered={counts['covered_detail_files']}/{counts['candidate_total']} "
            f"missing={counts['missing_detail_files']} "
            f"yahoo_fallback={counts['yahoo_fallback_files']} "
            f"status={coverage['status']}",
            flush=True,
        )
        return

    universe_payload = None
    if args.discover_etf_universe:
        universe_payload = fetch_etf_universe(args.max_universe_pages, args.timeout, args.sleep)
        write_payload("etf_universe.json", universe_payload, mirror_public)
        print(
            f"[universe] ETFs={universe_payload['counts']['records']} pages={universe_payload['counts']['pages']}",
            flush=True,
        )

    surface_summary = None
    if args.fetch_surfaces:
        surface_names = parse_surface_names(args.surfaces, args.surface_set)
        surface_summary = fetch_surfaces(surface_names, args.timeout, args.sleep, mirror_public)

    if args.universe_only or args.surfaces_only:
        coverage = write_etf_detail_coverage(mirror_public)
        attach_etf_detail_coverage_to_index(coverage, mirror_public)
        return

    reconcile_initial_missing = []
    reconcile_selected = []
    if args.reconcile_missing_etf_details:
        coverage_before = build_etf_detail_coverage()
        reconcile_initial_missing = list(coverage_before.get("missing_tickers") or [])
        reconcile_selected = reconcile_initial_missing[max(0, args.offset):]
        if args.incremental_etf_limit > 0:
            reconcile_selected = reconcile_selected[: args.incremental_etf_limit]
        etfs = reconcile_selected[:]
        print(
            "[missing-detail-reconcile-plan] "
            f"initial_missing={len(reconcile_initial_missing)} selected={len(reconcile_selected)} "
            f"offset={max(0, args.offset)}",
            flush=True,
        )
    else:
        explicit_etfs = parse_symbols(args.etfs)
        etfs = select_base_etfs(
            explicit_etfs,
            stocks_only=args.stocks_only,
            universe_backfill=args.universe_backfill,
            incremental_etf_backfill=args.incremental_etf_backfill,
            incremental_etf_only=args.incremental_etf_only,
            universe_payload=universe_payload,
        )

        if args.offset:
            etfs = etfs[args.offset:]
        if args.limit_etfs:
            etfs = etfs[: args.limit_etfs]
    incremental_summary = None
    if args.incremental_etf_backfill and not args.universe_backfill and not args.stocks_only:
        incremental_summary = incremental_etf_backfill_candidates(
            universe_payload=universe_payload,
            limit=args.incremental_etf_limit,
            max_age_hours=args.incremental_etf_max_age_hours,
            offset=args.offset,
            exclude=set(etfs),
            cooldown_days=args.incremental_etf_cooldown_days,
            cooldown_failure_threshold=args.incremental_etf_cooldown_failures,
            required_history_periods=required_history_periods,
            history_gaps_only=args.history_gaps_only,
        )
        incremental_etfs = [row["ticker"] for row in incremental_summary["selected"]]
        planned_etfs = unique_symbols(etfs + incremental_etfs)
        if args.plan_only:
            plan_payload = build_incremental_etf_backfill_plan(
                planned_etfs,
                incremental_summary,
                required_history_periods,
                args.history_gaps_only,
            )
            if args.write_plan:
                write_payload(INCREMENTAL_PLAN_REL_PATH, plan_payload, mirror_public)
            print(json.dumps(plan_payload, ensure_ascii=False, indent=2), flush=True)
            return
        etfs = planned_etfs
        write_payload("backfill/incremental_latest.json", incremental_summary, mirror_public)
        print(
            "[incremental-etf-backfill] "
            f"selected={incremental_summary['counts']['selected']} "
            f"candidates={incremental_summary['counts']['candidates']} "
            f"missing={incremental_summary['counts']['missing']} "
            f"fallback_retry={incremental_summary['counts']['fallback_retry']} "
            f"history_gap={incremental_summary['counts']['history_gap']} "
            f"stale={incremental_summary['counts']['stale']} "
            f"cooldown_skipped={incremental_summary['counts']['cooldown_skipped']}",
            flush=True,
        )
    stocks = parse_symbols(args.stocks)
    if args.fetch_financials and not stocks:
        stocks = DEFAULT_STOCKS[:]

    results = []
    stop_reason = None
    for kind, symbols in (("etf", etfs), ("stock", stocks)):
        for idx, ticker in enumerate(symbols, 1):
            result = run_one(
                kind,
                ticker,
                args.timeout,
                mirror_public,
                include_financials=(kind == "stock" and args.fetch_financials),
                yf_fallback=(
                    kind == "etf"
                    and args.yf_etf_fallback
                    and not args.reconcile_missing_etf_details
                ),
                include_etf_history=not args.reconcile_missing_etf_details,
            )
            results.append(result)
            status = "OK" if result["error"] is None else f"FAIL {result['error'][:80]}"
            if result["error"] is None and result.get("provider") == "yahoo_finance":
                status = "YF_FALLBACK"
            if result.get("provider_availability_status") == "absent":
                status = (
                    "PROVIDER_GAP "
                    f"reason={result.get('provider_availability_reason')} "
                    f"response={result.get('provider_response')}"
                )
            print(f"[{kind} {idx}/{len(symbols)}] {ticker} {status} {result['latency_ms']}ms", flush=True)
            if args.stop_on_hard_error and is_hard_error(result["error"]):
                stop_reason = {
                    "ticker": ticker,
                    "asset_type": kind,
                    "error": result["error"],
                    "message": "stopped on non-404 fetch error",
                }
                break
            time.sleep(args.sleep)
        if stop_reason:
            break

    pending_ledger_summary = None
    if incremental_summary is not None or args.reconcile_missing_etf_details:
        ledger_selected_rows = (
            [
                *(incremental_summary.get("selected") or []),
                *({"ticker": ticker} for ticker in etfs),
            ]
            if incremental_summary is not None
            else [{"ticker": ticker, "reason": "missing"} for ticker in reconcile_selected]
        )
        pending_ledger_summary = update_pending_ledger(
            results=results,
            selected_rows=ledger_selected_rows,
            cooldown_days=args.incremental_etf_cooldown_days,
            failure_threshold=args.incremental_etf_cooldown_failures,
            mirror_public=mirror_public,
        )
        if incremental_summary is not None:
            incremental_summary["pending_ledger"] = {
                "path": PENDING_LEDGER_REL_PATH,
                "generated_at": pending_ledger_summary.get("generated_at"),
                "counts": pending_ledger_summary.get("counts"),
            }
            incremental_summary["counts"]["ledger_tracked"] = (pending_ledger_summary.get("counts") or {}).get("tracked", 0)
            incremental_summary["counts"]["ledger_cooldown"] = (pending_ledger_summary.get("counts") or {}).get("cooldown", 0)
            write_payload("backfill/incremental_latest.json", incremental_summary, mirror_public)

    etf_detail_coverage = write_etf_detail_coverage(mirror_public)
    etf_detail_coverage_counts = etf_detail_coverage.get("counts") or {}
    missing_detail_reconcile = None
    if args.reconcile_missing_etf_details:
        missing_detail_reconcile = build_missing_detail_reconcile_summary(
            reconcile_initial_missing,
            reconcile_selected,
            results,
            etf_detail_coverage,
        )
        write_payload(MISSING_DETAIL_RECONCILE_REL_PATH, missing_detail_reconcile, mirror_public)
        reconcile_counts = missing_detail_reconcile["counts"]
        print(
            "[missing-detail-reconcile] "
            f"fetchable_fetched={reconcile_counts['fetchable_fetched']} "
            f"provider_absent={reconcile_counts['provider_absent']} "
            f"unresolved={reconcile_counts['unresolved']} "
            f"remaining_missing={reconcile_counts['remaining_missing']}",
            flush=True,
        )
    current_surface_stamps = (
        surface_summary.get("source_as_of")
        if isinstance(surface_summary, dict) and isinstance(surface_summary.get("source_as_of"), dict)
        else {}
    )
    universe_stamp = (
        collection_date(universe_payload.get("source_as_of"))
        if isinstance(universe_payload, dict)
        else None
    )
    source_as_of = {
        "surfaces": {
            domain: collection_date(current_surface_stamps.get(domain))
            for domain in SURFACE_STAMP_ROUTES
        },
        "etf_universe": universe_stamp,
    }
    source_as_of_reason = {
        "surfaces": {
            domain: None if stamp else "no provider-backed aggregate source date was produced in this run"
            for domain, stamp in source_as_of["surfaces"].items()
        },
        "etf_universe": (
            None
            if universe_stamp
            else "provider publishes no aggregate source date or the universe was not fetched in this run"
        ),
    }
    summary = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "generated_at": now_iso(),
        "source_as_of": source_as_of,
        "source_as_of_reason": source_as_of_reason,
        "counts": {
            "etf_universe": etf_universe_record_count(universe_payload),
            "etf_candidate_total": etf_detail_coverage_counts.get("candidate_total", 0),
            "etf_detail_files": etf_detail_coverage_counts.get("detail_files", 0),
            "etf_detail_covered": etf_detail_coverage_counts.get("covered_detail_files", 0),
            "etf_detail_missing": etf_detail_coverage_counts.get("missing_detail_files", 0),
            "etf_detail_coverage_pct": etf_detail_coverage_counts.get("coverage_pct", 0),
            "etf_detail_primary_pct": etf_detail_coverage_counts.get("primary_stockanalysis_pct", 0),
            "etfs_requested": len(etfs),
            "stocks_requested": len(stocks),
            "surfaces_requested": (surface_summary or {}).get("counts", {}).get("surfaces_requested", 0),
            "surfaces_ok": (surface_summary or {}).get("counts", {}).get("ok", 0),
            "surfaces_failed": (surface_summary or {}).get("counts", {}).get("failed", 0),
            "financials_requested": len(stocks) if args.fetch_financials else 0,
            "financials_ok": sum(1 for item in results if item.get("asset_type") == "stock" and item.get("financials_path") and item["error"] is None),
            "financials_failed": (
                (len(stocks) if args.fetch_financials else 0)
                - sum(1 for item in results if item.get("asset_type") == "stock" and item.get("financials_path") and item["error"] is None)
            ),
            "ok": sum(1 for item in results if item["error"] is None),
            "failed": sum(1 for item in results if item["error"] is not None),
            "hard_failed": sum(1 for item in results if is_hard_error(item["error"])),
            "etfs_stockanalysis_ok": sum(1 for item in results if item.get("asset_type") == "etf" and item.get("provider") == "stockanalysis" and item["error"] is None),
            "etfs_yahoo_fallback_ok": sum(1 for item in results if item.get("asset_type") == "etf" and item.get("provider") == "yahoo_finance" and item["error"] is None),
            "etfs_provider_available": sum(1 for item in results if item.get("asset_type") == "etf" and item.get("provider_availability_status") == "available"),
            "etfs_provider_absent": sum(1 for item in results if item.get("asset_type") == "etf" and item.get("provider_availability_status") == "absent"),
            "etfs_still_pending": sum(1 for item in results if item.get("asset_type") == "etf" and item["error"] is not None and is_expected_missing_error(item["error"])),
            "incremental_etf_backfill_candidates": (incremental_summary or {}).get("counts", {}).get("candidates", 0),
            "incremental_etf_backfill_selected": (incremental_summary or {}).get("counts", {}).get("selected", 0),
            "incremental_etf_cooldown_skipped": (incremental_summary or {}).get("counts", {}).get("cooldown_skipped", 0),
            "incremental_etf_ledger_tracked": (incremental_summary or {}).get("counts", {}).get("ledger_tracked", 0),
            "incremental_etf_ledger_cooldown": (incremental_summary or {}).get("counts", {}).get("ledger_cooldown", 0),
        },
        "results": results,
        "etf_detail_coverage": {
            "path": "coverage/etf_detail.json",
            "generated_at": etf_detail_coverage.get("generated_at"),
            "status": etf_detail_coverage.get("status"),
            "counts": etf_detail_coverage_counts,
        },
        "surface_results": (surface_summary or {}).get("results"),
        "incremental_etf_backfill": incremental_summary,
        "pending_ledger": (
            {
                "path": PENDING_LEDGER_REL_PATH,
                "counts": pending_ledger_summary.get("counts"),
            }
            if pending_ledger_summary is not None
            else None
        ),
        "missing_detail_reconcile": (
            {
                "path": MISSING_DETAIL_RECONCILE_REL_PATH,
                "counts": missing_detail_reconcile.get("counts"),
            }
            if missing_detail_reconcile is not None
            else None
        ),
        "stop_reason": stop_reason,
    }
    if args.universe_backfill:
        limit_label = args.limit_etfs if args.limit_etfs else "all"
        index_path = f"backfill/index_offset_{args.offset}_limit_{limit_label}.json"
        write_payload(index_path, summary, mirror_public)
        write_payload("backfill/latest.json", summary, mirror_public)
    else:
        write_payload("index.json", summary, mirror_public)
    if classify_catalogs_requested:
        classification_summary = classify_existing_etf_catalogs(mirror_public)
        print(f"[classify-etf-catalogs] catalogs={len(classification_summary['results'])}", flush=True)
    if stop_reason:
        raise SystemExit(2)
    if (
        missing_detail_reconcile is not None
        and missing_detail_reconcile["counts"]["unresolved"] > 0
    ):
        raise SystemExit(2)
    if args.fail_on_error and summary["counts"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
