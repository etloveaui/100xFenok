"""Shared helpers: config, clocks, HTTP, FRED and state paths."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import tempfile
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


def http_get(url: str, headers: dict | None = None, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": CFG["sources"]["user_agent"], **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def fetch_fred(sid: str, start: str) -> list[tuple[str, float]]:
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
    rows = list(csv.reader(io.StringIO(http_get(src["fred_csv"].format(sid=sid, start=start)))))
    for row in rows[1:]:
        if len(row) == 2 and row[1] not in ("", "."):
            out.append((row[0], float(row[1])))
    return out


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
