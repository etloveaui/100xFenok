#!/usr/bin/env python3
"""Build a local Data Spine P0 dataset inventory.

The script is intentionally read-only. It summarizes the current DataPack
shape so planning docs can be regenerated without trusting stale README counts.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PUBLIC_DATA = ROOT / "100xfenok-next" / "public" / "data"
WORKFLOWS = ROOT / ".github" / "workflows"
SCAN_ROOTS = [
    ROOT / "100xfenok-next" / "src",
    ROOT / "admin",
    ROOT / "scripts",
    ROOT / "100x",
]
SCAN_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".gs", ".html"}


@dataclass(frozen=True)
class DatasetSpec:
    dataset: str
    root_pattern: str
    public_pattern: str | None
    emitter: str
    schedule: str
    provenance: str
    consumer_patterns: tuple[str, ...]


DATASETS: tuple[DatasetSpec, ...] = (
    DatasetSpec(
        "computed.market_facts",
        "computed/market_facts/**/*.json",
        "computed/market_facts/**/*.json",
        "scripts/finalize-market-data.py -> scripts/build-market-facts.py",
        "post source refresh / finalize",
        "derived from yf, stockanalysis, slickcharts with per-field source candidates",
        ("computed/market_facts", "market_facts/tickers"),
    ),
    DatasetSpec(
        "computed.market_data_audit",
        "computed/market_data_audit.json",
        "computed/market_data_audit.json",
        "scripts/finalize-market-data.py -> scripts/audit-market-data.py",
        "post source refresh / finalize",
        "derived audit over StockAnalysis backfill, market facts, and parity",
        ("computed/market_data_audit", "market_data_audit"),
    ),
    DatasetSpec(
        "computed.market_source_parity",
        "computed/market_source_parity.json",
        "computed/market_source_parity.json",
        "scripts/finalize-market-data.py -> scripts/build-market-source-parity.py",
        "post source refresh / finalize",
        "derived provider-candidate comparison from market facts",
        ("computed/market_source_parity", "market_source_parity"),
    ),
    DatasetSpec(
        "computed.signals",
        "computed/signals.json",
        "computed/signals.json",
        "scripts/export-computed-signals.mjs",
        "post macro/sentiment refresh",
        "derived from macro and sentiment mirrors",
        ("computed/signals",),
    ),
    DatasetSpec(
        "computed.stock_action",
        "computed/stock_action_*.json",
        "computed/stock_action_*.json",
        "scripts/build-phase2-closeout-indexes.mjs",
        "post source refresh / closeout",
        "derived from Global Scouter, 13F, SlickCharts, YF, and computed signals",
        ("computed/stock_action", "stock_action_summary"),
    ),
    DatasetSpec(
        "computed.market_structure",
        "computed/market_structure_index.json",
        "computed/market_structure_index.json",
        "scripts/build-phase2-closeout-indexes.mjs",
        "post source refresh / closeout",
        "derived from benchmark, macro, sentiment, SlickCharts, and Damodaran inputs",
        ("computed/market_structure_index",),
    ),
    DatasetSpec(
        "stockanalysis.index_and_universe",
        "stockanalysis/index.json stockanalysis/etf_universe.json stockanalysis/classification/*.json stockanalysis/coverage/*.json",
        "stockanalysis/index.json stockanalysis/etf_universe.json stockanalysis/classification/*.json stockanalysis/coverage/*.json",
        "scripts/fetch-stockanalysis.py and 100xfenok-next QA/report scripts",
        "weekly / on demand / incremental",
        "StockAnalysis source plus local coverage/classification audits",
        ("stockanalysis/index", "stockanalysis/etf_universe", "stockanalysis/coverage", "stockanalysis/classification"),
    ),
    DatasetSpec(
        "stockanalysis.etf_details",
        "stockanalysis/etfs/*.json",
        "stockanalysis/etfs/*.json",
        "scripts/fetch-stockanalysis.py",
        "weekly / on demand / staged backfill",
        "StockAnalysis ETF detail; Yahoo fallback files explicitly tagged when used",
        ("stockanalysis/etfs", "api/data/stockanalysis/etfs"),
    ),
    DatasetSpec(
        "stockanalysis.stock_overview",
        "stockanalysis/stocks/*.json",
        "stockanalysis/stocks/*.json",
        "scripts/fetch-stockanalysis.py",
        "focused / on demand",
        "StockAnalysis stock overview cross-check layer",
        ("stockanalysis/stocks", "api/data/stockanalysis/stocks"),
    ),
    DatasetSpec(
        "stockanalysis.financial_candidates",
        "stockanalysis/financials/*.json",
        "stockanalysis/financials/*.json",
        "scripts/fetch-stockanalysis.py / scripts/probe-stockanalysis-financials.py",
        "focused / on demand",
        "StockAnalysis financial statement cross-check candidates, not valuation SSOT",
        ("stockanalysis/financials", "api/data/stockanalysis/financials"),
    ),
    DatasetSpec(
        "stockanalysis.surfaces",
        "stockanalysis/surfaces/*.json stockanalysis/surface_consumers.json",
        "stockanalysis/surfaces/*.json stockanalysis/surface_consumers.json",
        "scripts/fetch-stockanalysis.py and 100xfenok-next surface consumer QA",
        "surface refresh / on demand",
        "StockAnalysis Svelte/devalue or HTML table surfaces with route-consumer map",
        ("stockanalysis/surfaces", "api/data/stockanalysis/surfaces", "surface_consumers"),
    ),
    DatasetSpec(
        "stockanalysis.backfill_ops",
        "stockanalysis/backfill/*.json",
        "stockanalysis/backfill/*.json",
        "scripts/fetch-stockanalysis.py and 100xfenok-next history-gap report",
        "staged backfill / preflight / incremental",
        "operation proof, pending ledger, and no-network plans",
        ("stockanalysis/backfill", "incremental_latest", "history_gap_report"),
    ),
    DatasetSpec(
        "yf.finance",
        "yf/finance/*.json yf/finance/_summary.json",
        "yf/finance/*.json yf/finance/_summary.json",
        "scripts/fetch-yf-finance.py / scripts/rebuild-yf-finance-summary.py",
        "weekly / on demand",
        "Yahoo Finance local payloads with profile/fetched_at metadata",
        ("yf/finance", "data/yf/finance"),
    ),
    DatasetSpec(
        "yf.quarter_closes",
        "yf/quarter_closes.json",
        "yf/quarter_closes.json",
        "scripts/build-quarter-closes.py",
        "13F enrichment support / on demand",
        "derived from yfinance quarter-close snapshots",
        ("yf/quarter_closes", "quarter_closes"),
    ),
    DatasetSpec(
        "global_scouter.core_and_detail",
        "global-scouter/core/*.json global-scouter/stocks/detail/*.json global-scouter/etfs/*.json global-scouter/indicators/*.json",
        "global-scouter/core/*.json global-scouter/stocks/detail/*.json global-scouter/etfs/*.json global-scouter/indicators/*.json",
        "converter publish + scripts/build-stocks-analyzer.mjs + scripts/build-revision-movers.mjs",
        "on demand / workbook publish",
        "Global Scouter export and derived analyzer indexes",
        ("global-scouter/core", "global-scouter/stocks/detail", "global-scouter/etfs", "global-scouter/indicators"),
    ),
    DatasetSpec(
        "global_scouter.raw",
        "global-scouter/raw/*.json",
        "global-scouter/raw/*.json",
        "converter publish",
        "on demand / workbook publish",
        "raw source-sheet preservation layer",
        ("global-scouter/raw",),
    ),
    DatasetSpec(
        "slickcharts.indexes_and_stocks",
        "slickcharts/*.json slickcharts/stocks/*.json",
        "slickcharts/*.json slickcharts/stocks/*.json",
        "scripts/scrapers/*.py + scripts/build-slickcharts-discovery.mjs",
        "daily / weekly / monthly by scraper",
        "SlickCharts direct index, stock, returns, dividend, mover, crypto, and rate data",
        ("slickcharts/", "data/slickcharts"),
    ),
    DatasetSpec(
        "sec_13f",
        "sec-13f/**/*.json",
        "sec-13f/**/*.json",
        "13F converter + scripts/build-13f-*.mjs + scripts/build-guru-holders-index.mjs",
        "quarterly after filings / enrichment rebuilds",
        "SEC EDGAR converted holdings plus local YF enrichment",
        ("sec-13f", "superinvestors"),
    ),
    DatasetSpec(
        "benchmarks",
        "benchmarks/*.json",
        "benchmarks/*.json",
        "benchmark converter",
        "weekly, external converter-driven",
        "benchmark workbook converted JSON",
        ("benchmarks/", "market-valuation"),
    ),
    DatasetSpec(
        "damodaran",
        "damodaran/*.json",
        "damodaran/*.json",
        "Damodaran converter + scripts/build-industry-benchmarks.mjs",
        "yearly / ERP interim",
        "Damodaran public valuation factors and derived industry benchmark",
        ("damodaran/", "YardeniCard", "industry_benchmarks"),
    ),
    DatasetSpec(
        "macro",
        "macro/*.json",
        "macro/*.json",
        "converter/fetch pipeline for FRED, FDIC, OECD, PMI, stablecoins, TGA",
        "daily / weekly / monthly / quarterly",
        "specialist macro mirrors",
        ("macro/", "activity-surveys", "fred-banking", "stablecoins", "tga"),
    ),
    DatasetSpec(
        "sentiment",
        "sentiment/*.json",
        "sentiment/*.json",
        "scripts/fetch-sentiment.mjs",
        "daily / weekly",
        "AAII, CNN, CFTC, CBOE, MOVE, crypto sentiment mirrors",
        ("sentiment/", "cnn-fear-greed", "vix", "move"),
    ),
    DatasetSpec(
        "calendar",
        "calendar/*.json",
        "calendar/*.json",
        "calendar mirror + scripts/build-calendar-prev.mjs",
        "daily / on edit",
        "BujaBot USD calendar mirror and previous-value overlay",
        ("calendar/usd-calendar", "calendar/prev-values"),
    ),
    DatasetSpec(
        "yardney",
        "yardney/*.json",
        "yardney/*.json",
        "Yardeni workbook converter",
        "weekly, external converter-driven",
        "Yardeni model workbook mirror",
        ("yardney/", "yardney_model"),
    ),
    DatasetSpec(
        "indices",
        "indices/*.json",
        "indices/*.json",
        "manual/static index snapshots",
        "manual, no repo cron",
        "index snapshots for valuation-lab legacy surfaces",
        ("indices/",),
    ),
    DatasetSpec(
        "admin.manifests",
        "admin/*.json",
        "admin/*.json",
        "scripts/build-phase2-closeout-indexes.mjs / scripts/generate-stock-field-usage-manifest.mjs",
        "post source refresh / closeout",
        "data usage, stock field usage, and admin notification manifests",
        ("admin/data-usage-manifest", "stock-field-usage-manifest", "notification-folders"),
    ),
    DatasetSpec(
        "catalog.manifest_and_schemas",
        "manifest.json global-scouter/schema.json stockanalysis/schema.json",
        "manifest.json global-scouter/schema.json stockanalysis/schema.json",
        "manual schema maintenance + scripts/update-manifest.py",
        "post source refresh / schema update",
        "root DataPack manifest and schema files for agent/app discovery",
        ("manifest.json", "global-scouter/schema", "stockanalysis/schema"),
    ),
    DatasetSpec(
        "public.report_metadata",
        "",
        "metadata/*.json reports-index.json",
        "100x Daily Wrap index agent / report publication metadata",
        "on report publish / manual or agent-driven",
        "public-only Daily Wrap report metadata and reports index",
        ("metadata/", "reports-index.json"),
    ),
)


TIMESTAMP_KEYS = {
    "generated_at",
    "generatedAt",
    "updated_at",
    "updated",
    "fetched_at",
    "created",
    "last_updated",
    "lastUpdated",
    "source_date",
    "date",
}
PRIMARY_TIMESTAMP_KEYS = {
    "generated_at",
    "generatedAt",
    "updated_at",
    "updated",
    "fetched_at",
    "created",
    "last_updated",
    "lastUpdated",
    "source_date",
}
ISO_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ].*)?$")


def expand_patterns(patterns: str, base: Path) -> list[Path]:
    files: list[Path] = []
    for pattern in patterns.split():
        files.extend(path for path in base.glob(pattern) if path.is_file())
    return sorted(set(files))


def read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def iter_timestamp_values(value: Any, depth: int = 0) -> list[str]:
    if depth > 4:
        return []
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in TIMESTAMP_KEYS and isinstance(child, str) and ISO_LIKE.match(child):
                found.append(child)
            elif key == "metadata" or depth < 2:
                found.extend(iter_timestamp_values(child, depth + 1))
    elif isinstance(value, list) and depth < 2:
        sample = value[:20]
        if len(value) > 20:
            sample.extend(value[-20:])
        for child in sample:
            found.extend(iter_timestamp_values(child, depth + 1))
    return found


def primary_timestamp_values(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key in PRIMARY_TIMESTAMP_KEYS:
            child = value.get(key)
            if isinstance(child, str) and ISO_LIKE.match(child):
                found.append(child)
        metadata = value.get("metadata")
        if isinstance(metadata, dict):
            for key in PRIMARY_TIMESTAMP_KEYS:
                child = metadata.get(key)
                if isinstance(child, str) and ISO_LIKE.match(child):
                    found.append(child)
        return found
    if isinstance(value, list):
        return iter_timestamp_values(value)
    return found


def normalize_timestamp(value: str) -> str:
    value = value.strip()
    if not value:
        return value
    if len(value) == 10:
        return value
    return value.replace("Z", "+00:00")


def sortable_timestamp(value: str) -> tuple[int, str]:
    normalized = normalize_timestamp(value)
    try:
        if len(normalized) == 10:
            parsed = datetime.fromisoformat(normalized)
        else:
            parsed = datetime.fromisoformat(normalized)
        return (1, parsed.isoformat())
    except ValueError:
        return (0, value)


def latest_timestamp(files: list[Path], limit: int = 250) -> str:
    timestamps: list[str] = []
    for path in files[:limit]:
        payload = read_json(path)
        if payload is not None:
            primary = primary_timestamp_values(payload)
            timestamps.extend(primary or iter_timestamp_values(payload))
    if not timestamps:
        return "unknown"
    return max(timestamps, key=sortable_timestamp)


def scan_consumers(patterns: tuple[str, ...]) -> list[str]:
    hits: dict[str, int] = {}
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in SCAN_EXTENSIONS:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if any(pattern in text for pattern in patterns):
                try:
                    rel = path.relative_to(ROOT).as_posix()
                except ValueError:
                    rel = path.as_posix()
                if rel == "scripts/audit-data-spine-inventory.py":
                    continue
                if rel.startswith("100xfenok-next/src/generated/"):
                    continue
                if rel.startswith("scripts/test") or "/test" in rel:
                    continue
                hits[rel] = hits.get(rel, 0) + 1
    return sorted(hits)


def scan_workflows(spec: DatasetSpec) -> list[str]:
    if not WORKFLOWS.exists():
        return []
    pattern_source = spec.root_pattern or spec.public_pattern or ""
    if not pattern_source.split():
        return []
    first_pattern = pattern_source.split()[0]
    area = first_pattern.split("/", 1)[0]
    patterns = {f"data/{area}", f"100xfenok-next/public/data/{area}"}
    patterns.update(pattern for pattern in spec.consumer_patterns if "/" in pattern)
    hits: list[str] = []
    for path in sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if any(pattern in text for pattern in patterns):
            hits.append(path.relative_to(ROOT).as_posix())
    return hits


def split_ref_counts(refs: list[str]) -> tuple[int, int]:
    runtime = 0
    pipeline = 0
    for ref in refs:
        if ref.startswith("100xfenok-next/src/") or ref.startswith("admin/"):
            runtime += 1
        else:
            pipeline += 1
    return runtime, pipeline


def summarize_stockanalysis() -> dict[str, Any]:
    index = read_json(DATA / "stockanalysis" / "index.json") or {}
    audit = read_json(DATA / "computed" / "market_data_audit.json") or {}
    surfaces_index = read_json(DATA / "stockanalysis" / "surfaces" / "index.json") or {}
    consumers = read_json(DATA / "stockanalysis" / "surface_consumers.json") or {}
    return {
        "index_generated_at": index.get("generated_at"),
        "counts": index.get("counts", {}),
        "surface_index_generated_at": surfaces_index.get("generated_at"),
        "surface_count": (surfaces_index.get("counts") or {}).get("surfaces_requested"),
        "surface_rows": (surfaces_index.get("counts") or {}).get("rows"),
        "surface_consumers_updated_at": consumers.get("updated_at"),
        "surface_consumer_count": len(consumers.get("surfaces") or []),
        "audit_incremental": audit.get("incremental_etf", {}),
    }


def json_relatives(base: Path) -> set[str]:
    if not base.exists():
        return set()
    return {path.relative_to(base).as_posix() for path in base.rglob("*.json")}


def area_counts(paths: list[str]) -> dict[str, int]:
    return dict(Counter(path.split("/", 1)[0] for path in paths))


def summarize_mirror_delta() -> dict[str, Any]:
    root_files = json_relatives(DATA)
    public_files = json_relatives(PUBLIC_DATA)
    root_only = sorted(root_files - public_files)
    public_only = sorted(public_files - root_files)
    return {
        "root_only_count": len(root_only),
        "public_only_count": len(public_only),
        "root_only_by_area": area_counts(root_only),
        "public_only_by_area": area_counts(public_only),
        "root_only_examples": root_only[:20],
        "public_only_examples": public_only[:20],
    }


def build_inventory() -> dict[str, Any]:
    rows = []
    for spec in DATASETS:
        root_files = expand_patterns(spec.root_pattern, DATA)
        public_files = expand_patterns(spec.public_pattern, PUBLIC_DATA) if spec.public_pattern else []
        freshness_files = root_files or public_files
        consumers = scan_consumers(spec.consumer_patterns)
        runtime_count, pipeline_count = split_ref_counts(consumers)
        workflow_refs = scan_workflows(spec)
        rows.append(
            {
                "dataset": spec.dataset,
                "root_pattern": spec.root_pattern,
                "root_files": len(root_files),
                "public_files": len(public_files),
                "mirror_status": "match" if len(root_files) == len(public_files) else f"root={len(root_files)} public={len(public_files)}",
                "latest_timestamp": latest_timestamp(freshness_files),
                "emitter": spec.emitter,
                "schedule": spec.schedule,
                "provenance": spec.provenance,
                "consumer_count": len(consumers),
                "runtime_consumer_count": runtime_count,
                "pipeline_ref_count": pipeline_count,
                "workflow_refs": workflow_refs,
                "consumer_examples": consumers[:6],
            }
        )

    total_root_json = len(list(DATA.rglob("*.json")))
    total_public_json = len(list(PUBLIC_DATA.rglob("*.json"))) if PUBLIC_DATA.exists() else 0
    return {
        "schema_version": "data-spine-inventory/v1",
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "repo": str(ROOT),
        "totals": {
            "root_json_files": total_root_json,
            "public_json_files": total_public_json,
            "datasets": len(rows),
        },
        "stockanalysis": summarize_stockanalysis(),
        "mirror_delta": summarize_mirror_delta(),
        "rows": rows,
    }


def print_markdown(payload: dict[str, Any]) -> None:
    print("# Data Spine P0 Dataset Inventory")
    print()
    print(f"Generated: {payload['generated_at']}")
    print(f"Repo: `{payload['repo']}`")
    print()
    totals = payload["totals"]
    print("## Totals")
    print()
    print("| Metric | Value |")
    print("|---|---:|")
    print(f"| Root JSON files | {totals['root_json_files']:,} |")
    print(f"| Public JSON files | {totals['public_json_files']:,} |")
    print(f"| Inventory datasets | {totals['datasets']:,} |")
    print()
    mirror_delta = payload["mirror_delta"]
    print("## Root/Public Mirror Delta")
    print()
    print("| Metric | Value |")
    print("|---|---:|")
    print(f"| Root-only JSON files | {mirror_delta['root_only_count']:,} |")
    print(f"| Public-only JSON files | {mirror_delta['public_only_count']:,} |")
    if mirror_delta["public_only_by_area"]:
        print()
        print("Public-only by area:")
        for area, count in sorted(mirror_delta["public_only_by_area"].items()):
            print(f"- `{area}`: {count:,}")
    print()
    stockanalysis = payload["stockanalysis"]
    counts = stockanalysis.get("counts") or {}
    print("## StockAnalysis Checkpoint")
    print()
    print("| Metric | Value |")
    print("|---|---:|")
    for key in (
        "etf_universe",
        "etf_candidate_total",
        "etf_detail_files",
        "etf_detail_missing",
        "etf_detail_coverage_pct",
        "etf_detail_primary_pct",
        "incremental_etf_backfill_selected",
        "incremental_etf_ledger_tracked",
        "incremental_etf_ledger_cooldown",
    ):
        if key in counts:
            print(f"| `{key}` | {counts[key]} |")
    if stockanalysis.get("surface_count") is not None:
        print(f"| `surface_count` | {stockanalysis['surface_count']} |")
    if stockanalysis.get("surface_rows") is not None:
        print(f"| `surface_rows` | {stockanalysis['surface_rows']} |")
    print()
    print("## Inventory")
    print()
    print("| Dataset | Root files | Public files | Freshness/asOf | Emitter | Schedule | Runtime | Pipeline | Workflows |")
    print("|---|---:|---:|---|---|---|---:|---:|---:|")
    for row in payload["rows"]:
        print(
            "| {dataset} | {root_files:,} | {public_files:,} | `{latest_timestamp}` | {emitter} | {schedule} | {runtime_consumer_count} | {pipeline_ref_count} | {workflow_count} |".format(
                workflow_count=len(row["workflow_refs"]),
                **row
            )
        )
    print()
    print("## Workflow Evidence")
    print()
    for row in payload["rows"]:
        refs = row["workflow_refs"]
        if refs:
            refs_text = ", ".join(f"`{ref}`" for ref in refs)
        else:
            refs_text = "`none in .github/workflows`"
        print(f"- `{row['dataset']}`: {refs_text}")
    print()
    print("## Consumer Examples")
    print()
    for row in payload["rows"]:
        examples = row["consumer_examples"]
        if not examples:
            examples_text = "[not verified]"
        else:
            examples_text = ", ".join(f"`{example}`" for example in examples)
        print(f"- `{row['dataset']}`: {examples_text}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only Data Spine P0 inventory audit.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of Markdown.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_inventory()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_markdown(payload)


if __name__ == "__main__":
    main()
