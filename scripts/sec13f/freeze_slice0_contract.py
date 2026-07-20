#!/usr/bin/env python3
"""Freeze the SEC 13F Slice 0 registry, fixtures, and baseline manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
from typing import Any

import yaml

from contract import canonical_json, content_digest, sha256_bytes, sha256_file


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "tests" / "sec13f" / "fixtures"
REGISTRY_TARGET = ROOT / "scripts" / "sec13f" / "config" / "investors.yaml"

CCH_SNAPSHOT_FILES = (
    "config/investors.yaml",
    "config.py",
    "config_loader.py",
    "fetcher.py",
    "parser.py",
    "unit_normalizer.py",
    "filing_tracker.py",
    "analyzer.py",
    "enrichment.py",
    "generator.py",
    "metrics.py",
    "market_data.py",
    "reference_data.py",
    "ticker_resolver.py",
    "tracker.py",
    "run.py",
    "verify_output.py",
    "known_tickers.json",
    "ticker_cache.json",
    "gics_sectors.json",
    "requirements.txt",
)

BASE_ANALYTICS = (
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

PLATFORM_DERIVED = (
    "factor_exposures_summary.json",
    "guru_holders_index.json",
    "portfolio_views.json",
    "ticker_aliases.json",
    "trades_ranking.json",
)


def git_output(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    payload["content_digest"] = content_digest(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def sha256_lines_digest(entries: list[dict[str, Any]]) -> str:
    rows = "".join(
        f"{entry['sha256']}  {entry['path']}\n"
        for entry in sorted(entries, key=lambda row: row["path"])
    )
    return sha256_bytes(rows.encode("utf-8"))


def manifest_entry(path: Path, relative_path: str, category: str) -> dict[str, Any]:
    return {
        "path": relative_path,
        "category": category,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def holding(name: str, cusip: str, value: int, shares: int) -> dict[str, Any]:
    return {
        "name": name,
        "cusip": cusip,
        "title_of_class": "COM",
        "value": value,
        "shares": shares,
        "share_type": "SH",
        "investment_discretion": "SOLE",
        "voting_sole": shares,
        "voting_shared": 0,
        "voting_none": 0,
    }


def info_table_xml(rows: list[dict[str, Any]]) -> str:
    items = []
    for row in rows:
        items.append(
            "<infoTable>"
            f"<nameOfIssuer>{row['name']}</nameOfIssuer>"
            f"<titleOfClass>{row['title_of_class']}</titleOfClass>"
            f"<cusip>{row['cusip']}</cusip>"
            f"<value>{row['value']}</value>"
            f"<shrsOrPrnAmt><sshPrnamt>{row['shares']}</sshPrnamt>"
            f"<sshPrnamtType>{row['share_type']}</sshPrnamtType></shrsOrPrnAmt>"
            f"<investmentDiscretion>{row['investment_discretion']}</investmentDiscretion>"
            f"<votingAuthority><Sole>{row['voting_sole']}</Sole>"
            f"<Shared>{row['voting_shared']}</Shared><None>{row['voting_none']}</None>"
            "</votingAuthority></infoTable>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">'
        + "".join(items)
        + "</informationTable>"
    )


def cover_xml(
    *,
    count: int,
    value: int,
    amendment_type: str | None = None,
    amendment_number: int | None = None,
    confidential: bool = False,
) -> str:
    amendment = ""
    if amendment_type is not None:
        amendment = (
            f"<amendmentType>{amendment_type}</amendmentType>"
            f"<amendmentNumber>{amendment_number}</amendmentNumber>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<edgarSubmission><summaryPage>"
        f"<tableEntryTotal>{count}</tableEntryTotal>"
        f"<tableValueTotal>{value}</tableValueTotal>"
        f"<isConfidentialOmitted>{str(confidential).lower()}</isConfidentialOmitted>"
        f"{amendment}</summaryPage></edgarSubmission>"
    )


def component(
    accession: str,
    *,
    form: str = "13F-HR",
    filing_date: str,
    amendment_type: str | None = None,
    amendment_number: int | None = None,
    count: int,
    value: int,
    confidential: bool = False,
) -> dict[str, Any]:
    return {
        "accession": accession,
        "form": form,
        "filing_date": filing_date,
        "report_date": "2026-03-31",
        "amendment_type": amendment_type,
        "amendment_number": amendment_number,
        "cover_xml": cover_xml(
            count=count,
            value=value,
            amendment_type=amendment_type,
            amendment_number=amendment_number,
            confidential=confidential,
        ),
    }


def table(accession: str, rows: list[dict[str, Any]], *, xml: str | None = None) -> dict[str, Any]:
    return {
        "accession": accession,
        "xml": info_table_xml(rows) if xml is None else xml,
        "rows": rows,
    }


def build_fixture_contract() -> dict[str, Any]:
    alpha = holding("SYNTHETIC ALPHA INC", "000000AA1", 1000, 10)
    beta = holding("SYNTHETIC BETA INC", "000000BB2", 2000, 20)
    gamma = holding("SYNTHETIC GAMMA INC", "000000CC3", 1500, 15)

    base_accession = "0000000001-26-000001"
    restatement_accession = "0000000001-26-000002"
    addition_accession = "0000000001-26-000003"

    cases = [
        {
            "id": "base_filing",
            "accessions": [base_accession],
            "components": [component(base_accession, filing_date="2026-05-15", count=2, value=3000)],
            "information_tables": [table(base_accession, [alpha, beta])],
            "expected": {"result": "pass", "composition": "base", "holding_count": 2},
        },
        {
            "id": "restatement",
            "accessions": [base_accession, restatement_accession],
            "components": [
                component(base_accession, filing_date="2026-05-15", count=2, value=3000),
                component(
                    restatement_accession,
                    form="13F-HR/A",
                    filing_date="2026-05-20",
                    amendment_type="RESTATEMENT",
                    amendment_number=1,
                    count=1,
                    value=1500,
                ),
            ],
            "information_tables": [table(base_accession, [alpha, beta]), table(restatement_accession, [gamma])],
            "expected": {"result": "pass", "composition": "restatement", "holding_count": 1},
        },
        {
            "id": "add_new_holdings",
            "accessions": [base_accession, addition_accession],
            "components": [
                component(base_accession, filing_date="2026-05-15", count=1, value=1000),
                component(
                    addition_accession,
                    form="13F-HR/A",
                    filing_date="2026-05-21",
                    amendment_type="NEW HOLDINGS",
                    amendment_number=1,
                    count=1,
                    value=2000,
                ),
            ],
            "information_tables": [table(base_accession, [alpha]), table(addition_accession, [beta])],
            "expected": {"result": "pass", "composition": "base_plus_addition", "holding_count": 2},
        },
        {
            "id": "restatement_then_addition",
            "accessions": [base_accession, restatement_accession, addition_accession],
            "components": [
                component(base_accession, filing_date="2026-05-15", count=1, value=1000),
                component(
                    restatement_accession,
                    form="13F-HR/A",
                    filing_date="2026-05-20",
                    amendment_type="RESTATEMENT",
                    amendment_number=1,
                    count=1,
                    value=1500,
                ),
                component(
                    addition_accession,
                    form="13F-HR/A",
                    filing_date="2026-05-21",
                    amendment_type="NEW HOLDINGS",
                    amendment_number=2,
                    count=1,
                    value=2000,
                ),
            ],
            "information_tables": [
                table(base_accession, [alpha]),
                table(restatement_accession, [gamma]),
                table(addition_accession, [beta]),
            ],
            "expected": {"result": "pass", "composition": "restatement_plus_addition", "holding_count": 2},
        },
        {
            "id": "confidential_omission",
            "accessions": ["0000000001-26-000004"],
            "components": [
                component(
                    "0000000001-26-000004",
                    filing_date="2026-05-22",
                    count=1,
                    value=1000,
                    confidential=True,
                )
            ],
            "information_tables": [table("0000000001-26-000004", [alpha])],
            "expected": {"result": "pass", "confidential_omission": True, "holding_count": 1},
        },
        {
            "id": "absent_information_table",
            "accessions": ["0000000001-26-000005"],
            "components": [component("0000000001-26-000005", filing_date="2026-05-23", count=1, value=1000)],
            "information_tables": [],
            "expected": {"result": "blocked", "reason": "missing_information_table"},
        },
        {
            "id": "malformed_xml",
            "accessions": ["0000000001-26-000006"],
            "components": [component("0000000001-26-000006", filing_date="2026-05-24", count=1, value=1000)],
            "information_tables": [
                table("0000000001-26-000006", [], xml="<informationTable><infoTable></informationTable>")
            ],
            "expected": {"result": "blocked", "reason": "malformed_information_table_xml"},
        },
        {
            "id": "duplicate_rows",
            "accessions": ["0000000001-26-000007"],
            "components": [component("0000000001-26-000007", filing_date="2026-05-25", count=2, value=2000)],
            "information_tables": [table("0000000001-26-000007", [alpha, alpha])],
            "expected": {"result": "pass", "duplicate_policy": "preserve", "holding_count": 2},
        },
        {
            "id": "cover_count_mismatch",
            "accessions": ["0000000001-26-000008"],
            "components": [component("0000000001-26-000008", filing_date="2026-05-26", count=2, value=3000)],
            "information_tables": [table("0000000001-26-000008", [alpha])],
            "expected": {"result": "blocked", "reason": "cover_count_mismatch"},
        },
    ]

    evidence = {
        "base_filing": ["tests/test_parser.py:96-120", "tests/test_parser.py:580-604"],
        "restatement": ["tests/test_parser.py:707-725"],
        "add_new_holdings": ["tests/test_parser.py:660-705"],
        "restatement_then_addition": ["tests/test_parser.py:707-753"],
        "confidential_omission": ["parser.py:329-339"],
        "absent_information_table": ["parser.py:240-249", "parser.py:655-664"],
        "malformed_xml": ["tests/test_parser.py:181-190", "parser.py:404-407"],
        "duplicate_rows": ["tests/test_parser.py:660-703"],
        "cover_count_mismatch": ["parser.py:666-677", "verify_output.py:124-162"],
    }
    for case in cases:
        case["provenance"] = {
            "classification": "synthetic_sanitized",
            "cch_evidence": evidence[case["id"]],
        }

    return {
        "schema_version": "sec13f-slice0-fixtures/v1",
        "provenance": {
            "classification": "synthetic_sanitized",
            "created_on": "2026-07-20",
            "source_contracts": [
                "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
                "https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f",
            ],
            "note": "Synthetic issuer names, CUSIPs, CIK, accessions, values, and shares; no credentials or live filer data.",
        },
        "synthetic_filer": {"cik": "0000000001", "entity": "SYNTHETIC 13F TEST FILER"},
        "contract": {
            "forms": ["13F-HR", "13F-HR/A"],
            "component_order": [
                "report_date:asc",
                "filing_date:asc",
                "amendment_number:asc",
                "accession:asc",
            ],
            "amendment_semantics": {
                "13F-HR": "replace_active_state",
                "RESTATEMENT": "replace_active_state",
                "NEW HOLDINGS": "append_to_active_state",
                "unknown_or_missing": "fail_closed",
            },
            "duplicate_rows": "preserve_unless_same_accession_row_identity_is_explicitly_proven",
            "holding_row_order": "preserve_xml_order_then_amendment_append_order",
            "unit_rules": {
                "allowed_units": ["dollars", "thousands"],
                "multipliers": {"dollars": 1, "thousands": 1000},
                "require_evidence_and_confidence": True,
                "unresolved": "fail_closed",
            },
            "weight_filter_order": [
                "market_value / filing_total_value",
                "round_to_4_decimal_places",
                "keep_if_weight_greater_than_or_equal_to_0.001",
            ],
            "accumulated_history": {
                "fresh_fetch_quarters": 21,
                "frozen_accumulated_quarters": 30,
                "compare_separately": True,
            },
            "output_boundary": {
                "base": {"root_indexes": 3, "investors": 60, "analytics": 10, "total": 73},
                "platform_derived": 5,
                "schema": "separate_non_runtime_contract",
            },
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
            ],
            "non_volatile_provenance_paths": [
                "accession_numbers",
                "filing_date",
                "report_date",
                "amendment_types",
                "holding_values",
                "enrichment_input_dates",
            ],
            "set_order_semantics": [
                "sector_investor_ids:lexicographic",
                "new_position_ties:-value,investor_id,ticker",
                "buying_pressure_keys:lexicographic",
                "multi_quarter_tickers:lexicographic",
                "streak_ties:-streak_quarters,ticker,direction,start_quarter,end_quarter",
            ],
            "json_compatibility": {
                "encoding": "utf-8",
                "ensure_ascii": False,
                "indent": 2,
                "trailing_newline": False,
            },
        },
        "cases": cases,
    }


def build_source_manifest(cch_root: Path) -> dict[str, Any]:
    entries = []
    input_files = {"config/investors.yaml", "known_tickers.json", "ticker_cache.json", "gics_sectors.json"}
    for relative_path in CCH_SNAPSHOT_FILES:
        source = cch_root / relative_path
        if not source.is_file():
            raise FileNotFoundError(source)
        entries.append(
            manifest_entry(
                source,
                relative_path,
                "pinned_input" if relative_path in input_files else "runtime_source",
            )
        )
    entries.sort(key=lambda entry: entry["path"])
    prefix = git_output(cch_root, "rev-parse", "--show-prefix").rstrip("/")
    return {
        "schema_version": "sec13f-cch-snapshot/v1",
        "source_repository": "claude-code-hub",
        "source_path": "docs/products/converters/sec-13f",
        "subtree_tree": git_output(cch_root, "rev-parse", f"HEAD:{prefix}"),
        "subtree_last_change_commit": git_output(cch_root, "log", "-1", "--format=%H", "--", "."),
        "source_registry_sha256": sha256_file(cch_root / "config" / "investors.yaml"),
        "sha256_lines_digest": sha256_lines_digest(entries),
        "snapshot_digest": sha256_bytes(canonical_json(entries)),
        "entries": entries,
    }


def build_detached_manifest(
    *,
    paths: list[tuple[Path, str, str]],
    schema_version: str,
    logical_root: str,
    source_commit: str,
    snapshot_kind: str,
    note: str,
) -> dict[str, Any]:
    entries = [manifest_entry(path, relative_path, category) for path, relative_path, category in paths]
    entries.sort(key=lambda entry: entry["path"])
    return {
        "schema_version": schema_version,
        "logical_root": logical_root,
        "source_commit": source_commit,
        "snapshot_kind": snapshot_kind,
        "captured_on": "2026-07-20",
        "note": note,
        "total_bytes": sum(entry["bytes"] for entry in entries),
        "entries_digest": sha256_bytes(canonical_json(entries)),
        "sha256_lines_digest": sha256_lines_digest(entries),
        "entries": entries,
    }


def build_comparison_manifest(
    cch_output: dict[str, Any],
    platform_base: dict[str, Any],
    *,
    platform_commit: str,
) -> dict[str, Any]:
    cch_by_path = {entry["path"]: entry for entry in cch_output["entries"]}
    platform_by_path = {
        entry["path"].removeprefix("data/sec-13f/"): entry for entry in platform_base["entries"]
    }
    if set(cch_by_path) != set(platform_by_path):
        raise ValueError("CCH and platform 73-output path sets differ")
    entries = []
    for relative_path in sorted(cch_by_path):
        cch_entry = cch_by_path[relative_path]
        platform_entry = platform_by_path[relative_path]
        entries.append(
            {
                "relative_path": relative_path,
                "cch_sha256": cch_entry["sha256"],
                "platform_path": platform_entry["path"],
                "platform_sha256": platform_entry["sha256"],
                "byte_exact": cch_entry["sha256"] == platform_entry["sha256"],
            }
        )
    exact = sum(int(entry["byte_exact"]) for entry in entries)
    return {
        "schema_version": "sec13f-cch-platform-baseline/v1",
        "platform_commit": platform_commit,
        "comparison": "path-aligned raw bytes; no volatile-path normalization",
        "summary": {"compared": len(entries), "byte_exact": exact, "byte_mismatch": len(entries) - exact},
        "entries": entries,
    }


def build_output_manifest(
    *,
    paths: list[tuple[str, str]],
    schema_version: str,
    platform_commit: str,
    boundary: str,
) -> dict[str, Any]:
    entries = [manifest_entry(ROOT / path, path, category) for path, category in sorted(paths)]
    return {
        "schema_version": schema_version,
        "platform_commit": platform_commit,
        "boundary": boundary,
        "entries_digest": sha256_bytes(canonical_json(entries)),
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cch-root", type=Path, required=True)
    args = parser.parse_args()
    cch_root = args.cch_root.resolve()

    dirty_source = git_output(cch_root, "status", "--porcelain", "--", ".")
    if dirty_source:
        raise RuntimeError("refusing to freeze a dirty CCH SEC 13F source subtree")

    source_registry = cch_root / "config" / "investors.yaml"
    registry = yaml.safe_load(source_registry.read_text(encoding="utf-8"))
    investors = registry.get("investors", {})
    if len(investors) != 60:
        raise ValueError(f"expected 60 source investors, found {len(investors)}")

    REGISTRY_TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_registry, REGISTRY_TARGET)

    platform_commit = git_output(ROOT, "rev-parse", "HEAD")
    cch_source_commit = git_output(cch_root, "log", "-1", "--format=%H", "--", ".")
    base_paths = [
        ("data/sec-13f/summary.json", "root_index"),
        ("data/sec-13f/by_ticker.json", "root_index"),
        ("data/sec-13f/by_sector.json", "root_index"),
        *[(f"data/sec-13f/investors/{investor_id}.json", "investor") for investor_id in investors],
        *[(f"data/sec-13f/analytics/{name}", "converter_analytic") for name in BASE_ANALYTICS],
    ]
    if len(base_paths) != 73:
        raise ValueError(f"expected 73 base outputs, found {len(base_paths)}")
    derived_paths = [
        (f"data/sec-13f/analytics/{name}", "platform_derived") for name in PLATFORM_DERIVED
    ]

    cch_output_paths = [
        (cch_root / "output" / relative_path, relative_path, category)
        for relative_path, category in [
            ("summary.json", "root_index"),
            ("by_ticker.json", "root_index"),
            ("by_sector.json", "root_index"),
            *[(f"investors/{investor_id}.json", "investor") for investor_id in investors],
            *[(f"analytics/{name}", "converter_analytic") for name in BASE_ANALYTICS],
        ]
    ]
    cache_paths = []
    cache_root = cch_root / ".sec_cache"
    for path in sorted(item for item in cache_root.rglob("*") if item.is_file()):
        relative_path = path.relative_to(cache_root).as_posix()
        if relative_path == "tracker.json":
            category = "tracker"
        elif relative_path.startswith("reference/"):
            category = "sec_reference"
        else:
            category = "submissions_metadata"
        cache_paths.append((path, relative_path, category))

    cch_output_manifest = build_detached_manifest(
        paths=cch_output_paths,
        schema_version="sec13f-cch-output-manifest/v1",
        logical_root="output",
        source_commit=cch_source_commit,
        snapshot_kind="tracked_roots_and_analytics_plus_local_gitignored_investors",
        note="73 runtime outputs; conversion_report.json excluded",
    )
    cch_cache_manifest = build_detached_manifest(
        paths=cache_paths,
        schema_version="sec13f-cch-cache-manifest/v1",
        logical_root=".sec_cache",
        source_commit=cch_source_commit,
        snapshot_kind="local_gitignored_submissions_reference_tracker",
        note="Submissions/reference/tracker cache only; cover and information-table XML were not persisted, so historical raw-XML provenance is not verified.",
    )
    platform_base_manifest = build_output_manifest(
        paths=base_paths,
        schema_version="sec13f-base-output-manifest/v1",
        platform_commit=platform_commit,
        boundary="3 root indexes + 60 investor files + 10 converter analytics",
    )

    write_json(FIXTURE_ROOT / "sec_filing_cases.json", build_fixture_contract())
    write_json(FIXTURE_ROOT / "cch_source_manifest.json", build_source_manifest(cch_root))
    write_json(FIXTURE_ROOT / "cch_cache_manifest.json", cch_cache_manifest)
    write_json(FIXTURE_ROOT / "cch_output_manifest.json", cch_output_manifest)
    write_json(FIXTURE_ROOT / "base_output_manifest.json", platform_base_manifest)
    write_json(
        FIXTURE_ROOT / "platform_derived_manifest.json",
        build_output_manifest(
            paths=derived_paths,
            schema_version="sec13f-platform-derived-manifest/v1",
            platform_commit=platform_commit,
            boundary="five platform-derived analytics excluded from the 73-output base",
        ),
    )
    write_json(
        FIXTURE_ROOT / "cch_platform_baseline.json",
        build_comparison_manifest(
            cch_output_manifest,
            platform_base_manifest,
            platform_commit=platform_commit,
        ),
    )
    print(
        "froze SEC 13F Slice 0 contract: "
        f"60 investors, 9 cases, 73 CCH outputs, {len(cache_paths)} cache files, "
        "73 platform base, 5 derived"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
