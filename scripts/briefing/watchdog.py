"""Missed-run check: launchd com.fenok.100x-briefing-watchdog runs this at 06:30 KST, Tuesday to Saturday.

python -m briefing.watchdog [--edition YYYY-MM-DD]

The 06:05 job writes editions/<date>.json as soon as it starts. If an edition that should have an article has no
state file by now, the job did not start (launchd did not fire, or run_m4.sh/Python failed before the orchestrator
began), and one ops alert goes out (step missed_run, deduplicated like every other alert).
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
from pathlib import Path
from typing import Callable

from . import alert, market_pack
from .common import CFG, now_kst, state_path


def check(edition: dt.date, sender: Callable[[str, str], dict] = alert.ops_send,
          editions_dir: Path | None = None, alerts_path: Path | None = None) -> str:
    if not market_pack.session_for_edition(edition):
        return "no-session"
    editions_dir = editions_dir or state_path(CFG["state"]["editions"], "x").parent
    if (editions_dir / f"{edition.isoformat()}.json").exists():
        return "started"
    reason = f"{CFG['alerts']['missed_run_kst']} KST까지 실행 기록 없음 (launchd 미실행 또는 시작 전 실패)"
    alert.send_failure(edition.isoformat(), "missed_run", reason, state_path("launchd.err.log"), sender, alerts_path)
    return "alerted"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--edition", help="KST edition date YYYY-MM-DD (default: today KST)")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    edition = dt.date.fromisoformat(a.edition) if a.edition else now_kst().date()
    logging.getLogger("briefing.watchdog").info("edition %s: %s", edition, check(edition))
    return 0


if __name__ == "__main__":
    sys.exit(main())
