#!/usr/bin/env python3
"""Finalize derived market data outputs after source refresh/backfill."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
NEXT_APP = ROOT / "100xfenok-next"


def run_step(cmd: list[str], cwd: Path, dry_run: bool) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    if dry_run:
        return
    subprocess.run(cmd, cwd=cwd, check=True)


def read_audit_payload(python: str) -> dict:
    result = subprocess.run(
        [python, "scripts/audit-market-data.py"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def assert_ready_for_finalize(python: str, allow_incomplete: bool, dry_run: bool) -> None:
    print(f"$ {python} scripts/audit-market-data.py  # preflight", flush=True)
    if dry_run:
        return

    audit = read_audit_payload(python)
    backfill = audit.get("backfill") or {}
    if backfill.get("ready_for_finalize") is True:
        print("market data preflight: ready_for_finalize=true", flush=True)
        return

    summary = {
        "chunk_files": backfill.get("chunk_files"),
        "expected_chunk_files": backfill.get("expected_chunk_files"),
        "next_expected_offset": backfill.get("next_expected_offset"),
        "hard_error_count": backfill.get("hard_error_count"),
        "status_counts": backfill.get("status_counts"),
        "error_kinds": backfill.get("error_kinds"),
    }
    if allow_incomplete:
        print(
            "market data preflight: continuing despite incomplete audit "
            f"{json.dumps(summary, ensure_ascii=False)}",
            file=sys.stderr,
            flush=True,
        )
        return

    print(
        "market data preflight failed; rerun after full backfill or pass "
        f"--allow-incomplete. {json.dumps(summary, ensure_ascii=False)}",
        file=sys.stderr,
        flush=True,
    )
    raise SystemExit(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild market facts, audit payload, manifests, and Next data route index.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the finalize steps without writing generated outputs.",
    )
    parser.add_argument(
        "--skip-static-route-manifest",
        action="store_true",
        help="Skip 100xfenok-next static route manifest regeneration.",
    )
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="Allow finalize steps even when audit is not ready_for_finalize.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    python = sys.executable
    assert_ready_for_finalize(python, args.allow_incomplete, args.dry_run)
    run_step([python, "scripts/build-market-facts.py"], ROOT, args.dry_run)
    run_step(
        [
            python,
            "scripts/audit-market-data.py",
            "--output",
            "data/computed/market_data_audit.json",
            "--mirror-public",
        ],
        ROOT,
        args.dry_run,
    )
    run_step([python, "scripts/update-manifest.py"], ROOT, args.dry_run)
    if not args.skip_static_route_manifest:
        run_step(["npm", "run", "build:static-route-manifest"], NEXT_APP, args.dry_run)


if __name__ == "__main__":
    main()
