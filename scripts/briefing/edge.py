"""100x 시장 체력 (Fenok Edge) for the reviewed session, with the formula of 100xfenok-next.

score  = 0.45 * F&G/100 + 0.35 * (sector ETFs up / 11) + 0.20 * (1 - stress)
stress = 0.8 * clamp((HY spread - 2.5) / 3.5) + 0.2 * clamp(|10Y - mean(last 20 10Y)| / 0.8)
Weights, spans and label cut-offs live in config.json ("edge").

F&G is the value the AA 06:00 run used (its prompt file); the 100x CNN history is the fallback.
"""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from .common import CFG, fetch_fred, read_json

E = CFG["edge"]


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def label(score: float) -> str:
    for cut, name in E["labels"]:
        if score >= cut:
            return name
    return E["labels"][-1][1]


def fear_greed(aa_prompt: Path | None, fg_history: Path, session: str) -> tuple[float, str]:
    """(value, source) - AA 06:00 prompt value first, then the latest 100x CNN row on or before the session."""
    if aa_prompt and aa_prompt.exists():
        m = re.search(CFG["aa"]["fear_greed_pattern"], aa_prompt.read_text(encoding="utf-8", errors="replace"))
        if m:
            return float(m.group(1)), f"AA 06:00 snapshot ({aa_prompt.name})"
    rows = [r for r in (read_json(fg_history, []) or []) if r.get("date", "") <= session and r.get("score") is not None]
    if not rows:
        raise RuntimeError("no Fear & Greed value from AA or 100x history")
    return float(rows[-1]["score"]), f"100x CNN Fear & Greed history ({rows[-1]['date']})"


def compute(session: str, fg: float, fg_source: str, sector_chg: dict[str, float], us10y_session: float | None,
            hy: list | None = None, d10: list | None = None) -> dict:
    start = (dt.date.fromisoformat(session) - dt.timedelta(days=60)).isoformat()
    hy = hy if hy is not None else fetch_fred(E["hy_series"], start)
    d10 = d10 if d10 is not None else fetch_fred(E["rate_series"], start)
    st, w = E["stress"], E["weights"]
    n_sect = len(CFG["market"]["sectors"])
    up = sum(1 for v in sector_chg.values() if v > 0)
    h = [v for d, v in hy if d <= session][-1]
    tens = [v for d, v in d10 if d <= session]
    if us10y_session is not None and not any(d == session for d, _ in d10):
        tens.append(us10y_session)
    win = tens[-st["rate_window"]:]
    ten, avg = tens[-1], sum(win) / len(win)
    stress = round(st["hy_weight"] * clamp((h - st["hy_floor"]) / st["hy_span"]) + st["rate_weight"] * clamp(abs(ten - avg) / st["rate_span"]), 2)
    score = clamp(fg / 100 * w["fear_greed"] + up / n_sect * w["breadth"] + (1 - stress) * w["calm"])
    return {"session": session, "score": round(score * 100), "label": label(score), "fear_greed": fg, "fear_greed_source": fg_source,
            "sectors_up": up, "breadth_pct": round(up / n_sect * 100), "stress": stress, "hy_spread": h, "us10y": ten,
            "us10y_avg20": round(avg, 3),
            "components": {"투자 심리": round(fg), "섹터 확산": round(up / n_sect * 100), "스트레스 완화": round((1 - stress) * 100)},
            "formula": E["formula"]}


def with_history(edge: dict, index: dict | None) -> tuple[dict, list]:
    """Add prev_score/prev_session from published editions and build the 7-session strip (oldest first)."""
    session = edge["session"]
    past = {}
    for e in (index or {}).get("editions", []):
        if e.get("product") == "morning" and e.get("market_date", "") < session and (e.get("edge") or {}).get("score") is not None:
            past[e["market_date"]] = {"session": e["market_date"], "score": e["edge"]["score"], "label": e["edge"]["label"]}
    week = [past[k] for k in sorted(past)] + [{"session": session, "score": edge["score"], "label": edge["label"]}]
    week = week[-E["week_len"]:]
    out = dict(edge)
    if past:
        last = past[max(past)]
        out["prev_score"], out["prev_session"] = last["score"], last["session"]
    return out, week
