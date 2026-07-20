#!/usr/bin/env python3
"""Hermetic Slice A acquisition-to-normalization pipeline tests."""

from __future__ import annotations

from copy import deepcopy
import inspect
import json
from pathlib import Path
import sys
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from archive import ARCHIVE_BASE, SUBMISSIONS_BASE  # noqa: E402
from client import SecClient  # noqa: E402
from pipeline import PipelineError, build_investor_run, build_investor_runs  # noqa: E402


FIXTURE_PATH = ROOT / "tests" / "sec13f" / "fixtures" / "sec_filing_cases.json"
REGISTRY_PATH = ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"
REFERENCE_MAPPING = {
    "000000AA1": {"ticker": "AAA", "sector": "Technology"},
    "000000BB2": {"ticker": "BBB", "sector": "Financials"},
    "000000CC3": {"ticker": "CCC", "sector": "Health Care"},
}


def unit_resolver(_parsed: dict) -> dict:
    return {"unit": "thousands", "evidence": "frozen-fixture", "confidence": 1.0}


class FakeSec:
    def __init__(self) -> None:
        self.responses: dict[str, bytes] = {}
        self.requested: list[str] = []

    def add_json(self, url: str, payload: object) -> None:
        self.responses[url] = json.dumps(payload).encode("utf-8")

    def transport(self, url: str, _headers: dict[str, str], _timeout: float) -> tuple[int, bytes]:
        self.requested.append(url)
        if url not in self.responses:
            raise AssertionError(f"unexpected network request: {url}")
        return 200, self.responses[url]

    def client(self) -> SecClient:
        return SecClient(
            user_agent="Fenok sec13f-tests@fenok.test",
            transport=self.transport,
            sleep=lambda _seconds: None,
        )


def _columns(components: list[dict], cik: str) -> dict[str, list[str]]:
    return {
        "accessionNumber": [component["accession"].replace("0000000001", cik) for component in components],
        "form": [component["form"] for component in components],
        "filingDate": [component["filing_date"] for component in components],
        "reportDate": [component["report_date"] for component in components],
        "primaryDocument": ["primary.xml" for _component in components],
    }


def install_case(fake: FakeSec, *, cik: str, case: dict) -> list[str]:
    components = deepcopy(case["components"])
    split = 1 if len(components) > 1 else len(components)
    history_components = components[:split]
    recent_components = components[split:]
    history_name = f"CIK{cik}-submissions-001.json"
    fake.add_json(
        f"{SUBMISSIONS_BASE}/CIK{cik}.json",
        {
            "filings": {
                "recent": _columns(recent_components, cik),
                "files": [{"name": history_name}],
            }
        },
    )
    fake.add_json(f"{SUBMISSIONS_BASE}/{history_name}", _columns(history_components, cik))

    tables = {table["accession"]: table for table in case["information_tables"]}
    derived_accessions: list[str] = []
    for component in components:
        original_accession = component["accession"]
        accession = original_accession.replace("0000000001", cik)
        derived_accessions.append(accession)
        base = f"{ARCHIVE_BASE}/{int(cik)}/{accession.replace('-', '')}"
        table = tables.get(original_accession)
        items = [{"name": "primary.xml"}]
        if table is not None:
            items.append({"name": "infotable.xml"})
        fake.add_json(f"{base}/index.json", {"directory": {"item": items}})
        fake.responses[f"{base}/primary.xml"] = component["cover_xml"].encode("utf-8")
        if table is not None:
            fake.responses[f"{base}/infotable.xml"] = table["xml"].encode("utf-8")
    return derived_accessions


class SliceAPipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.cases = {case["id"]: case for case in payload["cases"]}
        cls.registry = yaml.safe_load(REGISTRY_PATH.read_text(encoding="utf-8"))

    def test_all_nine_frozen_cases_cross_the_full_pipeline_or_fail_as_declared(self) -> None:
        investor = {
            "name": "Synthetic",
            "entity": "Synthetic Filer",
            "cik": "0000000001",
            "group": "hedge",
            "active": True,
        }
        for case in self.cases.values():
            fake = FakeSec()
            accessions = install_case(fake, cik=investor["cik"], case=case)
            with self.subTest(case=case["id"]):
                if case["expected"]["result"] == "pass":
                    result = build_investor_run(
                        client=fake.client(),
                        investor_id="synthetic",
                        investor=investor,
                        reference_mapping=REFERENCE_MAPPING,
                        unit_resolver=unit_resolver,
                    )
                    filing = result["filings"][0]
                    self.assertEqual(filing["source_accessions"], accessions)
                    self.assertEqual(filing["composition"], case["expected"].get("composition", "base"))
                    self.assertEqual(filing["reported_holdings_count"], case["expected"]["holding_count"])
                else:
                    with self.assertRaises(PipelineError) as raised:
                        build_investor_run(
                            client=fake.client(),
                            investor_id="synthetic",
                            investor=investor,
                            reference_mapping=REFERENCE_MAPPING,
                            unit_resolver=unit_resolver,
                        )
                    self.assertEqual(raised.exception.reason, case["expected"]["reason"])

    def test_exact_60_registry_coverage_and_acquired_accession_lineage(self) -> None:
        fake = FakeSec()
        case = self.cases["restatement_then_addition"]
        expected_accessions: dict[str, list[str]] = {}
        for investor_id, investor in self.registry["investors"].items():
            expected_accessions[investor_id] = install_case(fake, cik=investor["cik"], case=case)

        runs = build_investor_runs(
            client=fake.client(),
            registry=self.registry,
            reference_mapping=REFERENCE_MAPPING,
            unit_resolver=unit_resolver,
        )

        self.assertEqual(len(runs), 60)
        self.assertEqual(list(runs), list(self.registry["investors"]))
        self.assertEqual(set(runs), set(self.registry["investors"]))
        for investor_id, run in runs.items():
            registry_row = self.registry["investors"][investor_id]
            with self.subTest(investor=investor_id):
                self.assertEqual(
                    {key: run[key] for key in ("id", "name", "entity", "cik", "group")},
                    {
                        "id": investor_id,
                        "name": registry_row["name"],
                        "entity": registry_row["entity"],
                        "cik": registry_row["cik"],
                        "group": registry_row["group"],
                    },
                )
                self.assertEqual(len(run["filings"]), 1)
                filing = run["filings"][0]
                self.assertEqual(filing["quarter"], "2026-Q1")
                self.assertEqual(filing["source_accessions"], expected_accessions[investor_id])
                self.assertEqual(filing["active_accessions"], expected_accessions[investor_id][1:])
                self.assertEqual(filing["composition"], "restatement_plus_addition")
                self.assertEqual([row["ticker"] for row in filing["holdings"]], ["CCC", "BBB"])
                for holding in filing["holdings"]:
                    self.assertTrue(holding["ticker"])
                    self.assertTrue(holding["sector"])
                    self.assertEqual(holding["market_value"], holding["value"])
                    self.assertGreater(holding["value"], 0)
                    self.assertGreater(holding["shares"], 0)
                    self.assertGreaterEqual(holding["weight"], 0.001)

    def test_accessions_cannot_be_claimed_and_missing_reference_fails_closed(self) -> None:
        self.assertNotIn("accessions", inspect.signature(build_investor_runs).parameters)
        fake = FakeSec()
        case = self.cases["base_filing"]
        investor = {
            "name": "Synthetic",
            "entity": "Synthetic Filer",
            "cik": "0000000001",
            "group": "hedge",
            "active": True,
        }
        acquired = install_case(fake, cik=investor["cik"], case=case)
        with self.assertRaises(PipelineError) as raised:
            build_investor_run(
                client=fake.client(),
                investor_id="synthetic",
                investor=investor,
                reference_mapping={},
                unit_resolver=unit_resolver,
            )
        self.assertEqual(raised.exception.reason, "unresolved_holding_reference")
        self.assertEqual(raised.exception.accession, acquired[0])

    def test_investor_filings_are_ordered_by_report_date(self) -> None:
        earlier = deepcopy(self.cases["base_filing"])
        later = deepcopy(self.cases["base_filing"])
        earlier["components"][0]["filing_date"] = "2026-02-14"
        earlier["components"][0]["report_date"] = "2025-12-31"
        later_accession = "0000000001-26-000009"
        later["components"][0]["accession"] = later_accession
        later["information_tables"][0]["accession"] = later_accession
        combined = {
            "components": [later["components"][0], earlier["components"][0]],
            "information_tables": [later["information_tables"][0], earlier["information_tables"][0]],
        }
        fake = FakeSec()
        install_case(fake, cik="0000000001", case=combined)
        run = build_investor_run(
            client=fake.client(),
            investor_id="synthetic",
            investor={
                "name": "Synthetic",
                "entity": "Synthetic Filer",
                "cik": "0000000001",
                "group": "hedge",
                "active": True,
            },
            reference_mapping=REFERENCE_MAPPING,
            unit_resolver=unit_resolver,
        )
        self.assertEqual(
            [(filing["quarter"], filing["report_date"]) for filing in run["filings"]],
            [("2025-Q4", "2025-12-31"), ("2026-Q1", "2026-03-31")],
        )


if __name__ == "__main__":
    unittest.main()
