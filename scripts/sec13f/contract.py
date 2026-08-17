#!/usr/bin/env python3
"""Deterministic validators for the frozen SEC 13F Slice 0 contract."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re
from typing import Any

import yaml


EXPECTED_INVESTOR_COUNT = 63
EXPECTED_BASE_OUTPUT_COUNT = 76
EXPECTED_DERIVED_OUTPUT_COUNT = 5
CIK_PATTERN = re.compile(r"^\d{10}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
EXPECTED_REGISTRY_SHA256 = "4190d0865b97b5ba69bfd229df5b2cea7bc8947021b8a0fdaa10f0fdde1a2784"
PINNED_CONTENT_DIGESTS = {
    "sec13f-base-output-manifest/v1": "e80b00d2149c64341a25b7eb4ec6be4f64d722e342e7adca8ee65f6c585c58df",
    "sec13f-cch-cache-manifest/v1": "ecad1fd8beb2d3a8639222a2e7172c94dd6abf2d6cef3ec99e487b49b6cdf249",
    "sec13f-cch-output-manifest/v1": "d7e01ce94e57c72477ca42321458c182dc81d93bbd5eb3d4fd0e5b5c739c9b5b",
    "sec13f-cch-platform-baseline/v1": "874be75c9a645339e800553237551c63ed091e977955f107706fe69ab853600e",
    "sec13f-cch-fixture-oracle/v1": "03ef5848d395b84e1d8a655852f3fdacf3999bc54d67ec7b9abb3eddc720da82",
    "sec13f-cch-snapshot/v1": "ad15a499e9c190b3ce6e1a97340f6768b87b03fa9c84d7addb864be03d5da430",
    "sec13f-platform-derived-manifest/v1": "e6cc941539fe9ed001017463a5261446438c88c9a56b131ce35aef9c40f36a64",
    "sec13f-generator-input/v1": "7b081866187831c17efd7c6a1acc9ccd9004993a4cb5d867995d677bcb8c534f",
    "sec13f-slice0-fixtures/v1": "2ab5871e167526b74e991854437d98b041546ac76a625c2fb29c97e71b46a0f2",
}


class ContractError(ValueError):
    """Raised when a frozen contract no longer matches its declared shape."""


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def content_digest(payload: dict[str, Any]) -> str:
    normalized = copy.deepcopy(payload)
    normalized.pop("content_digest", None)
    return sha256_bytes(canonical_json(normalized))


def _validate_self_digest(payload: dict[str, Any], label: str) -> None:
    if payload.get("content_digest") != content_digest(payload):
        raise ContractError(f"{label}: content digest mismatch")


def _validate_pinned_digest(payload: dict[str, Any], label: str) -> None:
    schema_version = payload.get("schema_version")
    expected = PINNED_CONTENT_DIGESTS.get(schema_version)
    if expected is None:
        raise ContractError(f"{label}: unpinned schema version {schema_version!r}")
    if payload.get("content_digest") != expected:
        raise ContractError(f"{label}: pinned content digest mismatch")


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ContractError(f"{path}: expected a JSON object")
    return payload


def validate_registry(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ContractError("registry must be a mapping")

    groups = payload.get("groups")
    investors = payload.get("investors")
    if not isinstance(groups, dict) or not isinstance(investors, dict):
        raise ContractError("registry must declare groups and investors mappings")
    if len(investors) != EXPECTED_INVESTOR_COUNT:
        raise ContractError(
            f"registry investor count changed: {len(investors)} != {EXPECTED_INVESTOR_COUNT}"
        )

    seen_ciks: set[str] = set()
    for investor_id, investor in investors.items():
        if not isinstance(investor_id, str) or not investor_id:
            raise ContractError("investor id must be a non-empty string")
        if not isinstance(investor, dict):
            raise ContractError(f"{investor_id}: investor record must be a mapping")
        cik = investor.get("cik")
        if not isinstance(cik, str) or CIK_PATTERN.fullmatch(cik) is None:
            raise ContractError(f"{investor_id}: CIK must be exactly 10 digits")
        if cik in seen_ciks:
            raise ContractError(f"duplicate CIK: {cik}")
        seen_ciks.add(cik)
        if not isinstance(investor.get("name"), str) or not investor["name"]:
            raise ContractError(f"{investor_id}: display name is required")
        if not isinstance(investor.get("entity"), str) or not investor["entity"]:
            raise ContractError(f"{investor_id}: filing entity is required")
        if investor.get("group") not in groups:
            raise ContractError(f"{investor_id}: unknown group {investor.get('group')!r}")
        if investor.get("active") is not True:
            raise ContractError(f"{investor_id}: frozen registry requires active=true")

    if sha256_file(path) != EXPECTED_REGISTRY_SHA256:
        raise ContractError("registry: pinned sha256 mismatch")

    return payload


def _validate_entries(entries: Any, expected_count: int, label: str) -> list[dict[str, Any]]:
    if not isinstance(entries, list):
        raise ContractError(f"{label}: entries must be a list")
    if len(entries) != expected_count:
        raise ContractError(f"{label}: output count changed: {len(entries)} != {expected_count}")
    paths: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ContractError(f"{label}: every entry must be an object")
        path = entry.get("path")
        digest = entry.get("sha256")
        if not isinstance(path, str) or not path:
            raise ContractError(f"{label}: entry path is required")
        if path in paths:
            raise ContractError(f"{label}: duplicate path {path}")
        paths.add(path)
        if not isinstance(digest, str) or SHA256_PATTERN.fullmatch(digest) is None:
            raise ContractError(f"{label}: invalid sha256 for {path}")
        if not isinstance(entry.get("bytes"), int) or entry["bytes"] < 0:
            raise ContractError(f"{label}: invalid byte count for {path}")
    return entries


def validate_output_manifest(
    payload: dict[str, Any],
    root: Path,
    *,
    expected_count: int,
    label: str,
) -> None:
    _validate_self_digest(payload, label)
    entries = _validate_entries(payload.get("entries"), expected_count, label)
    if payload.get("entries_digest") != sha256_bytes(canonical_json(entries)):
        raise ContractError(f"{label}: entries digest mismatch")
    for entry in entries:
        output_path = root / entry["path"]
        if not output_path.is_file():
            raise ContractError(f"{label}: missing output {entry['path']}")
        if output_path.stat().st_size != entry["bytes"]:
            raise ContractError(f"{label}: byte count changed for {entry['path']}")
        if sha256_file(output_path) != entry["sha256"]:
            raise ContractError(f"{label}: sha256 changed for {entry['path']}")
    _validate_pinned_digest(payload, label)


def validate_source_manifest(payload: dict[str, Any]) -> None:
    _validate_self_digest(payload, "CCH source manifest")
    entries = payload.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ContractError("CCH source manifest: entries are required")
    _validate_entries(entries, len(entries), "CCH source manifest")
    snapshot_digest = sha256_bytes(canonical_json(entries))
    if payload.get("snapshot_digest") != snapshot_digest:
        raise ContractError("CCH source manifest: snapshot digest mismatch")
    _validate_pinned_digest(payload, "CCH source manifest")


def validate_detached_manifest(
    payload: dict[str, Any],
    *,
    expected_count: int,
    label: str,
) -> None:
    _validate_self_digest(payload, label)
    entries = _validate_entries(payload.get("entries"), expected_count, label)
    if payload.get("entries_digest") != sha256_bytes(canonical_json(entries)):
        raise ContractError(f"{label}: entries digest mismatch")
    _validate_pinned_digest(payload, label)


def validate_comparison_manifest(payload: dict[str, Any], root: Path) -> None:
    _validate_self_digest(payload, "CCH/platform comparison")
    entries = payload.get("entries")
    if not isinstance(entries, list) or len(entries) != EXPECTED_BASE_OUTPUT_COUNT:
        raise ContractError("CCH/platform comparison: exact 76 entries are required")
    exact_count = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ContractError("CCH/platform comparison: every entry must be an object")
        cch_digest = entry.get("cch_sha256")
        platform_digest = entry.get("platform_sha256")
        if not isinstance(cch_digest, str) or SHA256_PATTERN.fullmatch(cch_digest) is None:
            raise ContractError("CCH/platform comparison: invalid CCH digest")
        if not isinstance(platform_digest, str) or SHA256_PATTERN.fullmatch(platform_digest) is None:
            raise ContractError("CCH/platform comparison: invalid platform digest")
        platform_path = root / entry.get("platform_path", "")
        if not platform_path.is_file() or sha256_file(platform_path) != platform_digest:
            raise ContractError(f"CCH/platform comparison: platform baseline changed at {platform_path}")
        exact = cch_digest == platform_digest
        if entry.get("byte_exact") is not exact:
            raise ContractError("CCH/platform comparison: byte_exact flag drift")
        exact_count += int(exact)
    expected_summary = {
        "compared": EXPECTED_BASE_OUTPUT_COUNT,
        "byte_exact": exact_count,
        "byte_mismatch": EXPECTED_BASE_OUTPUT_COUNT - exact_count,
    }
    if payload.get("summary") != expected_summary:
        raise ContractError("CCH/platform comparison: summary drift")
    _validate_pinned_digest(payload, "CCH/platform comparison")


def validate_fixture_contract(payload: dict[str, Any]) -> None:
    _validate_self_digest(payload, "SEC fixture contract")
    provenance = payload.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("classification") != "synthetic_sanitized":
        raise ContractError("SEC fixture contract: synthetic provenance is required")
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ContractError("SEC fixture contract: cases must be a list")
    expected_ids = {
        "base_filing",
        "restatement",
        "add_new_holdings",
        "restatement_then_addition",
        "confidential_omission",
        "absent_information_table",
        "malformed_xml",
        "duplicate_rows",
        "cover_count_mismatch",
    }
    actual_ids = {case.get("id") for case in cases if isinstance(case, dict)}
    if actual_ids != expected_ids or len(cases) != len(expected_ids):
        raise ContractError("SEC fixture contract: exact nine fixture cases are required")
    for case in cases:
        if not isinstance(case.get("accessions"), list) or not case["accessions"]:
            raise ContractError(f"{case.get('id')}: accession list is required")
        if not isinstance(case.get("expected"), dict):
            raise ContractError(f"{case.get('id')}: expected result is required")
        case_provenance = case.get("provenance")
        if (
            not isinstance(case_provenance, dict)
            or case_provenance.get("classification") != "synthetic_sanitized"
            or not case_provenance.get("cch_evidence")
        ):
            raise ContractError(f"{case.get('id')}: per-case provenance is required")
    serialized = canonical_json(payload)
    forbidden = (b"contact@example.com", b"BEGIN PRIVATE KEY", b"api_key", b"access_token")
    if any(token in serialized for token in forbidden):
        raise ContractError("SEC fixture contract: credential-like content is forbidden")
    _validate_pinned_digest(payload, "SEC fixture contract")


def validate_generator_input(payload: dict[str, Any], *, registry: dict[str, Any] | None = None) -> None:
    _validate_self_digest(payload, "generator input")
    if payload.get("registry_sha256") != EXPECTED_REGISTRY_SHA256:
        raise ContractError("generator input: registry digest mismatch")
    investors = payload.get("investors_data")
    if not isinstance(investors, dict) or len(investors) != EXPECTED_INVESTOR_COUNT:
        raise ContractError("generator input: exact 63 investors are required")
    if registry is not None and set(investors) != set(registry["investors"]):
        raise ContractError("generator input: investor identities do not match registry")
    if any(not isinstance(row, dict) or len(row.get("filings", [])) != 4 for row in investors.values()):
        raise ContractError("generator input: every investor requires four parsed quarters")
    if payload.get("quarters_covered") != ["2026-Q1", "2025-Q4", "2025-Q3", "2025-Q2"]:
        raise ContractError("generator input: frozen quarter coverage changed")
    if payload.get("generated_at") != "2026-07-20T12:00:00":
        raise ContractError("generator input: fixed generated_at changed")
    accessions = payload.get("accessions_compared")
    if not isinstance(accessions, list) or len(accessions) != 504 or len(set(accessions)) != 504:
        raise ContractError("generator input: exact 504 unique parsed accessions are required")
    if any(re.fullmatch(r"\d{10}-\d{2}-\d{6}", value) is None for value in accessions):
        raise ContractError("generator input: invalid accession")
    lineage = {
        accession
        for investor in investors.values()
        for filing in investor["filings"]
        for accession in filing.get("accession_numbers", [])
    }
    if lineage != set(accessions):
        raise ContractError("generator input: accession lineage mismatch")
    case_results = payload.get("case_results")
    if not isinstance(case_results, list) or len(case_results) != 9:
        raise ContractError("generator input: exact nine measured case results are required")
    statuses = [row.get("status") for row in case_results if isinstance(row, dict)]
    if statuses.count("pass") != 6 or statuses.count("blocked") != 3:
        raise ContractError("generator input: measured case result counts changed")
    _validate_pinned_digest(payload, "generator input")


def load_and_validate_all(root: Path) -> None:
    fixture_root = root / "tests" / "sec13f" / "fixtures"
    registry = validate_registry(root / "scripts" / "sec13f" / "config" / "investors.yaml")
    validate_fixture_contract(load_json(fixture_root / "sec_filing_cases.json"))
    validate_generator_input(load_json(fixture_root / "generator_input.json"), registry=registry)
    validate_source_manifest(load_json(fixture_root / "cch_source_manifest.json"))
    validate_detached_manifest(
        load_json(fixture_root / "cch_cache_manifest.json"),
        expected_count=65,
        label="CCH cache manifest",
    )
    validate_output_manifest(
        load_json(fixture_root / "cch_fixture_oracle_manifest.json"),
        fixture_root / "cch_fixture_oracle",
        expected_count=EXPECTED_BASE_OUTPUT_COUNT,
        label="CCH fixture oracle",
    )
    validate_detached_manifest(
        load_json(fixture_root / "cch_output_manifest.json"),
        expected_count=EXPECTED_BASE_OUTPUT_COUNT,
        label="CCH output manifest",
    )
    validate_output_manifest(
        load_json(fixture_root / "base_output_manifest.json"),
        root,
        expected_count=EXPECTED_BASE_OUTPUT_COUNT,
        label="base output manifest",
    )
    validate_output_manifest(
        load_json(fixture_root / "platform_derived_manifest.json"),
        root,
        expected_count=EXPECTED_DERIVED_OUTPUT_COUNT,
        label="platform derived manifest",
    )
    validate_comparison_manifest(
        load_json(fixture_root / "cch_platform_baseline.json"),
        root,
    )
