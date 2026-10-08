"""Gates and checks for a written article.

Hard gates: the writer schema (writer.parse_reply) and the briefing-morning/v1 document schema.
Corrections: mover tickers that are not on the SEC list or not named in the sources are blanked.
Warnings: numbers that the sources do not support (rounded, Korean-unit and computed forms are
recognised), and polite "-습니다/-요" endings.
"""
from __future__ import annotations

import bisect
import json
import os
import re
import time
import urllib.request
from pathlib import Path

import jsonschema

from .common import CFG, et_to_kst, state_path

# --- SEC ticker grounding -----------------------------------------------------------------------


def load_sec_tickers(cache: Path | None = None) -> dict[str, str]:
    """ticker -> SEC company title, cached for `sec_cache_days`."""
    src = CFG["sources"]
    cache = cache or state_path(CFG["state"]["cache"], "sec_tickers.json")
    stale = not cache.exists() or time.time() - cache.stat().st_mtime > src["sec_cache_days"] * 86400
    if stale:
        try:
            req = urllib.request.Request(src["sec_tickers_url"], headers={"User-Agent": os.environ[src["sec_user_agent_env"]]})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            json.loads(body)
            cache.write_bytes(body)
        except Exception:  # noqa: BLE001 - an older cache is still valid grounding
            if not cache.exists():
                raise
    return {v["ticker"]: v["title"] for v in json.loads(cache.read_text()).values()}


def validate_tickers(raw: dict, sec: dict[str, str]) -> list[str]:
    """Blank mover tickers that are not on the SEC company ticker list (model-invented tickers)."""
    dropped = []
    for m in raw.get("movers", []):
        if m.get("ticker") and m["ticker"] not in sec:
            dropped.append(m["ticker"])
            m["ticker"] = ""
    return dropped


GENERIC_NAME_WORDS = {"corp", "inc", "holdings", "group", "company", "technologies"}


def ground_tickers(raw: dict, corpus: str, sec: dict[str, str]) -> list[str]:
    """Keep a mover ticker only if the ticker or its SEC company name appears in the source text."""
    low, blanked = corpus.lower(), []
    for m in raw.get("movers", []):
        t = m.get("ticker", "")
        if not t:
            continue
        title = re.sub(r"[^a-z0-9 ]", " ", sec.get(t, "").lower()).split()
        word = next((w for w in title if len(w) >= 4 and w not in GENERIC_NAME_WORDS), "")
        if not (re.search(rf"\b{re.escape(t)}\b", corpus) or (word and word in low)):
            blanked.append(t)
            m["ticker"] = ""
    return blanked


# --- number check -------------------------------------------------------------------------------

UNIT = {"조": 10 ** 12, "억": 10 ** 8, "만": 10 ** 4}
NUM = r"\d[\d,]*(?:\.\d+)?"
KOREAN_EXPR = re.compile(rf"(?:{NUM}\s?[조억만])+(?:\s?{NUM}(?![\d.,]))?")
PLAIN = re.compile(NUM)
PART = re.compile(rf"({NUM})\s?([조억만])?")
SKIP_KEYS = ("series", "points", "spark", "spark20", "time_et", "time_kst")


def _decimals(tok: str) -> int:
    return len(tok.split(".")[1]) if "." in tok else 0


def parse_korean(expr: str) -> tuple[float, float]:
    """'48만6,532' -> (486532, 1); '8.9만' -> (89000, 1000); '1조2,000억' -> (1.2e12, 1e8)."""
    total, res = 0.0, 1.0
    for num, unit in PART.findall(expr):
        mult = UNIT.get(unit, 1)
        total += float(num.replace(",", "")) * mult
        res = mult * 10 ** -_decimals(num)
    return total, res


def tokens(text: str) -> list[tuple[str, float, float, str]]:
    """(token, value, resolution, kind) for every number in `text`; kind is 'korean' or 'plain'."""
    out, spans = [], []
    for m in KOREAN_EXPR.finditer(text):
        v, r = parse_korean(m.group(0))
        out.append((m.group(0), v, r, "korean"))
        spans.append(m.span())
    for m in PLAIN.finditer(text):
        if any(a <= m.start() < b for a, b in spans):
            continue
        tok = m.group(0)
        v = float(tok.replace(",", ""))
        r = 10.0 ** -_decimals(tok)
        if r == 1 and v >= 1000:  # round figure such as 7,800 means "about"
            digits = tok.replace(",", "")
            zeros = len(digits) - len(digits.rstrip("0"))
            if zeros >= 2:
                r = 10.0 ** zeros
        out.append((tok, v, r, "plain"))
    return out


