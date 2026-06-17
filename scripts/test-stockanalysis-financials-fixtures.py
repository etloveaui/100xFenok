#!/usr/bin/env python3
"""Fixture invariant checks for the StockAnalysis financial statement probe."""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "scripts" / "probe-stockanalysis-financials.py"
FIXTURE_DIR = ROOT / "scripts" / "fixtures" / "stockanalysis"

FIXTURE_CASES = [
    ("aapl", "income", "annual", 30, 5),
    ("aapl", "balance_sheet", "annual", 30, 5),
    ("aapl", "cash_flow", "annual", 30, 5),
    ("aapl", "ratios", "annual", 30, 5),
    ("aapl", "income", "quarterly", 30, 12),
    ("aapl", "balance_sheet", "quarterly", 30, 12),
    ("aapl", "cash_flow", "quarterly", 30, 12),
    ("aapl", "ratios", "quarterly", 30, 12),
    ("jpm", "balance_sheet", "annual", 30, 5),
]


def load_probe_module():
    spec = importlib.util.spec_from_file_location("stockanalysis_financials_probe", PROBE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load probe module from {PROBE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_path(ticker: str, statement: str, period: str) -> Path:
    return FIXTURE_DIR / f"{ticker}_{statement}_{period}__data.fixture.json"


def assert_true(value: bool, label: str) -> None:
    if not value:
        raise AssertionError(label)


def assert_descending_periods(periods: list[str], label: str) -> None:
    assert_true(periods, f"{label}: periods missing")
    ttm_count = periods.count("TTM")
    assert_true(ttm_count <= 1, f"{label}: TTM appears more than once")
    if ttm_count:
        assert_true(periods[0] == "TTM", f"{label}: TTM must be the first period")
    dated = [period for period in periods if period != "TTM"]
    assert_true(dated == sorted(dated, reverse=True), f"{label}: dated periods are not descending")


def main() -> None:
    probe = load_probe_module()

    for ticker, statement, expected_period, min_fields, min_periods in FIXTURE_CASES:
        path = fixture_path(ticker, statement, expected_period)
        assert_true(path.exists(), f"{path.name}: fixture missing")

        normalized = probe.load_fixture_statement(ticker, statement, path)
        label = path.name
        periods = normalized.get("periods") or []
        rows = normalized.get("rows") or []

        assert_true(normalized["ticker"] == ticker.upper(), f"{label}: ticker mismatch")
        assert_true(normalized["period"] == expected_period, f"{label}: period mismatch")
        assert_true(normalized["field_count"] >= min_fields, f"{label}: field_count below floor")
        assert_true(len(periods) >= min_periods, f"{label}: period_count below floor")
        assert_descending_periods(periods, label)

        for row in rows:
            field = row.get("field")
            values = row.get("values")
            assert_true(isinstance(values, list), f"{label}:{field}: values is not a list")
            assert_true(len(values) == len(periods), f"{label}:{field}: values length does not match periods")

        fixture_probe = probe.build_fixture_probe(ticker, statement, path)
        summary = fixture_probe["summary"][statement]
        assert_true(summary["field_count"] == normalized["field_count"], f"{label}: summary field_count mismatch")
        assert_true(summary["period_count"] == len(periods), f"{label}: summary period_count mismatch")

    print(f"PASS stockanalysis financial fixture invariants ({len(FIXTURE_CASES)} fixtures)")


if __name__ == "__main__":
    main()
