#!/usr/bin/env python3
"""Build a bounded official-source quarterly earnings document.

The normalizer is pure with respect to its inputs. Network access is kept in
the explicit refresh CLI path so a failed refresh can retain the last
validated document.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import date, datetime, timezone
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from typing import Any, Iterable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SUPPORTED_COMPANIES: dict[str, dict[str, str]] = {
    "AAPL": {"cik": "0000320193", "companyName": "Apple Inc."},
    "AMZN": {"cik": "0001018724", "companyName": "Amazon.com, Inc."},
    "MSFT": {"cik": "0000789019", "companyName": "Microsoft Corporation"},
    "META": {"cik": "0001326801", "companyName": "Meta Platforms, Inc."},
}

METRICS = (
    "revenue",
    "costOfRevenue",
    "grossProfit",
    "operatingExpenses",
    "operatingIncome",
    "pretaxIncome",
    "incomeTax",
    "netIncome",
    "dilutedEps",
)

CONCEPTS: dict[str, tuple[str, ...]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "SalesRevenueNet",
        "Revenues",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
    ),
    "costOfRevenue": ("CostOfGoodsAndServicesSold", "CostOfRevenue"),
    "grossProfit": ("GrossProfit",),
    "operatingExpenses": ("OperatingExpenses",),
    "operatingIncome": ("OperatingIncomeLoss",),
    "pretaxIncome": (
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
        "IncomeBeforeTaxExpenseBenefit",
    ),
    "incomeTax": ("IncomeTaxExpenseBenefit",),
    "netIncome": ("NetIncomeLoss",),
    "dilutedEps": ("EarningsPerShareDiluted",),
}

SEC_COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
MSFT_RELEASE_BASE = "https://www.microsoft.com/en-us/investor/earnings"
MAX_PERIODS = 8
DIRECT_QUARTER_DAYS = (70, 110)
YTD_DAYS = (150, 299)
ANNUAL_DAYS = (300, 380)
OFFICIAL_REQUEST_INTERVAL_SECONDS = 0.5


def _normalise_cik(value: Any) -> str:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return ""
    return str(number).zfill(10)


def _iso_timestamp(value: Any) -> str:
    if value is None:
        parsed = datetime.now(timezone.utc)
    elif isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _finite_number(value: Any) -> int | float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return value if math.isfinite(float(value)) else None
        except (OverflowError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


def _close(left: int | float, right: int | float) -> bool:
    return math.isclose(float(left), float(right), rel_tol=1e-9, abs_tol=1.0)


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def _source_url(cik: str, accession: str) -> str:
    accession = accession.strip()
    if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
        raise ValueError("invalid SEC accession")
    accession_digits = accession.replace("-", "")
    return (
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
        f"{accession_digits}/{accession}-index.html"
    )


def _source_from_observation(cik: str, observation: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": "SEC 공식 제출자료",
        "url": _source_url(cik, str(observation["accn"])),
        "filedAt": observation.get("filed"),
    }


def _duration_kind(observation: Mapping[str, Any]) -> str | None:
    start = _date(observation.get("start"))
    end = _date(observation.get("end"))
    if start is None or end is None or end < start:
        return None
    days = (end - start).days + 1
    if DIRECT_QUARTER_DAYS[0] <= days <= DIRECT_QUARTER_DAYS[1]:
        return "quarter"
    if YTD_DAYS[0] <= days <= YTD_DAYS[1]:
        return "ytd"
    if ANNUAL_DAYS[0] <= days <= ANNUAL_DAYS[1]:
        return "annual"
    return None


def _raw_units(fact: Mapping[str, Any], metric: str) -> list[Any]:
    units = fact.get("units")
    if not isinstance(units, Mapping):
        return []
    names = ("USD/shares", "USD/share") if metric == "dilutedEps" else ("USD",)
    for name in names:
        values = units.get(name)
        if isinstance(values, list):
            return values
    return []


def _iter_metric_observations(
    companyfacts: Mapping[str, Any], metric: str
) -> Iterable[dict[str, Any]]:
    facts = companyfacts.get("facts")
    if not isinstance(facts, Mapping):
        return
    namespace = "us-gaap"
    namespace_facts = facts.get(namespace)
    if not isinstance(namespace_facts, Mapping):
        return
    for concept in CONCEPTS[metric]:
        fact = namespace_facts.get(concept)
        if not isinstance(fact, Mapping):
            continue
        for raw in _raw_units(fact, metric):
            if not isinstance(raw, Mapping):
                continue
            start = _date(raw.get("start"))
            end = _date(raw.get("end"))
            filed = _date(raw.get("filed"))
            value = _finite_number(raw.get("val"))
            accession = str(raw.get("accn") or "").strip()
            form = str(raw.get("form") or "").upper()
            kind = _duration_kind(raw)
            if (
                start is None
                or end is None
                or filed is None
                or value is None
                or form not in {"10-Q", "10-K"}
                or not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession)
                or kind is None
            ):
                continue
            observation = dict(raw)
            observation.update(
                {
                    "metric": metric,
                    "namespace": namespace,
                    "concept": concept,
                    "unit": "USD/shares" if metric == "dilutedEps" else "USD",
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "filed": filed.isoformat(),
                    "form": form,
                    "value": value,
                    "kind": kind,
                }
            )
            yield observation


def _invalid_ends(companyfacts: Mapping[str, Any]) -> set[str]:
    """Return period ends containing a structurally valid but nonnumeric fact."""
    invalid: set[str] = set()
    facts = companyfacts.get("facts")
    if not isinstance(facts, Mapping):
        return invalid
    namespace_facts = facts.get("us-gaap")
    if not isinstance(namespace_facts, Mapping):
        return invalid
    for metric in METRICS:
        for concept in CONCEPTS[metric]:
            fact = namespace_facts.get(concept)
            if not isinstance(fact, Mapping):
                continue
            for raw in _raw_units(fact, metric):
                if not isinstance(raw, Mapping):
                    continue
                end = _date(raw.get("end"))
                if (
                    end is not None
                    and _date(raw.get("start")) is not None
                    and str(raw.get("form") or "").upper() in {"10-Q", "10-K"}
                    and _finite_number(raw.get("val")) is None
                ):
                    invalid.add(end.isoformat())
    return invalid


def _group_key(observation: Mapping[str, Any]) -> tuple[str, str, str]:
    return (
        str(observation.get("accn") or ""),
        str(observation.get("filed") or ""),
        str(observation.get("form") or ""),
    )


def _selected_observation(
    group: Mapping[str, list[dict[str, Any]]], metric: str
) -> dict[str, Any] | None:
    observations = group.get(metric, [])
    return max(observations, key=_observation_sort_key) if observations else None


def _observation_sort_key(observation: Mapping[str, Any]) -> tuple[str, str, str]:
    return (
        str(observation.get("filed") or ""),
        str(observation.get("accn") or ""),
        str(observation.get("frame") or ""),
    )


def _best_group(
    grouped: Mapping[tuple[str, str, str], Mapping[str, list[dict[str, Any]]]]
) -> tuple[tuple[str, str, str], Mapping[str, list[dict[str, Any]]]] | None:
    if not grouped:
        return None
    candidates = list(grouped.items())
    candidates.sort(
        key=lambda item: (
            bool(item[1].get("revenue")),
            item[0][1],
            item[0][0],
        ),
        reverse=True,
    )
    return candidates[0]


def _fiscal_identity(ticker: str, end: str) -> tuple[int, int]:
    """Infer fiscal year/quarter from period end, never filing metadata."""
    period_end = _date(end)
    if period_end is None:
        raise ValueError("period end is required for fiscal identity")
    month = period_end.month
    if ticker == "MSFT":
        quarter = {9: 1, 12: 2, 3: 3, 6: 4}.get(month, 4)
        fiscal_year = period_end.year + 1 if month >= 7 else period_end.year
    elif ticker == "AAPL":
        # Apple's 13-week quarters can end in the first week of the next
        # calendar month (including 53-week years). Normalize those dates to
        # the preceding standard quarter end before inferring fiscal identity.
        if month == 1 and period_end.day <= 7:
            quarter, fiscal_year = 1, period_end.year
        elif month == 4 and period_end.day <= 7:
            quarter, fiscal_year = 2, period_end.year
        elif month == 7 and period_end.day <= 7:
            quarter, fiscal_year = 3, period_end.year
        elif month == 10 and period_end.day <= 7:
            quarter, fiscal_year = 4, period_end.year
        else:
            quarter = {12: 1, 3: 2, 6: 3, 9: 4}.get(month, 4)
            fiscal_year = period_end.year + 1 if month == 12 else period_end.year
    else:
        quarter = {3: 1, 6: 2, 9: 3, 12: 4}.get(month, 4)
        fiscal_year = period_end.year
    return fiscal_year, quarter


def _period_label(ticker: str, end: str) -> str:
    fiscal_year, quarter = _fiscal_identity(ticker, end)
    return f"FY{fiscal_year} Q{quarter}"


def _msft_quarter_start(end: date) -> date:
    _fiscal_year, quarter = _fiscal_identity("MSFT", end.isoformat())
    if quarter == 1:
        return date(end.year, 7, 1)
    if quarter == 2:
        return date(end.year, 10, 1)
    if quarter == 3:
        return date(end.year, 1, 1)
    return date(end.year, 4, 1)


def _new_income() -> dict[str, int | float | None]:
    return {metric: None for metric in METRICS}


def _validate_and_derive(
    income: dict[str, int | float | None], notes: list[str], identity: str
) -> bool:
    revenue = income["revenue"]
    cost = income["costOfRevenue"]
    gross = income["grossProfit"]
    expenses = income["operatingExpenses"]
    operating = income["operatingIncome"]
    pretax = income["pretaxIncome"]
    tax = income["incomeTax"]
    net = income["netIncome"]

    if gross is None and revenue is not None and cost is not None:
        income["grossProfit"] = revenue - cost
        gross = income["grossProfit"]
        notes.append("매출에서 매출원가를 차감해 매출총이익을 계산했습니다.")
    if expenses is None and gross is not None and operating is not None:
        income["operatingExpenses"] = gross - operating
        expenses = income["operatingExpenses"]
        notes.append("매출총이익에서 영업이익을 차감해 영업비용을 계산했습니다.")
    if pretax is None and net is not None and tax is not None:
        income["pretaxIncome"] = net + tax
        pretax = income["pretaxIncome"]
        notes.append("순이익과 법인세비용을 더해 세전이익을 계산했습니다.")

    if (
        revenue is not None
        and cost is not None
        and gross is not None
        and not _close(gross, revenue - cost)
    ):
        notes.append(f"{identity}: 매출·매출원가·매출총이익이 일치하지 않습니다.")
        return False
    if (
        gross is not None
        and expenses is not None
        and operating is not None
        and not _close(operating, gross - expenses)
    ):
        notes.append(f"{identity}: 영업이익 정합성 검증에 실패했습니다.")
        return False
    if (
        pretax is not None
        and tax is not None
        and net is not None
        and not _close(pretax, net + tax)
    ):
        notes.append(f"{identity}: 세전이익·법인세·순이익이 일치하지 않습니다.")
        return False
    return True


def _period_from_group(
    ticker: str,
    cik: str,
    start: str,
    end: str,
    group: Mapping[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    anchor = _selected_observation(group, "revenue")
    if anchor is None or _finite_number(anchor.get("value")) is None:
        return None
    if float(anchor["value"]) <= 0:
        return None
    income = _new_income()
    for metric in METRICS:
        observation = _selected_observation(group, metric)
        if observation is not None:
            income[metric] = observation["value"]
    notes = ["SEC 공식 제출자료의 실제 분기 관측값입니다."]
    if not _validate_and_derive(income, notes, f"{ticker} {start}/{end}"):
        return None
    return {
        "end": end,
        "label": _period_label(ticker, end),
        "income": income,
        "source": _source_from_observation(cik, anchor),
        "segments": [],
        "segmentBasis": None,
        "notes": notes,
    }


def _long_period_groups(
    observations: Mapping[str, list[dict[str, Any]]], kind: str
) -> dict[
    tuple[str, str], dict[tuple[str, str, str], dict[str, list[dict[str, Any]]]]
]:
    periods: dict[
        tuple[str, str], dict[tuple[str, str, str], dict[str, list[dict[str, Any]]]]
    ] = {}
    for metric, metric_observations in observations.items():
        for observation in metric_observations:
            if observation["kind"] != kind:
                continue
            period_key = (observation["start"], observation["end"])
            filing = periods.setdefault(period_key, {}).setdefault(
                _group_key(observation), {}
            )
            filing.setdefault(metric, []).append(observation)
    return periods


def _direct_periods(
    ticker: str,
    cik: str,
    observations: Mapping[str, list[dict[str, Any]]],
    invalid_ends: set[str],
    errors: list[str],
) -> tuple[list[dict[str, Any]], set[str]]:
    periods = _long_period_groups(observations, "quarter")
    starts_by_end: dict[str, set[str]] = {}
    for metric_observations in observations.values():
        for observation in metric_observations:
            if observation["kind"] == "quarter":
                starts_by_end.setdefault(observation["end"], set()).add(
                    observation["start"]
                )

    by_end: dict[str, list[tuple[str, Mapping[tuple[str, str, str], Mapping[str, list[dict[str, Any]]]]]]] = {}
    for (start, end), grouped in periods.items():
        by_end.setdefault(end, []).append((start, grouped))

    output: list[dict[str, Any]] = []
    used_ends: set[str] = set()
    for end, candidates in sorted(by_end.items(), reverse=True):
        if end in invalid_ends:
            errors.append(f"{ticker} {end}: 숫자가 아닌 관측값을 제외했습니다.")
            continue
        if len(starts_by_end.get(end, set())) > 1:
            errors.append(
                f"{ticker} {end}: 분기 시작일이 서로 달라 기간 정체성을 확인할 수 없습니다."
            )
        # A malformed tag must not create duplicate rows or blend values from
        # different period identities. Prefer the most complete coherent start.
        candidates.sort(
            key=lambda item: (
                sum(len(values) for values in item[1].values()),
                max(
                    (
                        str(observation.get("filed") or "")
                        for filing in item[1].values()
                        for metric_values in filing.values()
                        for observation in metric_values
                    ),
                    default="",
                ),
                item[0],
            ),
            reverse=True,
        )
        start, grouped = candidates[0]
        selected = _best_group(grouped)
        if selected is None:
            continue
        _filing, group = selected
        period = _period_from_group(ticker, cik, start, end, group)
        if period is None:
            errors.append(f"{ticker} {end}: 정합성 검증을 통과한 값이 없습니다.")
            continue
        output.append(period)
        used_ends.add(end)
    return output, used_ends


def _derived_q4_periods(
    ticker: str,
    cik: str,
    observations: Mapping[str, list[dict[str, Any]]],
    used_ends: set[str],
    invalid_ends: set[str],
    errors: list[str],
) -> list[dict[str, Any]]:
    annual_periods = _long_period_groups(observations, "annual")
    ytd_periods = _long_period_groups(observations, "ytd")
    output: list[dict[str, Any]] = []
    for (annual_start, annual_end), annual_grouped in sorted(
        annual_periods.items(), key=lambda item: item[0][1], reverse=True
    ):
        if annual_end in invalid_ends:
            errors.append(f"{ticker} {annual_end}: 숫자가 아닌 관측값을 제외했습니다.")
            continue
        annual_choice = _best_group(annual_grouped)
        if annual_choice is None:
            continue
        annual_key, annual_group = annual_choice
        annual_anchor = _selected_observation(annual_group, "revenue")
        if annual_anchor is None:
            continue
        annual_start_date = _date(annual_start)
        annual_end_date = _date(annual_end)
        if annual_start_date is None or annual_end_date is None:
            continue

        candidates: list[tuple[str, str, Mapping[str, list[dict[str, Any]]]]] = []
        for (ytd_start, ytd_end), ytd_grouped in ytd_periods.items():
            ytd_end_date = _date(ytd_end)
            if (
                ytd_start != annual_start
                or ytd_end in invalid_ends
                or ytd_end_date is None
                or not annual_start_date < ytd_end_date < annual_end_date
                or (annual_end_date - ytd_end_date).days not in range(70, 111)
            ):
                continue
            ytd_choice = _best_group(ytd_grouped)
            if ytd_choice is None:
                continue
            ytd_key, ytd_group = ytd_choice
            ytd_anchor = _selected_observation(ytd_group, "revenue")
            if ytd_anchor is None:
                continue
            if (
                annual_key[2] != "10-K"
                or ytd_key[2] != "10-Q"
                or _fiscal_identity(ticker, annual_end)[0]
                != _fiscal_identity(ticker, ytd_end)[0]
            ):
                continue
            candidates.append((ytd_end, ytd_key[1], ytd_group))
        if not candidates or annual_end in used_ends:
            continue
        _ytd_end, _ytd_filed, ytd_group = max(
            candidates, key=lambda item: (item[1], item[0])
        )

        income = _new_income()
        for metric in METRICS:
            if metric == "dilutedEps":
                continue
            annual_value = _selected_observation(annual_group, metric)
            ytd_value = _selected_observation(ytd_group, metric)
            if annual_value is not None and ytd_value is not None:
                income[metric] = annual_value["value"] - ytd_value["value"]
        notes = [
            "같은 회계연도의 연간 수치에서 9개월 수치를 차감해 Q4를 계산했습니다.",
            "희석 EPS는 연간·누적 EPS 차감으로 계산하지 않아 제공하지 않습니다.",
        ]
        if not _validate_and_derive(income, notes, f"{ticker} {annual_end}"):
            errors.append(f"{ticker} {annual_end}: Q4 파생값 정합성 검증에 실패했습니다.")
            continue
        output.append(
            {
                "end": annual_end,
                "label": _period_label(ticker, annual_end),
                "income": income,
                "source": _source_from_observation(cik, annual_anchor),
                "segments": [],
                "segmentBasis": None,
                "notes": notes,
            }
        )
    return output


class _TableCollector(HTMLParser):
    """Small dependency-free table extractor for the issuer release."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[dict[str, Any]] = []
        self.table: dict[str, Any] | None = None
        self.table_depth = 0
        self.in_caption = False
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(
        self, tag: str, _attrs: list[tuple[str, str | None]]
    ) -> None:
        tag = tag.lower()
        if tag == "table":
            if self.table is None:
                self.table = {"caption": "", "rows": []}
                self.table_depth = 1
            else:
                self.table_depth += 1
            return
        if self.table is None or self.table_depth != 1:
            return
        if tag == "caption":
            self.in_caption = True
        elif tag == "tr":
            self.row = []
        elif tag in {"th", "td"} and self.row is not None:
            self.cell = []
        elif tag == "br":
            if self.in_caption:
                self.table["caption"] += " "
            elif self.cell is not None:
                self.cell.append(" ")

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "table":
            if self.table is None:
                return
            if self.table_depth > 1:
                self.table_depth -= 1
                return
            if self.row:
                self.table["rows"].append(self.row)
            self.tables.append(self.table)
            self.table = None
            self.table_depth = 0
            self.row = None
            self.cell = None
            self.in_caption = False
            return
        if self.table is None or self.table_depth != 1:
            return
        if tag in {"th", "td"} and self.cell is not None and self.row is not None:
            self.row.append(_clean_text("".join(self.cell)))
            self.cell = None
        elif tag == "tr":
            if self.row:
                self.table["rows"].append(self.row)
            self.row = None
        elif tag == "caption":
            self.in_caption = False

    def handle_data(self, data: str) -> None:
        if self.table is None or self.table_depth != 1:
            return
        if self.in_caption:
            self.table["caption"] += data
        elif self.cell is not None:
            self.cell.append(data)


