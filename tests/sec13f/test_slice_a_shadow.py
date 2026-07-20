#!/usr/bin/env python3
"""Integration tests for the bounded Slice A shadow report."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SEC13F_SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SEC13F_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SEC13F_SCRIPTS))

from shadow import ShadowReportError, build_shadow_report, write_shadow_report  # noqa: E402


FIXTURE_ROOT = ROOT / "tests" / "sec13f" / "fixtures"


def dump_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


class SliceAShadowTest(unittest.TestCase):
    def test_report_has_required_provenance_and_exact_coverage_fields(self) -> None:
        manifest = json.loads((FIXTURE_ROOT / "cch_output_manifest.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            cch = root / "cch"
            platform = root / "platform"
            for entry in manifest["entries"]:
                payload = {
                    "metadata": {"generated_at": "2026-07-20T00:00:00Z"},
                    "rows": [{"ticker": "AAA", "value": 1}],
                }
                dump_json(cch / entry["path"], payload)
                dump_json(platform / entry["path"], payload)

            report = build_shadow_report(
                cch_root=cch,
                platform_root=platform,
                accessions=["0000000001-26-000001"],
            )

            self.assertEqual(report["result"], "pass")
            self.assertEqual(report["investors_expected"], 60)
            self.assertEqual(report["investors_compared"], 60)
            self.assertEqual(report["outputs_expected"], 73)
            self.assertEqual(report["outputs_compared"], 73)
            self.assertEqual(report["normalized_match_count"], 73)
            self.assertEqual(report["accessions_compared"], ["0000000001-26-000001"])
            self.assertEqual(report["field_mismatches"], [])
            for field in (
                "source_commit",
                "cch_snapshot_digest",
                "platform_commit",
                "registry_digest",
                "declared_volatile_paths",
            ):
                self.assertTrue(report[field])

    def test_report_write_is_restricted_to_the_private_shadow_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            with self.assertRaises(ShadowReportError):
                write_shadow_report({}, output_path=Path("data/sec-13f/forbidden.json"), repo_root=root)

            output = Path("data/admin/sec-13f-shadow-parity.json")
            write_shadow_report({"result": "pass"}, output_path=output, repo_root=root)
            self.assertEqual(json.loads((root / output).read_text(encoding="utf-8")), {"result": "pass"})

    def test_accession_format_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            with self.assertRaises(ShadowReportError):
                build_shadow_report(cch_root=root, platform_root=root, accessions=["not-an-accession"])


if __name__ == "__main__":
    unittest.main()
