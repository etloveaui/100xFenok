#!/usr/bin/env python3
"""Finalize derived market data outputs after source refresh/backfill."""

from __future__ import annotations

import argparse
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
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    python = sys.executable
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
