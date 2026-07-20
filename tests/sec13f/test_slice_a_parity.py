#!/usr/bin/env python3
"""RED/GREEN tests for the bounded SEC 13F Slice A parity core."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from parity import ParityBoundaryError, compare_parity  # noqa: E402


ANALYTICS = (
    "buying_pressure.json",
    "consensus.json",
    "conviction.json",
    "conviction_entries.json",
    "enhanced_consensus.json",
    "hhi.json",
    "multi_quarter_trends.json",
    "new_positions.json",
    "options_hedge.json",
    "turnover.json",
)


def dump_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ParityEstate:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.cch = root / "cch"
        self.platform = root / "platform"
        self.fixtures = root / "fixtures"
        self.paths = ["summary.json", "by_ticker.json", "by_sector.json"]
        self.paths.extend(f"investors/investor_{index:02d}.json" for index in range(60))
        self.paths.extend(f"analytics/{name}" for name in ANALYTICS)
        assert len(self.paths) == 73

        for relative_path in self.paths:
            payload = {
                "metadata": {"generated_at": "2026-07-20T00:00:00Z", "version": "fixture"},
                "rows": [{"ticker": "AAA", "market_value": 100}],
            }
            dump_json(self.cch / relative_path, payload)
            dump_json(self.platform / relative_path, payload)

        cch_entries = [
            {
                "path": relative_path,
                "category": "fixture",
                "bytes": (self.cch / relative_path).stat().st_size,
                "sha256": digest(self.cch / relative_path),
            }
            for relative_path in sorted(self.paths)
        ]
        platform_entries = [
            {
                "path": f"data/sec-13f/{relative_path}",
                "category": "fixture",
                "bytes": (self.platform / relative_path).stat().st_size,
                "sha256": digest(self.platform / relative_path),
            }
            for relative_path in sorted(self.paths)
        ]
        dump_json(self.fixtures / "cch_output_manifest.json", {"entries": cch_entries})
        dump_json(self.fixtures / "base_output_manifest.json", {"entries": platform_entries})
        dump_json(
            self.fixtures / "sec_filing_cases.json",
            {
                "contract": {
                    "declared_cch_volatile_paths": [
                        {
                            "file_patterns": [
                                "summary.json",
                                "investors/*.json",
                                "analytics/conviction.json",
                            ],
                            "json_path": "$.metadata.generated_at",
                            "measured_occurrences": 62,
                        }
                    ]
                }
            },
        )

    def compare(self) -> dict[str, object]:
        return compare_parity(
            cch_root=self.cch,
            platform_root=self.platform,
            cch_manifest_path=self.fixtures / "cch_output_manifest.json",
            base_manifest_path=self.fixtures / "base_output_manifest.json",
            contract_fixture_path=self.fixtures / "sec_filing_cases.json",
        )


class SliceAParityTest(unittest.TestCase):
    def test_exact_73_outputs_normalize_only_the_declared_generated_at(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            estate = ParityEstate(Path(temporary_root))
            for relative_path in estate.paths:
                if relative_path == "summary.json" or relative_path.startswith("investors/") or relative_path == "analytics/conviction.json":
                    payload = json.loads((estate.platform / relative_path).read_text(encoding="utf-8"))
                    payload["metadata"]["generated_at"] = "2026-07-20T01:00:00Z"
                    dump_json(estate.platform / relative_path, payload)

            report = estate.compare()

            self.assertEqual(report["status"], "pass")
            self.assertEqual(
                report["summary"],
                {
                    "expected_files": 73,
                    "compared_files": 73,
                    "byte_exact_files": 11,
                    "normalized_equal_files": 73,
                    "mismatched_files": 0,
                    "mismatch_count": 0,
                    "row_mismatch_count": 0,
                },
            )
            self.assertEqual(report["boundary"], {"missing": {"cch": [], "platform": []}, "extra": {"cch": [], "platform": []}})
            self.assertEqual(report["normalization"]["normalized_files"], 62)
            self.assertEqual(report["normalization"]["cch_occurrences"], 62)
            self.assertEqual(report["normalization"]["platform_occurrences"], 62)

    def test_undeclared_timestamp_and_row_field_mismatches_are_addressable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            estate = ParityEstate(Path(temporary_root))
            consensus = json.loads((estate.platform / "analytics/consensus.json").read_text(encoding="utf-8"))
            consensus["metadata"]["generated_at"] = "2026-07-20T01:00:00Z"
            consensus["rows"][0]["market_value"] = 101
            dump_json(estate.platform / "analytics/consensus.json", consensus)

            report = estate.compare()

            self.assertEqual(report["status"], "fail")
            file_report = next(row for row in report["files"] if row["path"] == "analytics/consensus.json")
            self.assertEqual(file_report["mismatch_count"], 2)
            mismatches = {row["json_path"]: row for row in file_report["mismatches"]}
            self.assertIn("$.metadata.generated_at", mismatches)
            row_mismatch = mismatches["$.rows[0].market_value"]
            self.assertEqual(row_mismatch["row_path"], "$.rows[0]")
            self.assertEqual(row_mismatch["field"], "market_value")
            self.assertEqual(row_mismatch["row_identity"], {"ticker": "AAA"})

    def test_missing_and_extra_outputs_fail_closed_before_value_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            estate = ParityEstate(Path(temporary_root))
            (estate.platform / "investors" / "investor_00.json").unlink()
            dump_json(estate.cch / "analytics" / "unexpected.json", {"unexpected": True})

            with self.assertRaises(ParityBoundaryError) as raised:
                estate.compare()

            self.assertEqual(raised.exception.report["boundary"]["missing"]["platform"], ["investors/investor_00.json"])
            self.assertEqual(raised.exception.report["boundary"]["extra"]["cch"], ["analytics/unexpected.json"])


if __name__ == "__main__":
    unittest.main()
