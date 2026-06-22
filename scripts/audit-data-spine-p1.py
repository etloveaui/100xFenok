#!/usr/bin/env python3
"""Build a read-only Data Spine P1 authority/disagreement audit."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_spine_policy import DIAGNOSIS_ACTION, FIELD_UNIT, tolerance_label


ROOT = SCRIPT_DIR.parent
PARITY_JSON = ROOT / "data" / "computed" / "market_source_parity.json"
PARITY_BUILDER = ROOT / "scripts" / "build-market-source-parity.py"
FACTS_BUILDER = ROOT / "scripts" / "build-market-facts.py"


DIRECT_FETCH_ROWS = (
    {
        "id": "DS-P1-001",
        "path": "100xfenok-next/src/lib/server/ticker.ts",
        "provider": "Yahoo query1 + ticker worker",
        "patterns": ("QUOTE_CONTRACT_VERSION", "WORKER_TICKER_BASE"),
        "current_shape": "product-runtime quote.v1 gateway",
        "target": "quote.v1 contract ratified; provider internals remain sanctioned live exception until Data Spine live-quote service exists",
        "owner": "100x Next runtime",
        "priority": "P1-high",
        "disposition": "explicit_exception",
        "status": "contracted_2026-06-22",
        "replacement": "future Data Spine live-quote service behind quote.v1",
    },
    {
        "id": "DS-P1-002",
        "path": "100x/daily-wrap/fetcher.py",
        "provider": "Yahoo yfinance + FRED",
        "patterns": ("DEPRECATED: repo-local workflows", "allow-deprecated-fetcher"),
        "current_shape": "deprecated legacy Daily Wrap publication PoC",
        "target": "sunset documented; future Daily Wrap automation should use Data Spine/report contracts",
        "owner": "Daily Wrap legacy",
        "priority": "P2",
        "disposition": "sunset",
        "status": "closed_2026-06-22",
        "replacement": "future automated report publisher / Data Spine contract",
    },
    {
        "id": "DS-P1-003",
        "path": "admin/market-data/yahoo-quotes.gs",
        "provider": "100x quote.v1 + Yahoo OHLC + Yahoo query1 fallback",
        "patterns": ("QUOTE_GATEWAY_URL", "100X_QUOTE+YAHOO_OHLC"),
        "current_shape": "admin GAS quote helper routed through quote.v1 with Yahoo OHLC enrichment",
        "target": "gateway-first admin GAS helper; preserve OHLC until quote.v1 or Data Spine live quote includes OHLC",
        "owner": "admin market-data",
        "priority": "P2",
        "disposition": "routed_exception",
        "status": "gateway_first_ohlc_enriched_2026-06-22",
        "replacement": "100x /api/ticker quote.v1 primary + Yahoo OHLC + legacy Yahoo fallback",
    },
    {
        "id": "DS-P1-004",
        "path": "admin/market-radar/scripts/yahoo-quotes.gs",
        "provider": "100x quote.v1 + Yahoo OHLC + Stooq + GOOGLEFINANCE",
        "patterns": ("QUOTE_GATEWAY_URL", "100X_QUOTE+YAHOO_OHLC"),
        "current_shape": "market-radar GAS quote helper routed through quote.v1 with Yahoo OHLC enrichment",
        "target": "gateway-first market-radar GAS helper; preserve Prices sheet OHLC until quote.v1 or Data Spine live quote includes OHLC",
        "owner": "admin market-radar",
        "priority": "P2",
        "disposition": "routed_exception",
        "status": "gateway_first_ohlc_enriched_2026-06-22",
        "replacement": "100x /api/ticker quote.v1 primary + Yahoo OHLC + legacy fallbacks",
    },
    {
        "id": "DS-P1-005",
        "path": "admin/market-radar/scripts/vix.gs",
        "provider": "Yahoo query1 + GitHub contents API",
        "patterns": ("YAHOO_SYMBOL", "query1.finance.yahoo.com"),
        "current_shape": "deprecated market-radar VIX GAS backup",
        "target": "sunset documented; replaced by scheduled sentiment collector",
        "owner": "admin market-radar",
        "priority": "P1-medium",
        "disposition": "sunset",
        "status": "closed_2026-06-22",
        "replacement": "scripts/fetch-sentiment.mjs + .github/workflows/fetch-sentiment.yml",
    },
    {
        "id": "DS-P1-006",
        "path": "ib/ib-helper/apps-script/yahoo-quotes.gs",
        "provider": "CNBC primary + 100x quote.v1 fallback + Yahoo OHLC + Stooq + GOOGLEFINANCE",
        "patterns": ("QUOTE_GATEWAY_URL", "CNBC stays primary for IB Helper"),
        "current_shape": "IB helper GAS live quote helper with CNBC primary and quote.v1 fallback",
        "target": "keep CNBC primary for pre/post quality; use quote.v1 as the first fallback before direct Yahoo",
        "owner": "IB helper / Asset Allocator bridge",
        "priority": "P2",
        "disposition": "routed_exception",
        "status": "cnbc_primary_quote_fallback_2026-06-22",
        "replacement": "CNBC primary + 100x /api/ticker quote.v1 fallback; future AA/IB quote contract route",
    },
    {
        "id": "DS-P1-007",
        "path": "ib/ib-total-guide-calculator.html",
        "provider": "100x same-origin ticker API",
        "patterns": ("/api/ticker/", "100x ticker gateway"),
        "current_shape": "live embed consumes the ratified server quote gateway",
        "target": "browser provider/proxy fetch removed; future ticker.ts migration remains under DS-P1-001",
        "owner": "IB legacy docs",
        "priority": "P2",
        "disposition": "migrated",
        "status": "closed_2026-06-22",
        "replacement": "100xfenok-next /api/ticker/[symbol] via src/lib/server/ticker.ts",
    },
    {
        "id": "DS-P1-008",
        "path": "scripts/fetch-yf-finance-v0.py",
        "provider": "Yahoo yfinance",
        "patterns": ("DEPRECATED: yf Finance Engine v0 PoC", "allow-deprecated-v0"),
        "current_shape": "deprecated old 10-ticker PoC collector",
        "target": "sunset documented; replaced by scheduled YF v2 collector",
        "owner": "data pipeline",
        "priority": "P1-medium",
        "disposition": "sunset",
        "status": "closed_2026-06-22",
        "replacement": "scripts/fetch-yf-finance.py + .github/workflows/fetch-yf-finance.yml",
    },
)


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_parity_builder():
    spec = importlib.util.spec_from_file_location("market_source_parity", PARITY_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {PARITY_BUILDER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_facts_builder():
    spec = importlib.util.spec_from_file_location("market_facts", FACTS_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {FACTS_BUILDER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def source_line(path: Path, needle: str) -> int | None:
    if not path.exists():
        return None
    for idx, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        if needle in line:
            return idx
    return None


def first_matching_line(path: Path, patterns: tuple[str, ...]) -> int | None:
    if not path.exists():
        return None
    for idx, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        if any(pattern in line for pattern in patterns):
            return idx
    return None


def build_field_rows() -> list[dict[str, Any]]:
    parity = load_parity_builder()
    facts = load_facts_builder()
    source_policy = facts.FIELD_SOURCE_POLICY
    diagnosis_by_field: dict[str, Counter[str]] = defaultdict(Counter)
    selected_sources: dict[str, Counter[str]] = defaultdict(Counter)
    policy_samples: dict[str, list[str]] = {}

    for path in sorted(parity.FACTS_DIR.glob("*.json")):
        payload = parity.load_json(path) or {}
        facts = payload.get("facts") or {}
        if not isinstance(facts, dict):
            continue
        for field, fact in facts.items():
            if not isinstance(fact, dict):
                continue
            source = fact.get("source")
            if source:
                selected_sources[field][source] += 1
            candidates = fact.get("candidates") or []
            if not isinstance(candidates, list) or len(candidates) < 2:
                continue
            policy = fact.get("policy") or []
            diagnosis = parity.diagnose_divergence(field, candidates, policy)["diagnosis"]
            diagnosis_by_field[field][diagnosis] += 1
            policy_samples.setdefault(field, policy)

    rows = []
    for field in sorted(set(diagnosis_by_field) | set(source_policy)):
        counts = diagnosis_by_field[field]
        chain = list(source_policy.get(field, []))
        line = source_line(FACTS_BUILDER, f'"{field}"')
        rows.append(
            {
                "field": field,
                "authority": chain[0] if chain else "[not verified]",
                "authority_ref": f"scripts/build-market-facts.py:{line}" if line else "[not verified]",
                "fallback_chain": chain,
                "unit_scale": FIELD_UNIT.get(field, "[not verified]"),
                "tolerance_band": tolerance_label(field),
                "disagreement_action": DIAGNOSIS_ACTION,
                "provenance_surfaced": "yes: facts.{field}.source/as_of/fetched_at + candidates",
                "implemented_vs_proposed": "authority/fallback implemented; tolerance/action aligned to V0",
                "status": "V0_TOLERANCE_RATIFIED",
                "multi_candidate_count": sum(counts.values()),
                "agreement": counts["agreement"],
                "value_drift": counts["value_drift"],
                "stale": counts["stale"],
                "sign_divergence": counts["sign_divergence"],
                "scale_mismatch": counts["scale_mismatch"],
                "selected_sources": dict(selected_sources[field].most_common(5)),
                "policy_order": policy_samples.get(field, []),
            }
        )
    return rows


def build_direct_fetch_rows() -> list[dict[str, Any]]:
    rows = []
    for row in DIRECT_FETCH_ROWS:
        path = ROOT / row["path"]
        line = first_matching_line(path, row["patterns"])
        rows.append(
            {
                **row,
                "exists": path.exists(),
                "evidence": f"{row['path']}:{line}" if line else "[not verified]",
                "disposition": row.get("disposition", "open"),
                "status": row.get("status", "open"),
                "replacement": row.get("replacement"),
            }
        )
    return rows


def build_payload() -> dict[str, Any]:
    parity_payload = load_json(PARITY_JSON)
    return {
        "schema_version": "data-spine-p1-audit/v1",
        "generated_at": now_iso(),
        "policy_status": "partially_ratified_by_v0_legacy_exceptions_remain",
        "policy_source": "authority/fallback: scripts/build-market-facts.py; tolerance/action: scripts/data_spine_policy.py",
        "parity_summary": parity_payload.get("summary", {}),
        "field_rows": build_field_rows(),
        "diagnosis_action": DIAGNOSIS_ACTION,
        "direct_fetch_rows": build_direct_fetch_rows(),
        "public_report_metadata": {
            "dataset": "public.report_metadata",
            "status": "ratified keep_intentional_placeholder",
            "current_as_of": "2026-01-28 (from P0 inventory)",
        },
    }


def print_markdown(payload: dict[str, Any]) -> None:
    print("# Data Spine P1 Audit")
    print()
    print(f"Generated: {payload['generated_at']}")
    print(f"Policy status: {payload['policy_status']}")
    print(f"Policy source: {payload['policy_source']}")
    print()
    print("## Parity Summary")
    print()
    print("| Metric | Value |")
    print("|---|---:|")
    for key, value in payload["parity_summary"].items():
        if isinstance(value, dict):
            continue
        print(f"| `{key}` | {value} |")
    counts = payload["parity_summary"].get("diagnosis_counts") or {}
    for key, value in counts.items():
        print(f"| `diagnosis.{key}` | {value} |")
    print()
    print("## Field Diagnostics")
    print()
    print("| Field | Multi | Agree | Drift | Stale | Sign | Scale | Top selected sources |")
    print("|---|---:|---:|---:|---:|---:|---:|---|")
    for row in payload["field_rows"]:
        top = ", ".join(f"{k}:{v}" for k, v in row["selected_sources"].items())
        print(
            f"| `{row['field']}` | {row['multi_candidate_count']} | {row['agreement']} | "
            f"{row['value_drift']} | {row['stale']} | {row['sign_divergence']} | "
            f"{row['scale_mismatch']} | {top} |"
        )
    print()
    print("## Authority / Fallback Matrix")
    print()
    print("| Field | Authority ref | Fallback chain | Unit | Tolerance | Action basis | Provenance | Implemented vs proposed | Status |")
    print("|---|---|---|---|---|---|---|---|---|")
    for row in payload["field_rows"]:
        chain = " -> ".join(row["fallback_chain"]) if row["fallback_chain"] else "[not verified]"
        print(
            f"| `{row['field']}` | `{row['authority_ref']}` `{row['authority']}` | {chain} | "
            f"{row['unit_scale']} | {row['tolerance_band']} | 5-category parity action | "
            f"{row['provenance_surfaced']} | {row['implemented_vs_proposed']} | {row['status']} |"
        )
    print()
    print("## Direct Fetch Backlog Candidates")
    print()
    print("| ID | Evidence | Provider | Current shape | Target | Disposition | Status | Replacement | Owner | Priority |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for row in payload["direct_fetch_rows"]:
        print(
            f"| `{row['id']}` | `{row['evidence']}` | {row['provider']} | "
            f"{row['current_shape']} | {row['target']} | {row['disposition']} | "
            f"{row['status']} | {row.get('replacement') or '-'} | {row['owner']} | {row['priority']} |"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only Data Spine P1 authority/disagreement audit.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of Markdown.")
    return parser.parse_args()


def main() -> None:
    payload = build_payload()
    if parse_args().json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_markdown(payload)


if __name__ == "__main__":
    main()
