#!/usr/bin/env python3
"""Deterministic closure tests for the SEC 13F Slice A base generator."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from generator import ANALYTIC_NAMES, GeneratorError, generate_base_outputs  # noqa: E402
from input_adapter import prepare_investor_data  # noqa: E402


GENERATED_AT = "2026-07-20T12:00:00Z"


def load_registry() -> dict:
    return yaml.safe_load((SEC13F_SCRIPTS / "config" / "investors.yaml").read_text(encoding="utf-8"))


def holding(ticker: str, value: int, shares: int, *, sector: str = "Information Technology") -> dict:
    return {
        "ticker": ticker,
        "cusip": f"CUSIP-{ticker}",
        "name": f"{ticker} Incorporated",
        "value": value,
        "shares": shares,
        "sector": sector,
        "unit": "dollars",
        "unit_evidence": "fixture_explicit",
        "unit_confidence": 1.0,
        "title_of_class": "COM",
        "investment_discretion": "SOLE",
        "voting_sole": shares,
        "voting_shared": 0,
        "voting_none": 0,
    }


def build_runs(registry: dict) -> dict:
    runs = {}
    for index, (investor_id, metadata) in enumerate(sorted(registry["investors"].items())):
        previous_ticker = f"OLD{index:02d}"
        current_ticker = f"NEW{index:02d}"
        runs[investor_id] = {
            "id": investor_id,
            "name": metadata["name"],
            "entity": metadata["entity"],
            "cik": metadata["cik"],
            "group": metadata["group"],
            "filings": [
                {
                    "quarter": "2025-Q4",
                    "filing_date": "2026-02-14",
                    "report_date": "2025-12-31",
                    "accession_number": f"0000000000-26-{index + 1:06d}",
                    "form": "13F-HR",
                    "holdings": [
                        holding("CORE", 900_000 + index, 9_000 + index),
                        holding(previous_ticker, 100_000, 1_000, sector="Industrials"),
                    ],
                },
                {
                    "quarter": "2026-Q1",
                    "filing_date": "2026-05-15",
                    "report_date": "2026-03-31",
                    "source_accessions": [f"0000000000-26-{index + 101:06d}"],
                    "form": "13F-HR",
                    "holdings": [
                        holding("CORE", 998_000 + index, 9_980 + index),
                        holding(current_ticker, 1_000, 10, sector="Industrials"),
                        holding(f"TINY{index:02d}", 500, 5, sector="Other"),
                    ],
                },
            ],
        }
    return runs


def expected_paths(registry: dict) -> set[str]:
    paths = {"summary.json", "by_ticker.json", "by_sector.json"}
    paths.update(f"investors/{investor_id}.json" for investor_id in registry["investors"])
    paths.update(f"analytics/{name}" for name in ANALYTIC_NAMES)
    return paths


class SliceAGeneratorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = load_registry()
        self.runs = build_runs(self.registry)
        self.investor_data = prepare_investor_data(self.registry, self.runs)

    def test_exact_sixty_investors_and_seventy_three_addressable_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            output_root = Path(temporary_root)
            manifest = generate_base_outputs(
                registry=self.registry,
                investor_data=self.investor_data,
                output_root=output_root,
                generated_at=GENERATED_AT,
            )

            paths = expected_paths(self.registry)
            frozen_manifest = json.loads(
                (ROOT / "tests" / "sec13f" / "fixtures" / "base_output_manifest.json").read_text()
            )
            frozen_paths = {
                entry["path"].removeprefix("data/sec-13f/")
                for entry in frozen_manifest["entries"]
            }
            self.assertEqual(len(self.runs), 60)
            self.assertEqual(manifest["investor_count"], 60)
            self.assertEqual(manifest["output_count"], 73)
            self.assertEqual(set(manifest["outputs"]), paths)
            self.assertEqual(paths, frozen_paths)
            self.assertEqual({entry["path"] for entry in manifest["entries"]}, paths)
            self.assertEqual(
                {path.relative_to(output_root).as_posix() for path in output_root.rglob("*.json")},
                paths,
            )

            for relative_path, address in manifest["outputs"].items():
                payload = (output_root / relative_path).read_bytes()
                self.assertEqual(address["bytes"], len(payload))
                self.assertEqual(address["sha256"], hashlib.sha256(payload).hexdigest())

            first_id = sorted(self.registry["investors"])[0]
            investor_payload = json.loads((output_root / "investors" / f"{first_id}.json").read_text())
            latest = investor_payload["investor"]["filings"][-1]
            self.assertEqual([row["ticker"] for row in latest["holdings"]], ["CORE", "NEW00"])
            self.assertEqual(latest["holdings"][1]["weight"], 0.001)
            self.assertEqual(latest["reported_holdings_count"], 3)
            self.assertEqual(latest["filtered_out_count"], 1)

    def test_replay_with_identical_inputs_is_byte_identical(self) -> None:
        shuffled_registry = deepcopy(self.registry)
        shuffled_registry["investors"] = dict(reversed(list(shuffled_registry["investors"].items())))
        shuffled_data = dict(reversed(list(deepcopy(self.investor_data).items())))
        with tempfile.TemporaryDirectory() as first_root, tempfile.TemporaryDirectory() as second_root:
            first = generate_base_outputs(
                registry=deepcopy(self.registry),
                investor_data=deepcopy(self.investor_data),
                output_root=Path(first_root),
                generated_at=GENERATED_AT,
            )
            second = generate_base_outputs(
                registry=shuffled_registry,
                investor_data=shuffled_data,
                output_root=Path(second_root),
                generated_at=GENERATED_AT,
            )

            self.assertEqual(first, second)
            for relative_path in first["outputs"]:
                self.assertEqual(
                    (Path(first_root) / relative_path).read_bytes(),
                    (Path(second_root) / relative_path).read_bytes(),
                )

    def test_holding_value_mutation_turns_manifest_red(self) -> None:
        changed_runs = deepcopy(self.runs)
        investor_id = sorted(changed_runs)[0]
        changed_runs[investor_id]["filings"][-1]["holdings"][0]["value"] += 1
        changed_data = prepare_investor_data(self.registry, changed_runs)

        with tempfile.TemporaryDirectory() as baseline_root, tempfile.TemporaryDirectory() as changed_root:
            baseline = generate_base_outputs(
                registry=self.registry,
                investor_data=self.investor_data,
                output_root=Path(baseline_root),
                generated_at=GENERATED_AT,
            )
            changed = generate_base_outputs(
                registry=self.registry,
                investor_data=changed_data,
                output_root=Path(changed_root),
                generated_at=GENERATED_AT,
            )

            self.assertNotEqual(baseline["manifest_digest"], changed["manifest_digest"])
            self.assertNotEqual(
                baseline["outputs"][f"investors/{investor_id}.json"]["sha256"],
                changed["outputs"][f"investors/{investor_id}.json"]["sha256"],
            )
            self.assertNotEqual(
                baseline["outputs"]["summary.json"]["sha256"],
                changed["outputs"]["summary.json"]["sha256"],
            )

    def test_missing_investor_fails_before_writing(self) -> None:
        incomplete = deepcopy(self.investor_data)
        incomplete.pop(sorted(incomplete)[0])
        with tempfile.TemporaryDirectory() as temporary_root:
            output_root = Path(temporary_root)
            with self.assertRaisesRegex(GeneratorError, "match registry exactly"):
                generate_base_outputs(
                    registry=self.registry,
                    investor_data=incomplete,
                    output_root=output_root,
                    generated_at=GENERATED_AT,
                )
            self.assertEqual(list(output_root.iterdir()), [])

    def test_protected_canonical_public_and_ancestor_roots_fail_before_writing(self) -> None:
        protected = [
            ROOT / "data" / "sec-13f",
            ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
            ROOT / "data",
        ]
        for output_root in protected:
            with self.subTest(output_root=output_root):
                with self.assertRaisesRegex(GeneratorError, "protected data tree"):
                    generate_base_outputs(
                        registry=self.registry,
                        investor_data=self.investor_data,
                        output_root=output_root,
                        generated_at=GENERATED_AT,
                    )


if __name__ == "__main__":
    unittest.main()
