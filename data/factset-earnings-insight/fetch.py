#!/usr/bin/env python3
"""Fetch FactSet "Earnings Insight" weekly PDFs (S&P 500 consensus) from the free public archive.

For each origin date, the issue date is the FRIDAY at or before the origin. Candidate URLs are
probed in order:
  a. https://advantage.factset.com/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/EarningsInsight_MMDDYY.pdf
  b. same with an A suffix: EarningsInsight_MMDDYYA.pdf
  c. go.factset.com host variant (same path), and its A variant
If all 404 for the computed Friday, walk back one day at a time (max 14 days) until a 200 lands.

Outputs:
  - archives/EarningsInsight_MMDDYY.pdf      raw PDF bytes
  - archives/receipt.json                    per-file manifest
  - probe-log.jsonl                          one line per HTTP probe
"""
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
ARCHIVES = os.path.join(ROOT, "archives")
PROBE_LOG = os.path.join(ROOT, "probe-log.jsonl")

USER_AGENT = "FenomenoKim Research etloveaui@gmail.com"
TIMEOUT = 20
DELAY = 2.5  # politeness delay between probes
MAX_WALKBACK_DAYS = 14
RETRYABLE = {"400", "403", "429", "500", "502", "503", "504"}

HOSTS = ["advantage.factset.com", "go.factset.com"]
SUFFIXES = ["", "A"]
PATH_TEMPLATE = (
    "/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/EarningsInsight_%s.pdf"
)

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


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probe(url: str) -> dict:
    """Return {status, content_type, body} — body only when a PDF was accepted."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read()
            return {
                "status": resp.status,
                "content_type": resp.headers.get("Content-Type", ""),
                "body": body if body[:5] == b"%PDF-" else None,
            }
    except urllib.error.HTTPError as e:
        return {"status": e.code, "content_type": e.headers.get("Content-Type", ""), "body": None}
    except urllib.error.URLError as e:
        return {"status": f"error:{type(e.reason).__name__}", "content_type": "", "body": None}
    except Exception as e:  # noqa: BLE001 - network layer is unpredictable; log raw
        return {"status": f"error:{type(e).__name__}", "content_type": "", "body": None}


def log_probe(line: dict) -> None:
    with open(PROBE_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


_consecutive_block = 0


def attempt_candidate(url: str, fname: str, origin: str, probe_date: str, back: int) -> dict | None:
    """Try one candidate URL; returns download entry dict on success, else None.
    Transient (WAF/5xx/timeout) statuses are retried with backoff; genuine 404 is not."""
    global _consecutive_block
    for attempt_no in range(1, 4):
        entry = {
            "ts": utc_now_iso(),
            "origin_as_of": origin,
            "probe_date": probe_date,
            "walkback_days": back,
            "filename": fname,
            "url": url,
            "status": None,
            "content_type": "",
            "accepted": False,
            "attempt": attempt_no,
        }
        res = probe(url)
        entry["status"] = res["status"]
        entry["content_type"] = res["content_type"]
        if res["status"] == 200 and res["body"] is not None:
            entry["accepted"] = True
            log_probe(entry)
            with open(os.path.join(ARCHIVES, fname), "wb") as f:
                f.write(res["body"])
            _consecutive_block = 0
            return {
                "file": fname,
                "url": url,
                "http_status": 200,
                "byte_size": len(res["body"]),
                "sha256": hashlib.sha256(res["body"]).hexdigest(),
                "fetched_at": utc_now_iso(),
                "origin_as_of": origin,
                "lag_days": (dt.date.fromisoformat(origin) - dt.date.fromisoformat(probe_date)).days,
                "issue_date": probe_date,
            }
        log_probe(entry)
        if str(res["status"]) in RETRYABLE or str(res["status"]).startswith("error:"):
            _consecutive_block += 1
            if _consecutive_block >= 5:
                print(f"  WARN {_consecutive_block} consecutive transient statuses; sleeping 120s", flush=True)
                time.sleep(120)
                _consecutive_block = 0
            else:
                time.sleep(5 * attempt_no)
            continue
        # genuine non-retryable miss (e.g. 404)
        _consecutive_block = 0
        break
    return None


def fetch_one(origin: str) -> dict | None:
    origin_d = dt.date.fromisoformat(origin)
    friday = origin_d - dt.timedelta(days=(origin_d.weekday() - 4) % 7)
    for back in range(0, MAX_WALKBACK_DAYS + 1):
        day = friday - dt.timedelta(days=back)
        mmddyy = f"{day.month:02d}{day.day:02d}{day.year % 100:02d}"
        for host in HOSTS:
            for suffix in SUFFIXES:
                fname = f"EarningsInsight_{mmddyy}{suffix}.pdf"
                url = f"https://{host}{PATH_TEMPLATE.replace('MMDDYY', mmddyy + suffix)}"
                got = attempt_candidate(url, fname, origin, day.isoformat(), back)
                if got:
                    return got
                time.sleep(DELAY)
    return None


def main() -> int:
    os.makedirs(ARCHIVES, exist_ok=True)
    files = []
    unserved = []
    receipt_path = os.path.join(ARCHIVES, "receipt.json")
    if os.path.exists(receipt_path):
        with open(receipt_path, encoding="utf-8") as f:
            prev = json.load(f)
        files = list(prev["files"])
        unserved = list(prev.get("unserved", []))
        done = {f["origin_as_of"] for f in files} | set(unserved)
        print(f"resume: {len(done)} origins already settled", flush=True)
    else:
        done = set()
    for i, origin in enumerate(ORIGINS, 1):
        if origin in done:
            print(f"[{i}/{len(ORIGINS)}] origin={origin} already settled", flush=True)
            continue
        print(f"[{i}/{len(ORIGINS)}] origin={origin}", flush=True)
        got = fetch_one(origin)
        if got:
            files.append(got)
            print(f"  -> {got['file']} lag={got['lag_days']}d size={got['byte_size']}", flush=True)
        else:
            unserved.append(origin)
            print(f"  -> UNSERVED (no 200 within {MAX_WALKBACK_DAYS} days walkback)", flush=True)
    receipt = {
        "schema_version": "fenok_factset_earnings_insight_receipt.v1",
        "fetched_at": utc_now_iso(),
        "files": files,
        "origins_total": len(ORIGINS),
        "served": len(files),
        "unserved": unserved,
    }
    with open(os.path.join(ARCHIVES, "receipt.json"), "w", encoding="utf-8") as f:
        json.dump(receipt, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(
        {"served": len(files), "unserved": unserved, "total_bytes": sum(f["byte_size"] for f in files)},
        indent=2,
    ), flush=True)
    return 0 if not unserved else 1


if __name__ == "__main__":
    sys.exit(main())
