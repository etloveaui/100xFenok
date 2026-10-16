#!/usr/bin/env python3
"""
Rebuild data/yf/finance/_summary.json from the current local files.

Use after targeted backfills so the summary reflects usable coverage instead of
the last partial batch's transient errors.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import runpy
from yahoo_batch_state import yahoo_run_verdict

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "yf" / "finance"
FETCHER = ROOT / "scripts" / "fetch-yf-finance.py"
SCHEMA_VERSION = "yf-finance/v2"
STATE_INDEX = Path(os.environ.get("YAHOO_BATCH_STATE_ROOT", ROOT / "data" / "admin" / "yahoo-batch-quote-history")) / "index.json"


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def aggregate_shard_summaries(results_dir: Path, expected_shards: int) -> int:
    """Retain every completed shard's evidence before returning the lane result."""
    if expected_shards < 1:
        raise ValueError("expected shard count must be positive")
    totals = {key: 0 for key in ("count", "ok", "failed", "skipped", "total_seconds")}
    current = {key: 0 for key in ("attempted", "successes", "failed", "skipped", "fetch_attempts")}
    current["errors"] = []
    attempt_times = []
    errors, shards, unattempted, evidence_errors, selected, terminal_symbols = [], [], [], [], [], []
    exit_code = 0
    for index in range(expected_shards):
        shard = f"{index}/{expected_shards}"
        status_path = results_dir / f"{index}.exit"
        if not status_path.exists():
            unattempted.append(shard)
            continue
        status = int(status_path.read_text(encoding="utf-8").strip())
        exit_code = max(exit_code, status)
        entry = {"shard": shard, "exit_code": status}
        try:
            summary = json.loads((results_dir / f"{index}.json").read_text(encoding="utf-8"))
            if not isinstance(summary, dict) or summary.get("schema_version") != SCHEMA_VERSION:
                raise ValueError("invalid shard summary schema")
            if summary.get("exit_code") != status:
                raise ValueError("shard summary does not match the process exit code")
            for key in totals:
                value = summary.get(key)
                if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
                    raise ValueError(f"invalid shard summary {key}")
            result = summary.get("current_results")
            if not isinstance(result, dict) or not isinstance(result.get("errors"), list):
                raise ValueError("shard batch-state results are missing")
            for key in current:
                if key == "errors":
                    continue
                if not isinstance(result.get(key), int) or result[key] < 0:
                    raise ValueError(f"invalid shard result {key}")
            for key in totals:
                totals[key] += summary[key]
            for key in current:
                if key != "errors":
                    current[key] += result[key]
            current["errors"].extend(result["errors"])
            if result["attempted"] > result["skipped"] and isinstance(result.get("observed_at"), str):
                try:
                    stamp = datetime.fromisoformat(result["observed_at"].replace("Z", "+00:00"))
                    if stamp.tzinfo is not None:
                        attempt_times.append(stamp.astimezone(timezone.utc))
                except (TypeError, ValueError):
                    pass
            terminal_symbols.extend(result.get("terminal_symbols") or [])
            errors.extend(summary.get("errors") or [])
            selection = summary.get("selection") or {}
            selected.extend(selection.get("selected_symbols") or [])
            entry.update({key: summary[key] for key in ("count", "ok", "failed", "skipped")})
            entry["selection"] = selection
            entry["failure_assessment"] = summary.get("failure_assessment")
        except (FileNotFoundError, json.JSONDecodeError, ValueError) as exc:
            entry["evidence_error"] = f"{shard}: {exc}"
            evidence_errors.append(entry["evidence_error"])
        shards.append(entry)
    if unattempted and exit_code < 2:
        evidence_errors.append("shards were not attempted without a recorded systemic failure")
    for error in evidence_errors:
        row = {"ticker": None, "scope": "batch", "error": error}
        current["errors"].append(row)
        errors.append(row)
        current["attempted"] += 1
        current["failed"] += 1
    if evidence_errors:
        exit_code = max(exit_code, 2)
    current["observed_at"] = max(attempt_times).isoformat().replace("+00:00", "Z") if attempt_times else None
    batch = {
        "expected_shards": expected_shards,
        "attempted_shards": len(shards),
        "completed_shards": sum("evidence_error" not in shard for shard in shards),
        "unattempted_shards": unattempted,
        "incomplete_shards": [shard["shard"] for shard in shards if "evidence_error" in shard],
        "exit_code": exit_code,
        "shards": shards,
    }
    summary = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "all-shards-aggregate",
        **totals,
        "errors": errors,
        "terminal_symbols": sorted(set(terminal_symbols)),
        "current_results": current,
        "batch_results": batch,
        "exit_code": exit_code,
    }
    # The final shard already rebuilt catalogue/LKG state. Replace only its
    # per-process result with the complete invocation's actual attempts.
    state_index = json.loads(STATE_INDEX.read_text(encoding="utf-8"))
    current["terminal_symbols"] = sorted(set(terminal_symbols))
    if state_index.get("schema_version") != "yahoo-batch-quote-history-index/v1":
        raise ValueError("cannot aggregate an invalid Yahoo state index")
    verdict = yahoo_run_verdict(
        current_results=current, errors=errors, retry_symbols=state_index.get("retry_symbols") or [],
        assessments=[shard.get("failure_assessment") for shard in shards],
        expected_shards=expected_shards, attempted_shards=len(shards),
        completed_shards=batch["completed_shards"], shard_exit_codes=[exit_code], reported_failed=totals["failed"],
    )
    exit_code = verdict["exit_code"]
    batch["exit_code"] = summary["exit_code"] = exit_code
    summary["run_verdict"] = state_index["run_verdict"] = verdict
    state_index["current_results"] = current
    state_index["batch_results"] = batch
    state_index["selection"] = {
        **(state_index.get("selection") or {}),
        "shard": f"all/{expected_shards}",
        "selected_symbols": sorted(set(selected)),
    }
    write_json_atomic(STATE_INDEX, state_index)
    write_json_atomic(OUT_DIR / "_summary.json", summary)
    print(
        f"[shards] completed={batch['completed_shards']}/{expected_shards} "
        f"attempted={len(shards)} "
        f"ok={totals['ok']} failed={totals['failed']} exit={exit_code}; "
        f"unattempted={','.join(unattempted) or 'none'}"
    )
    print(f"[verdict] {verdict['verdict']} refused={verdict['refused']}/{verdict['attempted']} "
          f"budget={verdict['refusal_budget']}; reasons={'; '.join(verdict['reasons']) or 'none'}")
    return exit_code


