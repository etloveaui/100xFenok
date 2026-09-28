#!/usr/bin/env python3
"""Parse FactSet "Earnings Insight" weekly PDFs into structured consensus fields.

Per issue extracts (raw snippet evidence kept for every field):
  - forward_12m_eps : S&P 500 forward 12-month (F12M) EPS estimate (dollars)
  - growth_rate     : blended/estimated forward EPS growth (percent)
  - forward_pe      : forward P/E
  - trailing_pe     : trailing P/E
  - data_as_of      : report's own "Data as of" date (null if absent)
  - publication_date: issue date (filename date)
  - first_knowable  : later of publication_date and data_as_of

Usage:
  python3 parse.py --inspect <pdf...>   # print layout text of first pages
  python3 parse.py                      # full run -> ../../computed/feno-rim-v2/x3-factset-earnings-insight.json
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ARCHIVES = os.path.join(ROOT, "archives")
RECEIPT = os.path.join(ARCHIVES, "receipt.json")
OUT = os.path.abspath(os.path.join(ROOT, "..", "computed", "feno-rim-v2", "x3-factset-earnings-insight.json"))
PDFTOTEXT = "/opt/homebrew/bin/pdftotext"

# ----------------------------------------------------------------------------
# helpers

def text_of(pdf_path: str) -> str:
    out = subprocess.run([PDFTOTEXT, "-layout", pdf_path, "-"], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"pdftotext failed for {pdf_path}: {out.stderr[:300]}")
    return out.stdout


def clean(s: str, limit: int = 220) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def to_num(s: str) -> float:
    return float(s.replace(",", "").replace("$", "").replace("%", "").replace("x", ""))


def parse_mdy(s: str) -> str | None:
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return dt.datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None

# ----------------------------------------------------------------------------
# extraction: ordered (regex, value-transform) lists; first hit wins; snippet kept

def extract(text: str, patterns: list[tuple[str, callable]]) -> tuple | None:
    """patterns: [(regex, transform_fn)]; returns (value, snippet) or None."""
    for rx, fn in patterns:
        m = re.search(rx, text, re.IGNORECASE)
        if m:
            try:
                return fn(m), clean(m.group(0))
            except (ValueError, TypeError, IndexError):
                continue
    return None

N = to_num

def dollar(m): return N(m.group(1))

def pct(m): return N(m.group(1))

def plain(m): return N(m.group(1))

# field-specific pattern sets (order = priority; document order wins ties)
P_EPS = [
    (r"forward\s+12\s*[-–]?\s*month\s+eps\s*estimate\s*\(?\$?\s*([\d,]+(?:\.\d+)?)\)?", dollar),
    (r"forward\s+12\s*[-–]?\s*month\s*\(?f12m\)?\s*eps\s*(?:estimate)?\s*(?:is|:|=)?\s*\$?\s*([\d,]+(?:\.\d+)?)", dollar),
    (r"f12m\s+eps\s+estimate[^\$\d]*\$?\s*([\d,]+(?:\.\d+)?)", dollar),
    (r"\$([\d,]+\.\d{2})\s*(?:is the s&p 500 forward 12-month eps|forward 12-month)", dollar),
]

P_GROWTH = [
    (r"(?:estimated|blended)?\s*forward\s+12\s*[-–]?\s*month\s+eps\s+growth\s+(?:rate|estimate)?\s*(?:is|:|=)?\s*([-]?[\d.]+)\s*%", pct),
    (r"eps\s+growth\s*\(?\s*(?:estimated|forward|f12m|blended)\s*\)?\s*[^\d%]*([-]?[\d.]+)\s*%", pct),
    (r"estimated\s+eps\s+growth\s*[^\d%]*([-]?[\d.]+)\s*%", pct),
    (r"growth\s+rate\s*[^\d%]*([-]?[\d.]+)\s*%", pct),
]

P_FPE = [
    (r"forward\s+p/?e\s*(?:\(f12m\)|ratio)?\s*(?:is|:|=)?\s*([\d.]+)", plain),
    (r"p/e\s*\(\s*(?:forward\s*12\s*[-–]?\s*month|f12m|forward)\s*\)\s*[^\d]*([\d.]+)", plain),
    (r"forward\s+p/e\s+of\s*([\d.]+)", plain),
]

P_TPE = [
    (r"trailing\s+12\s*[-–]?\s*month\s+p/?e\s*(?:ratio)?\s*(?:is|:|=)?\s*([\d.]+)", plain),
    (r"trailing\s+p/?e\s*(?:ratio)?\s*(?:is|:|=)?\s*([\d.]+)", plain),
    (r"p/e\s*\(\s*trailing\s*\)\s*[^\d]*([\d.]+)", plain),
    (r"trailing\s+p/e\s+of\s*([\d.]+)", plain),
]

P_ASOF = [
    (r"data\s+as\s+of\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}|\d{1,2}-\d{1,2}-\d{4})", lambda m: parse_mdy(m.group(1))),
]


def parse_issue(pdf_path: str, issue_date: str) -> dict:
    txt = text_of(pdf_path)
    # collapse column padding for table-cell adjacency
    flat = re.sub(r"[ \t]+", " ", txt)

    eps = extract(flat, P_EPS)
    growth = extract(flat, P_GROWTH)
    fpe = extract(flat, P_FPE)
    tpe = extract(flat, P_TPE)
    asof = extract(flat, P_ASOF)

    data_as_of = asof[0] if asof else None
    publication_date = issue_date
    first_knowable = max(publication_date, data_as_of or publication_date)

    return {
        "forward_12m_eps": eps[0] if eps else None,
        "growth_rate": growth[0] if growth else None,
        "forward_pe": fpe[0] if fpe else None,
        "trailing_pe": tpe[0] if tpe else None,
        "data_as_of": data_as_of,
        "publication_date": publication_date,
        "first_knowable": first_knowable,
        "evidence": {
            "forward_12m_eps": eps[1] if eps else None,
            "growth_rate": growth[1] if growth else None,
            "forward_pe": fpe[1] if fpe else None,
            "trailing_pe": tpe[1] if tpe else None,
            "data_as_of": asof[1] if asof else None,
        },
    }


def inspect(pdfs: list[str]) -> None:
    for p in pdfs:
        print(f"########## {p} ##########")
        print(text_of(p)[:6000])


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--inspect":
        inspect(sys.argv[2:])
        return 0

    with open(RECEIPT, encoding="utf-8") as f:
        receipt = json.load(f)

    per_origin = []
    by_origin = {f["origin_as_of"]: f for f in receipt["files"]}
    for origin in receipt["unserved"]:
        per_origin.append({
            "origin_as_of": origin, "issue_date": None, "lag_days": None,
            "file": None, "url": None,
            "forward_12m_eps": None, "growth_rate": None, "forward_pe": None,
            "trailing_pe": None, "data_as_of": None, "publication_date": None,
            "first_knowable": None, "evidence": {}, "note": "unserved: no 200 within 14-day walkback of the preceding Friday",
        })

    for origin, meta in sorted(by_origin.items()):
        pdf_path = os.path.join(ARCHIVES, meta["file"])
        if not os.path.exists(pdf_path):
            per_origin.append({**{"origin_as_of": origin, "issue_date": meta.get("issue_date"),
                                   "lag_days": meta.get("lag_days"), "file": meta["file"],
                                   "url": meta["url"]}, "note": "file missing on disk"})
            continue
        parsed = parse_issue(pdf_path, meta.get("issue_date") or meta["file"][14:20])
        per_origin.append({
            "origin_as_of": origin,
            "issue_date": meta.get("issue_date"),
            "lag_days": meta.get("lag_days"),
            "file": meta["file"],
            "url": meta["url"],
            **parsed,
        })

    lags = [p["lag_days"] for p in per_origin if p["lag_days"] is not None]
    served = [p for p in per_origin if p["file"] is not None]
    unserved = [p["origin_as_of"] for p in per_origin if p["file"] is None]

    doc = {
        "schema_version": "feno_rim_v2_x3_factset_ei.v1",
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "per_origin": per_origin,
        "coverage": {
            "served": len(served),
            "unserved": unserved,
            "lag_min": min(lags) if lags else None,
            "lag_max": max(lags) if lags else None,
            "lag_mean": round(sum(lags) / len(lags), 2) if lags else None,
        },
        "notes": [
            "F12M EPS dollar figure appears only in the 2016-12-23 and 2017-03-24 issues; from 2017-06 onward the Valuation section states only the forward 12-month P/E ratio, so forward_12m_eps is null for those issues (parsed as published, never derived).",
            "trailing_pe appears only in issues whose text states a trailing 12-month P/E ratio (8 of 27); the rest of the issues do not publish it.",
            "No issue states an explicit 'Data as of' date (they reference 'as of today' / the Thursday close); data_as_of is therefore null everywhere and first_knowable = publication date for every served origin.",
            "The 7 unserved origins (2015-03/06/09/12, 2016-03/06/09) precede the public archive's first issue (2016-12-23); no Earnings Insight exists for them at any host or suffix probed.",
        ],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # verification summary
    def hit(keys):
        return sum(1 for p in per_origin if all(p.get(k) is not None for k in keys))
    print(json.dumps({
        "served": len(served),
        "unserved": unserved,
        "lag_min": doc["coverage"]["lag_min"], "lag_max": doc["coverage"]["lag_max"],
        "lag_mean": doc["coverage"]["lag_mean"],
        "hit_forward_12m_eps": hit(["forward_12m_eps"]),
        "hit_growth_rate": hit(["growth_rate"]),
        "hit_forward_pe": hit(["forward_pe"]),
        "hit_trailing_pe": hit(["trailing_pe"]),
        "hit_data_as_of": hit(["data_as_of"]),
        "hit_all_four_numbers": hit(["forward_12m_eps", "growth_rate", "forward_pe", "trailing_pe"]),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
