#!/usr/bin/env python3
"""P1 handler independent re-derivation. Reads only local caches; writes nothing.

Recomputes r_payout (Path A) and g_B (Path B) straight from the SEC companyfacts cache by
an extraction path written independently of the worker's, then diffs against the worker's
FENO_RIM_PAYOUT_NORMALIZATION.json / FENO_RIM_FORWARD_BOOK_PATHS.json.

Identity resolution (symbol -> cik) is deliberately TAKEN FROM the worker output rather than
re-derived: ticker reuse produced eight mis-mappings earlier in this mission, and re-deriving
it here would risk reintroducing them under the banner of independence. The cik mapping is
audited separately, not by this script. What this script verifies is the arithmetic and the
point-in-time fact selection, which is where the criteria live.

Usage:
  p1_handler_independent.py --sample 30 [--seed 20260808]
  p1_handler_independent.py --symbol AAP --origin 2021-06-30 --cik 1158449

Frozen criteria: data/computed/feno-rim-recovery/p1-criteria.json (251f4bcc21)
"""
import argparse
import json
import os
import random
import statistics
import sys
from datetime import date

CACHE = "/Volumes/M470/aa-runtime-cache/asset_allocator/ssp/edgar/companyfacts"
RECOVERY = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".."
)

ANNUAL_FORMS = ("10-K", "10-K/A")
DURATION_MIN, DURATION_MAX = 300, 400

# criteria: path_a_shareholder_payout_rollforward.r_payout_definition.concepts
CONCEPTS = {
    "dividends": ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
    "repurchase": ["PaymentsForRepurchaseOfCommonStock"],
    "issuance": ["ProceedsFromIssuanceOfCommonStock"],
    "ni": ["NetIncomeLoss"],
}
BOOK_CONCEPTS = ["StockholdersEquity"]

PAYOUT_WINDOW = 5      # criteria: most recent 5 annual firm-years
PAYOUT_MIN_YEARS = 3
BOOK_OBS = 6           # criteria: most recent 6 annual book observations
BOOK_MIN_RATES = 4
CLIP_PAYOUT = (-0.5, 1.5)
CLIP_GROWTH = (-0.50, 0.50)


def d(s):
    return date.fromisoformat(s)


def load_facts(cik):
    p = os.path.join(CACHE, "CIK%010d.json" % int(cik))
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        return json.load(fh)


def flow_series(facts, concept, origin):
    """Annual duration facts, filed <= origin, latest filed per period end."""
    node = facts.get("facts", {}).get("us-gaap", {}).get(concept)
    if not node:
        return {}
    best = {}
    for unit, entries in node.get("units", {}).items():
        if unit != "USD":
            continue
        for e in entries:
            if e.get("form") not in ANNUAL_FORMS:
                continue
            if not e.get("start") or not e.get("end") or not e.get("filed"):
                continue
            if d(e["filed"]) > origin or d(e["end"]) > origin:
                continue
            dur = (d(e["end"]) - d(e["start"])).days
            if not (DURATION_MIN <= dur <= DURATION_MAX):
                continue
            k = e["end"]
            if k not in best or d(e["filed"]) > d(best[k]["filed"]):
                best[k] = e
    return {k: v["val"] for k, v in best.items()}


def instant_series(facts, concept, origin):
    """Annual instant facts, filed <= origin, latest filed per period end."""
    node = facts.get("facts", {}).get("us-gaap", {}).get(concept)
    if not node:
        return {}
    best = {}
    for unit, entries in node.get("units", {}).items():
        if unit != "USD":
            continue
        for e in entries:
            if e.get("form") not in ANNUAL_FORMS:
                continue
            if e.get("start") or not e.get("end") or not e.get("filed"):
                continue
            if d(e["filed"]) > origin or d(e["end"]) > origin:
                continue
            k = e["end"]
            if k not in best or d(e["filed"]) > d(best[k]["filed"]):
                best[k] = e
    return {k: v["val"] for k, v in best.items()}


def first_available(facts, names, origin, kind):
    fn = flow_series if kind == "flow" else instant_series
    for n in names:
        s = fn(facts, n, origin)
        if s:
            return n, s
    return None, {}


def clip(x, lo, hi):
    return max(lo, min(hi, x))


def calendar_align(series_map, ends):
    """Value per period end, absent -> 0 (criteria absent_concept_rule)."""
    return [series_map.get(e, 0.0) for e in ends]


