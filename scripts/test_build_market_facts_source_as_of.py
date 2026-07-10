#!/usr/bin/env python3
"""Offline smoke for the KPI v2 source_as_of aggregation in build-market-facts.py
(BACKLOG #331). The full build needs network (YF fetch), so we validate the pure
collection-date helpers + the OLDEST/fold semantics against fixture fetched_at values
— the honest test boundary noted in the report."""
import importlib.util
import json
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location("bmf", str(Path(__file__).with_name("build-market-facts.py")))
bmf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmf)

# collection_date: real-calendar, date part of a fetched_at timestamp
assert bmf.collection_date("2026-07-09T02:32:56Z") == "2026-07-09"
assert bmf.collection_date("2026-02-31T00:00:00Z") is None, "impossible calendar date rejected"
assert bmf.collection_date("2026-13-01T00:00:00Z") is None, "month 13 rejected"
assert bmf.collection_date("2026-07-09junk") is None, "trailing junk rejected"
assert bmf.collection_date("2099-01-01T00:00:00Z") is None, "future collection date rejected"
assert bmf.collection_date(123) is None
assert bmf.collection_date(None) is None

# OLDEST over a ticker set's fetched_at dates (what stock_detail verifies)
facts = [
    {"price": {"fetched_at": "2026-07-09T02:32:56Z"}, "prev": {"fetched_at": "2026-07-08T02:00:00Z"}},
    {"price": {"fetched_at": "2026-07-05T01:00:00Z"}},
]
dates = [bmf.collection_date(f.get("fetched_at")) for t in facts for f in t.values()]
assert min(d for d in dates if d) == "2026-07-05", "OLDEST fetched_at across the ticker set"

# fail-closed: any invalid input -> None
assert bmf.oldest_collection_date(["2026-07-09", "garbage"]) is None
assert bmf.oldest_collection_date(["2026-07-09T00:00Z", "2026-07-01"]) == "2026-07-01"
assert bmf.oldest_collection_date([]) is None

# Two-stamp split: core service denominator drives SLA; full floor stays diagnostic.
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    rows = [{"ticker": "AAA"}, {"ticker": "BBB"}, {"ticker": "ZZZ"}]
    payloads = {
        "AAA": {"facts": {"price": {"fetched_at": "2026-07-09T00:00:00Z"}}},
        "BBB": {"facts": {"price": {"fetched_at": "2026-07-08T00:00:00Z"}}},
        "ZZZ": {"facts": {"price": {"fetched_at": "2026-06-17T00:00:00Z"}}},
    }
    for ticker, payload in payloads.items():
        (root / f"{ticker}.json").write_text(json.dumps(payload), encoding="utf-8")
    stamps = bmf.market_fact_source_stamps(rows, {"AAA", "BBB"}, root)
    assert stamps["core_surface_source_as_of"] == "2026-07-08"
    assert stamps["full_universe_floor_as_of"] == "2026-06-17"
    assert stamps["source_stamp_diagnostics"]["core_price_stamped_count"] == 2
    assert bmf.market_fact_source_stamps(rows, {"MISSING"}, root)["core_surface_source_as_of"] is None
    assert bmf.market_fact_source_stamps([None], {"AAA"}, root)["source_stamp_diagnostics"]["status"] == "invalid_index_rows"

# Exact denominator artifact shape: malformed rows/tickers fail closed rather than
# silently shrinking the service universe.
with tempfile.TemporaryDirectory() as tmp:
    original_data = bmf.DATA
    try:
        bmf.DATA = Path(tmp)
        (bmf.DATA / "computed").mkdir(parents=True)
        (bmf.DATA / "admin").mkdir(parents=True)
        stock_path = bmf.DATA / "computed" / "stock_action_index.json"
        etf_path = bmf.DATA / "admin" / "fenok-etf-core-daily-basket.json"
        stock_path.write_text(json.dumps({"rows": [{"symbol": "AAA"}]}), encoding="utf-8")
        etf_path.write_text(json.dumps({"daily_refresh_universe": {"tickers": ["BBB"]}}), encoding="utf-8")
        assert bmf.load_core_surface_members() == {"AAA", "BBB"}
        stock_path.write_text(json.dumps({"rows": [{"symbol": "AAA"}, None]}), encoding="utf-8")
        assert bmf.load_core_surface_members() is None
        stock_path.write_text(json.dumps({"rows": [{"symbol": "AAA"}]}), encoding="utf-8")
        etf_path.write_text(json.dumps({"daily_refresh_universe": {"tickers": [123]}}), encoding="utf-8")
        assert bmf.load_core_surface_members() is None
    finally:
        bmf.DATA = original_data

print("test_build_market_facts_source_as_of: ok")
