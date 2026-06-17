#!/usr/bin/env python3
"""Read-only audit for StockAnalysis/Yahoo/SlickCharts market data integration."""

from __future__ import annotations

import json
import re
import argparse
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
NEXT_PUBLIC_DATA = ROOT / "100xfenok-next" / "public" / "data"
CHUNK_RE = re.compile(r"^index_offset_(\d+)_limit_(\d+)\.json$")


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def pct(part: int, whole: int) -> str:
    if whole <= 0:
        return "0.0%"
    return f"{(part / whole) * 100:.1f}%"


def is_expected_missing_error(error: object) -> bool:
    return isinstance(error, str) and "HTTPError: HTTP Error 404" in error


def is_hard_error(error: object) -> bool:
    return isinstance(error, str) and error.strip() and not is_expected_missing_error(error)


def expected_backfill_chunks(universe_count: int) -> list[dict[str, int]]:
    if universe_count <= 0:
        return []
    chunks = [{"offset": 0, "limit": min(100, universe_count)}]
    offset = 100
    while offset < universe_count:
        chunks.append({"offset": offset, "limit": min(500, universe_count - offset)})
        offset += 500
    return chunks


def build_payload() -> dict:
    universe = load_json(DATA / "stockanalysis" / "etf_universe.json") or {}
    universe_count = int(((universe.get("counts") or {}).get("records") or len(universe.get("records") or [])) or 0)
    etf_files = sorted((DATA / "stockanalysis" / "etfs").glob("*.json"))
    stock_files = sorted((DATA / "stockanalysis" / "stocks").glob("*.json"))

    backfill_dir = DATA / "stockanalysis" / "backfill"
    backfill_files = sorted(backfill_dir.glob("index_offset_*_limit_*.json"))
    expected_chunks = expected_backfill_chunks(universe_count)
    expected_limits = {row["offset"]: row["limit"] for row in expected_chunks}
    results = []
    chunk_summaries = []
    ignored_chunk_summaries = []
    for path in backfill_files:
        payload = load_json(path) or {}
        rows = []
        for row in payload.get("results") or []:
            if isinstance(row, dict):
                rows.append(row)
        counts = payload.get("counts") or {}
        match = CHUNK_RE.match(path.name)
        offset = int(match.group(1)) if match else None
        limit = int(match.group(2)) if match else None
        hard_failed = counts.get("hard_failed")
        if hard_failed is None:
            hard_failed = sum(1 for row in rows if is_hard_error(row.get("error")))
        chunk_summary = {
            "file": path.name,
            "offset": offset,
            "limit": limit,
            "rows": len(rows),
            "ok": int(counts.get("ok") or 0),
            "error": int(counts.get("failed") or 0),
            "hard_failed": int(hard_failed or 0),
            "stop_reason": payload.get("stop_reason"),
        }
        if offset in expected_limits and limit == expected_limits[offset]:
            results.extend(rows)
            chunk_summaries.append(chunk_summary)
        else:
            ignored_chunk_summaries.append(chunk_summary)
    chunk_summaries.sort(key=lambda row: (row["offset"] is None, row["offset"] or 0))
    ignored_chunk_summaries.sort(key=lambda row: (row["offset"] is None, row["offset"] or 0, row["limit"] or 0))

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
    hard_error_count = sum(1 for row in results if is_hard_error(row.get("error")))
    only_expected_404_errors = hard_error_count == 0 and all(kind == "http_404" for kind in error_kinds)
    completed_offsets = {
        row["offset"]
        for row in chunk_summaries
        if isinstance(row.get("offset"), int)
    }
    missing_offsets = [
        row["offset"]
        for row in expected_chunks
        if row["offset"] not in completed_offsets
    ]
    next_expected_offset = missing_offsets[0] if missing_offsets else None

    market_index = load_json(DATA / "computed" / "market_facts" / "index.json") or {}
    market_rows = market_index.get("rows") or []
    market_coverage = market_index.get("coverage") or {}
    source_parity = load_json(DATA / "computed" / "market_source_parity.json") or {}
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

    return {
        "stockanalysis": {
            "universe_records": universe_count,
            "etf_detail_files": len(etf_files),
            "stock_detail_files": len(stock_files),
            "etf_backfill_progress": pct(len(etf_files), universe_count),
        },
        "backfill": {
            "raw_chunk_files": len(backfill_files),
            "chunk_files": len(chunk_summaries),
            "expected_chunk_files": len(expected_chunks),
            "rows_seen": len(results),
            "status_counts": dict(status_counts),
            "error_kinds": dict(error_kinds),
            "hard_error_count": hard_error_count,
            "only_expected_404_errors": only_expected_404_errors,
            "completed_offsets": sorted(completed_offsets),
            "missing_offsets": missing_offsets,
            "next_expected_offset": next_expected_offset,
            "ready_for_finalize": next_expected_offset is None and only_expected_404_errors,
            "detail_minus_backfill_ok": len(etf_files) - int(status_counts.get("ok") or 0),
            "chunks": chunk_summaries,
            "ignored_chunks": ignored_chunk_summaries,
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
        "market_source_parity": {
            "generated_at": source_parity.get("generated_at"),
            "summary": source_parity.get("summary"),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit market data integration state.")
    parser.add_argument(
        "--output",
        help="Optional JSON output path. Relative paths are resolved from repo root.",
    )
    parser.add_argument(
        "--mirror-public",
        action="store_true",
        help="Also mirror --output under 100xfenok-next/public/data/ when output is inside data/.",
    )
    return parser.parse_args()


def resolve_output_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return ROOT / path


def write_payload(payload: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    payload = build_payload()
    if args.output:
        output_path = resolve_output_path(args.output)
        write_payload(payload, output_path)
        if args.mirror_public:
            try:
                relative = output_path.resolve().relative_to(DATA.resolve())
            except ValueError as exc:
                raise SystemExit("--mirror-public requires --output to be inside data/") from exc
            write_payload(payload, NEXT_PUBLIC_DATA / relative)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
