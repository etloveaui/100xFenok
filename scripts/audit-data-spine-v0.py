#!/usr/bin/env python3
"""Build the read-only Data Spine v0 ratification audit."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
PARITY_BUILDER = ROOT / "scripts" / "build-market-source-parity.py"
FACTS_BUILDER = ROOT / "scripts" / "build-market-facts.py"
P1_AUDIT = ROOT / "scripts" / "audit-data-spine-p1.py"
PUBLIC_DATA = ROOT / "100xfenok-next" / "public" / "data"
METADATA_DIR = PUBLIC_DATA / "metadata"
REPORTS_INDEX = PUBLIC_DATA / "reports-index.json"

DIAGNOSES = ("agreement", "value_drift", "stale", "sign_divergence", "scale_mismatch")

V0_FIELD_POLICY: dict[str, dict[str, Any]] = {
    "price": {"metric": "relative_spread_pct", "tolerance": 0.5, "unit": "percent"},
    "previous_close": {"metric": "relative_spread_pct", "tolerance": 0.5, "unit": "percent"},
    "change": {"metric": "relative_spread_pct", "tolerance": 0.5, "unit": "percent"},
    "change_pct": {"metric": "absolute_spread", "tolerance": 0.5, "unit": "percentage_points"},
    "market_cap": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "total_assets": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "trailing_pe": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "forward_pe": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "dividend_yield": {"metric": "absolute_spread", "tolerance": 0.5, "unit": "percentage_points"},
    "beta": {"metric": "absolute_spread", "tolerance": 0.10, "unit": "absolute"},
    "expense_ratio": {"metric": "absolute_spread", "tolerance": 0.25, "unit": "percentage_points"},
    "return_1m": {"metric": "absolute_spread", "tolerance": 5.0, "unit": "percentage_points"},
    "return_3m": {"metric": "authority_only", "tolerance": None, "unit": "n/a"},
    "return_ytd": {"metric": "absolute_spread", "tolerance": 7.0, "unit": "percentage_points"},
    "return_1y": {"metric": "absolute_spread", "tolerance": 10.0, "unit": "percentage_points"},
    "return_3y_avg": {"metric": "absolute_spread", "tolerance": 5.0, "unit": "percentage_points"},
    "return_5y_avg": {"metric": "absolute_spread", "tolerance": 1.25, "unit": "percentage_points"},
    "return_10y_avg": {"metric": "absolute_spread", "tolerance": 1.0, "unit": "percentage_points"},
    "return_max_avg": {"metric": "absolute_spread", "tolerance": 5.0, "unit": "percentage_points"},
}

POLICY_RATIONALE = {
    "price": "no value_drift sample; keep strict quote guard",
    "previous_close": "rare but severe drift; fail all observed drift rows",
    "change": "no value_drift sample; sign divergence remains blocking",
    "change_pct": "no value_drift sample; sign divergence remains blocking",
    "market_cap": "no value_drift sample; stale cleanup dominates",
    "total_assets": "low sample; strict 5% keeps definition drift visible",
    "trailing_pe": "no value_drift sample; stale cleanup dominates",
    "forward_pe": "single severe sample; keep strict 5% guard",
    "dividend_yield": "low sample; 0.5pp passes small rounding drift and flags distribution-basis outliers",
    "beta": "no value_drift sample; keep 0.10 absolute guard",
    "expense_ratio": "all current rows agree; keep 25bp fee guard",
    "return_1m": "p90 is 4.12pp; rounded to 5pp",
    "return_3m": "authority-only: cross-source comparison is unreliable",
    "return_ytd": "p90 is 6.13pp; rounded to 7pp",
    "return_1y": "p90 is 8.90pp; rounded to 10pp",
    "return_3y_avg": "low sample and leveraged-ETF outliers; keep strict 5pp guard",
    "return_5y_avg": "p90 is 1.04pp; rounded to 1.25pp",
    "return_10y_avg": "p95 is 0.96pp; rounded to 1pp",
    "return_max_avg": "p90 is 4.19pp; rounded to 5pp",
}


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * (pct / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return ordered[int(k)]
    return ordered[lo] * (hi - k) + ordered[hi] * (k - lo)


def fmt_number(value: float | int | None, digits: int = 4) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def metric_value(field: str, values: list[float], parity) -> float | None:
    if len(values) < 2:
        return None
    policy = V0_FIELD_POLICY.get(field, {})
    metric = policy.get("metric")
    if metric == "absolute_spread" or metric == "authority_only":
        return max(values) - min(values)
    if metric == "relative_spread_pct":
        return parity.relative_spread_pct(values)
    return None


def sample_quality(value_drift_count: int) -> str:
    if value_drift_count == 0:
        return "no_value_drift_sample"
    if value_drift_count < 30:
        return "low_sample"
    return "measured"


def build_field_rows() -> list[dict[str, Any]]:
    parity = load_module(PARITY_BUILDER, "market_source_parity")
    facts_builder = load_module(FACTS_BUILDER, "market_facts")
    source_policy = facts_builder.FIELD_SOURCE_POLICY

    diagnosis_counts: dict[str, Counter[str]] = defaultdict(Counter)
    drift_metrics: dict[str, list[float]] = defaultdict(list)

    for path in sorted(parity.FACTS_DIR.glob("*.json")):
        payload = parity.load_json(path) or {}
        facts = payload.get("facts") or {}
        if not isinstance(facts, dict):
            continue
        for field, fact in facts.items():
            if not isinstance(fact, dict):
                continue
            candidates = fact.get("candidates") or []
            if not isinstance(candidates, list) or len(candidates) < 2:
                continue
            policy = fact.get("policy") or []
            diagnosis = parity.diagnose_divergence(field, candidates, policy)["diagnosis"]
            diagnosis_counts[field][diagnosis] += 1
            if diagnosis != "value_drift":
                continue
            values = [
                parity.numeric(candidate.get("value"))
                for candidate in candidates
                if isinstance(candidate, dict)
            ]
            numeric_values = [value for value in values if value is not None]
            metric = metric_value(field, numeric_values, parity)
            if metric is not None:
                drift_metrics[field].append(metric)

    rows = []
    fields = sorted(set(source_policy) | set(V0_FIELD_POLICY) | set(diagnosis_counts))
    for field in fields:
        counts = diagnosis_counts[field]
        metrics = drift_metrics[field]
        threshold = V0_FIELD_POLICY.get(field, {}).get("tolerance")
        inside = None
        outside = None
        inside_pct = None
        if threshold is not None and metrics:
            inside = sum(1 for value in metrics if value <= threshold)
            outside = len(metrics) - inside
            inside_pct = (inside / len(metrics)) * 100
        rows.append(
            {
                "field": field,
                "authority": (source_policy.get(field) or ["[not verified]"])[0],
                "fallback_chain": source_policy.get(field, []),
                "authority_ref": f"scripts/build-market-facts.py FIELD_SOURCE_POLICY[{field!r}]",
                "metric": V0_FIELD_POLICY.get(field, {}).get("metric", "[not verified]"),
                "tolerance": threshold,
                "unit": V0_FIELD_POLICY.get(field, {}).get("unit", "[not verified]"),
                "sample_quality": sample_quality(len(metrics)),
                "rationale": POLICY_RATIONALE.get(field, "[not verified]"),
                "diagnosis_counts": {key: counts[key] for key in DIAGNOSES},
                "value_drift_count": len(metrics),
                "p50": fmt_number(percentile(metrics, 50)),
                "p75": fmt_number(percentile(metrics, 75)),
                "p90": fmt_number(percentile(metrics, 90)),
                "p95": fmt_number(percentile(metrics, 95)),
                "p99": fmt_number(percentile(metrics, 99)),
                "max": fmt_number(max(metrics) if metrics else None),
                "inside_tolerance": inside,
                "outside_tolerance": outside,
                "inside_tolerance_pct": fmt_number(inside_pct, 2),
            }
        )
    return rows


def metadata_dates() -> list[str]:
    if not METADATA_DIR.exists():
        return []
    return sorted(path.stem for path in METADATA_DIR.glob("*.json"))


def latest_metadata_payload() -> dict[str, Any] | None:
    dates = metadata_dates()
    if not dates:
        return None
    return load_json(METADATA_DIR / f"{dates[-1]}.json")


def build_public_report_metadata_decision() -> dict[str, Any]:
    dates = metadata_dates()
    reports_index = load_json(REPORTS_INDEX) if REPORTS_INDEX.exists() else []
    latest = latest_metadata_payload() or {}
    return {
        "decision": "keep_intentional_placeholder",
        "owner": "future automated report-publishing pipeline",
        "metadata_file_count": len(dates),
        "reports_index_count": len(reports_index) if isinstance(reports_index, list) else None,
        "latest_metadata_id": dates[-1] if dates else None,
        "latest_metadata_title": latest.get("title"),
        "latest_metadata_summary": latest.get("summary"),
        "live_consumers": [
            "100x/100x-main.html:94-96",
            "100xfenok-next/public/100x/100x-main.html:94-96",
            "admin/design-lab/reports/v5-unified-premium.html:797-799",
            "100x/daily-wrap/daily-wrap-system/renderer.js:273-276",
            "100xfenok-next/src/generated/static-route-manifest.ts:21-32 via src/lib/server/data-loader.ts:4,151-175",
        ],
        "rationale": (
            "consumer guard found live report-browser readers, so data-only sunset would break pages; "
            "the user confirmed the stale/test placeholder is intentionally retained for a future "
            "fully automated report-publishing pipeline"
        ),
        "v0_action": "keep data in place; Track 1 data-only cleanup is permanently cancelled",
        "deferred_backlog": "revive publishing only after the future automation pipeline exists",
        "freshness_policy": "deferred until revival: root source + publisher + owner + Data Lab freshness check",
    }


def build_return_3m_decision(field_rows: list[dict[str, Any]]) -> dict[str, Any]:
    row = next((item for item in field_rows if item["field"] == "return_3m"), None)
    return {
        "decision": "authority_only_until_dedicated_fix",
        "authority": "yf.history_1y",
        "candidate_kept_as": "provenance/cross-check only; not confidence-gating",
        "diagnosis_counts": row["diagnosis_counts"] if row else {},
        "value_drift_count": row["value_drift_count"] if row else None,
        "p50_absolute_spread_pp": row["p50"] if row else None,
        "p90_absolute_spread_pp": row["p90"] if row else None,
        "rationale": (
            "return_3m has only 8 agreement rows versus 243 sign divergences and 88 scale mismatches; "
            "cross-source comparison is currently too noisy for UI confidence gating"
        ),
    }


def build_ticker_gateway_decision() -> dict[str, Any]:
    return {
        "decision": "sanctioned_live_gateway_exception",
        "id": "DS-P1-001",
        "path": "100xfenok-next/src/lib/server/ticker.ts",
        "authority": "Yahoo chart live quote, fallback ticker worker",
        "scope": "product-runtime live quote only",
        "rationale": (
            "scheduled DataPack is not a substitute for pre/regular/post-market quote freshness; "
            "this route is the only product-runtime live fetch in the P1 leak backlog"
        ),
        "contract_requirements": [
            "return source and fetchedAt to the caller",
            "keep no-store/short timeout behavior",
            "do not expand direct provider fetches outside this gateway",
            "migrate to a Data Spine live-quote service only when that service exists",
        ],
    }


def build_payload() -> dict[str, Any]:
    p1 = load_module(P1_AUDIT, "data_spine_p1")
    field_rows = build_field_rows()
    return {
        "schema_version": "data-spine-v0-ratification/v1",
        "generated_at": now_iso(),
        "status": "ratified",
        "field_rows": field_rows,
        "diagnosis_categories": list(DIAGNOSES),
        "return_3m_decision": build_return_3m_decision(field_rows),
        "public_report_metadata_decision": build_public_report_metadata_decision(),
        "ticker_gateway_decision": build_ticker_gateway_decision(),
        "direct_fetch_backlog": p1.build_direct_fetch_rows(),
    }


def print_markdown(payload: dict[str, Any]) -> None:
    print("# Data Spine v0 Ratification Audit")
    print()
    print(f"Generated: {payload['generated_at']}")
    print(f"Status: {payload['status']}")
    print()
    print("## Field Tolerance Matrix")
    print()
    print("| Field | Metric | Tol | VD in/out | p50/p90/p95 | Quality | Decision note |")
    print("|---|---|---:|---:|---|---|---|")
    for row in payload["field_rows"]:
        tolerance = "authority-only" if row["tolerance"] is None else row["tolerance"]
        in_out = "n/a"
        if row["inside_tolerance"] is not None:
            in_out = f"{row['inside_tolerance']}/{row['outside_tolerance']} ({row['inside_tolerance_pct']}%)"
        percentiles = f"{row['p50']}/{row['p90']}/{row['p95']}"
        print(
            f"| `{row['field']}` | {row['metric']} | {tolerance} | {in_out} | "
            f"{percentiles} | {row['sample_quality']} | {row['rationale']} |"
        )
    print()
    print("## Decisions")
    print()
    for key in ("return_3m_decision", "public_report_metadata_decision", "ticker_gateway_decision"):
        print(f"### {key}")
        for item_key, value in payload[key].items():
            print(f"- `{item_key}`: {value}")
        print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only Data Spine v0 ratification audit.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of Markdown.")
    return parser.parse_args()


def main() -> None:
    payload = build_payload()
    if parse_args().json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_markdown(payload)


if __name__ == "__main__":
    main()
