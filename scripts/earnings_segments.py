#!/usr/bin/env python3
"""Extract reconciled revenue segments from an issuer's inline-XBRL HTML.

The extractor deliberately has no network or filing-selection policy.  The
caller supplies the HTML, the exact period start/end dates, and the already
verified absolute revenue total.  Only revenue facts whose contexts match
those dates and whose unit is USD are considered.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
import math
import re
from typing import Any, Iterable


REVENUE_CONCEPT = "RevenueFromContractWithCustomerExcludingAssessedTax"
PRODUCT_AXIS = "srt:ProductOrServiceAxis"
BUSINESS_AXIS = "us-gaap:StatementBusinessSegmentsAxis"

_PREFERRED_AXES: dict[str, tuple[str, ...]] = {
    "AAPL": (PRODUCT_AXIS, BUSINESS_AXIS),
    "AMZN": (BUSINESS_AXIS, PRODUCT_AXIS),
    "META": (BUSINESS_AXIS, PRODUCT_AXIS),
    "MSFT": (BUSINESS_AXIS, PRODUCT_AXIS),
}
_AXIS_ORDER = (BUSINESS_AXIS, PRODUCT_AXIS)
_TRACKED_TAGS = {
    "xbrli:context",
    "xbrli:period",
    "xbrli:startdate",
    "xbrli:enddate",
    "xbrldi:explicitmember",
    "xbrldi:typedmember",
    "xbrli:unit",
    "xbrli:measure",
    "ix:nonfraction",
}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NUMBER_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")
_WHITESPACE_RE = re.compile(r"\s+")
_SUBTOTAL_RE = re.compile(
    r"^(?:all(?: segments?)?|consolidated|eliminations?|products|subtotal|total(?: revenue| sales| net sales)?)$",
    re.IGNORECASE,
)


@dataclass
class _Context:
    context_id: str
    start: str | None = None
    end: str | None = None
    dimensions: list[tuple[str, str]] = field(default_factory=list)
    has_typed_member: bool = False


@dataclass
class _Unit:
    unit_id: str
    measures: list[str] = field(default_factory=list)


@dataclass
class _Row:
    cells: list[list[str]] = field(default_factory=list)


@dataclass
class _Fact:
    context_ref: str | None
    concept: str | None
    unit_ref: str | None
    scale: str | None
    sign: str | None
    nil: bool
    continued: bool
    text: list[str] = field(default_factory=list)
    row: _Row | None = None
    cell_index: int | None = None
    order: int = 0


@dataclass
class _CandidateFact:
    member: str
    value: Decimal
    label: str
    order: int


@dataclass
class _Group:
    axis: str
    other_dimensions: tuple[tuple[str, str], ...]
    facts: dict[str, _CandidateFact] = field(default_factory=dict)
    conflict: bool = False
    first_order: int = 0


def _tag_name(tag: str) -> str:
    return tag.lower()


def _local_name(value: str | None) -> str:
    if not value:
        return ""
    return value.rsplit(":", 1)[-1]


def _normalise_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.replace("\xa0", " ")).strip()


def _valid_date(value: Any) -> bool:
    if not isinstance(value, str) or not _DATE_RE.fullmatch(value):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _decimal_number(value: Any) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, Decimal):
        result = value
    elif isinstance(value, int):
        result = Decimal(value)
    elif isinstance(value, float):
        if not math.isfinite(value):
            return None
        result = Decimal(str(value))
    else:
        return None
    return result if result.is_finite() else None


def _parse_numeric_text(parts: Iterable[str], scale: str | None, sign: str | None) -> Decimal | None:
    text = _normalise_text("".join(parts))
    if not text or text in {"-", "—", "–"}:
        return None
    negative_parentheses = text.startswith("(") and text.endswith(")")
    if negative_parentheses:
        text = text[1:-1].strip()
    text = text.replace(",", "").replace(" ", "").replace("$", "")
    text = text.replace("−", "-")
    if not _NUMBER_RE.fullmatch(text):
        return None
    try:
        result = Decimal(text)
    except InvalidOperation:
        return None

    if sign not in (None, "", "+", "-"):
        return None
    if sign == "-" or negative_parentheses:
        result = -abs(result)
    elif sign == "+":
        result = abs(result)

    scale_value = 0
    if scale not in (None, ""):
        if not re.fullmatch(r"[+-]?\d+", scale):
            return None
        try:
            scale_value = int(scale)
        except ValueError:
            return None
        if abs(scale_value) > 18:
            return None
    result *= Decimal(10) ** scale_value
    return result if result.is_finite() else None


def _is_usd_unit(unit_ref: str | None, units: dict[str, _Unit]) -> bool:
    if not unit_ref:
        return False
    ref = unit_ref.strip()
    if not ref:
        return False
    unit = units.get(ref)
    if unit is not None:
        if len(unit.measures) != 1:
            return False
        measure = unit.measures[0].strip()
        return _local_name(measure).upper() == "USD" and (
            ":" not in measure or measure.lower().startswith("iso4217:")
        )
    # Small issuer snippets sometimes omit the unit declaration.  Accept only
    # an unambiguous USD reference; a shares/pure/ratio unit remains rejected.
    return ref.upper() in {"USD", "U_USD"}


def _clean_row_label(value: str) -> str:
    value = _normalise_text(value).strip(" :")
    value = re.sub(r"\s*(?:\*+|†+|‡+|\[\d+\]|\(\d+\))$", "", value).strip(" :")
    return value


def _member_label(member: str) -> str:
    local = _local_name(member)
    local = re.sub(r"(?:Segment)?Member$", "", local)
    if not local:
        return member
    parts = re.findall(
        r"[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|\d+", local
    )
    if not parts:
        return local
    if len(parts) == 2 and parts[0] == "I" and parts[1] in {"Phone", "Pad"}:
        return "i" + parts[1]
    rendered: list[str] = []
    for part in parts:
        if part.upper() in {"AWS", "APAC", "EMEA", "EU"}:
            rendered.append(part.upper())
        elif part.lower() in {"and", "of", "the"}:
            rendered.append(part.lower())
        else:
            rendered.append(part)
    return " ".join(rendered)


def _fact_label(fact: _Fact, member: str) -> str:
    if fact.row is not None and fact.cell_index is not None:
        for cell in fact.row.cells[: fact.cell_index]:
            candidate = _clean_row_label("".join(cell))
            if candidate and re.search(r"[A-Za-z]", candidate):
                return candidate
    return _member_label(member)


def _looks_like_subtotal(fact: _CandidateFact) -> bool:
    label = _normalise_text(fact.label)
    local = _member_label(fact.member)
    return bool(_SUBTOTAL_RE.fullmatch(label) or _SUBTOTAL_RE.fullmatch(local))


def _can_sum_nonempty_subset(values: list[Decimal], target: Decimal, excluded: int) -> bool:
    """Return whether at least two other nonnegative values equal target.

    Segment groups in issuer statements are small.  The bounded state set
    avoids exponential subset enumeration while retaining exact Decimal
    arithmetic; once the state set becomes unusually large the group is
    treated conservatively and only direct subset candidates are considered.
    """

    if target <= 0:
        return False
    states: set[tuple[Decimal, int]] = {(Decimal(0), 0)}
    for index, value in enumerate(values):
        if index == excluded or value < 0:
            continue
        additions = {(total + value, count + 1) for total, count in states}
        states.update(additions)
        if any(total == target and count >= 2 for total, count in additions):
            return True
        if len(states) > 100_000:
            break
    return any(total == target and count >= 2 for total, count in states)


def _without_subtotals(group: _Group, expected: Decimal) -> tuple[list[_CandidateFact], int] | None:
    if group.conflict or len(group.facts) < 2:
        return None
    facts = sorted(group.facts.values(), key=lambda fact: fact.order)
    values = [fact.value for fact in facts]
    removed: set[int] = {
        index for index, fact in enumerate(facts) if _looks_like_subtotal(fact)
    }
    for index, fact in enumerate(facts):
        if index in removed or fact.value < 0:
            continue
        if _can_sum_nonempty_subset(values, fact.value, index):
            removed.add(index)
    leaves = [fact for index, fact in enumerate(facts) if index not in removed]
    if len(leaves) < 2 or any(fact.value < 0 for fact in leaves):
        return None
    if sum((fact.value for fact in leaves), Decimal(0)) != expected:
        return None
    return leaves, len(removed)


class _InlineXbrlParser(HTMLParser):
    """Small fail-closed parser for the context/fact subset we need."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.contexts: list[_Context] = []
        self.units: dict[str, _Unit] = {}
        self.facts: list[_Fact] = []
        self.malformed = False
        self._relevant_stack: list[str] = []
        self._context: _Context | None = None
        self._unit: _Unit | None = None
        self._capture: tuple[str, Any] | None = None
        self._capture_text: list[str] = []
        self._fact: _Fact | None = None
        self._rows: list[_Row] = []
        self._cell_indices: list[int | None] = []
        self._fact_order = 0

    def _push_relevant(self, tag: str) -> None:
        if tag in _TRACKED_TAGS:
            self._relevant_stack.append(tag)

    def _pop_relevant(self, tag: str) -> None:
        if tag not in _TRACKED_TAGS:
            return
        if not self._relevant_stack or self._relevant_stack[-1] != tag:
            self.malformed = True
            return
        self._relevant_stack.pop()

    def handle_starttag(self, raw_tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        tag = _tag_name(raw_tag)
        attrs = {key.lower(): value for key, value in attrs_list}
        self._push_relevant(tag)

        if tag == "tr":
            # Presentation tables may be nested inside a cell.  Keep row
            # metadata in a stack and leave strict malformed checks to the
            # XBRL context/fact tags above.
            self._rows.append(_Row())
            self._cell_indices.append(None)
        elif tag in {"td", "th"}:
            if self._rows:
                row = self._rows[-1]
                row.cells.append([])
                self._cell_indices[-1] = len(row.cells) - 1
        elif tag == "xbrli:context":
            if self._context is not None:
                self.malformed = True
            context_id = _normalise_text(attrs.get("id") or "")
            if not context_id or any(item.context_id == context_id for item in self.contexts):
                self.malformed = True
            self._context = _Context(context_id=context_id)
        elif tag == "xbrli:unit":
            if self._unit is not None:
                self.malformed = True
            unit_id = _normalise_text(attrs.get("id") or "")
            if not unit_id or unit_id in self.units:
                self.malformed = True
            self._unit = _Unit(unit_id=unit_id)
        elif tag in {"xbrli:startdate", "xbrli:enddate"}:
            if self._context is None or self._capture is not None:
                self.malformed = True
            else:
                self._capture = (tag, self._context)
                self._capture_text = []
        elif tag == "xbrldi:explicitmember":
            if self._context is None or self._capture is not None:
                self.malformed = True
            else:
                dimension = _normalise_text(attrs.get("dimension") or "")
                if not dimension:
                    self.malformed = True
                self._capture = ("member", (self._context, dimension))
                self._capture_text = []
        elif tag == "xbrldi:typedmember":
            if self._context is not None:
                self._context.has_typed_member = True
        elif tag == "xbrli:measure":
            if self._unit is None or self._capture is not None:
                self.malformed = True
            else:
                self._capture = ("measure", self._unit)
                self._capture_text = []
        elif tag == "ix:nonfraction":
            if self._fact is not None:
                self.malformed = True
            nil = any(key.endswith(":nil") or key == "nil" for key in attrs) and any(
                str(value).lower() == "true"
                for key, value in attrs.items()
                if key.endswith(":nil") or key == "nil"
            )
            self._fact = _Fact(
                context_ref=attrs.get("contextref"),
                concept=attrs.get("name"),
                unit_ref=attrs.get("unitref"),
                scale=attrs.get("scale"),
                sign=attrs.get("sign"),
                nil=nil,
                continued=bool(attrs.get("continuedat")),
                row=self._rows[-1] if self._rows else None,
                cell_index=self._cell_indices[-1] if self._cell_indices else None,
                order=self._fact_order,
            )
            self._fact_order += 1

    def handle_startendtag(self, raw_tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(raw_tag, attrs_list)
        self.handle_endtag(raw_tag)

    def handle_endtag(self, raw_tag: str) -> None:
        tag = _tag_name(raw_tag)
        if tag == "ix:nonfraction":
            if self._fact is None:
                self.malformed = True
            else:
                self.facts.append(self._fact)
                self._fact = None
        elif tag in {"xbrli:startdate", "xbrli:enddate", "xbrldi:explicitmember", "xbrli:measure"}:
            if self._capture is None:
                self.malformed = True
            else:
                kind, target = self._capture
                text = _normalise_text("".join(self._capture_text))
                if kind == "xbrli:startdate" and isinstance(target, _Context):
                    target.start = text
                elif kind == "xbrli:enddate" and isinstance(target, _Context):
                    target.end = text
                elif kind == "member" and isinstance(target, tuple):
                    context, dimension = target
                    if not text or any(item[0] == dimension for item in context.dimensions):
                        if any(item[0] == dimension for item in context.dimensions):
                            self.malformed = True
                    else:
                        context.dimensions.append((dimension, text))
                elif kind == "measure" and isinstance(target, _Unit):
                    if text:
                        target.measures.append(text)
                    else:
                        self.malformed = True
                self._capture = None
                self._capture_text = []
        elif tag == "xbrli:context":
            if self._context is None:
                self.malformed = True
            else:
                self.contexts.append(self._context)
                self._context = None
        elif tag == "xbrli:unit":
            if self._unit is None:
                self.malformed = True
            else:
                self.units[self._unit.unit_id] = self._unit
                self._unit = None
        elif tag in {"td", "th"}:
            if self._cell_indices:
                self._cell_indices[-1] = None
        elif tag == "tr":
            if self._rows:
                self._rows.pop()
                self._cell_indices.pop()

        self._pop_relevant(tag)

    def handle_data(self, data: str) -> None:
        if self._fact is not None:
            self._fact.text.append(data)
        if self._capture is not None:
            self._capture_text.append(data)
        if self._rows and self._cell_indices[-1] is not None:
            self._rows[-1].cells[self._cell_indices[-1]].append(data)

    def finish(self) -> None:
        if self._fact is not None or self._context is not None or self._unit is not None:
            self.malformed = True
        if self._capture is not None or self._relevant_stack:
            self.malformed = True


def _axis_basis(axis: str) -> str:
    if axis == PRODUCT_AXIS:
        return "제품별 매출"
    if axis == BUSINESS_AXIS:
        return "사업부별 매출"
    return "세그먼트별 매출"


def _output_number(value: Decimal) -> int | float:
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def extract_revenue_segments(
    ticker: str,
    html: str | bytes,
    start: str,
    end: str,
    expected_revenue: int | float | Decimal,
) -> dict[str, Any] | None:
    """Return one exact-period, reconciled revenue segment group or ``None``.

    ``expected_revenue`` is an absolute USD amount.  The returned ``revenue``
    values use the same absolute USD unit, regardless of an inline fact's
    presentation scale (for example, ``scale=6`` for USD millions).
    """

    if not isinstance(ticker, str) or not ticker.strip():
        return None
    ticker_key = ticker.strip().upper()
    if not _valid_date(start) or not _valid_date(end) or start >= end:
        return None
    expected = _decimal_number(expected_revenue)
    if expected is None or expected <= 0:
        return None
    if not isinstance(html, (str, bytes)):
        return None
    if isinstance(html, bytes):
        try:
            html = html.decode("utf-8")
        except UnicodeDecodeError:
            return None

    parser = _InlineXbrlParser()
    try:
        parser.feed(html)
        parser.close()
        parser.finish()
    except (AssertionError, HTMLParserError, ValueError, TypeError):
        return None
    except Exception:
        # HTMLParser is intentionally treated as an untrusted input boundary;
        # a malformed issuer response must never reach the earnings document.
        return None
    if parser.malformed:
        return None

    contexts = {
        context.context_id: context
        for context in parser.contexts
        if context.start == start and context.end == end and _valid_date(context.start) and _valid_date(context.end)
    }
    if not contexts:
        return None

    groups: dict[tuple[str, tuple[tuple[str, str], ...]], _Group] = {}
    for fact in parser.facts:
        if fact.nil or fact.continued:
            continue
        concept = fact.concept or ""
        prefix, separator, local = concept.rpartition(":")
        if local != REVENUE_CONCEPT or (separator and prefix != "us-gaap"):
            continue
        context = contexts.get(fact.context_ref or "")
        if context is None or context.has_typed_member or not _is_usd_unit(fact.unit_ref, parser.units):
            continue
        value = _parse_numeric_text(fact.text, fact.scale, fact.sign)
        if value is None:
            continue
        axes = {dimension for dimension, _member in context.dimensions}
        for axis in axes:
            members = [member for dimension, member in context.dimensions if dimension == axis]
            if len(members) != 1:
                continue
            other_dimensions = tuple(
                sorted((dimension, member) for dimension, member in context.dimensions if dimension != axis)
            )
            key = (axis, other_dimensions)
            group = groups.setdefault(
                key,
                _Group(axis=axis, other_dimensions=other_dimensions, first_order=fact.order),
            )
            member = members[0]
            candidate = _CandidateFact(
                member=member,
                value=value,
                label=_fact_label(fact, member),
                order=fact.order,
            )
            prior = group.facts.get(member)
            if prior is None:
                group.facts[member] = candidate
            elif prior.value != value:
                group.conflict = True
            elif len(candidate.label) > len(prior.label) and candidate.label == _member_label(member):
                group.facts[member] = candidate

    valid: list[tuple[_Group, list[_CandidateFact], int]] = []
    for group in groups.values():
        result = _without_subtotals(group, expected)
        if result is not None:
            leaves, removed = result
            valid.append((group, leaves, removed))
    if not valid:
        return None

    preferred = _PREFERRED_AXES.get(ticker_key, _AXIS_ORDER)
    axis_rank = {axis: index for index, axis in enumerate(preferred)}
    valid.sort(
        key=lambda item: (
            axis_rank.get(item[0].axis, len(preferred)),
            -len(item[1]),
            item[0].first_order,
        )
    )
    group, leaves, removed = valid[0]
    notes = ["공시의 분기별 사업 매출 합계를 전체 매출과 대조했습니다."]
    if removed:
        notes.append("합계 항목은 제외하고 세부 매출만 합산했습니다.")
    return {
        "segments": [
            {"name": fact.label, "revenue": _output_number(fact.value)}
            for fact in leaves
        ],
        "segmentBasis": _axis_basis(group.axis),
        "notes": notes,
    }


# HTMLParser does not expose a public parser exception type.  Keeping this
# alias local makes the guarded boundary above explicit without importing an
# implementation-private class.
HTMLParserError = RuntimeError


__all__ = ["extract_revenue_segments"]
