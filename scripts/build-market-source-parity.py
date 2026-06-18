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
STALE_AGE_DAYS = 3
SCALE_RATIO = 50
SPREAD_PCT_THRESHOLD = 5


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


def parse_ts(cand: dict) -> datetime | None:
    """Parse a candidate timestamp (fetched_at preferred, else as_of).

    Accepts ISO 8601 strings that may end with ``Z`` or ``+00:00``.
    Returns ``None`` when neither timestamp is present or parseable.
    """
    if not isinstance(cand, dict):
        return None
    for key in ("fetched_at", "as_of"):
        raw = cand.get(key)
        if not raw or not isinstance(raw, str):
            continue
        text = raw.strip()
        if not text:
            continue
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    return None


def diagnose_divergence(field: str, candidates: list, policy: list, now: datetime) -> dict:
    """Classify why a multi-candidate field diverges.

    Pure/importable. Separates UNIT mismatch (scale) from STALENESS so a
    stale low-magnitude candidate does not masquerade as a scale error.
    """
    policy = policy or []

    rows = []
    for cand in candidates or []:
        if not isinstance(cand, dict):
            continue
        value = numeric(cand.get("value"))
        if value is None:
            continue
        rows.append({
            "source": cand.get("source") or "unknown",
            "value": value,
            "ts": parse_ts(cand),
        })

    timestamps = [row["ts"] for row in rows if row["ts"] is not None]
    freshest = max(timestamps) if timestamps else None

    freshness = {}
    stale_sources = []
    fresh_rows = []
    for row in rows:
        ts = row["ts"]
        if ts is None or freshest is None:
            age_days = None
            is_stale = False  # unknown age => not judged stale
        else:
            age_days = (freshest - ts).total_seconds() / 86400.0
            is_stale = age_days > STALE_AGE_DAYS
        if age_days is not None:
            freshness[row["source"]] = round(age_days, 4)
        if is_stale:
            stale_sources.append(row["source"])
        else:
            fresh_rows.append(row)

    all_values = [row["value"] for row in rows]
    fresh_values = [row["value"] for row in fresh_rows]

    spread_pct = relative_spread_pct(all_values)
    fresh_spread_pct = relative_spread_pct(fresh_values)

    sign_divergence = len(all_values) >= 2 and (min(all_values) < 0 < max(all_values))

    # Scale (UNIT) check is time-independent but evaluated on FRESH candidates
    # only: a >=50 ratio that only appears once a STALE candidate is included
    # is staleness, not a scale mismatch.
    scale_mismatch = False
    scale_factor = None
    if field in PERCENT_FIELDS:
        fresh_nonzero_abs = [abs(v) for v in fresh_values if v not in (0, None)]
        if len(fresh_nonzero_abs) > 1:
            ratio = max(fresh_nonzero_abs) / min(fresh_nonzero_abs)
            if ratio >= SCALE_RATIO:
                scale_mismatch = True
                scale_factor = round(ratio)

    # When dropping stale candidates leaves fewer than two fresh values, there
    # is no remaining disagreement among fresh sources (fresh_spread_pct is
    # None) -> treat as below threshold.
    fresh_below_threshold = fresh_spread_pct is None or fresh_spread_pct < SPREAD_PCT_THRESHOLD

    if scale_mismatch:
        diagnosis = "scale_mismatch"
    elif stale_sources and fresh_below_threshold:
        diagnosis = "stale"
    elif sign_divergence:
        diagnosis = "sign_divergence"
    elif spread_pct is not None and spread_pct >= SPREAD_PCT_THRESHOLD:
        diagnosis = "value_drift"
    else:
        diagnosis = "agreement"

    return {
        "diagnosis": diagnosis,
        "spread_pct": round(spread_pct, 6) if spread_pct is not None else None,
        "fresh_spread_pct": round(fresh_spread_pct, 6) if fresh_spread_pct is not None else None,
        "stale_sources": stale_sources,
        "scale_mismatch": scale_mismatch,
        "scale_factor": scale_factor,
        "sign_divergence": sign_divergence,
        "selected_rationale": None,
        "freshness": freshness,
    }


def selected_rationale(selected, policy: list) -> dict:
    policy = policy or []
    if selected in policy:
        idx = policy.index(selected)
        note = "policy-preferred; lower-ranked sources retained as candidates"
    else:
        idx = None
        note = "selected outside policy order"
    return {
        "selected": selected,
        "policy_rank": idx,
        "policy_len": len(policy),
        "note": note,
    }


def build_payload(limit: int) -> dict:
    now = datetime.now(timezone.utc)
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
            policy = fact.get("policy") or []
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
            diagnosis = diagnose_divergence(field, candidates, policy, now)
            diagnosis["selected_rationale"] = selected_rationale(selected_source, policy)
            row = {
                "ticker": ticker,
                "asset_type": payload.get("asset_type"),
                "field": field,
                "selected_source": selected_source,
                "candidate_count": len(candidates),
                "relative_spread_pct": round(spread, 6),
                "values": source_values,
            }
            row.update(diagnosis)
            divergences.append(row)
            if diagnosis["diagnosis"] == "scale_mismatch":
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

    diagnosis_counts = Counter(row["diagnosis"] for row in divergences)
    stale_rows = [row for row in divergences if row["diagnosis"] == "stale"]
    scale_mismatch_rows = [row for row in divergences if row["diagnosis"] == "scale_mismatch"]
    sign_divergence_rows = [row for row in divergences if row["diagnosis"] == "sign_divergence"]

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
            "diagnosis_counts": dict(sorted(diagnosis_counts.items())),
            "stale_rows": len(stale_rows),
            "scale_mismatch_rows": len(scale_mismatch_rows),
            "sign_divergence_rows": len(sign_divergence_rows),
        },
        "by_field": by_field,
        "top_divergences": divergences[:limit],
        "percent_scale_warnings": percent_scale_warnings[:limit],
        "top_stale": stale_rows[:limit],
        "top_sign_divergences": sign_divergence_rows[:limit],
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