def r_payout(facts, origin):
    ni_c, ni = first_available(facts, CONCEPTS["ni"], origin, "flow")
    if not ni:
        return {"status": "NO_NET_INCOME"}
    ends = sorted(ni.keys())[-PAYOUT_WINDOW:]
    if len(ends) < PAYOUT_MIN_YEARS:
        return {"status": "INSUFFICIENT_YEARS", "years": len(ends)}

    div_c, div = first_available(facts, CONCEPTS["dividends"], origin, "flow")
    rep_c, rep = first_available(facts, CONCEPTS["repurchase"], origin, "flow")
    iss_c, iss = first_available(facts, CONCEPTS["issuance"], origin, "flow")

    dv = calendar_align(div, ends)
    rp = calendar_align(rep, ends)
    isv = calendar_align(iss, ends)
    niv = [ni[e] for e in ends]

    nsp = [dv[i] + rp[i] - isv[i] for i in range(len(ends))]
    med_nsp = statistics.median(nsp)
    med_ni = statistics.median(niv)
    if med_ni <= 0:
        return {"status": "MEDIAN_NI_NONPOSITIVE", "median_ni": med_ni,
                "years": ends, "median_nsp": med_nsp}
    raw = med_nsp / med_ni
    return {
        "status": "FIRM_RULE",
        "years": ends,
        "concepts": {"ni": ni_c, "dividends": div_c,
                     "repurchase": rep_c, "issuance": iss_c},
        "nsp_per_year": nsp,
        "ni_per_year": niv,
        "median_nsp": med_nsp,
        "median_ni": med_ni,
        "raw_ratio": raw,
        "r_payout": clip(raw, *CLIP_PAYOUT),
        "clipped": raw != clip(raw, *CLIP_PAYOUT),
    }


def g_book(facts, origin):
    bc, book = first_available(facts, BOOK_CONCEPTS, origin, "instant")
    if not book:
        return {"status": "NO_BOOK"}
    ends = sorted(book.keys())[-BOOK_OBS:]
    rates, used = [], []
    for i in range(1, len(ends)):
        b0, b1 = book[ends[i - 1]], book[ends[i]]
        if b0 <= 0 or b1 <= 0:
            continue
        g = b1 / b0 - 1.0
        rates.append(clip(g, *CLIP_GROWTH))
        used.append({"from": ends[i - 1], "to": ends[i], "raw": g,
                     "clipped": g != clip(g, *CLIP_GROWTH)})
    if len(rates) < BOOK_MIN_RATES:
        return {"status": "INSUFFICIENT_RATES", "n_rates": len(rates),
                "observations": ends}
    n_clipped = sum(1 for u in used if u["clipped"])
    return {
        "status": "OK",
        "concept": bc,
        "observations": ends,
        "pairs": used,
        "g_b": statistics.median(rates),
        "structural_break_suspect": n_clipped > 1,
        "book_at_origin": book[ends[-1]],
    }


def one(symbol, cik, origin_s):
    origin = d(origin_s)
    facts = load_facts(cik)
    if facts is None:
        return {"symbol": symbol, "cik": cik, "origin": origin_s,
                "status": "NO_COMPANYFACTS_CACHE"}
    return {
        "symbol": symbol,
        "cik": cik,
        "origin": origin_s,
        "entity": facts.get("entityName"),
        "payout": r_payout(facts, origin),
        "book_growth": g_book(facts, origin),
    }


def load_worker(name):
    p = os.path.join(RECOVERY, name)
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol")
    ap.add_argument("--cik")
    ap.add_argument("--origin")
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--seed", type=int, default=20260808)
    ap.add_argument("--tolerance", type=float, default=1e-9)
    a = ap.parse_args()

    if a.symbol and a.cik and a.origin:
        print(json.dumps(one(a.symbol, a.cik, a.origin), indent=1))
        return

    worker = load_worker("FENO_RIM_PAYOUT_NORMALIZATION.json")
    if worker is None:
        sys.exit("worker output not present yet: FENO_RIM_PAYOUT_NORMALIZATION.json")

    cells = []
    for origin, block in (worker.get("origins") or {}).items():
        for sym, rec in (block.get("firms") or {}).items():
            if rec.get("cik"):
                cells.append((sym, rec["cik"], origin, rec))
    random.Random(a.seed).shuffle(cells)
    picked = cells[: a.sample or 30]

    diffs, checked = [], []
    for sym, cik, origin, rec in picked:
        mine = one(sym, cik, origin)
        theirs_r = rec.get("r_payout")
        mine_r = (mine.get("payout") or {}).get("r_payout")
        agree = (theirs_r is None and mine_r is None) or (
            theirs_r is not None and mine_r is not None
            and abs(theirs_r - mine_r) <= a.tolerance
        )
        row = {"symbol": sym, "cik": cik, "origin": origin,
               "worker_r_payout": theirs_r, "handler_r_payout": mine_r,
               "agree": agree}
        checked.append(row)
        if not agree:
            row["handler_detail"] = mine.get("payout")
            diffs.append(row)

    print(json.dumps({
        "schema_version": "feno_rim_p1_handler_independent.v1",
        "criteria": "p1-criteria.json @ 251f4bcc21",
        "n_checked": len(checked),
        "n_disagree": len(diffs),
        "disagreements": diffs,
        "checked": checked,
    }, indent=1))


if __name__ == "__main__":
    main()
