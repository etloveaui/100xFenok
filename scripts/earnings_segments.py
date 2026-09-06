#!/usr/bin/env python3
"""Extract reconciled revenue segments from an issuer's inline-XBRL HTML.

The extractor deliberately has no network or filing-selection policy.  The
caller supplies the HTML, the exact period start/end dates, and the already
verified absolute revenue total.  Only revenue facts whose contexts match
those dates and whose unit is USD are considered.

Microsoft's official earnings release is a controlled exception: its segment
results are published as a plain HTML table rather than inline XBRL.  That
fallback still requires a dated GAAP quarter header, a table unit, and an
exact reconciliation to the caller-supplied total.
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
_PLAIN_SEGMENT_TITLE_RE = re.compile(
    r"\bsegment\s+(?:results?|revenues?)\b", re.IGNORECASE
)
_PLAIN_NON_GAAP_RE = re.compile(
    r"\bnon\s*[-\u2010\u2011\u2012\u2013\u2014]?\s*gaap\b|\bconstant\s+currency\b",
    re.IGNORECASE,
)
_PLAIN_UNIT_RE = re.compile(r"\bin\s+millions\b", re.IGNORECASE)
_PLAIN_QUARTER_RE = re.compile(r"\bthree\s+months?\s+ended\b", re.IGNORECASE)
_PLAIN_YEAR_RE = re.compile(r"(?<!\d)(\d{4})(?!\d)")
_PLAIN_REVENUE_RE = re.compile(r"^revenues?$", re.IGNORECASE)
_PLAIN_METRIC_RE = re.compile(
    r"^(?:cost(?:\s+of)?\s+revenue|operating\s+(?:expenses?|income)|"
    r"net\s+(?:income|sales)|gross\s+profit|total(?:\s+revenue|\s+sales|\s+net\s+sales)?|"
    r"revenue\s+growth|percentage\s+change.*)$",
    re.IGNORECASE,
)
_FACT_METRIC_LABEL_RE = re.compile(
    r"^(?:revenues?|net\s+sales|cost(?:\s+of)?\s+revenue|"
    r"operating\s+(?:expenses?|income)|net\s+income|gross\s+profit|"
    r"total(?:\s+revenue|\s+sales|\s+net\s+sales)?)$",
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
class _PlainCell:
    text: list[str] = field(default_factory=list)
    colspan: int = 1
    rowspan: int = 1


@dataclass
class _PlainRow:
    cells: list[_PlainCell] = field(default_factory=list)


@dataclass
class _PlainTable:
    table_id: str | None = None
    caption: list[str] = field(default_factory=list)
    rows: list[_PlainRow] = field(default_factory=list)


@dataclass
class _PlainTableFrame:
    table: _PlainTable
    row: _PlainRow | None = None
    cell_index: int | None = None
    in_caption: bool = False


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
    value = re.sub(
        r"\s*(?:\*+|†+|‡+|®+|™+|\[\d+\]|\(\d+\))$", "", value
    ).strip(" :")
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
            if (
                candidate
                and re.search(r"[A-Za-z]", candidate)
                and not _FACT_METRIC_LABEL_RE.fullmatch(candidate)
            ):
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
        self._fact_stack: list[_Fact] = []
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
                # Inline XBRL permits a fact to contain another fact when a
                # narrative value embeds a more specific tagged value (for
                # example, a par-value statement).  Keep the outer fact on a
                # stack so the inner fact cannot invalidate the whole filing.
                self._fact_stack.append(self._fact)
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
                self._fact = self._fact_stack.pop() if self._fact_stack else None
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
        if (
            self._fact is not None
            or self._fact_stack
            or self._context is not None
            or self._unit is not None
        ):
            self.malformed = True
        if self._capture is not None or self._relevant_stack:
            self.malformed = True


class _PlainHtmlTableParser(HTMLParser):
    """Collect table cells without imposing XML-like nesting on HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[_PlainTable] = []
        self._stack: list[_PlainTableFrame] = []

    @staticmethod
    def _span(attrs: dict[str, str | None], name: str) -> int:
        value = attrs.get(name)
        if value is None or not re.fullmatch(r"\d+", value.strip()):
            return 1
        return max(1, min(64, int(value)))

    def handle_starttag(self, raw_tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        tag = _tag_name(raw_tag)
        attrs = {key.lower(): value for key, value in attrs_list}
        if tag == "table":
            table = _PlainTable(table_id=attrs.get("id"))
            self.tables.append(table)
            self._stack.append(_PlainTableFrame(table=table))
            return
        if not self._stack:
            return
        frame = self._stack[-1]
        if tag == "caption":
            frame.in_caption = True
        elif tag == "tr":
            frame.row = _PlainRow()
            frame.table.rows.append(frame.row)
            frame.cell_index = None
        elif tag in {"td", "th"} and frame.row is not None:
            frame.row.cells.append(
                _PlainCell(
                    colspan=self._span(attrs, "colspan"),
                    rowspan=self._span(attrs, "rowspan"),
                )
            )
            frame.cell_index = len(frame.row.cells) - 1

    def handle_startendtag(self, raw_tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(raw_tag, attrs_list)
        self.handle_endtag(raw_tag)

    def handle_endtag(self, raw_tag: str) -> None:
        tag = _tag_name(raw_tag)
        if tag == "table":
            if self._stack:
                self._stack.pop()
            return
        if not self._stack:
            return
        frame = self._stack[-1]
        if tag == "caption":
            frame.in_caption = False
        elif tag in {"td", "th"}:
            frame.cell_index = None
        elif tag == "tr":
            frame.row = None
            frame.cell_index = None

    def handle_data(self, data: str) -> None:
        if not self._stack:
            return
        frame = self._stack[-1]
        if frame.in_caption:
            frame.table.caption.append(data)
        if frame.row is not None and frame.cell_index is not None:
            frame.row.cells[frame.cell_index].text.append(data)


def _plain_cell_text(cell: _PlainCell) -> str:
    return _normalise_text("".join(cell.text))


def _expand_plain_rows(table: _PlainTable) -> list[list[str]]:
    """Expand HTML spans into column-addressable rows.

    The Microsoft release uses a separator column between each current/prior
    value and groups the quarter and annual headers with ``colspan``.  Keeping
    the expansion local to the fallback makes the column lookup deterministic
    while tolerating the issuer's empty spacer cells and ``rowspan`` headers.
    """

    rows: list[list[str]] = []
    active: dict[int, tuple[str, int]] = {}
    for source_row in table.rows:
        occupied = {column: text for column, (text, _remaining) in active.items()}
        column = 0
        for cell in source_row.cells:
            while column in occupied:
                column += 1
            text = _plain_cell_text(cell)
            for offset in range(cell.colspan):
                target = column + offset
                occupied[target] = text
                if cell.rowspan > 1:
                    active[target] = (text, cell.rowspan)
            column += cell.colspan

        if occupied:
            width = max(occupied) + 1
            rows.append([occupied.get(index, "") for index in range(width)])
        else:
            rows.append([])

        next_active: dict[int, tuple[str, int]] = {}
        for target, (text, remaining) in active.items():
            if remaining > 1:
                next_active[target] = (text, remaining - 1)
        active = next_active
    return rows


def _plain_table_text(table: _PlainTable) -> str:
    parts = [_normalise_text("".join(table.caption))]
    for row in table.rows:
        parts.extend(_plain_cell_text(cell) for cell in row.cells)
    return _normalise_text(" ".join(parts))


def _plain_table_title(table: _PlainTable, rows: list[list[str]]) -> str:
    parts = [_normalise_text("".join(table.caption))]
    # Issuer table titles and units appear before the body.  Limiting this
    # scan prevents a distant narrative footnote from becoming a title.
    for row in rows[:12]:
        parts.extend(text for text in row if text)
    return _normalise_text(" ".join(parts))


def _plain_date_in_header(text: str, period_end: date) -> bool:
    text = _normalise_text(text).lower()
    month_name = period_end.strftime("%B").lower()
    month_abbreviation = period_end.strftime("%b").lower().rstrip(".")
    day = str(period_end.day)
    if re.search(
        rf"\b(?:{re.escape(month_name)}|{re.escape(month_abbreviation)})\s+0?{day}\b",
        text,
    ):
        return True
    if re.search(rf"\b0?{period_end.month}[/-]0?{period_end.day}\b", text):
        return True
    return bool(
        re.search(
            rf"\b0?{period_end.day}\s+(?:{re.escape(month_name)}|{re.escape(month_abbreviation)})\b",
            text,
        )
    )


def _plain_year(text: str, year: int) -> bool:
    return any(int(match) == year for match in _PLAIN_YEAR_RE.findall(text))


def _plain_quarter_column(rows: list[list[str]], period_end: date) -> tuple[int, int] | None:
    """Find the current quarter value column and its header row.

    A valid candidate must expose both the exact quarter end date and the
    current/prior end years inside that quarter's header span.  Annual columns
    therefore cannot be mistaken for the requested quarter.
    """

    current_year = period_end.year
    prior_year = current_year - 1
    for header_index, row in enumerate(rows):
        for column, text in enumerate(row):
            if not text or not _PLAIN_QUARTER_RE.search(text):
                continue

            span_start = column
            while span_start > 0 and row[span_start - 1] == text:
                span_start -= 1
            span_end = column
            while span_end + 1 < len(row) and row[span_end + 1] == text:
                span_end += 1

            date_in_span = _plain_date_in_header(text, period_end)
            if not date_in_span:
                # Some releases put the period label and its month/day on
                # adjacent header rows while keeping the same colspan.
                for date_row in rows[header_index + 1 : header_index + 4]:
                    if any(
                        index < len(date_row)
                        and _plain_date_in_header(date_row[index], period_end)
                        for index in range(span_start, span_end + 1)
                    ):
                        date_in_span = True
                        break
            if not date_in_span:
                continue

            search_end = min(len(rows), header_index + 10)
            for year_row in rows[header_index + 1 : search_end]:
                current_columns = [
                    index
                    for index in range(span_start, span_end + 1)
                    if index < len(year_row) and _plain_year(year_row[index], current_year)
                ]
                prior_columns = [
                    index
                    for index in range(span_start, span_end + 1)
                    if index < len(year_row) and _plain_year(year_row[index], prior_year)
                ]
                if current_columns and prior_columns and current_columns[0] != prior_columns[0]:
                    return current_columns[0], header_index
    return None


def _plain_number(text: str) -> Decimal | None:
    """Parse one displayed amount, preserving its sign and blank markers."""

    value = _parse_numeric_text([text], None, None)
    if value is not None:
        return value
    # A small number of issuer tables append footnote marks directly to the
    # amount.  Strip only terminal marks after a failed strict parse.
    cleaned = re.sub(r"(?<=\d)[*\u2020\u2021]+$", "", _normalise_text(text)).strip()
    if cleaned != text:
        return _parse_numeric_text([cleaned], None, None)
    return None


def _plain_row_label(row: list[str], current_column: int) -> str:
    # Labels are normally in the first cell.  Looking through the current
    # column as well handles a leading blank label cell without treating an
    # amount as text.
    for text in row[: max(1, current_column + 1)]:
        label = _clean_row_label(text).rstrip(" :")
        if label and re.search(r"[A-Za-z]", label) and _plain_number(label) is None:
            return label
    return ""


def _plain_revenue_marker(label: str) -> bool:
    return bool(_PLAIN_REVENUE_RE.fullmatch(_normalise_text(label).rstrip(" :")))


def _plain_metric_label(label: str) -> bool:
    return bool(_PLAIN_METRIC_RE.fullmatch(_normalise_text(label).rstrip(" :")))


def _plain_segment_label(label: str) -> bool:
    label = _normalise_text(label).rstrip(" :")
    if not label or not re.search(r"[A-Za-z]", label):
        return False
    if _plain_revenue_marker(label) or _plain_metric_label(label):
        return False
    if _SUBTOTAL_RE.fullmatch(label):
        return False
    return True


def _plain_segment_value(row: list[str], current_column: int) -> Decimal | None:
    if current_column >= len(row):
        return None
    value = _plain_number(row[current_column])
    if value is None or value <= 0:
        return None
    return value * Decimal(1_000_000)


def _plain_heading_revenue_rows(
    rows: list[list[str]], current_column: int, start_row: int
) -> list[tuple[str, Decimal]]:
    """Read ``segment heading`` followed by a ``Revenue`` row tables."""

    records: list[tuple[str, Decimal]] = []
    pending_segment = ""
    for row in rows[start_row:]:
        label = _plain_row_label(row, current_column)
        if _plain_revenue_marker(label):
            if pending_segment:
                value = _plain_segment_value(row, current_column)
                if value is not None:
                    records.append((pending_segment, value))
            pending_segment = ""
            continue
        if not label or _plain_metric_label(label):
            pending_segment = ""
            continue
        if _plain_segment_label(label) and not any(
            _plain_number(text) is not None for text in row
        ):
            pending_segment = label
        else:
            pending_segment = ""
    return records


def _plain_revenue_section_rows(
    rows: list[list[str]], current_column: int, start_row: int
) -> list[tuple[str, Decimal]]:
    """Read a ``Revenue`` marker followed by segment-name rows."""

    records: list[tuple[str, Decimal]] = []
    index = start_row
    while index < len(rows):
        label = _plain_row_label(rows[index], current_column)
        if not _plain_revenue_marker(label):
            index += 1
            continue
        index += 1
        while index < len(rows):
            row = rows[index]
            label = _plain_row_label(row, current_column)
            if not label:
                index += 1
                continue
            if not _plain_segment_label(label):
                break
            value = _plain_segment_value(row, current_column)
            if value is None:
                break
            records.append((label, value))
            index += 1
    return records


def _plain_reconciled_segments(
    records: list[tuple[str, Decimal]], expected: Decimal
) -> list[dict[str, int | float | str]] | None:
    if len(records) < 2:
        return None
    names = [name for name, _value in records]
    if len(set(names)) != len(names):
        return None
    if sum((value for _name, value in records), Decimal(0)) != expected:
        return None
    return [
        {"name": name, "revenue": _output_number(value)}
        for name, value in records
    ]


def _extract_msft_plain_segments(
    html: str, start: str, end: str, expected: Decimal
) -> dict[str, Any] | None:
    if not _valid_date(start) or not _valid_date(end) or start >= end:
        return None
    try:
        period_start = date.fromisoformat(start)
        period_end = date.fromisoformat(end)
    except ValueError:
        return None

    # The release's segment table is a calendar quarter even though MSFT's
    # fiscal year ends in June.  Refuse YTD and other arbitrary spans before
    # inspecting table text.
    if period_end.month not in {3, 6, 9, 12} or period_start.day != 1:
        return None
    expected_start = date(period_end.year, period_end.month - 2, 1)
    following_month = period_end.month + 1
    following_year = period_end.year
    if following_month == 13:
        following_month = 1
        following_year += 1
    following_start = date(following_year, following_month, 1)
    if period_start != expected_start or period_end != date.fromordinal(
        following_start.toordinal() - 1
    ):
        return None

    parser = _PlainHtmlTableParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return None
    if parser._stack:
        return None

    for table in parser.tables:
        rows = _expand_plain_rows(table)
        title = _plain_table_title(table, rows)
        table_text = _plain_table_text(table)
        if not _PLAIN_SEGMENT_TITLE_RE.search(title):
            continue
        if _PLAIN_NON_GAAP_RE.search(table_text) or not _PLAIN_UNIT_RE.search(table_text):
            continue
        header = _plain_quarter_column(rows, period_end)
        if header is None:
            continue
        current_column, header_row = header
        start_row = header_row + 1
        candidates = (
            _plain_heading_revenue_rows(rows, current_column, start_row),
            _plain_revenue_section_rows(rows, current_column, start_row),
        )
        for records in candidates:
            segments = _plain_reconciled_segments(records, expected)
            if segments is not None:
                return {
                    "segments": segments,
                    "segmentBasis": "사업부별 매출",
                    "notes": [
                        "공시의 분기별 사업 매출 합계를 전체 매출과 대조했습니다.",
                        "공시 표의 백만 달러 금액을 달러 단위로 환산했습니다.",
                    ],
                }
    return None


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
        return _extract_msft_plain_segments(html, start, end, expected) if ticker_key == "MSFT" else None
    except Exception:
        # HTMLParser is intentionally treated as an untrusted input boundary;
        # a malformed issuer response must never reach the earnings document.
        return _extract_msft_plain_segments(html, start, end, expected) if ticker_key == "MSFT" else None
    if parser.malformed:
        return None

    contexts = {
        context.context_id: context
        for context in parser.contexts
        if context.start == start and context.end == end and _valid_date(context.start) and _valid_date(context.end)
    }
    if not contexts:
        return _extract_msft_plain_segments(html, start, end, expected) if ticker_key == "MSFT" else None

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
        return _extract_msft_plain_segments(html, start, end, expected) if ticker_key == "MSFT" else None

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
