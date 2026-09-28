#!/usr/bin/env python3
"""Zacks Wayback render test — does an archived detailed-estimates capture
actually contain the Consensus Estimate table (server-rendered) or is it
client-rendered (numbers absent)? Bounded: 4 tickers x up to 4 timestamps."""
import json
import os
import subprocess
import time
import datetime as dt

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
DENSITY = os.path.join(ROOT, "data/computed/feno-rim-v2/x3-zacks-cdx-density.json")
UA = "FenomenoKim Research etloveaui@gmail.com"

TEST_TICKERS = ["AAPL", "MSFT", "JPM", "KO"]
TARGET_YEARS = [2016, 2018, 2020, 2022]

MARKERS = ["Consensus Estimate", "Current Qtr", "Next Qtr", "Current Year", "Next Year",
           "No. of Analysts", "Low Estimate", "High Estimate", "Estimate Trend", "Avg. Estimate"]


def pick_timestamps(rows, years):
    """rows: [(ts, status)]; pick nearest capture to each target year."""
    picks = []
    for year in years:
        best = None
        for ts, st in rows:
            if not ts or len(ts) < 4:
                continue
            y = int(ts[:4])
            score = abs(y - year)
            if best is None or score < best[0]:
                best = (score, ts, st)
        if best and best[0] <= 1:
            picks.append(best[1])
    return picks[:4]


def fetch(ts, ticker):
    url = f"https://web.archive.org/web/{ts}/http://www.zacks.com/stock/quote/{ticker}/detailed-estimates"
    r = subprocess.run(["curl", "-sSL", "--max-time", "60", "-o", "-", "-w", "\n%{http_code}", url,
                        "-H", f"User-Agent: {UA}"], capture_output=True)
    out = r.stdout
    if b"\n" in out:
        body, _, code_b = out.rpartition(b"\n")
        code = code_b.decode("ascii", "ignore")
    else:
        body, code = out, "000"
    return code, body


def main():
    density = json.load(open(DENSITY))
    tests = []
    for ticker in TEST_TICKERS:
        meta = density["per_ticker"].get(ticker, {})
        raw_rows = meta.get("capture_count", 0)
        # rebuild timestamp list from the density output if present (it only stores counts —
        # so re-query CDX here for the timestamps of the test tickers)
        url = f"http://web.archive.org/cdx/search/cdx?url=zacks.com/stock/quote/{ticker}/detailed-estimates&from=2015&to=2024&collapse=timestamp:6&output=json&fl=timestamp,statuscode"
        rows = None
        for _ in range(5):
            r = subprocess.run(["curl", "-sS", "--max-time", "30", url, "-H", f"User-Agent: {UA}"], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip().startswith("["):
                try:
                    parsed = json.loads(r.stdout)
                    rows = parsed[1:] if len(parsed) > 1 else []
                    break
                except Exception:
                    pass
            time.sleep(8)
        if not rows:
            tests.append({"ticker": ticker, "error": "cdx_failed", "capture_count": raw_rows})
            print(ticker, "CDX FAILED", flush=True)
            continue
        for ts in pick_timestamps(rows, TARGET_YEARS):
            code, body = fetch(ts, ticker)
            text = body.decode("utf-8", "ignore")
            hit_count = sum(1 for m in MARKERS if m.lower() in text.lower())
            # numeric evidence near markers: look for $-prefixed or decimal values close to estimate labels
            import re
            numeric_hits = len(re.findall(r"(?:Estimate|EPS|Analysts)[^<\n]{0,80}?(\$?\d+\.\d{2}|\d+\.\d{2})", text, re.IGNORECASE))
            idx = text.lower().find("consensus estimate")
            evidence = text[max(0, idx - 100):idx + 400] if idx >= 0 else text[:300]
            evidence = re.sub(r"\s+", " ", evidence)[:260]
            table_present = hit_count >= 3 and numeric_hits >= 3
            tests.append({
                "ticker": ticker, "timestamp": ts, "status": code, "html_bytes": len(body),
                "marker_hits": hit_count, "numeric_hits": numeric_hits,
                "table_present": table_present,
                "table_absent_client_rendered": not table_present,
                "evidence": evidence,
            })
            print(f"{ticker} {ts}: status={code} markers={hit_count} numeric={numeric_hits} present={table_present}", flush=True)
            time.sleep(1.5)

    summary = {"tests_total": len(tests), "server_rendered": sum(1 for t in tests if t.get("table_present")),
               "client_rendered_or_absent": sum(1 for t in tests if t.get("table_absent_client_rendered"))}
    out = {
        "schema_version": "feno_rim_v2_x3_zacks_feasibility.v1",
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "density": density["per_ticker"],
        "render_tests": tests,
        "conclusion": {**summary,
                       "summary": "one sentence filled after review"},
    }
    with open(os.path.join(ROOT, "data/computed/feno-rim-v2/x3-zacks-feasibility.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("written", out["schema_version"], flush=True)


if __name__ == "__main__":
    main()
