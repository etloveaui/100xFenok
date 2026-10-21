"""Missed-run check and one retry: launchd com.fenok.100x-briefing-watchdog runs this at 06:30 and 07:00 KST, Tuesday to Saturday.

python -m briefing.watchdog [--edition YYYY-MM-DD]

The 06:05 job writes editions/<date>.json as soon as it starts. If an edition that should have an article has no
state file by now, the job did not start (launchd did not fire, or run_m4.sh/Python failed before the orchestrator
began), and one ops alert goes out (step missed_run, deduplicated like every other alert).

An edition whose state says "failed" is run once more through run_m4.sh (a "retried" stamp in the state file keeps it to
one retry). The failure alert has already gone out; a second failure of the same step sends no second alert.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import subprocess
import sys
from pathlib import Path
from typing import Callable

from . import alert, market_pack
from .common import CFG, now_kst, read_json, state_path, write_json


def rerun(edition: dt.date) -> int:
    """Run the whole edition once more and wait for it: launchd reaps a child that outlives the watchdog."""
    script = Path(__file__).with_name("run_m4.sh")
    return subprocess.run(["/bin/zsh", str(script), "--edition", edition.isoformat()], check=False).returncode


def check(edition: dt.date, sender: Callable[[str, str], dict] = alert.ops_send,
          editions_dir: Path | None = None, alerts_path: Path | None = None,
          runner: Callable[[dt.date], int] = rerun) -> str:
    if not market_pack.session_for_edition(edition):
        return "no-session"
    editions_dir = editions_dir or state_path(CFG["state"]["editions"], "x").parent
    state_file = editions_dir / f"{edition.isoformat()}.json"
    if not state_file.exists():
        reason = f"{CFG['alerts']['missed_run_kst']} KST까지 실행 기록 없음 (launchd 미실행 또는 시작 전 실패)"
        alert.send_failure(edition.isoformat(), "missed_run", reason, state_path("launchd.err.log"), sender, alerts_path)
        return "alerted"
    state = read_json(state_file, {}) or {}
    if state.get("status") == "failed" and not state.get("retried"):
        state["retried"] = now_kst().isoformat(timespec="seconds")
        write_json(state_file, state)
        logging.getLogger("briefing.watchdog").info("edition %s failed at %s; running it once more", edition, state.get("step"))
        runner(edition)
        return "retried"
    return "started"


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
