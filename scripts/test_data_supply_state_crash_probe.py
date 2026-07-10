import argparse
import json
import os
import sys
from pathlib import Path

from data_supply_state import (
    ConcurrencyError,
    DataSupplyStateStore,
    bind_selection_to_provider_lkg,
    build_selection,
    canonical_json_bytes,
    canonical_sha256,
    deterministic_event_id,
)


def make_observation(suffix="b"):
    payload = {"ticker": "VYMI", "suffix": suffix}
    row = {
        "schema_version": "data-supply-observation/v1",
        "provider": "stockanalysis",
        "endpoint_family": "stockanalysis_etf_detail",
        "domain": "etf_detail",
        "entity": "VYMI",
        "provider_path": f"data/stockanalysis/etfs/VYMI-{suffix}.json",
        "payload_sha256": canonical_sha256(payload),
        "provider_schema": "stockanalysis/v1",
        "source_as_of": "2026-07-10T00:00:00Z",
        "observed_at": "2026-07-10T03:00:00Z",
        "validation_status": "valid",
        "reason_code": "contract_valid",
    }
    row["event_id"] = deterministic_event_id("observation", row)
    return row


def make_failure(provider, suffix, observed_at):
    row = make_observation(suffix)
    row.update(
        {
            "provider": provider,
            "endpoint_family": (
                "stockanalysis_etf_detail" if provider == "stockanalysis" else "yahoo_finance_etf_detail"
            ),
            "provider_path": (
                f"data/stockanalysis/etfs/VYMI-{suffix}.json"
                if provider == "stockanalysis"
                else f"data/yf/etf-details/VYMI-{suffix}.json"
            ),
            "provider_schema": "stockanalysis/v1" if provider == "stockanalysis" else "yf-etf-detail/v1",
            "source_as_of": observed_at,
            "observed_at": observed_at,
            "validation_status": "invalid",
            "reason_code": "fetch_failed",
        }
    )
    row["event_id"] = deterministic_event_id("observation", row)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root")
    parser.add_argument("--failpoint", default="")
    parser.add_argument(
        "--mode",
        choices=("transition", "record", "recover", "provider-object", "provider-lkg", "prune", "rollback", "unavailable"),
        default="transition",
    )
    parser.add_argument("--transaction-id", default="")
    parser.add_argument("--target-transaction-id", default="")
    parser.add_argument("--expected-active-transaction-id", default="")
    args = parser.parse_args()

    def crash(point):
        if point == args.failpoint:
            os._exit(91)

    root = Path(args.root)
    store = DataSupplyStateStore(root, failpoint_hook=crash, provider_truth_root=root)
    if args.mode == "recover":
        store.recover_domain("etf_detail")
        return
    if args.mode == "prune":
        store.prune_domain("etf_detail")
        return
    if args.transaction_id:
        try:
            store.commit_prepared("etf_detail", args.transaction_id)
        except ConcurrencyError:
            sys.exit(73)
        return
    if args.mode == "provider-lkg":
        latest_path = root / "providers/stockanalysis/etf_detail/lkg/VYMI/latest.json"
        expected = json.loads(latest_path.read_text(encoding="utf-8"))["sha256"] if latest_path.exists() else None
        store.store_provider_lkg(
            provider="stockanalysis",
            domain="etf_detail",
            entity="VYMI",
            payload={"ticker": "VYMI", "value": 2},
            meaningful_transition=True,
            expected_latest_sha256=expected,
        )
        return
    if args.mode == "rollback":
        store.rollback_domain(
            "etf_detail",
            target_transaction_id=args.target_transaction_id,
            expected_active_transaction_id=args.expected_active_transaction_id,
            decided_at="2026-07-10T04:00:00Z",
        )
        return
    if args.mode == "unavailable":
        active = store.read_active_domain("etf_detail")
        evidence = [
            make_failure("stockanalysis", "primary-failure", "2026-07-25T02:00:00Z"),
            make_failure("yahoo_finance", "fallback-failure", "2026-07-25T02:00:01Z"),
        ]
        for failure in evidence:
            store.record_observation(failure)
        transaction_id = store.prepare_unavailable_transition(
            domain="etf_detail",
            entity="VYMI",
            evidence_observations=evidence,
            expected_active_transaction_id=active["transaction_id"],
            reason_code="all_authorities_exhausted",
            decided_at="2026-07-25T02:00:02Z",
        )
        store.commit_prepared("etf_detail", transaction_id)
        return
    row = make_observation()
    if args.mode == "provider-object":
        store.store_provider_object(
            observation=row,
            payload=canonical_json_bytes({"ticker": "VYMI", "suffix": "b"}),
        )
        return
    truth_path = root / row["provider_path"]
    truth_path.parent.mkdir(parents=True, exist_ok=True)
    truth_path.write_bytes(canonical_json_bytes({"ticker": "VYMI", "suffix": "b"}))
    if args.mode == "record":
        store.record_observation(row)
        return

    payload_bytes = canonical_json_bytes({"ticker": "VYMI", "suffix": "b"})
    provider_object = store.store_provider_object(observation=row, payload=payload_bytes)
    store.record_observation(row)
    active = store.read_active_domain("etf_detail")
    selected = build_selection(
        row,
        selected_at="2026-07-10T03:00:00Z",
        resolution_state="fresh_fallback",
        reason_code="primary_unavailable_fallback_valid",
        fallback_depth=1,
        payload_ref_kind="provider_object",
        payload_ref_path=provider_object["path"],
    )
    current = dict(active["current"])
    lkg = dict(active["lkg"])
    recovery = dict(active["recovery"])
    previous = current.get("VYMI")
    if previous:
        latest_path = (
            root
            / "providers"
            / previous["provider"]
            / previous["domain"]
            / "lkg"
            / previous["entity"]
            / "latest.json"
        )
        expected = json.loads(latest_path.read_text(encoding="utf-8"))["sha256"] if latest_path.exists() else None
        previous_payload = (root / previous["payload_ref"]["path"]).read_bytes()
        ref = store.store_provider_lkg(
            provider=previous["provider"],
            domain=previous["domain"],
            entity=previous["entity"],
            payload=previous_payload,
            meaningful_transition=True,
            expected_latest_sha256=expected,
        )
        lkg["VYMI"] = bind_selection_to_provider_lkg(previous, ref)
    current["VYMI"] = selected
    recovery["VYMI"] = {"consecutive_green": 0, "last_transition": "primary_to_fallback"}
    transaction_id = store.prepare_transition(
        domain="etf_detail",
        entity="VYMI",
        current=current,
        lkg=lkg,
        recovery=recovery,
        candidate_observations=[row],
        expected_active_transaction_id=active["transaction_id"],
        transition="primary_to_fallback",
        reason_code="primary_unavailable_fallback_valid",
        recovery_green_count=0,
        decided_at="2026-07-10T03:00:00Z",
    )
    store.commit_prepared("etf_detail", transaction_id)


if __name__ == "__main__":
    main()
