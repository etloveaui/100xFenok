#!/usr/bin/env python3
"""Rebuild the frozen Slice A generator input through the hermetic SEC path."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

from archive import ARCHIVE_BASE, SUBMISSIONS_BASE
from client import SecClient
from contract import canonical_json
from input_adapter import prepare_investor_data
from pipeline import PipelineError, build_investor_run, build_investor_runs


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "tests" / "sec13f" / "fixtures" / "sec_filing_cases.json"
REGISTRY_PATH = ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"
GENERATED_AT = "2026-07-20T12:00:00"
QUARTER_CASES = (
    ("base_filing", "2025-06-30", "2025-08-14", 1),
    ("restatement", "2025-09-30", "2025-11-14", 11),
    ("add_new_holdings", "2025-12-31", "2026-02-14", 21),
    ("restatement_then_addition", "2026-03-31", "2026-05-15", 31),
)
REFERENCE_MAPPING = {
    "000000AA1": {"ticker": "AAA", "sector": "Technology"},
    "000000BB2": {"ticker": "BBB", "sector": "Financials"},
    "000000CC3": {"ticker": "CCC", "sector": "Health Care"},
}


class FixtureTransport:
    """In-memory SEC endpoint map; an unknown URL fails instead of networking."""

    def __init__(self) -> None:
        self.responses: dict[str, bytes] = {}

    def add_json(self, url: str, payload: object) -> None:
        self.responses[url] = json.dumps(payload).encode("utf-8")

    def __call__(self, url: str, _headers: dict[str, str], _timeout: float) -> tuple[int, bytes]:
        if url not in self.responses:
            raise AssertionError(f"unexpected non-fixture request: {url}")
        return 200, self.responses[url]


def _columns(components: list[dict[str, Any]], cik: str) -> dict[str, list[str]]:
    return {
        "accessionNumber": [row["accession"].replace("0000000001", cik) for row in components],
        "form": [row["form"] for row in components],
        "filingDate": [row["filing_date"] for row in components],
        "reportDate": [row["report_date"] for row in components],
        "primaryDocument": ["primary.xml" for _row in components],
    }


def _install_case(transport: FixtureTransport, *, cik: str, case: dict[str, Any]) -> list[str]:
    components = deepcopy(case["components"])
    history = components[:1]
    recent = components[1:]
    history_name = f"CIK{cik}-submissions-001.json"
    transport.add_json(
        f"{SUBMISSIONS_BASE}/CIK{cik}.json",
        {"filings": {"recent": _columns(recent, cik), "files": [{"name": history_name}]}},
    )
    transport.add_json(f"{SUBMISSIONS_BASE}/{history_name}", _columns(history, cik))
    tables = {row["accession"]: row for row in case["information_tables"]}
    accessions: list[str] = []
    for component in components:
        source_accession = component["accession"]
        accession = source_accession.replace("0000000001", cik)
        accessions.append(accession)
        base = f"{ARCHIVE_BASE}/{int(cik)}/{accession.replace('-', '')}"
        table = tables.get(source_accession)
        items = [{"name": "primary.xml"}]
        if table is not None:
            items.append({"name": "infotable.xml"})
        transport.add_json(f"{base}/index.json", {"directory": {"item": items}})
        transport.responses[f"{base}/primary.xml"] = component["cover_xml"].encode("utf-8")
        if table is not None:
            transport.responses[f"{base}/infotable.xml"] = table["xml"].encode("utf-8")
    return accessions


def _quarter_case(case: dict[str, Any], report_date: str, filing_date: str, start: int) -> dict[str, Any]:
    output = deepcopy(case)
    mapping: dict[str, str] = {}
    for offset, component in enumerate(output["components"]):
        old = component["accession"]
        new = f"0000000001-{filing_date[2:4]}-{start + offset:06d}"
        mapping[old] = new
        component.update(accession=new, report_date=report_date, filing_date=filing_date)
    for table in output["information_tables"]:
        table["accession"] = mapping[table["accession"]]
    return output


def _unit_resolver(_parsed: dict[str, Any]) -> dict[str, Any]:
    return {"unit": "thousands", "evidence": "frozen-fixture", "confidence": 1.0}


def _measure_fixture_cases(cases: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    investor = {
        "name": "Synthetic",
        "entity": "Synthetic Filer",
        "cik": "0000000001",
        "group": "hedge",
        "active": True,
    }
    results: list[dict[str, Any]] = []
    for case_id in sorted(cases):
        case = cases[case_id]
        transport = FixtureTransport()
        accessions = _install_case(transport, cik=investor["cik"], case=case)
        try:
            build_investor_run(
                client=SecClient(
                    user_agent="Fenok sec13f-fixture@fenok.test",
                    transport=transport,
                    sleep=lambda _seconds: None,
                ),
                investor_id="synthetic",
                investor=investor,
                reference_mapping=REFERENCE_MAPPING,
                unit_resolver=_unit_resolver,
            )
            status = "pass"
            reason = None
        except PipelineError as error:
            status = "blocked"
            reason = error.reason
        expected = case["expected"]
        expected_status = "pass" if expected["result"] == "pass" else "blocked"
        if status != expected_status or (status == "blocked" and reason != expected["reason"]):
            raise AssertionError(f"fixture result drift: {case_id}: {status}/{reason}")
        results.append(
            {
                "id": case_id,
                "status": status,
                "reason": reason,
                "accessions": accessions,
            }
        )
    return results


def build_fixture_input(
    *,
    fixture_path: Path = FIXTURE_PATH,
    registry_path: Path = REGISTRY_PATH,
) -> dict[str, Any]:
    fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    registry = yaml.safe_load(Path(registry_path).read_text(encoding="utf-8"))
    cases = {row["id"]: row for row in fixture["cases"]}
    combined: dict[str, list[dict[str, Any]]] = {"components": [], "information_tables": []}
    for name, report_date, filing_date, start in QUARTER_CASES:
        case = _quarter_case(cases[name], report_date, filing_date, start)
        if name == "base_filing":
            case["components"][0]["cover_xml"] = case["components"][0]["cover_xml"].replace(
                "<tableValueTotal>3000</tableValueTotal>",
                "<tableValueTotal>2001</tableValueTotal>",
            )
            case["information_tables"][0]["xml"] = case["information_tables"][0]["xml"].replace(
                "<value>1000</value>",
                "<value>1</value>",
                1,
            )
        combined["components"].extend(case["components"])
        combined["information_tables"].extend(case["information_tables"])

    transport = FixtureTransport()
    for investor in registry["investors"].values():
        _install_case(transport, cik=investor["cik"], case=combined)
    client = SecClient(
        user_agent="Fenok sec13f-fixture@fenok.test",
        transport=transport,
        sleep=lambda _seconds: None,
    )
    runs = build_investor_runs(
        client=client,
        registry=registry,
        reference_mapping=REFERENCE_MAPPING,
        unit_resolver=_unit_resolver,
    )
    investors_data = prepare_investor_data(registry, runs)
    accessions = sorted(
        {
            accession
            for run in runs.values()
            for filing in run["filings"]
            for accession in filing["source_accessions"]
        }
    )
    payload = {
        "schema_version": "sec13f-generator-input/v1",
        "provenance": {
            "classification": "synthetic_sanitized",
            "source_fixture": Path(fixture_path).name,
            "builder": "acquisition_pipeline",
        },
        "registry_sha256": hashlib.sha256(Path(registry_path).read_bytes()).hexdigest(),
        "quarters_covered": ["2026-Q1", "2025-Q4", "2025-Q3", "2025-Q2"],
        "generated_at": GENERATED_AT,
        "summary_metadata_extra": {"fixture_mode": "slice_a_oracle"},
        "investors_data": investors_data,
        "case_assignments": {
            "successful": [row[0] for row in QUARTER_CASES],
            "separately_verified": ["confidential_omission", "duplicate_rows"],
            "blocked": ["absent_information_table", "malformed_xml", "cover_count_mismatch"],
        },
        "case_results": _measure_fixture_cases(cases),
        "accessions_compared": accessions,
    }
    payload["content_digest"] = hashlib.sha256(canonical_json(payload)).hexdigest()
    return payload
