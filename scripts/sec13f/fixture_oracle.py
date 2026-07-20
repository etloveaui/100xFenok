#!/usr/bin/env python3
"""Build the hermetic Slice A acquisition/generation parity report."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from typing import Any

from contract import (
    EXPECTED_BASE_OUTPUT_COUNT,
    load_json,
    sha256_file,
    validate_generator_input,
    validate_output_manifest,
    validate_registry,
)
from fixture_input import build_fixture_input
from parity import ParityBoundaryError, compare_parity


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "tests" / "sec13f" / "fixtures"
ACCESSION_PATTERN = re.compile(r"^\d{10}-\d{2}-\d{6}$")


class FixtureOracleError(ValueError):
    """The fixture-oracle boundary or lineage is incomplete."""


def _investor_ids(paths: list[str]) -> list[str]:
    return sorted(
        path.removeprefix("investors/").removesuffix(".json")
        for path in paths
        if path.startswith("investors/") and path.endswith(".json")
    )


def tree_digest(root: Path) -> str:
    """Address every regular file under a protected data tree."""

    root = Path(root)
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(sha256_file(path)))
        digest.update(b"\n")
    return digest.hexdigest()


def _parsed_accessions(fixture_input: dict[str, Any]) -> list[str]:
    values: set[str] = set()
    for investor in fixture_input["investors_data"].values():
        for filing in investor["filings"]:
            lineage = filing.get("accession_numbers")
            if not isinstance(lineage, list) or not lineage:
                raise FixtureOracleError("filing accession lineage is missing")
            for accession in lineage:
                if ACCESSION_PATTERN.fullmatch(accession) is None:
                    raise FixtureOracleError(f"invalid parsed accession: {accession}")
                values.add(accession)
    declared = fixture_input.get("accessions_compared")
    if not isinstance(declared, list) or values != set(declared):
        raise FixtureOracleError("parsed accession lineage does not match frozen input")
    return sorted(values)


def _validate_candidate_manifest(
    candidate_root: Path,
    manifest: dict[str, Any],
    *,
    expected_paths: set[str],
    expected_investor_data_digest: str,
) -> None:
    entries = manifest.get("entries")
    if (
        manifest.get("schema_version") != "sec13f-base-generation/v1"
        or manifest.get("logical_root") != "."
        or manifest.get("investor_count") != 60
        or manifest.get("output_count") != EXPECTED_BASE_OUTPUT_COUNT
        or not isinstance(entries, list)
    ):
        raise FixtureOracleError("candidate manifest requires exactly 73 entries")
    if manifest.get("generator_sha256") != sha256_file(ROOT / "scripts" / "sec13f" / "generator.py"):
        raise FixtureOracleError("candidate manifest generator digest mismatch")
    if manifest.get("investor_data_digest") != expected_investor_data_digest:
        raise FixtureOracleError("candidate manifest input digest mismatch")
    if len(entries) != EXPECTED_BASE_OUTPUT_COUNT:
        raise FixtureOracleError("candidate manifest entry count mismatch")
    root = Path(candidate_root).resolve()
    seen: set[str] = set()
    for entry in entries:
        relative = entry.get("path") if isinstance(entry, dict) else None
        if not isinstance(relative, str) or not relative or relative in seen:
            raise FixtureOracleError("candidate manifest path is invalid or duplicated")
        seen.add(relative)
        path = (root / relative).resolve()
        if root not in path.parents or not path.is_file():
            raise FixtureOracleError(f"candidate manifest path escapes or is missing: {relative}")
        if path.stat().st_size != entry.get("bytes") or sha256_file(path) != entry.get("sha256"):
            raise FixtureOracleError(f"candidate manifest address mismatch: {relative}")
    if seen != expected_paths:
        raise FixtureOracleError("candidate manifest path boundary mismatch")
    entries_encoded = json.dumps(
        entries,
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
        allow_nan=False,
    ).encode()
    if manifest.get("entries_digest") != hashlib.sha256(entries_encoded).hexdigest():
        raise FixtureOracleError("candidate manifest entries digest mismatch")
    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != expected_paths:
        raise FixtureOracleError("candidate manifest outputs index mismatch")
    for entry in entries:
        if outputs[entry["path"]] != {
            "category": entry.get("category"),
            "bytes": entry["bytes"],
            "sha256": entry["sha256"],
        }:
            raise FixtureOracleError(f"candidate manifest outputs drift: {entry['path']}")
    unsigned = dict(manifest)
    declared = unsigned.pop("manifest_digest", None)
    encoded = json.dumps(unsigned, ensure_ascii=False, indent=2, sort_keys=False, allow_nan=False).encode()
    if declared != hashlib.sha256(encoded).hexdigest():
        raise FixtureOracleError("candidate manifest digest mismatch")


def build_fixture_oracle_report(
    *,
    candidate_root: Path,
    candidate_manifest: dict[str, Any],
    canonical_tree_before: str,
    canonical_tree_after: str,
    public_tree_before: str,
    public_tree_after: str,
    platform_commit: str,
    fixture_root: Path = FIXTURE_ROOT,
    registry_path: Path | None = None,
) -> dict[str, Any]:
    fixture_root = Path(fixture_root)
    registry_path = registry_path or ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"
    registry = validate_registry(Path(registry_path))
    fixture_input = load_json(fixture_root / "generator_input.json")
    validate_generator_input(fixture_input, registry=registry)
    rebuilt_input = build_fixture_input(
        fixture_path=fixture_root / "sec_filing_cases.json",
        registry_path=Path(registry_path),
    )
    if rebuilt_input != fixture_input:
        raise FixtureOracleError("acquisition pipeline does not reproduce the frozen generator input")
    oracle_manifest = load_json(fixture_root / "cch_fixture_oracle_manifest.json")
    validate_output_manifest(
        oracle_manifest,
        fixture_root / "cch_fixture_oracle",
        expected_count=EXPECTED_BASE_OUTPUT_COUNT,
        label="CCH fixture oracle",
    )
    source_manifest = load_json(fixture_root / "cch_source_manifest.json")
    fixture_contract = load_json(fixture_root / "sec_filing_cases.json")
    if Path(candidate_root).resolve() == (fixture_root / "cch_fixture_oracle").resolve():
        raise FixtureOracleError("candidate root cannot alias the CCH fixture oracle")
    _validate_candidate_manifest(
        Path(candidate_root),
        candidate_manifest,
        expected_paths={entry["path"] for entry in oracle_manifest["entries"]},
        expected_investor_data_digest=hashlib.sha256(
            json.dumps(
                fixture_input["investors_data"],
                ensure_ascii=False,
                indent=2,
                sort_keys=False,
                allow_nan=False,
            ).encode()
        ).hexdigest(),
    )

    try:
        parity = compare_parity(
            cch_root=fixture_root / "cch_fixture_oracle",
            platform_root=Path(candidate_root),
            cch_manifest_path=fixture_root / "cch_fixture_oracle_manifest.json",
            base_manifest_path=fixture_root / "base_output_manifest.json",
            contract_fixture_path=fixture_root / "sec_filing_cases.json",
            derived_manifest_path=fixture_root / "platform_derived_manifest.json",
        )
    except ParityBoundaryError as error:
        parity = error.report

    boundary = parity.get("boundary", {})
    missing = boundary.get("missing", {"cch": [], "platform": []})
    extra = boundary.get("extra", {"cch": [], "platform": []})
    missing_investors = sorted(set(_investor_ids(missing["cch"])) | set(_investor_ids(missing["platform"])))
    extra_investors = sorted(set(_investor_ids(extra["cch"])) | set(_investor_ids(extra["platform"])))
    field_mismatches = [
        {"output": file_report["path"], **mismatch}
        for file_report in parity.get("files", [])
        for mismatch in file_report.get("mismatches", [])
    ]
    summary = parity.get("summary", {})
    case_results = fixture_input["case_results"]
    blocked_cases = [row["id"] for row in case_results if row["status"] == "blocked"]
    passed_cases = [row["id"] for row in case_results if row["status"] == "pass"]
    blocked_accessions = sorted(
        accession
        for row in case_results
        if row["status"] == "blocked"
        for accession in row["accessions"]
    )
    trees_unchanged = canonical_tree_before == canonical_tree_after and public_tree_before == public_tree_after
    parity_passed = parity.get("status") == "pass" and not field_mismatches

    return {
        "schema_version": "sec13f-slice-a-fixture-oracle/v1",
        "mode": "fixture_oracle",
        "source_commit": oracle_manifest["source_commit"],
        "cch_snapshot_digest": source_manifest["snapshot_digest"],
        "platform_commit": platform_commit,
        "registry_digest": fixture_input["registry_sha256"],
        "fixture_input_digest": fixture_input["content_digest"],
        "fixture_rebuild_digest": rebuilt_input["content_digest"],
        "oracle_manifest_digest": oracle_manifest["content_digest"],
        "candidate_generator_digest": sha256_file(ROOT / "scripts" / "sec13f" / "generator.py"),
        "candidate_manifest_digest": candidate_manifest.get("manifest_digest"),
        "investors_expected": len(registry["investors"]),
        "investors_compared": len(registry["investors"]) - len(missing_investors),
        "investors_missing": missing_investors,
        "investors_extra": extra_investors,
        "outputs_expected": summary.get("expected_files", 73),
        "outputs_compared": summary.get("compared_files", 0),
        "outputs_missing": missing,
        "outputs_extra": extra,
        "accessions_compared": _parsed_accessions(fixture_input),
        "accessions_blocked": blocked_accessions,
        "fixture_cases_expected": 9,
        "fixture_cases_passed": passed_cases,
        "fixture_cases_blocked": blocked_cases,
        "exact_match_count": summary.get("byte_exact_files", 0),
        "normalized_match_count": summary.get("normalized_equal_files", 0),
        "row_mismatch_count": summary.get("row_mismatch_count", 0),
        "field_mismatches": field_mismatches,
        "field_mismatches_truncated": any(
            item.get("mismatches_truncated") for item in parity.get("files", [])
        ),
        "declared_volatile_paths": fixture_contract["contract"]["declared_cch_volatile_paths"],
        "canonical_tree_before": canonical_tree_before,
        "canonical_tree_after": canonical_tree_after,
        "public_tree_before": public_tree_before,
        "public_tree_after": public_tree_after,
        "result": "pass" if parity_passed and trees_unchanged else "fail",
    }
