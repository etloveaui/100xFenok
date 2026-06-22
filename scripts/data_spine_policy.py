"""Shared Data Spine policy constants for P1/V0 audits.

The resolver authority order intentionally stays in build-market-facts.py.
This module owns the ratified disagreement/tolerance policy so audit scripts
do not drift from one another as data refreshes.
"""

from __future__ import annotations

from typing import Any


DIAGNOSES = ("agreement", "value_drift", "stale", "sign_divergence", "scale_mismatch")

DIAGNOSIS_ACTION = {
    "agreement": "serve selected value",
    "stale": "prefer fresher candidate over static authority; retain stale source as provenance warning",
    "scale_mismatch": "unit-normalize to percent_points before compare/serve; fail normalization if unresolved",
    "sign_divergence": "do not silently pick; block confidence UI or require explicit authority tiebreak",
    "value_drift": "apply per-field tolerance band; if outside tolerance, serve with warning or hold from confidence UI",
}

V0_FIELD_POLICY: dict[str, dict[str, Any]] = {
    "price": {"metric": "relative_spread_pct", "tolerance": 0.5, "unit": "percent"},
    "previous_close": {"metric": "relative_spread_pct", "tolerance": 0.5, "unit": "percent"},
    "change": {"metric": "relative_spread_pct", "tolerance": 0.5, "unit": "percent"},
    "change_pct": {"metric": "absolute_spread", "tolerance": 0.5, "unit": "percentage_points"},
    "market_cap": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "total_assets": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "trailing_pe": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "forward_pe": {"metric": "relative_spread_pct", "tolerance": 5.0, "unit": "percent"},
    "dividend_yield": {"metric": "absolute_spread", "tolerance": 0.5, "unit": "percentage_points"},
    "beta": {"metric": "absolute_spread", "tolerance": 0.10, "unit": "absolute"},
    "expense_ratio": {"metric": "absolute_spread", "tolerance": 0.25, "unit": "percentage_points"},
    "return_1m": {"metric": "absolute_spread", "tolerance": 5.0, "unit": "percentage_points"},
    "return_3m": {"metric": "authority_only", "tolerance": None, "unit": "n/a"},
    "return_ytd": {"metric": "absolute_spread", "tolerance": 7.0, "unit": "percentage_points"},
    "return_1y": {"metric": "absolute_spread", "tolerance": 10.0, "unit": "percentage_points"},
    "return_3y_avg": {"metric": "absolute_spread", "tolerance": 5.0, "unit": "percentage_points"},
    "return_5y_avg": {"metric": "absolute_spread", "tolerance": 1.25, "unit": "percentage_points"},
    "return_10y_avg": {"metric": "absolute_spread", "tolerance": 1.0, "unit": "percentage_points"},
    "return_max_avg": {"metric": "absolute_spread", "tolerance": 5.0, "unit": "percentage_points"},
}

FIELD_UNIT = {
    "price": "currency",
    "previous_close": "currency",
    "change": "currency",
    "change_pct": "percent_points",
    "market_cap": "currency",
    "total_assets": "currency",
    "trailing_pe": "ratio",
    "forward_pe": "ratio",
    "dividend_yield": "percent_points",
    "beta": "ratio",
    "expense_ratio": "percent_points",
    "return_1m": "percent_points",
    "return_3m": "percent_points",
    "return_ytd": "percent_points",
    "return_1y": "percent_points",
    "return_3y_avg": "percent_points",
    "return_5y_avg": "percent_points",
    "return_10y_avg": "percent_points",
    "return_max_avg": "percent_points",
}

POLICY_RATIONALE = {
    "price": "strict quote guard; selected source still exposes all candidates",
    "previous_close": "strict close-price guard; rare drift should stay visible",
    "change": "same-session quote drift; sign divergence remains blocking",
    "change_pct": "same-session quote drift; sign divergence remains blocking",
    "market_cap": "stale cleanup dominates; definition drift should stay visible",
    "total_assets": "definition drift should stay visible",
    "trailing_pe": "stale cleanup dominates; keep strict ratio guard",
    "forward_pe": "ratio definitions can diverge; keep strict guard",
    "dividend_yield": "0.5pp passes small rounding drift and flags distribution-basis outliers",
    "beta": "0.10 absolute guard for low-sample ratio drift",
    "expense_ratio": "25bp fee guard",
    "return_1m": "short-window returns are noisy; 5pp keeps major mismatches visible",
    "return_3m": "authority-only: cross-source comparison is unreliable until a dedicated fix",
    "return_ytd": "YTD source/formula timing can drift; 7pp keeps major mismatches visible",
    "return_1y": "1Y source/formula timing can drift; 10pp keeps major mismatches visible",
    "return_3y_avg": "low sample and leveraged-ETF outliers; keep strict 5pp guard",
    "return_5y_avg": "long-window CAGR should be tight; 1.25pp guard",
    "return_10y_avg": "long-window CAGR should be tight; 1pp guard",
    "return_max_avg": "MAX CAGR start-date differences can drift; 5pp guard",
}


def tolerance_label(field: str) -> str:
    policy = V0_FIELD_POLICY.get(field)
    if not policy:
        return "DRAFT/UNVERIFIED"
    metric = policy["metric"]
    tolerance = policy["tolerance"]
    unit = policy["unit"]
    if metric == "authority_only":
        return "authority-only; candidate kept as provenance/cross-check"
    if metric == "relative_spread_pct":
        return f"{tolerance:g}% relative drift"
    if unit == "percentage_points":
        return f"{tolerance:g} percentage points"
    if unit == "absolute":
        return f"{tolerance:g} absolute drift"
    return f"{tolerance:g} {unit}"
