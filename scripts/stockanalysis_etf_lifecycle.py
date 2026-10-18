#!/usr/bin/env python3
"""Catalogue membership and bounded orphan observations in existing member state."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import re
from pathlib import Path
import subprocess

from yahoo_batch_state import source_business_day_age, verified_yahoo_terminal_evidence
from stockanalysis_recovery_state import _atomic_write_json, _iso_timestamp, _read_json, _valid_payload

ORPHAN_PROBE_LIMIT = 60
ROTATION_POLICY = json.loads((Path(__file__).parent / "lib" / "etf-detail-rotation-policy.json").read_text())
CATALOGUES = {
    "etf_universe": "data/stockanalysis/etf_universe.json",
    "etf_screener": "data/stockanalysis/surfaces/etf_screener.json",
}


def new_fund_tickers(records, now=None):
    """Observe by inception age, not the provider's truncated newest-100 list."""
    today = (now or datetime.now(timezone.utc)).date()
    selected = set()
    for row in records:
        if not isinstance(row, dict):
            continue
        value = row.get("inceptionDate") or row.get("inception")
        if not isinstance(value, str):
            continue
        for fmt in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y"):
            try:
                age = (today - datetime.strptime(value, fmt).date()).days
                if 0 <= age <= ROTATION_POLICY["new_fund_observation_days"]:
                    ticker = str(row.get("ticker") or row.get("s") or "").upper()
                    if ticker:
                        selected.add(ticker)
                break
            except ValueError:
                continue
    return selected



