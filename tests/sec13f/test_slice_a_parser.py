#!/usr/bin/env python3
"""Slice A parser/amendment core tests against the nine frozen fixtures."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from amendments import AmendmentError, compose_amendments  # noqa: E402
from parser import Sec13FParseError, parse_filing_component  # noqa: E402


FIXTURE_PATH = ROOT / "tests" / "sec13f" / "fixtures" / "sec_filing_cases.json"


def load_cases() -> dict[str, dict]:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    return {case["id"]: case for case in payload["cases"]}


def parse_case(case: dict) -> dict:
    tables = {table["accession"]: table["xml"] for table in case["information_tables"]}
    parsed = [
        parse_filing_component(component, tables.get(component["accession"]))
        for component in case["components"]
    ]
    return compose_amendments(parsed)


class SliceAParserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = load_cases()

    def test_all_nine_frozen_cases_match_their_pass_or_block_contract(self) -> None:
        self.assertEqual(len(self.cases), 9)
        for case in self.cases.values():
            expected = case["expected"]
            with self.subTest(case=case["id"]):
                if expected["result"] == "pass":
                    result = parse_case(case)
                    self.assertEqual(result["holding_count"], expected["holding_count"])
                    if "composition" in expected:
                        self.assertEqual(result["composition"], expected["composition"])
                    if "confidential_omission" in expected:
                        self.assertEqual(
                            result["confidential_omission"], expected["confidential_omission"]
                        )
                else:
                    with self.assertRaises(Sec13FParseError) as raised:
                        parse_case(case)
                    self.assertEqual(raised.exception.reason, expected["reason"])

    def test_parser_returns_the_exact_fixture_rows(self) -> None:
        for case_id in (
            "base_filing",
            "restatement",
            "add_new_holdings",
            "restatement_then_addition",
            "confidential_omission",
            "duplicate_rows",
        ):
            case = self.cases[case_id]
            tables = {table["accession"]: table for table in case["information_tables"]}
            for component in case["components"]:
                table = tables[component["accession"]]
                with self.subTest(case=case_id, accession=component["accession"]):
                    parsed = parse_filing_component(component, table["xml"])
                    self.assertEqual(parsed["holdings"], table["rows"])

    def test_duplicate_rows_and_amendment_append_order_are_preserved(self) -> None:
        duplicate = parse_case(self.cases["duplicate_rows"])
        self.assertEqual(len(duplicate["holdings"]), 2)
        self.assertEqual(duplicate["holdings"][0], duplicate["holdings"][1])

        composed = parse_case(self.cases["restatement_then_addition"])
        self.assertEqual(
            [row["name"] for row in composed["holdings"]],
            ["SYNTHETIC GAMMA INC", "SYNTHETIC BETA INC"],
        )
        self.assertEqual(
            [row["action"] for row in composed["lineage"]],
            ["replace_base", "replace_restatement", "append_new_holdings"],
        )

    def test_component_order_is_deterministic_and_exact_replay_is_idempotent(self) -> None:
        case = self.cases["restatement_then_addition"]
        tables = {table["accession"]: table["xml"] for table in case["information_tables"]}
        parsed = [
            parse_filing_component(component, tables[component["accession"]])
            for component in case["components"]
        ]
        expected = compose_amendments(parsed)
        replayed = compose_amendments([parsed[2], parsed[0], parsed[1], copy.deepcopy(parsed[1])])
        self.assertEqual(replayed, expected)

        changed_replay = copy.deepcopy(parsed[1])
        changed_replay["holdings"][0]["value"] += 1
        with self.assertRaisesRegex(AmendmentError, "accession_replay_mismatch"):
            compose_amendments([*parsed, changed_replay])

    def test_unknown_or_missing_amendment_type_fails_closed(self) -> None:
        case = copy.deepcopy(self.cases["restatement"])
        component = case["components"][1]
        component["amendment_type"] = "UNKNOWN"
        with self.assertRaises(Sec13FParseError) as raised:
            parse_filing_component(component, case["information_tables"][1]["xml"])
        self.assertEqual(raised.exception.reason, "unknown_or_missing_amendment_type")

        parsed_base = parse_filing_component(
            case["components"][0], case["information_tables"][0]["xml"]
        )
        unknown = copy.deepcopy(parsed_base)
        unknown.update(
            {
                "accession": "0000000001-26-999999",
                "form": "13F-HR/A",
                "amendment_type": "UNKNOWN",
                "amendment_number": 1,
            }
        )
        with self.assertRaisesRegex(AmendmentError, "unknown_or_missing_amendment_type"):
            compose_amendments([parsed_base, unknown])

    def test_missing_malformed_unsafe_and_metadata_mismatch_fail_closed(self) -> None:
        base = copy.deepcopy(self.cases["base_filing"]["components"][0])
        table_xml = self.cases["base_filing"]["information_tables"][0]["xml"]

        mutations = [
            (None, "missing_information_table"),
            ("<informationTable><infoTable></informationTable>", "malformed_information_table_xml"),
            ("<!DOCTYPE x [<!ENTITY y 'z'>]><informationTable/>", "unsafe_xml"),
        ]
        for xml, reason in mutations:
            with self.subTest(reason=reason):
                with self.assertRaises(Sec13FParseError) as raised:
                    parse_filing_component(base, xml)
                self.assertEqual(raised.exception.reason, reason)

        missing_cover = copy.deepcopy(base)
        missing_cover["cover_xml"] = None
        with self.assertRaises(Sec13FParseError) as raised:
            parse_filing_component(missing_cover, table_xml)
        self.assertEqual(raised.exception.reason, "missing_cover_xml")

        amendment = copy.deepcopy(self.cases["restatement"]["components"][1])
        amendment["amendment_number"] = 2
        amendment_xml = self.cases["restatement"]["information_tables"][1]["xml"]
        with self.assertRaises(Sec13FParseError) as raised:
            parse_filing_component(amendment, amendment_xml)
        self.assertEqual(raised.exception.reason, "cover_amendment_mismatch")


if __name__ == "__main__":
    unittest.main()