def _release_number(value: str) -> int | float | None:
    text = _clean_text(value).replace("$", "").replace(",", "").replace("−", "-")
    if not text or text in {"—", "–", "-"}:
        return None
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1].strip()
    if not re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text):
        return None
    number = float(text)
    if negative:
        number = -number
    return int(number) if number.is_integer() and "." not in text else number


def _row_label(row: list[str]) -> str:
    return re.sub(r"[^a-z0-9]+", " ", row[0].lower()).strip() if row else ""


def _release_row(
    rows: list[list[str]], expected: str
) -> tuple[int | float, int | float]:
    expected = re.sub(r"[^a-z0-9]+", " ", expected.lower()).strip()
    for row in rows:
        if _row_label(row) != expected:
            continue
        values = [_release_number(cell) for cell in row[1:]]
        values = [value for value in values if value is not None]
        if len(values) < 2:
            raise ValueError(f"Microsoft release row has insufficient values: {expected}")
        return values[0], values[1]
    raise ValueError(f"Microsoft release row missing: {expected}")


def _release_eps_row(rows: list[list[str]]) -> tuple[int | float, int | float]:
    saw_marker = False
    for row in rows:
        label = _row_label(row)
        if label == "earnings per share":
            saw_marker = True
            continue
        if saw_marker and label == "diluted":
            values = [_release_number(cell) for cell in row[1:]]
            values = [value for value in values if value is not None]
            if len(values) >= 2:
                return values[0], values[1]
    raise ValueError("Microsoft GAAP diluted EPS row missing")


