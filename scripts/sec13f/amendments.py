#!/usr/bin/env python3
"""Deterministic, fail-closed SEC 13F amendment composition."""

from __future__ import annotations

import copy
from typing import Any, Iterable

try:  # Support both package imports and the repository's direct-script tests.
    from .parser import ALLOWED_AMENDMENT_TYPES
except ImportError:  # pragma: no cover - exercised by direct-script tests
    from parser import ALLOWED_AMENDMENT_TYPES


class AmendmentError(ValueError):
    """A filing sequence does not prove one unambiguous active quarter state."""

    def __init__(self, reason: str, *, accession: str | None = None, detail: str = "") -> None:
        self.reason = reason
        self.accession = accession
        self.detail = detail
        message = reason
        if accession:
            message = f"{accession}: {message}"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


def component_sort_key(component: dict[str, Any]) -> tuple[str, str, int, str]:
    """Contract order: report date, filing date, amendment number, accession."""

    amendment_number = component.get("amendment_number")
    if amendment_number is None:
        amendment_number = -1
    if isinstance(amendment_number, bool) or not isinstance(amendment_number, int):
        raise AmendmentError("invalid_amendment_number", accession=component.get("accession"))
    return (
        str(component.get("report_date", "")),
        str(component.get("filing_date", "")),
        amendment_number,
        str(component.get("accession", "")),
    )


def _validated_components(components: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    materialized = list(components)
    if not materialized:
        raise AmendmentError("missing_filing_components")

    unique: list[dict[str, Any]] = []
    by_accession: dict[str, dict[str, Any]] = {}
    for component in materialized:
        if not isinstance(component, dict):
            raise AmendmentError("invalid_filing_component")
        accession = component.get("accession")
        if not isinstance(accession, str) or not accession:
            raise AmendmentError("invalid_filing_component", detail="accession")
        prior = by_accession.get(accession)
        if prior is not None:
            if prior != component:
                raise AmendmentError("accession_replay_mismatch", accession=accession)
            continue
        by_accession[accession] = component
        unique.append(component)

    report_dates = {component.get("report_date") for component in unique}
    if len(report_dates) != 1 or None in report_dates or "" in report_dates:
        raise AmendmentError("report_date_mismatch")
    return sorted(unique, key=component_sort_key)


def compose_amendments(components: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Fold parsed filings into one active quarter state.

    A base establishes state, a RESTATEMENT replaces it, and NEW HOLDINGS
    appends to it.  Holding rows are deep-copied in component/XML order; no
    CUSIP- or value-based deduplication is performed.
    """

    ordered = _validated_components(components)
    holdings: list[dict[str, Any]] = []
    source_accessions: list[str] = []
    active_accessions: list[str] = []
    lineage: list[dict[str, Any]] = []
    state_exists = False
    last_replacement = ""
    addition_seen = False
    confidential_omission = False

    for component in ordered:
        accession = component["accession"]
        form = component.get("form")
        amendment_type = component.get("amendment_type")
        rows = component.get("holdings")
        cover = component.get("cover")
        if not isinstance(rows, list) or not isinstance(cover, dict):
            raise AmendmentError("invalid_filing_component", accession=accession)

        if form == "13F-HR":
            if amendment_type is not None:
                raise AmendmentError("base_has_amendment_metadata", accession=accession)
            action = "replace_base"
            holdings = copy.deepcopy(rows)
            active_accessions = [accession]
            state_exists = True
            last_replacement = "base"
            addition_seen = False
        elif form == "13F-HR/A":
            if amendment_type not in ALLOWED_AMENDMENT_TYPES:
                raise AmendmentError("unknown_or_missing_amendment_type", accession=accession)
            if not state_exists:
                raise AmendmentError("missing_base_filing", accession=accession)
            if amendment_type == "RESTATEMENT":
                action = "replace_restatement"
                holdings = copy.deepcopy(rows)
                active_accessions = [accession]
                last_replacement = "restatement"
                addition_seen = False
            else:
                action = "append_new_holdings"
                holdings.extend(copy.deepcopy(rows))
                active_accessions.append(accession)
                addition_seen = True
        else:
            raise AmendmentError("unsupported_form", accession=accession, detail=str(form))

        source_accessions.append(accession)
        confidential_omission = confidential_omission or bool(
            cover.get("is_confidential_omitted")
        )
        lineage.append(
            {
                "accession": accession,
                "form": form,
                "amendment_type": amendment_type,
                "amendment_number": component.get("amendment_number"),
                "action": action,
                "holding_count": len(rows),
            }
        )

    if not state_exists:
        raise AmendmentError("missing_base_filing")
    if last_replacement == "restatement":
        composition = "restatement_plus_addition" if addition_seen else "restatement"
    else:
        composition = "base_plus_addition" if addition_seen else "base"

    return {
        "report_date": ordered[0]["report_date"],
        "composition": composition,
        "holdings": holdings,
        "holding_count": len(holdings),
        "confidential_omission": confidential_omission,
        "source_accessions": source_accessions,
        "active_accessions": active_accessions,
        "lineage": lineage,
    }


compose_filings = compose_amendments
