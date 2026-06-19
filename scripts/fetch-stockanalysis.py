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
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "stockanalysis"
PUBLIC_DIR = ROOT / "100xfenok-next" / "public" / "data" / "stockanalysis"
YF_OUT_DIR = ROOT / "data" / "yf" / "finance"
YF_PUBLIC_DIR = ROOT / "100xfenok-next" / "public" / "data" / "yf" / "finance"
SCHEMA_VERSION = "stockanalysis/v1"
BASE_URL = "https://stockanalysis.com"
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
USER_AGENT = "Mozilla/5.0 feno-stockanalysis-fetcher/1.0"
DEFAULT_INCREMENTAL_ETF_LIMIT = 120
DEFAULT_INCREMENTAL_ETF_MAX_AGE_HOURS = 720
DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS = 7
DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES = 3
PENDING_LEDGER_REL_PATH = "backfill/pending_ledger.json"
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
    return explicit_etfs or DEFAULT_ETFS[:]


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


def add_etf_classification(row: dict, detail_index: dict[str, dict] | None = None) -> dict:
    base_row = {key: value for key, value in row.items() if key not in ETF_DETAIL_ENRICHMENT_ROW_KEYS}
    ticker = row_ticker(base_row)
    payload = (detail_index or {}).get(ticker or "") or {}
    raw_overview = (payload.get("raw") or {}).get("overview") if isinstance(payload, dict) else {}
    overview = raw_overview if isinstance(raw_overview, dict) else {}
    normalized_overview = (payload.get("normalized") or {}).get("overview") if isinstance(payload, dict) else {}
    normalized_overview = normalized_overview if isinstance(normalized_overview, dict) else {}
    normalized_holdings = ((payload.get("normalized") or {}).get("holdings") or []) if isinstance(payload, dict) else []
    classification = classify_etf(base_row, overview=overview, holdings=normalized_holdings)

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

    if (
        classification["is_leveraged"]
        or classification["is_inverse"]
        or classification["is_single_stock"]
        or classification["leverage_factor"] is not None
        or classification["underlying"]
    ):
        enriched["classification"] = classification
    return enriched