def select_detail_universe(records, *, prior_selected=(), always_include=(), stock_records=(), detail_reader=None, now=None):
    """Owner-approved ETF detail membership; catalogue visibility is unchanged.

    prior_selected must come from the preceding promoted selection, never from
    the legacy all-ETF enrollment. Owner variable values are not logged here.
    """
    rows = {str(row.get("ticker") or row.get("s") or "").upper(): row
            for row in records if isinstance(row, dict)}
    rows.pop("", None)
    def aum(ticker):
        value = rows[ticker].get("aum")
        return value if isinstance(value, (int, float)) and math.isfinite(value) else 0
    prior = set(prior_selected)
    owner = set(always_include) & rows.keys()
    leveraged = {ticker for ticker, row in rows.items()
                 if any((row.get("classification") or {}).get(flag) is True
                        for flag in ("is_leveraged", "is_inverse"))}
    groups = {
        "top_aum": set(sorted(rows, key=lambda ticker: (-aum(ticker), ticker))[:500]),
        "leveraged_aum": {ticker for ticker in leveraged
                          if aum(ticker) >= (5_000_000 if ticker in prior else 10_000_000)},
        "single_stock": {ticker for ticker in leveraged
                         if (rows[ticker].get("classification") or {}).get("is_single_stock") is True},
        "new_fund": new_fund_tickers(records, now),
        "owner": owner,
    }
    selected = set().union(*groups.values())
    def normalized(value):
        value = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
        value = re.sub(r"^(?:the\s+)?(?:adr\s+)?", "", value)
        value = re.sub(r"\s+american depositary shares$", "", value)
        return re.sub(r"\s+(?:incorporated|corporation|company|limited|inc|corp|ltd|plc)$", "", value).strip()
    def etf_name(value):
        return re.sub(r"\s+", " ", re.sub(r"\bindex\b", "", normalized(value))).strip()
    stocks = {}; aliases = {}
    for row in stock_records:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or row.get("symbol") or row.get("Ticker") or "").upper()
        if not ticker:
            continue
        stocks[ticker] = row
        for key in ("name", "company", "company_name", "companyName", "Name", "shortName", "longName"):
            alias = normalized(row.get(key))
            if alias:
                aliases.setdefault(alias, set()).add(ticker)
    pairs = {}; unresolved = []
    index_pairs = ROTATION_POLICY.get("underlying_etfs", {})
    for ticker in sorted(selected & leveraged):
        row = rows[ticker]; classification = row.get("classification") or {}
        underlying = str(classification.get("underlying") or "").strip()
        direct = underlying.upper()
        target = direct if direct in rows or direct in stocks else None
        if target is None:
            matches = aliases.get(normalized(underlying), set())
            if len(matches) == 1:
                target = next(iter(matches))
        detail = (detail_reader(ticker) or {}) if detail_reader else {}
        overview = (detail.get("raw") or {}).get("overview") or {}
        description = str(overview.get("description") or "")
        if description:
            # An explicit provider symbol is evidence even when the price
            # collector has not enrolled that underlying stock yet. Exclude
            # the fund's own introductory symbol and non-security acronyms.
            quoted = re.finditer(r"\((?:(NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|CBOE|AMEX|TICKER)\s*:\s*)?([A-Z][A-Z0-9.-]{0,9})\)", description, re.I)
            matches = set()
            for match in quoted:
                exchange, symbol = match.groups()
                symbol = symbol.upper()
                prefix = description[max(0, match.start() - 60):match.start()]
                stock_name = symbol in re.findall(r"\b[A-Z][A-Z0-9.-]{0,5}\b", str(row.get("name") or "")) and re.search(r"shares of|\bstock\b", description, re.I)
                fund_symbol = symbol in rows and re.search(r"\b(?:ETF|Fund|Trust)\s*$", prefix, re.I)
                if symbol != ticker and (exchange or stock_name or fund_symbol or re.search(r"\bstock\s*$", prefix, re.I)):
                    matches.add(symbol)
            if len(matches) == 1:
                target = next(iter(matches))
        if target is None and description:
            symbols = re.findall(r"\b(?:returns?|performance|movements?|exposure)\s+(?:of|to|on)\s+(?:the\s+)?([A-Z][A-Z0-9.-]{0,9})\b|\b([A-Z][A-Z0-9.-]{0,9})\s+(?:ETF|put|call|options)\b", description)
            matches = {symbol for group in symbols for symbol in group if symbol in rows and symbol != ticker}
            if len(matches) == 1:
                target = next(iter(matches))
        stock_reference = classification.get("is_single_stock") or re.search(r"\bstock\b|shares of|share price", description, re.I)
        if target is None and description:
            name = str(row.get("name") or "")
            candidates = re.findall(r"\b(?:Long|Short)\s+([A-Z][A-Z0-9.-]{0,5})\s+(?:Dail{1,2}y|ETF)\b|\bDail{1,2}y\s+([A-Z][A-Z0-9.-]{0,5})\s+(?:Bull|Bear)\b|\b([A-Z][A-Z0-9.-]{0,5})\s+(?:[1-9](?:\.\d+)?[xX]\s+Daily|WeeklyPay|YieldBOOST)\b", name)
            matches = {symbol for group in candidates for symbol in group if symbol and symbol != ticker}
            if len(matches) == 1:
                target = next(iter(matches))
                # Provider product names often omit the share-class separator.
                canonical = {key for key in stocks if re.sub(r"[^A-Z0-9]", "", key) == target}
                if len(canonical) == 1:
                    target = next(iter(canonical))
        if target is None and description:
            # These portfolios have several simultaneous or changing legs.
            # Single-stock/ETF products must still resolve their explicit leg.
            body = description.replace(f"({ticker})", "")
            single = classification.get("is_single_stock") or re.search(r"single[ -](?:stock|security)|shares of|\bETF\s*\([A-Z]", body, re.I)
            portfolio = re.search(r"long[ /-]+short|long and short|long.{0,180}\band short\b|market[ -]neutral|dollar[ -]neutral|merger arbitrage|managed futures|multi[ -]?(?:asset|strategy)|global macro|risk parity|hedge replication|fund.of.funds.*(?:allocat|toggl)|actively[ -]managed.*(?:portfolio|selection of|diversified|companies|securities|bonds|us equities)|autocallable portfolio|combination of.*equity.*fixed income", str(row.get("name") or "") + " " + body, re.I)
            if portfolio and not single:
                pairs[ticker] = {"ticker": None, "kind": "none", "reason": "no_single_underlying"}
                continue
        if target is None and description:
            text = " " + etf_name(description) + " "
            matches = {candidate for candidate, value in rows.items() if candidate != ticker and
                       etf_name(value.get("name")) and " " + etf_name(value.get("name")) + " " in text}
            if len(matches) == 1:
                target = next(iter(matches))
        if target is None and not classification.get("is_single_stock"):
            text = " " + normalized(underlying + " " + str(row.get("name") or "") + " " + description) + " "
            found = [(len(normalized(key)), value) for key, value in index_pairs.items()
                     if " " + normalized(key) + " " in text and value in rows and value != ticker]
            if found:
                longest = max(length for length, _ in found)
                matches = {value for length, value in found if length == longest}
                if len(matches) == 1:
                    target = next(iter(matches))
        if target is None and description:
            # Fund names in swap holdings identify an ETF exposure without
            # treating Treasury/cash collateral as the underlying.
            holdings = (detail.get("normalized") or {}).get("holdings") or []
            if stock_reference:
                positions = {}
                for holding in holdings:
                    if not isinstance(holding, dict):
                        continue
                    symbol = str(holding.get("symbol") or holding.get("s") or "").lstrip("$#").upper()
                    if symbol not in stocks:
                        continue
                    try:
                        weight = abs(float(str(holding.get("weight_pct", holding.get("as", 0))).replace("%", "").replace(",", "")))
                    except (ValueError, TypeError):
                        continue
                    positions[symbol] = positions.get(symbol, 0) + weight
                if len(positions) == 1 and next(iter(positions.values())) >= 50:
                    target = next(iter(positions))
            symbols = [symbol for h in holdings if isinstance(h, dict)
                       for group in re.findall(r"^([A-Z][A-Z0-9.-]{0,6})\s+SWAP\b|\(([A-Z][A-Z0-9.-]{0,6})\)\s+SWAP\b", str(h.get("name") or ""))
                       for symbol in group if symbol and symbol != ticker and symbol not in {"USD", "ETF", "ETFS"}]
            matches = set(symbols) & rows.keys()
            if target is None and len(matches) == 1:
                target = next(iter(matches))
            swap_names = [normalized(re.split(r"\b(?:swap|cfd|trs)\b", str(h.get("name") or ""), flags=re.I)[0])
                          for h in holdings if isinstance(h, dict) and re.search(r"\b(?:swap|cfd|trs)\b", str(h.get("name") or ""), re.I)]
            matches = {candidate for candidate, value in rows.items() if candidate != ticker and
                       any(normalized(value.get("name")) in name for name in swap_names)
                       and normalized(value.get("name"))}
            if target is None and len(matches) == 1:
                target = next(iter(matches))
        if target and target != ticker:
            pairs[ticker] = {"ticker": target, "kind": "etf" if target in rows else "stock"}
        else:
            unresolved.append(ticker)
    selected.update(pair["ticker"] for pair in pairs.values() if pair["kind"] == "etf")
    daily = owner | {ticker for ticker in leveraged & selected if aum(ticker) >= 500_000_000}
    rotating = selected - daily
    # Capacity growth lengthens rotation; it never rejects a larger universe.
    remaining_per_run = max(1, ROTATION_POLICY["general_limit"] - len(daily))
    interval = max(1, math.ceil(len(rotating) * 7 / (remaining_per_run * len(ROTATION_POLICY["general_weekdays_utc"]))))
    return {"schema_version": "etf-detail-selection/v1", "selected": sorted(selected),
            "daily": sorted(daily), "paired_stocks": sorted({pair["ticker"] for pair in pairs.values() if pair["kind"] == "stock"}),
            "pairs": pairs, "rotation_interval_days": interval,
            "counts": {**{key: len(value) for key, value in groups.items()},
                       "selected": len(selected), "daily": len(daily),
                       "pairs_resolved": sum(pair["kind"] != "none" for pair in pairs.values()),
                       "pairs_no_underlying": sum(pair["kind"] == "none" for pair in pairs.values()),
                       "pairs_unresolved": len(unresolved)}}


def detail_refresh_cadence(root):
    """Publish the same whole-catalogue AUM ranking used by the rotation."""
    root = Path(root)
    selection = _read_json(root / "data/admin/data-supply-state/v1/etf-detail-selection.json")
    if isinstance(selection, dict) and selection.get("schema_version") == "etf-detail-selection/v1":
        return {"schema_version": ROTATION_POLICY["schema_version"],
                "core_tickers": selection["daily"], "tier2_tickers": selection["selected"],
                "new_fund_tickers": [], "rotation_interval_days": selection["rotation_interval_days"]}
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
            "core_tickers": sorted(set(core_tickers) | (set(ROTATION_POLICY["daily_market_watch_tickers"]) & set(aums))),
            "tier2_tickers": ranked[:ROTATION_POLICY["tier2_size"]],
            "new_fund_tickers": sorted(new_fund_tickers(records))}


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
            selection = _read_json(self.root / "data/admin/data-supply-state/v1/etf-detail-selection.json")
            if selection:
                self.detail_tickers &= set(selection["selected"])


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