def usable_payload(path: Path) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    data = payload.get("data")
    return isinstance(data, dict) and any(value is not None for value in data.values())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard-results-dir", type=Path)
    parser.add_argument("--expected-shards", type=int)
    args = parser.parse_args()
    if args.shard_results_dir is not None:
        if args.expected_shards is None or args.expected_shards < 1:
            parser.error("--shard-results-dir requires a positive --expected-shards")
        try:
            status = aggregate_shard_summaries(args.shard_results_dir, args.expected_shards)
        except (OSError, ValueError, TypeError) as exc:
            print(f"[corrupt] Yahoo shard aggregation failed: {exc}", file=sys.stderr)
            status = 1
        sys.exit(status)
    namespace = runpy.run_path(str(FETCHER))
    tickers = namespace["load_universe"]()

    errors = []
    ok = 0
    for ticker in tickers:
        path = OUT_DIR / f"{ticker}.json"
        if usable_payload(path):
            ok += 1
        else:
            errors.append({"ticker": ticker, "latency_ms": 0, "error": "missing or empty local payload"})

    summary = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(tickers),
        "ok": ok,
        "failed": len(errors),
        "skipped": 0,
        "total_seconds": 0,
        "avg_latency_ms": 0,
        "source": "local-file-rebuild",
        "errors": errors,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"[summary] count={len(tickers)} ok={ok} failed={len(errors)}")


if __name__ == "__main__":
    main()
