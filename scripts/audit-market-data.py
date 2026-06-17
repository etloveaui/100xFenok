#!/usr/bin/env python3
"""Read-only audit for StockAnalysis/Yahoo/SlickCharts market data integration."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def pct(part: int, whole: int) -> str:
    if whole <= 0:
        return "0.0%"
    return f"{(part / whole) * 100:.1f}%"


def main() -> None:
    universe = load_json(DATA / "stockanalysis" / "etf_universe.json") or {}
    universe_count = int(((universe.get("counts") or {}).get("records") or len(universe.get("records") or [])) or 0)
    etf_files = sorted((DATA / "stockanalysis" / "etfs").glob("*.json"))
    stock_files = sorted((DATA / "stockanalysis" / "stocks").glob("*.json"))

    backfill_dir = DATA / "stockanalysis" / "backfill"
    backfill_files = sorted(backfill_dir.glob("index_offset_*_limit_*.json"))
    results = []
    for path in backfill_files:
        payload = load_json(path) or {}
        for row in payload.get("results") or []:
            if isinstance(row, dict):
                results.append(row)

    status_counts = Counter(str(row.get("status") or "unknown") for row in results)
    error_kinds = Counter()
    for row in results:
        err = row.get("error")
        if isinstance(err, str) and err.strip():
            if "HTTPError: HTTP Error 404" in err:
                error_kinds["http_404"] += 1
            elif "HTTPError: HTTP Error 429" in err:
                error_kinds["http_429"] += 1
            elif "HTTPError: HTTP Error 403" in err:
                error_kinds["http_403"] += 1
            else:
                error_kinds[err.split(":", 1)[0]] += 1

    market_index = load_json(DATA / "computed" / "market_facts" / "index.json") or {}
    market_rows = market_index.get("rows") or []
    market_coverage = market_index.get("coverage") or {}
    candidate_fields = 0
    multi_candidate_fields = 0
    policy_mismatch_fields = 0
    percent_scale_warnings = 0
    ticker_files = sorted((DATA / "computed" / "market_facts" / "tickers").glob("*.json"))
    for path in ticker_files:
        payload = load_json(path) or {}
        facts = payload.get("facts") or {}
        if not isinstance(facts, dict):
            continue
        for field, fact in facts.items():
            if not isinstance(fact, dict):
                continue
            candidates = fact.get("candidates") or []
            if isinstance(candidates, list) and "candidates" in fact:
                candidate_fields += 1
                if len(candidates) > 1:
                    multi_candidate_fields += 1
            policy = fact.get("policy") or []
            if isinstance(policy, list) and isinstance(candidates, list):
                sources = {row.get("source") for row in candidates if isinstance(row, dict)}
                if any(source not in policy for source in sources):
                    policy_mismatch_fields += 1
            if field in {"dividend_yield", "expense_ratio", "change_pct"} and isinstance(candidates, list):
                values = [
                    abs(row.get("value"))
                    for row in candidates
                    if isinstance(row, dict) and isinstance(row.get("value"), (int, float)) and row.get("value") not in (0, None)
                ]
                if len(values) > 1 and max(values) / min(values) >= 50:
                    percent_scale_warnings += 1

    print(json.dumps({
        "stockanalysis": {
            "universe_records": universe_count,
            "etf_detail_files": len(etf_files),
            "stock_detail_files": len(stock_files),
            "etf_backfill_progress": pct(len(etf_files), universe_count),
        },
        "backfill": {
            "chunk_files": len(backfill_files),
            "rows_seen": len(results),
            "status_counts": dict(status_counts),
            "error_kinds": dict(error_kinds),
        },
        "market_facts": {
            "count": market_index.get("count") or len(market_rows),
            "coverage": market_coverage,
            "audited_ticker_files": len(ticker_files),
            "candidate_fields": candidate_fields,
            "multi_candidate_fields": multi_candidate_fields,
            "policy_mismatch_fields": policy_mismatch_fields,
            "percent_scale_warnings": percent_scale_warnings,
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