def _release_years(table: Mapping[str, Any]) -> list[int]:
    text = " ".join(
        [str(table.get("caption") or "")]
        + [" ".join(row) for row in table.get("rows", [])]
    )
    years: list[int] = []
    for value in re.findall(r"\b(20\d{2})\b", text):
        year = int(value)
        if year not in years:
            years.append(year)
    return years


def _release_period_end(table: Mapping[str, Any]) -> date:
    text = " ".join(
        [str(table.get("caption") or "")]
        + [" ".join(row) for row in table.get("rows", [])]
    )
    match = re.search(
        r"\bthree months ended\s+([A-Za-z]+)\s+(\d{1,2})",
        text,
        re.IGNORECASE,
    )
    if match is None:
        raise ValueError("Microsoft quarter end header missing")
    month_by_name = {
        "jan": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "aug": 8,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dec": 12,
    }
    month = month_by_name.get(match.group(1).lower()[:3])
    if month is None:
        raise ValueError("Microsoft quarter end month is invalid")
    years = _release_years(table)
    if len(years) < 2:
        raise ValueError("Microsoft comparative years are missing")
    try:
        return date(max(years), month, int(match.group(2)))
    except ValueError as error:
        raise ValueError("Microsoft quarter end date is invalid") from error


def msft_release_url_for_period(period: Mapping[str, Any]) -> str:
    end = _date(period.get("end"))
    if end is None:
        raise ValueError("period end is required for Microsoft release URL")
    fiscal_year, quarter = _fiscal_identity("MSFT", end.isoformat())
    return f"{MSFT_RELEASE_BASE}/fy-{fiscal_year}-q{quarter}/press-release-webcast"


