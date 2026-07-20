#!/usr/bin/env python3
"""Fail-closed SEC 13F cover and information-table parsing.

This module intentionally has no network, cache, or output dependencies.  It
accepts already-acquired XML and returns plain dictionaries so later slices can
persist or compare them without giving the parser implicit write authority.
"""

from __future__ import annotations

from datetime import date
import re
from typing import Any
import xml.etree.ElementTree as ET


ALLOWED_FORMS = frozenset({"13F-HR", "13F-HR/A"})
ALLOWED_AMENDMENT_TYPES = frozenset({"RESTATEMENT", "NEW HOLDINGS"})
MAX_XML_BYTES = 8 * 1024 * 1024
_UNSAFE_XML = re.compile(br"<!\s*(?:DOCTYPE|ENTITY)\b", re.IGNORECASE)


class Sec13FParseError(ValueError):
    """A filing component cannot safely enter the amendment ledger."""

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


# Short compatibility alias for direct callers.
ParserError = Sec13FParseError


def _xml_bytes(xml: str | bytes | None, *, missing_reason: str, accession: str | None) -> bytes:
    if xml is None or xml == "" or xml == b"":
        raise Sec13FParseError(missing_reason, accession=accession)
    if isinstance(xml, str):
        payload = xml.encode("utf-8")
    elif isinstance(xml, bytes):
        payload = xml
    else:
        raise Sec13FParseError(missing_reason, accession=accession, detail="XML must be str or bytes")
    if len(payload) > MAX_XML_BYTES:
        raise Sec13FParseError("xml_too_large", accession=accession)
    if _UNSAFE_XML.search(payload):
        raise Sec13FParseError("unsafe_xml", accession=accession)
    return payload


def _root(
    xml: str | bytes | None,
    *,
    missing_reason: str,
    malformed_reason: str,
    accession: str | None,
) -> ET.Element:
    payload = _xml_bytes(xml, missing_reason=missing_reason, accession=accession)
    try:
        return ET.fromstring(payload)
    except (ET.ParseError, UnicodeError) as exc:
        raise Sec13FParseError(malformed_reason, accession=accession, detail=str(exc)) from exc


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element.iter() if _local_name(child.tag) == name]


def _first_text(element: ET.Element, name: str, *, required: bool = False) -> str | None:
    matches = _children(element, name)
    if not matches:
        if required:
            raise ValueError(f"missing {name}")
        return None
    text = (matches[0].text or "").strip()
    if required and not text:
        raise ValueError(f"empty {name}")
    return text or None


def _required_int(element: ET.Element, name: str) -> int:
    text = _first_text(element, name, required=True)
    assert text is not None
    try:
        value = int(text)
    except ValueError as exc:
        raise ValueError(f"invalid {name}") from exc
    if value < 0:
        raise ValueError(f"negative {name}")
    return value


def _optional_int(element: ET.Element, name: str) -> int | None:
    text = _first_text(element, name)
    if text is None:
        return None
    try:
        value = int(text)
    except ValueError as exc:
        raise ValueError(f"invalid {name}") from exc
    if value < 0:
        raise ValueError(f"negative {name}")
    return value


def parse_cover_xml(xml: str | bytes | None, *, accession: str | None = None) -> dict[str, Any]:
    """Parse required cover totals and amendment metadata from primary XML."""

    root = _root(
        xml,
        missing_reason="missing_cover_xml",
        malformed_reason="malformed_cover_xml",
        accession=accession,
    )
    try:
        entry_total = _required_int(root, "tableEntryTotal")
        value_total = _required_int(root, "tableValueTotal")
        confidential_text = _first_text(root, "isConfidentialOmitted", required=True)
        assert confidential_text is not None
        normalized_confidential = confidential_text.casefold()
        if normalized_confidential not in {"true", "false", "1", "0"}:
            raise ValueError("invalid isConfidentialOmitted")
        amendment_type = _first_text(root, "amendmentType")
        if amendment_type is not None:
            amendment_type = " ".join(amendment_type.upper().split())
        amendment_number = _optional_int(root, "amendmentNumber")
    except ValueError as exc:
        raise Sec13FParseError("invalid_cover_xml", accession=accession, detail=str(exc)) from exc

    return {
        "table_entry_total": entry_total,
        "table_value_total": value_total,
        "is_confidential_omitted": normalized_confidential in {"true", "1"},
        "amendment_type": amendment_type,
        "amendment_number": amendment_number,
    }


def _direct_child(element: ET.Element, name: str) -> ET.Element | None:
    for child in element:
        if _local_name(child.tag) == name:
            return child
    return None


def _direct_text(element: ET.Element, name: str, *, required: bool = False) -> str | None:
    child = _direct_child(element, name)
    text = (child.text or "").strip() if child is not None else ""
    if required and not text:
        raise ValueError(f"missing {name}")
    return text or None


def _direct_int(element: ET.Element, name: str, *, required: bool = True) -> int:
    text = _direct_text(element, name, required=required)
    if text is None:
        return 0
    try:
        value = int(text)
    except ValueError as exc:
        raise ValueError(f"invalid {name}") from exc
    if value < 0:
        raise ValueError(f"negative {name}")
    return value


