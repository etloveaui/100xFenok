#!/usr/bin/env python3
"""Fail-closed parity comparison for the frozen SEC 13F 73-output base."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_OUTPUT_COUNT = 73
PLATFORM_PREFIX = "data/sec-13f/"
REPORT_SCHEMA_VERSION = "sec13f-slice-a-parity/v1"
ONLY_SUPPORTED_VOLATILE_PATH = "$.metadata.generated_at"
IDENTITY_FIELDS = (
    "ticker",
    "investor_id",
    "investor",
    "accession_number",
    "quarter",
    "cusip",
    "id",
    "name",
)
SAFE_JSON_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class ParityError(ValueError):
    """Base error for a parity contract or comparison failure."""


class ParityBoundaryError(ParityError):
    """Raised before value comparison when the exact output boundary drifts."""

    def __init__(self, message: str, report: dict[str, Any]) -> None:
        super().__init__(message)
        self.report = report


def _load_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ParityError(f"cannot load JSON object {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ParityError(f"expected JSON object: {path}")
    return value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_paths(path: Path, *, platform: bool) -> tuple[list[str], dict[str, dict[str, Any]]]:
    manifest = _load_object(path)
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ParityError(f"manifest entries must be a list: {path}")
    logical_entries: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ParityError(f"manifest entry path is invalid: {path}")
        logical_path = entry["path"]
        if platform:
            if not logical_path.startswith(PLATFORM_PREFIX):
                raise ParityError(f"platform manifest path escapes base root: {logical_path}")
            logical_path = logical_path.removeprefix(PLATFORM_PREFIX)
        if logical_path in logical_entries:
            raise ParityError(f"duplicate manifest path: {logical_path}")
        logical_entries[logical_path] = entry
    return sorted(logical_entries), logical_entries


def _derived_paths(base_manifest_path: Path, explicit_path: Path | None) -> set[str]:
    path = explicit_path or base_manifest_path.with_name("platform_derived_manifest.json")
    if not path.is_file():
        return set()
    paths, _ = _manifest_paths(path, platform=True)
    return set(paths)


def _discover_outputs(root: Path, *, excluded: set[str]) -> set[str]:
    discovered: set[str] = set()
    for path in root.glob("*.json"):
        relative = path.relative_to(root).as_posix()
        if relative not in {"conversion_report.json", "schema.json"}:
            discovered.add(relative)
    for directory in ("investors", "analytics"):
        folder = root / directory
        if folder.is_dir():
            discovered.update(
                path.relative_to(root).as_posix()
                for path in folder.rglob("*.json")
                if path.is_file()
            )
    return discovered - excluded


def _load_normalization_rules(path: Path, expected_paths: set[str]) -> list[dict[str, Any]]:
    fixture = _load_object(path)
    contract = fixture.get("contract")
    rules = contract.get("declared_cch_volatile_paths") if isinstance(contract, dict) else None
    if not isinstance(rules, list) or not rules:
        raise ParityError("declared_cch_volatile_paths is required")
    normalized: list[dict[str, Any]] = []
    for rule in rules:
        if not isinstance(rule, dict):
            raise ParityError("volatile-path rule must be an object")
        patterns = rule.get("file_patterns")
        json_path = rule.get("json_path")
        measured = rule.get("measured_occurrences")
        if (
            not isinstance(patterns, list)
            or not patterns
            or not all(isinstance(pattern, str) and pattern for pattern in patterns)
        ):
            raise ParityError("volatile-path rule requires file_patterns")
        if json_path != ONLY_SUPPORTED_VOLATILE_PATH:
            raise ParityError(f"undeclared normalization path is forbidden: {json_path!r}")
        matched = sorted(
            logical_path
            for logical_path in expected_paths
            if any(fnmatch.fnmatchcase(logical_path, pattern) for pattern in patterns)
        )
        if not isinstance(measured, int) or measured != len(matched):
            raise ParityError(
                "volatile-path measured occurrence drift: "
                f"declared={measured!r} matched={len(matched)}"
            )
        normalized.append(
            {
                "file_patterns": list(patterns),
                "json_path": json_path,
                "measured_occurrences": measured,
                "matched_files": matched,
            }
        )
    return normalized


def _remove_generated_at(payload: dict[str, Any]) -> bool:
    metadata = payload.get("metadata")
    if isinstance(metadata, dict) and "generated_at" in metadata:
        del metadata["generated_at"]
        return True
    return False


def _normalize_declared_set_orders(logical_path: str, payload: Any) -> None:
    """Apply only the set-order semantics frozen in sec_filing_cases.json."""

    if not isinstance(payload, dict):
        return
    if logical_path == "by_sector.json":
        for sector in payload.values():
            if isinstance(sector, dict) and isinstance(sector.get("investors"), list):
                sector["investors"].sort()
    elif logical_path == "analytics/new_positions.json":
        rows = payload.get("new_positions")
        if isinstance(rows, list):
            rows.sort(
                key=lambda row: (
                    -row.get("position_value", 0),
                    row.get("investor", ""),
                    row.get("ticker", ""),
                )
            )
    elif logical_path == "analytics/buying_pressure.json":
        for key in ("top_buying", "top_selling"):
            rows = payload.get(key)
            if isinstance(rows, list):
                pressures = [row.get("pressure") for row in rows if isinstance(row, dict)]
                expected = sorted(pressures, reverse=key == "top_buying")
                if len(pressures) != len(rows) or pressures != expected:
                    continue
                start = 0
                while start < len(rows):
                    end = start + 1
                    while end < len(rows) and rows[end].get("pressure") == rows[start].get("pressure"):
                        end += 1
                    rows[start:end] = sorted(
                        rows[start:end],
                        key=lambda row: json.dumps(row, ensure_ascii=False, sort_keys=True),
                    )
                    start = end
    elif logical_path == "analytics/multi_quarter_trends.json":
        by_investor = payload.get("by_investor")
        if isinstance(by_investor, dict):
            for trend in by_investor.values():
                rows = trend.get("streaks") if isinstance(trend, dict) else None
                if isinstance(rows, list):
                    rows.sort(
                        key=lambda row: (
                            -row.get("streak_quarters", 0),
                            row.get("ticker", ""),
                            row.get("direction", ""),
                            row.get("start_quarter", ""),
                            row.get("end_quarter", ""),
                        )
                    )


def _json_path(tokens: tuple[str | int, ...]) -> str:
    value = "$"
    for token in tokens:
        if isinstance(token, int):
            value += f"[{token}]"
        elif SAFE_JSON_KEY.fullmatch(token):
            value += f".{token}"
        else:
            value += f"[{json.dumps(token, ensure_ascii=False)}]"
    return value


def _identity(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    for key in IDENTITY_FIELDS:
        candidate = value.get(key)
        if isinstance(candidate, (str, int, float)) and not isinstance(candidate, bool):
            return {key: candidate}
    return None


def _reported_value(present: bool, value: Any) -> dict[str, Any]:
    if not present:
        return {"present": False}
    if isinstance(value, (dict, list)):
        return {
            "present": True,
            "type": type(value).__name__,
            "size": len(value),
        }
    if isinstance(value, str) and len(value) > 512:
        value = value[:509] + "..."
    return {"present": True, "value": value}


class _DiffCollector:
    def __init__(self, sample_limit: int) -> None:
        if sample_limit < 1:
            raise ParityError("mismatch_sample_limit must be positive")
        self.sample_limit = sample_limit
        self.count = 0
        self.samples: list[dict[str, Any]] = []
        self.row_keys: set[tuple[str, str]] = set()

    def add(
        self,
        *,
        tokens: tuple[str | int, ...],
        kind: str,
        cch_present: bool,
        cch_value: Any,
        platform_present: bool,
        platform_value: Any,
        row_identity: dict[str, Any] | None,
    ) -> None:
        self.count += 1
        field = tokens[-1] if tokens and isinstance(tokens[-1], str) else None
        row_tokens = tokens[:-1] if field is not None else tokens
        if row_identity is not None or kind.startswith("row_"):
            self.row_keys.add(
                (
                    _json_path(row_tokens),
                    json.dumps(row_identity, ensure_ascii=False, sort_keys=True),
                )
            )
        if len(self.samples) >= self.sample_limit:
            return
        self.samples.append(
            {
                "json_path": _json_path(tokens),
                "row_path": _json_path(row_tokens),
                "field": field,
                "row_identity": row_identity,
                "kind": kind,
                "cch": _reported_value(cch_present, cch_value),
                "platform": _reported_value(platform_present, platform_value),
            }
        )


def _diff_json(
    cch: Any,
    platform: Any,
    collector: _DiffCollector,
    *,
    tokens: tuple[str | int, ...] = (),
    row_identity: dict[str, Any] | None = None,
) -> None:
    if type(cch) is not type(platform):
        collector.add(
            tokens=tokens,
            kind="type_mismatch",
            cch_present=True,
            cch_value=cch,
            platform_present=True,
            platform_value=platform,
            row_identity=row_identity,
        )
        return
    if isinstance(cch, dict):
        for key in sorted(set(cch) | set(platform)):
            in_cch = key in cch
            in_platform = key in platform
            next_tokens = (*tokens, key)
            if not in_cch or not in_platform:
                collector.add(
                    tokens=next_tokens,
                    kind="missing_in_cch" if not in_cch else "missing_in_platform",
                    cch_present=in_cch,
                    cch_value=cch.get(key),
                    platform_present=in_platform,
                    platform_value=platform.get(key),
                    row_identity=row_identity,
                )
            else:
                _diff_json(
                    cch[key],
                    platform[key],
                    collector,
                    tokens=next_tokens,
                    row_identity=row_identity,
                )
        return
    if isinstance(cch, list):
        common = min(len(cch), len(platform))
        for index in range(common):
            identity = _identity(cch[index]) or _identity(platform[index]) or row_identity
            _diff_json(
                cch[index],
                platform[index],
                collector,
                tokens=(*tokens, index),
                row_identity=identity,
            )
        for index in range(common, max(len(cch), len(platform))):
            in_cch = index < len(cch)
            in_platform = index < len(platform)
            value = cch[index] if in_cch else platform[index]
            collector.add(
                tokens=(*tokens, index),
                kind="row_missing_in_cch" if not in_cch else "row_missing_in_platform",
                cch_present=in_cch,
                cch_value=cch[index] if in_cch else None,
                platform_present=in_platform,
                platform_value=platform[index] if in_platform else None,
                row_identity=_identity(value) or row_identity,
            )
        return
    if cch != platform:
        collector.add(
            tokens=tokens,
            kind="value_mismatch",
            cch_present=True,
            cch_value=cch,
            platform_present=True,
            platform_value=platform,
            row_identity=row_identity,
        )


def _boundary_report(
    *,
    expected_paths: set[str],
    cch_discovered: set[str],
    platform_discovered: set[str],
) -> dict[str, Any]:
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "status": "blocked",
        "summary": {
            "expected_files": len(expected_paths),
            "compared_files": 0,
            "byte_exact_files": 0,
            "normalized_equal_files": 0,
            "mismatched_files": 0,
            "mismatch_count": 0,
            "row_mismatch_count": 0,
        },
        "boundary": {
            "missing": {
                "cch": sorted(expected_paths - cch_discovered),
                "platform": sorted(expected_paths - platform_discovered),
            },
            "extra": {
                "cch": sorted(cch_discovered - expected_paths),
                "platform": sorted(platform_discovered - expected_paths),
            },
        },
        "normalization": None,
        "files": [],
    }


def compare_parity(
    *,
    cch_root: Path,
    platform_root: Path,
    cch_manifest_path: Path,
    base_manifest_path: Path,
    contract_fixture_path: Path,
    derived_manifest_path: Path | None = None,
    mismatch_sample_limit: int = 200,
) -> dict[str, Any]:
    """Compare the exact frozen 73-output boundary against current platform data."""

    cch_root = Path(cch_root)
    platform_root = Path(platform_root)
    cch_paths, cch_entries = _manifest_paths(Path(cch_manifest_path), platform=False)
    platform_paths, _ = _manifest_paths(Path(base_manifest_path), platform=True)
    if len(cch_paths) != EXPECTED_OUTPUT_COUNT or len(platform_paths) != EXPECTED_OUTPUT_COUNT:
        raise ParityError(
            "exact 73-output manifests are required: "
            f"cch={len(cch_paths)} platform={len(platform_paths)}"
        )
    if cch_paths != platform_paths:
        raise ParityError(
            "CCH/platform manifest path sets differ: "
            f"missing_platform={sorted(set(cch_paths) - set(platform_paths))} "
            f"extra_platform={sorted(set(platform_paths) - set(cch_paths))}"
        )

    expected_paths = set(cch_paths)
    derived = _derived_paths(Path(base_manifest_path), derived_manifest_path)
    cch_discovered = _discover_outputs(cch_root, excluded=set())
    platform_discovered = _discover_outputs(platform_root, excluded=derived)
    boundary = _boundary_report(
        expected_paths=expected_paths,
        cch_discovered=cch_discovered,
        platform_discovered=platform_discovered,
    )
    if boundary["boundary"]["missing"]["cch"] or boundary["boundary"]["missing"]["platform"] or boundary["boundary"]["extra"]["cch"] or boundary["boundary"]["extra"]["platform"]:
        raise ParityBoundaryError("SEC 13F output boundary changed", boundary)

    rules = _load_normalization_rules(Path(contract_fixture_path), expected_paths)
    normalized_files = {path for rule in rules for path in rule["matched_files"]}
    files: list[dict[str, Any]] = []
    byte_exact_files = 0
    normalized_equal_files = 0
    mismatched_files = 0
    mismatch_count = 0
    cch_occurrences = 0
    platform_occurrences = 0

    for logical_path in cch_paths:
        cch_path = cch_root / logical_path
        platform_path = platform_root / logical_path
        cch_sha256 = _sha256_file(cch_path)
        platform_sha256 = _sha256_file(platform_path)
        byte_exact = cch_sha256 == platform_sha256
        byte_exact_files += int(byte_exact)

        try:
            cch_payload = json.loads(cch_path.read_text(encoding="utf-8"))
            platform_payload = json.loads(platform_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ParityError(f"cannot parse parity payload {logical_path}: {exc}") from exc
        if logical_path in normalized_files:
            if isinstance(cch_payload, dict):
                cch_occurrences += int(_remove_generated_at(cch_payload))
            if isinstance(platform_payload, dict):
                platform_occurrences += int(_remove_generated_at(platform_payload))
        _normalize_declared_set_orders(logical_path, cch_payload)
        _normalize_declared_set_orders(logical_path, platform_payload)

        collector = _DiffCollector(mismatch_sample_limit)
        _diff_json(cch_payload, platform_payload, collector)
        normalized_equal = collector.count == 0
        normalized_equal_files += int(normalized_equal)
        mismatched_files += int(not normalized_equal)
        mismatch_count += collector.count
        files.append(
            {
                "path": logical_path,
                "cch_sha256": cch_sha256,
                "platform_sha256": platform_sha256,
                "cch_manifest_sha256": cch_entries[logical_path].get("sha256"),
                "cch_manifest_match": cch_entries[logical_path].get("sha256") == cch_sha256,
                "byte_exact": byte_exact,
                "normalized": logical_path in normalized_files,
                "normalized_equal": normalized_equal,
                "mismatch_count": collector.count,
                "row_mismatch_count": len(collector.row_keys),
                "mismatches_truncated": collector.count > len(collector.samples),
                "mismatches": collector.samples,
            }
        )

    report = {
        "schema_version": REPORT_SCHEMA_VERSION,
        "status": "pass" if mismatched_files == 0 else "fail",
        "summary": {
            "expected_files": EXPECTED_OUTPUT_COUNT,
            "compared_files": len(files),
            "byte_exact_files": byte_exact_files,
            "normalized_equal_files": normalized_equal_files,
            "mismatched_files": mismatched_files,
            "mismatch_count": mismatch_count,
            "row_mismatch_count": sum(row["row_mismatch_count"] for row in files),
        },
        "boundary": boundary["boundary"],
        "normalization": {
            "rules": rules,
            "normalized_files": len(normalized_files),
            "cch_occurrences": cch_occurrences,
            "platform_occurrences": platform_occurrences,
        },
        "files": files,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cch-root", type=Path, required=True)
    parser.add_argument("--platform-root", type=Path, default=ROOT / "data" / "sec-13f")
    parser.add_argument(
        "--cch-manifest",
        type=Path,
        default=ROOT / "tests" / "sec13f" / "fixtures" / "cch_output_manifest.json",
    )
    parser.add_argument(
        "--base-manifest",
        type=Path,
        default=ROOT / "tests" / "sec13f" / "fixtures" / "base_output_manifest.json",
    )
    parser.add_argument(
        "--contract-fixture",
        type=Path,
        default=ROOT / "tests" / "sec13f" / "fixtures" / "sec_filing_cases.json",
    )
    parser.add_argument(
        "--derived-manifest",
        type=Path,
        default=ROOT / "tests" / "sec13f" / "fixtures" / "platform_derived_manifest.json",
    )
    parser.add_argument("--mismatch-sample-limit", type=int, default=200)
    args = parser.parse_args()

    try:
        report = compare_parity(
            cch_root=args.cch_root,
            platform_root=args.platform_root,
            cch_manifest_path=args.cch_manifest,
            base_manifest_path=args.base_manifest,
            contract_fixture_path=args.contract_fixture,
            derived_manifest_path=args.derived_manifest,
            mismatch_sample_limit=args.mismatch_sample_limit,
        )
        exit_code = 0 if report["status"] == "pass" else 1
    except ParityBoundaryError as exc:
        report = exc.report
        report["error"] = str(exc)
        exit_code = 2
    except ParityError as exc:
        report = {
            "schema_version": REPORT_SCHEMA_VERSION,
            "status": "blocked",
            "error": str(exc),
        }
        exit_code = 2

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
