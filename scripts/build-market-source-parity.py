#!/usr/bin/env python3
"""Build source parity diagnostics from computed market_facts candidates."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FACTS_DIR = DATA / "computed" / "market_facts" / "tickers"
DEFAULT_OUTPUT = DATA / "computed" / "market_source_parity.json"
NEXT_PUBLIC_DATA = ROOT / "100xfenok-next" / "public" / "data"
SCHEMA_VERSION = "market-source-parity/v1"
PERCENT_FIELDS = {"dividend_yield", "expense_ratio", "change_pct"}


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


def numeric(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def relative_spread_pct(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    lo = min(values)
    hi = max(values)
    base = max(abs(lo), abs(hi), 1e-12)
    return ((hi - lo) / base) * 100


def build_payload(limit: int) -> dict:
    field_counts: Counter[str] = Counter()
    selected_sources: Counter[str] = Counter()
    candidate_sources: Counter[str] = Counter()
    multi_candidate_counts: Counter[str] = Counter()
    percent_scale_warnings = []
    divergences = []
    inspected_files = 0

    for path in sorted(FACTS_DIR.glob("*.json")):
        payload = load_json(path) or {}
        ticker = payload.get("ticker") or path.stem
        facts = payload.get("facts") or {}
        if not isinstance(facts, dict):
            continue
        inspected_files += 1

        for field, fact in facts.items():
            if not isinstance(fact, dict):
                continue
            field_counts[field] += 1
            selected_source = fact.get("source")
            if selected_source:
                selected_sources[f"{field}:{selected_source}"] += 1
            candidates = fact.get("candidates") or []
            if not isinstance(candidates, list) or len(candidates) < 2:
                continue
            multi_candidate_counts[field] += 1
            values = []
            source_values = []
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                source = candidate.get("source") or "unknown"
                candidate_sources[f"{field}:{source}"] += 1
                value = numeric(candidate.get("value"))
                if value is None:
                    continue
                values.append(value)
                source_values.append({"source": source, "value": value})
            spread = relative_spread_pct(values)
            if spread is None:
                continue
            row = {
                "ticker": ticker,
                "asset_type": payload.get("asset_type"),
                "field": field,
                "selected_source": selected_source,
                "candidate_count": len(candidates),
                "relative_spread_pct": round(spread, 6),
                "values": source_values,
            }
            divergences.append(row)
            nonzero_abs_values = [abs(value) for value in values if value not in (0, None)]
            if field in PERCENT_FIELDS and len(nonzero_abs_values) > 1 and max(nonzero_abs_values) / min(nonzero_abs_values) >= 50:
                percent_scale_warnings.append(row)

    by_field = {}
    all_fields = sorted(set(field_counts) | set(multi_candidate_counts))
    for field in all_fields:
        selected = {
            key.split(":", 1)[1]: count
            for key, count in selected_sources.items()
            if key.startswith(f"{field}:")
        }
        candidates = {
            key.split(":", 1)[1]: count
            for key, count in candidate_sources.items()
            if key.startswith(f"{field}:")
        }
        by_field[field] = {
            "ticker_count": field_counts[field],
            "multi_candidate_count": multi_candidate_counts[field],
            "selected_sources": dict(sorted(selected.items())),
            "candidate_sources": dict(sorted(candidates.items())),
        }

    divergences.sort(key=lambda row: row["relative_spread_pct"], reverse=True)
    percent_scale_warnings.sort(key=lambda row: row["relative_spread_pct"], reverse=True)

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "source": "computed/market_facts candidate comparison",
        "summary": {
            "inspected_ticker_files": inspected_files,
            "fields": len(by_field),
            "multi_candidate_fields": sum(multi_candidate_counts.values()),
            "divergence_rows": len(divergences),
            "percent_scale_warnings": len(percent_scale_warnings),
        },
        "by_field": by_field,
        "top_divergences": divergences[:limit],
        "percent_scale_warnings": percent_scale_warnings[:limit],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build market source parity diagnostics.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path.")
    parser.add_argument("--limit", type=int, default=100, help="Max detailed rows per diagnostic list.")
    parser.add_argument("--no-public-mirror", action="store_true", help="Do not mirror data/ output to Next public data.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser()
    if not output.is_absolute():
        output = ROOT / output
    payload = build_payload(max(1, args.limit))
    write_json(output, payload)

    if not args.no_public_mirror:
        try:
            relative = output.resolve().relative_to(DATA.resolve())
        except ValueError:
            relative = None
        if relative is not None:
            write_json(NEXT_PUBLIC_DATA / relative, payload)

    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