def walk(obj, path: str = ""):
    """Yield (group path, text) for every string or number leaf outside the skipped keys."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k not in SKIP_KEYS:
                yield from walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, f"{path}[{i}]")
    elif isinstance(obj, bool):
        return
    elif isinstance(obj, (int, float)):
        yield path, f"{abs(obj):g}"
    elif isinstance(obj, str):
        yield path, obj


class Corpus:
    """Sorted numeric values from the sources, for tolerance lookups."""

    def __init__(self, values):
        self.values = sorted(set(round(v, 6) for v in values))
        self.exact_strings: set[str] = set()

    def has(self, v: float, r: float) -> bool:
        """True if a source value rounds or truncates to v at resolution r."""
        lo, hi = v - r / 2 - 1e-9, v + r - 1e-9
        i = bisect.bisect_left(self.values, lo)
        return i < len(self.values) and self.values[i] <= hi


def _norm(tok: str) -> str:
    t = tok.replace(",", "")
    return t.rstrip("0").rstrip(".") if "." in t else t


SCALED = re.compile(rf"({NUM})\s?([KMB])\b")
SCALE = {"K": 10 ** 3, "M": 10 ** 6, "B": 10 ** 9}


def build_corpus(texts: list[str], pack: dict) -> Corpus:
    values, exact = [], set()
    for text in texts:
        for tok, v, _r, _k in tokens(text):
            values.append(v)
            exact.add(_norm(tok) if _k == "plain" else tok)
        for num, unit in SCALED.findall(text):  # calendar forms such as 200K or 1,710K
            values.append(float(num.replace(",", "")) * SCALE[unit])
    # KST twins of every intraday ET time, in 24h and 12h forms, so "새벽 2시 20분" is grounded.
    session = pack.get("session")
    for series in (pack.get("intraday") or {}).values():
        for t, _v in (series or {}).get("points", []):
            h, m = et_to_kst(session, t).split(":")
            eh, em = t.split(":")
            values += [int(h), int(h) % 12 or 12, int(m), int(eh), int(eh) % 12 or 12, int(em)]
    c = Corpus(values)
    c.exact_strings = exact
    return c


def _pack_pairs(pack: dict) -> list[float]:
    """Derived values a writer may compute: differences, ratios and % changes of sibling numbers in the pack."""
    out: list[float] = []

    def ops(a: float, b: float):
        if a == b:
            return
        out.append(abs(a - b))
        if a and b:
            hi, lo = (a, b) if abs(a) >= abs(b) else (b, a)
            out.append(abs(hi / lo))
            out.append(abs((a / b - 1) * 100))
            out.append(abs((b / a - 1) * 100))

    def nums(d: dict) -> dict:
        return {k: float(v) for k, v in d.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}

    groups = []
    for key in ("indices", "etfs", "bigtech", "sectors", "movers"):
        groups.append(list((pack.get(key) or {}).values()))
    for g in groups:
        for rec in g:
            n = list(nums(rec).values())
            for i in range(len(n)):
                for j in range(i + 1, len(n)):
                    ops(n[i], n[j])
        if g is groups[-1]:  # movers: within-record pairs only, the cross-ticker grid is too wide to mean anything
            continue
        fields = set().union(*(nums(r).keys() for r in g)) if g else set()
        for f in fields:
            col = [nums(r)[f] for r in g if f in nums(r)]
            for i in range(len(col)):
                for j in range(i + 1, len(col)):
                    ops(col[i], col[j])
    for key in ("breadth", "rates", "edge"):
        n = list(nums(pack.get(key) or {}).values())
        for i in range(len(n)):
            for j in range(i + 1, len(n)):
                ops(n[i], n[j])
    return out


def number_check(article: dict, texts: list[str], pack: dict, limit: int = 30) -> dict:
    corpus = build_corpus(texts, pack)
    derived = Corpus(_pack_pairs(pack))
    counts = {"checked": 0, "exact": 0, "rounded": 0, "korean_unit": 0, "derived": 0, "unmatched": 0}
    unmatched, derived_items = [], []
    leaves = list(walk(article))
    groups: dict[str, list[float]] = {}
    for path, text in leaves:  # matched source values per object, for "computed from two numbers it cites"
        grp = path.rsplit(".", 1)[0]
        for tok, v, r, kind in tokens(text):
            if corpus.has(v, r):
                groups.setdefault(grp, []).append(v)
    for path, text in leaves:
        grp = path.rsplit(".", 1)[0]
        for tok, v, r, kind in tokens(text):
            if kind == "plain" and len(tok.replace(",", "").replace(".", "")) <= 1:
                continue
            counts["checked"] += 1
            if kind == "plain" and _norm(tok) in corpus.exact_strings:
                counts["exact"] += 1
            elif corpus.has(v, r):
                counts["korean_unit" if kind == "korean" else "rounded"] += 1
            elif derived.has(v, r) or _local_derived(v, r, groups.get(grp, [])):
                counts["derived"] += 1
                derived_items.append([tok, text[:90]])
            else:
                counts["unmatched"] += 1
                unmatched.append([tok, text[:90]])
    return {**counts, "unmatched_items": unmatched[:limit], "derived_items": derived_items[:limit]}


def _local_derived(v: float, r: float, nums: list[float]) -> bool:
    vals = []
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            a, b = nums[i], nums[j]
            vals.append(abs(a - b))
            if a and b:
                vals += [abs((a / b - 1) * 100), abs((b / a - 1) * 100), max(a, b) / min(a, b)]
    return Corpus(vals).has(v, r) if vals else False


# --- style --------------------------------------------------------------------------------------

POLITE = re.compile(r"(습니다|입니다|해요|어요|아요|에요|예요)[.!?]?(?:\s|$)")


def style_warnings(article: dict) -> list[str]:
    hits = []
    for path, text in walk(article):
        if POLITE.search(text):
            hits.append(f"polite ending at {path}: {text[:60]}")
    return hits


# --- briefing-morning/v1 document ---------------------------------------------------------------

STAT = {"type": "object", "required": ["close", "chg_pct"]}
BRIEFING_SCHEMA = {
    "type": "object",
    "required": ["schema", "product", "edition_date", "market_date", "model", "published_kst", "headline", "thesis",
                 "strip_extra", "fx", "story", "bigtech_take", "bigtech_notes", "scene", "movers", "tonight",
                 "yesterday_check", "briefs", "pack"],
    "properties": {
        "schema": {"const": "briefing-morning/v1"},
        "product": {"const": "morning"},
        "edition_date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
        "market_date": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
        "published_kst": {"type": "string", "pattern": r"^\d{2}:\d{2}$"},
        "headline": {"type": "string", "minLength": 4},
        "thesis": {"type": "string", "minLength": 4},
        "fx": {"type": "object", "required": ["usdkrw", "change_won", "basis"]},
        "story": {"type": "object", "required": ["title", "chart_headline", "paragraphs", "why", "annotations"],
                  "properties": {"paragraphs": {"type": "array", "minItems": 1},
                                 "annotations": {"type": "array", "items": {"type": "object", "required": ["series", "time_et", "time_kst", "label"]}}}},
        "movers": {"type": "array", "items": {"type": "object", "required": ["ticker", "name", "reason"]}},
        "pack": {"type": "object", "required": ["session", "indices", "etfs", "bigtech", "sectors", "sectors_up", "intraday", "edge", "edge_week"],
                 "properties": {"indices": {"type": "object", "required": ["S&P 500"], "additionalProperties": STAT},
                                "edge": {"type": "object", "required": ["score", "label", "components"]},
                                "edge_week": {"type": "array", "minItems": 1}}},
    },
}


def briefing_errors(doc: dict) -> list[str]:
    errs = [f"{list(e.path)}: {e.message[:120]}" for e in jsonschema.Draft202012Validator(BRIEFING_SCHEMA).iter_errors(doc)]
    if doc.get("pack", {}).get("session") != doc.get("market_date"):
        errs.append("pack.session != market_date")
    return errs
