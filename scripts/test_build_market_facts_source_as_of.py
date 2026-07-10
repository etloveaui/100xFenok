#!/usr/bin/env python3
"""Offline smoke for the KPI v2 source_as_of aggregation in build-market-facts.py
(BACKLOG #331). The full build needs network (YF fetch), so we validate the pure
collection-date helpers + the OLDEST/fold semantics against fixture fetched_at values
— the honest test boundary noted in the report."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("bmf", str(Path(__file__).with_name("build-market-facts.py")))
bmf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmf)

# collection_date: real-calendar, date part of a fetched_at timestamp
assert bmf.collection_date("2026-07-09T02:32:56Z") == "2026-07-09"
assert bmf.collection_date("2026-02-31T00:00:00Z") is None, "impossible calendar date rejected"
assert bmf.collection_date("2026-13-01T00:00:00Z") is None, "month 13 rejected"
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

print("test_build_market_facts_source_as_of: ok")
