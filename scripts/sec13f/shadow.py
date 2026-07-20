#!/usr/bin/env python3
"""Build the bounded Slice A SEC 13F shadow-parity report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any, Iterable

from contract import load_json, validate_registry
from parity import ParityBoundaryError, compare_parity


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "tests" / "sec13f" / "fixtures"
AUTHORIZED_REPORT = Path("data/admin/sec-13f-shadow-parity.json")
ACCESSION_PATTERN = re.compile(r"^\d{10}-\d{2}-\d{6}$")


class ShadowReportError(ValueError):
    """Raised when the bounded shadow-report contract is violated."""


def _investor_ids(paths: Iterable[str]) -> list[str]:
    return sorted(
        path.removeprefix("investors/").removesuffix(".json")
        for path in paths
        if path.startswith("investors/") and path.endswith(".json")
    )


def _validated_accessions(accessions: Iterable[str]) -> list[str]:
    values = sorted(set(accessions))
    invalid = [value for value in values if ACCESSION_PATTERN.fullmatch(value) is None]
    if invalid:
        raise ShadowReportError(f"invalid accession numbers: {invalid}")
    return values


def build_shadow_report(
    *,
    cch_root: Path,
    platform_root: Path,
    fixture_root: Path = FIXTURE_ROOT,
    registry_path: Path | None = None,
    accessions: Iterable[str] = (),
) -> dict[str, Any]:
    """Compare the frozen base boundary and add the required provenance fields."""

    fixture_root = Path(fixture_root)
    registry_path = registry_path or ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"
    registry = validate_registry(Path(registry_path))
    investor_ids = set(registry["investors"])
    cch_manifest = load_json(fixture_root / "cch_output_manifest.json")
    base_manifest = load_json(fixture_root / "base_output_manifest.json")
    source_manifest = load_json(fixture_root / "cch_source_manifest.json")
    fixture_contract = load_json(fixture_root / "sec_filing_cases.json")

    try:
        parity = compare_parity(
            cch_root=Path(cch_root),
            platform_root=Path(platform_root),
            cch_manifest_path=fixture_root / "cch_output_manifest.json",
            base_manifest_path=fixture_root / "base_output_manifest.json",
            contract_fixture_path=fixture_root / "sec_filing_cases.json",
            derived_manifest_path=fixture_root / "platform_derived_manifest.json",
        )
    except ParityBoundaryError as error:
        parity = error.report

    boundary = parity.get("boundary") or {
        "missing": {"cch": [], "platform": []},
        "extra": {"cch": [], "platform": []},
    }
    missing = boundary["missing"]
    extra = boundary["extra"]
    missing_investors = {
        "cch": _investor_ids(missing["cch"]),
        "platform": _investor_ids(missing["platform"]),
    }
    extra_investors = {
        "cch": _investor_ids(extra["cch"]),
        "platform": _investor_ids(extra["platform"]),
    }
    absent_investors = set(missing_investors["cch"]) | set(missing_investors["platform"])

    field_mismatches: list[dict[str, Any]] = []
    row_keys: set[tuple[str, str, str]] = set()
    for file_report in parity.get("files", []):
        for mismatch in file_report.get("mismatches", []):
            item = {"output": file_report["path"], **mismatch}
            field_mismatches.append(item)
            if mismatch.get("row_identity") is not None or str(mismatch.get("kind", "")).startswith("row_"):
                row_keys.add(
                    (
                        file_report["path"],
                        str(mismatch.get("row_path")),
                        json.dumps(mismatch.get("row_identity"), ensure_ascii=False, sort_keys=True),
                    )
                )

    summary = parity.get("summary", {})
    truncated = any(row.get("mismatches_truncated") for row in parity.get("files", []))
    parity_passed = parity.get("status") == "pass" and not truncated
    volatile_paths = fixture_contract.get("contract", {}).get("declared_cch_volatile_paths", [])
    report = {
        "schema_version": "sec13f-shadow-parity/v1",
        "source_commit": cch_manifest.get("source_commit"),
        "cch_snapshot_digest": source_manifest.get("snapshot_digest"),
        "platform_commit": base_manifest.get("platform_commit"),
        "registry_digest": source_manifest.get("source_registry_sha256"),
        "investors_expected": len(investor_ids),
        "investors_compared": len(investor_ids - absent_investors),
        "investors_missing": missing_investors,
        "investors_extra": extra_investors,
        "outputs_expected": summary.get("expected_files", 73),
        "outputs_compared": summary.get("compared_files", 0),
        "outputs_missing": missing,
        "outputs_extra": extra,
        "accessions_compared": _validated_accessions(accessions),
        "exact_match_count": summary.get("byte_exact_files", 0),
        "normalized_match_count": summary.get("normalized_equal_files", 0),
        "row_mismatch_count": len(row_keys),
        "field_mismatches": field_mismatches,
        "field_mismatches_truncated": truncated,
        "declared_volatile_paths": volatile_paths,
        "result": "pass" if parity_passed else "fail",
    }
    return report


def write_shadow_report(report: dict[str, Any], *, output_path: Path, repo_root: Path = ROOT) -> None:
    """Write only the private report path authorized by the Slice A plan."""

    repo_root = Path(repo_root).resolve()
    expected = (repo_root / AUTHORIZED_REPORT).resolve()
    output_path = Path(output_path)
    actual = (repo_root / output_path).resolve() if not output_path.is_absolute() else output_path.resolve()
    if actual != expected:
        raise ShadowReportError(f"report output is restricted to {AUTHORIZED_REPORT.as_posix()}")
    actual.parent.mkdir(parents=True, exist_ok=True)
    actual.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cch-root", type=Path, required=True)
    parser.add_argument("--platform-root", type=Path, default=ROOT / "data" / "sec-13f")
    parser.add_argument("--accession", action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    report = build_shadow_report(
        cch_root=args.cch_root,
        platform_root=args.platform_root,
        accessions=args.accession,
    )
    if args.output is None:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        write_shadow_report(report, output_path=args.output)
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
