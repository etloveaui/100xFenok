#!/usr/bin/env python3
"""Neutral adapter from acquired SEC runs to the shared CCH generator input."""

from __future__ import annotations

from copy import deepcopy
from datetime import date
import math
import re
from typing import Any

from normalization import NormalizationError, apply_weight_filter


EXPECTED_INVESTOR_COUNT = 60
INVESTOR_ID_PATTERN = re.compile(r"^[a-z0-9_]+$")


class InputAdapterError(ValueError):
    """Acquired or prepared investor data violates the shared input boundary."""


def _number(value: Any, *, label: str, positive: bool = False) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise InputAdapterError(f"{label} must be finite numeric")
    if value < 0 or (positive and value <= 0):
        raise InputAdapterError(f"{label} must be {'positive' if positive else 'non-negative'}")
    return value


def _text(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InputAdapterError(f"{label} must be a non-empty string")
    return value.strip()


def _quarter(report_date: str) -> str:
    try:
        parsed = date.fromisoformat(report_date)
    except ValueError as error:
        raise InputAdapterError(f"invalid report_date: {report_date}") from error
    return f"{parsed.year}-Q{((parsed.month - 1) // 3) + 1}"


def _filing_sort_key(filing: dict[str, Any]) -> tuple[str, str, str]:
    accessions = filing.get("source_accessions", filing.get("accession_numbers"))
    accession = filing.get("accession_number") or filing.get("accession")
    if not accession and isinstance(accessions, list) and accessions:
        accession = accessions[-1]
    return str(filing.get("report_date", "")), str(filing.get("filing_date", "")), str(accession or "")


def _normalize_holding(row: dict[str, Any], *, label: str) -> dict[str, Any]:
    if not isinstance(row, dict):
        raise InputAdapterError(f"{label} must be an object")
    market_value = row.get("market_value", row.get("value"))
    if "market_value" in row and "value" in row and row["market_value"] != row["value"]:
        raise InputAdapterError(f"{label}.value conflicts with market_value")
    output: dict[str, Any] = {
        "ticker": _text(row.get("ticker"), label=f"{label}.ticker"),
        "cusip": _text(row.get("cusip"), label=f"{label}.cusip"),
        "name": _text(row.get("name"), label=f"{label}.name"),
        "shares": _number(row.get("shares", 0), label=f"{label}.shares"),
        "market_value": _number(market_value, label=f"{label}.market_value"),
        "sector": _text(row.get("sector"), label=f"{label}.sector"),
    }
    for key in ("title_of_class", "investment_discretion", "put_call"):
        if row.get(key) not in (None, ""):
            output[key] = row[key]
    voting = row.get("voting_authority")
    if voting is None and any(key in row for key in ("voting_sole", "voting_shared", "voting_none")):
        voting = {
            "sole": row.get("voting_sole", 0),
            "shared": row.get("voting_shared", 0),
            "none": row.get("voting_none", 0),
        }
    if voting is not None:
        if not isinstance(voting, dict):
            raise InputAdapterError(f"{label}.voting_authority must be an object")
        output["voting_authority"] = {
            key: _number(voting.get(key, 0), label=f"{label}.voting_authority.{key}")
            for key in ("sole", "shared", "none")
        }
    share_type = row.get("ssh_prnamt_type", row.get("share_type"))
    if share_type not in (None, "", "SH"):
        output["ssh_prnamt_type"] = share_type
    return output


def _normalize_filing(filing: dict[str, Any], *, investor_id: str, index: int) -> dict[str, Any]:
    label = f"{investor_id}.filings[{index}]"
    if not isinstance(filing, dict):
        raise InputAdapterError(f"{label} must be an object")
    report_date = _text(filing.get("report_date"), label=f"{label}.report_date")
    quarter = _text(filing.get("quarter") or _quarter(report_date), label=f"{label}.quarter")
    if quarter != _quarter(report_date):
        raise InputAdapterError(f"{label}.quarter does not match report_date")
    source_holdings = filing.get("holdings")
    if not isinstance(source_holdings, list) or not source_holdings:
        raise InputAdapterError(f"{label}.holdings must be a non-empty list")
    normalized = [
        _normalize_holding(row, label=f"{label}.holdings[{row_index}]")
        for row_index, row in enumerate(source_holdings)
    ]

    pipeline_filtered = all(
        field in filing
        for field in ("aum_total", "holdings_count", "reported_holdings_count", "filtered_out_count")
    )
    if pipeline_filtered:
        total = _number(filing["aum_total"], label=f"{label}.aum_total", positive=True)
        reported_count = filing["reported_holdings_count"]
        filtered_out_count = filing["filtered_out_count"]
        if (
            isinstance(reported_count, bool)
            or not isinstance(reported_count, int)
            or isinstance(filtered_out_count, bool)
            or not isinstance(filtered_out_count, int)
            or filing["holdings_count"] != len(normalized)
            or reported_count != len(normalized) + filtered_out_count
        ):
            raise InputAdapterError(f"{label}: preserved filter counts are inconsistent")
        filtered = normalized
        for row_index, (row, source) in enumerate(zip(filtered, source_holdings)):
            weight = round(row["market_value"] / total, 4)
            if weight < 0.001 or source.get("weight") != weight:
                raise InputAdapterError(f"{label}.holdings[{row_index}]: preserved weight/filter mismatch")
            row["weight"] = weight
    else:
        try:
            filtered = apply_weight_filter([{**row, "value": row["market_value"]} for row in normalized])
        except NormalizationError as error:
            raise InputAdapterError(f"{label}: {error}") from error
        for row in filtered:
            row.pop("value", None)
        total = sum(row["market_value"] for row in normalized)
        reported_count = len(normalized)
        filtered_out_count = len(normalized) - len(filtered)

    top_ten_weight = round(
        sum(
            row["weight"]
            for row in sorted(
                filtered,
                key=lambda item: (-item["market_value"], item["ticker"], item["cusip"]),
            )[:10]
        ),
        4,
    )
    accessions = filing.get("source_accessions", filing.get("accession_numbers"))
    accession = filing.get("accession_number") or filing.get("accession")
    if not accession and isinstance(accessions, list) and accessions:
        accession = accessions[-1]
    value_unit = filing.get("value_unit", source_holdings[0].get("unit", "dollars"))
    unit_method = filing.get(
        "value_unit_method", source_holdings[0].get("unit_evidence", "explicit_normalized_input")
    )
    unit_confidence = filing.get(
        "value_unit_confidence", source_holdings[0].get("unit_confidence", 1.0)
    )
    output = {
        "quarter": quarter,
        "filing_date": _text(filing.get("filing_date", report_date), label=f"{label}.filing_date"),
        "report_date": report_date,
        "accession_number": _text(accession, label=f"{label}.accession_number"),
        "form": _text(filing.get("form", "13F-HR"), label=f"{label}.form"),
        "aum_total": total,
        "holdings_count": len(filtered),
        "reported_holdings_count": reported_count,
        "filtered_out_count": filtered_out_count,
        "top_10_weight": top_ten_weight,
        "value_unit": value_unit,
        "value_unit_method": unit_method,
        "value_unit_confidence": unit_confidence,
        "raw_table_value_total": filing.get("raw_table_value_total", total),
        "normalized_table_value_total": filing.get("normalized_table_value_total", total),
        "table_entry_total": filing.get("table_entry_total", reported_count),
        "is_confidential_omitted": bool(
            filing.get("is_confidential_omitted", filing.get("confidential_omission", False))
        ),
        "holdings": filtered,
    }
    output["accession_numbers"] = (
        list(accessions) if isinstance(accessions, list) and accessions else [output["accession_number"]]
    )
    return output


def prepare_investor_data(registry: dict[str, Any], investor_runs: dict[str, Any]) -> dict[str, Any]:
    investors = registry.get("investors") if isinstance(registry, dict) else None
    if not isinstance(investors, dict) or len(investors) != EXPECTED_INVESTOR_COUNT:
        raise InputAdapterError("registry must contain exactly 60 investors")
    if not isinstance(investor_runs, dict) or set(investor_runs) != set(investors):
        raise InputAdapterError("investor runs must match registry exactly")
    output: dict[str, Any] = {}
    for investor_id in sorted(investors):
        if INVESTOR_ID_PATTERN.fullmatch(investor_id) is None:
            raise InputAdapterError(f"unsafe investor id: {investor_id!r}")
        registered = investors[investor_id]
        run = investor_runs[investor_id]
        for key in ("name", "entity", "cik", "group"):
            if run.get(key) != registered.get(key):
                raise InputAdapterError(f"{investor_id}.{key} does not match registry")
        filings = run.get("filings")
        if not isinstance(filings, list) or not filings:
            raise InputAdapterError(f"{investor_id}.filings must be non-empty")
        normalized = [
            _normalize_filing(row, investor_id=investor_id, index=index)
            for index, row in enumerate(sorted(filings, key=_filing_sort_key))
        ]
        if len({row["report_date"] for row in normalized}) != len(normalized):
            raise InputAdapterError(f"{investor_id}: duplicate composite report_date")
        output[investor_id] = {
            "name": registered["name"],
            "entity": registered["entity"],
            "cik": registered["cik"],
            "group": registered["group"],
            "filings": normalized,
        }
    return output


def validate_prepared_investor_data(
    registry: dict[str, Any],
    investor_data: dict[str, Any],
) -> dict[str, Any]:
    investors = registry.get("investors") if isinstance(registry, dict) else None
    if (
        not isinstance(investors, dict)
        or len(investors) != EXPECTED_INVESTOR_COUNT
        or not isinstance(investor_data, dict)
        or set(investor_data) != set(investors)
    ):
        raise InputAdapterError("prepared investor data must match registry exactly")
    output: dict[str, Any] = {}
    for investor_id in sorted(investors):
        row = investor_data[investor_id]
        registered = investors[investor_id]
        if any(row.get(key) != registered.get(key) for key in ("name", "entity", "cik", "group")):
            raise InputAdapterError(f"{investor_id}: prepared identity mismatch")
        filings = row.get("filings")
        if not isinstance(filings, list) or not filings or filings != sorted(filings, key=_filing_sort_key):
            raise InputAdapterError(f"{investor_id}: prepared filings are missing or unordered")
        for index, filing in enumerate(filings):
            label = f"{investor_id}.filings[{index}]"
            total = _number(filing.get("aum_total"), label=f"{label}.aum_total", positive=True)
            holdings = filing.get("holdings")
            if not isinstance(holdings, list) or filing.get("holdings_count") != len(holdings):
                raise InputAdapterError(f"{label}: holdings count mismatch")
            reported = filing.get("reported_holdings_count")
            filtered = filing.get("filtered_out_count")
            if not isinstance(reported, int) or not isinstance(filtered, int) or reported != len(holdings) + filtered:
                raise InputAdapterError(f"{label}: preserved counts mismatch")
            for holding_index, holding in enumerate(holdings):
                expected_weight = round(
                    _number(
                        holding.get("market_value"),
                        label=f"{label}.holdings[{holding_index}].market_value",
                    )
                    / total,
                    4,
                )
                if expected_weight < 0.001 or holding.get("weight") != expected_weight:
                    raise InputAdapterError(f"{label}.holdings[{holding_index}]: weight mismatch")
            accessions = filing.get("accession_numbers")
            if not isinstance(accessions, list) or not accessions:
                raise InputAdapterError(f"{label}: accession lineage missing")
        output[investor_id] = deepcopy(row)
    return output
