#!/usr/bin/env python3
"""P2 handler regression test. Reads only committed artifacts; writes nothing.

P2-A removes an OUTPUT filter from the forecast emitter: r1-forecast-ext.mjs line 338
skips a row whenever its realized dependent is absent or filed after EVAL_CUTOFF, so a
forecast is never stored unless its own future outcome already exists. Removing that
filter is safe if and only if the filter was not silently participating in estimation.

This test is the whole safety argument. Every row in the panel committed BEFORE P2 must
reappear in the new panel with byte-identical forecast values. New rows may appear only
where actual is null. One changed value on a pre-existing row means the outcome was
influencing the forecast, which is a point-in-time leak, and P2 stops.

Sampling is not permitted here. A leak that touches one row in a thousand is still a leak,
and the argument being made is universal.

Usage:
  p2_handler_regression.py --new <path to the new panel>
  p2_handler_regression.py --new <path> --baseline-ref <git ref>

Frozen criteria: data/computed/feno-rim-recovery/p2-criteria.json (b5a528a331)
"""
import argparse
import json
import subprocess
import sys

PANEL = "data/computed/feno-rim-recovery/r1-edgar-panel-ext.json"
# the columns the criteria require to be byte-identical
GUARDED = ["eps_t", "rw", "ep", "ri", "price_scaled", "actual"]
KEY = ("sym", "origin", "tau")


def load_baseline(ref):
    out = subprocess.run(["git", "show", f"{ref}:{PANEL}"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"cannot read {PANEL} at {ref}: {out.stderr.strip()}")
    return json.loads(out.stdout)


def index(panel):
    d = {}
    for r in panel["rows"]:
        k = tuple(r.get(f) for f in KEY)
        if k in d:
            sys.exit(f"duplicate row key in panel: {k} — the key is not unique, "
                     f"so this test cannot be run as specified")
        d[k] = r
    return d


def same(a, b):
    """Exact identity, with NaN-free JSON numbers compared bitwise via repr."""
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return repr(float(a)) == repr(float(b))
    return a == b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--new", required=True)
    ap.add_argument("--baseline-ref", default="b5a528a331")
    ap.add_argument("--show", type=int, default=15)
    a = ap.parse_args()

    base = index(load_baseline(a.baseline_ref))
    with open(a.new) as fh:
        new = index(json.load(fh))

    missing = [k for k in base if k not in new]
    changed = []
    for k, old in base.items():
        if k not in new:
            continue
        diffs = {f: (old.get(f), new[k].get(f))
                 for f in GUARDED if not same(old.get(f), new[k].get(f))}
        if diffs:
            changed.append((k, diffs))

    added = [k for k in new if k not in base]
    added_with_actual = [k for k in added if new[k].get("actual") is not None]

    cells = {}
    for k in added:
        c = f"{k[1]}_tau{k[2]}"
        cells[c] = cells.get(c, 0) + 1

    verdict = "PASS"
    if missing or changed:
        verdict = "FAIL — POINT_IN_TIME_LEAK_SUSPECTED"
    elif added_with_actual:
        verdict = "FAIL — NEW ROWS CARRY A REALIZED OUTCOME"

    print(json.dumps({
        "schema_version": "feno_rim_p2_handler_regression.v1",
        "criteria": "p2-criteria.json @ b5a528a331",
        "baseline_ref": a.baseline_ref,
        "baseline_rows": len(base),
        "new_rows": len(new),
        "rows_reproduced_exactly": len(base) - len(missing) - len(changed),
        "rows_missing_from_new": len(missing),
        "rows_changed": len(changed),
        "rows_added": len(added),
        "rows_added_by_cell": dict(sorted(cells.items())),
        "rows_added_carrying_an_outcome": len(added_with_actual),
        "verdict": verdict,
        "guarded_columns": GUARDED,
        "missing_sample": missing[:a.show],
        "changed_sample": changed[:a.show],
        "added_with_actual_sample": added_with_actual[:a.show],
    }, indent=1))

    sys.exit(0 if verdict == "PASS" else 1)


if __name__ == "__main__":
    main()
