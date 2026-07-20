#!/usr/bin/env python3
"""RED/GREEN contract tests for SEC 13F absorption Slice 0."""

from __future__ import annotations

import copy
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

import yaml


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from contract import (  # noqa: E402
    ContractError,
    EXPECTED_BASE_OUTPUT_COUNT,
    EXPECTED_DERIVED_OUTPUT_COUNT,
    canonical_json,
    content_digest,
    load_and_validate_all,
    load_json,
    validate_comparison_manifest,
    validate_detached_manifest,
    validate_fixture_contract,
    validate_output_manifest,
    validate_registry,
    sha256_bytes,
    sha256_file,
)


FIXTURES = ROOT / "tests" / "sec13f" / "fixtures"


class Slice0ContractTest(unittest.TestCase):
    def test_frozen_contract_is_complete_and_matches_current_baseline(self) -> None:
        load_and_validate_all(ROOT)

    def test_registry_is_exactly_60_unique_ids_and_ciks(self) -> None:
        registry = validate_registry(ROOT / "scripts" / "sec13f" / "config" / "investors.yaml")
        self.assertEqual(len(registry["investors"]), 60)
        self.assertEqual(len({row["cik"] for row in registry["investors"].values()}), 60)

    def test_fixture_mutations_remain_red_after_resealing(self) -> None:
        fixture = load_json(FIXTURES / "sec_filing_cases.json")
        validate_fixture_contract(fixture)

        mutations = []
        changed_accession = copy.deepcopy(fixture)
        changed_accession["cases"][0]["accessions"][0] = "0000000000-26-999999"
        mutations.append(changed_accession)

        changed_value = copy.deepcopy(fixture)
        changed_value["cases"][0]["information_tables"][0]["rows"][0]["value"] += 1
        mutations.append(changed_value)

        changed_amendment = copy.deepcopy(fixture)
        changed_amendment["cases"][1]["components"][-1]["amendment_type"] = "UNKNOWN"
        mutations.append(changed_amendment)

        changed_component_order = copy.deepcopy(fixture)
        components = changed_component_order["cases"][3]["components"]
        components[1], components[2] = components[2], components[1]
        mutations.append(changed_component_order)

        for mutation in mutations:
            mutation["content_digest"] = content_digest(mutation)
            with self.subTest(mutation=content_digest(mutation)):
                with self.assertRaisesRegex(ContractError, "pinned content digest mismatch"):
                    validate_fixture_contract(mutation)

    def test_output_count_mutation_is_red(self) -> None:
        manifest = load_json(FIXTURES / "base_output_manifest.json")
        manifest["entries"].pop()
        manifest["content_digest"] = content_digest(manifest)
        with self.assertRaisesRegex(ContractError, "output count changed"):
            validate_output_manifest(
                manifest,
                ROOT,
                expected_count=EXPECTED_BASE_OUTPUT_COUNT,
                label="base output manifest",
            )

    def test_order_unit_filter_and_history_semantics_are_explicit(self) -> None:
        fixture = load_json(FIXTURES / "sec_filing_cases.json")
        contract = fixture["contract"]
        self.assertEqual(
            contract["component_order"],
            ["report_date:asc", "filing_date:asc", "amendment_number:asc", "accession:asc"],
        )
        self.assertEqual(contract["amendment_semantics"]["unknown_or_missing"], "fail_closed")
        self.assertEqual(contract["holding_row_order"], "preserve_xml_order_then_amendment_append_order")
        self.assertEqual(
            contract["weight_filter_order"],
            [
                "market_value / filing_total_value",
                "round_to_4_decimal_places",
                "keep_if_weight_greater_than_or_equal_to_0.001",
            ],
        )
        self.assertEqual(
            contract["accumulated_history"],
            {"fresh_fetch_quarters": 21, "frozen_accumulated_quarters": 30, "compare_separately": True},
        )
        self.assertEqual(
            contract["declared_cch_volatile_paths"],
            [
                {
                    "file_patterns": [
                        "summary.json",
                        "investors/*.json",
                        "analytics/conviction.json",
                    ],
                    "json_path": "$.metadata.generated_at",
                    "measured_occurrences": 62,
                }
            ],
        )

    def test_synthetic_xml_is_well_formed_except_the_named_malformed_case(self) -> None:
        fixture = load_json(FIXTURES / "sec_filing_cases.json")
        for case in fixture["cases"]:
            for component in case["components"]:
                ET.fromstring(component["cover_xml"])
            for information_table in case["information_tables"]:
                if case["id"] == "malformed_xml":
                    with self.assertRaises(ET.ParseError):
                        ET.fromstring(information_table["xml"])
                else:
                    ET.fromstring(information_table["xml"])

    def test_base_and_platform_derived_boundaries_stay_separate(self) -> None:
        base = load_json(FIXTURES / "base_output_manifest.json")
        derived = load_json(FIXTURES / "platform_derived_manifest.json")
        base_paths = {entry["path"] for entry in base["entries"]}
        derived_paths = {entry["path"] for entry in derived["entries"]}
        self.assertEqual(len(base_paths), EXPECTED_BASE_OUTPUT_COUNT)
        self.assertEqual(len(derived_paths), EXPECTED_DERIVED_OUTPUT_COUNT)
        self.assertTrue(base_paths.isdisjoint(derived_paths))
        self.assertNotIn("data/sec-13f/schema.json", base_paths | derived_paths)

    def test_same_count_path_substitution_and_boundary_swap_are_red(self) -> None:
        base = load_json(FIXTURES / "base_output_manifest.json")
        schema_path = ROOT / "data" / "sec-13f" / "schema.json"
        base["entries"][-1] = {
            "path": "data/sec-13f/schema.json",
            "category": "root_index",
            "bytes": schema_path.stat().st_size,
            "sha256": sha256_file(schema_path),
        }
        base["entries_digest"] = sha256_bytes(canonical_json(base["entries"]))
        base["content_digest"] = content_digest(base)
        with self.assertRaisesRegex(ContractError, "pinned content digest mismatch"):
            validate_output_manifest(
                base,
                ROOT,
                expected_count=EXPECTED_BASE_OUTPUT_COUNT,
                label="base output manifest",
            )

        derived = load_json(FIXTURES / "platform_derived_manifest.json")
        summary_path = ROOT / "data" / "sec-13f" / "summary.json"
        derived["entries"][0] = {
            "path": "data/sec-13f/summary.json",
            "category": "platform_derived",
            "bytes": summary_path.stat().st_size,
            "sha256": sha256_file(summary_path),
        }
        derived["entries_digest"] = sha256_bytes(canonical_json(derived["entries"]))
        derived["content_digest"] = content_digest(derived)
        with self.assertRaisesRegex(ContractError, "pinned content digest mismatch"):
            validate_output_manifest(
                derived,
                ROOT,
                expected_count=EXPECTED_DERIVED_OUTPUT_COUNT,
                label="platform derived manifest",
            )

    def test_invalid_or_duplicate_cik_is_red_before_registry_pin(self) -> None:
        registry_path = ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"
        registry = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
        investor_ids = list(registry["investors"])
        mutations = []
        duplicate = copy.deepcopy(registry)
        duplicate["investors"][investor_ids[1]]["cik"] = duplicate["investors"][investor_ids[0]]["cik"]
        mutations.append((duplicate, "duplicate CIK"))
        invalid = copy.deepcopy(registry)
        invalid["investors"][investor_ids[0]]["cik"] = "123"
        mutations.append((invalid, "exactly 10 digits"))

        with tempfile.TemporaryDirectory() as temporary_root:
            for index, (mutation, message) in enumerate(mutations):
                path = Path(temporary_root) / f"registry-{index}.yaml"
                path.write_text(yaml.safe_dump(mutation, sort_keys=False), encoding="utf-8")
                with self.subTest(message=message):
                    with self.assertRaisesRegex(ContractError, message):
                        validate_registry(path)

    def test_cch_runtime_and_cache_provenance_are_frozen_separately(self) -> None:
        cch_output = load_json(FIXTURES / "cch_output_manifest.json")
        cch_cache = load_json(FIXTURES / "cch_cache_manifest.json")
        comparison = load_json(FIXTURES / "cch_platform_baseline.json")
        validate_detached_manifest(cch_output, expected_count=73, label="CCH output manifest")
        validate_detached_manifest(cch_cache, expected_count=62, label="CCH cache manifest")
        validate_comparison_manifest(comparison, ROOT)
        self.assertEqual(
            comparison["summary"],
            {"compared": 73, "byte_exact": 9, "byte_mismatch": 64},
        )
        self.assertEqual(cch_output["total_bytes"], 187_781_701)
        self.assertEqual(
            cch_output["sha256_lines_digest"],
            "fd50926c704ed55735670e80ae42d83237d377ec6ca6a43ebe555b8404bf3f58",
        )
        self.assertEqual(cch_cache["total_bytes"], 12_228_754)
        self.assertIn("not verified", cch_cache["note"])


if __name__ == "__main__":
    unittest.main()
