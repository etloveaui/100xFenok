#!/usr/bin/env python3
"""Catalogue membership and bounded orphan observations in existing member state."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

from yahoo_batch_state import source_business_day_age, verified_yahoo_terminal_evidence
from stockanalysis_recovery_state import _atomic_write_json, _iso_timestamp, _read_json, _valid_payload

ORPHAN_PROBE_LIMIT = 60
ROTATION_POLICY = json.loads(Path(__file__).with_name("etf_detail_rotation_policy.json").read_text())
CATALOGUES = {
    "etf_universe": "data/stockanalysis/etf_universe.json",
    "etf_screener": "data/stockanalysis/surfaces/etf_screener.json",
}


def detail_refresh_cadence(root):
    """Publish the same whole-catalogue AUM ranking used by the rotation."""
    root = Path(root)
    universe = _read_json(root / CATALOGUES["etf_universe"]) or {}
    core = _read_json(root / "data/admin/fenok-etf-core-daily-basket.json") or {}
    records = universe.get("records")
    core_tickers = (core.get("daily_refresh_universe") or {}).get("tickers")
    if not isinstance(records, list) or not records or not isinstance(core_tickers, list):
        return None
    aums = {str(row.get("ticker") or row.get("s") or "").upper(): row.get("aum")
            for row in records if isinstance(row, dict)
            and isinstance(row.get("aum"), (int, float)) and row["aum"] > 0}
    ranked = sorted(aums, key=lambda ticker: (-aums[ticker], ticker))
    return {"schema_version": ROTATION_POLICY["schema_version"],
            "core_tickers": sorted(set(core_tickers)),
            "tier2_tickers": ranked[:ROTATION_POLICY["tier2_size"]]}


def symbols(payload):
    return {str(row.get("ticker") or row.get("s") or row.get("symbol") or "").upper()
            for row in (payload or {}).get("records", []) if isinstance(row, dict)} - {""}


def automatic_evidence(ticker, state, as_of, *, yahoo=False):
    """A class is not sufficient without the recorded three distinct days."""
    life = (state or {}).get("terminal" if yahoo else "etf_lifecycle") or {}
    if not isinstance(life, dict) or _iso_timestamp(life.get("classified_at")) is None:
        return None
    identity = "ticker" if yahoo else "entity"
    schema = "yahoo-batch-quote-history-state/v1" if yahoo else "stockanalysis-recovery-state/v1"
    if state.get(identity) != ticker or state.get("schema_version") != schema:
        return None
    if yahoo:
        if (state or {}).get("resolution_state") != "terminal_provider_unsupported" or life.get("method") != "automatic_provider_lifecycle":
            return None
        reasons = {"empty_payload", "history_not_advanced"}
    else:
        if life.get("status") != "closed" or life.get("method") != "automatic_provider_absence":
            return None
        reasons = {"provider_absent"}
    attempts = life.get("attempts") or []
    dates = [_iso_timestamp(row.get("observed_at")) for row in attempts if isinstance(row, dict)]
    now = _iso_timestamp(as_of)
    if (now is None or len(dates) != 3 or any(day is None or day > now for day in dates)
        or len({day.date() for day in dates}) != 3
        or any(row.get("reason") not in reasons for row in attempts)
        or (not yahoo and any(row.get("event_name") != "schedule" or row.get("endpoint") != f"/etf/{ticker.lower()}/__data.json" for row in attempts))
        or (state.get("latest_failure") or {}).get("data_loss")):
        return None
    history = life.get("last_history_as_of")
    classified = _iso_timestamp(life["classified_at"])
    history_day = _iso_timestamp(history)
    if classified > now or (not yahoo and classified < max(dates)) or history_day is None or history_day > min(dates):
        return None
    age = source_business_day_age(ticker, history, as_of)
    if age is None or age <= 10:
        return None
    return {"symbol": ticker, "terminal": True, "alias_target": None,
            "source": "automatic_provider_observations", "source_url": f"https://stockanalysis.com/etf/{ticker.lower()}/" if not yahoo else f"https://finance.yahoo.com/quote/{ticker}/history/",
            "effective_date": life["classified_at"][:10], "classified_at": life["classified_at"],
            "reason": "Provider absent or unsupported on three scheduled days; last real history is over ten business days old",
            "last_history_as_of": history, "attempts": attempts}


class Inputs:
    """Use working files for selection, or immutable Git metadata for health."""
    def __init__(self, root, ref=None, *, yahoo_root=None):
        self.root = Path(root)
        self.yahoo_root = Path(yahoo_root) if yahoo_root is not None else self.root
        self.frozen = None
        if ref:
            paths = [*CATALOGUES.values(), "data/stockanalysis/etfs", "data/admin/stockanalysis-recovery/states/etf", "data/admin/yahoo-batch-quote-history/tickers"]
            tree = subprocess.check_output(["git", "-C", str(root), "ls-tree", "-rz", ref, "--", *paths])
            entries = [row.split(b"\t", 1) for row in tree.split(b"\0") if row]
            self.detail_tickers = {path.decode().rsplit("/", 1)[-1][:-5] for _, path in entries if path.decode().startswith("data/stockanalysis/etfs/") and path.endswith(b".json")}
            metadata = [(header.split()[2], path.decode()) for header, path in entries if not path.decode().startswith("data/stockanalysis/etfs/")]
            raw = subprocess.check_output(["git", "-C", str(root), "cat-file", "--batch"], input=b"\n".join(oid for oid, _ in metadata) + b"\n")
            self.frozen = {}; offset = 0
            for oid, path in metadata:
                end = raw.index(b"\n", offset); header = raw[offset:end].split(); size = int(header[2])
                if header[:2] != [oid, b"blob"] or size > 16 * 1024 * 1024:
                    raise ValueError("lifecycle Git metadata identity or size invalid")
                offset = end + 1; self.frozen[path] = json.loads(raw[offset:offset + size]); offset += size + 1
        else:
            self.detail_tickers = {path.stem for path in (self.root / "data/stockanalysis/etfs").glob("*.json")}

    def read(self, path):
        if self.frozen is not None:
            return self.frozen.get(path)
        root = self.yahoo_root if path.startswith("data/admin/yahoo-batch-quote-history/") else self.root
        return _read_json(root / path)


def membership(inputs, as_of):
    catalogues = {name: symbols(inputs.read(path)) for name, path in CATALOGUES.items()}
    if any(not values for values in catalogues.values()):
        raise ValueError("both ETF catalogue sources are required for orphan classification")
    excluded = terminal_evidence(inputs, as_of, inputs.detail_tickers)
    orphans = []; live = []
    for ticker in sorted(inputs.detail_tickers):
        state = inputs.read(f"data/admin/stockanalysis-recovery/states/etf/{ticker}.json") or {}
        if ticker in excluded:
            continue
        missing = [name for name, values in catalogues.items() if ticker not in values]
        if len(missing) != len(catalogues):
            continue
        life = state.get("etf_lifecycle") or {}
        row = {"ticker": ticker, "missing_catalogues": missing,
               "first_seen_at": life.get("first_seen_at"),
               "last_probe_at": life.get("last_probe_at"),
               "probe_days": len({r.get("observed_at", "")[:10] for r in life.get("attempts") or []})}
        (live if life.get("status") == "live" else orphans).append(row)
    return {"detail_count": len(inputs.detail_tickers), "eligible_count": len(inputs.detail_tickers) - len(excluded),
            "exclusions": excluded, "orphans": orphans, "live_catalogue_gaps": live}


def terminal_evidence(inputs, as_of, tickers):
    primary = verified_yahoo_terminal_evidence(as_of)["tickers"]
    result = {}
    for ticker in tickers:
        if ticker in primary:
            result[ticker] = primary[ticker][0]
            continue
        for yahoo, path in [(False, f"data/admin/stockanalysis-recovery/states/etf/{ticker}.json"),
                            (True, f"data/admin/yahoo-batch-quote-history/tickers/{ticker}.json")]:
            state = inputs.read(path) or {}
            if not yahoo and (state.get("etf_lifecycle") or {}).get("status") == "live":
                break
            evidence = automatic_evidence(ticker, state, as_of, yahoo=yahoo)
            if evidence:
                result[ticker] = {**evidence, "evidence_path": path}
                break
    return result


def last_real_history(payload):
    raw = (payload or {}).get("raw") or {}; normalized = (payload or {}).get("normalized") or {}
    # No fetched_at/source stamp fallback: only actual dated price rows.
    rows = [row for owner in (raw, normalized) for series in [owner.get("history"), *((owner.get("history_periods") or {}).values())]
            if isinstance(series, list) for row in series if isinstance(row, dict)]
    fetched = _iso_timestamp((payload or {}).get("fetched_at"))
    dates = [_iso_timestamp(row.get("date") or row.get("t") or row.get("time")) for row in rows]
    valid = [day for day in dates if day is not None and fetched is not None and day <= fetched]
    return max(valid).date().isoformat() if valid else None


def record_probe(store, ticker, result, run, missing_catalogues):
    if run.get("event_name") != "schedule":
        return None
    payload = _read_json(store.canonical_path("etf", ticker))
    state = store._load_state("etf", ticker)
    life = state.get("etf_lifecycle") or {}
    now = run["observed_at"]
    life = {**life, "first_seen_at": life.get("first_seen_at") or now,
            "last_probe_at": now, "missing_catalogues": missing_catalogues,
            "last_history_as_of": last_real_history(payload)}
    valid_return = (result.get("canonical_write") is True and result.get("provider") == "stockanalysis"
                    and result.get("error") is None and _valid_payload("etf", ticker, payload))
    # A holdings/history/quote endpoint failure cannot establish disappearance.
    absent = (result.get("provider_availability_status") == "absent"
              and result.get("provider_availability_reason") == "provider_coverage_gap"
              and result.get("provider_absence_endpoint") == f"/etf/{ticker.lower()}/__data.json")
    if valid_return:
        state = store.record_success("etf", ticker, payload, run, prevalidated_etf=True)
        life.update(status="live", method="valid_provider_detail", attempts=[], returned_at=now)
    else:
        attempts = [row for row in life.get("attempts") or [] if row["observed_at"][:10] != now[:10]] if absent else []
        if absent:
            attempts.append({"observed_at": now, "reason": "provider_absent", "response": result.get("provider_response"),
                             "event_name": "schedule", "endpoint": result["provider_absence_endpoint"]})
        life.update(status="unresolved", attempts=attempts[-3:])
        age = source_business_day_age(ticker, life["last_history_as_of"], now)
        if len(life["attempts"]) == 3 and age is not None and age > 10 and not (state.get("latest_failure") or {}).get("data_loss"):
            life.update(status="closed", method="automatic_provider_absence", classified_at=now, history_business_days=age)
            state["retry"] = False
    state.update(schema_version="stockanalysis-recovery-state/v1", artifact_kind="etf", entity=ticker,
                 etf_lifecycle=life)
    _atomic_write_json(store._state_path("etf", ticker), state)
    return life


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--git-ref")
    parser.add_argument("--as-of", default=datetime.now(timezone.utc).isoformat())
    args = parser.parse_args()
    print(json.dumps(membership(Inputs(args.root, args.git_ref), args.as_of)))
