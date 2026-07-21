#!/usr/bin/env python3
"""Offline production-input boundary for the SEC 13F Slice C backfill."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "sec13f"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from cache import RawCache  # noqa: E402
from prepare_local_input import (  # noqa: E402
    LocalInputError,
    build_prepared_input,
    main,
    write_prepared_input,
)


REFERENCE_MAPPING = {
    "000000AA1": {"ticker": "AAA", "sector": "Technology"},
}

COVER = b"""<?xml version="1.0"?>
<edgarSubmission><summaryPage><tableEntryTotal>1</tableEntryTotal>
<tableValueTotal>100</tableValueTotal><isConfidentialOmitted>false</isConfidentialOmitted>
</summaryPage></edgarSubmission>"""

TABLE = b"""<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable><nameOfIssuer>Example Incorporated</nameOfIssuer><titleOfClass>COM</titleOfClass>
  <cusip>000000AA1</cusip><value>100</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt>
  <sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion>
  <votingAuthority><Sole>10</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable>
</informationTable>"""


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def document(accession: str, role: str, name: str, content: bytes) -> dict:
    return {
        "role": role,
        "name": name,
        "url": f"https://www.sec.gov/Archives/edgar/data/1/{accession.replace('-', '')}/{name}",
        "content": content,
    }


class SliceC0LocalInputTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.registry_path = SCRIPTS / "config" / "investors.yaml"
        cls.registry = yaml.safe_load(cls.registry_path.read_text(encoding="utf-8"))

    def _create_inputs(self, root: Path) -> tuple[Path, Path, Path]:
        cache_root = root / "raw-cache"
        cache = RawCache(cache_root)
        filings: list[dict] = []
        decisions: list[dict] = []
        for index, (investor_id, investor) in enumerate(sorted(self.registry["investors"].items()), start=1):
            cik = investor["cik"]
            accession = f"{cik}-26-{index:06d}"
            cache.store(
                cik=cik,
                accession=accession,
                documents=[
                    document(accession, "archive_index", "index.json", b'{"directory":{"item":[]}}'),
                    document(accession, "primary", "primary.xml", COVER),
                    document(accession, "information_table", "infotable.xml", TABLE),
                ],
            )
            filings.append({
                "investor_id": investor_id,
                "cik": cik,
                "accession": accession,
                "form": "13F-HR",
                "filing_date": "2026-05-15",
                "report_date": "2026-03-31",
                "primary_document": "primary.xml",
            })
            decisions.append({
                "cik": cik,
                "accession": accession,
                "unit": "thousands",
                "evidence": "operator-reviewed-local-cache",
                "confidence": 1.0,
            })

        manifest = {
            "schema_version": "sec13f-local-input/v1",
            "registry_sha256": hashlib.sha256(self.registry_path.read_bytes()).hexdigest(),
            "filings": sorted(filings, key=lambda row: (row["investor_id"], row["report_date"], row["filing_date"], row["accession"])),
            "unit_decisions": sorted(decisions, key=lambda row: (row["cik"], row["accession"])),
        }
        manifest["content_digest"] = digest(manifest)
        manifest_path = root / "input-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        reference_path = root / "reference-mapping.json"
        reference_path.write_text(json.dumps(REFERENCE_MAPPING, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return manifest_path, reference_path, cache_root

    def test_complete_local_manifest_builds_generator_safe_input_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            manifest_path, reference_path, cache_root = self._create_inputs(root)

            prepared = build_prepared_input(
                manifest_path=manifest_path,
                registry_path=self.registry_path,
                reference_mapping_path=reference_path,
                cache_root=cache_root,
            )

        self.assertEqual(prepared["schema_version"], "sec13f-local-prepared-input/v1")
        self.assertEqual(prepared["investor_count"], 60)
        self.assertEqual(prepared["filing_count"], 60)
        self.assertEqual(len(prepared["investors_data"]), 60)
        self.assertEqual(len(prepared["documents"]), 60)
        first = prepared["investors_data"][sorted(prepared["investors_data"])[0]]["filings"][0]
        self.assertEqual(first["holdings"][0]["ticker"], "AAA")
        self.assertEqual(first["holdings"][0]["market_value"], 100_000)
        self.assertEqual(prepared["content_digest"], digest({key: value for key, value in prepared.items() if key != "content_digest"}))

    def test_manifest_rejects_missing_unit_decision_before_any_output_write(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            manifest_path, reference_path, cache_root = self._create_inputs(root)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["unit_decisions"].pop()
            manifest["content_digest"] = digest({key: value for key, value in manifest.items() if key != "content_digest"})
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(LocalInputError, "unit decisions"):
                build_prepared_input(
                    manifest_path=manifest_path,
                    registry_path=self.registry_path,
                    reference_mapping_path=reference_path,
                    cache_root=cache_root,
                )

    def test_manifest_rejects_incomplete_filing_row_with_a_typed_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            manifest_path, reference_path, cache_root = self._create_inputs(root)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["filings"][0].pop("primary_document")
            manifest["content_digest"] = digest({key: value for key, value in manifest.items() if key != "content_digest"})
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(LocalInputError, "filings have an unsupported field set"):
                build_prepared_input(
                    manifest_path=manifest_path,
                    registry_path=self.registry_path,
                    reference_mapping_path=reference_path,
                    cache_root=cache_root,
                )

    def test_cli_writes_only_explicit_noncanonical_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            manifest_path, reference_path, cache_root = self._create_inputs(root)
            output = root / "prepared-input.json"

            self.assertEqual(main([
                "--manifest", str(manifest_path),
                "--registry", str(self.registry_path),
                "--reference-mapping", str(reference_path),
                "--cache-root", str(cache_root),
                "--output", str(output),
            ]), 0)
            self.assertTrue(output.is_file())

            with self.assertRaisesRegex(LocalInputError, "protected data tree"):
                main([
                    "--manifest", str(manifest_path),
                    "--registry", str(self.registry_path),
                    "--reference-mapping", str(reference_path),
                    "--cache-root", str(cache_root),
                    "--output", str(ROOT / "data" / "sec-13f" / "prepared-input.json"),
                ])

    def test_output_symlink_is_rejected_before_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            target = root / "existing.json"
            target.write_text('{"preserve":true}\n', encoding="utf-8")
            output = root / "prepared-input.json"
            output.symlink_to(target)

            with self.assertRaisesRegex(LocalInputError, "must not contain symlinks"):
                write_prepared_input(
                    payload={"schema_version": "test-only"},
                    output_path=output,
                    cache_root=root / "raw-cache",
                    overwrite=True,
                )
            self.assertEqual(target.read_text(encoding="utf-8"), '{"preserve":true}\n')

    def test_output_symlinked_parent_and_parent_traversal_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            target_directory = root / "target"
            target_directory.mkdir()
            linked_parent = root / "linked-parent"
            linked_parent.symlink_to(target_directory, target_is_directory=True)

            with self.assertRaisesRegex(LocalInputError, "must not contain symlinks"):
                write_prepared_input(
                    payload={"schema_version": "test-only"},
                    output_path=linked_parent / "prepared-input.json",
                    cache_root=root / "raw-cache",
                )
            self.assertFalse((target_directory / "prepared-input.json").exists())

            (root / "sub").mkdir()
            with self.assertRaisesRegex(LocalInputError, "must not contain parent traversal"):
                write_prepared_input(
                    payload={"schema_version": "test-only"},
                    output_path=root / "sub" / ".." / "escaped.json",
                    cache_root=root / "raw-cache",
                )
            self.assertFalse((root / "escaped.json").exists())

    def test_existing_non_regular_outputs_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            directory_output = root / "directory-output"
            directory_output.mkdir()
            with self.assertRaisesRegex(LocalInputError, "must be a regular file"):
                write_prepared_input(
                    payload={"schema_version": "test-only"},
                    output_path=directory_output,
                    cache_root=root / "raw-cache",
                    overwrite=True,
                )

            fifo_output = root / "fifo-output"
            os.mkfifo(fifo_output)
            with self.assertRaisesRegex(LocalInputError, "must be a regular file"):
                write_prepared_input(
                    payload={"schema_version": "test-only"},
                    output_path=fifo_output,
                    cache_root=root / "raw-cache",
                    overwrite=True,
                )


if __name__ == "__main__":
    unittest.main()
