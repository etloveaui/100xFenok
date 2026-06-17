#!/usr/bin/env python3
"""
StockAnalysis source fetcher — REST JSON layer and public table surfaces.

The stock financial-statement pages use SvelteKit/devalue payloads and are
intentionally left for a later parser. This fetcher keeps the stable REST-shaped
endpoints first: ETF holdings/overview/history/quote and stock overview/history/quote.
It also captures high-value public HTML table surfaces such as new ETFs, IPOs,
corporate actions, market movers, industry maps, and ETF provider pages.

Output:
  data/stockanalysis/etfs/{TICKER}.json
  data/stockanalysis/stocks/{TICKER}.json
  data/stockanalysis/surfaces/{NAME}.json
  data/stockanalysis/index.json
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "stockanalysis"
PUBLIC_DIR = ROOT / "100xfenok-next" / "public" / "data" / "stockanalysis"
SCHEMA_VERSION = "stockanalysis/v1"
BASE_URL = "https://stockanalysis.com"
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
USER_AGENT = "Mozilla/5.0 feno-stockanalysis-fetcher/1.0"

DEFAULT_ETFS = [
    "SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "SMH", "SOXX",
    "SSO", "QLD", "DDM", "ROM", "UPRO", "TQQQ", "SOXL", "TNA",
    "USD", "UWM", "FNGU", "KORU", "UTSL", "DFEN", "FAS", "TMF",
    "NVDL", "NVDG", "PTIR", "PLTG", "AVGX", "AVGG", "TSLL",
    "ELIL", "CRWL", "ORCX", "MUU", "TSMG", "APPX", "MSTU",
    "OKLL", "CWVX", "BITU", "ETHT", "STRC", "SGOV", "BIL", "BILS",
]

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


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
        if not isinstance(index, int) or index < 0 or index >= len(data):
            return index
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


def fetch_json(rel_path: str, timeout: int) -> dict:
    url = f"{BASE_URL}{rel_path}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


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
        metadata = {
            key: value
            for key, value in decoded.items()
            if key not in {"data", "earnings"}
        }

    data_points = metadata.get("dataPoints")
    field_count = len(data_points) if isinstance(data_points, (list, dict)) else None
    day_count = len(metadata.get("days") or []) if isinstance(metadata.get("days"), list) else None
    week_count = len(metadata.get("weeks") or []) if isinstance(metadata.get("weeks"), list) else None

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
        "counts": {
            "records": len(records),
            "fields": field_count,
            "days": day_count,
            "weeks": week_count,
        },
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
    paths = {
        "holdings": f"/api/symbol/e/{ticker}/holdings",
        "overview": f"/api/symbol/e/{ticker}/overview",
        "history": f"/api/symbol/e/{ticker}/history?range=1Y&period=Monthly",
        "quote": f"/api/quotes/e/{ticker}",
    }
    raw = {name: pick_data(fetch_json(path, timeout)) for name, path in paths.items()}
    holdings_data = raw["holdings"] if isinstance(raw.get("holdings"), dict) else {}
    overview_data = raw["overview"] if isinstance(raw.get("overview"), dict) else {}
    holdings = holdings_data.get("holdings") or (overview_data.get("holdingsTable") or {}).get("holdings")
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "etf",
        "ticker": ticker,
        "fetched_at": now_iso(),
        "endpoints": paths,
        "normalized": {
            "holdings": normalize_holdings(holdings),
            "asset_allocation": holdings_data.get("asset_allocation"),
            "sectors": holdings_data.get("sectors"),
            "countries": holdings_data.get("countries"),
            "holding_count": holdings_data.get("count") or overview_data.get("holdings"),
            "holdings_updated": holdings_data.get("date") or (overview_data.get("holdingsTable") or {}).get("updated"),
            "overview": {
                key: overview_data.get(key)
                for key in (
                    "aum", "nav", "expenseRatio", "peRatio", "sharesOut",
                    "dividendYield", "beta", "inception", "provider_page",
                    "etf_website",
                )
                if overview_data.get(key) is not None
            },
            "quote": raw.get("quote"),
            "history": raw.get("history"),
        },
        "raw": raw,
    }


def fetch_stock(ticker: str, timeout: int) -> dict:
    paths = {
        "overview": f"/api/symbol/s/{ticker}/overview",
        "history": f"/api/symbol/s/{ticker}/history?range=1Y&period=Monthly",
        "quote": f"/api/quotes/s/{ticker}",
    }
    raw = {name: pick_data(fetch_json(path, timeout)) for name, path in paths.items()}
    overview = raw["overview"] if isinstance(raw.get("overview"), dict) else {}
    return {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "asset_type": "stock",
        "ticker": ticker,
        "fetched_at": now_iso(),
        "endpoints": paths,
        "normalized": {
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
        },
        "raw": raw,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_payload(rel_path: str, payload: dict, mirror_public: bool) -> None:
    write_json(OUT_DIR / rel_path, payload)
    if mirror_public:
        write_json(PUBLIC_DIR / rel_path, payload)


def run_one(kind: str, ticker: str, timeout: int, mirror_public: bool) -> dict:
    start = time.perf_counter()
    try:
        if kind == "etf":
            payload = fetch_etf(ticker, timeout)
            rel_path = f"etfs/{ticker}.json"
        else:
            payload = fetch_stock(ticker, timeout)
            rel_path = f"stocks/{ticker}.json"
        write_payload(rel_path, payload, mirror_public)
        return {
            "ticker": ticker,
            "asset_type": kind,
            "status": "ok",
            "path": rel_path,
            "latency_ms": round((time.perf_counter() - start) * 1000),
            "error": None,
        }
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {
            "ticker": ticker,
            "asset_type": kind,
            "status": "error",
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
    parser.add_argument("--discover-etf-universe", action="store_true", help="scrape /etf/ list pages into etf_universe.json")
    parser.add_argument("--universe-only", action="store_true", help="only refresh etf_universe.json; do not deep-fetch ETF payloads")
    parser.add_argument("--universe-backfill", action="store_true", help="deep-fetch ETFs from etf_universe.json instead of the focus ETF list")
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

    mirror_public = not args.no_public_mirror
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
        return

    explicit_etfs = parse_symbols(args.etfs)
    if args.universe_backfill:
        etfs = explicit_etfs or load_etf_universe_symbols()
        if not etfs and universe_payload:
            etfs = [row["ticker"] for row in universe_payload.get("records") or []]
        if not etfs:
            raise SystemExit("ETF universe is empty. Run --discover-etf-universe first.")
    else:
        etfs = explicit_etfs or DEFAULT_ETFS

    if args.offset:
        etfs = etfs[args.offset:]
    if args.limit_etfs:
        etfs = etfs[: args.limit_etfs]
    stocks = parse_symbols(args.stocks)

    results = []
    stop_reason = None
    for kind, symbols in (("etf", etfs), ("stock", stocks)):
        for idx, ticker in enumerate(symbols, 1):
            result = run_one(kind, ticker, args.timeout, mirror_public)
            results.append(result)
            status = "OK" if result["error"] is None else f"FAIL {result['error'][:80]}"
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

    summary = {
        "schema_version": SCHEMA_VERSION,
        "source": "stockanalysis",
        "generated_at": now_iso(),
        "counts": {
            "etf_universe": (universe_payload or {}).get("counts", {}).get("records"),
            "etfs_requested": len(etfs),
            "stocks_requested": len(stocks),
            "surfaces_requested": (surface_summary or {}).get("counts", {}).get("surfaces_requested", 0),
            "surfaces_ok": (surface_summary or {}).get("counts", {}).get("ok", 0),
            "surfaces_failed": (surface_summary or {}).get("counts", {}).get("failed", 0),
            "ok": sum(1 for item in results if item["error"] is None),
            "failed": sum(1 for item in results if item["error"] is not None),
            "hard_failed": sum(1 for item in results if is_hard_error(item["error"])),
        },
        "results": results,
        "surface_results": (surface_summary or {}).get("results"),
        "stop_reason": stop_reason,
    }
    if args.universe_backfill:
        limit_label = args.limit_etfs if args.limit_etfs else "all"
        index_path = f"backfill/index_offset_{args.offset}_limit_{limit_label}.json"
        write_payload(index_path, summary, mirror_public)
        write_payload("backfill/latest.json", summary, mirror_public)
    else:
        write_payload("index.json", summary, mirror_public)
    if stop_reason:
        raise SystemExit(2)
    if args.fail_on_error and summary["counts"]["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
