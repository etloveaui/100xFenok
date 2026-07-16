#!/usr/bin/env python3
"""Build drift-checked StockAnalysis missing ETF detail selector plans.

This script imports the producer's local coverage builder, but never invokes the
producer main function, endpoint canary, workflow dispatch, or network fetches.
It writes only an explicitly requested plan artifact outside canonical data
trees.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCER_PATH = REPO_ROOT / "scripts" / "fetch-stockanalysis.py"
SOURCE_COVERAGE_PATH = REPO_ROOT / "data" / "stockanalysis" / "coverage" / "etf_detail.json"
PUBLIC_COVERAGE_PATH = (
    REPO_ROOT
    / "100xfenok-next"
    / "public"
    / "data"
    / "stockanalysis"
    / "coverage"
    / "etf_detail.json"
)
DEFAULT_SHARD_SIZE = 100
DEFAULT_MAX_DELTA_COUNT = 10
DEFAULT_MAX_DELTA_RATIO = 0.02


def load_producer_module():
    spec = importlib.util.spec_from_file_location("stockanalysis_fetcher_for_plan", PRODUCER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import producer: {PRODUCER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def normalized_tickers(values) -> list[str]:
    return sorted({str(value).strip().upper() for value in values if str(value).strip()})


def ticker_set_sha256(tickers: list[str]) -> str:
    canonical = "" if not tickers else "\n".join(tickers) + "\n"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def current_coverage() -> dict:
    producer = load_producer_module()
    recomputed = producer.build_etf_detail_coverage()
    current = normalized_tickers(recomputed.get("missing_tickers") or [])
    source = load_json(SOURCE_COVERAGE_PATH)
    stored = normalized_tickers(source.get("missing_tickers") or [])
    if current != stored:
        added = sorted(set(current) - set(stored))
        removed = sorted(set(stored) - set(current))
        raise RuntimeError(
            "source coverage artifact does not match producer recomputation: "
            f"recomputed={len(current)} stored={len(stored)} "
            f"added={added[:12]} removed={removed[:12]}"
        )
    public = load_json(PUBLIC_COVERAGE_PATH)
    public_tickers = normalized_tickers(public.get("missing_tickers") or [])
    return {
        "tickers": current,
        "set_sha256": ticker_set_sha256(current),
        "source_generated_at": source.get("generated_at"),
        "public_count": len(public_tickers),
        "public_set_sha256": ticker_set_sha256(public_tickers),
        "public_matches_source": public_tickers == current,
    }


def shard_rows(tickers: list[str], shard_size: int, first_shard: int = 2) -> list[dict]:
    rows = []
    total = len(tickers)
    for offset in range(0, total, shard_size):
        selected = tickers[offset : offset + shard_size]
        rows.append(
            {
                "shard": first_shard + len(rows),
                "start_index": offset,
                "end_index_exclusive": offset + len(selected),
                "size": len(selected),
                "expected_before": total - offset,
                "expected_after": total - offset - len(selected),
                "first_ticker": selected[0],
                "last_ticker": selected[-1],
                "selector_set_sha256": ticker_set_sha256(selected),
                "tickers": selected,
            }
        )
    return rows


def base_payload(coverage: dict) -> dict:
    return {
        "schema_version": "stockanalysis-missing-detail-selector-plan/v1",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "git_head": git_head(),
        "producer_path": "scripts/fetch-stockanalysis.py",
        "producer_function": "build_etf_detail_coverage",
        "source_coverage_path": "data/stockanalysis/coverage/etf_detail.json",
        "policy": {
            "network": "none",
            "workflow_dispatch": "none",
            "canonical_data_writes": "none",
            "ordering": "uppercase ticker ascending; identical to producer missing_tickers",
            "selection": "current_missing_tickers[0:min(100, remaining)]",
        },
        "source": {
            "generated_at": coverage["source_generated_at"],
            "remaining_missing": len(coverage["tickers"]),
            "missing_set_sha256": coverage["set_sha256"],
        },
        "public_projection": {
            "remaining_missing": coverage["public_count"],
            "missing_set_sha256": coverage["public_set_sha256"],
            "matches_source": coverage["public_matches_source"],
            "required_after_dispatch": (
                "Wait for fetch-stockanalysis.yml source commit, then its automatic "
                "update-manifest.yml dispatch; require source/public count and set hash parity."
            ),
        },
    }


def build_snapshot(shard_size: int) -> dict:
    coverage = current_coverage()
    payload = base_payload(coverage)
    payload.update(
        {
            "kind": "initial_snapshot",
            "shard": 1,
            "selector": {"size": 0, "tickers": []},
            "current_missing_tickers": coverage["tickers"],
            "shard_size": shard_size,
            "shards": shard_rows(coverage["tickers"], shard_size),
        }
    )
    return payload


def build_reverified_selector(
    previous_plan_path: Path,
    shard: int,
    shard_size: int,
    max_delta_count: int,
    max_delta_ratio: float,
) -> dict:
    previous = load_json(previous_plan_path)
    previous_shard = int(previous.get("shard", -1))
    if shard != previous_shard + 1:
        raise RuntimeError(f"shard sequence mismatch: previous={previous_shard} requested={shard}")

    previous_current = normalized_tickers(previous.get("current_missing_tickers") or [])
    previous_selector = normalized_tickers((previous.get("selector") or {}).get("tickers") or [])
    if not previous_current:
        raise RuntimeError("previous plan has no current_missing_tickers snapshot")
    if not set(previous_selector).issubset(previous_current):
        raise RuntimeError("previous selector is not a subset of its current snapshot")

    expected = sorted(set(previous_current) - set(previous_selector))
    coverage = current_coverage()
    if not coverage["public_matches_source"]:
        raise RuntimeError(
            "public projection gate failed: "
            f"source={len(coverage['tickers'])}/{coverage['set_sha256']} "
            f"public={coverage['public_count']}/{coverage['public_set_sha256']}"
        )
    current = coverage["tickers"]
    added = sorted(set(current) - set(expected))
    removed = sorted(set(expected) - set(current))
    delta_count = len(added) + len(removed)
    delta_ratio = delta_count / max(1, len(expected))
    if delta_count > max_delta_count or delta_ratio > max_delta_ratio:
        raise RuntimeError(
            "drift gate failed: "
            f"expected={len(expected)} current={len(current)} "
            f"added={len(added)} removed={len(removed)} "
            f"delta={delta_count} ratio={delta_ratio:.6f} "
            f"limits=count<={max_delta_count},ratio<={max_delta_ratio:.6f}"
        )

    selected = current[: min(shard_size, len(current))]
    payload = base_payload(coverage)
    selector_csv = ",".join(selected)
    payload.update(
        {
            "kind": "pre_dispatch_reverify",
            "shard": shard,
            "previous_plan": str(previous_plan_path),
            "drift_gate": {
                "expected_count": len(expected),
                "current_count": len(current),
                "added_count": len(added),
                "removed_count": len(removed),
                "symmetric_delta_count": delta_count,
                "symmetric_delta_ratio": round(delta_ratio, 8),
                "max_delta_count": max_delta_count,
                "max_delta_ratio": max_delta_ratio,
                "added": added,
                "removed": removed,
                "status": "pass",
            },
            "current_missing_tickers": current,
            "selector": {
                "size": len(selected),
                "set_sha256": ticker_set_sha256(selected),
                "first_ticker": selected[0] if selected else None,
                "last_ticker": selected[-1] if selected else None,
                "tickers": selected,
                "csv": selector_csv,
            },
            "expected_post_run_remaining_missing": len(current) - len(selected),
            "dispatch": {
                "status": "owner_gated_not_dispatched",
                "workflow": "fetch-stockanalysis.yml",
                "command": (
                    "gh workflow run fetch-stockanalysis.yml --ref main "
                    f"-f reconcile_missing_etf_details=true "
                    f"-f reconcile_missing_etf_limit={len(selected)} "
                    f"-f etfs='{selector_csv}'"
                ),
            },
        }
    )
    return payload


def safe_output_path(raw_path: str) -> Path:
    path = Path(raw_path)
    target = path if path.is_absolute() else REPO_ROOT / path
    resolved = target.resolve()
    blocked_roots = [
        (REPO_ROOT / "data").resolve(),
        (REPO_ROOT / "100xfenok-next" / "public" / "data").resolve(),
    ]
    if any(resolved == root or root in resolved.parents for root in blocked_roots):
        raise RuntimeError(f"refusing canonical data output path: {resolved}")
    return resolved


def write_payload(payload: dict, output: str | None) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if output:
        target = safe_output_path(output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--snapshot", action="store_true")
    mode.add_argument("--shard", type=int)
    parser.add_argument("--previous-plan")
    parser.add_argument("--shard-size", type=int, default=DEFAULT_SHARD_SIZE)
    parser.add_argument("--max-delta-count", type=int, default=DEFAULT_MAX_DELTA_COUNT)
    parser.add_argument("--max-delta-ratio", type=float, default=DEFAULT_MAX_DELTA_RATIO)
    parser.add_argument("--output")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.shard_size <= 0:
        raise SystemExit("--shard-size must be positive")
    if args.max_delta_count < 0 or not 0 <= args.max_delta_ratio <= 1:
        raise SystemExit("drift limits must be non-negative and ratio <= 1")
    try:
        if args.snapshot:
            payload = build_snapshot(args.shard_size)
        else:
            if not args.previous_plan:
                raise SystemExit("--shard requires --previous-plan")
            payload = build_reverified_selector(
                Path(args.previous_plan),
                args.shard,
                args.shard_size,
                args.max_delta_count,
                args.max_delta_ratio,
            )
    except (RuntimeError, ValueError) as exc:
        raise SystemExit(f"selector plan blocked: {exc}") from exc
    write_payload(payload, args.output)


if __name__ == "__main__":
    main()
