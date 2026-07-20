#!/usr/bin/env python3
"""Hermetic acquisition/generation parity gate against the pinned CCH oracle."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "sec13f"
FIXTURES = ROOT / "tests" / "sec13f" / "fixtures"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from fixture_input import build_fixture_input  # noqa: E402
from fixture_oracle import FixtureOracleError, build_fixture_oracle_report, tree_digest  # noqa: E402
from freeze_slice_a_oracle import OracleFreezeError, freeze  # noqa: E402
from generator import generate_base_outputs  # noqa: E402


class SliceAEndToEndTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = yaml.safe_load((SCRIPTS / "config" / "investors.yaml").read_text())
        cls.fixture_input = json.loads((FIXTURES / "generator_input.json").read_text())
        cls.canonical_before = tree_digest(ROOT / "data" / "sec-13f")
        cls.public_before = tree_digest(ROOT / "100xfenok-next" / "public" / "data" / "sec-13f")

    def _generate(self, investor_data: dict, output_root: Path) -> dict:
        return generate_base_outputs(
            registry=self.registry,
            investor_data=investor_data,
            output_root=output_root,
            generated_at=self.fixture_input["generated_at"],
            summary_metadata_extra=self.fixture_input["summary_metadata_extra"],
        )

    def test_full_sixty_investor_seventy_three_payload_oracle_parity(self) -> None:
        rebuilt_input = build_fixture_input()
        self.assertEqual(rebuilt_input, self.fixture_input)
        first = rebuilt_input["investors_data"][sorted(rebuilt_input["investors_data"])[0]]["filings"][0]
        self.assertEqual(
            (first["aum_total"], first["reported_holdings_count"], first["filtered_out_count"], first["holdings_count"]),
            (2_001_000, 2, 1, 1),
        )
        with tempfile.TemporaryDirectory() as temporary_root:
            output_root = Path(temporary_root)
            manifest = self._generate(rebuilt_input["investors_data"], output_root)
            report = build_fixture_oracle_report(
                candidate_root=output_root,
                candidate_manifest=manifest,
                canonical_tree_before=self.canonical_before,
                canonical_tree_after=tree_digest(ROOT / "data" / "sec-13f"),
                public_tree_before=self.public_before,
                public_tree_after=tree_digest(ROOT / "100xfenok-next" / "public" / "data" / "sec-13f"),
                platform_commit="fixture-test",
            )

        self.assertEqual(report["result"], "pass")
        self.assertEqual((report["investors_expected"], report["investors_compared"]), (60, 60))
        self.assertEqual((report["outputs_expected"], report["outputs_compared"]), (73, 73))
        self.assertEqual(report["normalized_match_count"], 73)
        self.assertEqual(report["field_mismatches"], [])
        self.assertEqual(len(report["accessions_compared"]), 480)
        self.assertEqual(len(report["fixture_cases_passed"]), 6)
        self.assertEqual(len(report["fixture_cases_blocked"]), 3)
        self.assertEqual(report["canonical_tree_before"], report["canonical_tree_after"])
        self.assertEqual(report["public_tree_before"], report["public_tree_after"])

    def test_holding_value_and_accession_mutations_are_field_addressable_red(self) -> None:
        first = sorted(self.fixture_input["investors_data"])[0]
        relative_path = f"investors/{first}.json"
        for kind in ("value", "accession"):
            with self.subTest(kind=kind):
                with tempfile.TemporaryDirectory() as temporary_root:
                    output_root = Path(temporary_root)
                    manifest = self._generate(self.fixture_input["investors_data"], output_root)
                    path = output_root / relative_path
                    payload = json.loads(path.read_text())
                    latest = payload["investor"]["filings"][-1]
                    if kind == "value":
                        latest["holdings"][0]["market_value"] += 1
                    else:
                        latest["accession_number"] = "0001578684-26-999999"
                    encoded = json.dumps(payload, ensure_ascii=False, indent=2).encode()
                    path.write_bytes(encoded)
                    entry = next(row for row in manifest["entries"] if row["path"] == relative_path)
                    entry.update(bytes=len(encoded), sha256=hashlib.sha256(encoded).hexdigest())
                    manifest["outputs"][relative_path].update(
                        bytes=entry["bytes"], sha256=entry["sha256"]
                    )
                    manifest["entries_digest"] = hashlib.sha256(
                        json.dumps(manifest["entries"], ensure_ascii=False, indent=2).encode()
                    ).hexdigest()
                    manifest.pop("manifest_digest")
                    manifest["manifest_digest"] = hashlib.sha256(
                        json.dumps(manifest, ensure_ascii=False, indent=2).encode()
                    ).hexdigest()
                    report = build_fixture_oracle_report(
                        candidate_root=output_root,
                        candidate_manifest=manifest,
                        canonical_tree_before=self.canonical_before,
                        canonical_tree_after=self.canonical_before,
                        public_tree_before=self.public_before,
                        public_tree_after=self.public_before,
                        platform_commit="fixture-test",
                    )
                self.assertEqual(report["result"], "fail")
                self.assertGreater(len(report["field_mismatches"]), 0)
                self.assertTrue(all(item.get("json_path") for item in report["field_mismatches"]))

    def test_report_rejects_a_candidate_root_not_bound_to_its_manifest(self) -> None:
        with self.assertRaises(FixtureOracleError):
            build_fixture_oracle_report(
                candidate_root=FIXTURES / "cch_fixture_oracle",
                candidate_manifest={},
                canonical_tree_before=self.canonical_before,
                canonical_tree_after=self.canonical_before,
                public_tree_before=self.public_before,
                public_tree_after=self.public_before,
                platform_commit="fixture-test",
            )

    def test_oracle_freezer_rejects_protected_output_and_manifest_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            temporary_root = Path(temporary_root)
            cch_root = temporary_root / "cch"
            with self.assertRaises(OracleFreezeError):
                freeze(
                    cch_root=cch_root,
                    input_path=FIXTURES / "generator_input.json",
                    output_root=ROOT / "data",
                    manifest_path=temporary_root / "manifest.json",
                )
            with self.assertRaises(OracleFreezeError):
                freeze(
                    cch_root=cch_root,
                    input_path=FIXTURES / "generator_input.json",
                    output_root=temporary_root / "oracle",
                    manifest_path=ROOT / "data" / "sec-13f" / "forbidden-manifest.json",
                )
            with self.assertRaises(OracleFreezeError):
                freeze(
                    cch_root=cch_root,
                    input_path=FIXTURES / "generator_input.json",
                    output_root=cch_root / "other",
                    manifest_path=temporary_root / "manifest.json",
                )
            with self.assertRaises(OracleFreezeError):
                freeze(
                    cch_root=cch_root,
                    input_path=FIXTURES / "generator_input.json",
                    output_root=temporary_root / "oracle",
                    manifest_path=cch_root / "generator.py",
                )


if __name__ == "__main__":
    unittest.main()