def parse_msft_release_table(
    raw_html: str, *, source_url: str | None = None
) -> dict[str, Any]:
    if not isinstance(raw_html, str) or not raw_html.strip():
        raise ValueError("Microsoft release HTML is empty")
    provided_source_url = source_url
    if provided_source_url is not None and not provided_source_url.startswith(
        "https://www.microsoft.com/"
    ):
        raise ValueError("Microsoft release source URL is unsafe")

    collector = _TableCollector()
    collector.feed(raw_html)
    required = {
        "total revenue",
        "total cost of revenue",
        "gross margin",
        "operating income",
        "income before income taxes",
        "provision for income taxes",
        "net income",
        "research and development",
        "sales and marketing",
        "general and administrative",
    }
    selected: Mapping[str, Any] | None = None
    for table in collector.tables:
        caption = _clean_text(str(table.get("caption") or "")).lower()
        rows = table.get("rows", [])
        labels = {_row_label(row) for row in rows}
        table_text = f"{caption} {' '.join(' '.join(row) for row in rows)}".lower()
        if "microsoft corporation" not in caption or "income statements" not in caption:
            continue
        if "non-gaap" in table_text or "adjusted" in table_text or "reconciliation" in caption:
            continue
        if not re.search(
            r"\bthree months ended\s+[a-z]+\s+\d{1,2}",
            table_text,
            re.IGNORECASE,
        ):
            continue
        if not required.issubset(labels) or len(_release_years(table)) < 2:
            continue
        selected = table
        break
    if selected is None:
        raise ValueError("validated Microsoft GAAP income table not found")

    rows = selected["rows"]
    revenue = _release_row(rows, "total revenue")
    cost = _release_row(rows, "total cost of revenue")
    gross_reported = _release_row(rows, "gross margin")
    research = _release_row(rows, "research and development")
    sales = _release_row(rows, "sales and marketing")
    general = _release_row(rows, "general and administrative")
    operating = _release_row(rows, "operating income")
    pretax = _release_row(rows, "income before income taxes")
    tax = _release_row(rows, "provision for income taxes")
    net = _release_row(rows, "net income")
    diluted_eps = _release_eps_row(rows)

    current_gross, prior_gross = revenue[0] - cost[0], revenue[1] - cost[1]
    if not _close(current_gross, gross_reported[0]) or not _close(prior_gross, gross_reported[1]):
        raise ValueError("Microsoft gross margin row does not reconcile")
    current_expenses = research[0] + sales[0] + general[0]
    prior_expenses = research[1] + sales[1] + general[1]
    if not _close(current_gross - current_expenses, operating[0]) or not _close(prior_gross - prior_expenses, operating[1]):
        raise ValueError("Microsoft operating expense rows do not reconcile")
    if not _close(pretax[0], net[0] + tax[0]) or not _close(pretax[1], net[1] + tax[1]):
        raise ValueError("Microsoft pretax row does not reconcile")

    period_end = _release_period_end(selected)
    expected_source_url = msft_release_url_for_period(
        {"end": period_end.isoformat()}
    )
    if provided_source_url is None:
        source_url = expected_source_url
    elif provided_source_url.rstrip("/") != expected_source_url:
        raise ValueError("Microsoft release URL does not match table quarter")
    else:
        source_url = provided_source_url
    period_start = _msft_quarter_start(period_end)
    to_usd = lambda value: value * 1_000_000
    values = {
        "revenue": to_usd(revenue[0]),
        "costOfRevenue": to_usd(cost[0]),
        "grossProfit": to_usd(current_gross),
        "operatingExpenses": to_usd(current_expenses),
        "operatingIncome": to_usd(operating[0]),
        "pretaxIncome": to_usd(pretax[0]),
        "incomeTax": to_usd(tax[0]),
        "netIncome": to_usd(net[0]),
        "dilutedEps": diluted_eps[0],
    }
    prior = {
        "revenue": to_usd(revenue[1]),
        "costOfRevenue": to_usd(cost[1]),
        "grossProfit": to_usd(prior_gross),
        "operatingExpenses": to_usd(prior_expenses),
        "operatingIncome": to_usd(operating[1]),
        "pretaxIncome": to_usd(pretax[1]),
        "incomeTax": to_usd(tax[1]),
        "netIncome": to_usd(net[1]),
        "dilutedEps": diluted_eps[1],
    }
    return {
        "ticker": "MSFT",
        "period": {
            "label": _period_label("MSFT", period_end.isoformat()),
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
        "source": {
            "name": "Microsoft 공식 IR GAAP 분기표",
            "url": source_url,
            "filedAt": None,
        },
        "values": values,
        "prior": prior,
        "gaap": True,
        "notes": [
            "Microsoft 공식 IR의 GAAP 분기표에서 직접 읽었습니다.",
            "매출에서 매출원가를 차감해 매출총이익을 확인했습니다.",
            "연구개발·판매및마케팅·일반관리비를 합산해 영업비용을 확인했습니다.",
        ],
    }


def _supplement_periods(supplement: Mapping[str, Any]) -> list[dict[str, Any]]:
    if supplement.get("ticker") != "MSFT" or supplement.get("gaap") is not True:
        raise ValueError("Microsoft supplement must be a validated GAAP table")
    source = supplement.get("source")
    period = supplement.get("period")
    values = supplement.get("values")
    if not isinstance(source, Mapping) or not isinstance(period, Mapping) or not isinstance(values, Mapping):
        raise ValueError("Microsoft supplement shape is incomplete")
    url = str(source.get("url") or "")
    if not url.startswith("https://www.microsoft.com/"):
        raise ValueError("Microsoft supplement source URL is unsafe")
    start, end = period.get("start"), period.get("end")
    if _date(start) is None or _date(end) is None:
        raise ValueError("Microsoft supplement period dates are invalid")
    income = _new_income()
    for metric in METRICS:
        value = _finite_number(values.get(metric))
        if value is not None:
            income[metric] = value
    notes = [str(note) for note in supplement.get("notes", []) if str(note)]
    if not _validate_and_derive(income, notes, "MSFT Microsoft IR"):
        raise ValueError("Microsoft supplement accounting identities are inconsistent")
    current = {
        "end": end,
        "label": period.get("label") or _period_label("MSFT", end),
        "income": income,
        "source": dict(source),
        "segments": [],
        "segmentBasis": None,
        "notes": notes,
    }
    output = [current]
    prior_values = supplement.get("prior")
    end_date = _date(end)
    if isinstance(prior_values, Mapping) and end_date is not None:
        prior_end = date(end_date.year - 1, end_date.month, end_date.day)
        prior_income = _new_income()
        for metric in METRICS:
            value = _finite_number(prior_values.get(metric))
            if value is not None:
                prior_income[metric] = value
        prior_notes = ["Microsoft 공식 IR의 전년 동기 GAAP 분기 비교값입니다."]
        if _validate_and_derive(prior_income, prior_notes, "MSFT prior Microsoft IR"):
            output.append(
                {
                    "end": prior_end.isoformat(),
                    "label": _period_label("MSFT", prior_end.isoformat()),
                    "income": prior_income,
                    "source": dict(source),
                    "segments": [],
                    "segmentBasis": None,
                    "notes": prior_notes,
                }
            )
    return output


def _notice_for_errors(errors: list[str]) -> str:
    return (
        "새 공식 관측값 일부를 검증하지 못해 검증된 값만 유지했습니다."
        if errors
        else "새 공식 관측값을 확인하지 못해 기존 검증 값을 유지했습니다."
    )


def _source_filed_at(period: Mapping[str, Any]) -> str:
    source = period.get("source")
    return str(source.get("filedAt") or "") if isinstance(source, Mapping) else ""


def _period_is_partial_derived(period: Mapping[str, Any]) -> bool:
    notes = " ".join(str(note) for note in period.get("notes", []))
    return any(
        marker in notes
        for marker in ("Q4", "9개월", "누적 EPS", "희석 EPS")
    )


def _merge_confirmed_fields(
    candidate: Mapping[str, Any], previous: Mapping[str, Any]
) -> dict[str, Any]:
    merged = deepcopy(dict(candidate))
    candidate_income = candidate.get("income")
    previous_income = previous.get("income")
    if (
        _period_is_partial_derived(candidate)
        and isinstance(candidate_income, Mapping)
        and isinstance(previous_income, Mapping)
    ):
        income = dict(candidate_income)
        for metric in METRICS:
            if income.get(metric) is None and previous_income.get(metric) is not None:
                income[metric] = previous_income[metric]
        merged["income"] = income
    return merged


def _document_is_valid(document: Any, ticker: str) -> bool:
    """Validate the shared persisted document shape before using it as LKG."""
    if not isinstance(document, Mapping):
        return False
    if (
        document.get("schemaVersion") != 1
        or document.get("ticker") != ticker
        or document.get("companyName") != SUPPORTED_COMPANIES[ticker]["companyName"]
        or document.get("currency") != "USD"
        or document.get("status") not in {"current", "retained"}
        or not isinstance(document.get("updatedAt"), str)
    ):
        return False
    try:
        datetime.fromisoformat(str(document["updatedAt"]).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    notice = document.get("notice")
    if notice is not None and not isinstance(notice, str):
        return False
    periods = document.get("periods")
    if not isinstance(periods, list) or not 0 < len(periods) <= MAX_PERIODS:
        return False
    ends: list[str] = []
    for period in periods:
        if not isinstance(period, Mapping):
            return False
        end = period.get("end")
        if not isinstance(end, str):
            return False
        try:
            date.fromisoformat(end)
        except ValueError:
            return False
        ends.append(end)
        if not isinstance(period.get("label"), str) or not period["label"]:
            return False
        income = period.get("income")
        if not isinstance(income, Mapping) or set(income) != set(METRICS):
            return False
        for value in income.values():
            if value is None or (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(float(value))
            ):
                continue
            return False
        if income["revenue"] is None or income["revenue"] <= 0:
            return False
        if not _validate_and_derive(dict(income), [], "stored period"):
            return False
        if end > str(document["updatedAt"])[:10]:
            return False
        source = period.get("source")
        if (
            not isinstance(source, Mapping)
            or not isinstance(source.get("name"), str)
            or not source["name"]
            or not isinstance(source.get("url"), str)
            or not source["url"].startswith("https://")
            or re.match(r"(?i)^(javascript|data):", source["url"])
        ):
            return False
        filed_at = source.get("filedAt")
        if filed_at is not None:
            if not isinstance(filed_at, str):
                return False
            try:
                date.fromisoformat(filed_at)
            except ValueError:
                return False
        segments = period.get("segments")
        if not isinstance(segments, list) or len(segments) > 30:
            return False
        if period.get("segmentBasis") is not None and not isinstance(period.get("segmentBasis"), str):
            return False
        if segments:
            if any(not isinstance(segment, Mapping) or not isinstance(segment.get("name"), str) or not segment["name"] or _finite_number(segment.get("revenue")) is None or segment["revenue"] < 0 for segment in segments):
                return False
            if not _close(sum(segment["revenue"] for segment in segments), income["revenue"]):
                return False
        notes = period.get("notes")
        if not isinstance(notes, list) or not all(
            isinstance(note, str) and note for note in notes
        ):
            return False
    return len(ends) == len(set(ends)) and ends == sorted(ends, reverse=True)


def _bound_validation_errors(
    errors: list[str],
    periods: list[Mapping[str, Any]],
    invalid_ends: set[str],
) -> list[str]:
    """Keep errors for the persisted eight-period validation window only."""
    all_ends = set(invalid_ends)
    all_ends.update(
        str(period.get("end"))
        for period in periods
        if period.get("end")
    )
    for error in errors:
        all_ends.update(re.findall(r"\b20\d{2}-\d{2}-\d{2}\b", error))
    window_ends = set(sorted(all_ends, reverse=True)[:MAX_PERIODS])
    return [
        error
        for error in errors
        if not re.findall(r"\b20\d{2}-\d{2}-\d{2}\b", error)
        or any(end in window_ends for end in re.findall(r"\b20\d{2}-\d{2}-\d{2}\b", error))
    ]


def _merge_previous(
    candidate: dict[str, Any],
    previous: Mapping[str, Any],
    errors: list[str],
    now: str,
) -> dict[str, Any]:
    previous_periods = [
        period for period in previous.get("periods", []) if isinstance(period, Mapping)
    ]
    candidate_periods = [
        period for period in candidate.get("periods", []) if isinstance(period, Mapping)
    ]
    if not candidate_periods:
        retained = deepcopy(dict(previous))
        retained["status"] = "retained"
        retained["notice"] = _notice_for_errors(errors)
        return retained

    by_end: dict[str, Mapping[str, Any]] = {
        str(period["end"]): period
        for period in candidate_periods
        if period.get("end")
    }
    fallback_used = bool(errors)
    for period in previous_periods:
        end = str(period.get("end") or "")
        if not end:
            continue
        candidate_period = by_end.get(end)
        if candidate_period is None:
            by_end[end] = period
            continue
        candidate_filed = _source_filed_at(candidate_period)
        previous_filed = _source_filed_at(period)
        if candidate_filed and previous_filed and candidate_filed < previous_filed:
            by_end[end] = period
            fallback_used = True
        else:
            by_end[end] = _merge_confirmed_fields(candidate_period, period)
    periods = sorted(
        by_end.values(), key=lambda item: str(item.get("end") or ""), reverse=True
    )[:MAX_PERIODS]
    merged = deepcopy(candidate)
    merged["periods"] = deepcopy(periods)
    merged["status"] = "retained" if fallback_used else "current"
    merged["notice"] = _notice_for_errors(errors) if fallback_used else None
    if fallback_used:
        merged["updatedAt"] = previous.get("updatedAt", now)
    return merged


def normalize_companyfacts(
    ticker: str,
    companyfacts: Mapping[str, Any],
    previous: Mapping[str, Any] | None = None,
    now: Any = None,
    supplement: Mapping[str, Any] | str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    normalized_ticker = str(ticker or "").upper()
    company = SUPPORTED_COMPANIES.get(normalized_ticker)
    if company is None:
        raise ValueError(f"unsupported earnings ticker: {ticker}")
    if not isinstance(companyfacts, Mapping):
        raise ValueError("companyfacts must be an object")
    actual_cik = _normalise_cik(companyfacts.get("cik"))
    if actual_cik != company["cik"]:
        raise ValueError(f"companyfacts CIK does not match {normalized_ticker}")

    errors: list[str] = []
    invalid_ends = _invalid_ends(companyfacts)
    observations = {
        metric: list(_iter_metric_observations(companyfacts, metric))
        for metric in METRICS
    }
    periods, used_ends = _direct_periods(
        normalized_ticker, company["cik"], observations, invalid_ends, errors
    )
    periods.extend(
        _derived_q4_periods(
            normalized_ticker,
            company["cik"],
            observations,
            used_ends,
            invalid_ends,
            errors,
        )
    )

    if supplement is not None:
        try:
            if isinstance(supplement, str):
                supplement = parse_msft_release_table(supplement)
            if normalized_ticker != "MSFT":
                raise ValueError("발행사 보충자료는 MSFT에만 사용할 수 있습니다.")
            external = _supplement_periods(supplement)
            external_ends = {period["end"] for period in external}
            periods = [period for period in periods if period.get("end") not in external_ends]
            periods.extend(external)
        except (TypeError, ValueError) as error:
            errors.append(f"발행사 보충자료 검증 실패: {error}")

    errors = _bound_validation_errors(errors, periods, invalid_ends)
    periods.sort(key=lambda period: str(period.get("end") or ""), reverse=True)
    periods = periods[:MAX_PERIODS]
    now_iso = _iso_timestamp(now)
    validation = {
        "ok": bool(periods) and not errors,
        "errors": errors,
        "periods": len(periods),
    }
    document: dict[str, Any] = {
        "schemaVersion": 1,
        "ticker": normalized_ticker,
        "companyName": company["companyName"],
        "currency": "USD",
        "updatedAt": now_iso,
        "status": "current",
        "notice": None if not errors else _notice_for_errors(errors),
        "periods": periods,
    }
    if previous is not None:
        document = _merge_previous(document, previous, errors, now_iso)
    return document, validation


def _latest_period_hint(companyfacts: Mapping[str, Any]) -> dict[str, Any]:
    observations: list[dict[str, Any]] = []
    for metric in METRICS:
        observations.extend(_iter_metric_observations(companyfacts, metric))
    if not observations:
        raise ValueError("companyfacts contains no usable observations")
    anchor = max(
        observations, key=lambda observation: (observation["end"], observation["filed"])
    )
    return {"end": anchor["end"], "label": _period_label("MSFT", anchor["end"])}


def _required_user_agent() -> str:
    value = os.environ.get("SEC_USER_AGENT", "").strip()
    return value or "100xFenok EDGAR filing timeline builder/1.0 (contact: no-reply@100xfenok.local)"


def _fetch_json(url: str, *, user_agent: str, timeout: float = 20.0) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": user_agent})
    with urlopen(request, timeout=timeout) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("SEC response is not an object")
    return value


def _fetch_text(url: str, *, user_agent: str, timeout: float = 20.0) -> str:
    request = Request(url, headers={"Accept": "text/html", "User-Agent": user_agent})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _find_facts_file(facts_dir: Path, ticker: str) -> Path:
    cik = SUPPORTED_COMPANIES[ticker]["cik"]
    for candidate in (
        facts_dir / f"CIK{cik}.json",
        facts_dir / f"{ticker}.json",
        facts_dir / f"{ticker.lower()}.json",
    ):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"no companyfacts file found for {ticker}")


def _load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"JSON object expected: {path}")
    return value


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = handle.name
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass


def build_documents(
    facts_dir: Path | None,
    output_dir: Path,
    *,
    refresh: bool = False,
    now: Any = None,
) -> dict[str, dict[str, Any]]:
    if not refresh and facts_dir is None:
        raise ValueError("--facts-dir is required for offline builds")
    user_agent = _required_user_agent() if refresh else ""
    results: dict[str, dict[str, Any]] = {}
    last_request_at: float | None = None

    def fetch_official(
        fetcher: Any, url: str
    ) -> Any:
        """Keep the small refresh batch below two official requests per second."""
        nonlocal last_request_at
        if last_request_at is not None:
            wait_for = OFFICIAL_REQUEST_INTERVAL_SECONDS - (
                time.monotonic() - last_request_at
            )
            if wait_for > 0:
                time.sleep(wait_for)
        try:
            return fetcher(url, user_agent=user_agent)
        finally:
            last_request_at = time.monotonic()

    for ticker in SUPPORTED_COMPANIES:
        previous_path = output_dir / f"{ticker}.json"
        previous: dict[str, Any] | None = None
        if previous_path.exists():
            try:
                loaded_previous = _load_json(previous_path)
                if _document_is_valid(loaded_previous, ticker):
                    previous = loaded_previous
            except (OSError, ValueError, TypeError):
                previous = None
        document: dict[str, Any] | None = None
        validation: dict[str, Any] = {"ok": False, "errors": [], "periods": 0}
        try:
            if refresh:
                cik = SUPPORTED_COMPANIES[ticker]["cik"]
                companyfacts = fetch_official(
                    _fetch_json,
                    SEC_COMPANYFACTS_URL.format(cik=cik),
                )
            else:
                companyfacts = _load_json(_find_facts_file(facts_dir, ticker))
            supplement = None
            if ticker == "MSFT" and refresh:
                hint = _latest_period_hint(companyfacts)
                url = msft_release_url_for_period(hint)
                supplement = parse_msft_release_table(
                    fetch_official(_fetch_text, url),
                    source_url=url,
                )
            document, validation = normalize_companyfacts(
                ticker,
                companyfacts,
                previous=previous,
                now=now,
                supplement=supplement,
            )
        except (FileNotFoundError, HTTPError, URLError, OSError, ValueError, RuntimeError) as error:
            validation = {"ok": False, "errors": [str(error)], "periods": 0}

        if (
            document is not None
            and validation.get("ok") is True
            and _document_is_valid(document, ticker)
        ):
            try:
                _write_json(output_dir / f"{ticker}.json", document)
            except OSError as error:
                validation = {"ok": False, "errors": [str(error)], "periods": 0}
                if previous is not None:
                    document = deepcopy(previous)
                    document["status"] = "retained"
                    document["notice"] = "새 공식 자료를 확인하지 못해 기존 검증 값을 유지했습니다."
                    validation["periods"] = len(document.get("periods", []))
                else:
                    document = None
        else:
            if previous is not None:
                document = deepcopy(previous)
                document["status"] = "retained"
                document["notice"] = "새 공식 자료를 확인하지 못해 기존 검증 값을 유지했습니다."
                validation["ok"] = False
                validation["periods"] = len(document.get("periods", []))
            else:
                document = None
        results[ticker] = {"document": document, "validation": validation}
    return results


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--facts-dir", type=Path, required=False)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--refresh", action="store_true", help="fetch official SEC/issuer sources")
    parser.add_argument("--now", default=None, help="fixed UTC timestamp for deterministic output")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.refresh and args.facts_dir is None:
        _parser().error("--facts-dir is required unless --refresh is set")
    results = build_documents(args.facts_dir, args.output_dir, refresh=args.refresh, now=args.now)
    for ticker, result in results.items():
        if not result["validation"].get("ok"):
            print(f"{ticker}: {result['validation'].get('errors', [])}", file=sys.stderr)
    print(
        json.dumps(
            {
                ticker: {
                    "status": (
                        result["document"].get("status")
                        if result["document"] is not None
                        else "unavailable"
                    ),
                    "periods": (
                        len(result["document"].get("periods", []))
                        if result["document"] is not None
                        else 0
                    ),
                    "valid": result["validation"].get("ok"),
                }
                for ticker, result in results.items()
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return (
        0
        if all(
            result["validation"].get("ok") is True
            and result["document"] is not None
            and _document_is_valid(result["document"], ticker)
            for ticker, result in results.items()
        )
        else 2
    )


if __name__ == "__main__":
    sys.exit(main())