def etf_classification_counts(records: list[dict]) -> dict:
    return {
        "leveraged": sum(1 for row in records if (row.get("classification") or {}).get("is_leveraged") or row.get("is_leveraged")),
        "inverse": sum(1 for row in records if (row.get("classification") or {}).get("is_inverse") or row.get("is_inverse")),
        "single_stock": sum(1 for row in records if (row.get("classification") or {}).get("is_single_stock") or row.get("is_single_stock")),
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

    summary = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "surface_index",
        "generated_at": now_iso(),
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
    records = []
    seen = set()
    pages = []
    warnings = []
    path = "/etf/"

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

    records.sort(key=lambda row: row["ticker"])
    records = enrich_etf_records(records)
    classification_counts = etf_classification_counts(records)
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "etf",
        "generated_at": now_iso(),
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


def fetch_etf(ticker: str, timeout: int) -> dict:
    history_paths, history_periods = fetch_history_periods("e", ticker, timeout)
    paths = {
        "holdings": f"/api/symbol/e/{ticker}/holdings",
        "overview": f"/api/symbol/e/{ticker}/overview",
        "quote": f"/api/quotes/e/{ticker}",
        "history_periods": history_paths,
    }
    raw = {
        name: pick_data(fetch_json(path, timeout))
        for name, path in paths.items()
        if isinstance(path, str)
    }
    raw["history"] = history_periods.get("monthly_1y")
    raw["history_periods"] = history_periods
    holdings_data = raw["holdings"] if isinstance(raw.get("holdings"), dict) else {}
    overview_data = raw["overview"] if isinstance(raw.get("overview"), dict) else {}
    holdings = holdings_data.get("holdings") or (overview_data.get("holdingsTable") or {}).get("holdings")
    normalized_holdings = normalize_holdings(holdings)
    classification = classify_etf(
        {"ticker": ticker},
        overview=overview_data,
        holdings=normalized_holdings,
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "etf",
        "ticker": ticker,
        "fetched_at": now_iso(),
        "endpoints": paths,
        "normalized": {
            "holdings": normalized_holdings,
            "asset_allocation": holdings_data.get("asset_allocation"),
            "sectors": holdings_data.get("sectors"),
            "countries": holdings_data.get("countries"),
            "holding_count": holdings_data.get("count") or overview_data.get("holdings"),
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

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "fetched_at": now_iso(),
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
    return payload


def write_yf_payload(ticker: str, data: dict, mirror_public: bool, fetched_at: str | None = None) -> dict:
    payload = build_yf_payload(ticker, data, fetched_at)
    write_json(YF_OUT_DIR / f"{ticker}.json", payload)
    if mirror_public:
        write_json(YF_PUBLIC_DIR / f"{ticker}.json", payload)
    return payload


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
    if not isinstance(entry, dict) or cooldown_days <= 0 or failure_threshold <= 0:
        return False
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
    }


def classify_missing_detail_failure(entry: dict | None) -> str:
    if not isinstance(entry, dict):
        return "untracked"
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
    if pending_entry_in_cooldown(entry, now_dt, cooldown_days, failure_threshold):
        return "retry_cooldown"
    return "retry_pending"


def increment_count(payload: dict, key: str) -> None:
    payload[key] = (payload.get(key) or 0) + 1


def update_pending_ledger(
    results: list[dict],
    selected_rows: list[dict],
    cooldown_days: float,
    failure_threshold: int,
    mirror_public: bool,
) -> dict:
    now_dt = datetime.now(timezone.utc)
    selected = {
        clean_symbol(str(row.get("ticker") or ""))
        for row in selected_rows
        if isinstance(row, dict)
    }
    selected.discard(None)
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
        if error is None:
            if ticker in entries:
                entries.pop(ticker, None)
                cleared.append(ticker)
            continue
        if not is_expected_missing_error(error):
            continue

        existing = entries.get(ticker) if isinstance(entries.get(ticker), dict) else {}
        failures = (parse_int(existing.get("consecutive_failures")) or 0) + 1
        next_attempt = None
        if failures >= failure_threshold and cooldown_days > 0:
            next_attempt = utc_iso(now_dt + timedelta(days=cooldown_days))
        entries[ticker] = {
            "ticker": ticker,
            "last_attempt_utc": utc_iso(now_dt),
            "failure_reason": result.get("fallback_error") or error,
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
            "rule": "skip ETF detail candidates after consecutive expected-missing failures until next_attempt_after_utc",
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


def etf_detail_backfill_reason(ticker: str, max_age_hours: float) -> tuple[str | None, float | None]:
    payload = read_json(OUT_DIR / "etfs" / f"{ticker}.json")
    if payload is None:
        return "missing", None
    source = payload.get("source")
    detail_status = payload.get("detail_status")
    source_provider = payload.get("source_provider")
    if source != "stockanalysis" or source_provider == "yahoo_finance" or detail_status == "yf_fallback":
        return "fallback_retry", payload_age_hours(payload)
    age_hours = payload_age_hours(payload)
    if max_age_hours > 0 and (age_hours is None or age_hours >= max_age_hours):
        return "stale", age_hours
    return None, age_hours


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
    missing_samples_by_status: dict[str, list[str]] = {}
    missing_samples_by_failure: dict[str, list[str]] = {}
    for ticker in missing:
        pending_entry = pending_entries.get(ticker)
        status_key = classify_missing_detail_status(
            pending_entry,
            now_dt,
            DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS,
            DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES,
        )
        failure_key = classify_missing_detail_failure(pending_entry)
        increment_count(missing_status_breakdown, status_key)
        increment_count(missing_failure_breakdown, failure_key)
        missing_samples_by_status.setdefault(status_key, [])
        missing_samples_by_failure.setdefault(failure_key, [])
        if len(missing_samples_by_status[status_key]) < 12:
            missing_samples_by_status[status_key].append(ticker)
        if len(missing_samples_by_failure[failure_key]) < 12:
            missing_samples_by_failure[failure_key].append(ticker)
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
            "pending_tracked": pending_counts.get("tracked", 0),
            "pending_cooldown": pending_counts.get("cooldown", 0),
            "pending_tracked_missing": sum(1 for ticker in missing if ticker in pending_entries),
        },
        "missing_reason_summary": dict(sorted(missing_failure_breakdown.items())),
        "missing_status_summary": dict(sorted(missing_status_breakdown.items())),
        "missing_reason_samples": {
            key: value
            for key, value in sorted(missing_samples_by_failure.items())
        },
        "missing_status_samples": {
            key: value
            for key, value in sorted(missing_samples_by_status.items())
        },
        "missing_tickers": missing,
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
    exclude: set[str] | None = None,
    pending_ledger: dict | None = None,
    cooldown_days: float = DEFAULT_INCREMENTAL_ETF_COOLDOWN_DAYS,
    cooldown_failure_threshold: int = DEFAULT_INCREMENTAL_ETF_COOLDOWN_FAILURES,
    now_dt: datetime | None = None,
) -> dict:
    exclude = exclude or set()
    now_dt = now_dt or datetime.now(timezone.utc)
    pending_ledger = pending_ledger if isinstance(pending_ledger, dict) else load_pending_ledger()
    pending_entries = pending_ledger.get("entries") if isinstance(pending_ledger.get("entries"), dict) else {}
    sources = [
        ("new_etfs", load_surface_symbols("new_etfs")),
        ("etf_universe", [row.get("ticker") for row in (universe_payload or {}).get("records") or []] or load_etf_universe_symbols()),
        ("etf_screener", load_surface_symbols("etf_screener")),
    ]
    candidates = []
    cooldown_rows = []
    seen = set()
    source_priority = {"new_etfs": 0, "etf_universe": 1, "etf_screener": 2}
    reason_priority = {"missing": 0, "invalid": 0, "fallback_retry": 1, "stale": 2}

    for source_name, symbols in sources:
        for ticker in unique_symbols(symbols):
            if ticker in seen or ticker in exclude:
                continue
            pending_entry = pending_entries.get(ticker)
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
            reason, age_hours = etf_detail_backfill_reason(ticker, max_age_hours)
            if reason is None:
                continue
            prior_failures = parse_int((pending_entry or {}).get("consecutive_failures")) or 0
            seen.add(ticker)
            candidates.append(
                {
                    "ticker": ticker,
                    "source": source_name,
                    "reason": reason,
                    "age_hours": round(age_hours, 2) if age_hours is not None else None,
                    "prior_failures": prior_failures,
                    "priority": source_priority.get(source_name, 99),
                    "reason_priority": reason_priority.get(reason, 99),
                }
            )

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
            "selection": "never-fetched missing ETF details first, lower prior failures before retries, then Yahoo fallback retries, then stale records; new_etfs are prioritized within each reason/failure bucket, then etf_universe, then etf_screener-only rows",
        },
        "counts": {
            "candidates": len(candidates),
            "selected": len(selected),
            "missing": sum(1 for row in candidates if row["reason"] == "missing"),
            "fallback_retry": sum(1 for row in candidates if row["reason"] == "fallback_retry"),
            "stale": sum(1 for row in candidates if row["reason"] == "stale"),
            "cooldown_skipped": len(cooldown_rows),
            "prior_failed_candidates": sum(1 for row in candidates if row.get("prior_failures", 0) > 0),
        },
        "selected": selected,
        "cooldown": cooldown_rows,
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
    info = data.get("info") or {}
    fast_info = data.get("fast_info") or {}
    funds_data = data.get("funds_data") or {}
    history_1y = data.get("history_1y")
    fund_overview = funds_data.get("fund_overview") if isinstance(funds_data, dict) else {}
    description = funds_data.get("description") if isinstance(funds_data, dict) else None
    quote_type = str(info.get("quoteType") or funds_data.get("quote_type") or "").upper()
    if quote_type and quote_type not in {"ETF", "MUTUALFUND"}:
        raise ValueError(f"Yahoo fallback quoteType is not ETF/MUTUALFUND: {quote_type}")

    price = first_number(info.get("currentPrice"), fast_info.get("last_price"), fast_info.get("lastPrice"))
    previous_close = first_number(info.get("previousClose"), fast_info.get("previous_close"), fast_info.get("previousClose"))
    change = None if price is None or previous_close is None else price - previous_close
    change_pct = None if change is None or previous_close in (None, 0) else (change / previous_close) * 100
    holdings = normalize_yahoo_holdings(funds_data.get("top_holdings") if isinstance(funds_data, dict) else None)
    overview = {
        "aum": first_number(info.get("totalAssets"), info.get("netAssets")),
        "nav": first_number(info.get("navPrice")),
        "expenseRatio": first_number(info.get("netExpenseRatio"), info.get("annualReportExpenseRatio")),
        "dividendYield": first_number(info.get("dividendYield"), info.get("yield")),
        "beta": first_number(info.get("beta3Year"), info.get("beta")),
        "provider_page": info.get("fundFamily") or (fund_overview or {}).get("family"),
        "category": info.get("category") or (fund_overview or {}).get("categoryName"),
        "legalType": info.get("legalType") or (fund_overview or {}).get("legalType"),
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

    return {
        "schema_version": SCHEMA_VERSION,
        "source": "yahoo_finance",
        "source_provider": "yahoo_finance",
        "detail_status": "yf_fallback",
        "asset_type": "etf",
        "ticker": ticker,
        "fetched_at": yf_payload.get("fetched_at") or now_iso(),
        "role": "ETF detail fallback while StockAnalysis ETF REST endpoints are not indexed yet",
        "normalized": {
            "holdings": holdings,
            "asset_allocation": funds_data.get("asset_classes") if isinstance(funds_data, dict) else None,
            "sectors": funds_data.get("sector_weightings") if isinstance(funds_data, dict) else None,
            "countries": None,
            "holding_count": len(holdings) if holdings else None,
            "holdings_updated": yf_payload.get("fetched_at"),
            "classification": classification,
            "overview": overview,
            "quote": {
                key: value
                for key, value in {
                    "p": price,
                    "pd": previous_close,
                    "c": change,
                    "cp": change_pct,
                    "u": yf_payload.get("fetched_at"),
                    "ex": "yahoo_finance",
                }.items()
                if value is not None
            },
            "history": history_1y,
            "history_periods": {
                "daily_1y": history_1y if isinstance(history_1y, list) else [],
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
    etf_payload = yahoo_etf_payload(ticker, yf_payload)
    write_yf_payload(ticker, data, mirror_public, fetched_at)
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


def run_one(
    kind: str,
    ticker: str,
    timeout: int,
    mirror_public: bool,
    include_financials: bool = False,
    yf_fallback: bool = False,
) -> dict:
    start = time.perf_counter()
    try:
        if kind == "etf":
            try:
                payload = fetch_etf(ticker, timeout)
                provider = "stockanalysis"
                stockanalysis_error = None
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as exc:
                stockanalysis_error = f"{type(exc).__name__}: {exc}"
                if not (yf_fallback and is_expected_missing_error(stockanalysis_error)):
                    raise
                try:
                    payload = fetch_yahoo_etf_fallback(ticker, mirror_public)
                except Exception as fallback_exc:
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
            financials = None
            financials_rel_path = None
        else:
            financials = fetch_financials(ticker, timeout) if include_financials else None
            financials_rel_path = f"financials/{ticker}.json" if financials is not None else None
            payload = fetch_stock(ticker, timeout, financials)
            rel_path = f"stocks/{ticker}.json"
            provider = "stockanalysis"
            stockanalysis_error = None
        write_payload(rel_path, payload, mirror_public)
        if financials is not None and financials_rel_path is not None:
            write_payload(financials_rel_path, financials, mirror_public)
        return {
            "ticker": ticker,
            "asset_type": kind,
            "status": "ok" if provider == "stockanalysis" else "fallback_ok",
            "provider": provider,
            "path": rel_path,
            "financials_path": financials_rel_path,
            "latency_ms": round((time.perf_counter() - start) * 1000),
            "stockanalysis_error": stockanalysis_error,
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
    """StockAnalysis has universe rows whose holdings endpoint returns a stable 404."""
    return bool(error and "HTTP Error 404" in error)


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
    parser.add_argument("--incremental-etf-only", action="store_true", help="with --incremental-etf-backfill, skip the default focus ETF refresh and fetch only explicit --etfs plus selected incremental candidates")
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
    parser.add_argument("--no-public-mirror", action="store_true")
    parser.add_argument("--fail-on-error", action="store_true", help="exit non-zero when any ticker fails")
    parser.add_argument("--stop-on-hard-error", action="store_true", help="stop chunk on non-404 fetch errors")
    args = parser.parse_args()

    if args.incremental_etf_only and not args.incremental_etf_backfill:
        raise SystemExit("--incremental-etf-only requires --incremental-etf-backfill")

    mirror_public = not args.no_public_mirror
    classify_catalogs_requested = args.classify_etf_catalogs
    no_other_work = not any(
        (
            args.discover_etf_universe,
            args.fetch_surfaces,
            args.universe_backfill,
            args.incremental_etf_backfill,
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
            exclude=set(etfs),
            cooldown_days=args.incremental_etf_cooldown_days,
            cooldown_failure_threshold=args.incremental_etf_cooldown_failures,
        )
        incremental_etfs = [row["ticker"] for row in incremental_summary["selected"]]
        etfs = unique_symbols(etfs + incremental_etfs)
        write_payload("backfill/incremental_latest.json", incremental_summary, mirror_public)
        print(
            "[incremental-etf-backfill] "
            f"selected={incremental_summary['counts']['selected']} "
            f"candidates={incremental_summary['counts']['candidates']} "
            f"missing={incremental_summary['counts']['missing']} "
            f"fallback_retry={incremental_summary['counts']['fallback_retry']} "
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
                yf_fallback=(kind == "etf" and args.yf_etf_fallback),
            )
            results.append(result)
            status = "OK" if result["error"] is None else f"FAIL {result['error'][:80]}"
            if result["error"] is None and result.get("provider") == "yahoo_finance":
                status = "YF_FALLBACK"
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
    if incremental_summary is not None:
        pending_ledger_summary = update_pending_ledger(
            results=results,
            selected_rows=incremental_summary.get("selected") or [],
            cooldown_days=args.incremental_etf_cooldown_days,
            failure_threshold=args.incremental_etf_cooldown_failures,
            mirror_public=mirror_public,
        )
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
    summary = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "generated_at": now_iso(),
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
    if args.fail_on_error and summary["counts"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
