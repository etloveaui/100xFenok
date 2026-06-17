#!/usr/bin/env python3
"""
StockAnalysis source fetcher — REST JSON layer for ETF holdings and stock context.

The stock financial-statement pages use SvelteKit/devalue payloads and are
intentionally left for a later parser. This fetcher keeps the stable REST-shaped
endpoints first: ETF holdings/overview/history/quote and stock overview/history/quote.

Output:
  data/stockanalysis/etfs/{TICKER}.json
  data/stockanalysis/stocks/{TICKER}.json
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
            text = " ".join("".join(self._cell_text).split())
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


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
        if args.universe_only:
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
            "ok": sum(1 for item in results if item["error"] is None),
            "failed": sum(1 for item in results if item["error"] is not None),
            "hard_failed": sum(1 for item in results if is_hard_error(item["error"])),
        },
        "results": results,
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
