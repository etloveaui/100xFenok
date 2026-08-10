#!/usr/bin/env python3
"""FactSet Earnings Insight fetch — v3 (curl-based, fast).

Strategy per origin: Friday candidates in order [advantage plain, advantage A,
go plain, go A]; on total miss, walk back day by day probing advantage plain
only (the common case); fall back to A/go variants only when a plain hit is
needed. curl via subprocess (proven ~0.3-1.2s per probe). Politeness 0.5s.
"""
import datetime as dt
import hashlib
import json
import os
import subprocess
import time

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
ARCHIVES = os.path.join(ROOT, "data/factset-earnings-insight/archives")
os.makedirs(ARCHIVES, exist_ok=True)

UA = "FenomenoKim Research etloveaui@gmail.com"
DELAY = 0.5
MAX_WALKBACK_DAYS = 14

ORIGINS = [
    "2015-03-27", "2015-06-26", "2015-09-25", "2015-12-25",
    "2016-03-25", "2016-06-24", "2016-09-23", "2016-12-23",
    "2017-03-24", "2017-06-23", "2017-09-22", "2017-12-22",
    "2018-03-23", "2018-06-22", "2018-09-21", "2018-12-21",
    "2019-03-22", "2019-06-21", "2019-09-20", "2019-12-20",
    "2020-03-20", "2020-06-19", "2020-09-18", "2020-12-18",
    "2021-03-19", "2021-06-18", "2021-09-17", "2021-12-17",
    "2022-03-18", "2022-06-17", "2022-09-16", "2022-12-16",
    "2023-03-17", "2023-06-16",
]

now_utc = dt.datetime.now(dt.timezone.utc)


def friday_at_or_before(iso):
    d = dt.date.fromisoformat(iso)
    while d.weekday() != 4:
        d -= dt.timedelta(days=1)
    return d


def probe(fname, host="advantage.factset.com"):
    url = f"https://{host}/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/{fname}"
    r = subprocess.run(
        ["curl", "-sS", "--max-time", "20", "-o", "-", "-w", "\n%{http_code}", url, "-H", f"User-Agent: {UA}"],
        capture_output=True,
    )
    out = r.stdout  # bytes: PDF body + trailing \n<http_code>
    if b"\n" in out:
        body, _, code_b = out.rpartition(b"\n")
        code = code_b.decode("ascii", "ignore")
    else:
        body, code = out, "000"
    return code, body


def candidates_for(fname):
    """(fname, host) ordered list for a full probe."""
    return [(fname, "advantage.factset.com"), (fname[:-4] + "A.pdf", "advantage.factset.com"),
            (fname, "go.factset.com"), (fname[:-4] + "A.pdf", "go.factset.com")]


files = []
results = {}
for origin in ORIGINS:
    issue = friday_at_or_before(origin)
    found = None
    if origin < "2016-01-01":
        # verified: no 2015 issues in the archive — single Friday pass only
        for fname, host in candidates_for(issue.strftime("EarningsInsight_%m%d%y.pdf")):
            code, body = probe(fname, host)
            time.sleep(DELAY)
            if code == "200" and body:
                found = {"file": fname, "url": f"https://{host}/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/{fname}", "body": body, "issue_date": issue.isoformat()}
                break
    else:
        for walk in range(MAX_WALKBACK_DAYS + 1):
            fname = issue.strftime("EarningsInsight_%m%d%y.pdf")
            code, body = probe(fname)  # plain advantage first (fast path)
            time.sleep(DELAY)
            if code == "200" and body:
                found = {"file": fname, "url": f"https://advantage.factset.com/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/{fname}", "body": body, "issue_date": issue.isoformat()}
                break
            for afname, ahost in candidates_for(fname)[1:]:
                code2, body2 = probe(afname, ahost)
                time.sleep(DELAY)
                if code2 == "200" and body2:
                    found = {"file": afname, "url": f"https://{ahost}/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/{afname}", "body": body2, "issue_date": issue.isoformat()}
                    break
            if found:
                break
            issue -= dt.timedelta(days=1)
    if found:
        with open(os.path.join(ARCHIVES, found["file"]), "wb") as f:
            f.write(found["body"])
        files.append({
            "file": found["file"], "url": found["url"], "http_status": 200,
            "byte_size": len(found["body"]),
            "sha256": hashlib.sha256(found["body"]).hexdigest(),
            "fetched_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "origin_as_of": origin, "issue_date": found["issue_date"],
            "lag_days": (dt.date.fromisoformat(origin) - dt.date.fromisoformat(found["issue_date"])).days,
        })
        results[origin] = found["file"]
        print(f"{origin}: {found['file']} ({len(found['body'])}B lag {files[-1]['lag_days']}d)", flush=True)
    else:
        results[origin] = None
        print(f"{origin}: UNSERVED", flush=True)

receipt = {
    "schema_version": "fenok_factset_earnings_insight_receipt.v1",
    "fetched_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "origins_total": len(ORIGINS),
    "served": sum(1 for f in files),
    "unserved": [o for o, r in results.items() if r is None],
    "files": files,
}
with open(os.path.join(ARCHIVES, "receipt.json"), "w") as f:
    json.dump(receipt, f, indent=2)
print(f"served={receipt['served']}/{receipt['origins_total']} unserved={receipt['unserved']}", flush=True)
