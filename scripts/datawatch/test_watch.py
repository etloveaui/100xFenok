"""Deterministic checks for the data watch's incident identity and count updates (no network, no sender).

python3 -I scripts/datawatch/test_watch.py
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import watch  # noqa: E402

BODY = """[alert] Pipeline health incidents detected.

## Fetch YF Finance Data (`fetch-yf-finance.yml`)
- Alarm reasons: failure_streak
- Consecutive failures: 4

## Data health KPI
- stockanalysis_etf_detail: member_ratio_low, source_not_advancing; source 2026-10-22
  - Members inside bound: {sa}
- yahoo_batch_quote_history: member_ratio_low; source 2026-10-22
  - Members inside bound: {yb}
- yahoo_etf_fallback: member_ratio_low; source 2026-10-22
  - Members inside bound: 16/17
- Latest KPI generation: 2026-10-23T13:04:50.616Z
"""


def issues(sa="1467/1498", yb="6845/7033", body=BODY):
    row = {"number": 133, "title": "100xFenok pipeline job failure alarm", "html_url": "https://example.invalid/133",
           "body": body.format(sa=sa, yb=yb)}
    watch.CALLS = 0
    original = watch.gh
    watch.gh = lambda path, *a, **k: [row]
    try:
        return watch.read_issues()
    finally:
        watch.gh = original


def tick(state_dir: Path, snapshot: dict, now="2026-10-23T14:00:00+00:00"):
    """One watch run over a fixed issue snapshot; returns the delivered lines."""
    import datetime as dt
    stamp = dt.datetime.fromisoformat(now)
    watch.READERS = {"issues": lambda: snapshot, "clock": lambda: stamp, "ledger": lambda: stamp, "alarm": lambda: stamp}
    watch.TOKEN = None
    sent = []
    watch.alert.ops_send = lambda line, run_id: sent.append(line) or {"status": "success"}
    args = argparse.Namespace(now=now, state_dir=str(state_dir), dry_run=False, tag="")
    with contextlib.redirect_stdout(io.StringIO()):
        watch.run(args)
    return sent


class IdentityTests(unittest.TestCase):
    def test_multi_reason_member_line_keeps_counts_out_of_identity(self):
        a, b = issues(sa="1467/1498"), issues(sa="1491/1498")
        self.assertEqual(a["133"]["incidents"], b["133"]["incidents"])
        reasons = a["133"]["incidents"]["Data health KPI"]
        self.assertIn("stockanalysis_etf_detail:member_ratio_low", reasons)
        self.assertFalse([r for r in reasons if r.startswith("Members inside bound")])
        self.assertEqual(a["133"]["member_counts"]["stockanalysis_etf_detail:member_ratio_low"], [1467, 1498])

    def test_new_set_is_a_new_incident(self):
        old = issues()["133"]["incidents"]
        grown = {**old, "Data health KPI": old["Data health KPI"] + ["some_set:member_ratio_low"]}
        self.assertEqual(watch.idents(grown) - watch.idents(old), {("Data health KPI", "some_set:member_ratio_low")})


class LifecycleTests(unittest.TestCase):
    def run_series(self, series):
        with tempfile.TemporaryDirectory() as tmp:
            out = []
            for i, snapshot in enumerate(series):
                out.append(tick(Path(tmp), snapshot, f"2026-10-23T{14 + i:02d}:00:00+00:00"))
            return out

    def test_improving_count_is_never_labelled_worse_or_added(self):
        lines = self.run_series([issues("1467/1498"), issues("1467/1498"), issues("1480/1495"), issues("1491/1498")])
        flat = [l for step in lines for l in step]
        self.assertFalse([l for l in flat if "악화" in l or "추가" in l], flat)
        self.assertTrue([l for l in flat if "개선" in l], flat)

    def test_worsening_count_is_a_worsened_update_without_added(self):
        lines = self.run_series([issues("1491/1498"), issues("1491/1498"), issues("1485/1498")])
        flat = [l for step in lines for l in step]
        self.assertEqual(len(flat), 1, flat)
        self.assertIn("악화", flat[0])
        self.assertIn("1491/1498 → 1485/1498", flat[0])
        self.assertNotIn("추가", flat[0])

    def test_small_improvement_is_held_not_sent_and_accumulates(self):
        lines = self.run_series([issues("1467/1498"), issues("1467/1498"), issues("1468/1498"), issues("1469/1498"),
                                 issues("1471/1498")])
        flat = [l for step in lines for l in step]
        self.assertEqual(len(flat), 1, flat)
        self.assertIn("개선", flat[0])
        self.assertIn("1467/1498 → 1471/1498", flat[0])

    def test_real_new_incident_stays_loud(self):
        body = BODY.replace("## Data health KPI", "## Fetch Yahoo Finance Ticker Snapshot (`fetch-yahoo-ticker.yml`)\n- Alarm reasons: failure_streak\n\n## Data health KPI")
        lines = self.run_series([issues(), issues(), issues(body=body)])
        flat = [l for step in lines for l in step]
        self.assertEqual(len(flat), 1, flat)
        self.assertIn("악화", flat[0])
        self.assertIn("추가", flat[0])

    def test_legacy_state_with_counts_in_identity_does_not_re_announce(self):
        legacy = issues()
        legacy["133"]["incidents"]["Data health KPI"] = ["Members inside bound: 1467/1498", "Members inside bound: 6845/7033"]
        legacy["133"].pop("member_counts")
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            tick(state, legacy, "2026-10-23T14:00:00+00:00")  # baseline run records the legacy shape
            lines = tick(state, issues("1480/1495"), "2026-10-23T15:00:00+00:00")
        self.assertFalse([l for l in lines if "추가" in l], lines)


if __name__ == "__main__":
    unittest.main(verbosity=2)
