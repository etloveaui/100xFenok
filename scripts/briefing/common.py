"""Shared helpers: config, clocks, HTTP, FRED and state paths."""
from __future__ import annotations

import csv
import datetime as dt
import io
import http.client
import json
import logging
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

PKG_DIR = Path(__file__).resolve().parent
CONFIG_PATH = PKG_DIR / "config.json"


def load_config(path: str | Path | None = None) -> dict:
    return json.loads(Path(path or CONFIG_PATH).read_text(encoding="utf-8"))


CFG = load_config()
KST = ZoneInfo(CFG["clock"]["kst"])
ET = ZoneInfo(CFG["clock"]["et"])


def expand(p: str | Path) -> Path:
    return Path(os.path.expanduser(str(p)))


def now_kst() -> dt.datetime:
    return dt.datetime.now(KST)


def et_to_kst(day: str, hhmm: str) -> str:
    """Convert an ET wall-clock time on `day` (YYYY-MM-DD) to KST "HH:MM" with the real DST rules."""
    h, m = (int(x) for x in hhmm.split(":"))
    t = dt.datetime.combine(dt.date.fromisoformat(day), dt.time(h, m), tzinfo=ET)
    return t.astimezone(KST).strftime("%H:%M")


def kst_minus_et_hours(day: str) -> int:
    """KST - ET offset in hours at noon ET of `day` (13 under US daylight saving time, 14 otherwise)."""
    t = dt.datetime.combine(dt.date.fromisoformat(day), dt.time(12, 0), tzinfo=ET)
    return int((t.astimezone(KST).utcoffset() - t.utcoffset()).total_seconds() // 3600)


HTTP_RETRY_DELAYS = (2, 6)  # seconds to wait before the 2nd and 3rd attempt; a hiccup at one source must not cost the edition
_RETRY_STATUS = (429, 500, 502, 503, 504)


def _transient(e: Exception) -> bool:
    if isinstance(e, urllib.error.HTTPError):
        return e.code in _RETRY_STATUS
    return isinstance(e, (TimeoutError, urllib.error.URLError, ConnectionError, http.client.HTTPException))


def http_get(url: str, headers: dict | None = None, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": CFG["sources"]["user_agent"], **(headers or {})})
    for delay in (*HTTP_RETRY_DELAYS, None):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - only network hiccups and 429/5xx are retried
            if delay is None or not _transient(e):
                raise
            logging.getLogger("briefing.http").warning("GET %s failed (%s: %s); retrying in %ds",
                                                      url.split("?")[0], type(e).__name__, e, delay)
            time.sleep(delay)


FRED_FALLBACK: dict[str, str] = {}  # series id -> last observation date, for series served from the stored 100x copy in this run
_fred_down = False  # set by the first failed live read: later series in the same run go straight to the stored copy


def _fetch_fred_live(sid: str, start: str) -> list[tuple[str, float]]:
    """Daily observations (date, value) from `start`; FRED API with key, CSV download otherwise."""
    src = CFG["sources"]
    key = os.environ.get(src["fred_api_key_env"], "").strip()
    out: list[tuple[str, float]] = []
    if key:
        q = urllib.parse.urlencode({"series_id": sid, "api_key": key, "file_type": "json", "observation_start": start})
        try:
            data = json.loads(http_get(f"{src['fred_api']}?{q}"))
            for o in data.get("observations", []):
                if o.get("value") not in (None, "", "."):
                    out.append((o["date"], float(o["value"])))
            return out
        except Exception:  # noqa: BLE001 - fall back to the public CSV
            out = []
    text = http_get(src["fred_csv"].format(sid=sid, start=start))
    if text.lstrip().startswith("<"):
        raise RuntimeError("FRED returned a web page instead of data (site maintenance)")
    rows = list(csv.reader(io.StringIO(text)))
    for row in rows[1:]:
        if len(row) == 2 and row[1] not in ("", "."):
            out.append((row[0], float(row[1])))
    return out


def _treasury_10y_after(last: str) -> list[tuple[str, float]]:
    """10 Yr par yield after `last`: the same numbers as FRED DGS10, posted by the Treasury the same evening."""
    out: list[tuple[str, float]] = []
    for year in range(int(last[:4]), now_kst().year + 1):
        rows = list(csv.reader(io.StringIO(http_get(CFG["sources"]["treasury_csv"].format(year=year), timeout=60))))
        i = rows[0].index("10 Yr")
        for r in rows[1:]:
            if len(r) > i and r[i] not in ("", "N/A"):
                d = dt.datetime.strptime(r[0], "%m/%d/%Y").date().isoformat()
                if d > last:
                    out.append((d, float(r[i])))
    return sorted(out)


def _fetch_fred_stored(sid: str, start: str) -> list[tuple[str, float]]:
    """Stored copy of the series on the 100x site (macro/fred-banking-daily.json), topped up with Treasury days for DGS10."""
    data = json.loads(http_get(CFG["site"]["base_url"] + CFG["sources"]["fred_stored_path"], timeout=90))
    obs = (data.get("series") or {}).get(sid)
    out = [(o["date"], float(o["value"])) for o in obs or [] if o.get("date", "") >= start and o.get("value") not in (None, "", ".")]
    if not out:
        raise KeyError(f"{sid} is not in the stored 100x copy")
    if sid == CFG["edge"]["rate_series"]:
        out += _treasury_10y_after(out[-1][0])
    FRED_FALLBACK[sid] = out[-1][0]
    return out


def fetch_fred(sid: str, start: str) -> list[tuple[str, float]]:
    """Daily observations (date, value) from `start`; the stored 100x copy when FRED itself is down."""
    global _fred_down
    log = logging.getLogger("briefing.http")
    if not _fred_down:
        try:
            return _fetch_fred_live(sid, start)
        except Exception as e:  # noqa: BLE001
            _fred_down = True
            log.warning("FRED %s unavailable (%s: %s); using the stored 100x copy", sid, type(e).__name__, e)
            err = e
    else:
        err = RuntimeError("FRED already failed in this run")
    try:
        return _fetch_fred_stored(sid, start)
    except Exception as e2:  # noqa: BLE001
        raise RuntimeError(f"FRED {sid} unavailable ({type(err).__name__}: {err}) and the stored 100x copy failed ({type(e2).__name__}: {e2})") from e2


def state_path(*parts: str) -> Path:
    p = expand(CFG["state"]["dir"]).joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def write_json(path: Path, obj, indent: int | None = 1) -> None:
    """Atomic JSON write (temp file + rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    seps = (",", ":") if indent is None else None
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent, separators=seps)
        f.write("\n")
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
