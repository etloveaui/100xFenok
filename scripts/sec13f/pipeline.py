#!/usr/bin/env python3
"""Hermetic SEC acquisition-to-generator orchestration for Slice A.

The caller injects a configured client, the frozen registry, a CUSIP reference
mapping, and a unit resolver.  Accessions always come from SEC submissions
discovery; this API deliberately has no accession argument and performs no
writes.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Mapping

try:  # Repository tests import these modules directly from scripts/sec13f.
    from .amendments import AmendmentError, compose_amendments
    from .archive import SecClient, SecClientError, discover_filings, fetch_filing_components
    from .normalization import NormalizationError, apply_weight_filter, normalize_values
    from .parser import Sec13FParseError, parse_cover_xml, parse_filing_component
except ImportError:  # pragma: no cover - direct-script import path
    from amendments import AmendmentError, compose_amendments
    from archive import SecClient, SecClientError, discover_filings, fetch_filing_components
    from normalization import NormalizationError, apply_weight_filter, normalize_values
    from parser import Sec13FParseError, parse_cover_xml, parse_filing_component


EXPECTED_INVESTOR_COUNT = 60


class PipelineError(RuntimeError):
    """One investor cannot produce a complete, generator-safe run."""

    def __init__(
        self,
        reason: str,
        *,
        investor_id: str | None = None,
        accession: str | None = None,
        detail: str = "",
    ) -> None:
        self.reason = reason
        self.investor_id = investor_id
        self.accession = accession
        self.detail = detail
        parts = [part for part in (investor_id, accession, reason) if part]
        message = ": ".join(parts)
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


@dataclass(frozen=True)
class UnitDecision:
    unit: str
    evidence: str
    confidence: float


UnitResolver = Callable[[dict[str, Any]], UnitDecision | Mapping[str, Any]]


def _quarter(report_date: str) -> str:
    parsed = date.fromisoformat(report_date)
    return f"{parsed.year}-Q{((parsed.month - 1) // 3) + 1}"


def _unit_decision(
    resolver: UnitResolver,
    parsed: dict[str, Any],
    *,
    investor_id: str,
) -> UnitDecision:
    try:
        resolved = resolver(deepcopy(parsed))
    except Exception as exc:
        raise PipelineError(
            "unit_resolution_failed",
            investor_id=investor_id,
            accession=parsed["accession"],
            detail=str(exc),
        ) from exc
    if isinstance(resolved, UnitDecision):
        return resolved
    if isinstance(resolved, Mapping):
        try:
            return UnitDecision(
                unit=resolved["unit"],
                evidence=resolved["evidence"],
                confidence=resolved["confidence"],
            )
        except KeyError as exc:
            raise PipelineError(
                "unit_resolution_failed",
                investor_id=investor_id,
                accession=parsed["accession"],
                detail=f"missing {exc.args[0]}",
            ) from exc
    raise PipelineError(
        "unit_resolution_failed",
        investor_id=investor_id,
        accession=parsed["accession"],
        detail="resolver must return UnitDecision or mapping",
    )


def _resolve_references(
    rows: list[dict[str, Any]],
    reference_mapping: Mapping[str, Mapping[str, str]],
    *,
    investor_id: str,
    accession: str,
) -> list[dict[str, Any]]:
    resolved_rows: list[dict[str, Any]] = []
    for index, source in enumerate(rows):
        cusip = source.get("cusip")
        reference = reference_mapping.get(cusip) if isinstance(cusip, str) else None
        ticker = reference.get("ticker") if isinstance(reference, Mapping) else None
        sector = reference.get("sector") if isinstance(reference, Mapping) else None
        if not isinstance(ticker, str) or not ticker.strip():
            raise PipelineError(
                "unresolved_holding_reference",
                investor_id=investor_id,
                accession=accession,
                detail=f"row {index}: ticker",
            )
        if not isinstance(sector, str) or not sector.strip():
            raise PipelineError(
                "unresolved_holding_reference",
                investor_id=investor_id,
                accession=accession,
                detail=f"row {index}: sector",
            )
        row = deepcopy(source)
        row["ticker"] = ticker.strip()
        row["sector"] = sector.strip()
        row["market_value"] = row["value"]
        row["voting_authority"] = {
            "sole": row["voting_sole"],
            "shared": row["voting_shared"],
            "none": row["voting_none"],
        }
        resolved_rows.append(row)
    return resolved_rows


def _pipeline_reason(error: Exception) -> str:
    reason = getattr(error, "reason", None)
    if isinstance(reason, str) and reason:
        return reason
    message = str(error).lower()
    if "information table is missing" in message:
        return "missing_information_table"
    if "primary document is missing" in message:
        return "missing_cover_xml"
    return "acquisition_failed" if isinstance(error, SecClientError) else "pipeline_failed"


def build_investor_run(
    *,
    client: SecClient | None,
    filing_source: Any | None = None,
    investor_id: str,
    investor: Mapping[str, Any],
    reference_mapping: Mapping[str, Mapping[str, str]],
    unit_resolver: UnitResolver,
    threshold: float = 0.001,
) -> dict[str, Any]:
    """Acquire and compose every discovered filing for one registry investor."""

    cik = investor.get("cik")
    if not isinstance(cik, str) or len(cik) != 10 or not cik.isdigit():
        raise PipelineError("invalid_registry", investor_id=investor_id, detail="cik")

    try:
        if filing_source is None:
            if client is None:
                raise SecClientError("SEC client or filing source is required")
            discovered = discover_filings(client, cik)
        else:
            discovered = filing_source.discover(cik)
    except Exception as exc:
        if not isinstance(exc, SecClientError) and not hasattr(exc, "reason"):
            raise
        raise PipelineError(
            _pipeline_reason(exc), investor_id=investor_id, detail=str(exc)
        ) from exc
    if not discovered:
        raise PipelineError("missing_filings", investor_id=investor_id)

    parsed_by_report_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unit_by_accession: dict[str, UnitDecision] = {}
    filing_date_by_accession: dict[str, str] = {}
    form_by_accession: dict[str, str] = {}

    for component_order, filing in enumerate(discovered):
        try:
            if filing_source is None:
                if client is None:
                    raise SecClientError("SEC client or filing source is required")
                documents = fetch_filing_components(client, cik, filing)
            else:
                documents = filing_source.components(cik, filing)
            cover = parse_cover_xml(documents["primary"], accession=filing.accession)
            component = {
                "accession": filing.accession,
                "form": filing.form,
                "filing_date": filing.filing_date,
                "report_date": filing.report_date,
                "amendment_type": cover["amendment_type"],
                "amendment_number": cover["amendment_number"],
                "cover_xml": documents["primary"],
            }
            parsed = parse_filing_component(component, documents["information_table"])
            if not parsed["holdings"] and not parsed["cover"]["is_confidential_omitted"]:
                raise PipelineError(
                    "unexplained_zero_holdings",
                    investor_id=investor_id,
                    accession=filing.accession,
                )
            if filing_source is not None and hasattr(filing_source, "record_semantics"):
                filing_source.record_semantics(
                    cik,
                    filing,
                    amendment_type=parsed["amendment_type"],
                    amendment_number=parsed["amendment_number"],
                    component_order=component_order,
                )
            decision = _unit_decision(unit_resolver, parsed, investor_id=investor_id)
            normalized = normalize_values(
                parsed["holdings"],
                unit=decision.unit,
                evidence=decision.evidence,
                confidence=decision.confidence,
            )
            parsed["holdings"] = _resolve_references(
                normalized,
                reference_mapping,
                investor_id=investor_id,
                accession=filing.accession,
            )
        except Exception as exc:
            if isinstance(exc, PipelineError):
                raise
            if not isinstance(exc, (SecClientError, Sec13FParseError, NormalizationError)) and not hasattr(exc, "reason"):
                raise
            raise PipelineError(
                _pipeline_reason(exc),
                investor_id=investor_id,
                accession=filing.accession,
                detail=str(exc),
            ) from exc
        parsed_by_report_date[filing.report_date].append(parsed)
        unit_by_accession[filing.accession] = decision
        filing_date_by_accession[filing.accession] = filing.filing_date
        form_by_accession[filing.accession] = filing.form

    filings: list[dict[str, Any]] = []
    for report_date in sorted(parsed_by_report_date):
        try:
            composed = compose_amendments(parsed_by_report_date[report_date])
            unfiltered = composed["holdings"]
            filtered = apply_weight_filter(unfiltered, threshold=threshold)
        except (AmendmentError, NormalizationError) as exc:
            raise PipelineError(
                _pipeline_reason(exc), investor_id=investor_id, detail=str(exc)
            ) from exc

        active = composed["active_accessions"]
        active_decisions = [unit_by_accession[accession] for accession in active]
        units = {decision.unit for decision in active_decisions}
        filings.append(
            {
                "quarter": _quarter(report_date),
                "report_date": report_date,
                "filing_date": max(filing_date_by_accession[accession] for accession in active),
                "accession_number": "+".join(active),
                "form": form_by_accession[active[-1]],
                "source_accessions": composed["source_accessions"],
                "active_accessions": active,
                "composition": composed["composition"],
                "lineage": composed["lineage"],
                "holdings": filtered,
                "holdings_count": len(filtered),
                "reported_holdings_count": len(unfiltered),
                "filtered_out_count": len(unfiltered) - len(filtered),
                "aum_total": sum(row["value"] for row in unfiltered),
                "value_unit": next(iter(units)) if len(units) == 1 else "mixed",
                "unit_decisions": {
                    accession: {
                        "unit": unit_by_accession[accession].unit,
                        "evidence": unit_by_accession[accession].evidence,
                        "confidence": unit_by_accession[accession].confidence,
                    }
                    for accession in composed["source_accessions"]
                },
                "is_confidential_omitted": composed["confidential_omission"],
            }
        )

    return {
        "id": investor_id,
        "name": investor["name"],
        "entity": investor["entity"],
        "cik": cik,
        "group": investor["group"],
        "filings": filings,
    }


def _registry_investors(registry: Mapping[str, Any]) -> Mapping[str, Mapping[str, Any]]:
    investors = registry.get("investors") if isinstance(registry, Mapping) else None
    groups = registry.get("groups") if isinstance(registry, Mapping) else None
    if not isinstance(investors, Mapping) or not isinstance(groups, Mapping):
        raise PipelineError("invalid_registry", detail="investors/groups")
    if len(investors) != EXPECTED_INVESTOR_COUNT:
        raise PipelineError(
            "invalid_registry",
            detail=f"investor count {len(investors)} != {EXPECTED_INVESTOR_COUNT}",
        )
    seen_ciks: set[str] = set()
    for investor_id, investor in investors.items():
        if not isinstance(investor_id, str) or not investor_id or not isinstance(investor, Mapping):
            raise PipelineError("invalid_registry", detail="investor record")
        cik = investor.get("cik")
        if not isinstance(cik, str) or len(cik) != 10 or not cik.isdigit() or cik in seen_ciks:
            raise PipelineError("invalid_registry", investor_id=investor_id, detail="cik")
        seen_ciks.add(cik)
        if any(not isinstance(investor.get(field), str) or not investor[field] for field in ("name", "entity", "group")):
            raise PipelineError("invalid_registry", investor_id=investor_id, detail="identity")
        if investor["group"] not in groups or investor.get("active") is not True:
            raise PipelineError("invalid_registry", investor_id=investor_id, detail="group/active")
    return investors


def build_investor_runs(
    *,
    client: SecClient | None,
    filing_source: Any | None = None,
    registry: Mapping[str, Any],
    reference_mapping: Mapping[str, Mapping[str, str]],
    unit_resolver: UnitResolver,
    threshold: float = 0.001,
) -> dict[str, dict[str, Any]]:
    """Build exactly one generator input record for each frozen registry ID."""

    investors = _registry_investors(registry)
    return {
        investor_id: build_investor_run(
            client=client,
            filing_source=filing_source,
            investor_id=investor_id,
            investor=investor,
            reference_mapping=reference_mapping,
            unit_resolver=unit_resolver,
            threshold=threshold,
        )
        for investor_id, investor in investors.items()
    }


run_pipeline = build_investor_runs
