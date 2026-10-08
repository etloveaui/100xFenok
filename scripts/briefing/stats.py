"""Attach market stats to mover cards: from the market pack, else fetched for movers the brief names only by company."""
from __future__ import annotations

import logging

import yfinance as yf

from .market_pack import daily_stats

log = logging.getLogger("briefing.stats")
FIELDS = ("close", "chg_pct", "vol_vs_20d", "from_52w_high_pct", "ytd_pct", "streak")


def pick(st: dict) -> dict:
    return {k: st.get(k) for k in FIELDS}


def attach(article: dict, pack: dict, session: str) -> list[str]:
    """Fill `stats` on every mover with a ticker; returns the tickers fetched outside the pack."""
    for m in article.get("movers", []):
        st = pack.get("movers", {}).get(m.get("ticker", ""))
        if st:
            m["stats"] = pick(st)
    need = [m["ticker"] for m in article.get("movers", []) if m.get("ticker") and not m.get("stats")]
    if not need:
        return []
    try:
        d = yf.download(need, period="2y", interval="1d", progress=False, auto_adjust=False)
    except Exception as e:  # noqa: BLE001 - stats are optional decoration
        log.warning("mover stats download failed: %s", str(e)[:160])
        return []
    multi = len(need) > 1
    done = []
    for m in article["movers"]:
        t = m.get("ticker")
        if t not in need:
            continue
        try:
            close = d["Close"][t] if multi else d["Close"].iloc[:, 0]
            vol = d["Volume"][t] if multi else d["Volume"].iloc[:, 0]
        except KeyError:
            continue
        st = daily_stats(close, vol, session)
        if st:
            m["stats"] = pick(st)
            done.append(t)
    return done
