"""US-session market pack: every number the writer cannot get from the AA brief, computed by code.

Sources: Yahoo via yfinance (daily and 5-minute), US Treasury par curve, FRED DGS10, Finviz breadth
(latest session only), Nasdaq earnings and economic calendars.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re

import pandas as pd
import yfinance as yf

from .common import CFG, et_to_kst, fetch_fred, http_get

log = logging.getLogger("briefing.market_pack")
MKT = CFG["market"]
SRC = CFG["sources"]


# --- US trading calendar (NYSE full-day holidays) ---------------------------------------------

def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(weekday - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> dt.date:
    d = dt.date(year, month + 1, 1) - dt.timedelta(days=1) if month < 12 else dt.date(year, 12, 31)
    return d - dt.timedelta(days=(d.weekday() - weekday) % 7)


def _easter(year: int) -> dt.date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = ((h + l_ - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def _observed(d: dt.date) -> dt.date:
    if d.weekday() == 5:
        return d - dt.timedelta(days=1)
    if d.weekday() == 6:
        return d + dt.timedelta(days=1)
    return d


def nyse_holidays(year: int) -> set[dt.date]:
    jan1 = dt.date(year, 1, 1)
    days = {
        _nth_weekday(year, 1, 0, 3), _nth_weekday(year, 2, 0, 3), _easter(year) - dt.timedelta(days=2),
        _last_weekday(year, 5, 0), _observed(dt.date(year, 6, 19)), _observed(dt.date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1), _nth_weekday(year, 11, 3, 4), _observed(dt.date(year, 12, 25)),
    }
    if jan1.weekday() != 5:  # a Saturday New Year's Day is not observed on Dec 31
        days.add(_observed(jan1))
    return days


def is_us_trading_day(d: dt.date) -> bool:
    if d.weekday() >= 5 or d.isoformat() in MKT["extra_closed_dates"]:
        return False
    return d not in nyse_holidays(d.year)


def session_for_edition(edition: dt.date) -> dt.date | None:
    """The US session an edition reviews: the ET calendar day before the KST edition date, if it traded."""
    s = edition - dt.timedelta(days=1)
    return s if is_us_trading_day(s) else None


def next_trading_day(d: dt.date) -> dt.date:
    n = d + dt.timedelta(days=1)
    while not is_us_trading_day(n):
        n += dt.timedelta(days=1)
    return n


# --- price statistics ---------------------------------------------------------------------------

def daily_stats(close: pd.Series, vol: pd.Series | None, session: str, long_close: pd.Series | None = None):
    s = close.dropna()
    s = s[s.index.strftime("%Y-%m-%d") <= session]
    if len(s) < 3 or s.index[-1].strftime("%Y-%m-%d") != session:
        return None
    c, p = float(s.iloc[-1]), float(s.iloc[-2])
    out = {"close": round(c, 2), "chg_pct": round((c / p - 1) * 100, 2), "prev_date": s.index[-2].strftime("%Y-%m-%d"),
           "spark20": [round(float(x), 2) for x in s.iloc[-20:].values]}
    diffs = s.diff().dropna()
    sign = 1 if diffs.iloc[-1] > 0 else -1
    streak = 0
    for d in reversed(diffs.values):
        if (d > 0 and sign > 0) or (d < 0 and sign < 0):
            streak += 1
        else:
            break
    out["streak"] = streak * sign
    yr = s[s.index >= s.index[-1] - pd.Timedelta(days=365)]
    out["high_52w"], out["low_52w"] = round(float(yr.max()), 2), round(float(yr.min()), 2)
    out["from_52w_high_pct"] = round((c / yr.max() - 1) * 100, 2)
    prev_year = s[s.index.year == s.index[-1].year - 1]
    if len(prev_year):
        out["ytd_pct"] = round((c / float(prev_year.iloc[-1]) - 1) * 100, 2)
    for n in (50, 200):
        if len(s) >= n:
            out[f"vs_sma{n}_pct"] = round((c / float(s.iloc[-n:].mean()) - 1) * 100, 2)
    if vol is not None:
        v = vol.dropna()
        v = v[v.index.strftime("%Y-%m-%d") <= session]
        if len(v) > 21 and v.iloc[-21:-1].mean() > 0:
            out["vol_vs_20d"] = round(float(v.iloc[-1] / v.iloc[-21:-1].mean()), 2)
    if long_close is not None:
        lc = long_close.dropna()
        lc = lc[lc.index.strftime("%Y-%m-%d") <= session]
        out["record_close"], out["record_date"] = round(float(lc.max()), 2), lc.idxmax().strftime("%Y-%m-%d")
        out["from_record_pct"] = round((c / lc.max() - 1) * 100, 2)
    return out


def _col(df: pd.DataFrame, field: str, sym: str, multi: bool) -> pd.Series:
    return df[field][sym] if multi else (df[field].iloc[:, 0] if isinstance(df[field], pd.DataFrame) else df[field])


def intraday(sym: str, session: str):
    nxt = (dt.date.fromisoformat(session) + dt.timedelta(days=1)).isoformat()
    df = yf.download(sym, start=session, end=nxt, interval="5m", progress=False, auto_adjust=False)
    if df.empty:
        return None
    close = _col(df, "Close", sym, False)
    close.index = close.index.tz_convert(CFG["clock"]["et"])
    day = close[close.index.strftime("%Y-%m-%d") == session].dropna()
    if day.empty:
        return None
    hi_t, lo_t = day.idxmax(), day.idxmin()
    return {"open": round(float(day.iloc[0]), 3), "close": round(float(day.iloc[-1]), 3),
            "high": round(float(day.max()), 3), "high_time": hi_t.strftime("%H:%M"),
            "low": round(float(day.min()), 3), "low_time": lo_t.strftime("%H:%M"),
            "points": [[t.strftime("%H:%M"), round(float(v), 3)] for t, v in day.items()]}


def finviz_breadth() -> dict:
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", http_get(SRC["finviz"])))
    out = {}
    for key, pat in (("advancing", r"Advancing [\d.]+% \((\d+)\)"), ("declining", r"Declining \((\d+)\)"),
                     ("new_high", r"New High [\d.]+% \((\d+)\)"), ("new_low", r"New Low \((\d+)\)")):
        m = re.search(pat, text)
        if m:
            out[key] = int(m.group(1).replace(",", ""))
    if not out:
        raise RuntimeError("finviz breadth not found on the home page")
    return out


def _nasdaq(path: str) -> dict:
    return json.loads(http_get(SRC["nasdaq_api"] + path, SRC["nasdaq_headers"]))


def calendar(next_day: str) -> dict:
    """Next-session earnings and US economic events; event times are ET and get a KST twin."""
    out: dict = {"earnings": [], "economic": []}
    try:
        rows = (_nasdaq(f"calendar/earnings?date={next_day}").get("data") or {}).get("rows") or []
        big = sorted(rows, key=lambda r: -float(re.sub(r"[^\d.]", "", r.get("marketCap") or "0") or 0))[:MKT["earnings_limit"]]
        out["earnings"] = [{"symbol": r.get("symbol"), "name": r.get("name"), "time": r.get("time"), "eps_forecast": r.get("epsForecast"),
                            "market_cap": r.get("marketCap")} for r in big]
    except Exception as e:  # noqa: BLE001
        out["earnings_error"] = str(e)[:120]
    try:
        shifted = (dt.date.fromisoformat(next_day) + dt.timedelta(days=1)).isoformat()  # this endpoint returns D-1 events
        rows = (_nasdaq(f"calendar/economicevents?date={shifted}").get("data") or {}).get("rows") or []
        econ = []
        for r in rows:
            if not (r.get("country") or "").lower().startswith("united states"):
                continue
            t = (r.get("gmt") or "").strip()
            ev = {"time": t, "country": r.get("country"), "event": r.get("eventName"), "consensus": r.get("consensus"), "previous": r.get("previous")}
            if re.fullmatch(r"\d{1,2}:\d{2}", t):
                ev["kst"] = et_to_kst(next_day, t)
            econ.append(ev)
        out["economic"] = econ[:MKT["economic_limit"]]
    except Exception as e:  # noqa: BLE001
        out["economic_error"] = str(e)[:120]
    return out


def brief_tickers(brief: str, cards: list) -> list[str]:
    tks = set(re.findall(r"\b([A-Z]{2,5})\s*(?:\$[\d.,]+\s*)?\([+-]", brief))
    for c in cards:
        tks.update(re.findall(r"\b[A-Z]{2,5}\b", " ".join([c.get("headline", "")] + list(c.get("facts", [])))))
    stop = set(MKT["ticker_stopwords"])
    return sorted(t for t in tks if t not in stop)


def _rates(session: str, dgs: list) -> dict:
    """10Y/2Y/30Y for the session: Treasury par curve, or Yahoo ^TNX/^TYX closes before Treasury posts."""
    y = {}
    source = ""
    try:
        csv_text = http_get(SRC["treasury_csv"].format(year=session[:4]))
        rows = [r.split(",") for r in csv_text.strip().splitlines()]
        head = [h.strip('"') for h in rows[0]]
        tr = {dt.datetime.strptime(r[0].strip('"'), "%m/%d/%Y").date().isoformat(): r for r in rows[1:]}
        r = tr.get(session)
        if r:
            y = {"us10y": float(r[head.index("10 Yr")]), "us2y": float(r[head.index("2 Yr")]), "us30y": float(r[head.index("30 Yr")])}
            source = "US Treasury daily par yield curve; FRED DGS10 history"
    except Exception as e:  # noqa: BLE001
        log.warning("treasury curve unavailable: %s", str(e)[:120])
    if not y:
        fb = MKT["rate_fallback"]
        d = yf.download(list(fb.values()), period="1mo", interval="1d", progress=False, auto_adjust=False)["Close"]
        for k, sym in fb.items():
            s = d[sym].dropna()
            s = s[s.index.strftime("%Y-%m-%d") == session]
            if len(s):
                y[k] = round(float(s.iloc[-1]), 3)
        if "us10y" not in y:
            raise RuntimeError("no 10-year yield for the session")
        source = "Yahoo ^TNX/^TYX close (Treasury curve not yet posted); FRED DGS10 history"
    y10 = y["us10y"]
    prev = [d for d in dgs if d[0] < session]
    since = next((d for d, v in reversed(prev) if v >= y10), None)
    yr = [d for d in dgs if d[0] >= (dt.date.fromisoformat(session) - dt.timedelta(days=365)).isoformat()]
    hi_d, hi_v = max(yr, key=lambda x: x[1])
    hi_since = next((d for d, v in reversed([x for x in dgs if x[0] < hi_d]) if v >= hi_v), None)
    return {"us10y_1y_high_close": hi_v, "us10y_1y_high_date": hi_d, "us10y_1y_high_was_highest_close_since": hi_since, **y,
            "us10y_prev": prev[-1][1], "us10y_close_highest_since": since, "source": source}


def build_pack(session: str, brief: str, cards: list, sec_known: set[str], breadth: bool = True) -> dict:
    movers = [t for t in brief_tickers(brief, cards) if t in sec_known]
    pack: dict = {"session": session, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sources": []}
    idx_syms = list(MKT["indices"])
    idx_long = yf.download(idx_syms, period="max", interval="1d", progress=False, auto_adjust=False)
    pack["indices"] = {}
    for sym, name in MKT["indices"].items():
        st = daily_stats(idx_long["Close"][sym], None, session, long_close=idx_long["Close"][sym])
        if st:
            pack["indices"][name] = {"symbol": sym, **st}
    if "S&P 500" not in pack["indices"]:
        raise RuntimeError(f"no S&P 500 daily close for session {session}")
    syms = list(dict.fromkeys(list(MKT["etfs"]) + list(MKT["sectors"]) + list(MKT["bigtech"]) + movers))
    d2 = yf.download(syms, period="2y", interval="1d", progress=False, auto_adjust=False)

    def stats(sym):
        if sym not in d2["Close"]:
            return None
        return daily_stats(d2["Close"][sym], d2["Volume"][sym], session)

    pack["etfs"] = {n: {"symbol": s, **st} for s, n in MKT["etfs"].items() if (st := stats(s))}
    pack["bigtech"] = {s: {"name": n, **st} for s, n in MKT["bigtech"].items() if (st := stats(s))}
    sect = {n: {"symbol": s, **st} for s, n in MKT["sectors"].items() if (st := stats(s))}
    pack["sectors"] = dict(sorted(sect.items(), key=lambda kv: -kv[1]["chg_pct"]))
    pack["sectors_up"] = sum(1 for v in sect.values() if v["chg_pct"] > 0)
    mv = {s: st for s in movers if (st := stats(s))}
    pack["movers"] = dict(sorted(mv.items(), key=lambda kv: -abs(kv[1]["chg_pct"])))
    pack["sources"].append("Yahoo Finance via yfinance (daily, 5-minute)")
    pack["intraday"] = {k: intraday(s, session) for k, s in MKT["intraday"].items()}

    dgs = fetch_fred(CFG["edge"]["rate_series"], "1990-01-01")
    try:
        pack["rates"] = _rates(session, dgs)
        pack["sources"].append(pack["rates"]["source"])
    except Exception as e:  # noqa: BLE001
        pack["rates_error"] = str(e)[:160]
    try:
        if not breadth:
            raise RuntimeError("historical session: Finviz breadth covers only the latest session")
        pack["breadth"] = finviz_breadth()
        pack["sources"].append("Finviz home page breadth (NYSE+Nasdaq+AMEX)")
    except Exception as e:  # noqa: BLE001
        pack["breadth_error"] = str(e)[:120]
    next_day = next_trading_day(dt.date.fromisoformat(session)).isoformat()
    pack["calendar_next_session"] = {"date": next_day, **calendar(next_day)}
    pack["sources"].append("Nasdaq earnings and economic calendar API")
    return pack


def summary(pack: dict) -> dict:
    return {"indices": list(pack["indices"]), "etfs": len(pack["etfs"]), "sectors": len(pack["sectors"]), "sectors_up": pack["sectors_up"],
            "movers": len(pack["movers"]), "intraday": {k: (v or {}).get("low_time") for k, v in pack["intraday"].items()},
            "rates": pack.get("rates", {}).get("us10y", pack.get("rates_error")), "breadth": pack.get("breadth", pack.get("breadth_error")),
            "earnings": len(pack["calendar_next_session"]["earnings"]), "economic": len(pack["calendar_next_session"]["economic"])}
