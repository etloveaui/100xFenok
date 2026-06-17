#!/usr/bin/env python3
"""Fixture smoke checks for the StockAnalysis financial statement probe."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "scripts" / "probe-stockanalysis-financials.py"
FIXTURE_PATH = ROOT / "scripts" / "fixtures" / "stockanalysis" / "aapl_income_annual__data.fixture.json"


def load_probe_module():
    spec = importlib.util.spec_from_file_location("stockanalysis_financials_probe", PROBE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load probe module from {PROBE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main() -> None:
    probe = load_probe_module()
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    decoded = probe.extract_node(payload)
    normalized = probe.normalize_statement("AAPL", "income", decoded)

    assert_equal(normalized["ticker"], "AAPL", "ticker")
    assert_equal(normalized["statement"], "Income Statement", "statement")
    assert_equal(normalized["period"], "annual", "period")
    assert_equal(normalized["periods"], ["2025-09-27", "2024-09-28"], "periods")
    assert_equal(normalized["fiscal_years"], [2025, 2024], "fiscal years")
    assert_equal(normalized["field_count"], 2, "field count")

    rows = {row["field"]: row for row in normalized["rows"]}
    assert_equal(rows["revenue"]["values"], [391035000000, 383285000000], "revenue values")
    assert_equal(rows["netIncome"]["values"], [93736000000, 96995000000], "net income values")

    fixture_probe = probe.build_fixture_probe("aapl", "income", FIXTURE_PATH)
    assert_equal(fixture_probe["summary"]["income"]["period_count"], 2, "fixture summary period count")
    assert_equal(fixture_probe["summary"]["income"]["sample_fields"], ["revenue", "netIncome"], "fixture summary fields")

    print("PASS stockanalysis financial fixture smoke")


if __name__ == "__main__":
    main()
