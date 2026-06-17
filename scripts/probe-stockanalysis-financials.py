#!/usr/bin/env python3
"""Probe StockAnalysis Svelte/devalue financial statement payloads."""

from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


BASE_URL = "https://stockanalysis.com"
USER_AGENT = "Mozilla/5.0 feno-stockanalysis-financials-probe/1.0"
STATEMENT_PATHS = {
    "income": "financials",
    "balance_sheet": "financials/balance-sheet",
    "cash_flow": "financials/cash-flow-statement",
    "ratios": "financials/ratios",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_json(url: str, timeout: int) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


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


def extract_node(payload: dict) -> dict:
    for node in reversed(payload.get("nodes") or []):
        data = node.get("data") if isinstance(node, dict) else None
        if isinstance(data, list) and data:
            decoded = decode_svelte_data(data)
            if isinstance(decoded, dict) and "financialData" in decoded:
                return decoded
    raise ValueError("financialData node not found")


def normalize_statement(ticker: str, statement: str, decoded: dict) -> dict:
    financial_data = decoded.get("financialData") or {}
    row_map = decoded.get("map") or []
    periods = financial_data.get("datekey") or []
    rows = []
    if isinstance(row_map, list):
        for meta in row_map:
            if not isinstance(meta, dict):
                continue
            field = meta.get("id")
            values = financial_data.get(field) if isinstance(financial_data, dict) else None
            if not field or not isinstance(values, list):
                continue
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
        "periods": periods,
        "fiscal_years": financial_data.get("fiscalYear") if isinstance(financial_data, dict) else None,
        "rows": rows,
        "field_count": len(rows),
    }


def fetch_statement(ticker: str, statement: str, period: str, timeout: int) -> dict:
    path = STATEMENT_PATHS[statement]
    suffix = "?p=quarterly" if period == "quarterly" else ""
    url = f"{BASE_URL}/stocks/{ticker.lower()}/{path}/__data.json{suffix}"
    payload = fetch_json(url, timeout)
    decoded = extract_node(payload)
    normalized = normalize_statement(ticker, statement, decoded)
    normalized["endpoint"] = url
    return normalized


def load_fixture_statement(ticker: str, statement: str, fixture: Path) -> dict:
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    decoded = extract_node(payload)
    normalized = normalize_statement(ticker, statement, decoded)
    normalized["fixture"] = str(fixture)
    return normalized


def build_summary(statements: dict[str, dict]) -> dict:
    return {
        key: {
            "statement": value.get("statement"),
            "period": value.get("period"),
            "field_count": value.get("field_count"),
            "period_count": len(value.get("periods") or []),
            "sample_fields": [row.get("field") for row in (value.get("rows") or [])[:8]],
        }
        for key, value in statements.items()
    }


def build_probe(ticker: str, period: str, timeout: int) -> dict:
    statements = {}
    for statement in STATEMENT_PATHS:
        statements[statement] = fetch_statement(ticker, statement, period, timeout)
    return {
        "schema_version": "stockanalysis-financials-probe/v1",
        "generated_at": now_iso(),
        "source": "stockanalysis financial __data.json",
        "ticker": ticker.upper(),
        "requested_period": period,
        "statements": statements,
        "summary": build_summary(statements),
    }


def build_fixture_probe(ticker: str, statement: str, fixture: Path) -> dict:
    normalized = load_fixture_statement(ticker, statement, fixture)
    statements = {statement: normalized}
    return {
        "schema_version": "stockanalysis-financials-probe/v1",
        "generated_at": now_iso(),
        "source": "stockanalysis financial __data.json fixture",
        "ticker": ticker.upper(),
        "requested_period": normalized.get("period"),
        "statements": statements,
        "summary": build_summary(statements),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Probe StockAnalysis financial statement payloads.")
    parser.add_argument("ticker", nargs="?", default="AAPL")
    parser.add_argument("--period", choices=["annual", "quarterly"], default="annual")
    parser.add_argument("--statement", choices=sorted(STATEMENT_PATHS), default="income", help="statement type for --fixture")
    parser.add_argument("--fixture", help="Read a saved __data.json fixture instead of calling StockAnalysis")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--output", help="Optional output JSON path for the full normalized probe.")
    parser.add_argument("--full", action="store_true", help="Print full normalized payload instead of summary.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.fixture:
        payload = build_fixture_probe(args.ticker, args.statement, Path(args.fixture).expanduser())
    else:
        payload = build_probe(args.ticker, args.period, args.timeout)
    if args.output:
        output = Path(args.output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload if args.full else payload["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
