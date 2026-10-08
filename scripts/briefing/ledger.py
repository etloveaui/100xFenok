"""Plan-credit spend ledger for the 100x briefing job.

Every Claude API call appends one JSON line to ~/.local/state/100x-briefing/usage.jsonl:
{"date", "ts", "model", "purpose", "input_tokens", "output_tokens", "cache_creation_input_tokens",
 "cache_read_input_tokens", "usd", "seconds", "stop_reason", "request_id"}

python -m briefing.ledger [--since YYYY-MM-DD]   prints totals by model, purpose and date (prices from config.json).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .common import CFG, now_kst, state_path


def usage_path() -> Path:
    return state_path(CFG["state"]["usage"])


def price(model: str, usage: dict) -> float:
    p = CFG["prices_usd_per_mtok"].get(model)
    if not p:
        return 0.0
    return round((usage.get("input_tokens", 0) * p["input"] + usage.get("output_tokens", 0) * p["output"]
                  + (usage.get("cache_creation_input_tokens") or 0) * p["cache_write"]
                  + (usage.get("cache_read_input_tokens") or 0) * p["cache_read"]) / 1e6, 4)


def append(model: str, purpose: str, usage: dict, edition: str, **extra) -> dict:
    row = {"date": edition, "ts": now_kst().isoformat(timespec="seconds"), "model": model, "purpose": purpose,
           **{k: usage.get(k) or 0 for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")},
           "usd": price(model, usage), **extra}
    with usage_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def read(path: Path | None = None) -> list[dict]:
    p = path or usage_path()
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def totals(rows: list[dict]) -> dict:
    out = {"calls": len(rows), "total_usd": 0.0, "by_model": {}, "by_purpose": {}, "by_date": {}}
    for r in rows:
        usd = price(r["model"], r)  # reprice from config so a price fix applies to history
        out["total_usd"] += usd
        for key, name in (("by_model", r["model"]), ("by_purpose", r.get("purpose", "")), ("by_date", r.get("date", ""))):
            out[key][name] = round(out[key].get(name, 0.0) + usd, 4)
    out["total_usd"] = round(out["total_usd"], 4)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since")
    ap.add_argument("--path")
    a = ap.parse_args()
    rows = read(Path(a.path) if a.path else None)
    if a.since:
        rows = [r for r in rows if r.get("date", "") >= a.since]
    print(json.dumps(totals(rows), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
