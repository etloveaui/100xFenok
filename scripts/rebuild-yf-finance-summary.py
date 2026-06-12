#!/usr/bin/env python3
"""
Rebuild data/yf/finance/_summary.json from the current local files.

Use after targeted backfills so the summary reflects usable coverage instead of
the last partial batch's transient errors.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import runpy

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "yf" / "finance"
FETCHER = ROOT / "scripts" / "fetch-yf-finance.py"
SCHEMA_VERSION = "yf-finance/v1"


def usable_payload(path: Path) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    data = payload.get("data")
    return isinstance(data, dict) and any(value is not None for value in data.values())


def main() -> None:
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