def parse_information_table_xml(
    xml: str | bytes | None,
    *,
    accession: str | None = None,
) -> list[dict[str, Any]]:
    """Parse holdings in document order without incidental deduplication."""

    root = _root(
        xml,
        missing_reason="missing_information_table",
        malformed_reason="malformed_information_table_xml",
        accession=accession,
    )
    holdings: list[dict[str, Any]] = []
    try:
        for info in _children(root, "infoTable"):
            shares_element = _direct_child(info, "shrsOrPrnAmt")
            voting_element = _direct_child(info, "votingAuthority")
            if shares_element is None:
                raise ValueError("missing shrsOrPrnAmt")
            if voting_element is None:
                raise ValueError("missing votingAuthority")

            put_call = _direct_text(info, "putCall")
            holdings.append(
                {
                    "name": _direct_text(info, "nameOfIssuer", required=True),
                    "cusip": _direct_text(info, "cusip", required=True),
                    "title_of_class": _direct_text(info, "titleOfClass", required=True),
                    "value": _direct_int(info, "value"),
                    "shares": _direct_int(shares_element, "sshPrnamt"),
                    "share_type": _direct_text(shares_element, "sshPrnamtType", required=True),
                    "investment_discretion": _direct_text(
                        info, "investmentDiscretion", required=True
                    ),
                    "voting_sole": _direct_int(voting_element, "Sole"),
                    "voting_shared": _direct_int(voting_element, "Shared"),
                    "voting_none": _direct_int(voting_element, "None"),
                    **({"put_call": put_call} if put_call is not None else {}),
                }
            )
    except ValueError as exc:
        raise Sec13FParseError(
            "invalid_information_table_xml", accession=accession, detail=str(exc)
        ) from exc
    return holdings


def _required_component_text(component: dict[str, Any], field: str, accession: str | None) -> str:
    value = component.get(field)
    if not isinstance(value, str) or not value.strip():
        raise Sec13FParseError("invalid_component_metadata", accession=accession, detail=field)
    return value.strip()


def parse_filing_component(
    component: dict[str, Any],
    information_table_xml: str | bytes | None,
) -> dict[str, Any]:
    """Parse and reconcile one immutable filing component."""

    if not isinstance(component, dict):
        raise Sec13FParseError("invalid_component_metadata", detail="component must be an object")
    accession_value = component.get("accession")
    accession = accession_value.strip() if isinstance(accession_value, str) else None
    if not accession:
        raise Sec13FParseError("invalid_component_metadata", detail="accession")

    form = _required_component_text(component, "form", accession)
    if form not in ALLOWED_FORMS:
        raise Sec13FParseError("unsupported_form", accession=accession, detail=form)
    filing_date = _required_component_text(component, "filing_date", accession)
    report_date = _required_component_text(component, "report_date", accession)
    try:
        date.fromisoformat(filing_date)
        date.fromisoformat(report_date)
    except ValueError as exc:
        raise Sec13FParseError("invalid_component_metadata", accession=accession, detail="date") from exc

    cover = parse_cover_xml(component.get("cover_xml"), accession=accession)
    holdings = parse_information_table_xml(information_table_xml, accession=accession)
    if cover["table_entry_total"] != len(holdings):
        raise Sec13FParseError(
            "cover_count_mismatch",
            accession=accession,
            detail=f"{cover['table_entry_total']} != {len(holdings)}",
        )
    parsed_value = sum(row["value"] for row in holdings)
    if cover["table_value_total"] != parsed_value:
        raise Sec13FParseError(
            "cover_value_mismatch",
            accession=accession,
            detail=f"{cover['table_value_total']} != {parsed_value}",
        )

    raw_amendment_type = component.get("amendment_type")
    amendment_type = (
        " ".join(raw_amendment_type.upper().split())
        if isinstance(raw_amendment_type, str) and raw_amendment_type.strip()
        else None
    )
    amendment_number = component.get("amendment_number")
    if isinstance(amendment_number, bool) or (
        amendment_number is not None and not isinstance(amendment_number, int)
    ):
        raise Sec13FParseError("invalid_amendment_number", accession=accession)

    if form == "13F-HR":
        if amendment_type is not None or amendment_number is not None:
            raise Sec13FParseError("base_has_amendment_metadata", accession=accession)
        if cover["amendment_type"] is not None or cover["amendment_number"] is not None:
            raise Sec13FParseError("cover_amendment_mismatch", accession=accession)
    else:
        if amendment_type not in ALLOWED_AMENDMENT_TYPES:
            raise Sec13FParseError("unknown_or_missing_amendment_type", accession=accession)
        if amendment_number is None or amendment_number < 1:
            raise Sec13FParseError("invalid_amendment_number", accession=accession)
        if cover["amendment_type"] != amendment_type or cover["amendment_number"] != amendment_number:
            raise Sec13FParseError("cover_amendment_mismatch", accession=accession)

    return {
        "accession": accession,
        "form": form,
        "filing_date": filing_date,
        "report_date": report_date,
        "amendment_type": amendment_type,
        "amendment_number": amendment_number,
        "cover": cover,
        "holdings": holdings,
    }


# Concise aliases for callers that prefer nouns matching the XML documents.
parse_cover = parse_cover_xml
parse_information_table = parse_information_table_xml
parse_component = parse_filing_component
